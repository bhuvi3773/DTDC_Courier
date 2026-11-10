# Bookstore E-Commerce & Dual Courier Platform — PROJECT AUDIT REPORT

**Audit date:** 2026-11-09
**Scope:** Read-only inspection of the existing project at `/home/ubuntu/Bhuvan/` (`backend/`, `frontend/`, Prisma schema, seed, docker-compose). No source files were modified. No external courier API calls were made.
**Companion document:** `REQUIREMENTS_TRACEABILITY.md` (full requirement-by-requirement traceability).

---

## 1. Overall Architecture Assessment

### 1.1 What exists today

The project is a **two-folder split** (per the established main rule), matching the "provider-abstraction + in-house module feeding a common shipment layer" pattern the spec demands:

| Layer | Location | Status |
|---|---|---|
| API backend | `backend/` — Express 5 + Prisma 6 + PostgreSQL (port 4000) | Working, typecheck clean |
| Frontend | `frontend/` — Next.js 15 App Router + Tailwind (port 3000) | Working, production build passes |
| Database | `backend/prisma/schema.prisma` (36 models) + idempotent seed | Pushed to Postgres, seeded |
| Infra | `docker-compose.yml` (postgres 16 + redis 7) | Running |

**Third-party courier abstraction (Model 1) — present:**
- `src/lib/carriers/carrier.interface.ts` — `CarrierAdapter` (serviceability, rate, createShipment, fetchTracking, parseWebhook) — provider-agnostic ✔
- `src/lib/carriers/carrier-registry.ts` — registry by code; new provider = one adapter file ✔ (architecture goal met; only two providers registered: OWN + MOCK)
- `src/lib/carriers/adapters/mock.adapter.ts` — a **simulated** external provider with deterministic rates, fake AWB, and a dev-advance hook
- `src/routes/webhooks.ts` — inbound partner webhook pipeline: raw payload → `WebhookLog` → `StatusMapping` → `TrackingService.recordEvent` (dedup-safe), plus `POST /api/webhooks/dev/MOCK/:extAwb/advance`
- `src/routes/admin.ts` — global routing strategy switch (`OWN_ONLY`/`PARTNER_ONLY`/`AUTO_OPTIMIZED`, persisted in `PricingConfig`) and per-carrier enable/disable toggle with audit log; encrypted-credential columns exist in schema (`credentialsEnc`, `webhookSecretEnc`) but **no encryption code and no "add carrier" CRUD**

**In-house courier engine (Model 2) — present:**
- `src/lib/tracking.ts` — append-only `recordEvent` with the strict transition matrix, branch/rank rules, terminal flagging, out-of-order flagging, dedup on `(carrierId, externalEventId)`, leg-state updates, audit log
- `src/lib/awb.ts` — unique AWB `BC+YYMM+6-digit-sequence+Luhn` via atomic `awb_sequence` upsert
- `src/lib/pricing.ts` — configurable pricing engine (volumetric → chargeable weight → slab → fees → tax), `PricingConfig` + `PricingRule` data-driven, contract-override hook
- `src/lib/shipments.ts` — booking transaction: address snapshots, shipment, packages (barcodes), legs, financials, BOOKED event, PENDING payment order
- `src/routes/tracking.ts` — public `/track/:awb` (masked), staff full-detail, admin manual events with partner-leg restrictions
- `src/routes/serviceability.ts` — pincode serviceability check

**Auth/RBAC — present:**
- `src/lib/auth.ts` + `src/routes/auth.ts` — JWT (15-min access / 7-day rotating refresh, hashed & revocable), customer OTP login (hashed, 10-min expiry, 5 attempts, console provider), staff email+bcrypt login, `requireAuth`/`requireRole`/`requirePermission` guards, audit entries on login/role changes
- Seeded roles: `SUPER_ADMIN, OPS_MANAGER, CITY_MANAGER, HUB_MANAGER, SUPERVISOR, FINANCE, SUPPORT, ACCOUNT_MANAGER, AGENT, CUSTOMER, BUSINESS_OWNER, BUSINESS_USER` (string-keyed permission set in `role_permissions`)

### 1.2 Top-level verdict

The codebase is a **solid "courier core"**: unified shipment + tracking engine, provider abstraction, in-house lifecycle rules, pricing engine, RBAC, and customer-facing booking/track/admin pages. **It is NOT yet the target application.** The two biggest structural gaps:

1. **There is no bookstore.** No products/inventory/orders/cart/checkout models, pages, or APIs exist. "Model 2 Option B — ship books purchased from our bookstore" has no bookstore order to start from. The entire book-merchant half of the spec is unimplemented.
2. **In-house operations are half-wired.** The schema has `Agent`, `Task`, `Hub`, `HubScan`, `Vehicle`, `Manifest`, `DeliveryOtp`, `Notification`, `Ticket` — but **no routes implement them**: no employee task assignment, no pickup/delivery confirmation, no hub scans, no manifest dispatch, and no delivery OTP. The in-house lifecycle currently ends at `BOOKED` (or partner-driven statuses via the MOCK simulator). The tracking matrix *permits* the full lifecycle, but nothing executes it.

Second-order gaps: no real courier provider (only MOCK), no payment gateway (Razorpay is referenced as a provider-string constant only), no notifications, no dashboards/reports beyond one KPI endpoint, no tests, no hardening (rate limiting, helmet, idempotency keys, webhook signature verification, credential encryption).

---

## 2. Requirement-by-Requirement Status Matrix

Statuses: **F** = Fully implemented, **P** = Partially implemented, **N** = Not implemented, **D** = Implemented but defective, **V** = Needs validation.
(Section numbers refer to the problem statement; per-item detail and file traceability in `REQUIREMENTS_TRACEABILITY.md`.)

| Requirement (§) | Status | Existing implementation | Missing functionality |
|---|---|---|---|
| **§3.1 Courier provider management** | **P** | `Carrier` model + seed (OWN, MOCK); admin toggle `PATCH /api/admin/carriers/:id/toggle`; routing-strategy switch; `credentialsEnc`/`webhookSecretEnc` columns | No add-provider API/UX; no secure credential form (AES code absent); no provider config CRUD (endpoints, service availability, pickup/delivery locations); no API-failure monitoring/dashboard; no status-mapping editor UI; no "test connection" |
| **§3.2 Shipment creation via 3P API** | **P** | Router produces partner options; `MockCarrierAdapter.createShipment` returns external AWB + label URL; booking stores `externalAwb`/`labelUrl`/`partnerCost` on the leg; PENDING payment order | No **real** provider adapter (Delhivery/Shiprocket/etc.) — architecture supports it, none implemented; no error/retry/queue for failed partner creation (U9 polling/retry absent); creation happens *before* payment success instead of after; no idempotency keys |
| **§3.3 3P tracking** | **P** | Webhook pipeline ingests partner events via `StatusMapping` → append-only timeline under our AWB; `fetchTracking` defined on adapter interface | No polling job (BullMQ/Redis unused beyond container); no webhook signature verification; no unmapped-status admin queue UI; MOCK advance is a manual dev hook; partner location/ETA display not enriched |
| **§3.4 Value-adds beyond provider** | **P** | Unified timeline across own+partner under one AWB; centralized shipment list; public customer timeline; order→shipment mapping (via booking) | No exception/delay notifications; no courier performance or shipping-cost analytics; no complaint/ticket UI/API (model exists, no routes); no cancellation management UI (API `POST /shipments/:id/cancel` exists, no page); no return/reverse-pickup flows; no customer notifications at all |
| **§4.1 Customer authentication** | **P** | Register + OTP login (customer), JWT context, role-scoped lists; `/api/auth/me` | No profile management UI/API (name/email/phone updates); no address book CRUD (addresses are booking-time snapshots only — `Address.isSaved` unused by any route); no customer dashboards (orders/shipments/deliveries pages absent) |
| **§4.2 Shipment booking (A: own books)** | **F** | `POST /api/shipments` covers sender/receiver/weights/dims/books/protection/pickup slot/notes; frontend wizard `/book`; re-quote on booking; AWB + tracking ref; partner or own leg plan | "Preferred pickup date" stored but not used for task scheduling (no tasks yet); Option B (auto-shipment from bookstore order) impossible — no bookstore |
| **§4.3 Weight-based pricing** | **P** | `PricingService.quote` (volumetric, chargeable step, slab, pickup/packaging/protection fees, tax) — fully configurable in DB | No admin CRUD for `PricingRule`/`PricingConfig` (seed-only data); no express surcharge toggle in UI; no distance-zone configurability UI; no charge transparency breakdown in the wizard UI (only final price shown) |
| **§4.4 Shipment & order creation** | **P** | Unique AWB; sender/receiver/package storage; PENDING payment record; BOOKED event; searchable public tracking | "Available in employee/admin dashboard" — no admin shipment dashboard page; payment never moves to PAID (no gateway); no label PDFs (`pdfkit`/`qrcode` installed but unused); no order entity (booking ≠ order) |
| **§4.5 Employee & delivery management** | **N** (backend) / **N** (frontend) | `Agent` model + 2 seeded agents; `Task` model (PICKUP/DELIVERY/RTO/HUB_TRANSFER) with status enum; `requireRole` guards exist | No agent/employee creation or login-scoped API; no task assignment/accept endpoints; no employee dashboard; no activity history query endpoints; AGENT role has no working entry point at all |
| **§4.6 Checkpoint management** | **P** | Full 15-state transition matrix enforced in `TrackingService.recordEvent` (append-only, flagged-not-mutated, audit-logged, `TrackingEvent` immutable in practice); admin manual-event endpoint w/ partner-leg rules | **No execution layer**: no pickup-confirmation, hub scan-in/out, manifest close, out-for-delivery, delivery-fail endpoints (all U8); checkpoints are DB-validated, not operationally reachable; no attachment/proof upload (S3/local storage not wired); no configurable-checkpoint admin (statuses are code constants); no employee self-update paths (only ADMIN source) |
| **§4.7 Customer shipment tracking** | **F** | `/api/track/:awb` public + `/track` page: vertical timeline, current status, masked recipient, EST delivery, exceptions styled; hidden internal fields (actor, raw status, flagged events) | No login-gated "My shipments" view; no package-detail panel; in-house vs partner distinction not surfaced on the page (works for both under one timeline — acceptable); no history across past shipments |
| **§4.8 OTP delivery verification** | **N** | `DeliveryOtp` schema exists (hashed, expiry, attempts, verifiedAt) — unused; console SMS/email providers exist only for *login* OTP | No delivery-OTP generation/verification flow; no "out for delivery → OTP" trigger; no supervisor-exception delivery workflow; no delivery audit log; retry/rate-limit rules (15-min/3-attempt/6-digit) not implemented |
| **§5 Unified order & shipment management** | **P** | Single `Shipment` model with `ShipmentLeg.carrierType` (OWN/PARTNER) + `carrierId`; one API surface; public timeline mixes both under one AWB; strategy switch changes routing globally | No admin unified dashboard (list/filter/search by model, provider, city, customer, delayed/failed/returned — §7); no `Order` entity linking bookstore orders to shipments; no fulfilment-method filter; no delivery-performance view |
| **§6 Roles & RBAC** | **P** | 12 seeded roles with permission strings; role & permission guards on routes; customer 403s on admin routes (verified) | Spec's 7 roles map imperfectly (no distinct `BOOKSTORE_ADMIN`, `PICKUP_EMPLOYEE` vs `DELIVERY_EMPLOYEE` — single `AGENT`); permission enforcement is coarse (role-based, not per-endpoint permission audit); agent ownership guard (only own tasks) not implemented — no agent endpoints at all |
| **§7 Dashboards & reporting** | **N** | One KPI endpoint `GET /api/admin/dashboard` (booked today, in transit, exceptions, revenue-from-financials) | No admin dashboard page (frontend `/admin` is only carrier switch); no employee dashboard; no customer dashboard; no reports: on-time rate, pickup success, first-attempt delivery, damage/loss, cost/revenue/margin per shipment, partner performance, agent productivity, RTO rate, complaint resolution; no CSV export; no status-distribution chart |
| **§8 Technical requirements** | mixed | Provider adapter architecture ✔; append-only event history ✔; zod validation on public routes ✔; transactional booking ✔; transaction-aware `recordEvent` ✔; modular `src/lib` layout ✔ | ❌ Idempotent shipment creation (`Idempotency-Key` absent); ❌ secure credential encryption (AES-256-GCM referenced, not implemented); ❌ webhook signature verification (raw `WebhookLog` stored, secret unused); ❌ background jobs (Redis running, BullMQ absent); ❌ notification integration; ❌ audit coverage is partial (logins, carrier toggles, strategy changes, status changes — not pricing/user mgmt); ❌ rate limiting, helmet, CORS lock-down (CORS currently single-origin string, OK-ish); ✅ input validation present; ⚠ protection against unauthorized shipment updates: staff `GET /shipments/:id` has **no ownership/city scoping** — any staff token reads any shipment (defect) |
| **§9.2 Workflow A (3P)** | **D** | Book → partner option → booking creates external AWB (MOCK) → webhook/dev-advance advances timeline → public track | Defective for the spec: creation happens before payment; no real provider; no retry/queue; "delivery confirmation" comes from simulator, not provider confirmation event |
| **§9.2 Workflow B (in-house for bookstore order)** | **N** | No bookstore, no order→shipment automation, no employee assignment, no checkpoint execution, no delivery OTP | Entire chain missing except the shipment/booking primitive |
| **§9.2 Workflow C (in-house for own books)** | **P** | Chain works through shipment creation + public tracking; **stops** at BOOKED — no assignment/pickup/hub/OTP execution | Employee assignment, checkpoint execution, OTP verification missing |
| **§9.2 Workflow D (customer tracking)** | **F** | AWB → auto-detects fulfilment model internally (leg carrierType) → correct timeline for both own and partner; verified in this audit session | Only public-by-AWB; no authenticated "my shipments" variant |

**Defects found (D):**
1. **Unscoped staff shipment reads** — `GET /api/shipments/:id` (tracking route) requires auth but not ownership/city scoping; any staff role can read any shipment. Customer lists are scoped, details are not.
2. **Partner leg created pre-payment** — a MOCK (or real) partner shipment is created at booking, not at payment success; the spec's ordering (checkout → pay → create shipment) is not honoured.
3. **`/api/admin/dashboard` revenue** sums `customerPrice` across *all* shipments regardless of payment status (PENDING included) — mislabels as revenue.
4. **Pricing strategy read tolerance hack** — `currentStrategy()` normalizes a double-JSON-encoded seed value; seed now writes plain strings, so this is fragile technical debt, not a user-facing defect.
5. **`OtpCode` login rate limit** — bounded by 5 attempts per code, but no per-target lockout across codes; repeated `request-otp` can issue fresh codes indefinitely.

**Security/reliability gaps (summary):** no webhook signature check; no AES credential encryption (plaintext JSON columns); no rate limiting on public endpoints (`/track`, `/serviceability`, `/auth/*`); no helmet/CSRF posture for a cookie-less JWT API (low risk, note it); secrets in `.env` only (good); no test suite; no Sentry/structured logging; no backup/restore procedure; Postgres running with default credentials (dev-only, fine locally).

---

## 3. Third-Party Courier Assessment (Model 1)

**Architecture: strong.** The adapter + registry + router boundary is exactly what §8 asks for; a new provider is one adapter file + status-mapping seed, no router/tracking changes. Webhooks log raw payloads and ingest idempotently through the shared tracking engine.

**Reality: only a simulator exists.** `MOCK` proves the plumbing (external AWB, labels, event ingest, dedup) but:
- no real provider credentials, endpoints, or sandbox;
- no signature verification (so a real webhook from Delhivery/Shiprocket would be accepted unauthenticated);
- no polling fallback (plan §5.4) — Redis is up but no queue/worker;
- no retry/backoff on partner `createShipment` failure;
- partner cost lands in `ShipmentFinancial.partnerCost` ✔, but margin/reporting views don't exist;
- provider monitoring (API failures, health) absent.

## 4. In-House Courier Assessment (Model 2)

**Engine: strong, execution: absent.** The tracking matrix, AWB generator, and pricing engine are production-shaped and test-clean. But the operational loop — *assign employee → pickup → hub → dispatch → out-for-delivery → OTP → delivered* — has **zero endpoints** (U8 of the original plan). `Task`, `Agent`, `Hub`, `HubScan`, `Manifest`, `Vehicle`, `DeliveryOtp` are dormant schema. Consequences:
- a booked in-house shipment sits at `BOOKED` forever in production;
- employees have accounts seeded but no way to log in to anything that works;
- delivery OTP (§4.8, a highlighted "most important" requirement alongside checkpoints) is unimplemented;
- checkpoint *configuration* is code-constant, not admin-editable (§4.6 asks configurable).

## 5. Unified Shipment Management Assessment

One `Shipment` + `ShipmentLeg` per fulfilment model, one timeline, one AWB namespace, global strategy switch + per-carrier toggles — the unification requirement is structurally satisfied. Missing: the **Order** concept (bookstore order → shipment mapping), the admin unified list/filter/search UI, and delivery-performance reporting across models.

## 6. Database Schema Assessment

36 models, FKs indexed, `TrackingEvent` append-only with dedup unique + `(shipmentId, eventTime)` index, `ShipmentLeg @@unique([shipmentId, sequence])`, `PricingConfig`/`PricingRule` config-driven. Gaps:
- no `Book/Product`, `Inventory`, `CartItem`, `Order`, `OrderItem`, `Category` (entire merchant half);
- `Notification`/`Ticket`/`Manifest`/`Task`/`DeliveryOtp`/`HubScan`/`Vehicle` models exist unused;
- no idempotency-key table; no `RefreshToken` table **is** present ✔; `OtpCode` present ✔ (login only);
- `Invoice` model present but no numbering/issuance logic; `BusinessAccount/Contract` present but bulk/credit flows absent (plan U17, out of current scope).

## 7. API & Backend Assessment

| Area | Verdict |
|---|---|
| Conventions (§7: `/api` base, `{data,meta}`/error envelopes, pagination, ISO dates, decimal-string money) | ✔ implemented |
| Auth | ✔ working; defects listed above (OTP re-issue loop, refresh rotation role read) |
| Shipments | ✔ create/list/detail/cancel; ❌ detail unscoped; ❌ no idempotency |
| Tracking | ✔ public masked + staff full + admin manual (own-leg rule enforced) |
| Pricing | ✔ quote + strategy; ❌ no rule/config CRUD |
| Carriers | ✔ toggle + strategy + dev-advance; ❌ no add/credentials/test-connection; ❌ no signature check |
| Webhooks | ✔ pipeline (mock); ❌ unauthenticated; ❌ no polling/retry |
| Missing route modules | agent/employee tasks, pickups, hubs/manifests, delivery OTP, payments, notifications, tickets, dashboards, reports, bookstore (products/inventory/cart/orders/checkout) |

## 8. Frontend & UI Assessment

| Page | State |
|---|---|
| `/` landing | ✔ static, on-brand |
| `/track` | ✔ functional timeline vs backend (verified) |
| `/book` | ✔ 4-step wizard → options → AWB; ❌ no charge breakdown, no pickup-slot picker, no "ship purchased books" path (no storefront) |
| `/login` | ✔ OTP + staff; OTP code sourced from backend console (dev-only, must replace with provider) |
| `/admin` | Partial — carrier toggles + strategy only; ❌ no dashboard KPIs, no shipment list, no employee management, no provider config, no pricing UI |
| Missing entirely | bookstore storefront/catalog/cart/checkout, customer dashboard ("My orders/shipments"), employee/PWA screens (mobile agent app), reports pages, provider-credential forms, exception/flagged-event queues |

## 9. Authentication & RBAC Assessment

Dual JWT (15-min access, 7-day rotating refresh, hashed + revocable), bcrypt staff, hashed OTP with expiry/attempts, permission-string RBAC with guards on every protected route. Verified: customer → 403 on admin. Gaps: no per-role UI gating, no agent-ownership checks (no agent API), coarse permission audit, customer 403 verified but staff data-scoping (city/own) not enforced on detail reads.

## 10. End-to-End Workflow Validation (results of this audit)

- **A (3P):** `login(OTP) ✔ → select books ✘ (no storefront) → checkout ✘ → courier option ✔ (quote UI) → create via API ✔ (MOCK) → AWB ✔ → store ✔ → track ✔ (webhook/dev-advance) → display ✔ → delivery confirmation ⚠ (simulator only)`. **Result: broken at bookstore steps; courier half works with a simulated provider.**
- **B (in-house for order):** `login ✔ → select books ✘ → checkout ✘ → in-house select ⚠ (own option in wizard) → weight pricing ✔ (quote) → confirm ✔ (booking) → shipment ID ✔ → assign employee ✘ → pickup ✘ → checkpoints ⚠ (matrix only) → OTP ✘`. **Result: not runnable.**
- **C (in-house own books):** `login ✔ → booking ✔ → sender/receiver/weight ✔ → pricing ✔ → confirm ✔ → shipment ID ✔ → assign ✘ → pickup ✘ → checkpoints ⚠ → OTP ✘`. **Result: runs to BOOKED, then stalls.**
- **D (customer tracking):** `AWB entry ✔ → model auto-detection ✔ (leg carrierType) → correct timeline ✔ (both models verified) → display ✔`. **Result: fully working.**

## 11. Critical Gap List (§9.1)

1. **No bookstore domain** (products, inventory, cart, orders, checkout, GST invoice) — largest single gap.
2. **No employee/agent operations** (assignment, task status flow, mobile/PWA screens, activity history).
3. **No delivery OTP flow** (`DeliveryOtp` dormant).
4. **No checkpoint execution layer** (pickup confirm/fail, hub scan-in/out, manifest close → IN_TRANSIT, out-for-delivery, delivery fail/retry/RTO).
5. **No real courier provider** (signature-verified webhooks, polling/retry queue, credential encryption, test-connection).
6. **No payments** (gateway order/verify/webhook/refund; currently PENDING forever; partner creation pre-payment — defect).
7. **No notifications** (providers defined as interface concept only; no queue, no records written).
8. **No dashboards/reports** beyond one KPI endpoint; no CSV export; no status-distribution/performance views.
9. **No admin CRUD** for pricing rules/config, providers, users/roles UI, status-mapping editor, exception queue.
10. **No tests, no hardening** (rate limiting, helmet, idempotency, backup/restore, CI).
11. **Security items:** webhook signature verification, AES credential encryption, OTP re-issue loop, unscoped shipment detail read.

## 12. Missing Files & Modules (concrete)

```
backend:
  src/lib/payments/ (razorpay order/verify/webhook/refund)
  src/lib/notifications/ (sms/email providers + queue + Notification writes)
  src/lib/courier/ (real adapter(s), signature verify, polling worker)
  src/routes/agent.ts | tasks.ts | hubs.ts | manifests.ts | delivery.ts | payments.ts | notifications.ts | tickets.ts | reports.ts | catalog.ts | orders.ts | addresses.ts | users.ts | pricing-admin.ts
  src/jobs/ (worker: partner polling, carrier createShipment retry, notifications)
frontend:
  /catalog, /product, /cart, /checkout (storefront)
  /customer/{orders,shipments,addresses,profile,tickets}
  /employee (mobile-first: tasks, scan, OTP entry, history)
  /admin/{dashboard,shipments,pickups,agents,hubs,manifests,providers,pricing,mappings,exceptions,finance,users,reports}
  shared components (DataTable, StatusBadge, BarcodeScanner, ConfirmDialog…)
prisma: new models Product/Category/Inventory/Order/OrderItem/CartItem (+migrations)
```

## 13. Prioritized Implementation Roadmap (phases per §10)

| Phase | Deliverable | Key changes | Complexity |
|---|---|---|---|
| **1** | Architectural & DB gaps | New Prisma models (Product, Category, Inventory, Order, OrderItem, IdempotencyKey); order↔shipment link (`orderId` on Shipment or Shipment.orderId); idempotency middleware; fix unscoped shipment read; move partner-leg creation to post-payment hook | **Low** |
| **2** | Bookstore + customer integration | Catalog/inventory APIs + storefront pages (list, detail, cart, checkout); customer address book + profile + dashboards; checkout selects fulfilment model (3P vs in-house) and price | **High** (largest chunk) |
| **3** | Real 3P provider | One real adapter (Delhivery or Shiprocket sandbox): auth/token refresh, serviceability, rate, createShipment, label, cancel, fetchTracking, webhook parse; signature-verified `/webhooks/:code`; AES-256-GCM credential storage; BullMQ polling + retry/backoff + failure alerts; provider admin UI (credentials, mappings, test-connection, health) | **High** |
| **4** | In-house booking + pricing completion | Admin CRUD for PricingRule/PricingConfig (+express/zone fees UI); charge breakdown in wizard; pickup-slot scheduling; label PDF (pdfkit/qrcode already installed) | **Medium** |
| **5** | Employees & assignment | Agent/employee login (existing OTP/password + AGENT role), task auto-creation on payment (in-house legs), assign/reassign/reschedule endpoints, employee dashboard (pickups/transit/deliveries, history); split PICKUP/DELIVERY employee roles per §6 | **Medium** |
| **6** | Checkpoint execution | Pickup confirm/fail, hub scan-in/out, manifest create/close → IN_TRANSIT, out-for-delivery trigger, delivery fail + retry + RTO; attachment/proof storage (local driver→S3); make checkpoint labels admin-configurable; keep append-only events | **Medium-High** |
| **7** | Delivery OTP | `DeliveryOtp` generation on OUT_FOR_DELIVERY, 6-digit/15-min/3-attempt/hash, verify endpoint w/ proof-or-OTP rule + supervisor exception w/ mandatory audit; resend limits | **Medium** |
| **8** | Notifications & exceptions | Provider interface (SMS/email console→real), queue-driven sends with `Notification` records, retries; triggers: booked, pickup, transit, OFD (+OTP), delivered, failed, RTO, refund, ticket; exception + flagged-event admin queues | **Medium** |
| **9** | Dashboards & reporting | Admin KPI page (fix revenue to PAID-only + expenses + status distribution), employee & customer dashboards; report endpoints (on-time, pickup success, first-attempt, damage/loss, cost/revenue/margin, partner perf, agent productivity, RTO, complaint time) + CSV export; finance (payments/refunds/invoices/margin) | **Medium** |
| **10** | Security & production | Rate limiting on public routes, helmet, idempotency everywhere it mutates, dependency audit, Playwright E2E for workflows A–D + unit tests (transition matrix, pricing, OTP, dedup, webhook sig), CI/CD + staging/prod, backup/restore SOP | **Medium** |

**Phase dependencies:** 1 → (2 ∥ 3) → 4 → 5 → 6 → 7 → 8 → (9 ∥ 10). Payments (start of Phase 3/4 work) must land before Phase 5–7 task automation is meaningful; Workflow B stays broken until 2+4+5+6+7 all complete.

## 14. Blockers to Production Readiness (final list)

1. No real courier provider integration (only MOCK) — orders cannot be fulfilled by a real 3P carrier.
2. No payment capture — no shipment is ever `PAID`; in-house task creation depends on it.
3. In-house operations unimplemented (assignment/checkpoints/OTP) — in-house shipments stall at BOOKED in production.
4. No bookstore — "ship books purchased from our bookstore" (Workflow B) has no source orders.
5. Webhooks unauthenticated; credentials unencrypted — security blockers.
6. No tests, rate limiting, or CI — reliability blockers.
7. Admin data-scoping defect on shipment detail read — access-control blocker.
8. No notification channel — OTP/delivery confirmation unusable in production (console provider is dev-only).

---

*All findings above verified against source on 2026-11-09. Running services: backend `:4000`, frontend `:3000`, Postgres/Redis via docker-compose. No files were modified during this audit.*
