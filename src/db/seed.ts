import bcrypt from 'bcryptjs';
import { count, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  roles,
  users,
  companySettings,
  customers,
  suppliers,
  products,
  rawMaterials,
  packagingMaterials,
  boms,
  bomItems,
  purchases,
  purchaseItems,
  productionRuns,
  productionConsumptions,
  orders,
  orderItems,
  invoices,
  invoiceItems,
  creditNotes,
  payments,
  inventoryMovements,
  auditLogs,
} from './schema.ts';
import {
  applyWeightedAverageReceipt,
  applyWeightedAverageIssue,
  calculateConsumptionVariancePct,
  calculateYieldVariancePct,
  isVarianceExceeded,
  calculateProductionCostSummary,
  calculateGstLine,
  amountInWordsINR,
  roundQty,
} from '../utils/erpMath.ts';
import { recordAuditLog } from './audit.ts';

export const DEMO_ACCOUNTS = [
  {
    email: 'owner@factoryflow.in',
    password: 'Password@123',
    name: 'Meenakshi Sundaram',
    roleCode: 'OWNER' as const,
    phone: '+91 98401 10001',
    uid: 'demo-owner-01',
  },
  {
    email: 'admin@factoryflow.in',
    password: 'Password@123',
    name: 'Aravind Krishnan',
    roleCode: 'ADMIN' as const,
    phone: '+91 98401 10002',
    uid: 'demo-admin-01',
  },
  {
    email: 'supervisor@factoryflow.in',
    password: 'Password@123',
    name: 'Senthil Murugan',
    roleCode: 'PRODUCTION_SUPERVISOR' as const,
    phone: '+91 98401 10003',
    uid: 'demo-supervisor-01',
  },
  {
    email: 'sales@factoryflow.in',
    password: 'Password@123',
    name: 'Karthik Rajan',
    roleCode: 'SALESMAN' as const,
    phone: '+91 98401 10004',
    uid: 'demo-salesman-01',
  },
  {
    email: 'auditor@factoryflow.in',
    password: 'Password@123',
    name: 'Lakshmi Narayanan CA',
    roleCode: 'AUDITOR' as const,
    phone: '+91 98401 10005',
    uid: 'demo-auditor-01',
  },
];

let seedPromise: Promise<void> | null = null;

export async function ensureSeeded(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    try {
      const [{ value: roleCount }] = await db.select({ value: count() }).from(roles);
      const [{ value: productCount }] = await db.select({ value: count() }).from(products);
      if (Number(roleCount) > 0 && Number(productCount) > 0) {
        return;
      }
      await seedBenchmarkScenario(false);
    } finally {
      seedPromise = null;
    }
  })();
  return seedPromise;
}

export async function seedBenchmarkScenario(resetExisting: boolean): Promise<void> {
  const passwordHash = await bcrypt.hash('Password@123', 10);

  await db.transaction(async (tx) => {
    if (resetExisting) {
      await tx.delete(auditLogs);
      await tx.delete(inventoryMovements);
      await tx.delete(payments);
      await tx.delete(creditNotes);
      await tx.delete(invoiceItems);
      await tx.delete(invoices);
      await tx.delete(orderItems);
      await tx.delete(orders);
      await tx.delete(productionConsumptions);
      await tx.delete(productionRuns);
      await tx.delete(purchaseItems);
      await tx.delete(purchases);
      await tx.delete(bomItems);
      await tx.delete(boms);
      await tx.delete(products);
      await tx.delete(packagingMaterials);
      await tx.delete(rawMaterials);
      await tx.delete(customers);
      await tx.delete(suppliers);
      await tx.delete(companySettings);
    }

    // 1. Roles
    const roleDefs = [
      {
        code: 'OWNER',
        name: 'Business Owner',
        description: 'Full operational visibility, approvals, financial insights, and configuration',
        permissionsJson: JSON.stringify(['*']),
      },
      {
        code: 'ADMIN',
        name: 'Operations Admin',
        description: 'Order verification, GST invoicing, dispatch, payments, masters, purchases',
        permissionsJson: JSON.stringify([
          'orders:read',
          'orders:approve',
          'invoices:write',
          'payments:write',
          'masters:write',
          'purchases:write',
        ]),
      },
      {
        code: 'PRODUCTION_SUPERVISOR',
        name: 'Production Supervisor',
        description: 'BOM management, production runs, material issues, yield & variance, inventory',
        permissionsJson: JSON.stringify([
          'boms:write',
          'production:write',
          'inventory:write',
          'purchases:read',
        ]),
      },
      {
        code: 'SALESMAN',
        name: 'Field Salesman',
        description: 'Mobile order entry for assigned customers, price lists, order tracking',
        permissionsJson: JSON.stringify(['orders:create', 'orders:own', 'customers:assigned', 'products:read']),
      },
      {
        code: 'AUDITOR',
        name: 'Statutory Auditor',
        description: 'Strict read-only access to financial reports, GST summaries, ledgers, audit logs',
        permissionsJson: JSON.stringify(['reports:read', 'audit:read', 'readonly']),
      },
      {
        code: 'PENDING',
        name: 'Pending Approval',
        description: 'Newly registered external account awaiting administrator role assignment and activation',
        permissionsJson: JSON.stringify([]),
      },
    ];

    const roleMap = new Map<string, number>();
    for (const r of roleDefs) {
      const existing = await tx.select().from(roles).where(eq(roles.code, r.code)).limit(1);
      if (existing.length > 0) {
        roleMap.set(r.code, existing[0].id);
      } else {
        const [ins] = await tx.insert(roles).values(r).returning();
        roleMap.set(r.code, ins.id);
      }
    }

    // 2. Demo Users
    const userMap = new Map<string, typeof users.$inferSelect>();
    for (const acc of DEMO_ACCOUNTS) {
      const roleId = roleMap.get(acc.roleCode)!;
      const existing = await tx.select().from(users).where(eq(users.email, acc.email)).limit(1);
      if (existing.length > 0) {
        const [upd] = await tx
          .update(users)
          .set({ name: acc.name, roleId, roleCode: acc.roleCode, passwordHash, isActive: true })
          .where(eq(users.id, existing[0].id))
          .returning();
        userMap.set(acc.roleCode, upd);
      } else {
        const [ins] = await tx
          .insert(users)
          .values({
            uid: acc.uid,
            email: acc.email,
            name: acc.name,
            passwordHash,
            roleId,
            roleCode: acc.roleCode,
            phone: acc.phone,
            isActive: true,
          })
          .returning();
        userMap.set(acc.roleCode, ins);
      }
    }

    const ownerUser = userMap.get('OWNER')!;
    const adminUser = userMap.get('ADMIN')!;
    const supervisorUser = userMap.get('PRODUCTION_SUPERVISOR')!;
    const salesmanUser = userMap.get('SALESMAN')!;

    // 3. Company Settings (Factory State: Tamil Nadu)
    await tx.insert(companySettings).values({
      companyName: 'FactoryFlow Foods Pvt. Ltd.',
      gstin: '33AABCF4821K1Z5',
      address: 'Plot 14, SIDCO Industrial Estate, Coimbatore - 641021, Tamil Nadu',
      state: 'Tamil Nadu',
      stateCode: '33',
      phone: '+91 422 267 8910',
      email: 'accounts@factoryflow.in',
      varianceTolerancePct: 3,
      costingMethod: 'WEIGHTED_AVERAGE',
      invoicePrefix: 'FF',
      financialYear: '2026-27',
    });

    // 4. Suppliers
    const [supplierMills, supplierOil, supplierPack] = await tx
      .insert(suppliers)
      .values([
        {
          name: 'Sri Murugan Agro Mills',
          gstin: '33AAACS7412B1Z9',
          phone: '+91 98422 44110',
          email: 'billing@muruganagromills.in',
          address: '42 Pollachi Main Road, Coimbatore, Tamil Nadu',
          state: 'Tamil Nadu',
          stateCode: '33',
        },
        {
          name: 'Kaveri Edible Oils & Spices',
          gstin: '33AABCK8921M1Z2',
          phone: '+91 98422 55120',
          email: 'orders@kaverioils.in',
          address: '19 Erode Highway, Perundurai, Tamil Nadu',
          state: 'Tamil Nadu',
          stateCode: '33',
        },
        {
          name: 'Coimbatore FlexiPack Industries',
          gstin: '33AADCF3310P1Z4',
          phone: '+91 98422 66130',
          email: 'sales@cbeflexipack.in',
          address: '88 Ganapathy Industrial Area, Coimbatore, Tamil Nadu',
          state: 'Tamil Nadu',
          stateCode: '33',
        },
      ])
      .returning();

    // 5. Customers (Mandatory samples: Retailer A — Tamil Nadu, Distributor B — Karnataka)
    const [retailerA, distributorB] = await tx
      .insert(customers)
      .values([
        {
          name: 'Retailer A — Tamil Nadu',
          customerType: 'RETAILER',
          gstin: '33AABCR5120H1Z8',
          phone: '+91 98409 33211',
          address: '112 Cross Cut Road, Gandhipuram, Coimbatore, Tamil Nadu',
          state: 'Tamil Nadu',
          stateCode: '33',
          creditLimitPaise: 5000000, // ₹50,000
          assignedSalesmanId: salesmanUser.id,
        },
        {
          name: 'Distributor B — Karnataka',
          customerType: 'DISTRIBUTOR',
          gstin: '29AABCD7821K1Z1',
          phone: '+91 98450 77822',
          address: '27 APMC Yard, Yeshwanthpur, Bengaluru, Karnataka',
          state: 'Karnataka',
          stateCode: '29',
          creditLimitPaise: 25000000, // ₹2,50,000
          assignedSalesmanId: salesmanUser.id,
        },
        {
          name: 'Madurai Heritage Provision Stores',
          customerType: 'RETAILER',
          gstin: '33AAHCM1104Q1Z3',
          phone: '+91 98421 19002',
          address: '54 West Masi Street, Madurai, Tamil Nadu',
          state: 'Tamil Nadu',
          stateCode: '33',
          creditLimitPaise: 7500000, // ₹75,000
          assignedSalesmanId: salesmanUser.id,
        },
      ])
      .returning();

    // 6. Opening Raw Materials (Benchmark exact initial stocks & rates)
    // Flour: 100 kg @ ₹42/kg; Oil: 30 L @ ₹140/L; Spice mix: 5 kg @ ₹200/kg
    const [flour, oil, spice] = await tx
      .insert(rawMaterials)
      .values([
        {
          name: 'Rice & Urad Flour Blend',
          code: 'RM-FLR',
          unit: 'kg',
          baseUnit: 'g',
          conversionFactor: 1000,
          minStockLevel: 50,
          currentStock: 100,
          weightedAvgRatePaise: 4200,
          totalValuationPaise: 420000,
        },
        {
          name: 'Refined Cooking Oil',
          code: 'RM-OIL',
          unit: 'litre',
          baseUnit: 'ml',
          conversionFactor: 1000,
          minStockLevel: 20,
          currentStock: 30,
          weightedAvgRatePaise: 14000,
          totalValuationPaise: 420000,
        },
        {
          name: 'Salt and Spice Mix',
          code: 'RM-SPC',
          unit: 'kg',
          baseUnit: 'g',
          conversionFactor: 1000,
          minStockLevel: 4,
          currentStock: 5,
          weightedAvgRatePaise: 20000,
          totalValuationPaise: 100000,
        },
      ])
      .returning();

    // 7. Opening Packaging Materials (Benchmark exact initial stocks & rates)
    // 200 g pouches: 500 pcs @ ₹2.50/pc; Cartons: 30 pcs @ ₹15/pc
    const [pouch200, carton] = await tx
      .insert(packagingMaterials)
      .values([
        {
          name: '200 g Laminated Pouch',
          code: 'PK-PCH200',
          unit: 'pieces',
          minStockLevel: 300,
          currentStock: 500,
          weightedAvgRatePaise: 250,
          totalValuationPaise: 125000,
        },
        {
          name: 'Master Dispatch Carton (20-pack)',
          code: 'PK-CTN',
          unit: 'pieces',
          minStockLevel: 25,
          currentStock: 30,
          weightedAvgRatePaise: 1500,
          totalValuationPaise: 45000,
        },
      ])
      .returning();

    // 8. Finished Products (Benchmark: Murukku 200 g opening = 50 packets, selling ₹50, GST 5%)
    const [murukku, ribbonPakoda] = await tx
      .insert(products)
      .values([
        {
          name: 'Murukku 200 g',
          sku: 'FG-MRK-200',
          packSize: '200 g',
          hsnCode: '21069099',
          gstPct: 5,
          sellingPricePaise: 5000, // ₹50.00 before tax
          unit: 'packets',
          minStockLevel: 40,
          currentStock: 50,
          avgCostPaise: 2750,
        },
        {
          name: 'Ribbon Pakoda 200 g',
          sku: 'FG-RBP-200',
          packSize: '200 g',
          hsnCode: '21069099',
          gstPct: 5,
          sellingPricePaise: 5500, // ₹55.00 before tax
          unit: 'packets',
          minStockLevel: 30,
          currentStock: 45,
          avgCostPaise: 3000,
        },
      ])
      .returning();

    // Record Opening Stock Ledger Entries (immutable permanent ledger)
    await tx.insert(inventoryMovements).values([
      {
        transactionId: 'TXN-OPEN-FLR',
        itemCategory: 'RAW',
        rawMaterialId: flour.id,
        itemName: flour.name,
        unit: 'kg',
        movementType: 'OPENING',
        qtyIn: 100,
        qtyOut: 0,
        unitCostPaise: 4200,
        runningBalance: 100,
        referenceType: 'OPENING_BALANCE',
        referenceNo: 'OB-2026-27',
        notes: 'Benchmark opening stock: Flour 100 kg @ ₹42/kg',
        userId: ownerUser.id,
      },
      {
        transactionId: 'TXN-OPEN-OIL',
        itemCategory: 'RAW',
        rawMaterialId: oil.id,
        itemName: oil.name,
        unit: 'litre',
        movementType: 'OPENING',
        qtyIn: 30,
        qtyOut: 0,
        unitCostPaise: 14000,
        runningBalance: 30,
        referenceType: 'OPENING_BALANCE',
        referenceNo: 'OB-2026-27',
        notes: 'Benchmark opening stock: Cooking oil 30 L @ ₹140/L',
        userId: ownerUser.id,
      },
      {
        transactionId: 'TXN-OPEN-SPC',
        itemCategory: 'RAW',
        rawMaterialId: spice.id,
        itemName: spice.name,
        unit: 'kg',
        movementType: 'OPENING',
        qtyIn: 5,
        qtyOut: 0,
        unitCostPaise: 20000,
        runningBalance: 5,
        referenceType: 'OPENING_BALANCE',
        referenceNo: 'OB-2026-27',
        notes: 'Benchmark opening stock: Salt & spice mix 5 kg @ ₹200/kg',
        userId: ownerUser.id,
      },
      {
        transactionId: 'TXN-OPEN-PCH',
        itemCategory: 'PACKAGING',
        packagingMaterialId: pouch200.id,
        itemName: pouch200.name,
        unit: 'pieces',
        movementType: 'OPENING',
        qtyIn: 500,
        qtyOut: 0,
        unitCostPaise: 250,
        runningBalance: 500,
        referenceType: 'OPENING_BALANCE',
        referenceNo: 'OB-2026-27',
        notes: 'Benchmark opening stock: 200 g pouches 500 pcs @ ₹2.50/pc',
        userId: ownerUser.id,
      },
      {
        transactionId: 'TXN-OPEN-CTN',
        itemCategory: 'PACKAGING',
        packagingMaterialId: carton.id,
        itemName: carton.name,
        unit: 'pieces',
        movementType: 'OPENING',
        qtyIn: 30,
        qtyOut: 0,
        unitCostPaise: 1500,
        runningBalance: 30,
        referenceType: 'OPENING_BALANCE',
        referenceNo: 'OB-2026-27',
        notes: 'Benchmark opening stock: Cartons 30 pcs @ ₹15/pc',
        userId: ownerUser.id,
      },
      {
        transactionId: 'TXN-OPEN-MRK',
        itemCategory: 'FINISHED',
        productId: murukku.id,
        itemName: murukku.name,
        unit: 'packets',
        movementType: 'OPENING',
        qtyIn: 50,
        qtyOut: 0,
        unitCostPaise: 2750,
        runningBalance: 50,
        referenceType: 'OPENING_BALANCE',
        referenceNo: 'OB-2026-27',
        notes: 'Benchmark opening stock: Finished Murukku 200 g — 50 packets',
        userId: ownerUser.id,
      },
      {
        transactionId: 'TXN-OPEN-RBP',
        itemCategory: 'FINISHED',
        productId: ribbonPakoda.id,
        itemName: ribbonPakoda.name,
        unit: 'packets',
        movementType: 'OPENING',
        qtyIn: 45,
        qtyOut: 0,
        unitCostPaise: 3000,
        runningBalance: 45,
        referenceType: 'OPENING_BALANCE',
        referenceNo: 'OB-2026-27',
        notes: 'Opening stock: Finished Ribbon Pakoda 200 g — 45 packets',
        userId: ownerUser.id,
      },
    ]);

    // 9. BOM for Murukku 200 g (Exact benchmark recipe)
    const [murukkuBom] = await tx
      .insert(boms)
      .values({
        code: 'BOM-MRK-200',
        productId: murukku.id,
        name: 'Murukku 200 g — Standard Batch (200 packets)',
        batchSize: 1,
        expectedOutputQty: 200,
        outputUnit: 'packets',
        standardWastageTolerancePct: 3,
        standardLabourCostPaise: 60000, // ₹600
        standardGasPowerCostPaise: 35000, // ₹350
        standardOverheadCostPaise: 15000, // ₹150
      })
      .returning();

    await tx.insert(bomItems).values([
      {
        bomId: murukkuBom.id,
        materialCategory: 'RAW',
        rawMaterialId: flour.id,
        standardQty: 40,
        unit: 'kg',
        wastageTolerancePct: 3,
      },
      {
        bomId: murukkuBom.id,
        materialCategory: 'RAW',
        rawMaterialId: oil.id,
        standardQty: 10,
        unit: 'litre',
        wastageTolerancePct: 3,
      },
      {
        bomId: murukkuBom.id,
        materialCategory: 'RAW',
        rawMaterialId: spice.id,
        standardQty: 1.2,
        unit: 'kg',
        wastageTolerancePct: 3,
      },
      {
        bomId: murukkuBom.id,
        materialCategory: 'PACKAGING',
        packagingMaterialId: pouch200.id,
        standardQty: 200,
        unit: 'pieces',
        wastageTolerancePct: 3,
      },
      {
        bomId: murukkuBom.id,
        materialCategory: 'PACKAGING',
        packagingMaterialId: carton.id,
        standardQty: 10,
        unit: 'pieces',
        wastageTolerancePct: 3,
      },
    ]);

    // =========================================================================
    // MANDATORY BENCHMARK STEP 1 — PURCHASE: 60 kg flour at ₹45/kg
    // =========================================================================
    const purchaseDate = '2026-11-12';
    const flourPurchaseRate = 4500;
    const flourPurchaseSubtotal = 60 * flourPurchaseRate; // 270,000 paise (₹2,700.00)
    const flourPurchaseGst = Math.round((flourPurchaseSubtotal * 5) / 100); // 13,500 paise
    const [po1] = await tx
      .insert(purchases)
      .values({
        purchaseNo: 'PO-2026-0001',
        supplierId: supplierMills.id,
        purchaseDate,
        invoiceRef: 'SMAM/26-27/418',
        status: 'RECEIVED',
        subtotalPaise: flourPurchaseSubtotal,
        gstPaise: flourPurchaseGst,
        totalPaise: flourPurchaseSubtotal + flourPurchaseGst,
        notes: 'Benchmark Step 1: 60 kg flour @ ₹45/kg',
        createdById: adminUser.id,
      })
      .returning();

    await tx.insert(purchaseItems).values({
      purchaseId: po1.id,
      materialCategory: 'RAW',
      rawMaterialId: flour.id,
      quantity: 60,
      unit: 'kg',
      ratePaise: flourPurchaseRate,
      gstPct: 5,
      lineTotalPaise: flourPurchaseSubtotal + flourPurchaseGst,
    });

    const flourAfterPurchase = applyWeightedAverageReceipt({
      currentStock: 100,
      currentValuationPaise: 420000,
      receiptQty: 60,
      receiptRatePaise: 4500,
    });

    await tx
      .update(rawMaterials)
      .set({
        currentStock: flourAfterPurchase.newStock, // 160 kg
        totalValuationPaise: flourAfterPurchase.newValuationPaise, // 690,000 paise
        weightedAvgRatePaise: flourAfterPurchase.newWeightedAvgRatePaise, // 4313 paise (₹43.125/kg)
      })
      .where(eq(rawMaterials.id, flour.id));

    await tx.insert(inventoryMovements).values({
      transactionId: 'TXN-PO-0001-FLR',
      itemCategory: 'RAW',
      rawMaterialId: flour.id,
      itemName: flour.name,
      unit: 'kg',
      movementType: 'PURCHASE',
      qtyIn: 60,
      qtyOut: 0,
      unitCostPaise: 4500,
      runningBalance: flourAfterPurchase.newStock, // 160
      referenceType: 'PURCHASE',
      referenceNo: po1.purchaseNo,
      notes: 'Received 60 kg flour @ ₹45.00/kg from Sri Murugan Agro Mills',
      userId: adminUser.id,
    });

    await recordAuditLog(tx, {
      user: adminUser,
      action: 'PURCHASE_RECEIVED',
      entity: 'Purchase',
      referenceId: po1.purchaseNo,
      previousValue: { flourStockKg: 100, weightedAvgPaise: 4200 },
      newValue: {
        flourStockKg: flourAfterPurchase.newStock,
        weightedAvgPaise: flourAfterPurchase.newWeightedAvgRatePaise,
        totalPaise: po1.totalPaise,
      },
    });

    // =========================================================================
    // MANDATORY BENCHMARK STEP 2 — PRODUCTION RUN: 1 batch Murukku 200 g
    // Flour: 40 kg | Oil: 10.5 L | Spice: 1.2 kg | Pouches: 188 good + 6 damaged = 194 | Cartons: 9
    // Expected: 200 pkts | Actual good: 188 pkts
    // =========================================================================
    const runNo = 'PR-2026-0001';
    const runDate = '2026-11-14';

    const flourIssue = applyWeightedAverageIssue({
      currentStock: flourAfterPurchase.newStock, // 160
      currentValuationPaise: flourAfterPurchase.newValuationPaise, // 690000
      fallbackRatePaise: flourAfterPurchase.newWeightedAvgRatePaise,
      issueQty: 40,
    }); // newStock = 120, cost = 172500

    const oilIssue = applyWeightedAverageIssue({
      currentStock: 30,
      currentValuationPaise: 420000,
      fallbackRatePaise: 14000,
      issueQty: 10.5,
    }); // newStock = 19.5, cost = 147000

    const spiceIssue = applyWeightedAverageIssue({
      currentStock: 5,
      currentValuationPaise: 100000,
      fallbackRatePaise: 20000,
      issueQty: 1.2,
    }); // newStock = 3.8, cost = 24000

    // Pouches: 188 good packets packed + 6 damaged = 194 total consumed -> 500 - 188 - 6 = 306 remaining
    const pouchIssuedOnly = applyWeightedAverageIssue({
      currentStock: 500,
      currentValuationPaise: 125000,
      fallbackRatePaise: 250,
      issueQty: 188,
    }); // 312 remaining, cost = 47000 paise (₹470.00)
    const pouchDamaged = applyWeightedAverageIssue({
      currentStock: pouchIssuedOnly.newStock,
      currentValuationPaise: pouchIssuedOnly.newValuationPaise,
      fallbackRatePaise: 250,
      issueQty: 6,
    }); // 306 remaining, cost = 1500 paise (₹15.00), total pouch cost = 48500 paise (₹485.00)

    const cartonIssue = applyWeightedAverageIssue({
      currentStock: 30,
      currentValuationPaise: 45000,
      fallbackRatePaise: 1500,
      issueQty: 9,
    }); // newStock = 21, cost = 13500

    const rawMaterialCostPaise =
      flourIssue.issueCostPaise + oilIssue.issueCostPaise + spiceIssue.issueCostPaise; // 343500 (₹3,435.00)
    const packagingCostPaise =
      pouchIssuedOnly.issueCostPaise + pouchDamaged.issueCostPaise + cartonIssue.issueCostPaise; // 62000 (₹620.00)

    const costSummary = calculateProductionCostSummary({
      rawMaterialCostPaise,
      packagingCostPaise,
      labourCostPaise: 60000,
      gasPowerCostPaise: 35000,
      otherOverheadPaise: 15000,
      actualGoodPackets: 188,
      sellingPricePaise: 5000,
    }); // Total = 515500 paise (₹5,155.00), Cost/Good Pkt = 2742 paise (₹27.42)

    const yieldVariancePct = calculateYieldVariancePct(200, 188); // -6.00%
    const oilVarPct = calculateConsumptionVariancePct(10, 10.5); // +5.00%
    const pouchVarPct = calculateConsumptionVariancePct(200, 194); // -3.00% (188 good + 6 damaged)
    const cartonVarPct = calculateConsumptionVariancePct(10, 9); // -10.00%

    const [run1] = await tx
      .insert(productionRuns)
      .values({
        runNo,
        productId: murukku.id,
        bomId: murukkuBom.id,
        runDate,
        batchQty: 1,
        expectedOutputQty: 200,
        actualGoodOutputQty: 188,
        damagedPackagingQty: 6,
        wastageQty: 12,
        wastageUnit: 'packets',
        yieldVariancePct,
        hasVarianceAlert: true,
        rawMaterialCostPaise: costSummary.rawMaterialCostPaise,
        packagingCostPaise: costSummary.packagingCostPaise,
        labourCostPaise: costSummary.labourCostPaise,
        gasPowerCostPaise: costSummary.gasPowerCostPaise,
        otherOverheadPaise: costSummary.otherOverheadPaise,
        totalCostPaise: costSummary.totalProductionCostPaise,
        costPerPacketPaise: costSummary.costPerGoodPacketPaise,
        status: 'COMPLETED',
        notes: 'Benchmark Step 2: 1 batch Murukku 200 g (188 good pkts, 6 damaged pouches, 10.5 L oil)',
        createdById: supervisorUser.id,
      })
      .returning();

    await tx.insert(productionConsumptions).values([
      {
        productionRunId: run1.id,
        materialCategory: 'RAW',
        rawMaterialId: flour.id,
        materialName: flour.name,
        plannedQty: 40,
        actualQty: 40,
        damagedQty: 0,
        unit: 'kg',
        variancePct: 0,
        isFlagged: false,
        unitCostPaise: flourIssue.effectiveUnitCostPaise,
        totalCostPaise: flourIssue.issueCostPaise,
      },
      {
        productionRunId: run1.id,
        materialCategory: 'RAW',
        rawMaterialId: oil.id,
        materialName: oil.name,
        plannedQty: 10,
        actualQty: 10.5,
        damagedQty: 0,
        unit: 'litre',
        variancePct: oilVarPct,
        isFlagged: isVarianceExceeded(oilVarPct, 3),
        unitCostPaise: oilIssue.effectiveUnitCostPaise,
        totalCostPaise: oilIssue.issueCostPaise,
      },
      {
        productionRunId: run1.id,
        materialCategory: 'RAW',
        rawMaterialId: spice.id,
        materialName: spice.name,
        plannedQty: 1.2,
        actualQty: 1.2,
        damagedQty: 0,
        unit: 'kg',
        variancePct: 0,
        isFlagged: false,
        unitCostPaise: spiceIssue.effectiveUnitCostPaise,
        totalCostPaise: spiceIssue.issueCostPaise,
      },
      {
        productionRunId: run1.id,
        materialCategory: 'PACKAGING',
        packagingMaterialId: pouch200.id,
        materialName: pouch200.name,
        plannedQty: 200,
        actualQty: 188,
        damagedQty: 6,
        unit: 'pieces',
        variancePct: pouchVarPct,
        isFlagged: isVarianceExceeded(pouchVarPct, 3), // -3.00%, within ±3% tolerance
        unitCostPaise: 250,
        totalCostPaise: pouchIssuedOnly.issueCostPaise + pouchDamaged.issueCostPaise,
      },
      {
        productionRunId: run1.id,
        materialCategory: 'PACKAGING',
        packagingMaterialId: carton.id,
        materialName: carton.name,
        plannedQty: 10,
        actualQty: 9,
        damagedQty: 0,
        unit: 'pieces',
        variancePct: cartonVarPct,
        isFlagged: isVarianceExceeded(cartonVarPct, 3),
        unitCostPaise: 1500,
        totalCostPaise: cartonIssue.issueCostPaise,
      },
    ]);

    // Update Inventory Balances (Benchmark Step 3 EXACT VALUES)
    await tx
      .update(rawMaterials)
      .set({
        currentStock: flourIssue.newStock, // 120 kg
        totalValuationPaise: flourIssue.newValuationPaise,
      })
      .where(eq(rawMaterials.id, flour.id));

    await tx
      .update(rawMaterials)
      .set({
        currentStock: oilIssue.newStock, // 19.5 litres
        totalValuationPaise: oilIssue.newValuationPaise,
      })
      .where(eq(rawMaterials.id, oil.id));

    await tx
      .update(rawMaterials)
      .set({
        currentStock: spiceIssue.newStock, // 3.8 kg
        totalValuationPaise: spiceIssue.newValuationPaise,
      })
      .where(eq(rawMaterials.id, spice.id));

    await tx
      .update(packagingMaterials)
      .set({
        currentStock: pouchDamaged.newStock, // 306 pieces (500 - 188 good - 6 damaged)
        totalValuationPaise: pouchDamaged.newValuationPaise,
      })
      .where(eq(packagingMaterials.id, pouch200.id));

    await tx
      .update(packagingMaterials)
      .set({
        currentStock: cartonIssue.newStock, // 21 pieces (30 - 9)
        totalValuationPaise: cartonIssue.newValuationPaise,
      })
      .where(eq(packagingMaterials.id, carton.id));

    const newMurukkuStock = roundQty(50 + 188); // 238 packets
    const newMurukkuAvgCost = Math.round((50 * 2750 + costSummary.totalProductionCostPaise) / newMurukkuStock);
    await tx
      .update(products)
      .set({
        currentStock: newMurukkuStock, // 238 packets
        avgCostPaise: newMurukkuAvgCost,
      })
      .where(eq(products.id, murukku.id));

    // Permanent Stock Ledger entries for Step 2 Production
    await tx.insert(inventoryMovements).values([
      {
        transactionId: 'TXN-PR-0001-FLR',
        itemCategory: 'RAW',
        rawMaterialId: flour.id,
        itemName: flour.name,
        unit: 'kg',
        movementType: 'PRODUCTION_ISSUE',
        qtyIn: 0,
        qtyOut: 40,
        unitCostPaise: flourIssue.effectiveUnitCostPaise,
        runningBalance: 120,
        referenceType: 'PRODUCTION_RUN',
        referenceNo: runNo,
        notes: 'Issued 40 kg flour to Murukku 200 g Batch 1',
        userId: supervisorUser.id,
      },
      {
        transactionId: 'TXN-PR-0001-OIL',
        itemCategory: 'RAW',
        rawMaterialId: oil.id,
        itemName: oil.name,
        unit: 'litre',
        movementType: 'PRODUCTION_ISSUE',
        qtyIn: 0,
        qtyOut: 10.5,
        unitCostPaise: 14000,
        runningBalance: 19.5,
        referenceType: 'PRODUCTION_RUN',
        referenceNo: runNo,
        notes: 'Issued 10.5 L cooking oil (+5.00% variance alert)',
        userId: supervisorUser.id,
      },
      {
        transactionId: 'TXN-PR-0001-SPC',
        itemCategory: 'RAW',
        rawMaterialId: spice.id,
        itemName: spice.name,
        unit: 'kg',
        movementType: 'PRODUCTION_ISSUE',
        qtyIn: 0,
        qtyOut: 1.2,
        unitCostPaise: 20000,
        runningBalance: 3.8,
        referenceType: 'PRODUCTION_RUN',
        referenceNo: runNo,
        notes: 'Issued 1.2 kg salt & spice mix',
        userId: supervisorUser.id,
      },
      {
        transactionId: 'TXN-PR-0001-PCH-ISS',
        itemCategory: 'PACKAGING',
        packagingMaterialId: pouch200.id,
        itemName: pouch200.name,
        unit: 'pieces',
        movementType: 'PRODUCTION_ISSUE',
        qtyIn: 0,
        qtyOut: 188,
        unitCostPaise: 250,
        runningBalance: 312,
        referenceType: 'PRODUCTION_RUN',
        referenceNo: runNo,
        notes: 'Consumed 188 pcs 200 g pouches for 188 good packets packed',
        userId: supervisorUser.id,
      },
      {
        transactionId: 'TXN-PR-0001-PCH-DMG',
        itemCategory: 'PACKAGING',
        packagingMaterialId: pouch200.id,
        itemName: pouch200.name,
        unit: 'pieces',
        movementType: 'PRODUCTION_DAMAGE',
        qtyIn: 0,
        qtyOut: 6,
        unitCostPaise: 250,
        runningBalance: 306,
        referenceType: 'PRODUCTION_RUN',
        referenceNo: runNo,
        notes: 'Damaged 6 pouches during sealing (500 - 188 - 6 = 306)',
        userId: supervisorUser.id,
      },
      {
        transactionId: 'TXN-PR-0001-CTN',
        itemCategory: 'PACKAGING',
        packagingMaterialId: carton.id,
        itemName: carton.name,
        unit: 'pieces',
        movementType: 'PRODUCTION_ISSUE',
        qtyIn: 0,
        qtyOut: 9,
        unitCostPaise: 1500,
        runningBalance: 21,
        referenceType: 'PRODUCTION_RUN',
        referenceNo: runNo,
        notes: 'Used 9 dispatch cartons for 188 good packets',
        userId: supervisorUser.id,
      },
      {
        transactionId: 'TXN-PR-0001-FG',
        itemCategory: 'FINISHED',
        productId: murukku.id,
        itemName: murukku.name,
        unit: 'packets',
        movementType: 'PRODUCTION_RECEIPT',
        qtyIn: 188,
        qtyOut: 0,
        unitCostPaise: costSummary.costPerGoodPacketPaise,
        runningBalance: 238,
        referenceType: 'PRODUCTION_RUN',
        referenceNo: runNo,
        notes: 'Produced 188 good packets Murukku 200 g (yield -6.00%, 50 + 188 = 238)',
        userId: supervisorUser.id,
      },
    ]);

    await recordAuditLog(tx, {
      user: supervisorUser,
      action: 'PRODUCTION_RUN_POSTED',
      entity: 'ProductionRun',
      referenceId: runNo,
      previousValue: { finishedMurukkuStock: 50, flourStock: 160, oilStock: 30, pouchStock: 500 },
      newValue: {
        finishedMurukkuStock: 238,
        flourStock: 120,
        oilStock: 19.5,
        spiceStock: 3.8,
        pouchStock: 306,
        cartonStock: 21,
        costPerPacketPaise: costSummary.costPerGoodPacketPaise,
      },
    });

    // =========================================================================
    // MANDATORY BENCHMARK STEP 3 — SALES, GST INVOICE, DISPATCH, PAYMENT & SHORTAGE
    // 1. Retailer A (Tamil Nadu — Intra-state 5% GST): 150 pkts Murukku @ ₹50
    //    Taxable ₹7,500 | CGST ₹187.50 | SGST ₹187.50 | Grand Total ₹7,875.00
    //    Dispatched 150 pkts -> Murukku stock 238 - 150 = 88 pkts
    //    Partial payment ₹4,000.00 -> Retailer A Outstanding = ₹3,875.00
    // 2. Distributor B (Karnataka — Inter-state 5% IGST): 120 pkts Murukku @ ₹50
    //    Pending order vs 88 pkts available -> Shortage = 32 packets
    // =========================================================================
    const line1 = calculateGstLine({ quantity: 150, unitPricePaise: 5000, gstPct: 5, isInterState: false });
    const [ord1] = await tx
      .insert(orders)
      .values({
        orderNo: 'ORD-2026-0001',
        customerId: retailerA.id,
        salesmanId: salesmanUser.id,
        orderDate: '2026-11-15',
        status: 'DISPATCHED',
        subtotalPaise: line1.taxableValuePaise, // 750000 (₹7,500.00)
        taxPaise: line1.totalTaxPaise, // 37500 (₹375.00)
        totalPaise: line1.lineTotalPaise, // 787500 (₹7,875.00)
        notes: 'Benchmark Step 3: Retailer A intra-state order — 150 pkts Murukku 200 g dispatched',
        approvedById: adminUser.id,
        approvedAt: new Date('2026-11-15T10:30:00Z'),
        dispatchedAt: new Date('2026-11-15T15:00:00Z'),
      })
      .returning();

    await tx.insert(orderItems).values({
      orderId: ord1.id,
      productId: murukku.id,
      quantity: 150,
      dispatchedQty: 150,
      unitPricePaise: 5000,
      gstPct: 5,
      taxablePaise: line1.taxableValuePaise,
      taxPaise: line1.totalTaxPaise,
      lineTotalPaise: line1.lineTotalPaise,
    });

    const [inv1] = await tx
      .insert(invoices)
      .values({
        invoiceNo: 'FF/2026-27/0001',
        financialYear: '2026-27',
        orderId: ord1.id,
        customerId: retailerA.id,
        invoiceDate: '2026-11-15',
        dueDate: '2026-12-15',
        supplyType: 'INTRA_STATE',
        taxableValuePaise: line1.taxableValuePaise, // 750000
        cgstPaise: line1.cgstPaise, // 18750 (₹187.50)
        sgstPaise: line1.sgstPaise, // 18750 (₹187.50)
        igstPaise: 0,
        grandTotalPaise: line1.lineTotalPaise, // 787500 (₹7,875.00)
        amountInWords: amountInWordsINR(line1.lineTotalPaise),
        paidPaise: 400000, // Partial payment ₹4,000.00 -> Outstanding ₹3,875.00
        status: 'PARTIALLY_PAID',
        dispatchStatus: 'DISPATCHED',
        createdById: adminUser.id,
      })
      .returning();

    await tx.insert(invoiceItems).values({
      invoiceId: inv1.id,
      productId: murukku.id,
      productName: murukku.name,
      hsnCode: murukku.hsnCode,
      quantity: 150,
      dispatchedQty: 150,
      unit: murukku.unit,
      unitPricePaise: 5000,
      taxableValuePaise: line1.taxableValuePaise,
      gstPct: 5,
      cgstPaise: line1.cgstPaise,
      sgstPaise: line1.sgstPaise,
      igstPaise: 0,
      lineTotalPaise: line1.lineTotalPaise,
    });

    // Deduct 150 packets Murukku 200 g on dispatch: 238 - 150 = 88 packets
    const murukkuAfterDispatch = roundQty(newMurukkuStock - 150); // 88 packets
    await tx
      .update(products)
      .set({ currentStock: murukkuAfterDispatch })
      .where(eq(products.id, murukku.id));

    await tx.insert(inventoryMovements).values({
      transactionId: 'TXN-DISP-0001-MRK',
      itemCategory: 'FINISHED',
      productId: murukku.id,
      itemName: murukku.name,
      unit: 'packets',
      movementType: 'SALES_DISPATCH',
      qtyIn: 0,
      qtyOut: 150,
      unitCostPaise: newMurukkuAvgCost,
      runningBalance: murukkuAfterDispatch, // 88 packets
      referenceType: 'INVOICE',
      referenceNo: inv1.invoiceNo,
      notes: 'Dispatched 150 packets Murukku 200 g to Retailer A — Tamil Nadu (238 - 150 = 88)',
      userId: adminUser.id,
    });

    await tx.insert(payments).values({
      paymentNo: 'PAY-2026-0001',
      invoiceId: inv1.id,
      customerId: retailerA.id,
      paymentDate: '2026-11-16',
      amountPaise: 400000, // ₹4,000.00 partial payment -> ₹3,875.00 outstanding
      paymentMode: 'UPI',
      referenceNo: 'UPI/632018491022',
      notes: 'Benchmark partial settlement ₹4,000 against FF/2026-27/0001 (Outstanding ₹3,875)',
      status: 'POSTED',
      recordedById: adminUser.id,
    });

    // Order 2: Distributor B (Karnataka — Inter-state IGST 5%) for 120 pkts Murukku 200 g
    // Available stock = 88 packets -> Stock shortage = 32 packets
    const line2 = calculateGstLine({ quantity: 120, unitPricePaise: 5000, gstPct: 5, isInterState: true });
    const [ord2] = await tx
      .insert(orders)
      .values({
        orderNo: 'ORD-2026-0002',
        customerId: distributorB.id,
        salesmanId: salesmanUser.id,
        orderDate: new Date().toISOString().slice(0, 10),
        status: 'SUBMITTED',
        subtotalPaise: line2.taxableValuePaise, // 600000 (₹6,000.00)
        taxPaise: line2.totalTaxPaise, // 30000 (₹300.00 IGST)
        totalPaise: line2.lineTotalPaise, // 630000 (₹6,300.00)
        notes: 'Benchmark Step 3: Distributor B demands 120 pkts Murukku 200 g (88 avail -> 32 pkts shortage)',
      })
      .returning();

    await tx.insert(orderItems).values({
      orderId: ord2.id,
      productId: murukku.id,
      quantity: 120,
      dispatchedQty: 0,
      unitPricePaise: 5000,
      gstPct: 5,
      taxablePaise: line2.taxableValuePaise,
      taxPaise: line2.totalTaxPaise,
      lineTotalPaise: line2.lineTotalPaise,
    });

    // Order 3: Distributor B (Karnataka — Inter-state IGST 5%) historical Ribbon Pakoda order (Dispatched)
    // Keeps inter-state GST & 31-60 day ageing reports populated without affecting Murukku 200 g stock (88) or Retailer A balance (₹3,875)
    const line3 = calculateGstLine({ quantity: 15, unitPricePaise: 5500, gstPct: 5, isInterState: true });
    const [ord3] = await tx
      .insert(orders)
      .values({
        orderNo: 'ORD-2026-0003',
        customerId: distributorB.id,
        salesmanId: salesmanUser.id,
        orderDate: '2026-10-08',
        status: 'DISPATCHED',
        subtotalPaise: line3.taxableValuePaise,
        taxPaise: line3.totalTaxPaise,
        totalPaise: line3.lineTotalPaise,
        notes: 'Historical inter-state Bengaluru wholesale order (Ribbon Pakoda 200 g)',
        approvedById: adminUser.id,
        approvedAt: new Date('2026-10-08T11:00:00Z'),
        dispatchedAt: new Date('2026-10-09T14:00:00Z'),
      })
      .returning();

    await tx.insert(orderItems).values({
      orderId: ord3.id,
      productId: ribbonPakoda.id,
      quantity: 15,
      dispatchedQty: 15,
      unitPricePaise: 5500,
      gstPct: 5,
      taxablePaise: line3.taxableValuePaise,
      taxPaise: line3.totalTaxPaise,
      lineTotalPaise: line3.lineTotalPaise,
    });

    const [inv2] = await tx
      .insert(invoices)
      .values({
        invoiceNo: 'FF/2026-27/0002',
        financialYear: '2026-27',
        orderId: ord3.id,
        customerId: distributorB.id,
        invoiceDate: '2026-10-08',
        dueDate: '2026-11-07',
        supplyType: 'INTER_STATE',
        taxableValuePaise: line3.taxableValuePaise,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: line3.igstPaise,
        grandTotalPaise: line3.lineTotalPaise,
        amountInWords: amountInWordsINR(line3.lineTotalPaise),
        paidPaise: 0,
        status: 'POSTED',
        dispatchStatus: 'DISPATCHED',
        createdById: adminUser.id,
      })
      .returning();

    await tx.insert(invoiceItems).values({
      invoiceId: inv2.id,
      productId: ribbonPakoda.id,
      productName: ribbonPakoda.name,
      hsnCode: ribbonPakoda.hsnCode,
      quantity: 15,
      dispatchedQty: 15,
      unit: ribbonPakoda.unit,
      unitPricePaise: 5500,
      taxableValuePaise: line3.taxableValuePaise,
      gstPct: 5,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: line3.igstPaise,
      lineTotalPaise: line3.lineTotalPaise,
    });

    await tx
      .update(products)
      .set({ currentStock: 30 }) // 45 - 15 = 30
      .where(eq(products.id, ribbonPakoda.id));

    await tx.insert(inventoryMovements).values({
      transactionId: 'TXN-DISP-0002-RBP',
      itemCategory: 'FINISHED',
      productId: ribbonPakoda.id,
      itemName: ribbonPakoda.name,
      unit: 'packets',
      movementType: 'SALES_DISPATCH',
      qtyIn: 0,
      qtyOut: 15,
      unitCostPaise: 3000,
      runningBalance: 30,
      referenceType: 'INVOICE',
      referenceNo: inv2.invoiceNo,
      notes: 'Dispatched 15 packets Ribbon Pakoda to Distributor B — Karnataka',
      userId: adminUser.id,
    });

    await recordAuditLog(tx, {
      user: adminUser,
      action: 'INVOICE_POSTED',
      entity: 'Invoice',
      referenceId: inv1.invoiceNo,
      newValue: {
        customer: retailerA.name,
        supplyType: 'INTRA_STATE',
        cgstPaise: inv1.cgstPaise,
        sgstPaise: inv1.sgstPaise,
        grandTotalPaise: inv1.grandTotalPaise,
      },
    });

    await recordAuditLog(tx, {
      user: adminUser,
      action: 'INVOICE_DISPATCHED',
      entity: 'Invoice',
      referenceId: inv1.invoiceNo,
      previousValue: { murukkuStock: 238 },
      newValue: { murukkuStock: 88, dispatchedQty: 150 },
    });

    await recordAuditLog(tx, {
      user: adminUser,
      action: 'PAYMENT_RECORDED',
      entity: 'Payment',
      referenceId: 'PAY-2026-0001',
      newValue: {
        invoiceNo: inv1.invoiceNo,
        amountPaise: 400000,
        outstandingPaise: 387500,
        mode: 'UPI',
      },
    });

    await recordAuditLog(tx, {
      user: salesmanUser,
      action: 'ORDER_SUBMITTED',
      entity: 'Order',
      referenceId: ord2.orderNo,
      newValue: {
        customer: distributorB.name,
        orderedQty: 120,
        availableQty: 88,
        shortageQty: 32,
        totalPaise: ord2.totalPaise,
      },
    });

    // Keep supplier references used (avoid unused vars lint)
    void supplierOil;
    void supplierPack;
  });
}
