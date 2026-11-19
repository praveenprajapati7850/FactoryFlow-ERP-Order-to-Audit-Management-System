import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { resolveDatabaseConfig, toPgPoolConfig } from './config.ts';
import { SESSION_COOKIE_NAME, CSRF_COOKIE_NAME } from '../middleware/authPolicy.ts';

/**
 * Isolated End-to-End Live PostgreSQL Integration Test Suite
 *
 * Provisions an ephemeral PostgreSQL database (`factoryflow_test_*`) using SQL_ADMIN_USER,
 * applies the exact Drizzle DDL migration (`drizzle/0000_melodic_prodigy.sql`), mounts the real
 * Express API routers, executes live write/update/deactivate/rollback/FK/duplicate/audit tests
 * across all 10 ERP domains, and drops the ephemeral database in teardown.
 *
 * NEVER modifies or touches the live benchmark database (`cloud_sql_development_database`).
 */

const adminConfig = resolveDatabaseConfig(process.env, { useAdminCredentials: true });
const hasAdminConfig = Boolean(adminConfig.host && adminConfig.user && adminConfig.password);
const testDbName = `factoryflow_test_${Date.now()}_${process.pid}`;

function createMaintenancePool() {
  return new Pool(
    toPgPoolConfig({
      ...adminConfig,
      database: 'postgres',
      max: 2,
    })
  );
}

function extractSetCookieValue(setCookieHeaders: string[], name: string): string | null {
  for (const header of setCookieHeaders) {
    const firstSegment = header.split(';')[0] || '';
    const eqIdx = firstSegment.indexOf('=');
    if (eqIdx > 0 && firstSegment.slice(0, eqIdx).trim() === name) {
      return firstSegment.slice(eqIdx + 1).trim();
    }
  }
  return null;
}

test('Isolated live PostgreSQL write integration suite across all ERP modules', {
  skip: !hasAdminConfig ? 'SQL_ADMIN_USER credentials not configured' : false,
}, async (t) => {
  const maintPool = createMaintenancePool();
  let server: Server | null = null;
  let baseUrl = '';
  let closeAppPool: (() => Promise<void>) | null = null;

  try {
    // 1. Create completely isolated ephemeral PostgreSQL database
    await maintPool.query(`CREATE DATABASE "${testDbName}"`);

    // 2. Apply exact Drizzle DDL migration to the isolated test database
    const ddlPath = path.resolve(process.cwd(), 'drizzle/0000_melodic_prodigy.sql');
    const ddlRaw = fs.readFileSync(ddlPath, 'utf8');
    const statements = ddlRaw
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);

    const migrationPool = new Pool(
      toPgPoolConfig({
        ...adminConfig,
        database: testDbName,
        max: 2,
      })
    );
    try {
      for (const stmt of statements) {
        await migrationPool.query(stmt);
      }
    } finally {
      await migrationPool.end();
    }

    // 3. Point runtime DB module strictly at the isolated ephemeral database BEFORE dynamic import
    process.env.SQL_DB_NAME = testDbName;
    process.env.SQL_DATABASE = testDbName;
    process.env.SQL_USER = adminConfig.user;
    process.env.SQL_PASSWORD = adminConfig.password;

    const dbMod = await import('./index.ts');
    const schemaMod = await import('./schema.ts');
    const seedMod = await import('./seed.ts');
    const { csrfProtection } = await import('../middleware/auth.ts');
    const { authAndAdminRouter } = await import('../routes/authAndAdminRoutes.ts');
    const { mastersRouter } = await import('../routes/mastersRoutes.ts');
    const { productionRouter } = await import('../routes/productionRoutes.ts');
    const { salesAndFinanceRouter } = await import('../routes/salesAndFinanceRoutes.ts');

    closeAppPool = dbMod.closeDatabasePool;

    // Seed isolated test database with benchmark baseline
    await seedMod.seedBenchmarkScenario(true);

    // 4. Mount real Express API routers + csrfProtection on an ephemeral localhost port
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 1);
    app.use(express.json({ limit: '5mb' }));
    app.use('/api', csrfProtection);
    app.use('/api', authAndAdminRouter);
    app.use('/api', mastersRouter);
    app.use('/api', productionRouter);
    app.use('/api', salesAndFinanceRouter);

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Helper: login and return combined Cookie header (session + CSRF) + raw tokens
    const loginAs = async (email: string, password = 'Password@123') => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: baseUrl,
        },
        body: JSON.stringify({ email, password }),
      });
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      const data = await res.json();
      const sessionVal = extractSetCookieValue(setCookies, SESSION_COOKIE_NAME);
      const csrfVal = extractSetCookieValue(setCookies, CSRF_COOKIE_NAME);
      const cookieHeader = [
        sessionVal ? `${SESSION_COOKIE_NAME}=${sessionVal}` : '',
        csrfVal ? `${CSRF_COOKIE_NAME}=${csrfVal}` : '',
      ]
        .filter(Boolean)
        .join('; ');
      return { res, data, setCookies, sessionVal, csrfVal, cookieHeader };
    };

    const ownerLogin = await loginAs('owner@factoryflow.in');
    assert.equal(ownerLogin.res.status, 200);
    assert.ok(ownerLogin.sessionVal, 'Login must set HttpOnly factoryflow_session cookie');
    assert.ok(ownerLogin.csrfVal, 'Login must set double-submit factoryflow_csrf cookie');
    const ownerCookieHeader = ownerLogin.cookieHeader;

    const adminLogin = await loginAs('admin@factoryflow.in');
    const adminCookieHeader = adminLogin.cookieHeader;

    const supervisorLogin = await loginAs('supervisor@factoryflow.in');
    const supervisorCookieHeader = supervisorLogin.cookieHeader;

    const salesmanLogin = await loginAs('sales@factoryflow.in');
    const salesmanCookieHeader = salesmanLogin.cookieHeader;

    const auditorLogin = await loginAs('auditor@factoryflow.in');
    const auditorCookieHeader = auditorLogin.cookieHeader;

    const extractCsrfFromCookieHeader = (cookieHeader: string | undefined): string | null => {
      if (!cookieHeader) return null;
      for (const seg of cookieHeader.split(';')) {
        const idx = seg.indexOf('=');
        if (idx > 0 && seg.slice(0, idx).trim() === CSRF_COOKIE_NAME) {
          return seg.slice(idx + 1).trim();
        }
      }
      return null;
    };

    const api = async (
      endpoint: string,
      opts: {
        method?: string;
        cookie?: string;
        body?: unknown;
        origin?: string | null;
        csrfOverride?: string | null;
      } = {}
    ) => {
      const method = (opts.method || 'GET').toUpperCase();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (opts.cookie) headers.Cookie = opts.cookie;
      if (opts.origin !== null) {
        headers.Origin = opts.origin ?? baseUrl;
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        const csrfToken =
          opts.csrfOverride === undefined
            ? extractCsrfFromCookieHeader(opts.cookie)
            : opts.csrfOverride;
        if (csrfToken) {
          headers['X-CSRF-Token'] = csrfToken;
        }
      }
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const data = await res.json().catch(() => null);
      return { status: res.status, data, headers: res.headers };
    };

    // TEST 1: HttpOnly cookie session persistence, immediate logout revocation & cookie clearing
    await t.test('1. HttpOnly session cookie authenticates /api/auth/me and revokes immediately on logout', async () => {
      assert.ok(
        ownerLogin.setCookies.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`) && c.includes('HttpOnly') && c.includes('SameSite=')),
        'Session cookie must include HttpOnly and SameSite directives'
      );
      assert.ok(
        ownerLogin.setCookies.some((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`) && !c.includes('HttpOnly')),
        'CSRF cookie must be issued alongside session cookie without HttpOnly'
      );

      // Authenticated using ONLY Cookie header (no Bearer Authorization header)
      const meRes = await api('/api/auth/me', { cookie: ownerCookieHeader });
      assert.equal(meRes.status, 200);
      assert.equal(meRes.data.user.email, 'owner@factoryflow.in');

      // Dedicated ephemeral session logout check + replay rejection
      const tempLogin = await loginAs('supervisor@factoryflow.in');
      const logoutRes = await api('/api/auth/logout', { method: 'POST', cookie: tempLogin.cookieHeader });
      assert.equal(logoutRes.status, 200);
      const cleared = logoutRes.headers.getSetCookie ? logoutRes.headers.getSetCookie() : [];
      assert.ok(cleared.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`) && c.includes('Max-Age=0')), 'Logout must expire session cookie');
      assert.ok(cleared.some((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`) && c.includes('Max-Age=0')), 'Logout must expire CSRF cookie');

      // Replaying the logged-out session cookie MUST be rejected immediately with 401
      const replayed = await api('/api/auth/me', { cookie: tempLogin.cookieHeader });
      assert.equal(replayed.status, 401, 'Logged-out session JWT must be rejected on replay');

      // Request without cookie returns 401
      const unauth = await api('/api/auth/me');
      assert.equal(unauth.status, 401);
    });

    // TEST 2: Customers Create, Update, Soft Deactivate & Audit Log
    await t.test('2. Customers CRUD writes to PostgreSQL and logs audit entries', async () => {
      const created = await api('/api/customers', {
        method: 'POST',
        cookie: adminCookieHeader,
        body: {
          name: 'Trichy Supermart',
          customerType: 'RETAILER',
          gstin: '33AAACT1234A1Z5',
          phone: '9842100111',
          address: '12 Thillai Nagar, Tiruchirappalli',
          state: 'Tamil Nadu',
          stateCode: '33',
          creditLimitRupees: 75000,
          assignedSalesmanId: salesmanLogin.data.user.id,
        },
      });
      assert.equal(created.status, 201);
      assert.equal(created.data.name, 'Trichy Supermart');

      const updated = await api(`/api/customers/${created.data.id}`, {
        method: 'PUT',
        cookie: adminCookieHeader,
        body: {
          name: 'Trichy Supermart Pvt Ltd',
          customerType: 'RETAILER',
          gstin: '33AAACT1234A1Z5',
          phone: '9842100222',
          address: '12 Thillai Nagar, Tiruchirappalli',
          state: 'Tamil Nadu',
          stateCode: '33',
          creditLimitRupees: 90000,
          assignedSalesmanId: salesmanLogin.data.user.id,
          isActive: false,
        },
      });
      assert.equal(updated.status, 200);
      assert.equal(updated.data.isActive, false);

      const audits = await dbMod.db
        .select()
        .from(schemaMod.auditLogs)
        .where(eq(schemaMod.auditLogs.referenceId, String(created.data.id)));
      assert.ok(audits.some((a) => a.action === 'CUSTOMER_CREATED'));
      assert.ok(audits.some((a) => a.action === 'CUSTOMER_UPDATED'));
    });

    // TEST 3: Suppliers Create, Edit (PUT), Safe Deactivation, History Guard & RBAC
    await t.test('3. Suppliers PUT, safe deactivation, history protection, RBAC & audit logging', async () => {
      // RBAC: AUDITOR and SALESMAN cannot create or modify suppliers
      const auditorAttempt = await api('/api/suppliers', {
        method: 'POST',
        cookie: auditorCookieHeader,
        body: {
          name: 'Blocked Vendor',
          gstin: '33AAACB1234A1Z5',
          phone: '9842199999',
          address: 'Chennai',
          state: 'Tamil Nadu',
          stateCode: '33',
        },
      });
      assert.equal(auditorAttempt.status, 403);

      // Create fresh supplier
      const created = await api('/api/suppliers', {
        method: 'POST',
        cookie: adminCookieHeader,
        body: {
          name: 'Madurai Spice Traders',
          gstin: '33AAACM9876B1Z2',
          phone: '9842200333',
          email: 'orders@maduraispice.in',
          address: '45 Anna Nagar, Madurai',
          state: 'Tamil Nadu',
          stateCode: '33',
        },
      });
      assert.equal(created.status, 201);
      const supId = created.data.id;

      // Update supplier via PUT /api/suppliers/:id
      const updated = await api(`/api/suppliers/${supId}`, {
        method: 'PUT',
        cookie: adminCookieHeader,
        body: {
          name: 'Madurai Spice & Agro Traders',
          gstin: '33AAACM9876B1Z2',
          phone: '9842200444',
          email: 'billing@maduraispice.in',
          address: '45 Anna Nagar, Madurai',
          state: 'Tamil Nadu',
          stateCode: '33',
        },
      });
      assert.equal(updated.status, 200);
      assert.equal(updated.data.name, 'Madurai Spice & Agro Traders');

      // Safe deactivation via PATCH /api/suppliers/:id/status
      const deactivated = await api(`/api/suppliers/${supId}/status`, {
        method: 'PATCH',
        cookie: adminCookieHeader,
        body: { isActive: false },
      });
      assert.equal(deactivated.status, 200);
      assert.equal(deactivated.data.isActive, false);

      // Verify purchases against an inactive supplier are blocked
      const invRes = await api('/api/inventory/summary', { cookie: ownerCookieHeader });
      const flour = invRes.data.rawMaterials.find((r: { code: string }) => r.code === 'RM-FLR');
      const blockedPo = await api('/api/purchases', {
        method: 'POST',
        cookie: adminCookieHeader,
        body: {
          supplierId: supId,
          purchaseDate: '2026-11-18',
          invoiceRef: 'BLOCK-001',
          items: [
            {
              materialCategory: 'RAW',
              materialId: flour.id,
              quantity: 10,
              unit: 'kg',
              rateRupees: 44,
              gstPct: 5,
            },
          ],
        },
      });
      assert.equal(blockedPo.status, 400);

      // Reactivate supplier
      const reactivated = await api(`/api/suppliers/${supId}/status`, {
        method: 'PATCH',
        cookie: ownerCookieHeader,
        body: { isActive: true },
      });
      assert.equal(reactivated.status, 200);
      assert.equal(reactivated.data.isActive, true);

      // Historical supplier (Sri Murugan Agro Mills — has PO-2026-0001) MUST NOT be hard-deleted
      const sups = await api('/api/suppliers', { cookie: ownerCookieHeader });
      const histSup = sups.data.find((s: { name: string }) => s.name.includes('Sri Murugan'));
      const deleteHist = await api(`/api/suppliers/${histSup.id}`, {
        method: 'DELETE',
        cookie: ownerCookieHeader,
      });
      assert.equal(deleteHist.status, 409);
      assert.equal(deleteHist.data.code, 'SUPPLIER_HAS_HISTORY');

      // Verify audit logs captured CREATE, UPDATE, DEACTIVATE, REACTIVATE
      const audits = await dbMod.db
        .select()
        .from(schemaMod.auditLogs)
        .where(eq(schemaMod.auditLogs.referenceId, String(supId)));
      const actions = new Set(audits.map((a) => a.action));
      assert.ok(actions.has('SUPPLIER_CREATED'));
      assert.ok(actions.has('SUPPLIER_UPDATED'));
      assert.ok(actions.has('SUPPLIER_DEACTIVATED'));
      assert.ok(actions.has('SUPPLIER_REACTIVATED'));
    });

    // TEST 4: Products CRUD + Duplicate SKU Prevention
    await t.test('4. Products CRUD persists and prevents duplicate SKU violations', async () => {
      const created = await api('/api/products', {
        method: 'POST',
        cookie: adminCookieHeader,
        body: {
          name: 'Butter Murukku 100 g',
          sku: 'FG-BMRK-100',
          packSize: '100 g',
          hsnCode: '21069099',
          gstPct: 5,
          sellingPriceRupees: 30,
          unit: 'packets',
          minStockLevel: 20,
        },
      });
      assert.equal(created.status, 201);

      // Duplicate SKU must fail cleanly
      const dup = await api('/api/products', {
        method: 'POST',
        cookie: adminCookieHeader,
        body: {
          name: 'Duplicate SKU Product',
          sku: 'FG-BMRK-100',
          packSize: '100 g',
          hsnCode: '21069099',
          gstPct: 5,
          sellingPriceRupees: 30,
          unit: 'packets',
          minStockLevel: 20,
        },
      });
      assert.ok(dup.status >= 400 && dup.status < 500, `Expected 4xx on duplicate SKU, got ${dup.status}`);

      // Update product selling price
      const updated = await api(`/api/products/${created.data.id}`, {
        method: 'PUT',
        cookie: ownerCookieHeader,
        body: {
          name: 'Butter Murukku 100 g',
          sku: 'FG-BMRK-100',
          packSize: '100 g',
          hsnCode: '21069099',
          gstPct: 5,
          sellingPriceRupees: 32,
          unit: 'packets',
          minStockLevel: 25,
          isActive: true,
        },
      });
      assert.equal(updated.status, 200);
      assert.equal(updated.data.sellingPricePaise, 3200);
    });

    // TEST 5: Purchases + Weighted-Average Recalculation + Inventory Movements
    await t.test('5. Purchases update stock, weighted-average cost, and stock ledger atomically', async () => {
      const invBefore = await api('/api/inventory/summary', { cookie: ownerCookieHeader });
      const flourBefore = invBefore.data.rawMaterials.find((r: { code: string }) => r.code === 'RM-FLR');
      const sups = await api('/api/suppliers', { cookie: ownerCookieHeader });
      const activeSup = sups.data.find((s: { isActive: boolean }) => s.isActive);

      const po = await api('/api/purchases', {
        method: 'POST',
        cookie: adminCookieHeader,
        body: {
          supplierId: activeSup.id,
          purchaseDate: '2026-11-18',
          invoiceRef: 'TEST-INV-01',
          notes: 'Integration test flour purchase',
          items: [
            {
              materialCategory: 'RAW',
              materialId: flourBefore.id,
              quantity: 40,
              unit: 'kg',
              rateRupees: 48,
              gstPct: 5,
            },
          ],
        },
      });
      assert.equal(po.status, 201);

      const invAfter = await api('/api/inventory/summary', { cookie: ownerCookieHeader });
      const flourAfter = invAfter.data.rawMaterials.find((r: { code: string }) => r.code === 'RM-FLR');
      assert.equal(flourAfter.currentStock, flourBefore.currentStock + 40);
      assert.ok(flourAfter.weightedAvgRatePaise > flourBefore.weightedAvgRatePaise);
    });

    // TEST 6: Production Runs + Material/Pouch Consumption + Finished Receipt
    await t.test('6. Production run deducts raw/packaging stock and credits finished goods', async () => {
      const bomsRes = await api('/api/boms', { cookie: ownerCookieHeader });
      const bom = bomsRes.data[0];
      const invBefore = await api('/api/inventory/summary', { cookie: ownerCookieHeader });
      const pouchBefore = invBefore.data.packagingMaterials.find((p: { code: string }) => p.code === 'PK-PCH200');
      const mrkBefore = invBefore.data.finishedGoods.find((p: { sku: string }) => p.sku === 'FG-MRK-200');

      const consumptions = bom.items.map((it: {
        materialCategory: 'RAW' | 'PACKAGING';
        rawMaterialId: number | null;
        packagingMaterialId: number | null;
        standardQty: number;
        unit: string;
      }) => {
        const isPouch = it.packagingMaterialId === pouchBefore.id;
        return {
          materialCategory: it.materialCategory,
          rawMaterialId: it.rawMaterialId,
          packagingMaterialId: it.packagingMaterialId,
          plannedQty: it.standardQty * 0.5,
          actualQty: isPouch ? 95 : it.standardQty * 0.5,
          damagedQty: isPouch ? 3 : 0,
          unit: it.unit,
        };
      });

      const run = await api('/api/production-runs', {
        method: 'POST',
        cookie: ownerCookieHeader,
        body: {
          productId: bom.productId,
          bomId: bom.id,
          runDate: '2026-11-18',
          batchQty: 0.5,
          actualGoodOutputQty: 95,
          damagedPackagingQty: 3,
          wastageQty: 5,
          labourCostRupees: 300,
          gasPowerCostRupees: 175,
          otherOverheadRupees: 75,
          notes: 'Integration test production run',
          consumptions,
        },
      });
      assert.equal(run.status, 201);

      const invAfter = await api('/api/inventory/summary', { cookie: ownerCookieHeader });
      const pouchAfter = invAfter.data.packagingMaterials.find((p: { code: string }) => p.code === 'PK-PCH200');
      const mrkAfter = invAfter.data.finishedGoods.find((p: { sku: string }) => p.sku === 'FG-MRK-200');
      assert.equal(pouchAfter.currentStock, pouchBefore.currentStock - 95 - 3);
      assert.equal(mrkAfter.currentStock, mrkBefore.currentStock + 95);
    });

    // TEST 7, 8, 9: Sales Orders -> GST Invoices -> Duplicate Guard -> Dispatch -> Credit Note & Payments
    await t.test('7-9. Orders, GST Invoices, Duplicate Guard, Dispatch, Credit Note & Payments', async () => {
      const custs = await api('/api/customers', { cookie: ownerCookieHeader });
      const retailer = custs.data.find((c: { name: string }) => c.name.includes('Retailer A'));
      const prods = await api('/api/products', { cookie: ownerCookieHeader });
      const mrk = prods.data.find((p: { sku: string }) => p.sku === 'FG-MRK-200');

      // Create & approve Order #1 for Invoice -> Dispatch -> Payment
      const ord1 = await api('/api/orders', {
        method: 'POST',
        cookie: salesmanCookieHeader,
        body: {
          customerId: retailer.id,
          orderDate: '2026-11-18',
          status: 'SUBMITTED',
          notes: 'Integration test order 1',
          items: [{ productId: mrk.id, quantity: 20 }],
        },
      });
      assert.equal(ord1.status, 201);

      // Admin updates quantity before approving
      const ordEdit = await api(`/api/orders/${ord1.data.id}`, {
        method: 'PUT',
        cookie: adminCookieHeader,
        body: {
          notes: 'Admin verified qty',
          items: [{ productId: mrk.id, quantity: 25, unitPriceRupees: 50 }],
        },
      });
      assert.equal(ordEdit.status, 200);

      const approved = await api(`/api/orders/${ord1.data.id}/approve`, {
        method: 'POST',
        cookie: adminCookieHeader,
      });
      assert.equal(approved.status, 200);

      // Generate GST Invoice
      const inv = await api(`/api/invoices/from-order/${ord1.data.id}`, {
        method: 'POST',
        cookie: adminCookieHeader,
      });
      assert.equal(inv.status, 201);
      assert.equal(inv.data.grandTotalPaise, 131250); // 25 * 50 = 1250 + 5% GST (62.50) = 1312.50

      // Duplicate invoice guard must block second invoice for same order
      const dupInv = await api(`/api/invoices/from-order/${ord1.data.id}`, {
        method: 'POST',
        cookie: adminCookieHeader,
      });
      assert.ok(dupInv.status === 400 || dupInv.status === 409);

      // Dispatch invoice items -> reduces finished stock
      const stockBeforeDisp = (await api('/api/inventory/summary', { cookie: ownerCookieHeader }))
        .data.finishedGoods.find((p: { sku: string }) => p.sku === 'FG-MRK-200').currentStock;
      const invListRes = await api('/api/invoices', { cookie: adminCookieHeader });
      const invRows = Array.isArray(invListRes.data) ? invListRes.data : invListRes.data.invoices;
      const createdInv = invRows.find((i: { id: number }) => i.id === inv.data.id);

      const disp = await api(`/api/invoices/${inv.data.id}/dispatch`, {
        method: 'POST',
        cookie: adminCookieHeader,
        body: {
          items: [{ invoiceItemId: createdInv.items[0].id, dispatchQty: 25 }],
          notes: 'Dispatched via TN-45-AB-1234',
        },
      });
      assert.equal(disp.status, 200);

      const stockAfterDisp = (await api('/api/inventory/summary', { cookie: ownerCookieHeader }))
        .data.finishedGoods.find((p: { sku: string }) => p.sku === 'FG-MRK-200').currentStock;
      assert.equal(stockAfterDisp, stockBeforeDisp - 25);

      // Partial payment -> Overpayment guard -> Full payment
      const pay1 = await api('/api/payments', {
        method: 'POST',
        cookie: adminCookieHeader,
        body: {
          invoiceId: inv.data.id,
          paymentDate: '2026-11-18',
          amountRupees: 1000,
          paymentMode: 'UPI',
          referenceNo: 'UPI-TEST-001',
        },
      });
      assert.equal(pay1.status, 201);

      const overpay = await api('/api/payments', {
        method: 'POST',
        cookie: adminCookieHeader,
        body: {
          invoiceId: inv.data.id,
          paymentDate: '2026-11-18',
          amountRupees: 500,
          paymentMode: 'UPI',
          referenceNo: 'UPI-OVERPAY',
        },
      });
      assert.equal(overpay.status, 400);

      const pay2 = await api('/api/payments', {
        method: 'POST',
        cookie: adminCookieHeader,
        body: {
          invoiceId: inv.data.id,
          paymentDate: '2026-11-18',
          amountRupees: 312.5,
          paymentMode: 'NEFT',
          referenceNo: 'NEFT-TEST-002',
        },
      });
      assert.equal(pay2.status, 201);

      // Credit Note reversal on a second dispatched invoice restores stock without deleting invoice
      const ord2 = await api('/api/orders', {
        method: 'POST',
        cookie: adminCookieHeader,
        body: {
          customerId: retailer.id,
          orderDate: '2026-11-18',
          status: 'SUBMITTED',
          items: [{ productId: mrk.id, quantity: 10 }],
        },
      });
      await api(`/api/orders/${ord2.data.id}/approve`, { method: 'POST', cookie: adminCookieHeader });
      const inv2 = await api(`/api/invoices/from-order/${ord2.data.id}`, {
        method: 'POST',
        cookie: adminCookieHeader,
      });
      const inv2ListRes = await api('/api/invoices', { cookie: adminCookieHeader });
      const inv2Rows = Array.isArray(inv2ListRes.data) ? inv2ListRes.data : inv2ListRes.data.invoices;
      const inv2Detail = inv2Rows.find((i: { id: number }) => i.id === inv2.data.id);
      await api(`/api/invoices/${inv2.data.id}/dispatch`, {
        method: 'POST',
        cookie: adminCookieHeader,
        body: { items: [{ invoiceItemId: inv2Detail.items[0].id, dispatchQty: 10 }] },
      });
      const stockBeforeCn = (await api('/api/inventory/summary', { cookie: ownerCookieHeader }))
        .data.finishedGoods.find((p: { sku: string }) => p.sku === 'FG-MRK-200').currentStock;
      const cn = await api(`/api/invoices/${inv2.data.id}/credit-note`, {
        method: 'POST',
        cookie: ownerCookieHeader,
        body: { reason: 'Customer return — damaged outer carton' },
      });
      assert.equal(cn.status, 201);
      const stockAfterCn = (await api('/api/inventory/summary', { cookie: ownerCookieHeader }))
        .data.finishedGoods.find((p: { sku: string }) => p.sku === 'FG-MRK-200').currentStock;
      assert.equal(stockAfterCn, stockBeforeCn + 10);
    });

    // TEST 10: User Management, Duplicate Email, Privilege Escalation & Deactivation
    await t.test('10. User Management enforces duplicates, privilege limits, and live deactivation', async () => {
      // ADMIN cannot assign OWNER
      const escalation = await api('/api/users', {
        method: 'POST',
        cookie: adminCookieHeader,
        body: {
          name: 'Blocked Escalation',
          email: 'blocked-owner@factoryflow.in',
          password: 'Password@123',
          roleCode: 'OWNER',
        },
      });
      assert.equal(escalation.status, 403);

      // Create valid salesman
      const created = await api('/api/users', {
        method: 'POST',
        cookie: adminCookieHeader,
        body: {
          name: 'Field Rep Two',
          email: 'rep2@factoryflow.in',
          password: 'Password@123',
          roleCode: 'SALESMAN',
          phone: '9842300999',
        },
      });
      assert.equal(created.status, 201);

      // Duplicate email rejected with 409
      const dupUser = await api('/api/users', {
        method: 'POST',
        cookie: adminCookieHeader,
        body: {
          name: 'Dup Rep',
          email: 'rep2@factoryflow.in',
          password: 'Password@123',
          roleCode: 'SALESMAN',
        },
      });
      assert.equal(dupUser.status, 409);

      // Login as new user to capture session cookie, then deactivate user
      const repLogin = await loginAs('rep2@factoryflow.in');
      assert.equal(repLogin.res.status, 200);
      const repCookie = `${SESSION_COOKIE_NAME}=${extractSetCookieValue(repLogin.setCookies, SESSION_COOKIE_NAME)}`;

      const deact = await api(`/api/users/${created.data.id}`, {
        method: 'PATCH',
        cookie: ownerCookieHeader,
        body: { isActive: false },
      });
      assert.equal(deact.status, 200);

      // Existing cookie is immediately invalidated by live DB check on requireAuth
      const blockedMe = await api('/api/auth/me', { cookie: repCookie });
      assert.equal(blockedMe.status, 403);
      assert.equal(blockedMe.data.code, 'ACCOUNT_INACTIVE');
    });

    // TEST 11: Inventory Movements Adjustment, ACID Transaction Rollback & FK Integrity
    await t.test('11. Inventory adjustment, ACID transaction rollback, and PostgreSQL FK constraints', async () => {
      const invBefore = await api('/api/inventory/summary', { cookie: ownerCookieHeader });
      const spice = invBefore.data.rawMaterials.find((r: { code: string }) => r.code === 'RM-SPC');

      const adj = await api('/api/inventory/adjust', {
        method: 'POST',
        cookie: ownerCookieHeader,
        body: {
          itemCategory: 'RAW',
          itemId: spice.id,
          direction: 'IN',
          quantity: 1.5,
          unitCostRupees: 200,
          movementType: 'ADJUSTMENT',
          reason: 'Cycle count reconciliation surplus',
        },
      });
      assert.equal(adj.status, 201);

      // Verify ACID transaction rollback leaves 0 committed rows on failure
      const rollbackMarker = `ROLLBACK_TEST_${Date.now()}`;
      await assert.rejects(async () => {
        await dbMod.db.transaction(async (tx) => {
          await tx.insert(schemaMod.suppliers).values({
            name: rollbackMarker,
            gstin: '33AAACR0000A1Z0',
            phone: '9000000000',
            email: '',
            address: 'Rollback Street',
            state: 'Tamil Nadu',
            stateCode: '33',
          });
          throw new Error('Simulated mid-transaction failure');
        });
      }, /Simulated mid-transaction failure/);

      const afterRollback = await dbMod.db
        .select()
        .from(schemaMod.suppliers)
        .where(eq(schemaMod.suppliers.name, rollbackMarker));
      assert.equal(afterRollback.length, 0, 'Rolled-back transaction must leave zero persisted rows');

      // Verify PostgreSQL Foreign Key constraint (SQLSTATE 23503) rejects orphan supplier_id
      let fkErrorCode: string | undefined;
      try {
        await dbMod.db.insert(schemaMod.purchases).values({
          purchaseNo: 'PO-FK-FAIL-9999',
          supplierId: 999999,
          purchaseDate: '2026-11-18',
          invoiceRef: 'FK-TEST',
          status: 'RECEIVED',
          subtotalPaise: 1000,
          gstPaise: 50,
          totalPaise: 1050,
          notes: 'Should fail FK',
          createdById: ownerLogin.data.user.id,
        });
      } catch (err: unknown) {
        const pgErr = (err as { cause?: { code?: string }; code?: string });
        fkErrorCode = pgErr.cause?.code || pgErr.code;
      }
      assert.equal(fkErrorCode, '23503', 'PostgreSQL must enforce foreign key violation (23503)');
    });

    // TEST 12: Production Security Audit — CSRF, Strict Origin, IDOR, Price Tampering & RBAC
    await t.test('12. Security audit enforces CSRF, strict Origin, IDOR ownership, price integrity & RBAC', async () => {
      // 12a. Cross-origin state-changing request rejected with 403 INVALID_ORIGIN even with valid cookies + CSRF token
      const crossOriginPost = await api('/api/customers', {
        method: 'POST',
        cookie: ownerCookieHeader,
        origin: 'https://evil-attacker.example',
        body: {
          name: 'Blocked Cross Origin',
          customerType: 'RETAILER',
          gstin: '33AAACB1234A1Z9',
          phone: '9842100999',
          address: 'Evil Street',
          state: 'Tamil Nadu',
          stateCode: '33',
          creditLimitRupees: 1000,
        },
      });
      assert.equal(crossOriginPost.status, 403);
      assert.equal(crossOriginPost.data.code, 'INVALID_ORIGIN');

      // 12b. Missing X-CSRF-Token on cookie-authenticated mutation rejected with 403 CSRF_TOKEN_INVALID
      const missingCsrf = await api('/api/customers', {
        method: 'POST',
        cookie: ownerCookieHeader,
        csrfOverride: null,
        body: {
          name: 'Blocked Missing CSRF',
          customerType: 'RETAILER',
          gstin: '33AAACB1234A1Z8',
          phone: '9842100998',
          address: 'No CSRF Street',
          state: 'Tamil Nadu',
          stateCode: '33',
          creditLimitRupees: 1000,
        },
      });
      assert.equal(missingCsrf.status, 403);
      assert.equal(missingCsrf.data.code, 'CSRF_TOKEN_INVALID');

      // 12c. Wrong X-CSRF-Token rejected with 403 CSRF_TOKEN_INVALID
      const wrongCsrf = await api('/api/customers', {
        method: 'POST',
        cookie: ownerCookieHeader,
        csrfOverride: '0'.repeat(64),
        body: {
          name: 'Blocked Wrong CSRF',
          customerType: 'RETAILER',
          gstin: '33AAACB1234A1Z7',
          phone: '9842100997',
          address: 'Wrong CSRF Street',
          state: 'Tamil Nadu',
          stateCode: '33',
          creditLimitRupees: 1000,
        },
      });
      assert.equal(wrongCsrf.status, 403);
      assert.equal(wrongCsrf.data.code, 'CSRF_TOKEN_INVALID');

      // 12d. IDOR check: Admin creates a DRAFT order; SALESMAN cannot submit or edit Admin's draft order (403)
      const custsRes = await api('/api/customers', { cookie: adminCookieHeader });
      const prodsRes = await api('/api/products', { cookie: adminCookieHeader });
      const murukku = prodsRes.data.find((p: { sku: string }) => p.sku === 'FG-MRK-200');
      const assignedCust = custsRes.data.find(
        (c: { assignedSalesmanId: number | null }) => c.assignedSalesmanId === salesmanLogin.data.user.id
      );
      assert.ok(murukku && assignedCust);

      const adminDraft = await api('/api/orders', {
        method: 'POST',
        cookie: adminCookieHeader,
        body: {
          customerId: assignedCust.id,
          orderDate: '2026-11-18',
          status: 'DRAFT',
          items: [{ productId: murukku.id, quantity: 5 }],
        },
      });
      assert.equal(adminDraft.status, 201);

      const idorSubmit = await api(`/api/orders/${adminDraft.data.id}/submit`, {
        method: 'POST',
        cookie: salesmanCookieHeader,
      });
      assert.equal(idorSubmit.status, 403, 'Salesman must be blocked from submitting another user draft order');

      const idorEdit = await api(`/api/orders/${adminDraft.data.id}`, {
        method: 'PUT',
        cookie: salesmanCookieHeader,
        body: { items: [{ productId: murukku.id, quantity: 5, unitPriceRupees: 1 }] },
      });
      assert.equal(idorEdit.status, 403, 'Salesman must be blocked from editing another user draft order');

      // 12e. Price-tampering check: SALESMAN edits own DRAFT order attempting ₹1/pkt -> server enforces catalog price (₹50)
      const salesmanDraft = await api('/api/orders', {
        method: 'POST',
        cookie: salesmanCookieHeader,
        body: {
          customerId: assignedCust.id,
          orderDate: '2026-11-18',
          status: 'DRAFT',
          items: [{ productId: murukku.id, quantity: 2 }],
        },
      });
      assert.equal(salesmanDraft.status, 201);

      const tamperedEdit = await api(`/api/orders/${salesmanDraft.data.id}`, {
        method: 'PUT',
        cookie: salesmanCookieHeader,
        body: { items: [{ productId: murukku.id, quantity: 2, unitPriceRupees: 1 }] },
      });
      assert.equal(tamperedEdit.status, 200);
      assert.equal(
        tamperedEdit.data.subtotalPaise,
        2 * murukku.sellingPricePaise,
        'Server must ignore Salesman price overrides and enforce catalog sellingPricePaise'
      );

      // 12f. RBAC check: PRODUCTION_SUPERVISOR blocked (403) on customer, sales order, invoice, and settings endpoints
      assert.equal((await api('/api/customers', { cookie: supervisorCookieHeader })).status, 403);
      assert.equal((await api('/api/orders', { cookie: supervisorCookieHeader })).status, 403);
      assert.equal((await api('/api/invoices', { cookie: supervisorCookieHeader })).status, 403);
      assert.equal((await api('/api/settings', { cookie: supervisorCookieHeader })).status, 403);
      assert.equal((await api('/api/settings', { cookie: salesmanCookieHeader })).status, 403);
      assert.equal((await api('/api/settings', { cookie: auditorCookieHeader })).status, 200);

      // 12g. Privilege escalation & self-demotion protection
      const adminModifyOwner = await api(`/api/users/${ownerLogin.data.user.id}`, {
        method: 'PATCH',
        cookie: adminCookieHeader,
        body: { isActive: false },
      });
      assert.equal(adminModifyOwner.status, 403);

      const ownerSelfDemote = await api(`/api/users/${ownerLogin.data.user.id}`, {
        method: 'PATCH',
        cookie: ownerCookieHeader,
        body: { roleCode: 'ADMIN' },
      });
      assert.equal(ownerSelfDemote.status, 400);

      const adminResetBlocked = await api('/api/benchmark/reset', {
        method: 'POST',
        cookie: adminCookieHeader,
      });
      assert.equal(adminResetBlocked.status, 403);

      // 12h. Forged Firebase ID token rejected with 401
      const forgedFirebase = await api('/api/auth/session', {
        method: 'POST',
        body: { idToken: 'eyJhbGciOiJSUzI1NiJ9.forged.signature' },
      });
      assert.equal(forgedFirebase.status, 401);

      // 12i. Double-proxied Cloud Run shared preview (ais-pre + X-Forwarded-Proto: http) passes Origin check & sets Secure+SameSite=None+Partitioned cookies
      const sharedHost = 'ais-pre-jg46isrdovhwiocquudg6t-807849025208.asia-southeast1.run.app';
      const proxiedSessionRes = await fetch(`${baseUrl}/api/auth/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': sharedHost,
          'X-Forwarded-Proto': 'http',
          Origin: `https://${sharedHost}`,
        },
        body: JSON.stringify({ idToken: 'eyJhbGciOiJSUzI1NiJ9.forged.signature' }),
      });
      // Must reach Firebase Admin verification (401), NOT fail Origin check (403)
      assert.equal(proxiedSessionRes.status, 401);

      const proxiedLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': sharedHost,
          'X-Forwarded-Proto': 'http',
          Origin: `https://${sharedHost}`,
        },
        body: JSON.stringify({ email: 'owner@factoryflow.in', password: 'Password@123' }),
      });
      assert.equal(proxiedLoginRes.status, 200);
      const proxiedCookies = proxiedLoginRes.headers.getSetCookie ? proxiedLoginRes.headers.getSetCookie() : [];
      assert.ok(
        proxiedCookies.some(
          (c) =>
            c.startsWith(`${SESSION_COOKIE_NAME}=`) &&
            c.includes('HttpOnly') &&
            c.includes('Secure') &&
            c.includes('SameSite=None') &&
            c.includes('Partitioned')
        ),
        'Double-proxied Cloud Run iframe login must issue HttpOnly; Secure; SameSite=None; Partitioned session cookie'
      );

      // 12j. Deactivated account login returns 423 Locked (preserving JSON message behind 403-intercepting proxies) with no session issued
      const deactivatedLogin = await api('/api/auth/login', {
        method: 'POST',
        body: { email: 'rep2@factoryflow.in', password: 'Password@123' },
      });
      assert.equal(deactivatedLogin.status, 423);
      assert.equal(deactivatedLogin.data.code, 'ACCOUNT_INACTIVE');
    });
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    if (closeAppPool) {
      await closeAppPool();
    }
    // Always clean up ephemeral isolated test database
    await maintPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`).catch(() => {});
    await maintPool.end();
  }
});
