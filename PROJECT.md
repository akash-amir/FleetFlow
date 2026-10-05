# FleetFlow — Project Build Prompt

> Use this as a spec/prompt for an AI coding assistant (Claude Code, Cursor, etc.) or as your own build checklist. It captures the full scope, schema, business logic, and priorities for the FleetFlow MVP.

---

## 1. Project Summary

FleetFlow is a **logistics operations platform** that helps a delivery company manage a delivery's full lifecycle: from a customer order, to dispatcher assignment, to driver delivery, to proof of delivery, to invoicing and payment.

This is a **portfolio/job-switch project** built by a full-stack developer with 1 year of experience. The goal is not to build every possible feature — it's to build a **focused, well-architected MVP** that demonstrates senior-adjacent engineering thinking through a small number of "signature problems," done deeply rather than many features done shallowly.

---

## 2. Tech Stack

### Frontend
- **Framework:** Next.js (App Router)
- **Language:** TypeScript
- **Structure:** Feature-based — `features/<domain>/{components,services,types}`
- **Data access:** Services call the API; components render only, no business logic in components

### Backend
- **Framework:** NestJS
- **Language:** TypeScript
- **API:** REST, versioned at `/api/v1`
- **Real-time:** WebSocket gateway
- **Structure:** Module per domain — `modules/<domain>/{controller,service,module,dto}`
- **Auth:** JWT access token + rotating refresh token in an httpOnly cookie
- **Authorization:** Global `JwtAuthGuard` (secure by default, `@Public()` to opt out) + `PermissionsGuard`

### Data & Infrastructure
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Cache / real-time state:** Redis (only if/when needed for WebSocket scaling — not required for MVP)
- **File storage:** Cloudinary (NOT AWS S3) — delivery photos and signatures
- **Payments:** Stripe (Checkout Sessions created from the customer portal + idempotent webhooks)
- **Email:** Resend (invites and invoice notifications)
- **Maps:** Mapbox — explicitly OUT of MVP scope, future work only
- **Local dev:** Docker Compose (Postgres + Redis)
- **Deployment:** Vercel (web) + Railway (API, Postgres, Redis)

---

## 3. Roles

| Role | Type | Login? |
|---|---|---|
| Admin | Internal staff | Yes |
| Dispatcher | Internal staff | Yes |
| Driver | Internal staff | Yes |
| Customer | External client | **Yes** — via a `CustomerUser` account, invited by staff (see Section 7) |

Admin, Dispatcher, and Driver share **one `users` table** with a `role` enum column (same auth flow, different permissions). Customer login is a **separate model**, `CustomerUser` (many per `Customer`) — different data shape, different token type, and no self-registration: staff invite a customer contact by email, and only an accepted invite ever populates that account's password. See Section 5 for the schema and Section 7 for the portal security rules.

---

## 4. Business Flow

```
Dispatcher (or Admin) creates Customer + Order
        ↓
Dispatcher creates Shipment from Order
        ↓
Dispatcher assigns Driver
        ↓
Driver updates status (enforced state machine):
   ready_for_dispatch → picked_up → in_transit → delivered
        ↓ (dispatcher dashboard updates LIVE via WebSocket at each step)
Driver uploads Proof of Delivery (photo/signature via Cloudinary)
        ↓
Invoice auto-generated when shipment status = delivered
        ↓
Customer logs into the customer portal and opens the invoice
        ↓
Portal creates a Stripe Checkout Session for that invoice
        ↓
Customer pays on Stripe's hosted Checkout page
        ↓
Stripe webhook fires → invoice marked paid (idempotent — safe if fired twice)
```

---

## 5. Database Schema (Prisma-ready model)

```prisma
enum Role {
  admin
  dispatcher
  driver
}

enum ShipmentStatus {
  ready_for_dispatch
  picked_up
  in_transit
  delivered
  failed
  cancelled
}

enum InvoiceStatus {
  unpaid
  partially_paid
  paid
}

enum OrderStatus {
  pending
  processing
  cancelled
}

model User {
  id            Int      @id @default(autoincrement())
  fullName      String
  email         String   @unique
  passwordHash  String
  role          Role
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())

  driverProfile DriverProfile?
  shipments     Shipment[] @relation("DriverShipments")
  refreshTokens RefreshToken[]
  statusChanges ShipmentStatusHistory[]
  recordedPayments Payment[]
}

model Vehicle {
  id            Int      @id @default(autoincrement())
  plateNumber   String   @unique
  vehicleType   String?
  capacityKg    Decimal?
  isActive      Boolean  @default(true)

  driverProfile DriverProfile?
}

model DriverProfile {
  driverId            Int      @id
  driver              User     @relation(fields: [driverId], references: [id])
  vehicleId           Int?     @unique
  vehicle             Vehicle? @relation(fields: [vehicleId], references: [id])
  licenseNumber       String?
  availabilityStatus  String   @default("available") // available, on_delivery, offline
}

model Customer {
  id             Int      @id @default(autoincrement())
  companyName    String
  contactPerson  String?
  email          String   @unique
  phone          String?
  createdAt      DateTime @default(now())

  orders         Order[]
  users          CustomerUser[]
}

model CustomerUser {
  id            Int      @id @default(autoincrement())
  customerId    Int
  customer      Customer @relation(fields: [customerId], references: [id])
  fullName      String
  email         String   @unique
  passwordHash  String?  // null until the invite is accepted
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())

  refreshTokens CustomerRefreshToken[]
  tokens        CustomerUserToken[]
  createdOrders Order[]

  @@index([customerId])
}

model CustomerRefreshToken {
  id                Int          @id @default(autoincrement())
  customerUserId    Int
  customerUser      CustomerUser @relation(fields: [customerUserId], references: [id])
  tokenHash         String       @unique
  familyId          String
  expiresAt         DateTime
  revokedAt         DateTime?
  replacedByTokenId Int?
  createdAt         DateTime     @default(now())

  @@index([customerUserId])
  @@index([familyId])
}

enum CustomerUserTokenPurpose {
  invite
  password_reset
}

model CustomerUserToken {
  id             Int                      @id @default(autoincrement())
  customerUserId Int
  customerUser   CustomerUser             @relation(fields: [customerUserId], references: [id])
  tokenHash      String                   @unique
  purpose        CustomerUserTokenPurpose
  expiresAt      DateTime
  usedAt         DateTime?                // set once the token is actually redeemed
  invalidatedAt  DateTime?                // set when a later resend supersedes this one, even if never used
  createdAt      DateTime                 @default(now())

  @@index([customerUserId])
}

model Order {
  id                      Int           @id @default(autoincrement())
  customerId              Int
  customer                Customer      @relation(fields: [customerId], references: [id])
  pickupAddress           String
  deliveryAddress         String
  itemDescription         String?
  declaredAmount          Decimal?      @db.Decimal(10, 2)
  // Nullable: a portal order starts with no fee — staff set it via PATCH
  // once the order is accepted, and a shipment cannot be created until
  // it's set (409 otherwise).
  deliveryFee             Decimal?      @db.Decimal(10, 2)
  status                  OrderStatus   @default(pending)
  createdByCustomerUserId Int?
  createdByCustomerUser   CustomerUser? @relation(fields: [createdByCustomerUserId], references: [id])
  createdAt               DateTime      @default(now())

  shipment          Shipment?

  @@index([customerId])
  @@index([status])
}

model Shipment {
  id            Int             @id @default(autoincrement())
  orderId       Int             @unique
  order         Order           @relation(fields: [orderId], references: [id])
  driverId      Int?
  driver        User?           @relation("DriverShipments", fields: [driverId], references: [id])
  status        ShipmentStatus  @default(ready_for_dispatch)
  pickedUpAt    DateTime?
  deliveredAt   DateTime?
  createdAt     DateTime        @default(now())

  proofOfDelivery ProofOfDelivery?
  invoice         Invoice?
  statusHistory   ShipmentStatusHistory[]
}

model ShipmentStatusHistory {
  id           Int             @id @default(autoincrement())
  shipmentId   Int
  shipment     Shipment        @relation(fields: [shipmentId], references: [id])
  fromStatus   ShipmentStatus?
  toStatus     ShipmentStatus
  changedById  Int
  changedBy    User            @relation(fields: [changedById], references: [id])
  createdAt    DateTime        @default(now())

  @@index([shipmentId])
}

model ProofOfDelivery {
  id                Int      @id @default(autoincrement())
  shipmentId        Int      @unique
  shipment          Shipment @relation(fields: [shipmentId], references: [id])
  photoUrl          String?
  photoPublicId     String?
  signatureUrl      String?
  signaturePublicId String?
  notes             String?
  uploadedAt        DateTime @default(now())
}

model Invoice {
  id            Int           @id @default(autoincrement())
  shipmentId    Int           @unique
  shipment      Shipment      @relation(fields: [shipmentId], references: [id])
  // Backed by a Postgres SEQUENCE (invoice_number_seq — created by hand in
  // the migration, see its migration.sql) rather than app-level MAX+1 or a
  // manually tracked counter: nextval() hands out a value atomically under
  // concurrency, so two invoices created in the same instant can never
  // collide, skip, or duplicate a number, with zero locking in app code.
  invoiceNumber String        @unique @default(dbgenerated("'INV-' || lpad(nextval('invoice_number_seq')::text, 6, '0')"))
  amount        Decimal       @db.Decimal(10, 2)
  currency      String        @default("usd") // app always sets this explicitly from DEFAULT_CURRENCY at creation time; the DB default is just a safety net
  status        InvoiceStatus @default(unpaid)
  dueDate       DateTime
  paidAt        DateTime?
  sentAt        DateTime?
  createdAt     DateTime      @default(now())

  payments      Payment[]

  @@index([status])
}

model Payment {
  id                       Int      @id @default(autoincrement())
  invoiceId                Int
  invoice                  Invoice  @relation(fields: [invoiceId], references: [id])
  amountPaid               Decimal  @db.Decimal(10, 2)
  method                   String   // stripe, cash, bank_transfer
  reference                String?
  recordedById             Int?
  recordedBy               User?    @relation(fields: [recordedById], references: [id])
  stripePaymentIntentId    String?  @unique
  paidAt                   DateTime @default(now())

  @@index([invoiceId])
}

model ProcessedWebhookEvent {
  eventId       String   @id  // Stripe's event.id — used for idempotency
  processedAt   DateTime @default(now())
}

model RefreshToken {
  id                Int       @id @default(autoincrement())
  userId            Int
  user              User      @relation(fields: [userId], references: [id])
  tokenHash         String    @unique
  familyId          String
  expiresAt         DateTime
  revokedAt         DateTime?
  replacedByTokenId Int?
  createdAt         DateTime  @default(now())

  @@index([userId])
  @@index([familyId])
}
```

---

## 6. Permissions Matrix

| Action | Admin | Dispatcher | Driver |
|---|---|---|---|
| Create/manage staff accounts (Dispatcher, Driver) | ✅ Only Admin | ❌ | ❌ |
| Create Customer | ✅ | ✅ | ❌ |
| Create Order | ✅ | ✅ | ❌ |
| Create Shipment / assign Driver | ✅ (override) | ✅ (primary) | ❌ |
| Update shipment status | ❌ | ❌ | ✅ (own shipments only) |
| Upload Proof of Delivery | ❌ | ❌ | ✅ (own shipments only) |
| Mark invoice as paid (manual) | ✅ | ✅ | ❌ |
| View company-wide dashboards/reports | ✅ (full) | 🟡 (operational view only) | ❌ |

**Key principle:** Driver-scoped actions must check both the permission AND `shipment.driverId === currentUser.id` — role alone is not enough; ownership of the specific resource must also be validated.

This matrix governs the **staff** API only. Customer-portal access is governed separately by Section 7 — a customer is never a row in this matrix, and staff permissions never apply to portal routes.

---

## 7. Portal Security Rules

The customer portal is a **separate trust boundary** from the staff API, even though both are served by the same NestJS app. Customer auth (login, invites, password reset) and the portal data API (orders/shipments/invoices/dashboard) are both built.

- **Route namespace:** every portal endpoint lives under `/api/v1/portal/*`. Nothing under `/api/v1/portal` is reachable with a staff token, and nothing outside it is reachable with a customer token.
- **Separate secrets, not just a `type` claim:** staff tokens are signed with `JWT_ACCESS_SECRET`; customer tokens are signed with a distinct `JWT_CUSTOMER_ACCESS_SECRET`. `JwtAuthGuard` picks exactly one secret to verify against, based on whether the route is `@CustomerOnly()` — a token signed with the other secret fails signature verification outright, before any claim is even inspected. Both token payloads also carry an explicit `type` claim (`'staff'` or `'customer'`) as defense in depth on top of the secret separation, not instead of it.
- **Token payloads:** a staff access token is `{ sub: userId, email, role, type: 'staff' }`. A customer access token is `{ sub: customerUserId, customerId, type: 'customer' }` — never a `role`.
- **Cross-acceptance is forbidden:** a staff token on a portal route, or a customer token on a staff route, is rejected with 401 — proven by `jwt-auth.guard.spec.ts`'s token-separation tests and verified live.
- **`req.user` is discriminated:** `{ kind: 'staff', sub, email, role } | { kind: 'customer', sub, customerId }`. `@CurrentUser()` (existing staff modules) keeps its original `{ sub, email, role }` shape unchanged; the new `@CurrentCustomer()` decorator exposes the customer shape. `PermissionsGuard` explicitly rejects any `kind !== 'staff'` principal before it ever reaches a role-permission check — a customer can never pass `@Permissions(...)`.
- **Two cookie names, two paths — never shared:** staff refresh cookie is `refresh_token`, scoped to path `/api/v1/auth`. Customer refresh cookie is `portal_refresh_token`, scoped to path `/api/v1/portal/auth`. A browser holding both only ever sends each cookie to the routes it's scoped to.
- **Scoping comes from the token, never the request:** every portal query (list orders, view an invoice, etc.) is filtered by the `customerId` embedded in the verified access token (via `@CurrentCustomer()`). A portal endpoint must never read `customerId` from a query param, route param, or request body — `ValidationPipe`'s `forbidNonWhitelisted` rejects a `customerId` sent in a body with 400 before a handler ever runs. Every portal service method takes `customerId` as a required parameter and includes it directly in the Prisma `where` clause (or via the owning order's `customerId` for shipments/invoices); a resource belonging to another customer returns 404, never 403 — the scoping check and the existence check are the same query, so there's no code path that could leak "exists, but isn't yours." This is enforced in the service layer, not the controller, because the controller only proves *who's calling*; the service is what actually touches the data, so that's the one place a forgotten check can't be bypassed by a route added later.
- **Money is server-side truth:** invoice amounts shown in the portal and sent to Stripe Checkout always come from the `Invoice` row in the database, never from anything the client sends. The client can request "pay this invoice"; it can never state what the invoice costs.
- **Generic errors on guessable surfaces:** `accept-invite`, `login`, and `reset-password` all return the same message regardless of the specific failure reason (unknown email, wrong password, inactive account, expired/used/invalid token) — distinguishing them would let an attacker enumerate accounts or probe token state. `login` additionally always runs a real bcrypt compare (against a dummy hash when no real user/passwordHash exists) so response timing doesn't leak which failure occurred either.
- **Rate limited, narrowly:** `/portal/auth/{login,accept-invite,forgot-password,reset-password}` are limited to 5 requests/minute/IP via `@nestjs/throttler`, applied per-route — not globally. Nothing else in the API is throttled.

---

## 8. Signature Problems (build these deeply, not shallowly)

These 3 are the core technical depth of the project — prioritize getting these right over adding more features.

### 8.1 State Machine for Shipment Status
- Status transitions must be explicitly validated, not freely settable.
- Allowed transitions:
  - `ready_for_dispatch` → `picked_up`, `cancelled`
  - `picked_up` → `in_transit`, `failed`
  - `in_transit` → `delivered`, `failed`
  - `delivered` → (terminal)
  - `failed` → `ready_for_dispatch` (retry)
- Reject any transition not in the allowed list, at the service layer.

### 8.2 Idempotent Stripe Webhook Handling `[done]`
- Stripe can send the same event twice or out of order — handle both.
- Store every processed `event.id` in `ProcessedWebhookEvent`; skip if already processed.
- Wrap payment creation + invoice status update + event logging in a **single database transaction**.
- Invoice status (`unpaid` / `partially_paid` / `paid`) is **derived** by summing all `Payment.amountPaid` for that invoice and comparing to `Invoice.amount` — never stored as a manually-set flag (`computeInvoiceStatus`, shared with the manual-payment endpoint; the webhook never reimplements this logic).
- **The upfront `ProcessedWebhookEvent` lookup is a fast path, not the actual idempotency guarantee** — it runs outside any lock, so two near-simultaneous deliveries of the same `event.id` can both pass it before either commits. What actually makes this safe is `ProcessedWebhookEvent.eventId` being a primary key: every insert attempt (success path, "invoice not found" path, "unhandled event type" path) goes through one helper that swallows the resulting unique-constraint error instead of crashing. This exact race was caught by a test (`stripe-webhook.service.spec.ts`), not just reasoned about — an earlier version of the handler inserted `ProcessedWebhookEvent` inline in three different places without that guard and threw an unhandled `PrismaClientKnownRequestError` under concurrent delivery.
- Likewise, `Payment.stripePaymentIntentId`'s unique constraint (not just the event-id check) is what actually prevents a double-charge if two *different* event ids ever reference the same payment intent — caught the same way.
- The webhook is deliberately the **only** writer of a `method: 'stripe'` payment; `POST /portal/invoices/:id/checkout-session` never touches the `Payment` table itself, only creates the Checkout Session.
- Stripe redelivers unsigned/unverifiable requests forever if you 500 them — an invalid signature is the one case this handler responds `400` to (logged, nothing written); every other outcome (processed, already-processed, ignored event type, malformed session) is `200` so Stripe stops retrying.

### 8.3 Real-Time Shipment Status via WebSocket
- When a driver updates a shipment's status, dispatcher dashboards update live — no polling.
- Use rooms/channels so a dispatcher only receives updates relevant to their scope (not a global broadcast).
- Justify WebSocket over polling explicitly: infrequent updates per shipment, but many concurrent shipments/dispatchers — persistent connection avoids wasteful constant requests.
- Have a basic reconnect/fallback strategy in mind (even if not fully built for MVP).

---

## 9. MVP Scope

### ✅ In Scope
- Auth: JWT access token + rotating refresh token (httpOnly cookie), staff only
- Customers: CRUD (the `Customer` company record itself has no login — see "Customer portal" below for `CustomerUser` login)
- Orders: create, list, view
- Shipments: create from order, assign driver, enforced state machine
- Driver flow: view own shipments, update status, upload POD (Cloudinary)
- Invoice: auto-generated on `delivered` status
- Customer portal: customer login (`CustomerUser`, staff-invited — see Section 5), view own orders/invoices, pay via Stripe Checkout Session
- Payment: Stripe Checkout Sessions created from the customer portal + manual "mark as paid" for cash/bank transfer
- Webhooks: idempotent Stripe webhook handling
- Real-time: WebSocket live shipment status updates for dispatchers
- Frontend: Next.js — Admin/Dispatcher dashboard + simple Driver view

### ❌ Explicitly Out of Scope (Phase 2 / "future work")
- Mapbox / route optimization / live GPS tracking
- Redis (unless WebSocket scaling across multiple server instances becomes necessary)
- Optimistic/pessimistic concurrency locking on driver assignment
- Soft deletes / full audit log
- SMS/WhatsApp notifications

State clearly in any interview or README that these were **deliberately deferred to control scope**, not overlooked.

---

## 10. Suggested Build Order

1. NestJS + Prisma scaffolding `[done]`
2. Docker Compose setup (Postgres + Redis) `[done]` — verified: `docker compose up -d` reaches healthy on both containers, migrations + seed run cleanly against it, and the app boots and serves against it; see Section 12
3. Auth module: JWT + refresh token rotation, staff-only `[done]`
4. Customers + Orders modules (basic CRUD) `[done]`
5. Shipments module + state machine enforcement `[done]`
6. Driver flow + Cloudinary POD upload integration `[done]`
7. Invoice auto-generation logic on shipment delivered `[done]`
8. WebSocket gateway for live shipment status updates `[done]` — see Section 13 for the event contract
9. Customer auth: `CustomerUser` model + staff-invited login `[done]` — see Section 7 for the token-separation rules that came with it
10. Portal API: customer-facing endpoints under `/api/v1/portal/*`, per Section 7's security rules `[done]` — see below for the endpoint list and Section 13 for the customer realtime event
    - `GET/POST /portal/orders`, `GET /portal/orders/:id` (+ shipment summary and POD), `PATCH /portal/orders/:id/cancel`
    - `GET /portal/shipments`, `GET /portal/shipments/:id` (status, timestamps, order summary, POD, customer-safe timeline, driver first-name-only while picked_up/in_transit)
    - `GET /portal/invoices`, `GET /portal/invoices/:id` (amount/status/dueDate/amountPaid/balance/isOverdue + payments as `{amount, method, paidAt}`)
    - `GET /portal/dashboard` (active shipments, delivered this month, unpaid invoice count, total outstanding balance, overdue count)
11. Stripe Checkout Session generation (from the portal) + idempotent webhook handler `[done]` — `stripe` SDK pinned to API version `2026-09-30.endive` (`STRIPE_API_VERSION`, see `common/stripe/stripe-client.provider.ts`); `POST /portal/invoices/:id/checkout-session` creates a Checkout Session for the server-computed balance, `POST /api/v1/payments/webhook` is the only writer of Stripe payments; see Section 8.2 for the idempotency design and `scripts/stripe-webhook-smoke.md` for manual testing
12. Frontend: Next.js dashboards (Admin/Dispatcher) + Driver view `[todo]`
13. Deployment: Railway (API/DB/Redis) + Vercel (frontend) `[todo]`

---

## 11. Notes for the AI Assistant / Developer

- Prisma is the ORM of choice — do not hand-write raw SQL migrations except where Prisma cannot express something (e.g., complex aggregate reporting queries via `$queryRaw`).
- Keep NestJS modules structured as `modules/<domain>/{controller,service,module,dto}` — one module per domain (auth, users, customers, orders, shipments, invoices, payments, webhooks).
- Global `JwtAuthGuard` should secure all routes by default; use `@Public()` decorator to explicitly opt out (e.g., Stripe webhook endpoint, login endpoint).
- `PermissionsGuard` should check both role-level permission AND resource ownership where applicable (e.g., driver updating only their own shipment).
- Favor clear, defensible design decisions over adding more integrations — the goal is depth on the 3 signature problems (Section 8), not breadth of features.

---

## 12. Local Setup

Steps a fresh clone needs to get the API running locally, against Dockerized Postgres + Redis — no native Postgres install required:

1. `cp .env.example .env` (Windows: `copy .env.example .env`). The defaults work as-is for local dev; only Cloudinary/Stripe need real credentials if you're exercising those integrations.
2. `docker compose up -d` — starts Postgres (host port **5433** — deliberately not 5432, so this never collides with a native Postgres install on the same machine) and Redis (6379). Wait for both to report healthy: `docker compose ps`.
3. `npx prisma migrate deploy` — applies all migrations to the Dockerized database.
4. `npx prisma db seed` — creates the bootstrap admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
5. `npm run start:dev` — API is up at `http://localhost:3000/api/v1`.

**Verified**: `docker compose up -d` reached `healthy` on both containers; `prisma migrate deploy` applied all 7 migrations cleanly to a brand-new database; `prisma db seed` created the admin; the full `vitest` suite (207 tests) passed identically with `DATABASE_URL` pointed at the Dockerized Postgres, confirming no test secretly depends on a native database; the compiled app booted against the Dockerized Postgres and served a real login. None of this touched the machine's own `.env` or its native Postgres install — verification used a one-off `DATABASE_URL` override on each command, not a change to the checked-in environment.

---

## 13. Realtime Contract

### Connecting
- Plain Socket.IO connection to the API's own origin — no separate path or namespace; `@nestjs/platform-socket.io` mounts on the same HTTP server the REST API uses.
- Auth travels in the handshake, not a header or cookie: `io(url, { auth: { token: accessToken } })`, using the same access token `POST /auth/login` returns.
- A missing, invalid, or expired token, or a token for a deactivated user, gets the socket disconnected immediately — before it ever joins a room.
- CORS origin comes from `FRONTEND_ORIGIN` (default `http://localhost:3001`).
- **Both staff and customer tokens.** A socket's handshake token is tried against the staff secret first, then the customer secret — there's no per-connection decorator (unlike HTTP) to say which one to expect up front, so both real secrets are tried in sequence. A token is only ever valid under the secret it was actually signed with, so this is no weaker than picking the right one in advance. A customer token must carry `type: 'customer'`, and the `CustomerUser` it names must still be active.

### Rooms — server-decided, never client-requested
- `ops` — every admin and dispatcher.
- `driver:{userId}` — that one driver, and no one else.
- `customer:{customerId}` — every customer user belonging to that customer.
- There is no message handler for a client to request a room. Any message a client sends to the gateway is silently dropped.

### Events (server → client only)

| Event | Sent to | Payload |
|---|---|---|
| `shipment:updated` | `ops`, plus `driver:{driverId}` if the shipment has a driver | `{ shipmentId, fromStatus, toStatus, driverId, changedAt }` |
| `shipment:updated` | `customer:{customerId}` (the order's owning customer) | `{ shipmentId, orderId, toStatus, changedAt }` — reduced: no driver info, no actor info |
| `shipment:assigned` | `ops`, plus `driver:{driverId}` | `{ shipmentId, driverId, assignedById }` |
| `invoice:updated` | `ops`, plus `customer:{customerId}` (the invoice's owning customer, resolved via its shipment's order) | `{ invoiceId, status }` |
| `disconnect_reason` | the one socket about to be disconnected | `{ reason: 'token_expired' }` |

`fromStatus`/`toStatus` are `ShipmentStatus` values (`fromStatus` is `null` on a shipment's very first history row). `changedAt` is an ISO timestamp string. Staff/driver payloads carry ids and statuses only — no denormalized customer/order details. The customer payload is reduced further still: no driver identity ever reaches a customer socket, at any shipment status.

### No replay after reconnect
Missed events are **not** replayed. If a client disconnects for any reason — network drop, token expiry, a server restart — and reconnects, it only receives events from that point forward. **Clients must refetch current state via the REST API** (`GET /shipments`, `GET /shipments/:id`) after every reconnect to resync whatever happened while they were offline.

### Local Stripe testing
See `scripts/stripe-webhook-smoke.md` for the `stripe listen` / `stripe trigger` commands and what to expect in the terminal and in Prisma Studio. A full end-to-end Checkout flow needs a browser (to complete the hosted payment page); the smoke-test doc covers the webhook side on its own.
