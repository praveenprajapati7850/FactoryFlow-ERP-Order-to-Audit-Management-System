# FactoryFlow ERP — Google Cloud SQL (PostgreSQL) & Cloud Run Migration Guide

This runbook documents how to provision, secure, migrate, and deploy **FactoryFlow ERP** on **Google Cloud SQL for PostgreSQL** and **Google Cloud Run** using Drizzle ORM and Google Secret Manager.

> **Security Note:** Never commit `.env`, database passwords, or `JWT_SECRET` to source control. Replace every `<PLACEHOLDER>` below with values obtained directly from your own Google Cloud project.

---

## 1. Architecture Overview

```
Browser (React SPA)
       │ HTTPS
       ▼
Google Cloud Run (Express + Node.js 22 + Drizzle ORM)
       │ Encrypted Unix Domain Socket: /cloudsql/<INSTANCE_CONNECTION_NAME>
       │ (IAM authenticated via Cloud Run Service Account: roles/cloudsql.client)
       ▼
Google Cloud SQL for PostgreSQL 16 (database: factoryflow)
       ▲
       │ Secrets injected at runtime (never in code or images)
Google Secret Manager (SQL_PASSWORD, JWT_SECRET)
```

- **Connection Pooling**: `pg.Pool` Object Method (`src/db/config.ts`, `src/db/index.ts`), lazy connection acquisition, `connectionTimeoutMillis: 15000`, `idleTimeoutMillis: 30000`, `keepAlive: true`, `max: 10`, idle error listener, and graceful `SIGTERM`/`SIGINT` pool shutdown in `server.ts`.
- **No Public IP Required**: Cloud Run mounts the Cloud SQL Auth Proxy Unix socket automatically at `/cloudsql/<INSTANCE_CONNECTION_NAME>`. Local development connects over localhost via the official `cloud-sql-proxy` binary.
- **No Silent Fallbacks**: If Cloud SQL is unavailable, `/api/health`, `/api/health/db`, and API routes fail cleanly with HTTP `503 Service Unavailable`.

---

## 2. Estimated Development Infrastructure Costs

Review estimated monthly costs before creating paid resources in your GCP project:

| Resource | Recommended Dev Configuration | Estimated Cost (USD) |
| :--- | :--- | :--- |
| **Cloud SQL for PostgreSQL** | PostgreSQL 16, Enterprise Edition, `db-f1-micro` (shared-core vCPU, 0.6 GB RAM), 10 GB SSD, Zonal (`asia-south1` or `asia-southeast1`) | ~$9–$12 / month while running 24/7 (~$1.70 / month storage-only when stopped) |
| **Google Cloud Run** | Min instances `0` (scale-to-zero), 512 MiB RAM, 1 vCPU | Free Tier covers 2M requests, 360k vCPU-sec, 180k GiB-sec / month |
| **Google Secret Manager** | 2 secrets (`SQL_PASSWORD`, `JWT_SECRET`) | Free Tier covers 6 active secret versions & 10,000 access ops / month |
| **Artifact Registry** | Single container image (< 500 MB) | Free Tier covers first 0.5 GB / month |

---

## 3. Step-by-Step Google Cloud Setup

### Step 1–2: Open Google Cloud Console & Select/Create a Project
1. Sign in to [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project selector at top-left → **New Project** (or select an existing project with billing enabled).
3. Copy your **Project ID** (`<YOUR_PROJECT_ID>`) from the project dashboard.

### Step 3–4: Enable Required APIs
In Console (**APIs & Services → Library**) or via `gcloud`:
```bash
gcloud config set project <YOUR_PROJECT_ID>
gcloud services enable \
  sqladmin.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

### Step 5: Create a PostgreSQL Cloud SQL Instance
In Console (**SQL → Create Instance → PostgreSQL**) or via `gcloud`:
```bash
gcloud sql instances create <YOUR_INSTANCE_NAME> \
  --database-version=POSTGRES_16 \
  --edition=ENTERPRISE \
  --tier=db-f1-micro \
  --region=<YOUR_REGION> \
  --storage-size=10GB \
  --storage-type=SSD \
  --availability-type=zonal
```
*(Recommended regions for India: `asia-south1` Mumbai or `asia-southeast1` Singapore.)*

### Step 6: Create the `factoryflow` Database
```bash
gcloud sql databases create factoryflow --instance=<YOUR_INSTANCE_NAME>
```

### Step 7–8: Generate Strong Passwords & Create Dedicated Users
Generate random credentials locally (do not use the `postgres` superuser for application traffic):
```bash
openssl rand -base64 24   # Save as SQL_ADMIN_PASSWORD (migrations only)
openssl rand -base64 24   # Save as SQL_PASSWORD (least-privilege runtime app user)
openssl rand -hex 32      # Save as JWT_SECRET (64-char hex, independent of DB credentials)
```
Create the two dedicated PostgreSQL users:
```bash
gcloud sql users create factoryflow_admin \
  --instance=<YOUR_INSTANCE_NAME> \
  --password="<YOUR_ADMIN_PASSWORD>"

gcloud sql users create factoryflow_app \
  --instance=<YOUR_INSTANCE_NAME> \
  --password="<YOUR_APP_PASSWORD>"
```

### Step 9: Find Your Instance Connection Name
- **Console**: Navigate to **SQL → `<YOUR_INSTANCE_NAME>` → Overview → Connect to this instance → Connection name**.
- **CLI**:
  ```bash
  gcloud sql instances describe <YOUR_INSTANCE_NAME> --format="value(connectionName)"
  ```
  Format: `<YOUR_PROJECT_ID>:<YOUR_REGION>:<YOUR_INSTANCE_NAME>`

### Step 10: Configure Least-Privilege IAM Service Account & Secrets
```bash
# 1. Create dedicated Cloud Run runtime service account
gcloud iam service-accounts create factoryflow-run-sa \
  --display-name="FactoryFlow ERP Cloud Run Runtime"

# 2. Grant Cloud SQL Client (required for /cloudsql Unix socket access)
gcloud projects add-iam-policy-binding <YOUR_PROJECT_ID> \
  --member="serviceAccount:factoryflow-run-sa@<YOUR_PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

# 3. Grant Secret Manager Secret Accessor
gcloud projects add-iam-policy-binding <YOUR_PROJECT_ID> \
  --member="serviceAccount:factoryflow-run-sa@<YOUR_PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# 4. Store runtime secrets in Google Secret Manager
printf "%s" "<YOUR_APP_PASSWORD>" | gcloud secrets create factoryflow-sql-password --data-file=-
printf "%s" "<YOUR_JWT_SECRET>"   | gcloud secrets create factoryflow-jwt-secret   --data-file=-
```

---

## 4. Database Schema Migration & Least-Privilege Grants

FactoryFlow ERP preserves all **22 Drizzle ORM entities** (`roles`, `users`, `company_settings`, `customers`, `suppliers`, `products`, `raw_materials`, `packaging_materials`, `boms`, `bom_items`, `purchases`, `purchase_items`, `production_runs`, `production_consumptions`, `orders`, `order_items`, `invoices`, `invoice_items`, `credit_notes`, `payments`, `inventory_movements`, `audit_logs`).

### Connect Locally via Cloud SQL Auth Proxy
1. Download and start [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy):
   ```bash
   cloud-sql-proxy <YOUR_INSTANCE_CONNECTION_NAME> --port 5432
   ```
2. Copy `.env.example` to `.env` and fill in your local proxy settings (`SQL_HOST="127.0.0.1"`, `SQL_PORT="5432"`, `SQL_DATABASE="factoryflow"`, `SQL_USER="factoryflow_app"`, `SQL_PASSWORD`, `SQL_ADMIN_USER="factoryflow_admin"`, `SQL_ADMIN_PASSWORD`, `JWT_SECRET`).
3. Apply Drizzle migrations using the admin user:
   ```bash
   npm run db:migrate   # Applies versioned SQL migrations from ./drizzle
   # Or push schema directly during development:
   npm run db:push
   ```
4. Grant least-privilege runtime permissions to `factoryflow_app` (run via `psql` as `postgres` or `factoryflow_admin`):
   ```sql
   GRANT CONNECT ON DATABASE factoryflow TO factoryflow_app;
   GRANT USAGE ON SCHEMA public TO factoryflow_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO factoryflow_app;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO factoryflow_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO factoryflow_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT USAGE, SELECT ON SEQUENCES TO factoryflow_app;
   ```
5. Verify schema & seed the NIT Trichy benchmark data:
   ```bash
   npm run db:verify
   npm run db:seed -- --reset
   ```

---

## 5. Deploy to Google Cloud Run

```bash
gcloud run deploy factoryflow-erp \
  --source . \
  --region <YOUR_REGION> \
  --service-account="factoryflow-run-sa@<YOUR_PROJECT_ID>.iam.gserviceaccount.com" \
  --add-cloudsql-instances="<YOUR_INSTANCE_CONNECTION_NAME>" \
  --set-env-vars="NODE_ENV=production,SQL_DATABASE=factoryflow,SQL_USER=factoryflow_app,INSTANCE_CONNECTION_NAME=<YOUR_INSTANCE_CONNECTION_NAME>" \
  --set-secrets="SQL_PASSWORD=factoryflow-sql-password:latest,JWT_SECRET=factoryflow-jwt-secret:latest" \
  --allow-unauthenticated
```

*(Note: Leave `SQL_HOST` unset in Cloud Run so `src/db/config.ts` resolves `/cloudsql/<INSTANCE_CONNECTION_NAME>` automatically.)*

---

## 6. Verifying Persistent Connectivity

1. **Database Health Endpoint**:
   ```bash
   curl -i https://<YOUR_CLOUD_RUN_URL>/api/health/db
   ```
   Expected response (`200 OK`):
   ```json
   {
     "ok": true,
     "database": "connected",
     "mode": "cloudsql_unix_socket",
     "latencyMs": 12
   }
   ```
2. **Persistence Across Restarts**:
   - Sign in as `owner@factoryflow.in` (`Password@123`) and create a new Customer or Sales Order.
   - Trigger a new Cloud Run revision or restart the server process.
   - Reload the application and verify the record and its `audit_logs` entry persist from Cloud SQL.
