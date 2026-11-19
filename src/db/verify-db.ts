import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, checkDatabaseHealth, closeDatabasePool } from './index.ts';

const REQUIRED_TABLES = [
  'roles',
  'users',
  'company_settings',
  'customers',
  'suppliers',
  'products',
  'raw_materials',
  'packaging_materials',
  'boms',
  'bom_items',
  'purchases',
  'purchase_items',
  'production_runs',
  'production_consumptions',
  'orders',
  'order_items',
  'invoices',
  'invoice_items',
  'credit_notes',
  'payments',
  'inventory_movements',
  'audit_logs',
] as const;

async function main() {
  try {
    const health = await checkDatabaseHealth();
    if (!health.connected) {
      console.error('[FactoryFlow ERP] Database connectivity check failed (Cloud SQL unreachable).');
      process.exitCode = 1;
      return;
    }

    const result = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const existingTables = new Set(
      (result.rows as Array<{ table_name: string }>).map((row) => row.table_name)
    );

    const missing = REQUIRED_TABLES.filter((t) => !existingTables.has(t));
    if (missing.length > 0) {
      console.error(`[FactoryFlow ERP] Missing required PostgreSQL tables: ${missing.join(', ')}`);
      console.error('Run `npm run db:push` or `npm run db:migrate` to apply the Drizzle schema.');
      process.exitCode = 1;
      return;
    }

    console.log(
      `[FactoryFlow ERP] Cloud SQL PostgreSQL verified (mode=${health.mode}, latency=${health.latencyMs}ms).`
    );
    console.log(
      `[FactoryFlow ERP] All ${REQUIRED_TABLES.length}/${REQUIRED_TABLES.length} schema tables exist in public schema.`
    );
  } catch (err) {
    console.error(
      '[FactoryFlow ERP] Schema verification error:',
      err instanceof Error ? err.message : 'Unknown error'
    );
    process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}

main();
