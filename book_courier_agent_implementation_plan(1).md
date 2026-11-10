# Book Courier Services — Implementation Plan for the Coding Agent

**Companion document:** `book_courier_build_plan.md` (structure, features, flows). This file tells the coding agent **exactly what to build and in what order**, with the specs and acceptance criteria for each unit.

---

## 0. Rules for the Coding Agent

1. **Read this whole file before writing code.** Build units in the order given. Do not start a unit until the previous unit's acceptance criteria pass.
2. **Unified Full-Stack Architecture (Matching Previous Application: Snappy Gifts):** The application is structured as a unified **Next.js (App Router) + TypeScript** full-stack project under `book-courier/`. UI pages and API route handlers reside under `src/app/` (with route groups for `(public)`, `(customer)`, `(business)`, `admin`, `agent`, and `/api/`), while domain logic, database operations, and carrier adapters are cleanly modularized in `src/lib/` (e.g. `src/lib/carriers/`, `src/lib/tracking/`, `src/lib/pricing/`, `src/lib/prisma.ts`).
3. **One source of truth:** our database. Partner APIs and agents only *feed events in*. They never own shipment state.
4. **Tracking is append-only.** Never update or delete a `tracking_events` row. Corrections are new events.
5. **Every carrier, including our own network, goes through the `CarrierAdapter` interface.** No carrier-specific code outside `src/lib/carriers/adapters/`. Internal fleet logic (`OwnNetworkAdapter`) and external partner logic (`PartnerAdapter` implementations) are completely separate, isolated functions. The Admin has an immediate toggle/switch in the dashboard to choose between Own Network, External Partner, or Auto routing modes.
6. **Enforce permissions in the backend API layer** with route guards/session checks on every API route handler. Hiding a button is not security.
7. **Secrets** live in `.env` only. Never commit them. Provide `.env.example`.
8. **Use TypeScript strict mode.** Validate all incoming API request bodies and frontend forms using zod schemas.
9. **Write tests with each unit** (see each unit's acceptance criteria). A unit is done only when its tests pass.
10. **Commit after each unit** with the message `feat(<unit-id>): <summary>`.
11. **Do not invent business rules.** Pricing values, SLAs, delivery windows and surcharges must be **configurable data** (DB tables or seed files), not hardcoded constants.
12. **Do not promise delivery times** in the UI. Show "estimated" only, from configured route data.
13. If something is ambiguous, pick the simplest option that matches this plan, and write the choice in `docs/DECISIONS.md`.

---

## 1. Tech Stack (Standardized with Previous Application: Snappy Gifts)

| Layer | Choice |
|---|---|
| Full-Stack Framework | Next.js 16 (App Router) + React 19 + TypeScript |
| UI & Styling | Tailwind CSS v4 + Lucide React (`lucide-react`) + Motion (`motion` / Framer Motion) + shadcn/ui patterns |
| Agent app | Route group `(agent)` inside the Next.js app, built as an installable PWA (camera barcode scanning via `@zxing/browser` or `html5-qrcode`) |
| Backend & API Layer | Next.js App Router Route Handlers (`src/app/api/...`) with domain services modularized in `src/lib/` |
| ORM / DB | Prisma ORM (`@prisma/client` v6+) + PostgreSQL |
| Queue / cache | Redis + BullMQ (with background job runner in `src/jobs/` or standalone worker) |
| Auth | Dual JWT tokens (15-min access + 7-day rotating refresh), phone/email OTP, Bcrypt password hashing |
| Payments | Razorpay (orders, verify signature, webhooks, refunds) |
| Notifications | Provider interfaces for SMS and email, with a console/log provider for development |
| File storage | S3-compatible (local disk driver in development) |
| PDF | `pdfkit` or `puppeteer` for labels, manifests, invoices |
| Testing | Playwright (end-to-end user journeys) + `tsx` automated unit/integration test runners (matching `src/test/`) |
| Local infra | Docker Compose: postgres, redis (or native local PostgreSQL service) |

### Environment variables

**.env.example**
```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://courier:courier@localhost:5432/book_courier
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=change-me-access-secret-32-chars-min
JWT_REFRESH_SECRET=change-me-refresh-secret-32-chars-min
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
NEXT_PUBLIC_APP_URL=http://localhost:3000
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
NEXT_PUBLIC_RAZORPAY_KEY_ID=
SMS_PROVIDER=console
EMAIL_PROVIDER=console
STORAGE_DRIVER=local
S3_BUCKET=
S3_REGION=
S3_ACCESS_KEY=
S3_SECRET_KEY=
CARRIER_POLL_INTERVAL_MINUTES=30
```

---

## 2. Domain Constants (implement exactly)

### 2.1 Shipment statuses

```
BOOKED
PICKUP_SCHEDULED
PICKUP_FAILED
PICKED_UP
AT_ORIGIN_HUB
IN_TRANSIT
AT_DESTINATION_HUB
OUT_FOR_DELIVERY
DELIVERY_FAILED
DELIVERED          (terminal)
RTO_INITIATED
RTO_IN_TRANSIT
RTO_DELIVERED      (terminal)
CANCELLED          (terminal)
LOST               (terminal)
```

### 2.2 Exception codes (events that do NOT change status, shown on the timeline)

```
DELAYED, DAMAGED, WET_OR_TAMPERED, ADDRESS_ISSUE, RECIPIENT_UNAVAILABLE,
DELIVERY_REFUSED, PARTNER_DELAY, ROUTE_DISRUPTION, PAYMENT_ISSUE, REATTEMPT_REQUESTED
```

Each exception event requires: reason, timestamp, responsible actor or carrier, next action, and an audit record.

### 2.3 Allowed status transitions (strict mode, used for OWN events)

| From | Allowed next |
|---|---|
| BOOKED | PICKUP_SCHEDULED, CANCELLED |
| PICKUP_SCHEDULED | PICKED_UP, PICKUP_FAILED, CANCELLED |
| PICKUP_FAILED | PICKUP_SCHEDULED, CANCELLED |
| PICKED_UP | AT_ORIGIN_HUB, IN_TRANSIT, LOST |
| AT_ORIGIN_HUB | IN_TRANSIT, LOST |
| IN_TRANSIT | AT_DESTINATION_HUB, OUT_FOR_DELIVERY, LOST |
| AT_DESTINATION_HUB | OUT_FOR_DELIVERY, IN_TRANSIT, LOST |
| OUT_FOR_DELIVERY | DELIVERED, DELIVERY_FAILED |
| DELIVERY_FAILED | OUT_FOR_DELIVERY, RTO_INITIATED |
| RTO_INITIATED | RTO_IN_TRANSIT, RTO_DELIVERED |
| RTO_IN_TRANSIT | RTO_DELIVERED, LOST |

### 2.4 Status rank (used for PARTNER events, which may skip steps)

```
BOOKED 10, PICKUP_SCHEDULED 20, PICKED_UP 30, AT_ORIGIN_HUB 40, IN_TRANSIT 50,
AT_DESTINATION_HUB 60, OUT_FOR_DELIVERY 70, DELIVERED 100
```
Branch statuses (PICKUP_FAILED, DELIVERY_FAILED, RTO_*, LOST, CANCELLED) are always accepted from partners if the shipment is not already terminal.

### 2.5 Identifiers

- **Primary AWB:** `BC` + `YYMM` + 6-digit zero-padded database sequence + 1 Luhn check digit. Example: `BC2611000123` + check digit. Generated server-side, unique, never reused.
- **External AWB:** stored separately on `shipment_legs.externalAwb`.
- **Delivery OTP:** 6 digits, expires in 15 minutes, max 3 verification attempts, stored hashed.

### 2.6 Roles

`SUPER_ADMIN, OPS_MANAGER, CITY_MANAGER, HUB_MANAGER, SUPERVISOR, FINANCE, SUPPORT, ACCOUNT_MANAGER, AGENT, CUSTOMER, BUSINESS_OWNER, BUSINESS_USER`

Permissions are stored as strings like `shipment:read`, `shipment:update-tracking`, `pricing:write`, `carrier:manage`, `finance:refund`. A `role_permissions` table maps roles to permissions and is seeded.

### 2.7 Pricing formula (all inputs configurable)

```
volumetricWeightKg = (L_cm * W_cm * H_cm) / volumetricDivisor        (default divisor 5000, configurable per service)
chargeableWeightKg = ceil-to-step( max(actualWeightKg, volumetricWeightKg), weightStepKg )   (step default 0.5)
base               = slab price for (originZone, destZone, serviceType, chargeableWeight)
subtotal           = base + pickupFee + packagingFee + protectionFee(declaredValue * protectionRate) + serviceSurcharge
tax                = subtotal * taxRate                                  (taxRate from config)
total              = subtotal + tax
```
Business contracts override `base` and surcharges where a contract matches.

### 2.8 Carrier operational modes & Admin switch

The system supports two independent fulfillment pathways that can be dynamically controlled by the Admin:
1. **Own Network (`OWN`):** Driven by internal operations — Agent PWA, internal hubs, company manifests, and delivery OTP verification. Rates come from internal `PricingRule` matrices.
2. **External Partner (`PARTNER`):** Driven by third-party courier APIs (e.g., Delhivery, Shiprocket, or Mock in dev) — external AWB generation, partner shipping labels, and status updates ingested via webhooks and polling.
3. **Hybrid Multi-Leg:** Combines both (e.g., `[OWN Pickup, PARTNER Linehaul, OWN Delivery]`) under a single continuous customer timeline.

**Admin Switching Controls (`/admin/carriers` and `/admin/settings`):**
- **Global Routing Strategy:**
  - `OWN_ONLY`: Bypasses external partners; books only through our own fleet.
  - `PARTNER_ONLY`: Bypasses internal fleet; routes all orders to partner APIs.
  - `AUTO_OPTIMIZED` (Default): Compares own fleet and partner quotes; presents the best balance of cost and ETA.
- **Carrier Toggle:** Immediate per-carrier enable/disable switch (`Carrier.isEnabled`).
- **Manual Leg Override:** Ops Managers can manually switch an individual shipment leg between `OWN` and `PARTNER` before dispatch if internal capacity is constrained.

### 2.9 Book courier domain specifics & packaging matrix

Book shipping has specific physical and logistical properties:
- **Volumetric calculation:** Dense packages (paper) vs boxed collections. Formula: `(L * W * H) / 5000` compared against actual weight; billed on `chargeableWeightKg` rounded up to the nearest `weightStepKg` (default 0.5 kg).
- **Packaging Options:**
  - `CUSTOMER_PACKED`: Shipper packs books; agent verifies condition and seals.
  - `COMPANY_PACKED`: Agent provides reinforced book wrap/cardboard sleeves and corner protectors.
  - `COMPANY_PACKED_FRAGILE`: Moisture-barrier waterproof casing and heavy-duty bubble lining (recommended for rare, antique, or collectible books).
- **Itemization:** Optional per-book item metadata (`title`, `isbn`, `quantity`, `isFragile`).
- **B2B Bulk Shipping:** Bulk Excel/CSV upload with row-level validation for bookstores and publishers, applying contracted corporate credit lines.

---

## 3. Repository Scaffold

```
book-courier/
├── prisma/
│   ├── schema.prisma          # Prisma PostgreSQL schema
│   ├── migrations/            # Auto-generated migrations
│   └── seed.ts                # Master seed (cities, hubs, rates, carriers, roles)
├── src/
│   ├── app/                   # Next.js App Router (pages & endpoints)
│   │   ├── (public)/          # Landing, service overview, public track page
│   │   ├── (customer)/        # Customer dashboard, booking wizard, address book
│   │   ├── (business)/        # B2B portal, bulk CSV shipment upload, contract billing
│   │   ├── admin/             # Operations control tower (dispatch, carriers, switch)
│   │   ├── agent/             # Field agent mobile PWA (scanner, tasks, delivery OTP)
│   │   └── api/               # Serverless Next.js API route handlers
│   │       ├── auth/          # Login, OTP request/verify, refresh, logout
│   │       ├── shipments/     # Booking, cancellation, label PDF
│   │       ├── tracking/      # Public timeline, internal event append
│   │       ├── pricing/       # Live quote calculator, rate rules
│   │       ├── serviceability/# Pincode & city coverage verification
│   │       ├── carriers/      # Admin switch, status mappings, test connection
│   │       ├── hubs/          # Hub inward/outward scan, ageing monitor
│   │       ├── agent/         # Tasks, scan-to-event, offline sync, OTP
│   │       ├── manifests/     # Linehaul vehicle dispatch & handover
│   │       ├── payments/      # Razorpay order, verify signature, refunds
│   │       └── webhooks/      # Inbound carrier webhooks (Delhivery, Shiprocket)
│   ├── components/            # Reusable UI components (Tailwind, Lucide, Motion, shadcn)
│   ├── lib/                   # Core business logic & domain services
│   │   ├── prisma.ts          # Singleton Prisma client instance
│   │   ├── auth/              # JWT verification, RBAC guards, OTP generator
│   │   ├── carriers/          # Unified carrier abstraction
│   │   │   ├── carrier.interface.ts
│   │   │   ├── carrier-registry.ts
│   │   │   ├── carrier-router.ts
│   │   │   └── adapters/
│   │   │       ├── own.adapter.ts
│   │   │       ├── mock.adapter.ts
│   │   │       └── delhivery.adapter.ts
│   │   ├── tracking/          # Append-only TrackingEngine & transition matrix
│   │   ├── pricing/           # Volumetric calculator & contract pricing
│   │   ├── payments/          # Razorpay service & ledger management
│   │   ├── pdf/               # Barcode, label, manifest, invoice PDF generators
│   │   └── notifications/     # SMS & email provider abstraction
│   ├── types/                 # Shared TypeScript interfaces & DTO schemas
│   └── test/                  # Automated integration & Playwright test suites
├── docs/
│   ├── DECISIONS.md
│   └── API.md
├── docker-compose.yml
├── .gitignore
├── package.json
└── README.md
```

Backend service modularization and frontend route layouts are unified within the Next.js project structure matching `Snappy Gifts`.

---

## 4. Database Schema (Prisma, core models)

Create `prisma/schema.prisma` with at least the following. Add indexes on every foreign key, on `Shipment.awb`, `Shipment.status`, `TrackingEvent(shipmentId, eventTime)`, `Pincode.pincode`, `Task(agentId, status)`.

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

// ---------- Identity ----------
model User {
  id           String   @id @default(uuid())
  name         String
  email        String?  @unique
  phone        String?  @unique
  passwordHash String?
  isActive     Boolean  @default(true)
  roles        UserRole[]
  customer     Customer?
  agent        Agent?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
model Role { id String @id @default(uuid()) name String @unique perms RolePermission[] users UserRole[] }
model Permission { id String @id @default(uuid()) key String @unique roles RolePermission[] }
model UserRole { userId String roleId String user User @relation(fields: [userId], references: [id]) role Role @relation(fields: [roleId], references: [id]) @@id([userId, roleId]) }
model RolePermission { roleId String permissionId String role Role @relation(fields: [roleId], references: [id]) permission Permission @relation(fields: [permissionId], references: [id]) @@id([roleId, permissionId]) }
model RefreshToken { id String @id @default(uuid()) userId String tokenHash String expiresAt DateTime revokedAt DateTime? createdAt DateTime @default(now()) }
model OtpCode { id String @id @default(uuid()) target String purpose String codeHash String expiresAt DateTime attempts Int @default(0) consumedAt DateTime? createdAt DateTime @default(now()) }

// ---------- Customers ----------
enum CustomerType { INDIVIDUAL BUSINESS }
model Customer {
  id String @id @default(uuid())
  userId String @unique
  user User @relation(fields: [userId], references: [id])
  type CustomerType @default(INDIVIDUAL)
  businessAccountId String?
  businessAccount BusinessAccount? @relation(fields: [businessAccountId], references: [id])
  addresses Address[]
  shipments Shipment[]
}
model BusinessAccount {
  id String @id @default(uuid())
  legalName String
  gstin String?
  creditLimit Decimal? @db.Decimal(12,2)
  isApproved Boolean @default(false)
  customers Customer[]
  contracts BusinessContract[]
}
model BusinessContract {
  id String @id @default(uuid())
  businessAccountId String
  businessAccount BusinessAccount @relation(fields: [businessAccountId], references: [id])
  ruleJson Json            // overrides: slab multipliers, flat rates, surcharges
  validFrom DateTime
  validTo DateTime?
}

// ---------- Addresses & serviceability ----------
model Address {
  id String @id @default(uuid())
  customerId String?
  customer Customer? @relation(fields: [customerId], references: [id])
  name String
  phone String
  line1 String
  line2 String?
  landmark String?
  city String
  state String
  pincode String
  lat Float?
  lng Float?
  isSaved Boolean @default(false)   // false = snapshot attached to a shipment
}
model City {
  id String @id @default(uuid())
  name String @unique
  state String
  status CityStatus @default(INACTIVE)
  hubs Hub[]
  pincodes Pincode[]
}
enum CityStatus { INACTIVE ACTIVE SUSPENDED }
model Pincode {
  id String @id @default(uuid())
  pincode String @unique
  cityId String
  city City @relation(fields: [cityId], references: [id])
  zone String
  ownPickup Boolean @default(false)
  ownDelivery Boolean @default(false)
  partnerServiceable Boolean @default(true)
}

// ---------- Shipments ----------
enum ServiceType { LOCAL INTERCITY EXPRESS SCHEDULED RETURN }
enum PackagingOption { CUSTOMER_PACKED COMPANY_PACKED COMPANY_PACKED_FRAGILE }
enum PaymentStatus { PENDING PAID FAILED REFUNDED PARTIALLY_REFUNDED CREDIT }
model Shipment {
  id String @id @default(uuid())
  awb String @unique
  customerId String
  customer Customer @relation(fields: [customerId], references: [id])
  pickupAddressId String
  deliveryAddressId String
  serviceType ServiceType
  packaging PackagingOption @default(CUSTOMER_PACKED)
  bookCount Int
  parcelCount Int @default(1)
  declaredValue Decimal? @db.Decimal(12,2)
  protectionOpted Boolean @default(false)
  status ShipmentStatus @default(BOOKED)
  statusUpdatedAt DateTime @default(now())
  pickupSlotStart DateTime?
  pickupSlotEnd DateTime?
  estimatedDeliveryAt DateTime?
  paymentStatus PaymentStatus @default(PENDING)
  packages Package[]
  items ShipmentItem[]
  legs ShipmentLeg[]
  events TrackingEvent[]
  financial ShipmentFinancial?
  payments Payment[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
model Package {
  id String @id @default(uuid())
  shipmentId String
  shipment Shipment @relation(fields: [shipmentId], references: [id])
  actualWeightKg Decimal @db.Decimal(8,3)
  lengthCm Decimal @db.Decimal(8,2)
  widthCm Decimal @db.Decimal(8,2)
  heightCm Decimal @db.Decimal(8,2)
  chargeableWeightKg Decimal @db.Decimal(8,3)
  barcode String @unique       // per-package barcode = awb + "-" + index
}
model ShipmentItem { id String @id @default(uuid()) shipmentId String shipment Shipment @relation(fields: [shipmentId], references: [id]) title String? isbn String? quantity Int @default(1) isFragile Boolean @default(false) }

enum CarrierType { OWN PARTNER }
enum LegStatus { PLANNED ACTIVE COMPLETED FAILED CANCELLED }
model ShipmentLeg {
  id String @id @default(uuid())
  shipmentId String
  shipment Shipment @relation(fields: [shipmentId], references: [id])
  sequence Int
  carrierType CarrierType
  carrierId String?                     // null for OWN
  carrier Carrier? @relation(fields: [carrierId], references: [id])
  externalAwb String?
  labelUrl String?
  originLabel String                    // city/hub name
  destinationLabel String
  status LegStatus @default(PLANNED)
  partnerCost Decimal? @db.Decimal(12,2)
  events TrackingEvent[]
  @@unique([shipmentId, sequence])
}

// ---------- Tracking ----------
enum ShipmentStatus { BOOKED PICKUP_SCHEDULED PICKUP_FAILED PICKED_UP AT_ORIGIN_HUB IN_TRANSIT AT_DESTINATION_HUB OUT_FOR_DELIVERY DELIVERY_FAILED DELIVERED RTO_INITIATED RTO_IN_TRANSIT RTO_DELIVERED CANCELLED LOST }
enum EventKind { STATUS EXCEPTION NOTE }
enum EventSource { AGENT_APP ADMIN PARTNER_WEBHOOK PARTNER_POLL SYSTEM }
model TrackingEvent {
  id String @id @default(uuid())
  shipmentId String
  shipment Shipment @relation(fields: [shipmentId], references: [id])
  legId String?
  leg ShipmentLeg? @relation(fields: [legId], references: [id])
  kind EventKind @default(STATUS)
  status ShipmentStatus?
  exceptionCode String?
  rawStatus String?                     // partner's original status text
  source EventSource
  actorUserId String?
  carrierId String?
  externalEventId String?               // for webhook de-duplication
  locationLabel String?
  lat Float?
  lng Float?
  remarks String?
  proofUrl String?
  appliedToStatus Boolean @default(false)  // did this event change the shipment status
  flagged Boolean @default(false)          // rejected/out-of-order, needs review
  eventTime DateTime
  createdAt DateTime @default(now())
  @@unique([carrierId, externalEventId])
  @@index([shipmentId, eventTime])
}
model StatusMapping { id String @id @default(uuid()) carrierId String rawStatus String internalStatus ShipmentStatus? exceptionCode String? @@unique([carrierId, rawStatus]) }

// ---------- Carriers ----------
model Carrier {
  id String @id @default(uuid())
  code String @unique                   // OWN, MOCK, DELHIVERY, SHIPROCKET ...
  name String
  type CarrierType
  isEnabled Boolean @default(false)
  credentialsEnc String?                // AES-256-GCM encrypted JSON
  webhookSecretEnc String?
  settings Json?
  legs ShipmentLeg[]
}
model CarrierRateCard { id String @id @default(uuid()) carrierId String originZone String destZone String serviceType ServiceType maxWeightKg Decimal @db.Decimal(8,3) price Decimal @db.Decimal(12,2) etaDays Int }

// ---------- Operations ----------
model Agent { id String @id @default(uuid()) userId String @unique user User @relation(fields: [userId], references: [id]) cityId String isOnline Boolean @default(false) tasks Task[] }
enum TaskType { PICKUP DELIVERY RTO_RETURN HUB_TRANSFER }
enum TaskStatus { ASSIGNED ACCEPTED IN_PROGRESS COMPLETED FAILED CANCELLED }
model Task {
  id String @id @default(uuid())
  type TaskType
  shipmentId String
  agentId String?
  agent Agent? @relation(fields: [agentId], references: [id])
  status TaskStatus @default(ASSIGNED)
  scheduledFor DateTime?
  failureReason String?
  attemptNo Int @default(1)
  proofUrl String?
  completedAt DateTime?
  createdAt DateTime @default(now())
  @@index([agentId, status])
}
model DeliveryOtp { id String @id @default(uuid()) shipmentId String codeHash String expiresAt DateTime attempts Int @default(0) verifiedAt DateTime? }
model Hub { id String @id @default(uuid()) name String cityId String city City @relation(fields: [cityId], references: [id]) address String scans HubScan[] }
model HubScan { id String @id @default(uuid()) hubId String hub Hub @relation(fields: [hubId], references: [id]) shipmentId String direction String scannedBy String conditionNote String? scannedAt DateTime @default(now()) }
model Vehicle { id String @id @default(uuid()) regNo String @unique type String capacityKg Int cityId String }
model Manifest { id String @id @default(uuid()) code String @unique originHubId String destinationLabel String vehicleId String? carrierId String? status String @default("OPEN") items ManifestItem[] createdAt DateTime @default(now()) closedAt DateTime? }
model ManifestItem { manifestId String shipmentId String manifest Manifest @relation(fields: [manifestId], references: [id]) @@id([manifestId, shipmentId]) }

// ---------- Pricing ----------
model PricingRule { id String @id @default(uuid()) serviceType ServiceType originZone String destZone String maxWeightKg Decimal @db.Decimal(8,3) price Decimal @db.Decimal(12,2) etaDays Int isActive Boolean @default(true) }
model PricingConfig { id String @id @default(uuid()) key String @unique value Json }   // volumetricDivisor, weightStep, taxRate, protectionRate, pickupFee, packagingFees...

// ---------- Finance ----------
model Payment { id String @id @default(uuid()) shipmentId String shipment Shipment @relation(fields: [shipmentId], references: [id]) provider String providerOrderId String? providerPaymentId String? amount Decimal @db.Decimal(12,2) status PaymentStatus @default(PENDING) createdAt DateTime @default(now()) }
model Refund { id String @id @default(uuid()) paymentId String amount Decimal @db.Decimal(12,2) reason String providerRefundId String? createdAt DateTime @default(now()) }
model ShipmentFinancial { id String @id @default(uuid()) shipmentId String @unique shipment Shipment @relation(fields: [shipmentId], references: [id]) customerPrice Decimal @db.Decimal(12,2) tax Decimal @db.Decimal(12,2) partnerCost Decimal @default(0) @db.Decimal(12,2) ownCost Decimal @default(0) @db.Decimal(12,2) refunded Decimal @default(0) @db.Decimal(12,2) }
model Invoice { id String @id @default(uuid()) number String @unique shipmentId String? businessAccountId String? pdfUrl String? total Decimal @db.Decimal(12,2) issuedAt DateTime @default(now()) }

// ---------- Support, comms, governance ----------
model Ticket { id String @id @default(uuid()) shipmentId String? customerId String subject String status String @default("OPEN") type String @default("COMPLAINT") messages TicketMessage[] createdAt DateTime @default(now()) }
model TicketMessage { id String @id @default(uuid()) ticketId String ticket Ticket @relation(fields: [ticketId], references: [id]) authorUserId String body String createdAt DateTime @default(now()) }
model Notification { id String @id @default(uuid()) shipmentId String? channel String target String template String status String @default("QUEUED") payload Json? createdAt DateTime @default(now()) }
model AuditLog { id String @id @default(uuid()) actorUserId String? action String entity String entityId String before Json? after Json? ip String? createdAt DateTime @default(now()) }
model WebhookLog { id String @id @default(uuid()) carrierCode String headers Json? body Json processed Boolean @default(false) error String? receivedAt DateTime @default(now()) }
```

> The compact one-line models above are for brevity. The agent should format them normally in the real file.

---

## 5. Core Algorithms (implement exactly)

### 5.1 Tracking engine: `TrackingService.recordEvent(input)`

```
input: { shipmentId, legId?, kind, status?, exceptionCode?, rawStatus?, source,
         actorUserId?, carrierId?, externalEventId?, location?, remarks?, proofUrl?, eventTime }

1. Begin DB transaction, lock the shipment row (SELECT ... FOR UPDATE).
2. De-duplicate: if (carrierId, externalEventId) already exists → return the existing event (no-op).
3. If kind = EXCEPTION or NOTE → insert event (appliedToStatus=false). Done.
4. If kind = STATUS:
   a. current = shipment.status.
   b. If current is terminal (DELIVERED, RTO_DELIVERED, CANCELLED, LOST) → insert event with flagged=true, appliedToStatus=false. Done.
   c. If source is AGENT_APP or ADMIN (OWN events):
        valid = ALLOWED_TRANSITIONS[current].includes(status)
        if not valid → reject with 422 (agent/admin gets an error; nothing inserted).
   d. If source is PARTNER_*:
        if status is a branch status → valid
        else valid = rank(status) > rank(current)
        if not valid → insert flagged=true, appliedToStatus=false. Done (do not change status).
   e. Insert event (appliedToStatus=true), update shipment.status and statusUpdatedAt.
   f. Update leg status when relevant (first event on a leg → ACTIVE; DELIVERED or handover to next leg → COMPLETED).
   g. Write audit log.
5. Commit. After commit, enqueue notification job for customer-visible statuses.
```

Rules:
- `DELIVERED` from the agent app is only accepted with a verified OTP or an uploaded proof (checked in the delivery service before calling `recordEvent`).
- A manual admin update is allowed **only when the active leg's carrierType = OWN**. For PARTNER legs, admin can add NOTE/EXCEPTION events but not STATUS events (unless the role has `shipment:override-status`, which is logged with a mandatory reason).

### 5.2 Carrier router: `CarrierRouter.getOptions(quoteInput)`

```
1. Load origin and destination pincode rows (zone, city, ownPickup, ownDelivery, partnerServiceable).
2. Reject if either pincode is unknown or neither own nor partner can serve it.
3. options = []
4. Own option: allowed if origin.city.status = ACTIVE AND destination.city.status = ACTIVE
   AND both cities are connected by an own route (own pickup at origin AND own delivery at destination).
   Price from PricingRule. Leg plan: [OWN]
5. Partner options: for each enabled PARTNER carrier → adapter.checkServiceability() and adapter.getRate().
   Leg plan: [PARTNER]
6. Hybrid options (when configured): own pickup + partner linehaul + own last-mile where both ends are own-served
   but no own route exists between the cities. Leg plan: [OWN, PARTNER, OWN].
   Price = own pickup fee + partner rate + own delivery fee.
7. Each option returns: { optionId, legPlan, carrierCodes, price, etaDays, carrierTypeLabel }.
8. Sort by the configured default strategy (own-first | cheapest | fastest). Customer can choose; admin can override later.
9. Apply business contract overrides if the customer belongs to a business account.
```

### 5.3 Booking: `ShipmentsService.create(dto)`

```
1. Validate input and recompute price server-side (never trust client price).
2. Verify the chosen optionId is still valid (re-run the router).
3. In one transaction: create addresses (snapshots), shipment, packages (with barcodes), items, legs from the leg plan,
   shipment_financials, first tracking event BOOKED (source SYSTEM), AWB from DB sequence.
4. Create a payment order (status PENDING). Return { shipment, paymentOrder }.
5. On payment success (webhook or verify): paymentStatus = PAID, then for PARTNER legs call adapter.createShipment()
   and store externalAwb + labelUrl + partnerCost; for OWN first leg, create a PICKUP task.
6. If adapter.createShipment() fails: retry with backoff (queue). After max retries, flag shipment for admin and notify Ops.
```

### 5.4 Partner sync

- **Webhook:** `POST /webhooks/:carrierCode` → verify signature/secret → store raw `WebhookLog` → `adapter.parseWebhook()` → map statuses via `StatusMapping` → `TrackingService.recordEvent()` per event. Always respond 200 quickly after logging; process via queue when heavy.
- **Polling:** BullMQ repeatable job every `CARRIER_POLL_INTERVAL_MINUTES`. Select active PARTNER legs not in a terminal state, call `adapter.fetchTracking(externalAwb)`, map, record. Use a stable `externalEventId` (or hash of `status+timestamp+location`) for de-duplication.
- Unmapped partner statuses: record as NOTE with `rawStatus`, flag for admin to add a mapping.

### 5.5 Hybrid leg handover

When an OWN leg hands off to a PARTNER leg (manifest closed to partner), mark the current leg COMPLETED, activate the next leg, call `adapter.createShipment()` for the partner leg if not yet created, and record a `STATUS` event `IN_TRANSIT` with remarks "Handed over to <carrier>". When a PARTNER leg ends (partner reports delivered to our hub, or admin confirms hub receipt), record `AT_DESTINATION_HUB` and activate the final OWN leg.

### 5.6 Detailed Own-Network Operational Lifecycle for Book Courier

Our own courier service operates as an end-to-end internal logistics pipeline tailored for book shipments:

1. **Automated Task Creation:** On payment confirmation, the system creates a `PICKUP` task linked to the pickup pincode's active city and hub.
2. **Doorstep Pickup & Book Inspection:**
   - The field agent arrives at the sender's location with the Agent PWA.
   - Physical check: Verifies book count, condition (dry, unbent spines), and packaging mode (`CUSTOMER_PACKED`, `COMPANY_PACKED`, or `COMPANY_PACKED_FRAGILE`).
   - Barcode scan: Agent scans the parcel barcode using the camera scanner in the PWA.
   - Agent confirms pickup with optional condition notes and photo upload $\rightarrow$ system writes `PICKED_UP` event.
3. **Local Origin Hub Processing:**
   - Agent delivers gathered book parcels to the origin hub at shift end.
   - Hub staff performs an inward scan $\rightarrow$ system writes `AT_ORIGIN_HUB` event.
   - System monitors hub parcel ageing to prevent warehouse stagnation.
4. **Linehaul Dispatch & Manifesting:**
   - Hub manager creates a `Manifest` grouping all shipments heading to the same destination hub.
   - The manifest is assigned to a company vehicle registration number.
   - Closing the manifest records `IN_TRANSIT` status for all associated shipments in a single atomic database operation.
5. **Destination Hub Receiving:**
   - Receiving hub scans incoming manifest parcels $\rightarrow$ system records `AT_DESTINATION_HUB`.
   - Automated routing splits parcels into delivery zones and generates `DELIVERY` tasks assigned to local delivery agents.
6. **Last-Mile Delivery & OTP Verification:**
   - Agent accepts delivery task in the PWA $\rightarrow$ system triggers `OUT_FOR_DELIVERY` event.
   - A unique 6-digit Delivery OTP is dispatched via SMS/email to the recipient (valid for 15 minutes).
   - Agent reaches destination: Agent must enter and verify the recipient's OTP in the PWA (or submit supervisor-approved photo proof).
   - Once verified $\rightarrow$ system records `DELIVERED` (terminal state).
7. **Failed Delivery & RTO (Return to Origin):**
   - If recipient is unavailable or refuses $\rightarrow$ agent logs reason $\rightarrow$ system marks `DELIVERY_FAILED` and adds exception event (`RECIPIENT_UNAVAILABLE`, `DELIVERY_REFUSED`, etc.).
   - Max 3 delivery re-attempts. After 3 failures $\rightarrow$ status becomes `RTO_INITIATED`, manifest generated back to origin hub, and parcel returned to sender as `RTO_DELIVERED`.

### 5.7 Admin Mode Switch & Carrier Routing Engine

The Admin can switch between internal and external fulfillment modes at any time without code redeployments:

1. **Routing Strategy Setting (`PricingConfig.key = 'ROUTING_STRATEGY'`):**
   - `OWN_ONLY`: When evaluated in `CarrierRouter.getOptions()`, only `OwnNetworkAdapter` is queried. If the route is not serviceable by our own network, the booking is rejected as unserviceable.
   - `PARTNER_ONLY`: `OwnNetworkAdapter` is bypassed; only enabled partner adapters (`DelhiveryAdapter`, `ShiprocketAdapter`, `MockCarrierAdapter`) are queried.
   - `AUTO_OPTIMIZED`: Both Own and Partner quotes are evaluated; sorted according to configured preference (lowest cost, fastest ETA, or own-first).
2. **Individual Carrier Toggles (`Carrier.isEnabled`):**
   - The admin can turn on/off individual carriers via `/admin/carriers` with an instant toggle switch.
3. **Strict Separation of Adapter Functions:**
   - `OwnNetworkAdapter`: Pure internal logic; queries internal `PricingRule` matrices; `createShipment` creates internal legs/tasks; tracking is driven by internal agent/hub scans.
   - `PartnerAdapter`: External HTTP integration; quotes via partner REST APIs; `createShipment` fetches external AWBs and partner labels; tracking driven by partner webhooks/polling.
   - No partner API calls ever occur within `OwnNetworkAdapter`, and no agent tasks are ever generated by `PartnerAdapter`.
4. **Manual Ops Override:**
   - For any active booking before dispatch, an Ops/Hub Manager can change the carrier assigned to a leg from `OWN` to a partner (or vice versa), automatically generating the corresponding partner AWB or internal task.

---

## 6. Build Units (execute in order)

Each unit lists **Goal → What to build → Acceptance criteria**.

### U1 — Project scaffold and infrastructure
**Goal:** Unified Next.js full-stack platform scaffold matching Snappy Gifts, runnable out-of-the-box.
**Build:**
- Create `book-courier/` with Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4 + Lucide React + Motion + shadcn/ui.
- `docker-compose.yml` with postgres and redis; local package scripts (`npm run dev`, `npm run build`, `npm run typecheck`).
- API foundation: standard error response helper (`{ statusCode, message, code, details? }`), `/api/health` health check endpoint, configuration helper reading `.env`.
- Frontend structure: base layout, route groups `(public)`, `(customer)`, `(business)`, `admin`, `agent`, and `/api/`.
- Linters, TypeScript strict configuration, and `.env.example`.
- README with setup steps.
**Accept:** `npm run dev` starts the platform at `http://localhost:3000`; `/api/health` returns ok `{ status: "ok" }`; frontend renders the home page cleanly; typecheck passes.

### U2 — Database, migrations and seed
**Goal:** Full schema migrated, with seed data.
**Build:**
- Implement the Prisma schema from section 4 (normal formatting). Run the initial migration.
- DB sequence for AWB numbers.
- Seed script (`prisma/seed.ts`): roles and permissions (section 2.6), a Super Admin user, 3 cities (one ACTIVE own-network city pair plus one partner-only city), pincodes with zones, 2 hubs, sample agents, carriers `OWN` (enabled) and `MOCK` (enabled), status mappings for MOCK, pricing rules and `PricingConfig` defaults (volumetric divisor, weight step, tax rate, protection rate, pickup fee, packaging fees), a few demo customers.
**Accept:** `prisma migrate dev` and `prisma db seed` run cleanly on an empty database; seed is idempotent (running twice does not fail or duplicate).

### U3 — Authentication and RBAC
**Goal:** Secure accounts and permission enforcement.
**Build:**
- Endpoints: `POST /auth/register` (customer), `/auth/request-otp`, `/auth/verify-otp`, `/auth/login` (staff: email + password; customer: phone + OTP), `/auth/refresh`, `/auth/logout`, `GET /auth/me`.
- OTP: hashed, 10-minute expiry, 5 attempts max, rate-limited per target; delivered through the SMS/email provider interface (console provider logs the code in development).
- Refresh token rotation with hashed storage and revocation.
- `JwtAuthGuard`, `RolesGuard`, `PermissionsGuard`, `@Permissions()` decorator. Agents are restricted to their own tasks (ownership guard).
- Admin endpoints: create/disable users, assign roles, manage agents.
- Audit log entries for logins, role changes and permission changes.
- Frontend: login (customer OTP, staff password), register, auth context, route protection per role, redirect rules.
**Accept:** Tests prove that a CUSTOMER gets 403 on admin routes, an AGENT cannot read another agent's task, expired/used OTPs fail, and refresh rotation invalidates the old token.

### U4 — Serviceability and pricing engine
**Goal:** Know where we serve and what a shipment costs.
**Build:**
- Serviceability module: CRUD for cities, hubs, pincodes; activate / suspend / expand a city with pre-activation validation (hub exists, at least one pincode with own pickup and delivery, pricing rules exist for the city's zones). Block activation when validation fails and return the list of missing items.
- Public endpoint `GET /serviceability/check?from=&to=`.
- Pricing module: `PricingService.quote()` implementing section 2.7 including volumetric weight, chargeable weight, slab lookup, fees, protection, tax and business contract overrides. Admin CRUD for pricing rules and config.
- `POST /pricing/quote` returns the options from `CarrierRouter` (with only OWN and MOCK available at this point).
**Accept:** Unit tests cover volumetric vs actual weight, weight rounding, zone lookup, contract override, protection fee, tax; city activation fails with a clear list when prerequisites are missing.

### U5 — Shipments and AWB
**Goal:** Create and view bookings.
**Build:**
- AWB generator (section 2.5) with Luhn check digit.
- `POST /shipments` (section 5.3), `GET /shipments` (own list, filters, pagination), `GET /shipments/:id`, `POST /shipments/:id/cancel` (only allowed before pickup), label PDF with barcode and QR (`GET /shipments/:id/label`).
- Addresses CRUD (`/addresses`).
- Validation: pincode serviceable, weight and dimension limits from config, declared value required when protection is chosen.
- Initial `BOOKED` tracking event (via a minimal call to the tracking service; the full engine arrives in U6).
**Accept:** Creating a shipment returns a unique valid AWB; server recomputes price and rejects a tampered client price; cancelling after pickup fails; label PDF renders a scannable barcode.

### U6 — Tracking engine and public tracking
**Goal:** The single source of truth for status.
**Build:**
- `TrackingService.recordEvent()` exactly as in section 5.1, including strict vs rank validation, de-duplication, terminal-state handling, flagging, leg status updates, audit log.
- `GET /track/:awb` (public, rate-limited): returns timeline events (status events and customer-visible exceptions), current status, estimated delivery, and masked recipient details only. Hide internal fields (actor IDs, raw partner statuses, flagged events).
- `GET /shipments/:id/tracking` (authenticated, full detail for staff).
- `POST /admin/shipments/:id/events` (manual update; own-leg rule from section 5.1).
- Frontend: public tracking page with a `TrackingTimeline` component (vertical timeline, current status highlighted, exceptions styled differently), searchable by AWB.
**Accept:** Tests for every valid and invalid transition in section 2.3; partner-style skip (PICKED_UP → OUT_FOR_DELIVERY) accepted; out-of-order partner event is stored flagged and status unchanged; duplicate `externalEventId` is ignored; events on terminal shipments are flagged; public tracking never leaks private fields.

### U7 — Carrier abstraction, router, Admin Switch, and Mock adapter
**Goal:** Both modes plug into one interface with separate, clean adapter functions and an Admin switch.
**Build:**
- `CarrierAdapter` interface (as in the build plan), `CarrierRegistry` that resolves an adapter by carrier code, and `CarrierRouter` (section 5.2 & 5.7).
- `OwnNetworkAdapter` (pure internal fleet logic; rates from pricing rules; `createShipment` creates internal legs; tracking is event-driven from agent app/hubs; `fetchTracking` returns empty list).
- `MockCarrierAdapter` (simulates external partner API; deterministic rates; `createShipment` returns fake external AWB/label; simulator endpoint `POST /dev/mock-carrier/:externalAwb/advance` and webhook generator).
- **Admin Switch & Routing Strategy:** `GET /admin/carriers`, `PATCH /admin/carriers/:id/toggle` (enable/disable), and `PATCH /admin/settings/routing-strategy` (supports `OWN_ONLY`, `PARTNER_ONLY`, and `AUTO_OPTIMIZED`).
- Status mapping service: translates `rawStatus` to internal status or exception code using `StatusMapping`; unmapped → NOTE + admin queue.
- Encrypted carrier credential storage (AES-256-GCM using `ENCRYPTION_KEY`); admin endpoints to add/enable carriers and a "test connection" action.
- Leg planning when a booking is created (section 5.3) and leg handover logic (section 5.5).
**Accept:** When Admin sets `OWN_ONLY`, all quotes/bookings route exclusively to `OwnNetworkAdapter`; when set to `PARTNER_ONLY`, quotes route exclusively to partner adapters; a booking using MOCK option creates a PARTNER leg with an external AWB; advancing the mock produces timeline events under our AWB; a hybrid booking creates `[OWN, PARTNER, OWN]` legs and the timeline stays continuous; carrier credentials are never returned by any API.

### U8 — Own-network operations
**Goal:** Our agents and hubs can run the physical flow and update tracking.
**Build:**
- **Pickups:** auto-create a PICKUP task on payment, `POST /pickups/:id/assign` (admin/supervisor), reschedule, and optional auto-assign by city and current load.
- **Agent API:** `GET /agent/tasks`, `POST /agent/tasks/:id/accept`, `POST /agent/scan` (barcode → resolves shipment/package and records the correct event based on the agent's current task), `POST /agent/pickup/:id/confirm` (condition notes, photo), `POST /agent/pickup/:id/fail` (reason), `POST /agent/delivery/:id/send-otp`, `POST /agent/delivery/:id/confirm` (OTP or proof upload), `POST /agent/delivery/:id/fail` (reason, reschedule), `POST /agent/availability`.
- **Offline support:** the agent API accepts a batch `POST /agent/sync` of queued events with client timestamps and client-generated idempotency keys; all are validated through `TrackingService` and audited.
- **Hubs:** `POST /hubs/:id/scan-in`, `/scan-out` (records a `HubScan` with condition note, triggers `AT_ORIGIN_HUB` / `AT_DESTINATION_HUB` events), list of parcels currently in a hub with ageing.
- **Dispatch:** create and close manifests, add shipments (by scan or selection), assign vehicle or partner handover; closing a manifest records `IN_TRANSIT` for all items and triggers leg handover where applicable; manifest PDF.
- **Delivery:** OTP generation and verification (section 2.5), failed-delivery flow (reasons → `DELIVERY_FAILED` + exception event), reattempt tasks, RTO initiation after configurable max attempts, RTO delivery back to sender.
- **Exceptions:** admin endpoint to log exceptions (section 2.2) with reason, responsible party and next action; exception queue listing.
**Accept:** End-to-end test with only OWN legs: book → pay → pickup assigned → agent scans pickup → hub scan-in → manifest closed → destination hub scan → out for delivery → OTP delivered. Every step appears on the public timeline. Agent cannot mark delivered without OTP/proof, cannot touch tasks assigned to others, and offline batch sync with duplicate keys is idempotent.

### U9 — Partner integrations (real carriers)
**Goal:** Real existing courier services work through the same interface.
**Build:**
- Implement the first real adapter (an aggregator such as Shiprocket, or a direct carrier such as Delhivery) in `adapters/`: authentication/token refresh, serviceability, rate, create shipment, label, cancel, tracking fetch, webhook parsing.
- Add that carrier's status mappings as seed data.
- Webhook controller `POST /webhooks/:carrierCode` with signature or secret verification, raw payload logging (`WebhookLog`), idempotent processing.
- BullMQ polling job (section 5.4) with retry/backoff, and an alert (notification to Ops + admin dashboard banner) after repeated failures for a carrier.
- Fallback: if the selected partner rejects a booking, the router offers the next-best option and the admin can re-assign the leg to another carrier.
- Add further carriers by creating one adapter file and one mapping seed each. Do not modify the router or tracking engine for new carriers.
**Accept:** Against the carrier's sandbox (or recorded fixtures if no sandbox is available): rates return, a shipment can be created, a label is stored, a sample webhook produces timeline events, polling is idempotent, an unmapped status becomes a flagged NOTE, and partner cost lands in `shipment_financials`. All the same tests pass against the Mock adapter and the real adapter.

### U10 — Payments, invoices and refunds
**Goal:** Money flows with clean financial records.
**Build:**
- `POST /payments/create-order`, `POST /payments/verify` (signature check), `POST /webhooks/razorpay` (verified, idempotent), refund endpoint (`finance:refund` permission, full or partial, writes `Refund` and updates `ShipmentFinancial.refunded`).
- Auto-refund or flag for refund when a shipment is cancelled before pickup.
- Invoice generation (PDF) per shipment with tax breakdown; consolidated monthly invoice for business accounts. Sequential invoice numbers.
- `ShipmentFinancial` always stores customer price, tax, partner cost, own cost and refunded amount separately; margin computed on read.
- Business credit (only if the account is approved and within the credit limit) as an alternative payment status `CREDIT`; the ledger entries are recorded and cannot exceed the limit.
**Accept:** Payment success moves a shipment to paid and triggers carrier booking/pickup task exactly once (even with duplicate webhooks); a failed payment never creates a partner shipment; refunds cannot exceed the paid amount.

### U11 — Notifications
**Goal:** Customers and staff are informed automatically.
**Build:**
- Notification service with templates and provider interfaces (SMS, email; WhatsApp interface stubbed). Console providers for development; one real provider wired via env.
- Queue-driven sending with retries and a `Notification` record per message.
- Triggers: booking confirmed, pickup scheduled, picked up, in transit, out for delivery (with delivery OTP), delivered, delivery failed, RTO, refund processed, ticket updates; staff alerts for partner sync failures and flagged events.
**Accept:** Each trigger enqueues exactly one notification per event; failures retry and are visible; OTP SMS is sent only at the out-for-delivery step.

### U12 — Support, complaints and claims
**Goal:** Handle problems with an audit trail.
**Build:**
- Customer: create ticket (optionally linked to a shipment), reply, view status. Claim types: damaged, lost, wet/tampered, wrong delivery.
- Staff: ticket queue with filters, assign, reply, change status, link to shipment timeline; claim decision with reason; optional refund trigger via the payments module.
- Enforce claim reporting deadline from config.
**Accept:** A customer can raise a damage claim on a delivered shipment inside the deadline and not after it; all status changes are audited.

### U13 — Frontend foundation
**Goal:** Shared UI building blocks.
**Build:**
- Design tokens, layout shells (public header/footer, customer sidebar, admin sidebar with permission-based menu, agent mobile shell with bottom nav).
- Reusable components: `DataTable` (server-side pagination, sort, filter), `StatusBadge`, `TrackingTimeline`, `AddressForm`, `PincodeInput` (serviceability check), `FileUpload`, `BarcodeScanner`, `ConfirmDialog`, `EmptyState`, toast system.
- Typed API hooks per module. Loading, error and empty states everywhere.
- Accessibility basics (labels, focus, contrast) and responsive layouts.
**Accept:** Storybook or a `/dev/components` page shows each component; layouts work at mobile and desktop widths.

### U14 — Customer website
**Goal:** Customers can book, pay and track.
**Build:**
- **Home:** hero with "Track shipment" and "Book shipment", services, how it works, business services, support.
- **Track:** AWB search and timeline (from U6).
- **Booking wizard (multi-step):** sender → recipient → parcel (books count, weight, dimensions with live volumetric calculator, optional item list with ISBN/title, fragile flag, packaging option, declared value, protection opt-in) → options (price and ETA comparison, own vs partner label, pick one) → pickup slot → review → pay (Razorpay) → confirmation with AWB and label download.
- **My shipments:** list with filters, detail page with timeline, cancel (if allowed), label/invoice download, raise issue.
- **Address book**, **Profile**, **Support tickets** pages.
- Pincode-based instant serviceability messages; clear error and retry states for payment.
**Accept:** Playwright test: register → book (own option) → pay (test mode) → see shipment in "My shipments" → public tracking shows BOOKED. Same with a partner (MOCK) option.

### U15 — Admin and operations dashboard
**Goal:** Control centre for staff.
**Build:** pages with permission-based access for:
- **Dashboard:** KPI cards (shipments today, pending pickups, in transit, exceptions, revenue), exception queue, flagged-events list, partner health.
- **Shipments:** search (AWB, phone, name), detail view with full timeline, legs, carrier, payment, financials, audit log; add manual event (own legs), add exception, reassign carrier, cancel.
- **Pickups and tasks:** board with assign / reassign / reschedule.
- **Agents:** list, create, shifts, city, online status.
- **Hubs and dispatch:** hub inventory, scan-in/out screen, manifest builder and PDF.
- **Carriers & Fulfillment Switch:** Global Routing Mode switcher (`OWN_ONLY`, `PARTNER_ONLY`, `AUTO_OPTIMIZED`), per-carrier enable/disable toggle switches, credentials form (write-only), test connection, status mapping editor, unmapped-status queue, rate cards.
- **Pricing and serviceability:** rule tables, config, city/pincode manager with activation checklist.
- **Finance:** payments, refunds, invoices, margin per shipment.
- **Support:** ticket and claim queues.
- **Users, roles, permissions, audit logs.**
**Accept:** A Hub Manager sees only hub/dispatch pages; City Manager data is scoped to their city; every admin action that changes status/price/assignment shows in the audit log.

### U16 — Agent app (PWA)
**Goal:** Reliable mobile workflow for pickups and deliveries.
**Build:**
- Installable PWA (manifest, icons, service worker), mobile-first UI.
- Login, shift toggle, today's task list (pickups first, then deliveries), task detail with call and "Open in Maps" buttons.
- Camera barcode scanner; scan-to-event flow tied to the current task.
- Pickup confirmation (condition notes, photo), delivery confirmation (OTP entry; photo/signature fallback), failed delivery with reason picker and note.
- **Offline queue** in IndexedDB: events stored with idempotency keys and synced through `POST /agent/sync` when online; visible "pending sync" indicator; conflict errors shown clearly.
- Task history.
**Accept:** With the network off, an agent can complete a pickup scan and confirmation; after reconnecting, the event syncs once and appears on the timeline; the app never shows another agent's tasks.

### U17 — Business accounts and bulk booking
**Goal:** Publishers, bookstores and institutions can ship in volume.
**Build:**
- Business onboarding (profile, GSTIN, approval by Account Manager), team users with sub-roles.
- Saved pickup addresses and multiple recipients.
- **Bulk upload:** downloadable CSV/XLSX template; upload → server-side validation of every row (pincode serviceability, weight, required fields) → preview with row-level errors → confirm → creates shipments, generates AWBs and labels in a single PDF, creates one payment (or credit entry).
- Manifest PDF for pickups, recurring pickup schedules, monthly shipment report and invoice downloads.
- Admin: contracts editor (`ruleJson` UI), credit limit management.
**Accept:** A 500-row CSV with 10 invalid rows shows exactly those errors, and confirming creates only valid shipments; contract pricing applies to the business account's quotes.

### U18 — Reports and KPIs
**Goal:** Measure performance from the first shipment.
**Build:** report endpoints and admin pages for: shipments booked / delivered, on-time delivery rate, pickup success rate, first-attempt delivery rate, damage/loss rate, cost / revenue / gross margin per shipment, partner performance (on-time, delays, failures), agent productivity, RTO rate, complaint resolution time. Date, city and carrier filters; CSV export.
**Accept:** Metrics match hand-calculated values on a seeded dataset; exports open correctly.

### U19 — Hardening, testing and deployment
**Goal:** Production-ready.
**Build:**
- Security pass per the build plan section 11: rate limits, helmet, CORS, input limits, signed upload URLs, webhook verification, secret handling, dependency audit.
- Test suites (section 8 below) at the required coverage.
- Performance: DB indexes verified with `EXPLAIN` on tracking and shipment queries; pagination everywhere; caching for serviceability and pricing config.
- Observability: Sentry (or equivalent), structured logs with request IDs, partner-sync dashboards.
- Backups and restore procedure documented. Production Dockerfiles for both folders, CI/CD deploy workflow, separate staging and production environments, migration run on deploy.
- Documentation: `README.md`, `docs/API.md` (from OpenAPI), `docs/DECISIONS.md`, operations SOP stubs (pickup, hub receiving, failed delivery, RTO, claims).
**Accept:** Full CI is green; staging deploy works from a clean checkout using only README steps; no secrets in the repository.

---

## 7. API Conventions (apply in every unit)

- Base path `/api`. JSON only. Versioning via path prefix `/api/v1` if needed later.
- Success: `{ data, meta? }`. Error: `{ statusCode, code, message, details? }`.
- Pagination: `?page=1&pageSize=20` → `meta: { page, pageSize, total }`.
- Dates in ISO 8601 UTC. Money as decimal strings with two decimals. Currency INR.
- Idempotency: mutating endpoints used by the agent app and payment/webhook flows accept an `Idempotency-Key` header and store results for repeat calls.
- All list endpoints are permission-scoped (customer sees own; city manager sees own city; etc.).
- Public endpoints (`/track/:awb`, `/serviceability/check`, `/auth/*`) are rate-limited.

---

## 8. Test Requirements

| Area | Required tests |
|---|---|
| Pricing | Weight rules, slabs, fees, tax, contract overrides |
| Tracking | Full transition matrix, partner skip rules, de-dup, terminal handling, flagged events, concurrency (two simultaneous events on one shipment) |
| Carrier layer | Router options (own-only, partner-only, hybrid), fallback, adapter contract tests run against every adapter |
| Webhooks | Signature failure, duplicates, unknown statuses, malformed payloads |
| Auth/RBAC | Every protected route checked with at least one allowed and one denied role |
| Agent flows | OTP rules, offline batch sync, ownership checks |
| Payments | Duplicate webhook, failed payment, partial refund, refund cap |
| Bulk upload | Valid, partially invalid and fully invalid files |
| End-to-end (Playwright) | Own-network shipment, partner (MOCK) shipment, hybrid shipment, failed delivery → reattempt → RTO, claim flow |

---

## 9. Final Acceptance Scenarios (the project is complete when all pass)

1. **Own-network shipment:** customer books a local shipment, pays, an agent picks it up, hub scans it, it is dispatched, destination agent delivers with OTP. Public tracking shows every step.
2. **Partner shipment:** customer books an intercity shipment using a partner option. Partner events (webhook and polled) appear on the same timeline under our AWB. Partner cost is stored separately from the customer price.
3. **Hybrid shipment:** `[OWN, PARTNER, OWN]` legs run to delivery with one continuous timeline.
4. **Failure paths:** pickup failed → rescheduled; delivery failed → reattempt → RTO → RTO delivered.
5. **Both modes coexist:** the same admin dashboard, shipment list, finance views and reports show own and partner shipments together, filterable by carrier type.
6. **Adding a new carrier** requires only a new adapter file plus mapping seed data.
7. **Security:** no role can access data outside its permissions; no secret or partner credential is exposed through any API or the frontend; tracking history cannot be edited or deleted.
8. **Setup from scratch:** a new developer can clone the repo, follow the README, and have everything running locally with seeded data.
