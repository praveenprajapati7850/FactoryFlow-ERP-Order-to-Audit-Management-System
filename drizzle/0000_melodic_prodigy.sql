CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_name" text NOT NULL,
	"user_role" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"reference_id" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bom_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"bom_id" integer NOT NULL,
	"material_category" text NOT NULL,
	"raw_material_id" integer,
	"packaging_material_id" integer,
	"standard_qty" double precision NOT NULL,
	"unit" text NOT NULL,
	"wastage_tolerance_pct" double precision DEFAULT 3 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boms" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"product_id" integer NOT NULL,
	"name" text NOT NULL,
	"batch_size" double precision DEFAULT 1 NOT NULL,
	"expected_output_qty" double precision NOT NULL,
	"output_unit" text DEFAULT 'packets' NOT NULL,
	"standard_wastage_tolerance_pct" double precision DEFAULT 3 NOT NULL,
	"standard_labour_cost_paise" bigint DEFAULT 60000 NOT NULL,
	"standard_gas_power_cost_paise" bigint DEFAULT 35000 NOT NULL,
	"standard_overhead_cost_paise" bigint DEFAULT 15000 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "boms_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"gstin" text NOT NULL,
	"address" text NOT NULL,
	"state" text NOT NULL,
	"state_code" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"variance_tolerance_pct" double precision DEFAULT 3 NOT NULL,
	"costing_method" text DEFAULT 'WEIGHTED_AVERAGE' NOT NULL,
	"invoice_prefix" text DEFAULT 'FF' NOT NULL,
	"financial_year" text DEFAULT '2026-27' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"credit_note_no" text NOT NULL,
	"invoice_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"issue_date" text NOT NULL,
	"reason" text NOT NULL,
	"taxable_value_paise" bigint NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_credit_note_no_unique" UNIQUE("credit_note_no")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"customer_type" text NOT NULL,
	"gstin" text NOT NULL,
	"phone" text NOT NULL,
	"address" text NOT NULL,
	"state" text NOT NULL,
	"state_code" text NOT NULL,
	"credit_limit_paise" bigint DEFAULT 0 NOT NULL,
	"assigned_salesman_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"item_category" text NOT NULL,
	"raw_material_id" integer,
	"packaging_material_id" integer,
	"product_id" integer,
	"item_name" text NOT NULL,
	"unit" text NOT NULL,
	"movement_type" text NOT NULL,
	"qty_in" double precision DEFAULT 0 NOT NULL,
	"qty_out" double precision DEFAULT 0 NOT NULL,
	"unit_cost_paise" bigint DEFAULT 0 NOT NULL,
	"running_balance" double precision NOT NULL,
	"reference_type" text NOT NULL,
	"reference_no" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"product_name" text NOT NULL,
	"hsn_code" text NOT NULL,
	"quantity" double precision NOT NULL,
	"dispatched_qty" double precision DEFAULT 0 NOT NULL,
	"unit" text NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"taxable_value_paise" bigint NOT NULL,
	"gst_pct" double precision NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"line_total_paise" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_no" text NOT NULL,
	"financial_year" text NOT NULL,
	"order_id" integer,
	"customer_id" integer NOT NULL,
	"invoice_date" text NOT NULL,
	"due_date" text NOT NULL,
	"supply_type" text NOT NULL,
	"taxable_value_paise" bigint NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"grand_total_paise" bigint NOT NULL,
	"amount_in_words" text NOT NULL,
	"paid_paise" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"dispatch_status" text DEFAULT 'PENDING' NOT NULL,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_no_unique" UNIQUE("invoice_no")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" double precision NOT NULL,
	"dispatched_qty" double precision DEFAULT 0 NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"gst_pct" double precision NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"tax_paise" bigint NOT NULL,
	"line_total_paise" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_no" text NOT NULL,
	"customer_id" integer NOT NULL,
	"salesman_id" integer NOT NULL,
	"order_date" text NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"subtotal_paise" bigint DEFAULT 0 NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"rejection_reason" text,
	"approved_by_id" integer,
	"approved_at" timestamp,
	"dispatched_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_no_unique" UNIQUE("order_no")
);
--> statement-breakpoint
CREATE TABLE "packaging_materials" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"unit" text NOT NULL,
	"min_stock_level" double precision DEFAULT 50 NOT NULL,
	"current_stock" double precision DEFAULT 0 NOT NULL,
	"weighted_avg_rate_paise" bigint DEFAULT 0 NOT NULL,
	"total_valuation_paise" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "packaging_materials_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_no" text NOT NULL,
	"invoice_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"payment_date" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"payment_mode" text NOT NULL,
	"reference_no" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"recorded_by_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payments_payment_no_unique" UNIQUE("payment_no")
);
--> statement-breakpoint
CREATE TABLE "production_consumptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"production_run_id" integer NOT NULL,
	"material_category" text NOT NULL,
	"raw_material_id" integer,
	"packaging_material_id" integer,
	"material_name" text NOT NULL,
	"planned_qty" double precision NOT NULL,
	"actual_qty" double precision NOT NULL,
	"damaged_qty" double precision DEFAULT 0 NOT NULL,
	"unit" text NOT NULL,
	"variance_pct" double precision DEFAULT 0 NOT NULL,
	"is_flagged" boolean DEFAULT false NOT NULL,
	"unit_cost_paise" bigint DEFAULT 0 NOT NULL,
	"total_cost_paise" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_no" text NOT NULL,
	"product_id" integer NOT NULL,
	"bom_id" integer NOT NULL,
	"run_date" text NOT NULL,
	"batch_qty" double precision NOT NULL,
	"expected_output_qty" double precision NOT NULL,
	"actual_good_output_qty" double precision NOT NULL,
	"damaged_packaging_qty" double precision DEFAULT 0 NOT NULL,
	"wastage_qty" double precision DEFAULT 0 NOT NULL,
	"wastage_unit" text DEFAULT 'packets' NOT NULL,
	"yield_variance_pct" double precision DEFAULT 0 NOT NULL,
	"has_variance_alert" boolean DEFAULT false NOT NULL,
	"raw_material_cost_paise" bigint DEFAULT 0 NOT NULL,
	"packaging_cost_paise" bigint DEFAULT 0 NOT NULL,
	"labour_cost_paise" bigint DEFAULT 0 NOT NULL,
	"gas_power_cost_paise" bigint DEFAULT 0 NOT NULL,
	"other_overhead_paise" bigint DEFAULT 0 NOT NULL,
	"total_cost_paise" bigint DEFAULT 0 NOT NULL,
	"cost_per_packet_paise" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'COMPLETED' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "production_runs_run_no_unique" UNIQUE("run_no")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"pack_size" text NOT NULL,
	"hsn_code" text NOT NULL,
	"gst_pct" double precision NOT NULL,
	"selling_price_paise" bigint NOT NULL,
	"unit" text NOT NULL,
	"min_stock_level" double precision DEFAULT 25 NOT NULL,
	"current_stock" double precision DEFAULT 0 NOT NULL,
	"avg_cost_paise" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "purchase_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchase_id" integer NOT NULL,
	"material_category" text NOT NULL,
	"raw_material_id" integer,
	"packaging_material_id" integer,
	"quantity" double precision NOT NULL,
	"unit" text NOT NULL,
	"rate_paise" bigint NOT NULL,
	"gst_pct" double precision DEFAULT 5 NOT NULL,
	"line_total_paise" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchase_no" text NOT NULL,
	"supplier_id" integer NOT NULL,
	"purchase_date" text NOT NULL,
	"invoice_ref" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"subtotal_paise" bigint DEFAULT 0 NOT NULL,
	"gst_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_purchase_no_unique" UNIQUE("purchase_no")
);
--> statement-breakpoint
CREATE TABLE "raw_materials" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"unit" text NOT NULL,
	"base_unit" text NOT NULL,
	"conversion_factor" double precision DEFAULT 1000 NOT NULL,
	"min_stock_level" double precision DEFAULT 10 NOT NULL,
	"current_stock" double precision DEFAULT 0 NOT NULL,
	"weighted_avg_rate_paise" bigint DEFAULT 0 NOT NULL,
	"total_valuation_paise" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "raw_materials_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"permissions_json" text NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"gstin" text NOT NULL,
	"phone" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"address" text NOT NULL,
	"state" text NOT NULL,
	"state_code" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"role_id" integer NOT NULL,
	"role_code" text NOT NULL,
	"phone" text DEFAULT '',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_uid_unique" UNIQUE("uid"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_raw_material_id_raw_materials_id_fk" FOREIGN KEY ("raw_material_id") REFERENCES "public"."raw_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_packaging_material_id_packaging_materials_id_fk" FOREIGN KEY ("packaging_material_id") REFERENCES "public"."packaging_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_assigned_salesman_id_users_id_fk" FOREIGN KEY ("assigned_salesman_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_raw_material_id_raw_materials_id_fk" FOREIGN KEY ("raw_material_id") REFERENCES "public"."raw_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_packaging_material_id_packaging_materials_id_fk" FOREIGN KEY ("packaging_material_id") REFERENCES "public"."packaging_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_salesman_id_users_id_fk" FOREIGN KEY ("salesman_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_consumptions" ADD CONSTRAINT "production_consumptions_production_run_id_production_runs_id_fk" FOREIGN KEY ("production_run_id") REFERENCES "public"."production_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_consumptions" ADD CONSTRAINT "production_consumptions_raw_material_id_raw_materials_id_fk" FOREIGN KEY ("raw_material_id") REFERENCES "public"."raw_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_consumptions" ADD CONSTRAINT "production_consumptions_packaging_material_id_packaging_materials_id_fk" FOREIGN KEY ("packaging_material_id") REFERENCES "public"."packaging_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_raw_material_id_raw_materials_id_fk" FOREIGN KEY ("raw_material_id") REFERENCES "public"."raw_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_packaging_material_id_packaging_materials_id_fk" FOREIGN KEY ("packaging_material_id") REFERENCES "public"."packaging_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_entity" ON "audit_logs" USING btree ("entity");--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_bom_items_bom" ON "bom_items" USING btree ("bom_id");--> statement-breakpoint
CREATE INDEX "idx_customers_salesman" ON "customers" USING btree ("assigned_salesman_id");--> statement-breakpoint
CREATE INDEX "idx_inv_mov_category" ON "inventory_movements" USING btree ("item_category");--> statement-breakpoint
CREATE INDEX "idx_inv_mov_created" ON "inventory_movements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_inv_mov_ref" ON "inventory_movements" USING btree ("reference_no");--> statement-breakpoint
CREATE INDEX "idx_invoice_items_invoice" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_customer" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_date" ON "invoices" USING btree ("invoice_date");--> statement-breakpoint
CREATE INDEX "idx_order_items_order" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_orders_customer" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_orders_salesman" ON "orders" USING btree ("salesman_id");--> statement-breakpoint
CREATE INDEX "idx_orders_status" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payments_invoice" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_payments_customer" ON "payments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_prod_cons_run" ON "production_consumptions" USING btree ("production_run_id");--> statement-breakpoint
CREATE INDEX "idx_production_runs_date" ON "production_runs" USING btree ("run_date");--> statement-breakpoint
CREATE INDEX "idx_purchase_items_purchase" ON "purchase_items" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_date" ON "purchases" USING btree ("purchase_date");--> statement-breakpoint
CREATE INDEX "idx_users_role_code" ON "users" USING btree ("role_code");