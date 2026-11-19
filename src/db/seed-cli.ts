import 'dotenv/config';
import { pool, db } from './index.ts';
import { seedBenchmarkScenario } from './seed.ts';
import { rawMaterials, packagingMaterials, products, invoices } from './schema.ts';

async function main() {
  const reset = process.argv.includes('--reset');
  console.log(`[FactoryFlow ERP] Seeding PostgreSQL database (reset=${reset})...`);
  await seedBenchmarkScenario(reset);

  const [raws, packs, prods, invs] = await Promise.all([
    db.select().from(rawMaterials),
    db.select().from(packagingMaterials),
    db.select().from(products),
    db.select().from(invoices),
  ]);

  console.log('[FactoryFlow ERP] Benchmark seed completed successfully:');
  for (const r of raws) {
    console.log(`  Raw: ${r.name} = ${r.currentStock} ${r.unit} (avg ₹${(r.weightedAvgRatePaise / 100).toFixed(2)})`);
  }
  for (const p of packs) {
    console.log(`  Packaging: ${p.name} = ${p.currentStock} ${p.unit}`);
  }
  for (const pr of prods) {
    console.log(`  Finished: ${pr.name} = ${pr.currentStock} ${pr.unit}`);
  }
  for (const inv of invs) {
    console.log(
      `  Invoice ${inv.invoiceNo}: Total ₹${(inv.grandTotalPaise / 100).toFixed(2)}, Paid ₹${(inv.paidPaise / 100).toFixed(2)}, Outstanding ₹${((inv.grandTotalPaise - inv.paidPaise) / 100).toFixed(2)}`,
    );
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[FactoryFlow ERP] Seed failed:', err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
