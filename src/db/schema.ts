import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  doublePrecision,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // SALESMAN, ADMIN, PRODUCTION_SUPERVISOR, OWNER, AUDITOR
  name: text('name').notNull(),
  description: text('description').notNull(),
  permissionsJson: text('permissions_json').notNull(),
});

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    roleId: integer('role_id')
      .references(() => roles.id)
      .notNull(),
    roleCode: text('role_code').notNull(),
    phone: text('phone').default(''),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('idx_users_role_code').on(t.roleCode)]
);

export const companySettings = pgTable('company_settings', {
  id: serial('id').primaryKey(),
  companyName: text('company_name').notNull(),
  gstin: text('gstin').notNull(),
  address: text('address').notNull(),
  state: text('state').notNull(),
  stateCode: text('state_code').notNull(),
  phone: text('phone').notNull(),
  email: text('email').notNull(),
  varianceTolerancePct: doublePrecision('variance_tolerance_pct').default(3).notNull(),
  costingMethod: text('costing_method').default('WEIGHTED_AVERAGE').notNull(),
  invoicePrefix: text('invoice_prefix').default('FF').notNull(),
  financialYear: text('financial_year').default('2026-27').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const customers = pgTable(
  'customers',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    customerType: text('customer_type').notNull(), // RETAILER | DISTRIBUTOR
    gstin: text('gstin').notNull(),
    phone: text('phone').notNull(),
    address: text('address').notNull(),
    state: text('state').notNull(),
    stateCode: text('state_code').notNull(),
    creditLimitPaise: bigint('credit_limit_paise', { mode: 'number' }).default(0).notNull(),
    assignedSalesmanId: integer('assigned_salesman_id').references(() => users.id),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('idx_customers_salesman').on(t.assignedSalesmanId)]
);

export const suppliers = pgTable('suppliers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  gstin: text('gstin').notNull(),
  phone: text('phone').notNull(),
  email: text('email').default('').notNull(),
  address: text('address').notNull(),
  state: text('state').notNull(),
  stateCode: text('state_code').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  sku: text('sku').notNull().unique(),
  packSize: text('pack_size').notNull(),
  hsnCode: text('hsn_code').notNull(),
  gstPct: doublePrecision('gst_pct').notNull(),
  sellingPricePaise: bigint('selling_price_paise', { mode: 'number' }).notNull(),
  unit: text('unit').notNull(),
  minStockLevel: doublePrecision('min_stock_level').default(25).notNull(),
  currentStock: doublePrecision('current_stock').default(0).notNull(),
  avgCostPaise: bigint('avg_cost_paise', { mode: 'number' }).default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const rawMaterials = pgTable('raw_materials', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  unit: text('unit').notNull(), // kg | litre
  baseUnit: text('base_unit').notNull(), // g | ml
  conversionFactor: doublePrecision('conversion_factor').default(1000).notNull(),
  minStockLevel: doublePrecision('min_stock_level').default(10).notNull(),
  currentStock: doublePrecision('current_stock').default(0).notNull(),
  weightedAvgRatePaise: bigint('weighted_avg_rate_paise', { mode: 'number' }).default(0).notNull(),
  // Store exact numerator/denominator for precision valuation
  totalValuationPaise: bigint('total_valuation_paise', { mode: 'number' }).default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const packagingMaterials = pgTable('packaging_materials', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  unit: text('unit').notNull(), // pieces | cartons
  minStockLevel: doublePrecision('min_stock_level').default(50).notNull(),
  currentStock: doublePrecision('current_stock').default(0).notNull(),
  weightedAvgRatePaise: bigint('weighted_avg_rate_paise', { mode: 'number' }).default(0).notNull(),
  totalValuationPaise: bigint('total_valuation_paise', { mode: 'number' }).default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const boms = pgTable('boms', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  productId: integer('product_id')
    .references(() => products.id)
    .notNull(),
  name: text('name').notNull(),
  batchSize: doublePrecision('batch_size').default(1).notNull(),
  expectedOutputQty: doublePrecision('expected_output_qty').notNull(),
  outputUnit: text('output_unit').default('packets').notNull(),
  standardWastageTolerancePct: doublePrecision('standard_wastage_tolerance_pct').default(3).notNull(),
  standardLabourCostPaise: bigint('standard_labour_cost_paise', { mode: 'number' }).default(60000).notNull(),
  standardGasPowerCostPaise: bigint('standard_gas_power_cost_paise', { mode: 'number' }).default(35000).notNull(),
  standardOverheadCostPaise: bigint('standard_overhead_cost_paise', { mode: 'number' }).default(15000).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const bomItems = pgTable(
  'bom_items',
  {
    id: serial('id').primaryKey(),
    bomId: integer('bom_id')
      .references(() => boms.id, { onDelete: 'cascade' })
      .notNull(),
    materialCategory: text('material_category').notNull(), // RAW | PACKAGING
    rawMaterialId: integer('raw_material_id').references(() => rawMaterials.id),
    packagingMaterialId: integer('packaging_material_id').references(() => packagingMaterials.id),
    standardQty: doublePrecision('standard_qty').notNull(),
    unit: text('unit').notNull(),
    wastageTolerancePct: doublePrecision('wastage_tolerance_pct').default(3).notNull(),
  },
  (t) => [index('idx_bom_items_bom').on(t.bomId)]
);

export const purchases = pgTable(
  'purchases',
  {
    id: serial('id').primaryKey(),
    purchaseNo: text('purchase_no').notNull().unique(),
    supplierId: integer('supplier_id')
      .references(() => suppliers.id)
      .notNull(),
    purchaseDate: text('purchase_date').notNull(),
    invoiceRef: text('invoice_ref').default('').notNull(),
    status: text('status').default('RECEIVED').notNull(), // DRAFT | RECEIVED | CANCELLED
    subtotalPaise: bigint('subtotal_paise', { mode: 'number' }).default(0).notNull(),
    gstPaise: bigint('gst_paise', { mode: 'number' }).default(0).notNull(),
    totalPaise: bigint('total_paise', { mode: 'number' }).default(0).notNull(),
    notes: text('notes').default('').notNull(),
    createdById: integer('created_by_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('idx_purchases_date').on(t.purchaseDate)]
);

export const purchaseItems = pgTable(
  'purchase_items',
  {
    id: serial('id').primaryKey(),
    purchaseId: integer('purchase_id')
      .references(() => purchases.id, { onDelete: 'cascade' })
      .notNull(),
    materialCategory: text('material_category').notNull(), // RAW | PACKAGING
    rawMaterialId: integer('raw_material_id').references(() => rawMaterials.id),
    packagingMaterialId: integer('packaging_material_id').references(() => packagingMaterials.id),
    quantity: doublePrecision('quantity').notNull(),
    unit: text('unit').notNull(),
    ratePaise: bigint('rate_paise', { mode: 'number' }).notNull(),
    gstPct: doublePrecision('gst_pct').default(5).notNull(),
    lineTotalPaise: bigint('line_total_paise', { mode: 'number' }).notNull(),
  },
  (t) => [index('idx_purchase_items_purchase').on(t.purchaseId)]
);

export const productionRuns = pgTable(
  'production_runs',
  {
    id: serial('id').primaryKey(),
    runNo: text('run_no').notNull().unique(),
    productId: integer('product_id')
      .references(() => products.id)
      .notNull(),
    bomId: integer('bom_id')
      .references(() => boms.id)
      .notNull(),
    runDate: text('run_date').notNull(),
    batchQty: doublePrecision('batch_qty').notNull(),
    expectedOutputQty: doublePrecision('expected_output_qty').notNull(),
    actualGoodOutputQty: doublePrecision('actual_good_output_qty').notNull(),
    damagedPackagingQty: doublePrecision('damaged_packaging_qty').default(0).notNull(),
    wastageQty: doublePrecision('wastage_qty').default(0).notNull(),
    wastageUnit: text('wastage_unit').default('packets').notNull(),
    yieldVariancePct: doublePrecision('yield_variance_pct').default(0).notNull(),
    hasVarianceAlert: boolean('has_variance_alert').default(false).notNull(),
    rawMaterialCostPaise: bigint('raw_material_cost_paise', { mode: 'number' }).default(0).notNull(),
    packagingCostPaise: bigint('packaging_cost_paise', { mode: 'number' }).default(0).notNull(),
    labourCostPaise: bigint('labour_cost_paise', { mode: 'number' }).default(0).notNull(),
    gasPowerCostPaise: bigint('gas_power_cost_paise', { mode: 'number' }).default(0).notNull(),
    otherOverheadPaise: bigint('other_overhead_paise', { mode: 'number' }).default(0).notNull(),
    totalCostPaise: bigint('total_cost_paise', { mode: 'number' }).default(0).notNull(),
    costPerPacketPaise: bigint('cost_per_packet_paise', { mode: 'number' }).default(0).notNull(),
    status: text('status').default('COMPLETED').notNull(), // COMPLETED | REVERSED
    notes: text('notes').default('').notNull(),
    createdById: integer('created_by_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('idx_production_runs_date').on(t.runDate)]
);

export const productionConsumptions = pgTable(
  'production_consumptions',
  {
    id: serial('id').primaryKey(),
    productionRunId: integer('production_run_id')
      .references(() => productionRuns.id, { onDelete: 'cascade' })
      .notNull(),
    materialCategory: text('material_category').notNull(), // RAW | PACKAGING
    rawMaterialId: integer('raw_material_id').references(() => rawMaterials.id),
    packagingMaterialId: integer('packaging_material_id').references(() => packagingMaterials.id),
    materialName: text('material_name').notNull(),
    plannedQty: doublePrecision('planned_qty').notNull(),
    actualQty: doublePrecision('actual_qty').notNull(),
    damagedQty: doublePrecision('damaged_qty').default(0).notNull(),
    unit: text('unit').notNull(),
    variancePct: doublePrecision('variance_pct').default(0).notNull(),
    isFlagged: boolean('is_flagged').default(false).notNull(),
    unitCostPaise: bigint('unit_cost_paise', { mode: 'number' }).default(0).notNull(),
    totalCostPaise: bigint('total_cost_paise', { mode: 'number' }).default(0).notNull(),
  },
  (t) => [index('idx_prod_cons_run').on(t.productionRunId)]
);

export const orders = pgTable(
  'orders',
  {
    id: serial('id').primaryKey(),
    orderNo: text('order_no').notNull().unique(),
    customerId: integer('customer_id')
      .references(() => customers.id)
      .notNull(),
    salesmanId: integer('salesman_id')
      .references(() => users.id)
      .notNull(),
    orderDate: text('order_date').notNull(),
    status: text('status').default('SUBMITTED').notNull(), // DRAFT | SUBMITTED | APPROVED | REJECTED | INVOICED | DISPATCHED
    subtotalPaise: bigint('subtotal_paise', { mode: 'number' }).default(0).notNull(),
    taxPaise: bigint('tax_paise', { mode: 'number' }).default(0).notNull(),
    totalPaise: bigint('total_paise', { mode: 'number' }).default(0).notNull(),
    notes: text('notes').default('').notNull(),
    rejectionReason: text('rejection_reason'),
    approvedById: integer('approved_by_id').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    dispatchedAt: timestamp('dispatched_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_orders_customer').on(t.customerId),
    index('idx_orders_salesman').on(t.salesmanId),
    index('idx_orders_status').on(t.status),
  ]
);

export const orderItems = pgTable(
  'order_items',
  {
    id: serial('id').primaryKey(),
    orderId: integer('order_id')
      .references(() => orders.id, { onDelete: 'cascade' })
      .notNull(),
    productId: integer('product_id')
      .references(() => products.id)
      .notNull(),
    quantity: doublePrecision('quantity').notNull(),
    dispatchedQty: doublePrecision('dispatched_qty').default(0).notNull(),
    unitPricePaise: bigint('unit_price_paise', { mode: 'number' }).notNull(),
    gstPct: doublePrecision('gst_pct').notNull(),
    taxablePaise: bigint('taxable_paise', { mode: 'number' }).notNull(),
    taxPaise: bigint('tax_paise', { mode: 'number' }).notNull(),
    lineTotalPaise: bigint('line_total_paise', { mode: 'number' }).notNull(),
  },
  (t) => [index('idx_order_items_order').on(t.orderId)]
);

export const invoices = pgTable(
  'invoices',
  {
    id: serial('id').primaryKey(),
    invoiceNo: text('invoice_no').notNull().unique(),
    financialYear: text('financial_year').notNull(),
    orderId: integer('order_id').references(() => orders.id),
    customerId: integer('customer_id')
      .references(() => customers.id)
      .notNull(),
    invoiceDate: text('invoice_date').notNull(),
    dueDate: text('due_date').notNull(),
    supplyType: text('supply_type').notNull(), // INTRA_STATE | INTER_STATE
    taxableValuePaise: bigint('taxable_value_paise', { mode: 'number' }).notNull(),
    cgstPaise: bigint('cgst_paise', { mode: 'number' }).default(0).notNull(),
    sgstPaise: bigint('sgst_paise', { mode: 'number' }).default(0).notNull(),
    igstPaise: bigint('igst_paise', { mode: 'number' }).default(0).notNull(),
    grandTotalPaise: bigint('grand_total_paise', { mode: 'number' }).notNull(),
    amountInWords: text('amount_in_words').notNull(),
    paidPaise: bigint('paid_paise', { mode: 'number' }).default(0).notNull(),
    status: text('status').default('POSTED').notNull(), // POSTED | PARTIALLY_PAID | PAID | REVERSED
    dispatchStatus: text('dispatch_status').default('PENDING').notNull(), // PENDING | PARTIAL | DISPATCHED
    createdById: integer('created_by_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_invoices_customer').on(t.customerId),
    index('idx_invoices_date').on(t.invoiceDate),
  ]
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: serial('id').primaryKey(),
    invoiceId: integer('invoice_id')
      .references(() => invoices.id, { onDelete: 'cascade' })
      .notNull(),
    productId: integer('product_id')
      .references(() => products.id)
      .notNull(),
    productName: text('product_name').notNull(),
    hsnCode: text('hsn_code').notNull(),
    quantity: doublePrecision('quantity').notNull(),
    dispatchedQty: doublePrecision('dispatched_qty').default(0).notNull(),
    unit: text('unit').notNull(),
    unitPricePaise: bigint('unit_price_paise', { mode: 'number' }).notNull(),
    taxableValuePaise: bigint('taxable_value_paise', { mode: 'number' }).notNull(),
    gstPct: doublePrecision('gst_pct').notNull(),
    cgstPaise: bigint('cgst_paise', { mode: 'number' }).default(0).notNull(),
    sgstPaise: bigint('sgst_paise', { mode: 'number' }).default(0).notNull(),
    igstPaise: bigint('igst_paise', { mode: 'number' }).default(0).notNull(),
    lineTotalPaise: bigint('line_total_paise', { mode: 'number' }).notNull(),
  },
  (t) => [index('idx_invoice_items_invoice').on(t.invoiceId)]
);

export const creditNotes = pgTable('credit_notes', {
  id: serial('id').primaryKey(),
  creditNoteNo: text('credit_note_no').notNull().unique(),
  invoiceId: integer('invoice_id')
    .references(() => invoices.id)
    .notNull(),
  customerId: integer('customer_id')
    .references(() => customers.id)
    .notNull(),
  issueDate: text('issue_date').notNull(),
  reason: text('reason').notNull(),
  taxableValuePaise: bigint('taxable_value_paise', { mode: 'number' }).notNull(),
  cgstPaise: bigint('cgst_paise', { mode: 'number' }).default(0).notNull(),
  sgstPaise: bigint('sgst_paise', { mode: 'number' }).default(0).notNull(),
  igstPaise: bigint('igst_paise', { mode: 'number' }).default(0).notNull(),
  totalPaise: bigint('total_paise', { mode: 'number' }).notNull(),
  createdById: integer('created_by_id')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const payments = pgTable(
  'payments',
  {
    id: serial('id').primaryKey(),
    paymentNo: text('payment_no').notNull().unique(),
    invoiceId: integer('invoice_id')
      .references(() => invoices.id)
      .notNull(),
    customerId: integer('customer_id')
      .references(() => customers.id)
      .notNull(),
    paymentDate: text('payment_date').notNull(),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    paymentMode: text('payment_mode').notNull(), // UPI | NEFT | RTGS | CHEQUE | CASH
    referenceNo: text('reference_no').notNull(),
    notes: text('notes').default('').notNull(),
    status: text('status').default('POSTED').notNull(), // POSTED | REVERSED
    recordedById: integer('recorded_by_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_payments_invoice').on(t.invoiceId),
    index('idx_payments_customer').on(t.customerId),
  ]
);

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: serial('id').primaryKey(),
    transactionId: text('transaction_id').notNull().unique(),
    itemCategory: text('item_category').notNull(), // RAW | PACKAGING | FINISHED
    rawMaterialId: integer('raw_material_id').references(() => rawMaterials.id),
    packagingMaterialId: integer('packaging_material_id').references(() => packagingMaterials.id),
    productId: integer('product_id').references(() => products.id),
    itemName: text('item_name').notNull(),
    unit: text('unit').notNull(),
    movementType: text('movement_type').notNull(),
    qtyIn: doublePrecision('qty_in').default(0).notNull(),
    qtyOut: doublePrecision('qty_out').default(0).notNull(),
    unitCostPaise: bigint('unit_cost_paise', { mode: 'number' }).default(0).notNull(),
    runningBalance: doublePrecision('running_balance').notNull(),
    referenceType: text('reference_type').notNull(),
    referenceNo: text('reference_no').notNull(),
    notes: text('notes').default('').notNull(),
    userId: integer('user_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_inv_mov_category').on(t.itemCategory),
    index('idx_inv_mov_created').on(t.createdAt),
    index('idx_inv_mov_ref').on(t.referenceNo),
  ]
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id),
    userName: text('user_name').notNull(),
    userRole: text('user_role').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    referenceId: text('reference_id').notNull(),
    previousValue: text('previous_value'),
    newValue: text('new_value'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_audit_entity').on(t.entity),
    index('idx_audit_created').on(t.createdAt),
  ]
);

// Relations
export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
}));

export const bomsRelations = relations(boms, ({ one, many }) => ({
  product: one(products, { fields: [boms.productId], references: [products.id] }),
  items: many(bomItems),
}));

export const bomItemsRelations = relations(bomItems, ({ one }) => ({
  bom: one(boms, { fields: [bomItems.bomId], references: [boms.id] }),
  rawMaterial: one(rawMaterials, { fields: [bomItems.rawMaterialId], references: [rawMaterials.id] }),
  packagingMaterial: one(packagingMaterials, {
    fields: [bomItems.packagingMaterialId],
    references: [packagingMaterials.id],
  }),
}));
