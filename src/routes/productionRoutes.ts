import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import {
  boms,
  bomItems,
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
  multiplyQtyPaise,
  applyWeightedAverageReceipt,
  applyWeightedAverageIssue,
  calculateConsumptionVariancePct,
  calculateYieldVariancePct,
  isVarianceExceeded,
  calculateProductionCostSummary,
  convertUnit,
  roundQty,
} from '../utils/erpMath.ts';

export const productionRouter = Router();

// ===================== BILL OF MATERIALS =====================
productionRouter.get(
  '/boms',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'AUDITOR'),
  async (_req, res) => {
    try {
      await ensureSeeded();
    const [allBoms, allItems, allProducts, allRaws, allPacks] = await Promise.all([
      db.select().from(boms).orderBy(boms.id),
      db.select().from(bomItems).orderBy(bomItems.id),
      db.select().from(products),
      db.select().from(rawMaterials),
      db.select().from(packagingMaterials),
    ]);

    const prodMap = new Map(allProducts.map((p) => [p.id, p]));
    const rawMap = new Map(allRaws.map((r) => [r.id, r]));
    const packMap = new Map(allPacks.map((p) => [p.id, p]));

    const enriched = allBoms.map((b) => {
      const prod = prodMap.get(b.productId);
      const items = allItems
        .filter((i) => i.bomId === b.id)
        .map((i) => {
          const mat =
            i.materialCategory === 'RAW'
              ? rawMap.get(i.rawMaterialId || 0)
              : packMap.get(i.packagingMaterialId || 0);
          return {
            ...i,
            materialName: mat?.name || 'Unknown Material',
            materialCode: mat?.code || '',
            currentStock: mat?.currentStock ?? 0,
            stockUnit: mat?.unit || i.unit,
            weightedAvgRatePaise: mat?.weightedAvgRatePaise ?? 0,
          };
        });
      return {
        ...b,
        productName: prod?.name || 'Unknown Product',
        productSku: prod?.sku || '',
        sellingPricePaise: prod?.sellingPricePaise ?? 0,
        items,
      };
    });

    res.json(enriched);
  } catch (error) {
    console.error('Failed to fetch BOMs:', error);
    return handleRouteError(res, error, 'Failed to load Bills of Materials');
  }
});

const bomCreateSchema = z.object({
  code: z.string().min(2),
  productId: z.number().int().positive(),
  name: z.string().min(2),
  batchSize: z.number().positive().default(1),
  expectedOutputQty: z.number().positive(),
  outputUnit: z.string().default('packets'),
  standardWastageTolerancePct: z.number().min(0).max(25).default(3),
  standardLabourRupees: z.number().min(0).default(600),
  standardGasPowerRupees: z.number().min(0).default(350),
  standardOverheadRupees: z.number().min(0).default(150),
  items: z
    .array(
      z.object({
        materialCategory: z.enum(['RAW', 'PACKAGING']),
        rawMaterialId: z.number().int().positive().nullable().optional(),
        packagingMaterialId: z.number().int().positive().nullable().optional(),
        standardQty: z.number().positive(),
        unit: z.string().min(1),
        wastageTolerancePct: z.number().min(0).max(25).default(3),
      })
    )
    .min(1),
});

productionRouter.post(
  '/boms',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = bomCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid BOM definition' });
      }
      const data = parsed.data;

      const created = await db.transaction(async (tx) => {
        const [bom] = await tx
          .insert(boms)
          .values({
            code: data.code.trim().toUpperCase(),
            productId: data.productId,
            name: data.name.trim(),
            batchSize: data.batchSize,
            expectedOutputQty: data.expectedOutputQty,
            outputUnit: data.outputUnit,
            standardWastageTolerancePct: data.standardWastageTolerancePct,
            standardLabourCostPaise: rupeesToPaise(data.standardLabourRupees),
            standardGasPowerCostPaise: rupeesToPaise(data.standardGasPowerRupees),
            standardOverheadCostPaise: rupeesToPaise(data.standardOverheadRupees),
          })
          .returning();

        for (const item of data.items) {
          await tx.insert(bomItems).values({
            bomId: bom.id,
            materialCategory: item.materialCategory,
            rawMaterialId: item.materialCategory === 'RAW' ? item.rawMaterialId ?? null : null,
            packagingMaterialId:
              item.materialCategory === 'PACKAGING' ? item.packagingMaterialId ?? null : null,
            standardQty: item.standardQty,
            unit: item.unit,
            wastageTolerancePct: item.wastageTolerancePct,
          });
        }

        await recordAuditLog(tx, {
          user: req.user,
          action: 'BOM_CREATED',
          entity: 'BOM',
          referenceId: bom.code,
          newValue: { name: bom.name, expectedOutputQty: bom.expectedOutputQty, itemCount: data.items.length },
        });
        return bom;
      });

      res.status(201).json(created);
    } catch (error) {
      console.error('Create BOM failed:', error);
      return handleRouteError(res, error, 'Failed to create BOM (BOM code may already exist)');
    }
  }
);

// ===================== PURCHASES =====================
productionRouter.get(
  '/purchases',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'AUDITOR'),
  async (_req, res) => {
    try {
      await ensureSeeded();
    const [allPurchases, allItems, allSuppliers, allRaws, allPacks, allUsers] = await Promise.all([
      db.select().from(purchases).orderBy(desc(purchases.purchaseDate), desc(purchases.id)),
      db.select().from(purchaseItems),
      db.select().from(suppliers),
      db.select().from(rawMaterials),
      db.select().from(packagingMaterials),
      db.select().from(users),
    ]);

    const supMap = new Map(allSuppliers.map((s) => [s.id, s]));
    const rawMap = new Map(allRaws.map((r) => [r.id, r]));
    const packMap = new Map(allPacks.map((p) => [p.id, p]));
    const userMap = new Map(allUsers.map((u) => [u.id, u.name]));

    res.json(
      allPurchases.map((p) => ({
        ...p,
        supplierName: supMap.get(p.supplierId)?.name || 'Unknown Supplier',
        supplierGstin: supMap.get(p.supplierId)?.gstin || '',
        createdByName: userMap.get(p.createdById) || 'System',
        items: allItems
          .filter((i) => i.purchaseId === p.id)
          .map((i) => {
            const mat =
              i.materialCategory === 'RAW'
                ? rawMap.get(i.rawMaterialId || 0)
                : packMap.get(i.packagingMaterialId || 0);
            return {
              ...i,
              materialName: mat?.name || 'Unknown',
              materialCode: mat?.code || '',
            };
          }),
      }))
    );
  } catch (error) {
    console.error('Failed to load purchases:', error);
    return handleRouteError(res, error, 'Failed to load purchases');
  }
});

const createPurchaseSchema = z.object({
  supplierId: z.number().int().positive(),
  purchaseDate: z.string().min(8),
  invoiceRef: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  items: z
    .array(
      z.object({
        materialCategory: z.enum(['RAW', 'PACKAGING']),
        materialId: z.number().int().positive(),
        quantity: z.number().positive(),
        unit: z.string().min(1),
        rateRupees: z.number().positive(),
        gstPct: z.number().min(0).max(28).default(5),
      })
    )
    .min(1),
});

productionRouter.post(
  '/purchases',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = createPurchaseSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid purchase payload' });
      }
      const data = parsed.data;

      const created = await db.transaction(async (tx) => {
        const supplierRows = await tx
          .select()
          .from(suppliers)
          .where(eq(suppliers.id, data.supplierId))
          .limit(1);
        if (supplierRows.length === 0) {
          throw new Error('Selected supplier not found');
        }
        if (!supplierRows[0].isActive) {
          throw new Error(`Supplier "${supplierRows[0].name}" is inactive. Reactivate the supplier before posting new purchases.`);
        }

        const existingPos = await tx.select({ id: purchases.id }).from(purchases);
        const purchaseNo = `PO-2026-${String(existingPos.length + 1).padStart(4, '0')}`;

        let subtotalPaise = 0;
        let gstPaise = 0;

        const preparedItems = data.items.map((item) => {
          const ratePaise = rupeesToPaise(item.rateRupees);
          const lineSub = multiplyQtyPaise(item.quantity, ratePaise);
          const lineGst = Math.round((lineSub * Math.round(item.gstPct * 100)) / 10000);
          subtotalPaise += lineSub;
          gstPaise += lineGst;
          return {
            ...item,
            ratePaise,
            lineTotalPaise: lineSub + lineGst,
          };
        });

        const totalPaise = subtotalPaise + gstPaise;
        const [po] = await tx
          .insert(purchases)
          .values({
            purchaseNo,
            supplierId: data.supplierId,
            purchaseDate: data.purchaseDate,
            invoiceRef: data.invoiceRef,
            status: 'RECEIVED',
            subtotalPaise,
            gstPaise,
            totalPaise,
            notes: data.notes,
            createdById: req.user!.id,
          })
          .returning();

        for (const item of preparedItems) {
          await tx.insert(purchaseItems).values({
            purchaseId: po.id,
            materialCategory: item.materialCategory,
            rawMaterialId: item.materialCategory === 'RAW' ? item.materialId : null,
            packagingMaterialId: item.materialCategory === 'PACKAGING' ? item.materialId : null,
            quantity: item.quantity,
            unit: item.unit,
            ratePaise: item.ratePaise,
            gstPct: item.gstPct,
            lineTotalPaise: item.lineTotalPaise,
          });

          if (item.materialCategory === 'RAW') {
            const [rm] = await tx.select().from(rawMaterials).where(eq(rawMaterials.id, item.materialId)).limit(1);
            if (!rm) throw new Error('Raw material not found');
            const convertedQty = convertUnit(item.quantity, item.unit, rm.unit);
            const calc = applyWeightedAverageReceipt({
              currentStock: rm.currentStock,
              currentValuationPaise: rm.totalValuationPaise,
              receiptQty: convertedQty,
              receiptRatePaise: item.ratePaise,
            });
            await tx
              .update(rawMaterials)
              .set({
                currentStock: calc.newStock,
                totalValuationPaise: calc.newValuationPaise,
                weightedAvgRatePaise: calc.newWeightedAvgRatePaise,
              })
              .where(eq(rawMaterials.id, rm.id));

            await tx.insert(inventoryMovements).values({
              transactionId: generateTxnId('TXN-PO'),
              itemCategory: 'RAW',
              rawMaterialId: rm.id,
              itemName: rm.name,
              unit: rm.unit,
              movementType: 'PURCHASE',
              qtyIn: convertedQty,
              qtyOut: 0,
              unitCostPaise: item.ratePaise,
              runningBalance: calc.newStock,
              referenceType: 'PURCHASE',
              referenceNo: purchaseNo,
              notes: `Purchase receipt ${purchaseNo} (${convertedQty} ${rm.unit})`,
              userId: req.user!.id,
            });
          } else {
            const [pk] = await tx
              .select()
              .from(packagingMaterials)
              .where(eq(packagingMaterials.id, item.materialId))
              .limit(1);
            if (!pk) throw new Error('Packaging material not found');
            const calc = applyWeightedAverageReceipt({
              currentStock: pk.currentStock,
              currentValuationPaise: pk.totalValuationPaise,
              receiptQty: item.quantity,
              receiptRatePaise: item.ratePaise,
            });
            await tx
              .update(packagingMaterials)
              .set({
                currentStock: calc.newStock,
                totalValuationPaise: calc.newValuationPaise,
                weightedAvgRatePaise: calc.newWeightedAvgRatePaise,
              })
              .where(eq(packagingMaterials.id, pk.id));

            await tx.insert(inventoryMovements).values({
              transactionId: generateTxnId('TXN-PO'),
              itemCategory: 'PACKAGING',
              packagingMaterialId: pk.id,
              itemName: pk.name,
              unit: pk.unit,
              movementType: 'PURCHASE',
              qtyIn: item.quantity,
              qtyOut: 0,
              unitCostPaise: item.ratePaise,
              runningBalance: calc.newStock,
              referenceType: 'PURCHASE',
              referenceNo: purchaseNo,
              notes: `Purchase receipt ${purchaseNo} (${item.quantity} ${pk.unit})`,
              userId: req.user!.id,
            });
          }
        }

        await recordAuditLog(tx, {
          user: req.user,
          action: 'PURCHASE_RECEIVED',
          entity: 'Purchase',
          referenceId: purchaseNo,
          newValue: { subtotalPaise, gstPaise, totalPaise, itemCount: preparedItems.length },
        });

        return po;
      });

      res.status(201).json(created);
    } catch (error: unknown) {
      return handleRouteError(res, error, 'Failed to record purchase', 400);
    }
  }
);

// ===================== PRODUCTION RUNS =====================
productionRouter.get(
  '/production-runs',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'AUDITOR'),
  async (_req, res) => {
    try {
      await ensureSeeded();
    const [runs, consumptions, allProducts, allBoms, allUsers] = await Promise.all([
      db.select().from(productionRuns).orderBy(desc(productionRuns.runDate), desc(productionRuns.id)),
      db.select().from(productionConsumptions),
      db.select().from(products),
      db.select().from(boms),
      db.select().from(users),
    ]);

    const prodMap = new Map(allProducts.map((p) => [p.id, p]));
    const bomMap = new Map(allBoms.map((b) => [b.id, b]));
    const userMap = new Map(allUsers.map((u) => [u.id, u.name]));

    res.json(
      runs.map((r) => {
        const prod = prodMap.get(r.productId);
        const sellingPricePaise = prod?.sellingPricePaise ?? 0;
        const grossMarginPaise = sellingPricePaise - r.costPerPacketPaise;
        const grossMarginPct =
          sellingPricePaise > 0 ? Math.round((grossMarginPaise / sellingPricePaise) * 10000) / 100 : 0;
        return {
          ...r,
          productName: prod?.name || 'Unknown Product',
          productSku: prod?.sku || '',
          sellingPricePaise,
          grossMarginPaise,
          grossMarginPct,
          bomCode: bomMap.get(r.bomId)?.code || '',
          bomName: bomMap.get(r.bomId)?.name || '',
          createdByName: userMap.get(r.createdById) || 'System',
          consumptions: consumptions.filter((c) => c.productionRunId === r.id),
        };
      })
    );
  } catch (error) {
    console.error('Failed to load production runs:', error);
    return handleRouteError(res, error, 'Failed to load production runs');
  }
});

const createProductionSchema = z.object({
  productId: z.number().int().positive(),
  bomId: z.number().int().positive(),
  runDate: z.string().min(8),
  batchQty: z.number().positive(),
  actualGoodOutputQty: z.number().positive(),
  damagedPackagingQty: z.number().min(0).default(0),
  wastageQty: z.number().min(0).default(0),
  labourCostRupees: z.number().min(0).default(600),
  gasPowerCostRupees: z.number().min(0).default(350),
  otherOverheadRupees: z.number().min(0).default(150),
  notes: z.string().optional().default(''),
  consumptions: z
    .array(
      z.object({
        materialCategory: z.enum(['RAW', 'PACKAGING']),
        rawMaterialId: z.number().int().positive().nullable().optional(),
        packagingMaterialId: z.number().int().positive().nullable().optional(),
        plannedQty: z.number().positive(),
        actualQty: z.number().min(0),
        damagedQty: z.number().min(0).default(0),
        unit: z.string().min(1),
      })
    )
    .min(1),
});

productionRouter.post(
  '/production-runs',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = createProductionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid production run payload' });
      }
      const data = parsed.data;

      const createdRun = await db.transaction(async (tx) => {
        const [bom] = await tx.select().from(boms).where(eq(boms.id, data.bomId)).limit(1);
        if (!bom) throw new Error('Selected BOM not found');
        const [product] = await tx.select().from(products).where(eq(products.id, data.productId)).limit(1);
        if (!product) throw new Error('Selected product not found');

        const settingsRows = await tx.select().from(companySettings).limit(1);
        const tolerancePct = settingsRows[0]?.varianceTolerancePct ?? bom.standardWastageTolerancePct ?? 3;

        const existingRuns = await tx.select({ id: productionRuns.id }).from(productionRuns);
        const runNo = `PR-2026-${String(existingRuns.length + 1).padStart(4, '0')}`;

        const expectedOutputQty = roundQty(bom.expectedOutputQty * data.batchQty);
        const yieldVariancePct = calculateYieldVariancePct(expectedOutputQty, data.actualGoodOutputQty);
        let hasVarianceAlert = isVarianceExceeded(yieldVariancePct, tolerancePct);

        let rawMaterialCostPaise = 0;
        let packagingCostPaise = 0;

        const consumptionRecords: Array<{
          materialCategory: string;
          rawMaterialId: number | null;
          packagingMaterialId: number | null;
          materialName: string;
          plannedQty: number;
          actualQty: number;
          damagedQty: number;
          unit: string;
          variancePct: number;
          isFlagged: boolean;
          unitCostPaise: number;
          totalCostPaise: number;
        }> = [];

        const ledgerEntries: Array<typeof inventoryMovements.$inferInsert> = [];

        for (const c of data.consumptions) {
          const totalUsedInEntryUnit = roundQty(c.actualQty + c.damagedQty);

          if (c.materialCategory === 'RAW' && c.rawMaterialId) {
            const [rm] = await tx.select().from(rawMaterials).where(eq(rawMaterials.id, c.rawMaterialId)).limit(1);
            if (!rm) throw new Error('Raw material not found');

            const actualInStockUnit = convertUnit(c.actualQty, c.unit, rm.unit);
            const plannedInStockUnit = convertUnit(c.plannedQty, c.unit, rm.unit);
            if (rm.currentStock < actualInStockUnit) {
              throw new Error(
                `Insufficient stock for ${rm.name}. Needed ${actualInStockUnit} ${rm.unit}, available ${rm.currentStock} ${rm.unit}.`
              );
            }
            const issueCalc = applyWeightedAverageIssue({
              currentStock: rm.currentStock,
              currentValuationPaise: rm.totalValuationPaise,
              fallbackRatePaise: rm.weightedAvgRatePaise,
              issueQty: actualInStockUnit,
            });
            await tx
              .update(rawMaterials)
              .set({
                currentStock: issueCalc.newStock,
                totalValuationPaise: issueCalc.newValuationPaise,
              })
              .where(eq(rawMaterials.id, rm.id));

            const varPct = calculateConsumptionVariancePct(plannedInStockUnit, actualInStockUnit);
            const flagged = isVarianceExceeded(varPct, tolerancePct);
            if (flagged) hasVarianceAlert = true;

            rawMaterialCostPaise += issueCalc.issueCostPaise;

            consumptionRecords.push({
              materialCategory: 'RAW',
              rawMaterialId: rm.id,
              packagingMaterialId: null,
              materialName: rm.name,
              plannedQty: plannedInStockUnit,
              actualQty: actualInStockUnit,
              damagedQty: 0,
              unit: rm.unit,
              variancePct: varPct,
              isFlagged: flagged,
              unitCostPaise: issueCalc.effectiveUnitCostPaise,
              totalCostPaise: issueCalc.issueCostPaise,
            });

            ledgerEntries.push({
              transactionId: generateTxnId('TXN-PR'),
              itemCategory: 'RAW',
              rawMaterialId: rm.id,
              itemName: rm.name,
              unit: rm.unit,
              movementType: 'PRODUCTION_ISSUE',
              qtyIn: 0,
              qtyOut: actualInStockUnit,
              unitCostPaise: issueCalc.effectiveUnitCostPaise,
              runningBalance: issueCalc.newStock,
              referenceType: 'PRODUCTION_RUN',
              referenceNo: runNo,
              notes: `Issued to ${runNo} (${product.name})`,
              userId: req.user!.id,
            });
          } else if (c.materialCategory === 'PACKAGING' && c.packagingMaterialId) {
            const [pk] = await tx
              .select()
              .from(packagingMaterials)
              .where(eq(packagingMaterials.id, c.packagingMaterialId))
              .limit(1);
            if (!pk) throw new Error('Packaging material not found');

            if (pk.currentStock < totalUsedInEntryUnit) {
              throw new Error(
                `Insufficient stock for ${pk.name}. Needed ${totalUsedInEntryUnit} ${pk.unit}, available ${pk.currentStock} ${pk.unit}.`
              );
            }

            const issueCalc = applyWeightedAverageIssue({
              currentStock: pk.currentStock,
              currentValuationPaise: pk.totalValuationPaise,
              fallbackRatePaise: pk.weightedAvgRatePaise,
              issueQty: c.actualQty,
            });

            let finalStock = issueCalc.newStock;
            let finalVal = issueCalc.newValuationPaise;
            let damageCostPaise = 0;

            ledgerEntries.push({
              transactionId: generateTxnId('TXN-PR'),
              itemCategory: 'PACKAGING',
              packagingMaterialId: pk.id,
              itemName: pk.name,
              unit: pk.unit,
              movementType: 'PRODUCTION_ISSUE',
              qtyIn: 0,
              qtyOut: c.actualQty,
              unitCostPaise: issueCalc.effectiveUnitCostPaise,
              runningBalance: issueCalc.newStock,
              referenceType: 'PRODUCTION_RUN',
              referenceNo: runNo,
              notes: `Issued to ${runNo} (${product.name})`,
              userId: req.user!.id,
            });

            if (c.damagedQty > 0) {
              const dmgCalc = applyWeightedAverageIssue({
                currentStock: issueCalc.newStock,
                currentValuationPaise: issueCalc.newValuationPaise,
                fallbackRatePaise: pk.weightedAvgRatePaise,
                issueQty: c.damagedQty,
              });
              finalStock = dmgCalc.newStock;
              finalVal = dmgCalc.newValuationPaise;
              damageCostPaise = dmgCalc.issueCostPaise;

              ledgerEntries.push({
                transactionId: generateTxnId('TXN-DMG'),
                itemCategory: 'PACKAGING',
                packagingMaterialId: pk.id,
                itemName: pk.name,
                unit: pk.unit,
                movementType: 'PRODUCTION_DAMAGE',
                qtyIn: 0,
                qtyOut: c.damagedQty,
                unitCostPaise: dmgCalc.effectiveUnitCostPaise,
                runningBalance: dmgCalc.newStock,
                referenceType: 'PRODUCTION_RUN',
                referenceNo: runNo,
                notes: `Damaged packaging recorded in ${runNo}`,
                userId: req.user!.id,
              });
            }

            await tx
              .update(packagingMaterials)
              .set({ currentStock: finalStock, totalValuationPaise: finalVal })
              .where(eq(packagingMaterials.id, pk.id));

            const varPct = calculateConsumptionVariancePct(c.plannedQty, totalUsedInEntryUnit);
            const flagged = isVarianceExceeded(varPct, tolerancePct);
            if (flagged) hasVarianceAlert = true;

            const totalLineCost = issueCalc.issueCostPaise + damageCostPaise;
            packagingCostPaise += totalLineCost;

            consumptionRecords.push({
              materialCategory: 'PACKAGING',
              rawMaterialId: null,
              packagingMaterialId: pk.id,
              materialName: pk.name,
              plannedQty: c.plannedQty,
              actualQty: c.actualQty,
              damagedQty: c.damagedQty,
              unit: pk.unit,
              variancePct: varPct,
              isFlagged: flagged,
              unitCostPaise: issueCalc.effectiveUnitCostPaise,
              totalCostPaise: totalLineCost,
            });
          }
        }

        const costSummary = calculateProductionCostSummary({
          rawMaterialCostPaise,
          packagingCostPaise,
          labourCostPaise: rupeesToPaise(data.labourCostRupees),
          gasPowerCostPaise: rupeesToPaise(data.gasPowerCostRupees),
          otherOverheadPaise: rupeesToPaise(data.otherOverheadRupees),
          actualGoodPackets: data.actualGoodOutputQty,
          sellingPricePaise: product.sellingPricePaise,
        });

        const [run] = await tx
          .insert(productionRuns)
          .values({
            runNo,
            productId: product.id,
            bomId: bom.id,
            runDate: data.runDate,
            batchQty: data.batchQty,
            expectedOutputQty,
            actualGoodOutputQty: data.actualGoodOutputQty,
            damagedPackagingQty: data.damagedPackagingQty,
            wastageQty: data.wastageQty,
            wastageUnit: bom.outputUnit,
            yieldVariancePct,
            hasVarianceAlert,
            rawMaterialCostPaise: costSummary.rawMaterialCostPaise,
            packagingCostPaise: costSummary.packagingCostPaise,
            labourCostPaise: costSummary.labourCostPaise,
            gasPowerCostPaise: costSummary.gasPowerCostPaise,
            otherOverheadPaise: costSummary.otherOverheadPaise,
            totalCostPaise: costSummary.totalProductionCostPaise,
            costPerPacketPaise: costSummary.costPerGoodPacketPaise,
            status: 'COMPLETED',
            notes: data.notes,
            createdById: req.user!.id,
          })
          .returning();

        for (const rec of consumptionRecords) {
          await tx.insert(productionConsumptions).values({
            productionRunId: run.id,
            ...rec,
          });
        }

        // Increase finished goods inventory
        const prevFgStock = product.currentStock;
        const newFgStock = roundQty(prevFgStock + data.actualGoodOutputQty);
        const newAvgCost = Math.round(
          (prevFgStock * product.avgCostPaise + costSummary.totalProductionCostPaise) /
            Math.max(1, newFgStock)
        );
        await tx
          .update(products)
          .set({ currentStock: newFgStock, avgCostPaise: newAvgCost })
          .where(eq(products.id, product.id));

        ledgerEntries.push({
          transactionId: generateTxnId('TXN-FG'),
          itemCategory: 'FINISHED',
          productId: product.id,
          itemName: product.name,
          unit: product.unit,
          movementType: 'PRODUCTION_RECEIPT',
          qtyIn: data.actualGoodOutputQty,
          qtyOut: 0,
          unitCostPaise: costSummary.costPerGoodPacketPaise,
          runningBalance: newFgStock,
          referenceType: 'PRODUCTION_RUN',
          referenceNo: runNo,
          notes: `Finished goods output from ${runNo} (Yield variance: ${yieldVariancePct}%)`,
          userId: req.user!.id,
        });

        await tx.insert(inventoryMovements).values(ledgerEntries);

        await recordAuditLog(tx, {
          user: req.user,
          action: 'PRODUCTION_RUN_POSTED',
          entity: 'ProductionRun',
          referenceId: runNo,
          previousValue: { finishedStock: prevFgStock },
          newValue: {
            finishedStock: newFgStock,
            actualGoodOutputQty: data.actualGoodOutputQty,
            yieldVariancePct,
            totalCostPaise: costSummary.totalProductionCostPaise,
            costPerPacketPaise: costSummary.costPerGoodPacketPaise,
          },
        });

        return run;
      });

      res.status(201).json(createdRun);
    } catch (error: unknown) {
      return handleRouteError(res, error, 'Failed to post production run', 400);
    }
  }
);
