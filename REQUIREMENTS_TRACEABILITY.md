# REQUIREMENTS TRACEABILITY — Bookstore E-Commerce & Dual Courier Platform

Maps every requirement of the problem statement to concrete implementation evidence:
file paths, API endpoints, and database components. Statuses: **F** fully / **P** partial / **N** not implemented / **D** defective / **V** needs validation.

Legend for DB: models live in `backend/prisma/schema.prisma`. Code paths are relative to `backend/` unless prefixed `frontend/`.

---

## §3 — Model 1: Third-Party Courier Integration

### §3.1 Courier Provider Management
| Req | Status | Evidence |
|---|---|---|
| Add providers | **N** | No `POST /api/admin/carriers` route; carriers only via `prisma/seed.ts` (`OWN`, `MOCK`). `Carrier` model exists (schema) |
| Secure credential config | **P** | `Carrier.credentialsEnc` / `webhookSecretEnc` columns exist in schema; **no AES-256-GCM code anywhere** (`grep -r createCipher src/` → none); `ENCRYPTION_KEY` env defined in `backend/.env` but unused |
| Endpoints/auth config | **P** | `Carrier.settings Json?` column exists; no API to edit it |
| Enable/disable provider | **F** | `PATCH /api/admin/carriers/:id/toggle` → `src/routes/admin.ts` (audited); UI switch in `frontend/src/app/admin/page.tsx` |
| Service availability / locations | **P** | `Pincode.partnerServiceable` + `City.status` gate availability (`src/lib/carriers/carrier-router.ts`); no admin CRUD for pincodes (`src/routes/serviceability.ts` is read-only check) |
| Integration status / API-failure monitor | **N** | No health/monitoring endpoint; `WebhookLog` stores raw payloads (`src/routes/webhooks.ts`) but no dashboard/alerts |
| Provider-specific config | **P** | `Carrier.settings` + `CarrierRateCard` model exist; no CRUD routes |
| Multi-provider without coupling | **F (arch)** | `src/lib/carriers/carrier.interface.ts` (`CarrierAdapter`), `carrier-registry.ts` (register by code), `carrier-router.ts` (quotes enabled partners generically). New provider = one adapter file + seed |

### §3.2 Shipment Creation via Provider API
| Step | Status | Evidence |
|---|---|---|
| Checkout + delivery info | **N** | No storefront/checkout (no Order model, no cart) |
| Weight calc + serviceability check | **F** | `src/lib/pricing.ts` (volumetric/chargeable), `src/routes/serviceability.ts` `GET /api/serviceability/check` |
| Obtain charges + ETA from providers | **P** | `POST /api/pricing/quote` (`src/routes/pricing.ts`) returns options incl. partner rate/etaDays from `MockCarrierAdapter.getRate` — only MOCK provider implemented |
| Customer selects courier | **F** | Option selection in `frontend/src/app/book/page.tsx` step 4 (`optionId`) |
| Create shipment via provider API | **D** | `src/lib/shipments.ts` `createShipment` → for PARTNER first leg calls `mock.createShipment` **immediately at booking (pre-payment)** — wrong ordering; and only for the MOCK adapter (hardcoded check `firstLeg.carrierCode === 'MOCK'`) |
| Store external AWB/label | **F** | `ShipmentLeg.externalAwb`, `labelUrl`, `partnerCost` written in same transaction |
| Error/retry/duplicate handling | **N** | No retry queue (Redis/BullMQ idle), no idempotency keys, no `WebhookLog`-style request logging for outbound partner calls |

### §3.3 Third-Party Tracking
| Req | Status | Evidence |
|---|---|---|
| Retrieve tracking from provider | **P** | `CarrierAdapter.fetchTracking(externalAwb)` defined; implemented for MOCK only (`adapters/mock.adapter.ts` returns simulator state); **no polling job** |
| Webhook ingest | **P** | `POST /api/webhooks/:carrierCode` (`src/routes/webhooks.ts`): logs `WebhookLog`, maps via `StatusMapping`, ingests via `recordEvent(source=PARTNER_WEBHOOK)`; **no signature/secret verification** |
| Display (provider, AWB, dates, status, checkpoints, ETA) | **F** | `GET /api/track/:awb` + `frontend/src/app/track/page.tsx` — provider shown via leg code/label; timeline = checkpoints; EST delivery present |
| Webhook idempotency | **F** | `@@unique([carrierId, externalEventId])` on `TrackingEvent`; dedup in `src/lib/tracking.ts` step 2 |
| Unmapped statuses → NOTE + admin queue | **P** | Unmapped → NOTE with `rawStatus` (route); **no admin queue UI** |

### §3.4 Value-Add Features
| Req | Status | Evidence |
|---|---|---|
| Unified tracking across providers | **F** | One timeline under our AWB (`/track/:awb`) for own/partner/hybrid legs |
| Centralized shipment history | **P** | `GET /api/shipments` (customer-scoped) — no admin list page |
| Customer-friendly timeline | **F** | `publicTimeline()` in `src/lib/tracking.ts` (masking) + vertical timeline UI |
| Order→shipment mapping | **N** | No `Order` model; shipment ↔ payment only |
| Exception/delay notifications | **N** | `Notification` model exists, zero writes anywhere in `src/` |
| Courier performance / cost analytics | **N** | `ShipmentFinancial.partnerCost` data available; no reports endpoint |
| Complaint/ticket management | **N** | `Ticket`/`TicketMessage` models exist; no routes, no UI |
| Cancellation management | **P** | API `POST /api/shipments/:id/cancel` (`src/lib/shipments.ts`, pre-pickup only); no UI, no partner-cancel call |
| Returns / reverse pickup | **N** | RTO statuses exist in matrix; no RTO initiation/delivery flow |
| Customer notifications | **N** | See notifications row |

---

## §4 — Model 2: In-House Courier

### §4.1 Customer Authentication
| Req | Status | Evidence |
|---|---|---|
| Register / login | **F** | `POST /api/auth/register`, `/request-otp`, `/verify-otp` (`src/routes/auth.ts`); OTP hashed, 10-min, 5-attempt (`src/lib/auth.ts`); `frontend/src/app/login/page.tsx` |
| Profile management | **N** | `User` model has fields; no update API/UI |
| Multiple delivery addresses | **N** | `Address` model + `isSaved` flag exist; **no CRUD routes** (addresses created only as booking snapshots in `src/lib/shipments.ts`) |
| Order / shipment / delivery history | **P** | `GET /api/shipments` lists own shipments; no order history (no orders), no dashboards |
| Track active shipments | **F** | `/api/track/:awb` + `/track` page |
| RBAC for admin/employee/customer | **P** | Role+permission guards (`src/lib/auth.ts` `requireRole/requirePermission`); 12 seeded roles; no employee-scoped data ownership checks (no employee API) |

### §4.2 Booking (A: own books / B: bookstore order)
| Req | Status | Evidence |
|---|---|---|
| Option A — own books | **F** | `POST /api/shipments` accepts sender/receiver/pickup address, book count, weight, dims, pickup slot, packaging, protection, item metadata (`src/routes/shipments.ts` zod schema); wizard `frontend/src/app/book/page.tsx` |
| Option B — bookstore order → auto shipment | **N** | No Order model/checkout; nothing links a purchase to a shipment |
| Auth-only booking | **F** | `requireAuth` on `POST /api/shipments`; customer profile derived from JWT |

### §4.3 Pricing Engine
| Req | Status | Evidence |
|---|---|---|
| Configurable, no hardcoding | **F** | All constants in `PricingConfig` rows (seeded, `volumetricDivisor`, `weightStepKg`, `taxRate`, `protectionRate`, `pickupFee`, packaging fees); formula in `src/lib/pricing.ts` §2.7-exact |
| Base/chargeable-weight/per-kg/zone/express | **P** | Slab pricing by (originZone, destZone, serviceType, maxWeight) + express service type; **no admin CRUD** (`PricingRule`/`PricingConfig` are seed-only data), no UI |
| Transparent pre-confirmation calculation | **P** | `POST /api/pricing/quote` returns full `QuoteBreakdown` (volumetric, chargeable, base, fees, tax, total, ETA) but the wizard UI shows only final price |

### §4.4 Shipment & Order Creation
| Req | Status | Evidence |
|---|---|---|
| Unique ID / searchable | **F** | AWB `BC+YYMM+seq+Luhn` via `src/lib/awb.ts` + `awb_sequence` table; public lookup by AWB |
| Sender/receiver/package/weight stored | **F** | Address snapshots + `Package` (dims, actual & chargeable weight, barcode) in `createShipment` tx |
| Charges recorded | **F** | `ShipmentFinancial.customerPrice/tax/partnerCost` written |
| Payment status | **P** | `Payment` row `PENDING` created; **no gateway, never becomes PAID** |
| Initial status + tracking ref | **F** | BOOKED event via `recordEvent(source=SYSTEM)` in same tx |
| Visible in employee/admin dashboard | **N** | No admin/employee shipment listing page; `GET /api/shipments` is customer-scoped |

### §4.5 Employee & Delivery Management
| Req | Status | Evidence |
|---|---|---|
| Manage employees | **N** | `Agent` model + 2 seeded agents (`prisma/seed.ts`); **no create/assign/shifts API or UI** |
| Assign shipments / pickups / deliveries | **N** | `Task` model (PICKUP/DELIVERY/RTO_RETURN/HUB_TRANSFER, statuses ASSIGNED→COMPLETED) exists; **zero task routes** |
| Employee dashboards (pending/in-transit/completed) | **N** | No routes, no frontend screens (no agent/PWA folder) |
| Employee accounts + scoped permissions | **P** | AGENT role + `task:own` permission seeded; **no endpoints consume them** |
| Activity history | **N** | `Task.completedAt/proofUrl` columns unused |

### §4.6 Checkpoint Management
| Req | Status | Evidence |
|---|---|---|
| Configurable checkpoints | **P** | 15 states + exception codes are code constants (`src/lib/tracking.ts` `ALLOWED_TRANSITIONS`, `EXCEPTION_CODES`, `STATUS_RANK`); admin cannot edit them |
| Immutability of events | **F** | `TrackingEvent` append-only (no update/delete path anywhere); corrections = new flagged events (§5.1 rule 2) |
| Transition validation | **F** | Strict matrix for OWN/ADMIN/AGENT_APP sources; rank-skip + branch rules for partner sources; 422 on invalid |
| Audit per update (prev/new status, location, employee, timestamp, remarks, proof) | **P** | `recordEvent` records status/location/remarks/actorUserId/eventTime + `AuditLog` write; **no proof attachment** (file storage not wired; `proofUrl` column unused) |
| Employee-driven updates | **N** | Only `ADMIN`/`SYSTEM`/`PARTNER_*` sources are reachable; `AGENT_APP` path exists in the engine but no agent API |
| Lifecycle execution (pickup, hubs, dispatch, OFD, fail, RTO) | **N** | No routes: no `/pickups`, no `/hubs/:id/scan-in|out`, no manifests, no delivery-fail/RTO — the schema-only `Hub`/`HubScan`/`Manifest`/`Vehicle`/`Task` models are dormant |

### §4.7 Customer Tracking
| Req | Status | Evidence |
|---|---|---|
| Track by ID without staff access | **F** | `GET /api/track/:awb` is public (rate limiting absent — §8); `/track` page |
| Display fields (status, cities, dates, package, current + full history, delivery status) | **F** | Timeline entries carry status/location/remarks/time; recipient city masked |
| Visual timeline (completed/current/upcoming) | **F** | Vertical timeline component (`frontend/src/app/track/page.tsx`), last event highlighted |
| No sensitive/internal leakage | **F** | `publicTimeline` filters flagged/non-applied + hides actor/`rawStatus`; verified by test session |
| Fulfils model-aware routing of tracking source | **F** | Single timeline fed by both own events and partner webhook events; verified for OWN and MOCK legs |

### §4.8 OTP Delivery Verification
| Req | Status | Evidence |
|---|---|---|
| Generate time-limited OTP at delivery | **N** | `DeliveryOtp` model exists (hashed, `expiresAt`, `attempts`, `verifiedAt`) — **no code path creates or verifies delivery OTPs** |
| 6-digit / expiry / retry limit / hashing / resend limits | **N** | Design rules from the plan; only the *login* OTP implements hashed+expiry+5-attempts (`src/lib/auth.ts issueOtp/verifyOtp`) |
| No DELIVERED without OTP (or admin exception + audit) | **V** | The *rule* is not yet enforced because there is no delivery-confirmation endpoint at all; `recordEvent` would accept a `DELIVERED` from ADMIN without OTP check today — the guard required by §5.1 ("DELIVERED from agent only with verified OTP/proof") is unimplemented |
| OTP audit logs | **N** | `AuditLog` infra exists; no OTP-specific entries |

---

## §5 — Unified Order & Shipment Management
| Req | Status | Evidence |
|---|---|---|
| One app, two fulfilment models | **F (arch)** | `ShipmentLeg.carrierType ∈ {OWN, PARTNER}` + `carrierId`; global strategy switch `PATCH /api/admin/settings/routing-strategy` (`src/routes/admin.ts`, persisted in `PricingConfig.ROUTING_STRATEGY`); per-carrier toggles |
| Identifiable fulfilment method per shipment | **F** | Legs expose carrierType/carrier; quote options labelled "Own Network"/"Partner"/"Hybrid" |
| Common + model-specific data | **F** | Common: `Shipment`/`TrackingEvent`; partner-specific: `externalAwb`, `labelUrl`, `partnerCost`, `StatusMapping`, `WebhookLog` |
| Admin: view all, filter by model/provider, search by ID/customer/city, status/delayed/failed/returned views, delivery performance | **N** | Only `GET /api/admin/dashboard` KPIs (and its revenue is PENDING-inclusive — defect) |
| Consistent customer experience | **P** | Same `/book` + `/track` for both models ✔; no customer dashboards, no per-shipment payment/refund actions |
| Tracking auto-selects correct mechanism | **F** | Own = internal events; partner = webhook/poll → same `recordEvent`; verified |

---

## §6 — Roles & RBAC
| Role (spec) | Status | Mapping / Evidence |
|---|---|---|
| Super Administrator | **F** | `SUPER_ADMIN` seeded, `*` permission; admin routes guarded |
| Bookstore Administrator | **P** | Closest: `CITY_MANAGER`/`FINANCE`; no bookstore-specific role (no bookstore domain) |
| Courier Operations Manager | **F** | `OPS_MANAGER` (shipment:read/update-tracking, carrier:manage) — guard used on carrier/strategy routes |
| Courier Employee (generic) | **P** | `AGENT` role + `task:own`/`tracking:agent` perms seeded — **no endpoints use them** |
| Pickup Employee / Delivery Employee (split) | **N** | Single `AGENT`; no duty-type distinction, no task-scoped endpoints |
| Customer | **F** | `CUSTOMER` + ownership-scoped list; 403 on admin routes verified |
| Permission definitions per role | **P** | `role_permissions` table seeded (`prisma/seed.ts`); per-route permission checks exist on admin routes; broad coverage lacking (no user/role management UI; no data-scope guards) |

---

## §7 — Dashboards & Reporting
| Req | Status | Evidence |
|---|---|---|
| Admin dashboard (totals by model, pending/in-transit/OFD/delivered/failed/returned/delayed, shipping revenue, courier expenses, status distribution) | **N** | `GET /api/admin/dashboard` returns 4 KPIs only; no page (`frontend /admin` = carrier switch only) |
| Employee dashboard | **N** | No API, no UI |
| Customer dashboard (orders, bookings, active/delivered/cancelled, history) | **N** | No page; raw `GET /api/shipments` exists |
| Reports + CSV export | **N** | No reports routes; `ShipmentFinancial` has the raw data (customer/tax/partner/own/refunded) |

---

## §8 — Technical & Architectural Requirements
| Requirement | Status | Evidence / gap |
|---|---|---|
| Modular backend | **F** | `src/lib/{auth,awb,pricing,shipments,tracking,carriers/*}` services behind thin routes |
| Reusable frontend components | **P** | API client `frontend/src/lib/api.ts`; bespoke page components; no shared component library (DataTable/StatusBadge/etc. absent) |
| Secure auth | **F** | JWT dual-token, rotation, revocation, hashed refresh + OTP, bcrypt |
| RBAC | **P** | Guards on routes; data-scoping (city/own) not enforced on detail reads — **defect: `GET /api/shipments/:id` and `/shipments/:id/tracking` accept any staff token** |
| DB relationships | **F** | 36 models, FK indexes, append-only event table with dedup unique |
| Shipment event history | **F** | `TrackingEvent` + `AuditLog` |
| API validation | **F** | zod on public routes (`auth`, `shipments`, `pricing`, `admin`); error envelope `{statusCode, code, message, details?}` central handler |
| Error handling / transactions | **F** | Central Express error handler; `recordEvent` + booking in Prisma transactions (tx-aware `recordEvent(input, tx)`) |
| Idempotent shipment creation | **N** | No `Idempotency-Key` header support; booking is not repeat-safe (a double-click creates two AWBs) |
| Secure 3P credential mgmt | **N** | Encrypted columns unused; no AES code |
| Webhook validation | **N** | No signature/secret check on `/api/webhooks/:carrierCode` |
| Background jobs (tracking sync) | **N** | Redis container up, no BullMQ/worker code |
| Notification integration | **N** | Console-only login-OTP logging; no provider abstraction, no queue, no `Notification` writes |
| Audit logging | **P** | Login, carrier toggle, strategy change, status change, terminal-event flag; missing: pricing edits (no CRUD), user/role mgmt (no routes), OTP delivery events |
| Input validation / unauthz protection | **P** | Validation ✔; unauthz: ownership guard absent for staff detail reads (defect), agent-ownership untestable (no agent API) |
| Provider abstraction | **F** | §3.1 architecture rows |
| No unnecessary tech changes | **F** | Existing stack retained (Express+Prisma+Postgres / Next.js) |

---

## §9.2 — Workflow Validation (evidence summary)

| Workflow | Verdict | Break point(s) |
|---|---|---|
| **A** — 3P courier | **D** | ✔ login → ✔ quote → ✔ book (MOCK external AWB) → ✔ track via webhook/dev-advance. ✘ bookstore selection & checkout (no storefront), ✘ real provider, ✘ post-payment creation ordering, ⚠ "delivery confirmation" = simulator |
| **B** — in-house for bookstore order | **N** | Only the customer login + generic booking primitive exists; ✘ order, ✘ employee assignment, ✘ checkpoint execution, ✘ delivery OTP |
| **C** — in-house own books | **P** | ✔ booking → ✔ AWB → ✔ public timeline at BOOKED. ✘ assignment → ✘ pickup/hub/dispatch → ✘ OTP → shipment stalls |
| **D** — customer tracking | **F** | AWB → auto model-detect via legs → correct timeline (verified both own & partner in this audit session) |

---

## Cross-cutting defect register (from §8/§9)
1. **Unscoped staff shipment detail** — `src/routes/tracking.ts` `GET /shipments/:id` + `/shipments/:id/tracking`: `requireAuth` only, no ownership/city check.
2. **Partner leg created pre-payment** — `src/lib/shipments.ts` lines ~155–172; hardcodes MOCK check.
3. **Dashboard revenue inflation** — `src/routes/admin.ts` sums all `ShipmentFinancial.customerPrice` regardless of payment status.
4. **Fragile strategy config read** — `src/lib/carriers/carrier-router.ts` `currentStrategy()` normalizes double-JSON seed legacy; seed now writes plain strings.
5. **OTP re-issue loop** — `issueOtp` has no per-target cap; a client can request unlimited fresh login codes.
6. **DELIVERED guard missing** — no OTP/proof check before accepting DELIVERED (endpoint absent, so the plan §5.1 rule is unenforced).
