# BUSINESS-REQUIREMENT GAP ANALYSIS (v2 — dual-use-case model)

**Date:** 2026-11-09 · **Mode:** read-only audit · **Companion:** `PROJECT_AUDIT_REPORT.md` (v1), `REQUIREMENTS_TRACEABILITY.md`

This document re-audits the project against the **clarified business requirement**:
ONE e-commerce bookstore + ONE integrated courier system serving **two separate use cases**
(UC-1 deliver purchased books via 3P or own courier; UC-2 independent "send your own books"
via own courier only), with a `ShipmentType` distinction
(`BOOKSTORE_ORDER_SHIPMENT` vs `CUSTOMER_OWN_BOOK_SHIPMENT`) under centralized shipment management.

---

## A. Direct answers to the 10 questions

| # | Question | Verdict |
|---|---|---|
| 1 | Is the e-commerce bookstore complete? | **NO — NOT IMPLEMENTED.** DB models `Category/Product/Order/OrderItem` exist (Phase 1 scaffolding, seeded demo data) but **zero routes**: no catalog/browse/search, no product details, no cart, no checkout, no order APIs/pages. Frontend has no storefront at all. |
| 2 | Do bookstore orders support both courier options? | **NO.** No checkout exists, so no courier selection at checkout. The underlying router *can* return own + partner options (works today for standalone bookings) and `Shipment.orderId` is now in the schema, but the order→shipment pipeline is unimplemented. |
| 3 | Can customers independently book courier for their own books? | **YES — this use case works today.** `POST /api/shipments` (sender/receiver/weights/dims/pickup slot/protection/items) + `/book` wizard + payment-confirm hook. This is exactly UC-2 minus payment capture, employee assignment, and delivery OTP. |
| 4 | Do independent courier bookings work without a bookstore order? | **YES.** `Shipment.orderId` is nullable and the booking API has no order dependency. ⚠️ But the DB has **no `shipmentType` field** — a `CUSTOMER_OWN_BOOK_SHIPMENT` is currently identified by "no order linked", which is implicit, not explicit (below, §C). |
| 5 | Does 3P courier integration actually work? | **PARTIALLY.** Pipeline is proven end-to-end with the **MOCK** provider (external AWB, label, webhook/dev-advance → timeline → DELIVERED). A *real* provider does not exist: no real adapter, no webhook signature verification, no polling/retry queue, no credential encryption. |
| 6 | Does our own courier system work independently? | **PARTIALLY.** Booking → pricing → AWB → BOOKED event → pickup-task creation on payment ✔. **Missing:** employee assignment, checkpoint execution (pickup/hub/dispatch/out-for-delivery), delivery OTP verification. An in-house shipment currently *stalls* after `PICKED_UP`-ish states unless driven manually via admin event endpoint. |
| 7 | Are both shipment types connected to centralized shipment management? | **PARTIALLY.** One `Shipment` table, one `ShipmentLeg` model (OWN/PARTNER), one tracking engine, one public timeline — the *centralization* exists. What's missing: explicit `shipmentType` field, order-linked shipments (UC-1), and admin views that filter by type. |
| 8 | What is implemented? | See §B. |
| 9 | What is partially implemented? | See §C. |
| 10 | What is completely missing? | See §D. |

---

## B. Implemented (evidence)

| Feature | Evidence |
|---|---|
| UC-2 booking API (own books, no order needed) | `backend/src/routes/shipments.ts` `POST /api/shipments` (zod: sender, receiver, bookCount, dims, packaging, protection, items); `src/lib/shipments.ts createShipment` |
| AWB `BC+YYMM+seq+Luhn`, self-healing allocator | `src/lib/awb.ts` |
| Unified timeline for own/partner under one AWB | `src/lib/tracking.ts` (`recordEvent`, transition matrix), `GET /api/track/:awb` |
| 3P pipeline (simulated) | `src/lib/carriers/adapters/mock.adapter.ts`, `src/routes/webhooks.ts` (`POST /api/webhooks/:carrierCode`, `dev/MOCK/:extAwb/advance`) |
| Carrier abstraction (adding a real provider = 1 adapter) | `carrier.interface.ts` + `carrier-registry.ts` + `carrier-router.ts` |
| Admin routing switch (OWN_ONLY/PARTNER_ONLY/AUTO_OPTIMIZED) + carrier toggles | `src/routes/admin.ts` (`PATCH /settings/routing-strategy`, `PATCH /carriers/:id/toggle`) |
| Post-payment fulfilment hook (partner leg + OWN pickup task, idempotent) | `src/lib/payments.ts confirmPayment`, `src/routes/payments.ts` `POST /:shipmentId/confirm` |
| Idempotency-Key middleware | `src/middleware/idempotency.ts` (on shipments.create, payments.confirm) |
| Ownership/RBAC guards on shipment reads | `src/lib/shipment-access.ts` |
| Configurable pricing engine (volumetric→slab→fees→tax) | `src/lib/pricing.ts`, `PricingConfig`/`PricingRule` |
| E-commerce **data models** (scaffold only) | `Category`, `Product`, `Order`, `OrderItem` in `prisma/schema.prisma`; seed inserts 4 categories + 4 products |
| Frontend: landing, `/book` wizard, `/track`, `/login`, `/admin` (carrier switch) | `frontend/src/app/{,book,track,login,admin}/page.tsx` |
| Auth (JWT dual-token, customer OTP, staff password, 12 roles) | `src/lib/auth.ts`, `src/routes/auth.ts` |

## C. Partially implemented

| Item | What exists | What's missing |
|---|---|---|
| **UC-1 (deliver purchased books)** | `Shipment.orderId` column; router can price both models; customer addresses | **No catalog/browse/search APIs or pages, no cart, no checkout, no order API, no courier selection at checkout, no order→shipment creation.** The whole left half of UC-1 is absent. |
| **Explicit shipment type** | Distinguishable today only implicitly (`orderId == null`) | No `enum ShipmentType { BOOKSTORE_ORDER_SHIPMENT, CUSTOMER_OWN_BOOK_SHIPMENT }` on `Shipment`; no rule enforcing UC-2 = own-courier-only; no admin filter by type. |
| **3P courier** | Full plumbing via MOCK | Real provider adapter, webhook signature/secret, polling+retry (BullMQ), AES credential encryption, provider admin config UI. |
| **In-house operations** | Task created on payment; tracking matrix enforces all transitions | Employee assignment API/queue, checkpoint execution endpoints (pickup confirm/fail, hub scan-in/out, manifest close → IN_TRANSIT, out-for-delivery, delivery fail + RTO), employee screens/PWA, activity history. |
| **Delivery OTP** | `DeliveryOtp` schema; engine rule allows OTP-guarded DELIVERED | No OTP generation trigger at OUT_FOR_DELIVERY, no verify endpoint, no resend limits, no supervisor-exception path. |
| **Payments** | `confirmPayment` hook (dev endpoint) | Gateway (Razorpay) order/verify/webhook/refund; UC-1 & UC-2 both currently unpayable in production. |
| **Navigation structure (§4)** | `/book`, `/track`, `/admin`, `/login` | No Books/Category/Cart/My Orders/My Account pages; no "Book Courier Service" hub (Send My Books, Create Booking, My Bookings, Track); admin lacks orders/inventory/employees/checkpoints/OTP/pricing/reports screens. |
| **Notifications** | Console OTP logging only | No customer/staff notification service (booking, pickup, transit, OFD+OTP, delivered, failed, RTO). |
| **Dashboards/reports** | 1 KPI endpoint (PAID-only revenue, partner cost) | Admin/employee/customer dashboards, status distribution, on-time rate, RTO rate, margin reports, CSV export. |

## D. Completely missing

1. **Bookstore front-end + back-end**: `GET /catalog` (list/search/filter by category/price), `GET /products/:id`, cart (per-customer), `POST /checkout` (order + payment + fulfilment choice), `GET /orders` (my orders), order status flow PENDING→CONFIRMED→SHIPPED→DELIVERED.
2. **`ShipmentType` field + workflow separation** (UC-1 vs UC-2 enforced at booking: UC-2 must only offer OWN options; UC-1 offers both subject to serviceability).
3. **Employee console**: task board, assignment/reassignment, pickup/delivery confirmation screens, scan UI, activity history (agent account exists in seed but has no working endpoints).
4. **Checkpoint execution layer** for in-house legs (hub scans, manifests, OFD triggers, delivery fail/retry/RTO).
5. **Delivery OTP flow** (generate at OFD → 6-digit/15-min/3-attempt → verify → DELIVERED; admin exception with audit).
6. **Real 3P provider** (adapter + signatures + polling/retry + credential encryption + provider admin config).
7. **Payment gateway** (Razorpay order/verify/webhook/refunds; credit/refund on pre-pickup cancel).
8. **My Account area** (profile, saved addresses CRUD — `Address.isSaved` unused, order history, courier-booking history).
9. **Admin hub pages**: orders, inventory, providers, in-house bookings, all shipments (filter by type/provider/status/city), employee management, checkpoint monitor, OTP exceptions, pricing CRUD, finance, reports.
10. **Notifications** + **testing** + **hardening** (rate limits on public routes, helmet, CI).

---

## E. Revised roadmap (mapped to the clarified requirement)

| Phase | Deliverable | New/modified modules | Complexity |
|---|---|---|---|
| **2a** | `ShipmentType` enum + order linkage | schema migration (`Shipment.shipmentType` default CUSTOMER_OWN_BOOK_SHIPMENT; UC-1 sets BOOKSTORE_ORDER_SHIPMENT + orderId); booking API honors type (UC-2 restricted to OWN); admin filter param | **Low** |
| **2b** | Bookstore: catalog + cart + checkout | `routes/catalog.ts` (list/search/product), `routes/cart.ts` (per-customer lines), `routes/orders.ts` (create order → price fulfilment via existing router → payment confirm → create linked shipment; order status flow); admin inventory CRUD | **High** |
| **2c** | Customer storefront + My Account | pages: `/books`, `/books/:id`, `/cart`, `/checkout` (fulfilment picker = own vs 3P with price/ETA), `/orders`, `/account/{profile,addresses}`; customer "My courier bookings" list | **High** |
| **3** | "Book Courier Service" hub (UC-2 navigation) | `/courier` hub page (Send My Books → existing wizard, My Courier Bookings, Track), `GET /api/courier/bookings` (own-shipments list) | **Low-Med** |
| **4** | Payment gateway (Razorpay) | `lib/payments/razorpay.ts` (order/verify/webhook/refund) feeding existing `confirmPayment`; refund on pre-pickup cancel | **Med** |
| **5** | Real 3P provider | one real adapter + signature-verified webhook + BullMQ polling/retry + AES credential encryption + provider admin config/health UI | **High** |
| **6** | Employee management + assignment | agent login, task board API (`/agent/tasks`, assign/accept), employee dashboard page, activity history | **Med** |
| **7** | Checkpoint execution | pickup confirm/fail, hub scan-in/out, manifest close→IN_TRANSIT, OFD trigger, delivery fail/retry/RTO; attachments | **Med-High** |
| **8** | Delivery OTP | generate at OFD, verify endpoint, resend limits, supervisor exception + audit | **Med** |
| **9** | Notifications + dashboards/reports | notification service + triggers; admin/employee/customer dashboards; on-time/RTO/margin reports + CSV | **Med** |
| **10** | Hardening & CI | rate limits, helmet, E2E (Playwright) for UC-1/UC-2 flows, unit tests, deploy pipeline | **Med** |

**Dependency note:** 2a is the keystone — it makes the two use cases *first-class* before any storefront work. 2b/2c/3 can proceed in parallel; 4–8 are the fulfilment depth; 9–10 polish.

## F. Blockers for the stated FINAL EXPECTATION
1. No checkout/fulfilment choice → UC-1 cannot start. *(Phase 2a/2b)*
2. No explicit `ShipmentType` → workflows cannot be enforced-separated in code/UI. *(Phase 2a)*
3. No employee/OTP execution → UC-2 and in-house UC-1 cannot close the loop. *(Phases 6–8)*
4. No real provider + no gateway → "production" claims impossible. *(Phases 4–5)*

*No source files were modified for this audit.*

---

## G. STATUS UPDATE — Phase 2a IMPLEMENTED (2026-11-09, approved)

The keystone phase is **done and verified live**:

| Item | Evidence | Verified |
|---|---|---|
| `enum ShipmentType { BOOKSTORE_ORDER_SHIPMENT, CUSTOMER_OWN_BOOK_SHIPMENT }` + `Shipment.shipmentType` (default UC-2) | `backend/prisma/schema.prisma` | ✅ migrated |
| UC-2 quotes/booking own-courier-only | `carrier-router.ts` (`QuoteInput.ownOnly` suppresses partner + hybrid options), `shipments.ts` (`createShipment` rejects any partner leg plan for UC-2; backend `STALE_QUOTE` on `opt-mock` verified) | ✅ |
| UC-1 consistency rules | `POST /api/shipments`: `BOOKSTORE_ORDER_SHIPMENT` requires `orderId` (verified `ORDER_REQUIRED` rejection); `orderId` ownership-checked and type auto-set | ✅ |
| Shipments stamped with type | Default `CUSTOMER_OWN_BOOK_SHIPMENT` visible in API responses (`shipmentType` field, `orderId: null`) | ✅ |
| Admin/filtered listing | `GET /api/shipments?shipmentType=&status=` filters | ✅ |
| Wizard scoped to UC-2 | `frontend/src/app/book/page.tsx` quotes with `ownOnly: true` + "Send Your Books" copy | ✅ (typecheck + build) |

**What still remains for UC-1 (next phases, per §E):** Phase 2b (catalog + cart + checkout APIs + storefront, which creates `Order` and calls the booking API with `shipmentType=BOOKSTORE_ORDER_SHIPMENT` + `orderId`), then payment gateway (4), employee/assignment (6), checkpoints (7), delivery OTP (8).

**Services live:** backend `:4000`, frontend `:3000` (rebuilt with Phase 2a bundle).

## H. STATUS UPDATE — Phase 2b IMPLEMENTED (2026-11-09, approved)

The bookstore back-end + front-end is **done and verified live**:

| Item | Evidence | Verified |
|---|---|---|
| Catalog APIs | `GET /api/catalog` (search/category filter/pagination), `GET /api/catalog/categories`, `GET /api/catalog/:id`; admin inventory `POST/PATCH /api/admin/catalog/products` (staff-gated) | ✅ |
| Cart | `CartItem` model (per-customer, product-unique); `GET/POST/PATCH/DELETE /api/cart` | ✅ (2 lines, subtotal ₹10,499) |
| Checkout (UC-1) | `POST /api/orders` — cart → order, stock reservation + decrement, cart cleared, `Shipment` created as `BOOKSTORE_ORDER_SHIPMENT` with `orderId` link, order CONFIRMED + shipping folded into totals; `GET /api/orders` (owner-scoped, shipment linked) | ✅ |
| Both fulfilment options at checkout | UC-1 quote offers OWN + PARTNER; partner choice → partner leg on payment; own choice → pickup task on payment | ✅ both paths tested |
| Store config in DB | `PricingConfig.STORE_PICKUP_ADDRESS` / `STORE_PACK_DIMS` (seeded, editable) | ✅ |
| Frontend | `/books` (search, category filter, add-to-cart), `/books/[id]` (detail, qty), `/cart`, `/checkout` (delivery address → live fulfilment options → place order → confirm payment → AWB), `/orders` (my orders → track), `/courier` hub ("Send Your Books": create booking, my UC-2 bookings list filtered by `?shipmentType=CUSTOMER_OWN_BOOK_SHIPMENT`, track); nav + home updated | ✅ all routes 200 |
| UC-2 regression | `opt-mock` under default (UC-2) booking still rejected; own booking stamps `CUSTOMER_OWN_BOOK_SHIPMENT` | ✅ |

**Remaining (next phases, updated §I):** Phase 5 employee assignment, Phase 6 checkpoint execution, Phase 7 delivery OTP, Phase 3 real provider, Phase 9 dashboards/reports, Phase 10 hardening.

**Services live:** backend `:4000`, frontend `:3000` (11 routes, all serving).

## I. STATUS UPDATE — Phase 4 (payment capture) IMPLEMENTED (2026-11-09, approved)

The dev confirm hook is now a **provider-abstracted payment gateway** (Razorpay-ready; mock gateway in dev):

| Item | Evidence | Verified |
|---|---|---|
| Gateway abstraction | `backend/src/lib/payment/gateway.ts` — `createGatewayOrder` (Razorpay REST or deterministic mock when `RAZORPAY_KEY_ID` unset), `verifyClientPayment` (HMAC-SHA256 `order\|payment\|secret`), `markPaymentPaid` (idempotent), `refundPayment` (caps at paid−refunded, records `Refund`, updates `ShipmentFinancial`) | ✅ |
| Client flow | `POST /payments/:id/create-order` → (mock: signed payload / Razorpay: checkout modal) → `POST /payments/:id/verify` → mark PAID → fulfilment dispatch (idempotent `confirmPayment`); forged signature → 400 `SIGNATURE_INVALID`, payment stays PENDING | ✅ tested |
| Webhook (server-authoritative) | `POST /webhooks/razorpay` mounted with `express.raw` (pre-JSON-parser), HMAC-SHA512 via `RAZORPAY_WEBHOOK_SECRET` (dev no-secret accepts with logged warning), `payment.captured` → resolve order → mark paid → dispatch; always 200-ACK | ✅ no-op safe |
| Refunds | `POST /payments/:id/refund` (finance:refund/finance:read, audited): partial ₹100 OK, rest OK, over → `REFUND_EXCEEDS_PAID`/`NOTHING_TO_REFUND`; customer token → 403 | ✅ tested |
| Auto-refund on pre-pickup cancel | `cancelShipment` now refunds remaining paid amount (₹187.62 observed), records `ShipmentFinancial.refunded`; refund failure never blocks cancel (audit-flagged) | ✅ tested |
| **Latent defect fixed** | `requirePermission` ignored the seeded `*` wildcard → admins were 403 on permission-gated routes. Now honoured. | ✅ re-tested |
| Frontend | `payShipment()` in the API client: mock gateway = instant signed confirm (identical code path to prod Razorpay verify); checkout page pays through the gateway; payment-state endpoint exposes active `gateway` | ✅ built & served |
| UC-2 pay flow | `/book` confirmation screen now carries a **Pay ₹X** button (booking stays PENDING until paid; re-open = same provider order; re-tap = idempotent verify) — verified serving on `:3000` | ✅ |
| UC-2 regression (post-gateway) | UC-2 shipment booked → PENDING → create-order → verify → PAID + pickup task; admin partial refund ₹10 recorded; over-refund → 422 `REFUND_EXCEEDS_PAID` | ✅ tested |

| Idempotent re-open | `create-order` called twice returns the **same** provider order (reuses `payment.providerOrderId`; mock verify payload recomputed deterministically) — a client refresh/re-tap never double-creates orders | ✅ tested (`mock_ord_…` identical on both calls) |

**Remaining:** P3 real provider (signature-verified partner webhooks + polling), P5 employee assignment, P6 checkpoint execution, P9 dashboards, P10 hardening.

## J. STATUS UPDATE — Phase 7 (delivery OTP, in-house last mile) IMPLEMENTED (2026-11-09, approved)

Recipient-verified delivery for our OWN fleet, per plan §2.5/§5.1 ("DELIVERED from the agent app is only accepted with a verified OTP"):

| Item | Evidence | Verified |
|---|---|---|
| Issue trigger | Admin event `POST /admin/shipments/:id/events` → OWN leg `OUT_FOR_DELIVERY` (applied) → `issueDeliveryOtp` (idempotent; reuse live OTP); code returned only in dev console-SMS mode, logged `[OTP:DELIVERY]` | ✅ issued at OFD, code `499911` echoed |
| Partner exemption | `issueDeliveryOtp` inspects the active leg; `PARTNER` → `{issued:false, reason:'PARTNER_LEG'}`; partner shipment has **no** `DeliveryOtp` row → verify returns `DELIVERY_OTP_NOT_FOUND` | ✅ partner UC-1 order tested |
| Verify endpoint | `POST /api/shipments/:id/verify-delivery-otp` (owner/staff; 6-digit format guard; hashed, shipment-bound; 15-min expiry; **3-attempt cap** → `DELIVERY_OTP_LOCKED`); success consumes OTP + records `DELIVERED` via the single tracking engine (strict own matrix, audited) | ✅ wrong→INVALID, correct→delivered:true, 4th wrong→LOCKED |
| Config | `PricingConfig.DELIVERY_OTP_ENABLED` (seeded=1); kill-switch respected | ✅ |

**Note:** in prod the code is delivered out-of-band (Phase 11 notifications, U11); supervisor exception path remains in Phase 8/ops scope.

**Remaining:** P3 real provider, P5 employee assignment, P6 checkpoint execution, P9 dashboards, P10 hardening.
