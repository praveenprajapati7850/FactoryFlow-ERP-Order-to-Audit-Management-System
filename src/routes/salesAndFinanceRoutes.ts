import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import {
  orders,
  orderItems,
  invoices,
  invoiceItems,
  creditNotes,
  payments,
  customers,
  products,
  rawMaterials,
  packagingMaterials,
  purchases,
  purchaseItems,
  suppliers,
  productionRuns,
  productionConsumptions,
  inventoryMovements,
  companySettings,
  users,
} from '../db/schema.ts';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth.ts';
import { handleRouteError } from '../db/errors.ts';
import { ensureSeeded } from '../db/seed.ts';
import { generateTxnId, recordAuditLog } from '../db/audit.ts';
import {
  rupeesToPaise,
  calculateGstLine,
  getFinancialYear,
  formatInvoiceNumber,
  amountInWordsINR,
  getAgeingBucket,
  roundQty,
  calculateStockShortage,
  calculateInvoiceOutstandingPaise,
  applyInvoicePayment,
} from '../utils/erpMath.ts';

export const salesAndFinanceRouter = Router();

// ===================== ORDERS =====================
salesAndFinanceRouter.get(
  '/orders',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'SALESMAN', 'AUDITOR'),
  async (req: AuthRequest, res) => {
  try {
    await ensureSeeded();
    const [allOrders, allItems, allCustomers, allProducts, allUsers, allInvoices] = await Promise.all([
      db.select().from(orders).orderBy(desc(orders.orderDate), desc(orders.id)),
      db.select().from(orderItems),
      db.select().from(customers),
      db.select().from(products),
      db.select().from(users),
      db.select().from(invoices),
    ]);

    const custMap = new Map(allCustomers.map((c) => [c.id, c]));
    const prodMap = new Map(allProducts.map((p) => [p.id, p]));
    const userMap = new Map(allUsers.map((u) => [u.id, u.name]));
    const invByOrder = new Map(allInvoices.filter((i) => i.orderId).map((i) => [i.orderId!, i]));

    let visibleOrders = allOrders;
    // Backend RBAC: Salesman only sees their own orders
    if (req.user?.roleCode === 'SALESMAN') {
      visibleOrders = allOrders.filter((o) => o.salesmanId === req.user!.id);
    }

    res.json(
      visibleOrders.map((o) => {
        const cust = custMap.get(o.customerId);
        const inv = invByOrder.get(o.id);
        return {
          ...o,
          customerName: cust?.name || 'Unknown Customer',
          customerState: cust?.state || '',
          customerGstin: cust?.gstin || '',
          customerType: cust?.customerType || '',
          salesmanName: userMap.get(o.salesmanId) || 'Unknown',
          invoiceId: inv?.id ?? null,
          invoiceNo: inv?.invoiceNo ?? null,
          items: allItems
            .filter((i) => i.orderId === o.id)
            .map((i) => {
              const p = prodMap.get(i.productId);
              const availableStock = p?.currentStock ?? 0;
              const pendingDispatchQty =
                o.status === 'DISPATCHED' || o.status === 'REJECTED'
                  ? 0
                  : Math.max(0, roundQty(i.quantity - i.dispatchedQty));
              return {
                ...i,
                productName: p?.name || 'Unknown',
                sku: p?.sku || '',
                unit: p?.unit || 'packets',
                availableStock,
                shortageQty: calculateStockShortage(pendingDispatchQty, availableStock),
              };
            }),
        };
      })
    );
  } catch (error) {
    console.error('Failed to load orders:', error);
    return handleRouteError(res, error, 'Failed to load orders');
  }
});

const orderCreateSchema = z.object({
  customerId: z.number().int().positive(),
  orderDate: z.string().min(8),
  status: z.enum(['DRAFT', 'SUBMITTED']).default('SUBMITTED'),
  notes: z.string().optional().default(''),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().positive(),
        unitPriceRupees: z.number().positive().optional(),
      })
    )
    .min(1),
});

salesAndFinanceRouter.post(
  '/orders',
  requireAuth,
  requireRole('SALESMAN', 'ADMIN', 'OWNER'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = orderCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid order data' });
      }
      const data = parsed.data;

      const created = await db.transaction(async (tx) => {
        const [customer] = await tx
          .select()
          .from(customers)
          .where(eq(customers.id, data.customerId))
          .limit(1);
        if (!customer) throw new Error('Customer not found');

        if (req.user!.roleCode === 'SALESMAN' && customer.assignedSalesmanId !== req.user!.id) {
          throw new Error('You can only create orders for customers assigned to you');
        }

        const settingsRows = await tx.select().from(companySettings).limit(1);
        const factoryState = settingsRows[0]?.state || 'Tamil Nadu';
        const isInterState = customer.state.toLowerCase() !== factoryState.toLowerCase();

        const existingOrders = await tx.select({ id: orders.id }).from(orders);
        const orderNo = `ORD-2026-${String(existingOrders.length + 1).padStart(4, '0')}`;

        let subtotalPaise = 0;
        let taxPaise = 0;
        let totalPaise = 0;

        const lines: Array<{
          productId: number;
          quantity: number;
          unitPricePaise: number;
          gstPct: number;
          taxablePaise: number;
          taxPaise: number;
          lineTotalPaise: number;
        }> = [];

        for (const item of data.items) {
          const [prod] = await tx.select().from(products).where(eq(products.id, item.productId)).limit(1);
          if (!prod) throw new Error(`Product ID ${item.productId} not found`);
          // Salesman always uses price list; Admin/Owner can override
          const unitPricePaise =
            req.user!.roleCode === 'SALESMAN' || !item.unitPriceRupees
              ? prod.sellingPricePaise
              : rupeesToPaise(item.unitPriceRupees);

          const gst = calculateGstLine({
            quantity: item.quantity,
            unitPricePaise,
            gstPct: prod.gstPct,
            isInterState,
          });
          subtotalPaise += gst.taxableValuePaise;
          taxPaise += gst.totalTaxPaise;
          totalPaise += gst.lineTotalPaise;
          lines.push({
            productId: prod.id,
            quantity: item.quantity,
            unitPricePaise,
            gstPct: prod.gstPct,
            taxablePaise: gst.taxableValuePaise,
            taxPaise: gst.totalTaxPaise,
            lineTotalPaise: gst.lineTotalPaise,
          });
        }

        const [ord] = await tx
          .insert(orders)
          .values({
            orderNo,
            customerId: customer.id,
            salesmanId: req.user!.id,
            orderDate: data.orderDate,
            status: data.status,
            subtotalPaise,
            taxPaise,
            totalPaise,
            notes: data.notes,
          })
          .returning();

        for (const l of lines) {
          await tx.insert(orderItems).values({
            orderId: ord.id,
            ...l,
          });
        }

        await recordAuditLog(tx, {
          user: req.user,
          action: data.status === 'DRAFT' ? 'ORDER_DRAFT_SAVED' : 'ORDER_SUBMITTED',
          entity: 'Order',
          referenceId: orderNo,
          newValue: { customer: customer.name, status: data.status, totalPaise },
        });

        return ord;
      });

      res.status(201).json(created);
    } catch (error: unknown) {
      return handleRouteError(res, error, 'Failed to create order', 400);
    }
  }
);

const editOrderSchema = z.object({
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().positive(),
        unitPriceRupees: z.number().positive(),
      })
    )
    .min(1),
});

salesAndFinanceRouter.put(
  '/orders/:id',
  requireAuth,
  requireRole('ADMIN', 'OWNER', 'SALESMAN'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const parsed = editOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid order edit' });
      }

      const updated = await db.transaction(async (tx) => {
        const [ord] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
        if (!ord) throw new Error('Order not found');
        if (!['DRAFT', 'SUBMITTED'].includes(ord.status)) {
          throw new Error('Only Draft or Submitted orders can be modified before approval');
        }
        if (req.user!.roleCode === 'SALESMAN' && (ord.salesmanId !== req.user!.id || ord.status !== 'DRAFT')) {
          const err = new Error('Forbidden: Salesmen can only edit their own Draft orders') as Error & { status?: number };
          err.status = 403;
          throw err;
        }

        const [customer] = await tx.select().from(customers).where(eq(customers.id, ord.customerId)).limit(1);
        const settingsRows = await tx.select().from(companySettings).limit(1);
        const factoryState = settingsRows[0]?.state || 'Tamil Nadu';
        const isInterState = (customer?.state || '').toLowerCase() !== factoryState.toLowerCase();

        await tx.delete(orderItems).where(eq(orderItems.orderId, ord.id));

        let subtotalPaise = 0;
        let taxPaise = 0;
        let totalPaise = 0;

        for (const item of parsed.data.items) {
          const [prod] = await tx.select().from(products).where(eq(products.id, item.productId)).limit(1);
          if (!prod) throw new Error('Product not found');
          // Salesman always uses catalog selling price; Admin/Owner can override
          const unitPricePaise =
            req.user!.roleCode === 'SALESMAN'
              ? prod.sellingPricePaise
              : rupeesToPaise(item.unitPriceRupees);
          const gst = calculateGstLine({
            quantity: item.quantity,
            unitPricePaise,
            gstPct: prod.gstPct,
            isInterState,
          });
          subtotalPaise += gst.taxableValuePaise;
          taxPaise += gst.totalTaxPaise;
          totalPaise += gst.lineTotalPaise;

          await tx.insert(orderItems).values({
            orderId: ord.id,
            productId: prod.id,
            quantity: item.quantity,
            dispatchedQty: 0,
            unitPricePaise,
            gstPct: prod.gstPct,
            taxablePaise: gst.taxableValuePaise,
            taxPaise: gst.totalTaxPaise,
            lineTotalPaise: gst.lineTotalPaise,
          });
        }

        const [upd] = await tx
          .update(orders)
          .set({
            subtotalPaise,
            taxPaise,
            totalPaise,
            notes: parsed.data.notes ?? ord.notes,
          })
          .where(eq(orders.id, ord.id))
          .returning();

        await recordAuditLog(tx, {
          user: req.user,
          action: 'ORDER_EDITED',
          entity: 'Order',
          referenceId: ord.orderNo,
          previousValue: { totalPaise: ord.totalPaise },
          newValue: { totalPaise },
        });
        return upd;
      });

      res.json(updated);
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status || 400;
      return handleRouteError(res, error, 'Failed to update order', status);
    }
  }
);

salesAndFinanceRouter.post(
  '/orders/:id/submit',
  requireAuth,
  requireRole('SALESMAN', 'ADMIN', 'OWNER'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const [ord] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!ord) return res.status(404).json({ error: 'Order not found' });
      if (req.user!.roleCode === 'SALESMAN' && ord.salesmanId !== req.user!.id) {
        return res.status(403).json({ error: 'Forbidden: Salesmen can only submit their own draft orders' });
      }
      if (ord.status !== 'DRAFT') return res.status(400).json({ error: 'Only Draft orders can be submitted' });
      const [upd] = await db.update(orders).set({ status: 'SUBMITTED' }).where(eq(orders.id, id)).returning();
      await recordAuditLog(db, {
        user: req.user,
        action: 'ORDER_SUBMITTED',
        entity: 'Order',
        referenceId: ord.orderNo,
        previousValue: { status: 'DRAFT' },
        newValue: { status: 'SUBMITTED' },
      });
      res.json(upd);
    } catch (error) {
      return handleRouteError(res, error, 'Failed to submit order');
    }
  }
);

salesAndFinanceRouter.post(
  '/orders/:id/approve',
  requireAuth,
  requireRole('ADMIN', 'OWNER'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const [ord] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!ord) return res.status(404).json({ error: 'Order not found' });
      if (ord.status !== 'SUBMITTED') {
        return res.status(400).json({ error: `Order is already ${ord.status} and cannot be approved` });
      }
      const [upd] = await db
        .update(orders)
        .set({ status: 'APPROVED', approvedById: req.user!.id, approvedAt: new Date() })
        .where(eq(orders.id, id))
        .returning();

      await recordAuditLog(db, {
        user: req.user,
        action: 'ORDER_APPROVED',
        entity: 'Order',
        referenceId: ord.orderNo,
        previousValue: { status: ord.status },
        newValue: { status: 'APPROVED' },
      });
      res.json(upd);
    } catch (error) {
      return handleRouteError(res, error, 'Failed to approve order');
    }
  }
);

salesAndFinanceRouter.post(
  '/orders/:id/reject',
  requireAuth,
  requireRole('ADMIN', 'OWNER'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim()
        : 'Rejected during verification';
      const [ord] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!ord) return res.status(404).json({ error: 'Order not found' });
      if (!['SUBMITTED', 'APPROVED'].includes(ord.status)) {
        return res.status(400).json({ error: 'Order cannot be rejected in its current status' });
      }
      const [upd] = await db
        .update(orders)
        .set({ status: 'REJECTED', rejectionReason: reason })
        .where(eq(orders.id, id))
        .returning();

      await recordAuditLog(db, {
        user: req.user,
        action: 'ORDER_REJECTED',
        entity: 'Order',
        referenceId: ord.orderNo,
        previousValue: { status: ord.status },
        newValue: { status: 'REJECTED', reason },
      });
      res.json(upd);
    } catch (error) {
      return handleRouteError(res, error, 'Failed to reject order');
    }
  }
);

// ===================== GST INVOICES, DISPATCH & CREDIT NOTES =====================
salesAndFinanceRouter.get(
  '/invoices',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'SALESMAN', 'AUDITOR'),
  async (req: AuthRequest, res) => {
  try {
    await ensureSeeded();
    const [allInvoices, allItems, allCustomers, allCreditNotes, allSettings, allOrders] = await Promise.all([
      db.select().from(invoices).orderBy(desc(invoices.invoiceDate), desc(invoices.id)),
      db.select().from(invoiceItems),
      db.select().from(customers),
      db.select().from(creditNotes),
      db.select().from(companySettings).limit(1),
      db.select().from(orders),
    ]);

    const custMap = new Map(allCustomers.map((c) => [c.id, c]));
    const orderMap = new Map(allOrders.map((o) => [o.id, o]));

    let visible = allInvoices;
    if (req.user?.roleCode === 'SALESMAN') {
      const assignedCustIds = new Set(
        allCustomers.filter((c) => c.assignedSalesmanId === req.user!.id).map((c) => c.id)
      );
      visible = allInvoices.filter((inv) => assignedCustIds.has(inv.customerId));
    }

    res.json({
      company: allSettings[0] || null,
      invoices: visible.map((inv) => {
        const cust = custMap.get(inv.customerId);
        const ord = inv.orderId ? orderMap.get(inv.orderId) : null;
        return {
          ...inv,
          orderNo: ord?.orderNo || null,
          customerName: cust?.name || 'Unknown',
          customerGstin: cust?.gstin || '',
          customerAddress: cust?.address || '',
          customerState: cust?.state || '',
          customerStateCode: cust?.stateCode || '',
          customerPhone: cust?.phone || '',
          outstandingPaise: calculateInvoiceOutstandingPaise(inv.grandTotalPaise, inv.paidPaise, inv.status),
          items: allItems.filter((i) => i.invoiceId === inv.id),
          creditNotes: allCreditNotes.filter((cn) => cn.invoiceId === inv.id),
        };
      }),
    });
  } catch (error) {
    console.error('Failed to load invoices:', error);
    return handleRouteError(res, error, 'Failed to load GST invoices');
  }
});

salesAndFinanceRouter.post(
  '/invoices/from-order/:orderId',
  requireAuth,
  requireRole('ADMIN', 'OWNER'),
  async (req: AuthRequest, res) => {
    try {
      const orderId = Number(req.params.orderId);
      const invoiceDate =
        typeof req.body?.invoiceDate === 'string' && req.body.invoiceDate.length >= 8
          ? req.body.invoiceDate
          : new Date().toISOString().slice(0, 10);

      const created = await db.transaction(async (tx) => {
        const [ord] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        if (!ord) throw new Error('Order not found');
        if (ord.status !== 'APPROVED') {
          throw new Error('Only Approved orders can be invoiced. Approve the order first.');
        }

        // Prevent duplicate invoicing
        const existingInv = await tx.select().from(invoices).where(eq(invoices.orderId, ord.id)).limit(1);
        if (existingInv.length > 0) {
          throw new Error(`Order ${ord.orderNo} is already invoiced (${existingInv[0].invoiceNo})`);
        }

        const [customer] = await tx.select().from(customers).where(eq(customers.id, ord.customerId)).limit(1);
        if (!customer) throw new Error('Customer not found');

        const settingsRows = await tx.select().from(companySettings).limit(1);
        const company = settingsRows[0];
        const factoryState = company?.state || 'Tamil Nadu';
        const prefix = company?.invoicePrefix || 'FF';
        const fy = getFinancialYear(invoiceDate);
        const isInterState = customer.state.toLowerCase() !== factoryState.toLowerCase();

        // Sequential FY-aware numbering
        const fyInvoices = await tx.select().from(invoices).where(eq(invoices.financialYear, fy));
        const invoiceNo = formatInvoiceNumber(prefix, fy, fyInvoices.length + 1);

        const oItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, ord.id));
        if (oItems.length === 0) throw new Error('Order has no line items');

        let taxableValuePaise = 0;
        let cgstPaise = 0;
        let sgstPaise = 0;
        let igstPaise = 0;
        let grandTotalPaise = 0;

        const invItemPayloads: Array<Omit<typeof invoiceItems.$inferInsert, 'invoiceId'>> = [];

        for (const oi of oItems) {
          const [prod] = await tx.select().from(products).where(eq(products.id, oi.productId)).limit(1);
          if (!prod) throw new Error('Product missing');
          const gst = calculateGstLine({
            quantity: oi.quantity,
            unitPricePaise: oi.unitPricePaise,
            gstPct: oi.gstPct,
            isInterState,
          });
          taxableValuePaise += gst.taxableValuePaise;
          cgstPaise += gst.cgstPaise;
          sgstPaise += gst.sgstPaise;
          igstPaise += gst.igstPaise;
          grandTotalPaise += gst.lineTotalPaise;

          invItemPayloads.push({
            productId: prod.id,
            productName: prod.name,
            hsnCode: prod.hsnCode,
            quantity: oi.quantity,
            dispatchedQty: 0,
            unit: prod.unit,
            unitPricePaise: oi.unitPricePaise,
            taxableValuePaise: gst.taxableValuePaise,
            gstPct: oi.gstPct,
            cgstPaise: gst.cgstPaise,
            sgstPaise: gst.sgstPaise,
            igstPaise: gst.igstPaise,
            lineTotalPaise: gst.lineTotalPaise,
          });
        }

        const dueDateObj = new Date(`${invoiceDate}T00:00:00Z`);
        dueDateObj.setUTCDate(dueDateObj.getUTCDate() + 30);
        const dueDate = dueDateObj.toISOString().slice(0, 10);

        const [inv] = await tx
          .insert(invoices)
          .values({
            invoiceNo,
            financialYear: fy,
            orderId: ord.id,
            customerId: customer.id,
            invoiceDate,
            dueDate,
            supplyType: isInterState ? 'INTER_STATE' : 'INTRA_STATE',
            taxableValuePaise,
            cgstPaise,
            sgstPaise,
            igstPaise,
            grandTotalPaise,
            amountInWords: amountInWordsINR(grandTotalPaise),
            paidPaise: 0,
            status: 'POSTED',
            dispatchStatus: 'PENDING',
            createdById: req.user!.id,
          })
          .returning();

        for (const payload of invItemPayloads) {
          await tx.insert(invoiceItems).values({
            invoiceId: inv.id,
            ...payload,
          });
        }

        await tx.update(orders).set({ status: 'INVOICED' }).where(eq(orders.id, ord.id));

        await recordAuditLog(tx, {
          user: req.user,
          action: 'INVOICE_POSTED',
          entity: 'Invoice',
          referenceId: invoiceNo,
          previousValue: { orderNo: ord.orderNo, status: 'APPROVED' },
          newValue: {
            invoiceNo,
            supplyType: inv.supplyType,
            taxableValuePaise,
            cgstPaise,
            sgstPaise,
            igstPaise,
            grandTotalPaise,
          },
        });

        return inv;
      });

      res.status(201).json(created);
    } catch (error: unknown) {
      return handleRouteError(res, error, 'Failed to generate invoice', 400);
    }
  }
);

const dispatchSchema = z.object({
  items: z
    .array(
      z.object({
        invoiceItemId: z.number().int().positive(),
        dispatchQty: z.number().positive(),
      })
    )
    .min(1),
  notes: z.string().optional().default(''),
});

salesAndFinanceRouter.post(
  '/invoices/:id/dispatch',
  requireAuth,
  requireRole('ADMIN', 'OWNER'),
  async (req: AuthRequest, res) => {
    try {
      const invoiceId = Number(req.params.id);
      const parsed = dispatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid dispatch request' });
      }

      const result = await db.transaction(async (tx) => {
        const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
        if (!inv) throw new Error('Invoice not found');
        if (inv.status === 'REVERSED') throw new Error('Cannot dispatch a reversed invoice');

        const invItems = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
        const itemMap = new Map(invItems.map((i) => [i.id, i]));

        for (const reqItem of parsed.data.items) {
          const line = itemMap.get(reqItem.invoiceItemId);
          if (!line) throw new Error('Invoice line item not found');
          const remaining = roundQty(line.quantity - line.dispatchedQty);
          if (reqItem.dispatchQty > remaining) {
            throw new Error(
              `Dispatch qty (${reqItem.dispatchQty}) exceeds remaining qty (${remaining}) for ${line.productName}`
            );
          }
          const [prod] = await tx.select().from(products).where(eq(products.id, line.productId)).limit(1);
          if (!prod) throw new Error('Finished product not found');
          if (prod.currentStock < reqItem.dispatchQty) {
            throw new Error(
              `Insufficient finished stock for ${prod.name}. Available: ${prod.currentStock}, requested: ${reqItem.dispatchQty}`
            );
          }

          const newProdStock = roundQty(prod.currentStock - reqItem.dispatchQty);
          await tx.update(products).set({ currentStock: newProdStock }).where(eq(products.id, prod.id));

          const newDispatched = roundQty(line.dispatchedQty + reqItem.dispatchQty);
          await tx
            .update(invoiceItems)
            .set({ dispatchedQty: newDispatched })
            .where(eq(invoiceItems.id, line.id));
          line.dispatchedQty = newDispatched;

          await tx.insert(inventoryMovements).values({
            transactionId: generateTxnId('TXN-DSP'),
            itemCategory: 'FINISHED',
            productId: prod.id,
            itemName: prod.name,
            unit: prod.unit,
            movementType: 'SALES_DISPATCH',
            qtyIn: 0,
            qtyOut: reqItem.dispatchQty,
            unitCostPaise: prod.avgCostPaise,
            runningBalance: newProdStock,
            referenceType: 'INVOICE',
            referenceNo: inv.invoiceNo,
            notes: parsed.data.notes || `Dispatched against ${inv.invoiceNo}`,
            userId: req.user!.id,
          });
        }

        const allFullyDispatched = invItems.every((l) => l.dispatchedQty >= l.quantity);
        const dispatchStatus = allFullyDispatched ? 'DISPATCHED' : 'PARTIAL';

        const [updInv] = await tx
          .update(invoices)
          .set({ dispatchStatus })
          .where(eq(invoices.id, inv.id))
          .returning();

        if (inv.orderId && allFullyDispatched) {
          await tx
            .update(orders)
            .set({ status: 'DISPATCHED', dispatchedAt: new Date() })
            .where(eq(orders.id, inv.orderId));
        }

        await recordAuditLog(tx, {
          user: req.user,
          action: 'SALES_DISPATCHED',
          entity: 'Invoice',
          referenceId: inv.invoiceNo,
          previousValue: { dispatchStatus: inv.dispatchStatus },
          newValue: { dispatchStatus, dispatchedLines: parsed.data.items },
        });

        return updInv;
      });

      res.json(result);
    } catch (error: unknown) {
      return handleRouteError(res, error, 'Dispatch failed', 400);
    }
  }
);

// Credit Note Reversal (Posted invoices are NEVER deleted)
salesAndFinanceRouter.post(
  '/invoices/:id/credit-note',
  requireAuth,
  requireRole('ADMIN', 'OWNER'),
  async (req: AuthRequest, res) => {
    try {
      const invoiceId = Number(req.params.id);
      const reason =
        typeof req.body?.reason === 'string' && req.body.reason.trim().length >= 3
          ? req.body.reason.trim()
          : '';
      if (!reason) {
        return res.status(400).json({ error: 'A valid cancellation/reversal reason is required' });
      }

      const cn = await db.transaction(async (tx) => {
        const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
        if (!inv) throw new Error('Invoice not found');
        if (inv.status === 'REVERSED') {
          throw new Error('This invoice has already been reversed by a Credit Note');
        }

        const existingCns = await tx.select({ id: creditNotes.id }).from(creditNotes);
        const creditNoteNo = `CN/${inv.financialYear}/${String(existingCns.length + 1).padStart(4, '0')}`;

        const [createdCn] = await tx
          .insert(creditNotes)
          .values({
            creditNoteNo,
            invoiceId: inv.id,
            customerId: inv.customerId,
            issueDate: new Date().toISOString().slice(0, 10),
            reason,
            taxableValuePaise: inv.taxableValuePaise,
            cgstPaise: inv.cgstPaise,
            sgstPaise: inv.sgstPaise,
            igstPaise: inv.igstPaise,
            totalPaise: inv.grandTotalPaise,
            createdById: req.user!.id,
          })
          .returning();

        // Restore any dispatched stock via permanent SALES_RETURN ledger entry
        const lines = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
        for (const l of lines) {
          if (l.dispatchedQty > 0) {
            const [prod] = await tx.select().from(products).where(eq(products.id, l.productId)).limit(1);
            if (prod) {
              const restored = roundQty(prod.currentStock + l.dispatchedQty);
              await tx.update(products).set({ currentStock: restored }).where(eq(products.id, prod.id));
              await tx.insert(inventoryMovements).values({
                transactionId: generateTxnId('TXN-CN'),
                itemCategory: 'FINISHED',
                productId: prod.id,
                itemName: prod.name,
                unit: prod.unit,
                movementType: 'REVERSAL',
                qtyIn: l.dispatchedQty,
                qtyOut: 0,
                unitCostPaise: prod.avgCostPaise,
                runningBalance: restored,
                referenceType: 'CREDIT_NOTE',
                referenceNo: creditNoteNo,
                notes: `Stock reversed via Credit Note ${creditNoteNo} for ${inv.invoiceNo}: ${reason}`,
                userId: req.user!.id,
              });
            }
          }
        }

        await tx.update(invoices).set({ status: 'REVERSED' }).where(eq(invoices.id, inv.id));

        await recordAuditLog(tx, {
          user: req.user,
          action: 'CREDIT_NOTE_ISSUED',
          entity: 'Invoice',
          referenceId: creditNoteNo,
          previousValue: { invoiceNo: inv.invoiceNo, status: inv.status, grandTotalPaise: inv.grandTotalPaise },
          newValue: { creditNoteNo, status: 'REVERSED', reason },
        });

        return createdCn;
      });

      res.status(201).json(cn);
    } catch (error: unknown) {
      return handleRouteError(res, error, 'Credit note reversal failed', 400);
    }
  }
);

// ===================== PAYMENTS & RECEIVABLES =====================
salesAndFinanceRouter.get(
  '/payments',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'AUDITOR'),
  async (_req, res) => {
    try {
      await ensureSeeded();
    const [allPayments, allInvoices, allCustomers, allUsers] = await Promise.all([
      db.select().from(payments).orderBy(desc(payments.paymentDate), desc(payments.id)),
      db.select().from(invoices),
      db.select().from(customers),
      db.select().from(users),
    ]);

    const invMap = new Map(allInvoices.map((i) => [i.id, i]));
    const custMap = new Map(allCustomers.map((c) => [c.id, c]));
    const userMap = new Map(allUsers.map((u) => [u.id, u.name]));

    const today = new Date().toISOString().slice(0, 10);
    const activeInvoices = allInvoices.filter((i) => i.status !== 'REVERSED');
    let totalInvoicedPaise = 0;
    let totalCollectedPaise = 0;
    const ageing = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };

    const customerOutstandingMap = new Map<
      number,
      {
        customerId: number;
        customerName: string;
        state: string;
        invoicedPaise: number;
        collectedPaise: number;
        outstandingPaise: number;
        bucket0_30: number;
        bucket31_60: number;
        bucket61_90: number;
        bucket90Plus: number;
      }
    >();

    for (const inv of activeInvoices) {
      totalInvoicedPaise += inv.grandTotalPaise;
      totalCollectedPaise += inv.paidPaise;
      const out = Math.max(0, inv.grandTotalPaise - inv.paidPaise);
      const bucket = getAgeingBucket(inv.invoiceDate, today);
      if (out > 0) {
        ageing[bucket] += out;
      }

      const c = custMap.get(inv.customerId);
      const entry = customerOutstandingMap.get(inv.customerId) || {
        customerId: inv.customerId,
        customerName: c?.name || 'Unknown',
        state: c?.state || '',
        invoicedPaise: 0,
        collectedPaise: 0,
        outstandingPaise: 0,
        bucket0_30: 0,
        bucket31_60: 0,
        bucket61_90: 0,
        bucket90Plus: 0,
      };
      entry.invoicedPaise += inv.grandTotalPaise;
      entry.collectedPaise += inv.paidPaise;
      entry.outstandingPaise += out;
      if (out > 0) {
        if (bucket === '0-30') entry.bucket0_30 += out;
        else if (bucket === '31-60') entry.bucket31_60 += out;
        else if (bucket === '61-90') entry.bucket61_90 += out;
        else entry.bucket90Plus += out;
      }
      customerOutstandingMap.set(inv.customerId, entry);
    }

    res.json({
      summary: {
        totalInvoicedPaise,
        totalCollectedPaise,
        totalOutstandingPaise: Math.max(0, totalInvoicedPaise - totalCollectedPaise),
        ageing,
      },
      customerOutstanding: Array.from(customerOutstandingMap.values()),
      payments: allPayments.map((p) => ({
        ...p,
        invoiceNo: invMap.get(p.invoiceId)?.invoiceNo || '',
        customerName: custMap.get(p.customerId)?.name || 'Unknown',
        recordedByName: userMap.get(p.recordedById) || 'System',
      })),
    });
  } catch (error) {
    console.error('Failed to load payments:', error);
    return handleRouteError(res, error, 'Failed to load payments and receivables');
  }
});

const recordPaymentSchema = z.object({
  invoiceId: z.number().int().positive(),
  paymentDate: z.string().min(8),
  amountRupees: z.number().positive(),
  paymentMode: z.enum(['UPI', 'NEFT', 'RTGS', 'CHEQUE', 'CASH']),
  referenceNo: z.string().min(2),
  notes: z.string().optional().default(''),
});

salesAndFinanceRouter.post(
  '/payments',
  requireAuth,
  requireRole('ADMIN', 'OWNER'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = recordPaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payment entry' });
      }
      const data = parsed.data;
      const amountPaise = rupeesToPaise(data.amountRupees);

      const created = await db.transaction(async (tx) => {
        const [inv] = await tx.select().from(invoices).where(eq(invoices.id, data.invoiceId)).limit(1);
        if (!inv) throw new Error('Invoice not found');
        const paymentResult = applyInvoicePayment({
          grandTotalPaise: inv.grandTotalPaise,
          currentPaidPaise: inv.paidPaise,
          paymentAmountPaise: amountPaise,
          currentStatus: inv.status,
        });

        const existingPayments = await tx.select({ id: payments.id }).from(payments);
        const paymentNo = `PAY-2026-${String(existingPayments.length + 1).padStart(4, '0')}`;

        const [pay] = await tx
          .insert(payments)
          .values({
            paymentNo,
            invoiceId: inv.id,
            customerId: inv.customerId,
            paymentDate: data.paymentDate,
            amountPaise,
            paymentMode: data.paymentMode,
            referenceNo: data.referenceNo.trim(),
            notes: data.notes,
            status: 'POSTED',
            recordedById: req.user!.id,
          })
          .returning();

        await tx
          .update(invoices)
          .set({ paidPaise: paymentResult.newPaidPaise, status: paymentResult.newStatus })
          .where(eq(invoices.id, inv.id));

        await recordAuditLog(tx, {
          user: req.user,
          action: 'PAYMENT_RECORDED',
          entity: 'Payment',
          referenceId: paymentNo,
          previousValue: { invoiceNo: inv.invoiceNo, paidPaise: inv.paidPaise, status: inv.status },
          newValue: {
            invoiceNo: inv.invoiceNo,
            paidPaise: paymentResult.newPaidPaise,
            outstandingPaise: paymentResult.outstandingPaise,
            status: paymentResult.newStatus,
            amountPaise,
          },
        });

        return pay;
      });

      res.status(201).json(created);
    } catch (error: unknown) {
      return handleRouteError(res, error, 'Failed to record payment', 400);
    }
  }
);

// ===================== OWNER / OPERATIONS DASHBOARD =====================
salesAndFinanceRouter.get('/dashboard', requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureSeeded();
    const [
      rawOrders,
      rawInvoices,
      allInvoiceItems,
      allProducts,
      allRaws,
      allPacks,
      allRuns,
      allConsumptions,
      rawMovements,
      rawCustomers,
    ] = await Promise.all([
      db.select().from(orders).orderBy(desc(orders.createdAt)),
      db.select().from(invoices).orderBy(desc(invoices.createdAt)),
      db.select().from(invoiceItems),
      db.select().from(products),
      db.select().from(rawMaterials),
      db.select().from(packagingMaterials),
      db.select().from(productionRuns).orderBy(desc(productionRuns.createdAt)),
      db.select().from(productionConsumptions),
      db.select().from(inventoryMovements).orderBy(desc(inventoryMovements.createdAt)).limit(40),
      db.select().from(customers),
    ]);

    const isSalesman = req.user?.roleCode === 'SALESMAN';
    const allCustomers = isSalesman
      ? rawCustomers.filter((c) => c.assignedSalesmanId === req.user!.id)
      : rawCustomers;
    const assignedCustomerIds = new Set(allCustomers.map((c) => c.id));
    const allOrders = isSalesman
      ? rawOrders.filter((o) => o.salesmanId === req.user!.id)
      : rawOrders;
    const allInvoices = isSalesman
      ? rawInvoices.filter((inv) => assignedCustomerIds.has(inv.customerId))
      : rawInvoices;
    const allMovements = isSalesman
      ? rawMovements.filter((m) => m.itemCategory === 'FINISHED')
      : rawMovements;

    const todayStr = new Date().toISOString().slice(0, 10);
    const currentMonth = todayStr.slice(0, 7);
    const activeInvoices = allInvoices.filter((i) => i.status !== 'REVERSED');
    const custMap = new Map(allCustomers.map((c) => [c.id, c.name]));

    const todaysOrdersCount = allOrders.filter((o) => o.orderDate === todayStr).length;
    const pendingOrdersCount = allOrders.filter((o) => ['SUBMITTED', 'APPROVED'].includes(o.status)).length;
    const monthlySalesPaise = activeInvoices
      .filter((i) => i.invoiceDate.startsWith(currentMonth))
      .reduce((acc, i) => acc + i.grandTotalPaise, 0);
    const totalRevenuePaise = activeInvoices.reduce((acc, i) => acc + i.grandTotalPaise, 0);
    const totalOutstandingPaise = activeInvoices.reduce(
      (acc, i) => acc + Math.max(0, i.grandTotalPaise - i.paidPaise),
      0
    );

    const finishedGoodsStock = roundQty(allProducts.reduce((s, p) => s + p.currentStock, 0));
    const rawMaterialStockKgL = roundQty(allRaws.reduce((s, r) => s + r.currentStock, 0));
    const lowStockAlerts = [
      ...allRaws
        .filter((r) => r.currentStock <= r.minStockLevel)
        .map((r) => ({ name: r.name, stock: r.currentStock, min: r.minStockLevel, unit: r.unit, category: 'Raw' })),
      ...allPacks
        .filter((p) => p.currentStock <= p.minStockLevel)
        .map((p) => ({
          name: p.name,
          stock: p.currentStock,
          min: p.minStockLevel,
          unit: p.unit,
          category: 'Packaging',
        })),
      ...allProducts
        .filter((p) => p.currentStock <= p.minStockLevel)
        .map((p) => ({
          name: p.name,
          stock: p.currentStock,
          min: p.minStockLevel,
          unit: p.unit,
          category: 'Finished',
        })),
    ];

    const completedRuns = allRuns.filter((r) => r.status === 'COMPLETED');
    const totalExpected = completedRuns.reduce((s, r) => s + r.expectedOutputQty, 0);
    const totalActualGood = completedRuns.reduce((s, r) => s + r.actualGoodOutputQty, 0);
    const totalWastage = completedRuns.reduce((s, r) => s + r.wastageQty, 0);
    const productionYieldPct = totalExpected > 0 ? Math.round((totalActualGood / totalExpected) * 10000) / 100 : 0;
    const wastagePct = totalExpected > 0 ? Math.round((totalWastage / totalExpected) * 10000) / 100 : 0;
    const totalProdCost = completedRuns.reduce((s, r) => s + r.totalCostPaise, 0);
    const avgCostPerPacketPaise = totalActualGood > 0 ? Math.round(totalProdCost / totalActualGood) : 0;

    // Chart 1: Monthly sales trend
    const monthSalesMap = new Map<string, number>();
    for (const inv of activeInvoices) {
      const m = inv.invoiceDate.slice(0, 7);
      monthSalesMap.set(m, (monthSalesMap.get(m) || 0) + inv.grandTotalPaise);
    }
    const monthlySalesTrend = Array.from(monthSalesMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, paise]) => ({ month, salesRupees: Math.round(paise) / 100 }));

    // Chart 2: Product-wise sales
    const activeInvIds = new Set(activeInvoices.map((i) => i.id));
    const prodSalesMap = new Map<string, { name: string; salesRupees: number; qty: number }>();
    for (const ii of allInvoiceItems) {
      if (!activeInvIds.has(ii.invoiceId)) continue;
      const cur = prodSalesMap.get(ii.productName) || { name: ii.productName, salesRupees: 0, qty: 0 };
      cur.salesRupees = Math.round((cur.salesRupees + ii.lineTotalPaise / 100) * 100) / 100;
      cur.qty = roundQty(cur.qty + ii.quantity);
      prodSalesMap.set(ii.productName, cur);
    }

    // Chart 3: Production vs Sales (by product packets)
    const prodMap = new Map(allProducts.map((p) => [p.id, p.name]));
    const prodVsSalesMap = new Map<string, { product: string; producedQty: number; soldQty: number }>();
    for (const p of allProducts) {
      prodVsSalesMap.set(p.name, { product: p.name, producedQty: 0, soldQty: 0 });
    }
    for (const r of completedRuns) {
      const name = prodMap.get(r.productId) || 'Product';
      const entry = prodVsSalesMap.get(name) || { product: name, producedQty: 0, soldQty: 0 };
      entry.producedQty = roundQty(entry.producedQty + r.actualGoodOutputQty);
      prodVsSalesMap.set(name, entry);
    }
    for (const ii of allInvoiceItems) {
      if (!activeInvIds.has(ii.invoiceId)) continue;
      const entry = prodVsSalesMap.get(ii.productName) || { product: ii.productName, producedQty: 0, soldQty: 0 };
      entry.soldQty = roundQty(entry.soldQty + ii.quantity);
      prodVsSalesMap.set(ii.productName, entry);
    }

    // Chart 4: Raw material planned vs actual consumption
    const rmConsMap = new Map<string, { material: string; planned: number; actual: number; unit: string }>();
    for (const c of allConsumptions.filter((x) => x.materialCategory === 'RAW')) {
      const cur = rmConsMap.get(c.materialName) || {
        material: c.materialName,
        planned: 0,
        actual: 0,
        unit: c.unit,
      };
      cur.planned = roundQty(cur.planned + c.plannedQty);
      cur.actual = roundQty(cur.actual + c.actualQty);
      rmConsMap.set(c.materialName, cur);
    }

    // Chart 5: Stock movement summary (In vs Out by movement type)
    const movTypeMap = new Map<string, { type: string; qtyIn: number; qtyOut: number }>();
    for (const m of allMovements) {
      const cur = movTypeMap.get(m.movementType) || { type: m.movementType, qtyIn: 0, qtyOut: 0 };
      cur.qtyIn = roundQty(cur.qtyIn + m.qtyIn);
      cur.qtyOut = roundQty(cur.qtyOut + m.qtyOut);
      movTypeMap.set(m.movementType, cur);
    }

    // Chart 6: Outstanding payments by customer
    const outByCustMap = new Map<string, { customer: string; collectedRupees: number; outstandingRupees: number }>();
    for (const inv of activeInvoices) {
      const name = custMap.get(inv.customerId) || 'Customer';
      const cur = outByCustMap.get(name) || { customer: name, collectedRupees: 0, outstandingRupees: 0 };
      cur.collectedRupees = Math.round((cur.collectedRupees + inv.paidPaise / 100) * 100) / 100;
      cur.outstandingRupees =
        Math.round((cur.outstandingRupees + Math.max(0, inv.grandTotalPaise - inv.paidPaise) / 100) * 100) / 100;
      outByCustMap.set(name, cur);
    }

    res.json({
      kpis: {
        todaysOrdersCount,
        totalOrdersCount: allOrders.length,
        monthlySalesPaise,
        totalRevenuePaise,
        pendingOrdersCount,
        finishedGoodsStock,
        rawMaterialStockKgL,
        lowStockCount: lowStockAlerts.length,
        productionRunsCount: completedRuns.length,
        productionYieldPct,
        wastagePct,
        avgCostPerPacketPaise,
        totalOutstandingPaise,
      },
      lowStockAlerts,
      benchmarkSnapshot: {
        rawMaterials: allRaws.map((r) => ({
          code: r.code,
          name: r.name,
          currentStock: r.currentStock,
          unit: r.unit,
          weightedAvgRatePaise: r.weightedAvgRatePaise,
        })),
        packagingMaterials: allPacks.map((p) => ({
          code: p.code,
          name: p.name,
          currentStock: p.currentStock,
          unit: p.unit,
          weightedAvgRatePaise: p.weightedAvgRatePaise,
        })),
        finishedGoods: allProducts.map((p) => ({
          sku: p.sku,
          name: p.name,
          currentStock: p.currentStock,
          unit: p.unit,
          avgCostPaise: p.avgCostPaise,
          sellingPricePaise: p.sellingPricePaise,
        })),
      },
      charts: {
        monthlySalesTrend,
        productWiseSales: Array.from(prodSalesMap.values()),
        productionVsSales: Array.from(prodVsSalesMap.values()),
        rawMaterialConsumption: Array.from(rmConsMap.values()),
        stockMovements: Array.from(movTypeMap.values()),
        outstandingPayments: Array.from(outByCustMap.values()),
      },
      recentTransactions: allMovements.slice(0, 10),
    });
  } catch (error) {
    console.error('Dashboard load failed:', error);
    return handleRouteError(res, error, 'Failed to load dashboard analytics');
  }
});

// ===================== 15 AUDITOR REPORTS =====================
salesAndFinanceRouter.get(
  '/reports/:reportKey',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'AUDITOR'),
  async (req, res) => {
    try {
      await ensureSeeded();
    const key = req.params.reportKey;
    const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : '2000-01-01';
    const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : '2099-12-31';

    const inRange = (d: string) => d >= from && d <= to;

    const [
      allInvoices,
      allInvoiceItems,
      allCustomers,
      allProducts,
      allPurchases,
      allPurchaseItems,
      allSuppliers,
      allRaws,
      allPacks,
      allMovements,
      allRuns,
      allConsumptions,
      allPayments,
      allUsers,
    ] = await Promise.all([
      db.select().from(invoices).orderBy(desc(invoices.invoiceDate)),
      db.select().from(invoiceItems),
      db.select().from(customers),
      db.select().from(products),
      db.select().from(purchases).orderBy(desc(purchases.purchaseDate)),
      db.select().from(purchaseItems),
      db.select().from(suppliers),
      db.select().from(rawMaterials),
      db.select().from(packagingMaterials),
      db.select().from(inventoryMovements).orderBy(desc(inventoryMovements.createdAt)),
      db.select().from(productionRuns).orderBy(desc(productionRuns.runDate)),
      db.select().from(productionConsumptions),
      db.select().from(payments).orderBy(desc(payments.paymentDate)),
      db.select().from(users),
    ]);

    const custMap = new Map(allCustomers.map((c) => [c.id, c]));
    const supMap = new Map(allSuppliers.map((s) => [s.id, s]));
    const prodMap = new Map(allProducts.map((p) => [p.id, p]));
    const runMap = new Map(allRuns.map((r) => [r.id, r]));
    const invMap = new Map(allInvoices.map((i) => [i.id, i]));
    const userMap = new Map(allUsers.map((u) => [u.id, u.name]));

    let title = '';
    let disclaimer = '';
    let columns: string[] = [];
    let rows: Record<string, string | number>[] = [];

    switch (key) {
      case 'sales-register': {
        title = 'Sales Register';
        columns = [
          'Invoice No',
          'Date',
          'Customer',
          'GSTIN',
          'Supply Type',
          'Taxable (INR)',
          'CGST (INR)',
          'SGST (INR)',
          'IGST (INR)',
          'Grand Total (INR)',
          'Status',
        ];
        rows = allInvoices
          .filter((i) => inRange(i.invoiceDate))
          .map((i) => {
            const c = custMap.get(i.customerId);
            return {
              'Invoice No': i.invoiceNo,
              Date: i.invoiceDate,
              Customer: c?.name || '',
              GSTIN: c?.gstin || '',
              'Supply Type': i.supplyType,
              'Taxable (INR)': i.taxableValuePaise / 100,
              'CGST (INR)': i.cgstPaise / 100,
              'SGST (INR)': i.sgstPaise / 100,
              'IGST (INR)': i.igstPaise / 100,
              'Grand Total (INR)': i.grandTotalPaise / 100,
              Status: i.status,
            };
          });
        break;
      }

      case 'customer-sales': {
        title = 'Customer-wise Sales';
        columns = ['Customer', 'Type', 'State', 'Invoices', 'Taxable (INR)', 'Total Tax (INR)', 'Total Sales (INR)'];
        const map = new Map<number, { count: number; taxable: number; tax: number; total: number }>();
        for (const i of allInvoices.filter((x) => x.status !== 'REVERSED' && inRange(x.invoiceDate))) {
          const cur = map.get(i.customerId) || { count: 0, taxable: 0, tax: 0, total: 0 };
          cur.count += 1;
          cur.taxable += i.taxableValuePaise;
          cur.tax += i.cgstPaise + i.sgstPaise + i.igstPaise;
          cur.total += i.grandTotalPaise;
          map.set(i.customerId, cur);
        }
        rows = Array.from(map.entries()).map(([cid, v]) => {
          const c = custMap.get(cid);
          return {
            Customer: c?.name || '',
            Type: c?.customerType || '',
            State: c?.state || '',
            Invoices: v.count,
            'Taxable (INR)': v.taxable / 100,
            'Total Tax (INR)': v.tax / 100,
            'Total Sales (INR)': v.total / 100,
          };
        });
        break;
      }

      case 'product-sales': {
        title = 'Product-wise Sales';
        columns = ['Product', 'HSN', 'Qty Sold', 'Unit', 'Taxable (INR)', 'GST (INR)', 'Total Revenue (INR)'];
        const validIds = new Set(
          allInvoices.filter((i) => i.status !== 'REVERSED' && inRange(i.invoiceDate)).map((i) => i.id)
        );
        const map = new Map<string, { hsn: string; qty: number; unit: string; taxable: number; gst: number; total: number }>();
        for (const ii of allInvoiceItems.filter((x) => validIds.has(x.invoiceId))) {
          const cur = map.get(ii.productName) || {
            hsn: ii.hsnCode,
            qty: 0,
            unit: ii.unit,
            taxable: 0,
            gst: 0,
            total: 0,
          };
          cur.qty = roundQty(cur.qty + ii.quantity);
          cur.taxable += ii.taxableValuePaise;
          cur.gst += ii.cgstPaise + ii.sgstPaise + ii.igstPaise;
          cur.total += ii.lineTotalPaise;
          map.set(ii.productName, cur);
        }
        rows = Array.from(map.entries()).map(([name, v]) => ({
          Product: name,
          HSN: v.hsn,
          'Qty Sold': v.qty,
          Unit: v.unit,
          'Taxable (INR)': v.taxable / 100,
          'GST (INR)': v.gst / 100,
          'Total Revenue (INR)': v.total / 100,
        }));
        break;
      }

      case 'gst-summary': {
        title = 'GST Summary (GSTR-1 & GSTR-3B Reconciliation Aid)';
        disclaimer =
          'Reporting Aid Only: This GST summary is structured to assist reconciliation with GSTR-1 (Outward Supplies) and GSTR-3B (Tax Liability & Input Tax Credit). It is not a direct GST portal filing.';
        columns = [
          'Category',
          'Supply / Nature',
          'Doc Count',
          'Taxable Value (INR)',
          'CGST (INR)',
          'SGST (INR)',
          'IGST (INR)',
          'Total Tax (INR)',
        ];
        const validInv = allInvoices.filter((i) => i.status !== 'REVERSED' && inRange(i.invoiceDate));
        const intra = validInv.filter((i) => i.supplyType === 'INTRA_STATE');
        const inter = validInv.filter((i) => i.supplyType === 'INTER_STATE');
        const validPo = allPurchases.filter((p) => p.status === 'RECEIVED' && inRange(p.purchaseDate));

        const sum = <T,>(arr: T[], fn: (x: T) => number) => arr.reduce((a, b) => a + fn(b), 0);
        const itcGst = sum(validPo, (p) => p.gstPaise);
        rows = [
          {
            Category: 'GSTR-1 Outward B2B',
            'Supply / Nature': 'Intra-State (Tamil Nadu)',
            'Doc Count': intra.length,
            'Taxable Value (INR)': sum(intra, (i) => i.taxableValuePaise) / 100,
            'CGST (INR)': sum(intra, (i) => i.cgstPaise) / 100,
            'SGST (INR)': sum(intra, (i) => i.sgstPaise) / 100,
            'IGST (INR)': 0,
            'Total Tax (INR)': sum(intra, (i) => i.cgstPaise + i.sgstPaise) / 100,
          },
          {
            Category: 'GSTR-1 Outward B2B',
            'Supply / Nature': 'Inter-State (Other States)',
            'Doc Count': inter.length,
            'Taxable Value (INR)': sum(inter, (i) => i.taxableValuePaise) / 100,
            'CGST (INR)': 0,
            'SGST (INR)': 0,
            'IGST (INR)': sum(inter, (i) => i.igstPaise) / 100,
            'Total Tax (INR)': sum(inter, (i) => i.igstPaise) / 100,
          },
          {
            Category: 'GSTR-3B Eligible ITC',
            'Supply / Nature': 'Inward Raw/Packaging Purchases',
            'Doc Count': validPo.length,
            'Taxable Value (INR)': sum(validPo, (p) => p.subtotalPaise) / 100,
            'CGST (INR)': Math.floor(itcGst / 2) / 100,
            'SGST (INR)': (itcGst - Math.floor(itcGst / 2)) / 100,
            'IGST (INR)': 0,
            'Total Tax (INR)': itcGst / 100,
          },
        ];
        break;
      }

      case 'purchase-register': {
        title = 'Purchase Register';
        columns = ['PO No', 'Date', 'Supplier', 'Supplier GSTIN', 'Bill Ref', 'Subtotal (INR)', 'GST (INR)', 'Total (INR)', 'Status'];
        rows = allPurchases
          .filter((p) => inRange(p.purchaseDate))
          .map((p) => {
            const s = supMap.get(p.supplierId);
            return {
              'PO No': p.purchaseNo,
              Date: p.purchaseDate,
              Supplier: s?.name || '',
              'Supplier GSTIN': s?.gstin || '',
              'Bill Ref': p.invoiceRef,
              'Subtotal (INR)': p.subtotalPaise / 100,
              'GST (INR)': p.gstPaise / 100,
              'Total (INR)': p.totalPaise / 100,
              Status: p.status,
            };
          });
        break;
      }

      case 'raw-stock': {
        title = 'Raw Material Stock Summary';
        columns = ['Code', 'Material', 'Closing Stock', 'Unit', 'Min Level', 'Weighted Avg Rate (INR)', 'Valuation (INR)', 'Alert'];
        rows = allRaws.map((r) => ({
          Code: r.code,
          Material: r.name,
          'Closing Stock': r.currentStock,
          Unit: r.unit,
          'Min Level': r.minStockLevel,
          'Weighted Avg Rate (INR)': r.weightedAvgRatePaise / 100,
          'Valuation (INR)': r.totalValuationPaise / 100,
          Alert: r.currentStock <= r.minStockLevel ? 'LOW STOCK' : 'NOMINAL',
        }));
        break;
      }

      case 'packaging-stock': {
        title = 'Packaging Stock Summary';
        columns = ['Code', 'Material', 'Closing Stock', 'Unit', 'Min Level', 'Weighted Avg Rate (INR)', 'Valuation (INR)', 'Alert'];
        rows = allPacks.map((p) => ({
          Code: p.code,
          Material: p.name,
          'Closing Stock': p.currentStock,
          Unit: p.unit,
          'Min Level': p.minStockLevel,
          'Weighted Avg Rate (INR)': p.weightedAvgRatePaise / 100,
          'Valuation (INR)': p.totalValuationPaise / 100,
          Alert: p.currentStock <= p.minStockLevel ? 'LOW STOCK' : 'NOMINAL',
        }));
        break;
      }

      case 'finished-stock': {
        title = 'Finished Goods Stock Summary';
        columns = ['SKU', 'Product', 'Pack Size', 'HSN', 'Closing Stock', 'Unit', 'Avg Cost (INR)', 'Selling Price (INR)', 'Stock Value (INR)'];
        rows = allProducts.map((p) => ({
          SKU: p.sku,
          Product: p.name,
          'Pack Size': p.packSize,
          HSN: p.hsnCode,
          'Closing Stock': p.currentStock,
          Unit: p.unit,
          'Avg Cost (INR)': p.avgCostPaise / 100,
          'Selling Price (INR)': p.sellingPricePaise / 100,
          'Stock Value (INR)': Math.round(p.currentStock * p.avgCostPaise) / 100,
        }));
        break;
      }

      case 'stock-ledger': {
        title = 'Permanent Stock Ledger';
        columns = ['Transaction ID', 'Date', 'Category', 'Item', 'Movement', 'Qty In', 'Qty Out', 'Running Balance', 'Unit', 'Reference', 'User'];
        rows = allMovements
          .filter((m) => inRange(m.createdAt.toISOString().slice(0, 10)))
          .map((m) => ({
            'Transaction ID': m.transactionId,
            Date: m.createdAt.toISOString().slice(0, 16).replace('T', ' '),
            Category: m.itemCategory,
            Item: m.itemName,
            Movement: m.movementType,
            'Qty In': m.qtyIn,
            'Qty Out': m.qtyOut,
            'Running Balance': m.runningBalance,
            Unit: m.unit,
            Reference: m.referenceNo,
            User: userMap.get(m.userId) || 'System',
          }));
        break;
      }

      case 'production-report': {
        title = 'Production Report';
        columns = ['Run No', 'Date', 'Product', 'Batches', 'Expected Output', 'Actual Good', 'Yield Var %', 'Damaged Pack', 'Total Cost (INR)', 'Cost/Pkt (INR)'];
        rows = allRuns
          .filter((r) => inRange(r.runDate))
          .map((r) => ({
            'Run No': r.runNo,
            Date: r.runDate,
            Product: prodMap.get(r.productId)?.name || '',
            Batches: r.batchQty,
            'Expected Output': r.expectedOutputQty,
            'Actual Good': r.actualGoodOutputQty,
            'Yield Var %': r.yieldVariancePct,
            'Damaged Pack': r.damagedPackagingQty,
            'Total Cost (INR)': r.totalCostPaise / 100,
            'Cost/Pkt (INR)': r.costPerPacketPaise / 100,
          }));
        break;
      }

      case 'planned-vs-actual': {
        title = 'Planned vs Actual Material Consumption';
        columns = ['Run No', 'Date', 'Category', 'Material', 'Planned', 'Actual Issued', 'Damaged', 'Unit', 'Variance %', 'Alert', 'Cost (INR)'];
        rows = allConsumptions
          .filter((c) => {
            const run = runMap.get(c.productionRunId);
            return run ? inRange(run.runDate) : true;
          })
          .map((c) => {
            const run = runMap.get(c.productionRunId);
            return {
              'Run No': run?.runNo || '',
              Date: run?.runDate || '',
              Category: c.materialCategory,
              Material: c.materialName,
              Planned: c.plannedQty,
              'Actual Issued': c.actualQty,
              Damaged: c.damagedQty,
              Unit: c.unit,
              'Variance %': c.variancePct,
              Alert: c.isFlagged ? 'EXCEEDS TOLERANCE' : 'WITHIN TOLERANCE',
              'Cost (INR)': c.totalCostPaise / 100,
            };
          });
        break;
      }

      case 'yield-wastage': {
        title = 'Yield and Wastage Report';
        columns = ['Run No', 'Date', 'Product', 'Expected', 'Actual Good', 'Wastage Qty', 'Damaged Pouches', 'Yield %', 'Yield Variance %', 'Alert'];
        rows = allRuns
          .filter((r) => inRange(r.runDate))
          .map((r) => ({
            'Run No': r.runNo,
            Date: r.runDate,
            Product: prodMap.get(r.productId)?.name || '',
            Expected: r.expectedOutputQty,
            'Actual Good': r.actualGoodOutputQty,
            'Wastage Qty': r.wastageQty,
            'Damaged Pouches': r.damagedPackagingQty,
            'Yield %': r.expectedOutputQty > 0 ? Math.round((r.actualGoodOutputQty / r.expectedOutputQty) * 10000) / 100 : 0,
            'Yield Variance %': r.yieldVariancePct,
            Alert: r.hasVarianceAlert ? 'VARIANCE ALERT' : 'NOMINAL',
          }));
        break;
      }

      case 'product-costing': {
        title = 'Product Costing Report (Weighted Average Method)';
        columns = [
          'Run No',
          'Date',
          'Product',
          'Raw Material (INR)',
          'Packaging (INR)',
          'Labour (INR)',
          'Gas/Power (INR)',
          'Overheads (INR)',
          'Total Cost (INR)',
          'Good Pkts',
          'Cost/Pkt (INR)',
          'Selling Price (INR)',
          'Gross Margin %',
        ];
        rows = allRuns
          .filter((r) => inRange(r.runDate))
          .map((r) => {
            const p = prodMap.get(r.productId);
            const sp = p?.sellingPricePaise || 0;
            const gmPct = sp > 0 ? Math.round(((sp - r.costPerPacketPaise) / sp) * 10000) / 100 : 0;
            return {
              'Run No': r.runNo,
              Date: r.runDate,
              Product: p?.name || '',
              'Raw Material (INR)': r.rawMaterialCostPaise / 100,
              'Packaging (INR)': r.packagingCostPaise / 100,
              'Labour (INR)': r.labourCostPaise / 100,
              'Gas/Power (INR)': r.gasPowerCostPaise / 100,
              'Overheads (INR)': r.otherOverheadPaise / 100,
              'Total Cost (INR)': r.totalCostPaise / 100,
              'Good Pkts': r.actualGoodOutputQty,
              'Cost/Pkt (INR)': r.costPerPacketPaise / 100,
              'Selling Price (INR)': sp / 100,
              'Gross Margin %': gmPct,
            };
          });
        break;
      }

      case 'payments-collections': {
        title = 'Payments and Collections Report';
        columns = ['Payment No', 'Date', 'Invoice No', 'Customer', 'Mode', 'Reference', 'Amount (INR)', 'Status'];
        rows = allPayments
          .filter((p) => inRange(p.paymentDate))
          .map((p) => ({
            'Payment No': p.paymentNo,
            Date: p.paymentDate,
            'Invoice No': invMap.get(p.invoiceId)?.invoiceNo || '',
            Customer: custMap.get(p.customerId)?.name || '',
            Mode: p.paymentMode,
            Reference: p.referenceNo,
            'Amount (INR)': p.amountPaise / 100,
            Status: p.status,
          }));
        break;
      }

      case 'customer-outstanding': {
        title = 'Customer Outstanding & Ageing Report';
        columns = ['Customer', 'State', 'Invoiced (INR)', 'Collected (INR)', 'Outstanding (INR)', '0-30 Days', '31-60 Days', '61-90 Days', '90+ Days'];
        const today = new Date().toISOString().slice(0, 10);
        const map = new Map<
          number,
          { inv: number; col: number; out: number; b0: number; b31: number; b61: number; b90: number }
        >();
        for (const i of allInvoices.filter((x) => x.status !== 'REVERSED' && inRange(x.invoiceDate))) {
          const cur = map.get(i.customerId) || { inv: 0, col: 0, out: 0, b0: 0, b31: 0, b61: 0, b90: 0 };
          const out = Math.max(0, i.grandTotalPaise - i.paidPaise);
          cur.inv += i.grandTotalPaise;
          cur.col += i.paidPaise;
          cur.out += out;
          if (out > 0) {
            const b = getAgeingBucket(i.invoiceDate, today);
            if (b === '0-30') cur.b0 += out;
            else if (b === '31-60') cur.b31 += out;
            else if (b === '61-90') cur.b61 += out;
            else cur.b90 += out;
          }
          map.set(i.customerId, cur);
        }
        rows = Array.from(map.entries()).map(([cid, v]) => {
          const c = custMap.get(cid);
          return {
            Customer: c?.name || '',
            State: c?.state || '',
            'Invoiced (INR)': v.inv / 100,
            'Collected (INR)': v.col / 100,
            'Outstanding (INR)': v.out / 100,
            '0-30 Days': v.b0 / 100,
            '31-60 Days': v.b31 / 100,
            '61-90 Days': v.b61 / 100,
            '90+ Days': v.b90 / 100,
          };
        });
        break;
      }

      default:
        return res.status(404).json({ error: `Unknown report key: ${key}` });
    }

    void allPurchaseItems;
    res.json({ key, title, disclaimer, from, to, columns, rows });
  } catch (error) {
    console.error('Report generation failed:', error);
    return handleRouteError(res, error, 'Failed to generate report');
  }
});
