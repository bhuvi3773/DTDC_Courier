# BookCourier — Bookstore & Courier Platform

Full-stack **Bookstore + Hyperlocal & Intercity Book Courier** platform built with a two-folder architecture:

```
BookCourier/
├── package.json         # Root monorepo runner (`npm run dev`)
├── dev.js               # Starts backend (:4000) + frontend (:3000) cleanly
├── backend/             # Express 5 + Prisma 6 + PostgreSQL (API, domain engine, PDFs, tests)
├── frontend/            # Next.js 15 App Router + TypeScript + Tailwind UI
└── README.md
```

## Quick Start

### 1. Configure Environment
Copy example configs if setting up fresh:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```
Set `DATABASE_URL` in `backend/.env` to your PostgreSQL 16 (local or Neon serverless) connection string.

### 2. Initialize Database & Seed Demo Data
```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npm run seed
```

### 3. Start Both Servers
From the workspace root:
```bash
npm install
npm run dev
```
- **Frontend:** `http://localhost:3000`
- **Backend API:** `http://localhost:4000/api`

### Seeded Credentials & Demo Pincodes

| Entity | Value |
|---|---|
| Admin / Staff login | `admin@bookcourier.local` / `admin1234` |
| Customer OTP login | `9000000010` or `9000000011` (6-digit OTP logged to backend console in dev) |
| Agent OTP login | `9100000001` or `9100000002` (6-digit OTP logged to backend console in dev) |
| Own-network pincodes | `560001`, `560038` (Bengaluru `ACTIVE`, own pickup + delivery) |
| Partner pincodes | `600001` (Chennai `ACTIVE`, partner-only), `682001` (Kochi `INACTIVE`, partner-serviceable) |

---

## Implemented Platform Modules (Phases 1–10)

- **Auth & RBAC:** JWT access tokens (15m) + rotating refresh tokens (7d), OTP login (SHA-256 hashed, expiry + attempt caps), role & permission guards across customer, agent, hub manager, finance, support, and admin roles.
- **Bookstore & Mixed Cart (`UC-1`):** Book catalog (`/books`), persistent cart (`/cart`), stock-reserving checkout (`/checkout`) generating linked `BOOKSTORE_ORDER_SHIPMENT`, and order tracking (`/orders`).
- **Book Courier Wizard (`UC-2`):** Public serviceability check, volumetric (`L×W×H / divisor`) + step-rounded chargeable weight quotes, packaging calculator (`CUSTOMER_PACKED`, `COMPANY_PACKED`, `COMPANY_PACKED_FRAGILE`), saved customer addresses (`/api/addresses`), itemized breakdown, and printable **A5 QR Shipping Labels** (`/api/shipments/:id/label`).
- **Carrier Router & Tracking Engine:** Own-fleet strict transition matrix, rank-based partner webhook handler (`POST /api/webhooks/:carrierCode`), mock partner progression simulator, dual-mode **Admin Routing Strategy** (`OWN_ONLY` / `PARTNER_ONLY` / `AUTO_OPTIMIZED`), and unauthenticated public timeline (`/track`).
- **Field Agent Operations (`/agent`):** Online availability toggle, auto-assign + unassigned pool claiming, first-mile pickup confirm/fail, barcode/QR scanner, Delivery OTP handover verification (3 attempts, 15m TTL, 60s resend cooldown, supervisor bypass, auto-RTO on max failures).
- **Hub Sorting & Dispatch (`/hubs`):** Hub IN/OUT scans, exception flagging, ageing inventory alerts, vehicle assignment, linehaul manifests (`POST /api/manifests/:id/close` -> bulk `IN_TRANSIT`).
- **Customer Service, Notifications & Claims (`/support`, `/admin` Tab 3):** Unified `Notification` persistence (`SMS`/`EMAIL` dispatch + retry), operational exceptions queue, and support tickets / damage claim refunds (`/api/tickets`).
- **GST Tax Invoices, Analytics & Exports (`/orders`, `/admin` Tab 4):** Sequential `INV-YYMM-00001` Tax Invoice PDFs (`/api/shipments/:id/invoice`), live KPI dashboard (`/api/reports/analytics`), financial ledger, and RFC-4180 CSV export (`/api/reports/export/shipments.csv`).
- **Security Hardening & Payments (Phase 10):** `helmet` headers, `X-Request-Id` correlation logging, `express-rate-limit` on `/api`, `/api/auth`, and public endpoints, `validateProductionSecrets()` boot guard, constant-time HMAC comparison, expanded `Idempotency-Key` coverage, live Razorpay Checkout modal integration (`frontend/src/lib/api.ts`), and Next.js CSP headers.

---

## Automated Tests & Typechecks

```bash
# Backend unit + HTTP integration test suite (Node test runner + Neon/Postgres)
cd backend
npm test
npm run build

# Frontend typecheck + production bundle
cd ../frontend
npx tsc --noEmit
npm run build
```

---

## Production & Backup SOP

### 1. Required Production Environment Variables (`backend/.env`)
Generate cryptographically random secrets before running with `NODE_ENV=production` (the server refuses startup if defaults or undersized keys are detected):

```bash
NODE_ENV=production
PORT=4000
CORS_ORIGIN=https://your-frontend-domain.com
DATABASE_URL=postgresql://...?sslmode=require
JWT_ACCESS_SECRET=<random-32+-chars>
JWT_REFRESH_SECRET=<random-32+-chars>
ENCRYPTION_KEY=<64-hex-characters-for-AES-256>

# Live Razorpay Checkout & Webhook HMAC-SHA512
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...

# Optional external Notification delivery hooks (optional post-MVP)
SMS_PROVIDER=console        # set to webhook/provider when ready
SMS_WEBHOOK_URL=
EMAIL_PROVIDER=console
EMAIL_WEBHOOK_URL=
```

Configure Razorpay's webhook dashboard to deliver `payment.captured` events to:
`https://your-api-domain.com/api/webhooks/razorpay`

### 2. PostgreSQL / Neon Backup & Restore
- **Logical Backup (`pg_dump`):**
  ```bash
  pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" -f "bookcourier_$(date +%Y%m%d_%H%M%S).dump"
  ```
- **Restore (`pg_restore`):**
  ```bash
  pg_restore --clean --if-exists --no-owner --no-acl -d "$DATABASE_URL" bookcourier_YYYYMMDD_HHMMSS.dump
  ```
- **Neon Instant Recovery:** Use Neon Point-in-Time Restore (PITR) or branch-from-timestamp in the Neon Console before applying schema migrations or bulk data cleanups.

### 3. API Conventions
- Base path: `/api`
- Responses: `{ data, meta? }` on success, `{ statusCode, code, message, details? }` on error
- Correlation header: every response includes `X-Request-Id`.
