import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import {
  customers,
  suppliers,
  purchases,
  products,
  rawMaterials,
  packagingMaterials,
  inventoryMovements,
  users,
} from '../db/schema.ts';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth.ts';
import { handleRouteError } from '../db/errors.ts';
import { ensureSeeded } from '../db/seed.ts';
import { generateTxnId, recordAuditLog } from '../db/audit.ts';
import {
  rupeesToPaise,
  roundQty,
  applyWeightedAverageReceipt,
  applyWeightedAverageIssue,
} from '../utils/erpMath.ts';

export const mastersRouter = Router();

// ===================== CUSTOMERS =====================
mastersRouter.get(
  '/customers',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'SALESMAN', 'AUDITOR'),
  async (req: AuthRequest, res) => {
  try {
    await ensureSeeded();
    const allCustomers = await db.select().from(customers).orderBy(customers.id);
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map((u) => [u.id, u.name]));

    let result = allCustomers;
    // Backend RBAC: Salesman only sees assigned customers
    if (req.user?.roleCode === 'SALESMAN') {
      result = allCustomers.filter((c) => c.assignedSalesmanId === req.user!.id);
    }

    res.json(
      result.map((c) => ({
        ...c,
        assignedSalesmanName: c.assignedSalesmanId ? userMap.get(c.assignedSalesmanId) || 'Unassigned' : 'Unassigned',
      }))
    );
  } catch (error) {
    console.error('Failed to load customers:', error);
    return handleRouteError(res, error, 'Failed to load customers');
  }
});

const customerSchema = z.object({
  name: z.string().min(2),
  customerType: z.enum(['RETAILER', 'DISTRIBUTOR']),
  gstin: z.string().min(10),
  phone: z.string().min(6),
  address: z.string().min(4),
  state: z.string().min(2),
  stateCode: z.string().min(2),
  creditLimitRupees: z.number().min(0),
  assignedSalesmanId: z.number().nullable().optional(),
  isActive: z.boolean().optional(),
});

mastersRouter.post(
  '/customers',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = customerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid customer data' });
      }
      const [created] = await db
        .insert(customers)
        .values({
          name: parsed.data.name.trim(),
          customerType: parsed.data.customerType,
          gstin: parsed.data.gstin.trim().toUpperCase(),
          phone: parsed.data.phone.trim(),
          address: parsed.data.address.trim(),
          state: parsed.data.state.trim(),
          stateCode: parsed.data.stateCode.trim(),
          creditLimitPaise: rupeesToPaise(parsed.data.creditLimitRupees),
          assignedSalesmanId: parsed.data.assignedSalesmanId ?? null,
          isActive: parsed.data.isActive ?? true,
        })
        .returning();

      await recordAuditLog(db, {
        user: req.user,
        action: 'CUSTOMER_CREATED',
        entity: 'Customer',
        referenceId: String(created.id),
        newValue: { name: created.name, type: created.customerType, state: created.state },
      });

      res.status(201).json(created);
    } catch (error) {
      console.error('Create customer failed:', error);
      return handleRouteError(res, error, 'Failed to create customer');
    }
  }
);

mastersRouter.put(
  '/customers/:id',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const parsed = customerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid customer data' });
      }
      const existing = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
      if (existing.length === 0) return res.status(404).json({ error: 'Customer not found' });

      const [updated] = await db
        .update(customers)
        .set({
          name: parsed.data.name.trim(),
          customerType: parsed.data.customerType,
          gstin: parsed.data.gstin.trim().toUpperCase(),
          phone: parsed.data.phone.trim(),
          address: parsed.data.address.trim(),
          state: parsed.data.state.trim(),
          stateCode: parsed.data.stateCode.trim(),
          creditLimitPaise: rupeesToPaise(parsed.data.creditLimitRupees),
          assignedSalesmanId: parsed.data.assignedSalesmanId ?? null,
          isActive: parsed.data.isActive ?? existing[0].isActive,
        })
        .where(eq(customers.id, id))
        .returning();

      await recordAuditLog(db, {
        user: req.user,
        action: 'CUSTOMER_UPDATED',
        entity: 'Customer',
        referenceId: String(id),
        previousValue: { name: existing[0].name, creditLimitPaise: existing[0].creditLimitPaise },
        newValue: { name: updated.name, creditLimitPaise: updated.creditLimitPaise },
      });

      res.json(updated);
    } catch (error) {
      console.error('Update customer failed:', error);
      return handleRouteError(res, error, 'Failed to update customer');
    }
  }
);

// ===================== SUPPLIERS =====================
mastersRouter.get(
  '/suppliers',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'AUDITOR'),
  async (_req, res) => {
    try {
      await ensureSeeded();
      const rows = await db.select().from(suppliers).orderBy(suppliers.id);
      res.json(rows);
    } catch (error) {
      console.error('Failed to load suppliers:', error);
      return handleRouteError(res, error, 'Failed to load suppliers');
    }
  }
);

const supplierSchema = z.object({
  name: z.string().min(2),
  gstin: z.string().min(10),
  phone: z.string().min(6),
  email: z.string().optional().default(''),
  address: z.string().min(4),
  state: z.string().min(2),
  stateCode: z.string().min(2),
  isActive: z.boolean().optional(),
});

const supplierStatusSchema = z.object({
  isActive: z.boolean(),
});

mastersRouter.post(
  '/suppliers',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = supplierSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid supplier data' });
      }
      const [created] = await db
        .insert(suppliers)
        .values({
          name: parsed.data.name.trim(),
          gstin: parsed.data.gstin.trim().toUpperCase(),
          phone: parsed.data.phone.trim(),
          email: parsed.data.email.trim(),
          address: parsed.data.address.trim(),
          state: parsed.data.state.trim(),
          stateCode: parsed.data.stateCode.trim(),
          isActive: parsed.data.isActive ?? true,
        })
        .returning();
      await recordAuditLog(db, {
        user: req.user,
        action: 'SUPPLIER_CREATED',
        entity: 'Supplier',
        referenceId: String(created.id),
        newValue: { name: created.name, gstin: created.gstin, isActive: created.isActive },
      });
      res.status(201).json(created);
    } catch (error) {
      console.error('Create supplier failed:', error);
      return handleRouteError(res, error, 'Failed to create supplier');
    }
  }
);

mastersRouter.put(
  '/suppliers/:id',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid supplier ID' });
      }
      const parsed = supplierSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid supplier data' });
      }
      const existing = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
      if (existing.length === 0) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      // Only OWNER or ADMIN can change supplier active/inactive status
      const nextIsActive =
        parsed.data.isActive !== undefined && ['OWNER', 'ADMIN'].includes(req.user!.roleCode)
          ? parsed.data.isActive
          : existing[0].isActive;

      const [updated] = await db
        .update(suppliers)
        .set({
          name: parsed.data.name.trim(),
          gstin: parsed.data.gstin.trim().toUpperCase(),
          phone: parsed.data.phone.trim(),
          email: parsed.data.email.trim(),
          address: parsed.data.address.trim(),
          state: parsed.data.state.trim(),
          stateCode: parsed.data.stateCode.trim(),
          isActive: nextIsActive,
        })
        .where(eq(suppliers.id, id))
        .returning();

      await recordAuditLog(db, {
        user: req.user,
        action: 'SUPPLIER_UPDATED',
        entity: 'Supplier',
        referenceId: String(id),
        previousValue: {
          name: existing[0].name,
          gstin: existing[0].gstin,
          phone: existing[0].phone,
          state: existing[0].state,
          isActive: existing[0].isActive,
        },
        newValue: {
          name: updated.name,
          gstin: updated.gstin,
          phone: updated.phone,
          state: updated.state,
          isActive: updated.isActive,
        },
      });

      res.json(updated);
    } catch (error) {
      console.error('Update supplier failed:', error);
      return handleRouteError(res, error, 'Failed to update supplier');
    }
  }
);

mastersRouter.patch(
  '/suppliers/:id/status',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid supplier ID' });
      }
      const parsed = supplierStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'isActive boolean is required' });
      }
      const existing = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
      if (existing.length === 0) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      const linkedPurchases = await db
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.supplierId, id));

      const [updated] = await db
        .update(suppliers)
        .set({ isActive: parsed.data.isActive })
        .where(eq(suppliers.id, id))
        .returning();

      await recordAuditLog(db, {
        user: req.user,
        action: parsed.data.isActive ? 'SUPPLIER_REACTIVATED' : 'SUPPLIER_DEACTIVATED',
        entity: 'Supplier',
        referenceId: String(id),
        previousValue: { name: existing[0].name, isActive: existing[0].isActive },
        newValue: {
          name: updated.name,
          isActive: updated.isActive,
          historicalPurchaseCount: linkedPurchases.length,
        },
      });

      res.json({
        ...updated,
        historicalPurchaseCount: linkedPurchases.length,
      });
    } catch (error) {
      console.error('Update supplier status failed:', error);
      return handleRouteError(res, error, 'Failed to update supplier status');
    }
  }
);

mastersRouter.delete(
  '/suppliers/:id',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid supplier ID' });
      }
      const existing = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
      if (existing.length === 0) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      const linkedPurchases = await db
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.supplierId, id));

      if (linkedPurchases.length > 0) {
        return res.status(409).json({
          error: `Cannot delete supplier "${existing[0].name}" because ${linkedPurchases.length} historical purchase record(s) reference it. Use safe deactivation instead to preserve audit trail.`,
          code: 'SUPPLIER_HAS_HISTORY',
          historicalPurchaseCount: linkedPurchases.length,
        });
      }

      const [deactivated] = await db
        .update(suppliers)
        .set({ isActive: false })
        .where(eq(suppliers.id, id))
        .returning();

      await recordAuditLog(db, {
        user: req.user,
        action: 'SUPPLIER_DEACTIVATED',
        entity: 'Supplier',
        referenceId: String(id),
        previousValue: { name: existing[0].name, isActive: existing[0].isActive },
        newValue: { name: deactivated.name, isActive: false, mode: 'SAFE_DEACTIVATION' },
      });

      res.json({
        deactivated: true,
        supplier: deactivated,
        message: 'Supplier safely deactivated (master records are preserved for audit compliance).',
      });
    } catch (error) {
      console.error('Deactivate supplier failed:', error);
      return handleRouteError(res, error, 'Failed to deactivate supplier');
    }
  }
);

// ===================== PRODUCTS =====================
mastersRouter.get('/products', requireAuth, async (_req, res) => {
  try {
    await ensureSeeded();
    const rows = await db.select().from(products).orderBy(products.id);
    res.json(rows);
  } catch (error) {
    console.error('Failed to load products:', error);
    return handleRouteError(res, error, 'Failed to load products');
  }
});

const productSchema = z.object({
  name: z.string().min(2),
  sku: z.string().min(2),
  packSize: z.string().min(1),
  hsnCode: z.string().min(4),
  gstPct: z.number().min(0).max(28),
  sellingPriceRupees: z.number().positive(),
  unit: z.string().min(1),
  minStockLevel: z.number().min(0),
  isActive: z.boolean().optional(),
});

mastersRouter.post(
  '/products',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = productSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid product data' });
      }
      const [created] = await db
        .insert(products)
        .values({
          name: parsed.data.name.trim(),
          sku: parsed.data.sku.trim().toUpperCase(),
          packSize: parsed.data.packSize.trim(),
          hsnCode: parsed.data.hsnCode.trim(),
          gstPct: parsed.data.gstPct,
          sellingPricePaise: rupeesToPaise(parsed.data.sellingPriceRupees),
          unit: parsed.data.unit.trim(),
          minStockLevel: parsed.data.minStockLevel,
          currentStock: 0,
          avgCostPaise: 0,
          isActive: parsed.data.isActive ?? true,
        })
        .returning();

      await recordAuditLog(db, {
        user: req.user,
        action: 'PRODUCT_CREATED',
        entity: 'Product',
        referenceId: created.sku,
        newValue: { name: created.name, sellingPricePaise: created.sellingPricePaise },
      });
      res.status(201).json(created);
    } catch (error) {
      console.error('Create product failed:', error);
      return handleRouteError(res, error, 'Failed to create product (SKU may already exist)');
    }
  }
);

mastersRouter.put(
  '/products/:id',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const parsed = productSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid product data' });
      }
      const existing = await db.select().from(products).where(eq(products.id, id)).limit(1);
      if (existing.length === 0) return res.status(404).json({ error: 'Product not found' });

      // Note: currentStock is NEVER overwritten directly here — only via Stock Ledger movements!
      const [updated] = await db
        .update(products)
        .set({
          name: parsed.data.name.trim(),
          sku: parsed.data.sku.trim().toUpperCase(),
          packSize: parsed.data.packSize.trim(),
          hsnCode: parsed.data.hsnCode.trim(),
          gstPct: parsed.data.gstPct,
          sellingPricePaise: rupeesToPaise(parsed.data.sellingPriceRupees),
          unit: parsed.data.unit.trim(),
          minStockLevel: parsed.data.minStockLevel,
          isActive: parsed.data.isActive ?? existing[0].isActive,
        })
        .where(eq(products.id, id))
        .returning();

      await recordAuditLog(db, {
        user: req.user,
        action: 'PRODUCT_UPDATED',
        entity: 'Product',
        referenceId: updated.sku,
        previousValue: { sellingPricePaise: existing[0].sellingPricePaise, isActive: existing[0].isActive },
        newValue: { sellingPricePaise: updated.sellingPricePaise, isActive: updated.isActive },
      });

      res.json(updated);
    } catch (error) {
      console.error('Update product failed:', error);
      return handleRouteError(res, error, 'Failed to update product');
    }
  }
);

// ===================== INVENTORY & PERMANENT LEDGER =====================
mastersRouter.get(
  '/inventory/summary',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'AUDITOR'),
  async (_req, res) => {
    try {
      await ensureSeeded();
    const [raws, packs, prods] = await Promise.all([
      db.select().from(rawMaterials).orderBy(rawMaterials.id),
      db.select().from(packagingMaterials).orderBy(packagingMaterials.id),
      db.select().from(products).orderBy(products.id),
    ]);

    const lowStockAlerts = [
      ...raws
        .filter((r) => r.currentStock <= r.minStockLevel)
        .map((r) => ({
          category: 'RAW',
          id: r.id,
          code: r.code,
          name: r.name,
          currentStock: r.currentStock,
          minStockLevel: r.minStockLevel,
          unit: r.unit,
        })),
      ...packs
        .filter((p) => p.currentStock <= p.minStockLevel)
        .map((p) => ({
          category: 'PACKAGING',
          id: p.id,
          code: p.code,
          name: p.name,
          currentStock: p.currentStock,
          minStockLevel: p.minStockLevel,
          unit: p.unit,
        })),
      ...prods
        .filter((p) => p.currentStock <= p.minStockLevel)
        .map((p) => ({
          category: 'FINISHED',
          id: p.id,
          code: p.sku,
          name: p.name,
          currentStock: p.currentStock,
          minStockLevel: p.minStockLevel,
          unit: p.unit,
        })),
    ];

    res.json({
      rawMaterials: raws,
      packagingMaterials: packs,
      finishedGoods: prods,
      lowStockAlerts,
    });
  } catch (error) {
    console.error('Failed to load inventory summary:', error);
    return handleRouteError(res, error, 'Failed to load inventory summary');
  }
});

mastersRouter.get(
  '/inventory/ledger',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'AUDITOR'),
  async (req, res) => {
    try {
      await ensureSeeded();
      const category = typeof req.query.category === 'string' ? req.query.category : 'ALL';
      const allMovements = await db
        .select()
        .from(inventoryMovements)
        .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
        .limit(400);
      const allUsers = await db.select().from(users);
      const userMap = new Map(allUsers.map((u) => [u.id, u.name]));

      const filtered =
        category && category !== 'ALL'
          ? allMovements.filter((m) => m.itemCategory === category)
          : allMovements;

      res.json(
        filtered.map((m) => ({
          ...m,
          userName: userMap.get(m.userId) || 'System',
        }))
      );
    } catch (error) {
      console.error('Failed to load stock ledger:', error);
      return handleRouteError(res, error, 'Failed to load stock ledger');
    }
  }
);

const adjustmentSchema = z.object({
  itemCategory: z.enum(['RAW', 'PACKAGING', 'FINISHED']),
  itemId: z.number().int().positive(),
  direction: z.enum(['IN', 'OUT']),
  quantity: z.number().positive(),
  unitCostRupees: z.number().min(0).optional(),
  movementType: z.enum(['ADJUSTMENT', 'SALES_RETURN', 'OPENING']).default('ADJUSTMENT'),
  reason: z.string().min(3),
});

mastersRouter.post(
  '/inventory/adjust',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = adjustmentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid adjustment' });
      }
      const { itemCategory, itemId, direction, quantity, movementType, reason } = parsed.data;
      const qty = roundQty(quantity);
      const txnId = generateTxnId('TXN-ADJ');
      const refNo = `ADJ-${Date.now().toString().slice(-6)}`;

      const result = await db.transaction(async (tx) => {
        if (itemCategory === 'RAW') {
          const rows = await tx.select().from(rawMaterials).where(eq(rawMaterials.id, itemId)).limit(1);
          if (rows.length === 0) throw new Error('Raw material not found');
          const item = rows[0];
          const prevStock = item.currentStock;
          let newStock = prevStock;
          let newVal = item.totalValuationPaise;
          let newRate = item.weightedAvgRatePaise;
          let costPaise = item.weightedAvgRatePaise;

          if (direction === 'IN') {
            const rate = parsed.data.unitCostRupees ? rupeesToPaise(parsed.data.unitCostRupees) : item.weightedAvgRatePaise;
            const calc = applyWeightedAverageReceipt({
              currentStock: item.currentStock,
              currentValuationPaise: item.totalValuationPaise,
              receiptQty: qty,
              receiptRatePaise: rate,
            });
            newStock = calc.newStock;
            newVal = calc.newValuationPaise;
            newRate = calc.newWeightedAvgRatePaise;
            costPaise = rate;
          } else {
            if (item.currentStock < qty) {
              throw new Error(`Insufficient stock for ${item.name}. Available: ${item.currentStock} ${item.unit}`);
            }
            const calc = applyWeightedAverageIssue({
              currentStock: item.currentStock,
              currentValuationPaise: item.totalValuationPaise,
              fallbackRatePaise: item.weightedAvgRatePaise,
              issueQty: qty,
            });
            newStock = calc.newStock;
            newVal = calc.newValuationPaise;
            costPaise = calc.effectiveUnitCostPaise;
          }

          await tx
            .update(rawMaterials)
            .set({ currentStock: newStock, totalValuationPaise: newVal, weightedAvgRatePaise: newRate })
            .where(eq(rawMaterials.id, item.id));

          const [mov] = await tx
            .insert(inventoryMovements)
            .values({
              transactionId: txnId,
              itemCategory: 'RAW',
              rawMaterialId: item.id,
              itemName: item.name,
              unit: item.unit,
              movementType,
              qtyIn: direction === 'IN' ? qty : 0,
              qtyOut: direction === 'OUT' ? qty : 0,
              unitCostPaise: costPaise,
              runningBalance: newStock,
              referenceType: 'ADJUSTMENT',
              referenceNo: refNo,
              notes: reason.trim(),
              userId: req.user!.id,
            })
            .returning();

          await recordAuditLog(tx, {
            user: req.user,
            action: 'STOCK_ADJUSTED',
            entity: 'Stock',
            referenceId: txnId,
            previousValue: { item: item.name, stock: prevStock },
            newValue: { item: item.name, stock: newStock, direction, qty, reason },
          });
          return mov;
        } else if (itemCategory === 'PACKAGING') {
          const rows = await tx
            .select()
            .from(packagingMaterials)
            .where(eq(packagingMaterials.id, itemId))
            .limit(1);
          if (rows.length === 0) throw new Error('Packaging material not found');
          const item = rows[0];
          const prevStock = item.currentStock;
          let newStock = prevStock;
          let newVal = item.totalValuationPaise;
          let newRate = item.weightedAvgRatePaise;
          let costPaise = item.weightedAvgRatePaise;

          if (direction === 'IN') {
            const rate = parsed.data.unitCostRupees ? rupeesToPaise(parsed.data.unitCostRupees) : item.weightedAvgRatePaise;
            const calc = applyWeightedAverageReceipt({
              currentStock: item.currentStock,
              currentValuationPaise: item.totalValuationPaise,
              receiptQty: qty,
              receiptRatePaise: rate,
            });
            newStock = calc.newStock;
            newVal = calc.newValuationPaise;
            newRate = calc.newWeightedAvgRatePaise;
            costPaise = rate;
          } else {
            if (item.currentStock < qty) {
              throw new Error(`Insufficient stock for ${item.name}. Available: ${item.currentStock} ${item.unit}`);
            }
            const calc = applyWeightedAverageIssue({
              currentStock: item.currentStock,
              currentValuationPaise: item.totalValuationPaise,
              fallbackRatePaise: item.weightedAvgRatePaise,
              issueQty: qty,
            });
            newStock = calc.newStock;
            newVal = calc.newValuationPaise;
            costPaise = calc.effectiveUnitCostPaise;
          }

          await tx
            .update(packagingMaterials)
            .set({ currentStock: newStock, totalValuationPaise: newVal, weightedAvgRatePaise: newRate })
            .where(eq(packagingMaterials.id, item.id));

          const [mov] = await tx
            .insert(inventoryMovements)
            .values({
              transactionId: txnId,
              itemCategory: 'PACKAGING',
              packagingMaterialId: item.id,
              itemName: item.name,
              unit: item.unit,
              movementType,
              qtyIn: direction === 'IN' ? qty : 0,
              qtyOut: direction === 'OUT' ? qty : 0,
              unitCostPaise: costPaise,
              runningBalance: newStock,
              referenceType: 'ADJUSTMENT',
              referenceNo: refNo,
              notes: reason.trim(),
              userId: req.user!.id,
            })
            .returning();

          await recordAuditLog(tx, {
            user: req.user,
            action: 'STOCK_ADJUSTED',
            entity: 'Stock',
            referenceId: txnId,
            previousValue: { item: item.name, stock: prevStock },
            newValue: { item: item.name, stock: newStock, direction, qty, reason },
          });
          return mov;
        } else {
          const rows = await tx.select().from(products).where(eq(products.id, itemId)).limit(1);
          if (rows.length === 0) throw new Error('Finished product not found');
          const item = rows[0];
          const prevStock = item.currentStock;
          if (direction === 'OUT' && item.currentStock < qty) {
            throw new Error(`Insufficient stock for ${item.name}. Available: ${item.currentStock} ${item.unit}`);
          }
          const newStock = roundQty(direction === 'IN' ? prevStock + qty : prevStock - qty);

          await tx.update(products).set({ currentStock: newStock }).where(eq(products.id, item.id));

          const [mov] = await tx
            .insert(inventoryMovements)
            .values({
              transactionId: txnId,
              itemCategory: 'FINISHED',
              productId: item.id,
              itemName: item.name,
              unit: item.unit,
              movementType,
              qtyIn: direction === 'IN' ? qty : 0,
              qtyOut: direction === 'OUT' ? qty : 0,
              unitCostPaise: item.avgCostPaise,
              runningBalance: newStock,
              referenceType: 'ADJUSTMENT',
              referenceNo: refNo,
              notes: reason.trim(),
              userId: req.user!.id,
            })
            .returning();

          await recordAuditLog(tx, {
            user: req.user,
            action: 'STOCK_ADJUSTED',
            entity: 'Stock',
            referenceId: txnId,
            previousValue: { item: item.name, stock: prevStock },
            newValue: { item: item.name, stock: newStock, direction, qty, reason },
          });
          return mov;
        }
      });

      res.status(201).json(result);
    } catch (error: unknown) {
      return handleRouteError(res, error, 'Stock adjustment failed', 400);
    }
  }
);

const newMaterialSchema = z.object({
  category: z.enum(['RAW', 'PACKAGING']),
  name: z.string().min(2),
  code: z.string().min(2),
  unit: z.string().min(1),
  minStockLevel: z.number().min(0),
  openingRateRupees: z.number().min(0).default(0),
});

mastersRouter.post(
  '/inventory/materials',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = newMaterialSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid material data' });
      }
      const ratePaise = rupeesToPaise(parsed.data.openingRateRupees);
      if (parsed.data.category === 'RAW') {
        const baseUnit = parsed.data.unit.toLowerCase().includes('l') ? 'ml' : 'g';
        const [created] = await db
          .insert(rawMaterials)
          .values({
            name: parsed.data.name.trim(),
            code: parsed.data.code.trim().toUpperCase(),
            unit: parsed.data.unit.trim(),
            baseUnit,
            conversionFactor: 1000,
            minStockLevel: parsed.data.minStockLevel,
            currentStock: 0,
            weightedAvgRatePaise: ratePaise,
            totalValuationPaise: 0,
          })
          .returning();
        await recordAuditLog(db, {
          user: req.user,
          action: 'RAW_MATERIAL_CREATED',
          entity: 'Stock',
          referenceId: created.code,
          newValue: { name: created.name, unit: created.unit },
        });
        return res.status(201).json(created);
      } else {
        const [created] = await db
          .insert(packagingMaterials)
          .values({
            name: parsed.data.name.trim(),
            code: parsed.data.code.trim().toUpperCase(),
            unit: parsed.data.unit.trim(),
            minStockLevel: parsed.data.minStockLevel,
            currentStock: 0,
            weightedAvgRatePaise: ratePaise,
            totalValuationPaise: 0,
          })
          .returning();
        await recordAuditLog(db, {
          user: req.user,
          action: 'PACKAGING_MATERIAL_CREATED',
          entity: 'Stock',
          referenceId: created.code,
          newValue: { name: created.name, unit: created.unit },
        });
        return res.status(201).json(created);
      }
    } catch (error) {
      console.error('Failed to add material:', error);
      return handleRouteError(res, error, 'Failed to add material (code may already exist)');
    }
  }
);
