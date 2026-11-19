# FactoryFlow ERP — Order-to-Audit Management System

**FactoryFlow ERP** is a full-stack Order-to-Audit manufacturing ERP built for small and mid-sized Indian food/FMCG manufacturers. It unifies field sales order capture, administrative order verification, sequential financial-year GST invoicing (CGST/SGST vs IGST), Bill of Materials (BOM) execution, weighted-average material costing, permanent stock ledgers, receivables ageing, and immutable audit trails on top of PostgreSQL.

This implementation validates every requirement and numerical checkpoint from the **NIT Tiruchirappalli Order-to-Audit Internship Problem Statement**.

---

## 1. Technology Stack

| Layer | Technology |
| --- | --- |
| **Frontend** | React 19, TypeScript, Tailwind CSS v4, Lucide React, Recharts |
| **Backend** | Node.js, Express 4, Zod validation, `tsx` runtime |
| **Database & ORM** | Google Cloud SQL for PostgreSQL (or local PostgreSQL 15+) + Drizzle ORM + `pg.Pool` |
| **Authentication** | Server-managed `HttpOnly` JWT session cookies (`jsonwebtoken` + `bcryptjs`) & Firebase Google OAuth (`POST /api/auth/session` with Pending-Approval workflow) |
| **Exports & Documents** | `jsPDF` + `jspdf-autotable` (Tax Invoice PDF & Report PDF), SheetJS (`xlsx`) for Excel/CSV exports |
| **Testing** | Node.js built-in test runner (`node:test`) via `tsx --test` (unit + isolated live PostgreSQL integration tests) |

---

## 2. Installation

### Prerequisites
- Node.js 20+ and npm 10+
- PostgreSQL 15+ (Google Cloud SQL for PostgreSQL or local PostgreSQL)

### Install Dependencies
```bash
npm install
```

---

## 3. Environment Variables

Copy `.env.example` to `.env` and fill in your server credentials. **Never commit `.env` to version control.**

```bash
cp .env.example .env
```

| Variable | Required | Description |
| --- | --- | --- |
| `SQL_HOST` | Yes (or `INSTANCE_CONNECTION_NAME`) | PostgreSQL host / IP or Cloud SQL Unix socket directory (e.g., `/cloudsql/<project>:<region>:<instance>` or `127.0.0.1`). Do **not** use `DATABASE_URL`. |
| `INSTANCE_CONNECTION_NAME` | Cloud Run / Cloud SQL | Cloud SQL instance connection name (`<project>:<region>:<instance>`). Automatically maps to `/cloudsql/<INSTANCE_CONNECTION_NAME>` when `SQL_HOST` is omitted. |
| `SQL_PORT` | No | PostgreSQL TCP port (defaults to `5432`; omitted for Unix sockets). |
| `SQL_DB_NAME` / `SQL_DATABASE` | Yes | Target PostgreSQL database name (e.g., `cloud_sql_development_database` or `factoryflow`). |
| `SQL_USER` | Yes | Runtime application database user. |
| `SQL_PASSWORD` | Yes | Runtime application database password. |
| `SQL_ADMIN_USER` | For migrations & isolated integration tests | Admin database user used by Drizzle Kit (`db:push` / `db:migrate`) and `npm run test:integration`. |
| `SQL_ADMIN_PASSWORD` | For migrations & isolated integration tests | Admin database password. |
| `JWT_SECRET` | **Yes** | Cryptographically random secret (**minimum 32 characters**). Generate via `openssl rand -hex 32`. The server **refuses to boot** if `JWT_SECRET` is missing, weak, or a placeholder. |
| `PORT` | No | Server listen port (defaults to `3000`). |
| `NODE_ENV` | No | `development` or `production`. |
| `APP_URL` | No | Public URL of the deployed application. |

Generate a secure `JWT_SECRET`:
```bash
openssl rand -hex 32
```

---

## 4. Database Setup & Initialization

FactoryFlow ERP connects directly to PostgreSQL using `pg.Pool` (Object Method) and **never falls back silently to `localStorage` or fake in-memory data**. If PostgreSQL is unreachable, API routes return `503 Service Unavailable`, and health endpoints report exact status.

### Step 1: Create the PostgreSQL database (local setup)
```sql
CREATE DATABASE factoryflow;
```

### Step 2: Push or migrate the Drizzle schema (22 tables)
```bash
# Push schema directly to PostgreSQL
npm run db:push

# Or generate SQL migration files and apply migrations
npm run db:generate
npm run db:migrate
```

### Step 3: Seed the Mandatory Benchmark Scenario
```bash
# First-time seed (idempotent)
npm run db:seed

# Reset and re-seed the exact NIT Trichy benchmark inside a single transaction
npm run db:seed -- --reset
```

### Step 4: Verify Database Health & Schema
```bash
# CLI check verifying connection mode, latency, and all 22 tables
npm run db:verify
```
- `GET /api/health` — Returns `{ ok: true, database: "connected", mode, latencyMs }` (`200`) or `503`.
- `GET /api/health/db` — Runs a live `SELECT 1` probe against PostgreSQL.

---

## 5. Running the Application & Test Suites

```bash
# 1. Unit tests (ERP math, benchmark math, RBAC, JWT/cookie policy, DB config)
npm test

# 2. Isolated live PostgreSQL integration tests (creates ephemeral test DB, tests all 10 write domains, rollbacks, FKs, audit logs, and drops test DB)
npm run test:integration

# 3. TypeScript static type-checking
npm run lint

# 4. Start full-stack development server on http://localhost:3000
npm run dev

# 5. Build production frontend bundle
npm run build
```

---

## 6. Demo Credentials, Session Security & Google OAuth

All demo accounts share password **`Password@123`** (stored as bcrypt hashes in PostgreSQL):

| Role | Name | Email | Capabilities |
| --- | --- | --- | --- |
| **OWNER** | Meenakshi Sundaram | `owner@factoryflow.in` | Full dashboard, approvals, costing, supplier deactivation, user/role management (including `OWNER`), settings, benchmark reset |
| **ADMIN** | Aravind Krishnan | `admin@factoryflow.in` | Order verification/edit/approval, GST invoicing, dispatch, payments, purchases, customer/supplier/product masters, non-OWNER user management |
| **PRODUCTION_SUPERVISOR** | Senthil Murugan | `supervisor@factoryflow.in` | BOM recipes, production runs, consumption & damage entry, variance analysis, inventory adjustments, purchases, supplier create/edit |
| **SALESMAN** | Karthik Rajan | `sales@factoryflow.in` | Mobile-first order creation for assigned customers only, price list view, offline draft queue, own order tracking |
| **AUDITOR** | Lakshmi Narayanan CA | `auditor@factoryflow.in` | Strict read-only access to all 15 statutory reports, GST summaries, ledgers, settings view, and audit logs (all writes return `403`) |

### Server-Managed HttpOnly Session Persistence
- `POST /api/auth/login` and `POST /api/auth/session` issue a signed JWT inside an **`HttpOnly` cookie (`factoryflow_session`)** (`Secure; SameSite=None` over HTTPS / Cloud Run; `SameSite=Lax` on local HTTP).
- Sensitive authentication tokens are **never stored in `localStorage` or `sessionStorage`**.
- Browser reloads (`F5`) automatically hydrate the session via `GET /api/auth/me` (`credentials: 'include'`), validating the cookie signature and live `isActive`/`roleCode` status in PostgreSQL on every request.
- `POST /api/auth/logout` clears the cookie immediately (`Max-Age=0`) and records a `USER_LOGOUT` audit entry.

### Google OAuth (Firebase Authentication) Configuration
- Client Firebase config (`firebase-applet-config.json`) points to project `emergent-province-vpthm` (`authDomain: emergent-province-vpthm.firebaseapp.com`).
- On sign-in, the frontend calls `signInWithPopup(auth, googleAuthProvider)` and exchanges the Firebase ID token via `POST /api/auth/session`, verified server-side by `firebase-admin` (`adminAuth.verifyIdToken`).
- **Pending-Approval Security Policy**: Brand-new Google accounts are **never** auto-promoted to `OWNER`. They are created with `roleCode: "PENDING"` and `isActive: false`, logged as `USER_REGISTRATION_PENDING`, and blocked (`403`) until an `OWNER` or `ADMIN` assigns an operational role in **User Management**.
- **Required Firebase Console Checklist for Production Google Sign-In**:
  1. Enable **Google** under *Firebase Console → Authentication → Sign-in method*.
  2. Add all deployed origins (e.g., `localhost` and your Cloud Run `*.run.app` hostname) under *Firebase Console → Authentication → Settings → Authorized domains*.

---

## 7. Feature Implementation Summary

1. **Overview Dashboard**: Live KPIs, benchmark closing-stock verification strip, 6 interactive Recharts analytics panels, low-stock alerts, and recent stock ledger transactions.
2. **Orders**: Mobile-first Salesman order entry, offline draft queue (explicitly synced to PostgreSQL), Admin quantity/price editing prior to approval, approval/rejection workflow, and real-time stock shortage flags.
3. **Customers, Suppliers & Products**: Trade partner masters with GSTIN/state codes, credit limits, salesman assignments, Supplier Create/Edit (`PUT /api/suppliers/:id`), safe Supplier Deactivation/Reactivation (`PATCH /api/suppliers/:id/status`), history-protected delete guard (`DELETE /api/suppliers/:id` refuses `409` if purchases exist), HSN codes, GST slabs, and non-overwritable stock balances.
4. **Inventory & Permanent Stock Ledger**: Separate Raw Materials, Packaging Materials, and Finished Goods tables updated exclusively via append-only `inventory_movements` entries.
5. **Purchases**: Active-supplier validation, supplier receipts with automatic weighted-average rate recalculation and ledger posting.
6. **Bill of Materials (BOM) & Production**: Multi-ingredient recipes, unit conversion calculator (`kg ↔ g`, `litre ↔ ml`), production execution with separate good-pouch vs damaged-pouch tracking, ±3% consumption/yield variance flagging, and automatic stock deduction/receipt.
7. **GST Invoices & Dispatch**: Financial-year sequential numbering (`FF/2026-27/0001`), automatic Intra-State (CGST + SGST) vs Inter-State (IGST) tax split, PDF Tax Invoice export, partial/full dispatch stock deduction, and non-destructive Credit Note reversals.
8. **Payments & Receivables**: Partial/full payment recording (`UPI`, `NEFT`, `RTGS`, `CHEQUE`, `CASH`), overpayment prevention, and `0–30 / 31–60 / 61–90 / 90+` day ageing buckets.
9. **Costing & 15 Statutory Reports**: Weighted-average batch costing (`₹/packet`, gross margin %) plus 15 date-filtered reports with CSV, Excel (`.xlsx`), and PDF export.
10. **Audit Trail, User Management & Settings**: Immutable change history (`previous_value` / `new_value`), role-based access enforcement on both backend routes and frontend navigation, and transactional benchmark reset.

---

## 8. Verified NIT Tiruchirappalli Benchmark Results

All monetary arithmetic is computed in **integer paise** (`₹1 = 100 paise`) to prevent IEEE-754 floating-point drift.

| Checkpoint | Expected | Verified Result | Formula / Proof |
| --- | --- | --- | --- |
| **Flour Closing Stock** | `120 kg` | **`120 kg`** | `100 opening + 60 purchased − 40 issued` |
| **Flour Weighted Avg Cost** | `₹43.125/kg` | **`₹43.125/kg`** (`₹1,725.00` for 40 kg) | `(100×₹42 + 60×₹45) / 160 = ₹6,900 / 160` |
| **Cooking Oil Closing Stock** | `19.5 litres` | **`19.5 litres`** | `30 opening − 10.5 issued` |
| **Oil Consumption Variance** | `+5%` (Flagged) | **`+5%` (Flagged > 3%)** | `(10.5 − 10) / 10 × 100` |
| **Spice Mix Closing Stock** | `3.8 kg` | **`3.8 kg`** | `5 opening − 1.2 issued` |
| **200 g Pouches Closing Stock** | `306 pieces` | **`306 pieces`** | `500 opening − 188 good − 6 damaged = 500 − 194` |
| **Cartons Closing Stock** | `21 pieces` | **`21 pieces`** | `30 opening − 9 issued` (`-10%` variance flagged) |
| **Yield Variance** | `-6%` (Flagged) | **`-6%` (Flagged > 3%)** | `(188 − 200) / 200 × 100` |
| **Total Batch Production Cost** | `₹5,155.00` | **`₹5,155.00`** | `Raw ₹3,435 + Packaging ₹620 + Labour/Gas/OH ₹1,100` |
| **Production Cost / Good Packet** | `₹27.42/pkt` | **`₹27.42/pkt`** | `₹5,155.00 / 188 = ₹27.4202` |
| **Finished Goods After Production** | `238 packets` | **`238 packets`** | `50 opening + 188 good produced` (`TXN-PR-0001-FG`) |
| **Retailer A Invoice (150 pkts @ ₹50, 5% GST)** | `₹7,875.00` | **`₹7,875.00`** | `Taxable ₹7,500 + CGST ₹187.50 + SGST ₹187.50` |
| **Finished Goods After Retailer A Dispatch** | `88 packets` | **`88 packets`** | `238 − 150 dispatched` (`TXN-DISP-0001-MRK`) |
| **Retailer A Outstanding (after ₹4,000 paid)** | `₹3,875.00` | **`₹3,875.00`** | `₹7,875.00 − ₹4,000.00` (`PARTIALLY_PAID`) |
| **Distributor B Order Shortage (120 pkts)** | `32 packets` | **`32 packets`** | `120 ordered − 88 available` (`ORD-2026-0002`) |

---

## 9. Architecture & Schema Documentation

See [`DESIGN.md`](./DESIGN.md) for the complete system architecture, Mermaid ER diagram, full 22-table database schema reference, Order-to-Cash and BOM-to-Ledger workflows, permanent stock ledger invariants, and weighted-average costing proofs. See [`CLOUD_SQL_DEPLOYMENT.md`](./CLOUD_SQL_DEPLOYMENT.md) for Google Cloud SQL + Cloud Run deployment guides.

---

## 10. Known Limitations

- **GST Reporting Aid Only**: GSTR-1 and GSTR-3B summaries are structured reconciliation aids; the system does not connect directly to the NIC e-Invoice / GSTN portal or generate IRN/QR codes.
- **Single-Warehouse Scope**: Stock balances are tracked at the single factory level rather than multi-branch warehouse transfers.
- **No Automated Email / SMS Dispatch**: Approval alerts and invoice PDFs are generated on-demand in the UI rather than emailed automatically via SMTP/WhatsApp gateways.
- **Google OAuth Popup Verification**: Live interactive Google account sign-in requires the deployment origin to be added to Firebase Console Authorized Domains and must be completed interactively in a user browser.
- **Offline Salesman Drafts**: Browser `localStorage` is used strictly for the Salesman's unsynced offline order draft queue (and optional remembered login email); zero authentication tokens or ERP records are stored in `localStorage`.

---

## 11. Deployment Instructions

1. Provision a Google Cloud SQL PostgreSQL instance (or managed PostgreSQL) and configure environment variables (`SQL_HOST` or `INSTANCE_CONNECTION_NAME`, `SQL_DB_NAME`/`SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`, and a strong `JWT_SECRET`).
2. Run schema push/migrations and initial benchmark seed:
   ```bash
   npm run db:push
   npm run db:seed
   npm run db:verify
   ```
3. Build the Vite frontend bundle:
   ```bash
   npm run build
   ```
4. Start the Express server in production mode (serves both `/api/*` and the compiled `dist/` SPA on `PORT=3000`):
   ```bash
   NODE_ENV=production npm start
   ```
5. Point your Cloud Run / load balancer health probe to `GET /api/health`.
