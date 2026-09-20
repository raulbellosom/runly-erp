# `custom.dispatch` — Despachos, báscula y control de salida — Design Spec

- Status: Approved; Phase 1 implemented
- Date: 2026-08-31
- Proposed module: `custom.dispatch`
- Product name: Despachos y báscula
- Sources:
  - `D:/RacoonDevs/ore/docs/v2/01_AGENT_PROMPT_PLAN.md`
  - `D:/RacoonDevs/ore/docs/v2/04_PROJECT_SPECIFICATIONS_SRS_V3_1.md`
  - Operational clarifications provided by the product owner on 2026-08-31
- Phase 1 plan: `docs/superpowers/plans/2026-08-31-custom-dispatch-phase1.md`

## 1. Purpose

Create a reusable Runly ERP module for issuing internal material vouchers, recording
scale readings, validating QR scans at an exit gate, obtaining remote approval from
the scale operator, and preserving a complete operational trail.

The first deployment is a mining operation, but the domain vocabulary and data model
must also work for quarries, aggregate yards, recycling plants, grain terminals, and
other businesses that dispatch bulk material in trucks.

This is an RME3 feature module, not a platform-core module. Mining-specific behavior
must remain inside the module. Generic Runly platform changes will only be proposed
later if Website, external email delivery, hardware adapters, or public module actions
require them.

## 2. Product decisions

1. The module key is `custom.dispatch` for the first customer and pilot.
2. The product name shown to users is **Despachos y báscula**.
3. The module uses two commercial voucher types:
   - `SCALE`: contract/customer voucher, normally measured by weight.
   - `VOLUME`: walk-in/on-site purchase, sold primarily in cubic metres.
4. Every physical exit requires a QR scan and approval by the scale operator or a
   superior.
5. The exit guard scans but never approves or rejects.
6. The scale operator communicates the decision to the guard outside Runly, for
   example by radio or telephone.
7. Approval changes the voucher to `USED` and authorizes the physical exit.
8. Rejection applies to one exit attempt only. The voucher remains reusable after the
   truck corrects the load, and the same QR is scanned again.
9. A `VOLUME` voucher stores m³ as its primary commercial quantity and may also store
   an auxiliary gross exit weight. Without a tare, that weight is not the net material
   weight.
10. `SCALE` vouchers normally require tare and gross readings. Missing readings are
    allowed only through an explicit, auditable exception.
11. Customer/buyer email is optional and is captured for future communications.
12. Website requests, direct payment processing, automatic customer emails, and
    municipal reports are outside the initial scope.

## 3. Goals

1. Replace handwritten internal vouchers with legible, traceable vouchers containing
   an atomic folio and QR.
2. Support contract customers and walk-in buyers without forcing both through the same
   capture form.
3. Record tare, gross, net, and auxiliary exit weight without conflating commercial
   quantity and scale observations.
4. Notify assigned scale operators in real time when a voucher is scanned at the gate.
5. Preserve every scan, approval, rejection, retry, correction, exception, print, and
   cancellation.
6. Produce a branded printable voucher with three identified copies.
7. Enforce company isolation, station permissions, idempotency, and transactional state
   changes.
8. Deliver focused, touch-friendly screens using `@runly/ui` and RME3 `CUSTOM` views.

## 4. Non-goals for the first release

1. Public Website purchase or request flow.
2. Stripe or any other payment processor.
3. Accounting entries, invoices, receivables, or proof that a payment settled.
4. Municipal submission/export workflow.
5. Automatic reading from RS-232, USB, or network scales.
6. Offline gate approval.
7. Automatic control of a physical gate/barrier.
8. Dispatch planning, routes, fleet maintenance, or driver employment records.
9. Inventory depletion or geological extraction balances.
10. Replacing the external voucher issued by a contract customer.

## 5. Actors and authorization model

Business actors are expressed through granular Runly permissions. The module does not
hardcode Runly roles; administrators compose roles from these permissions.

### 5.1 Suggested operational roles

| Role | Responsibility |
|---|---|
| Ventanilla | Creates `VOLUME` vouchers and prints copies |
| Operadora de báscula | Creates `SCALE` vouchers, captures readings, receives gate alerts, approves/rejects exits |
| Guardia de pluma | Scans QR and waits for an external instruction |
| Supervisor | Corrects vouchers, authorizes weighing exceptions, approves/rejects exits |
| Administrador | Manages catalogs, users, stations, series and operational reports |
| Root/platform admin | Full platform audit and configuration through existing Runly authority |

The loader/crane operator has no system account. The loader receives and retains the
physical loader copy during the shift.

### 5.2 Permission catalog

| Permission | Purpose |
|---|---|
| `dispatch.access` | Access the module |
| `dispatch.dashboard.read` | View operational dashboard |
| `dispatch.ticket.read` | Search and view vouchers |
| `dispatch.ticket.create_volume` | Create walk-in/volume vouchers |
| `dispatch.ticket.create_scale` | Create contract/scale vouchers |
| `dispatch.ticket.update` | Correct editable voucher data |
| `dispatch.ticket.cancel` | Cancel an unused voucher |
| `dispatch.ticket.print` | Generate or reprint voucher copies |
| `dispatch.weighing.capture` | Capture normal scale readings |
| `dispatch.weighing.override` | Authorize missing-reading exceptions and corrections |
| `dispatch.gate.scan` | Register an exit-gate QR scan |
| `dispatch.exit.review` | View the pending exit queue |
| `dispatch.exit.decide` | Approve or reject an exit attempt |
| `dispatch.catalog.manage` | Manage sites, stations, materials and series |
| `dispatch.export` | Export operational data to Excel |

## 6. Physical and system flow

### 6.1 Contract customer — `SCALE`

```text
Truck arrives with external customer voucher
  -> scale operator creates internal SCALE voucher
  -> customer/material/plate/external reference are snapshotted
  -> tare is captured, normally
  -> three copies are printed
  -> truck is loaded; no system event is required from the loader
  -> gross is captured on return to the scale, normally
  -> net = gross - tare
  -> voucher becomes READY_FOR_EXIT
  -> guard scans the same paper QR at the gate
  -> exit attempt becomes PENDING_APPROVAL
  -> assigned scale operators receive an in-app real-time alert
  -> scale operator visually verifies the truck
  -> approve: ticket becomes USED
  -> reject: ticket becomes CORRECTION_REQUIRED and may be scanned again
```

If a normal reading cannot be captured, a user with
`dispatch.weighing.override` records the missing-reading exception and reason. The
exception is not represented as a fake zero weight.

### 6.2 Walk-in/on-site purchase — `VOLUME`

```text
Truck driver requests material at the sales window
  -> operator creates VOLUME voucher
  -> material, m³, plate, driver, payment method/reference are captured
  -> three copies are printed
  -> truck is loaded
  -> an auxiliary gross exit weight is captured when the truck uses the scale
  -> voucher becomes READY_FOR_EXIT
  -> guard scans QR
  -> scale operator visually approves or rejects
  -> approve: ticket becomes USED
  -> reject: correct load and retry with the same QR
```

The auxiliary gross weight never replaces `sold_volume_m3`. If no tare exists, the UI
must label it **Peso bruto observado**, never **Peso del material**.

### 6.3 Gate behavior

The scan endpoint validates the QR and records an attempt. The guard-facing integration
does not reveal customer, material, quantity, or approval details. It only needs to
confirm that the scan was accepted for processing or that the QR was structurally
invalid.

The business decision remains in Runly. The scale operator communicates the decision
to the guard by an external channel. Optional fields record how and when the guard was
notified, but the MVP does not require the guard to acknowledge the message in Runly.

If the same QR is scanned again while an attempt is pending, the service returns the
existing pending attempt instead of creating a duplicate alert.

## 7. State model

### 7.1 Voucher status

| Status | Meaning |
|---|---|
| `CREATED` | Folio and QR issued; operational data may still be incomplete |
| `READY_FOR_EXIT` | Required data is complete or an authorized exception exists |
| `PENDING_APPROVAL` | A valid gate scan is awaiting the scale operator's decision |
| `CORRECTION_REQUIRED` | Latest attempt was rejected; voucher remains active |
| `USED` | Exit approved; terminal state |
| `CANCELLED` | Cancelled before use; terminal state |
| `EXPIRED` | Expired before use; terminal state |

The ticket status is deliberately small. Tare/gross capture is represented by immutable
weighing rows and domain events rather than a large collection of transient statuses.

### 7.2 Exit-attempt status

| Status | Meaning |
|---|---|
| `PENDING_APPROVAL` | Scan registered; waiting for an authorized reviewer |
| `APPROVED` | Reviewer authorized the exit |
| `REJECTED` | Reviewer found a problem; retry is allowed |
| `SUPERSEDED` | Defensive state for a duplicate/obsolete pending attempt |

There is no automatic rejection timeout in the MVP. A pending attempt remains pending
until an authorized user decides it. Cancellation of the voucher supersedes any open
attempt.

### 7.3 Allowed transitions

```text
CREATED -> READY_FOR_EXIT
READY_FOR_EXIT -> PENDING_APPROVAL
CORRECTION_REQUIRED -> PENDING_APPROVAL
PENDING_APPROVAL -> USED                  (approved attempt)
PENDING_APPROVAL -> CORRECTION_REQUIRED   (rejected attempt)
CREATED | READY_FOR_EXIT | CORRECTION_REQUIRED -> CANCELLED
CREATED | READY_FOR_EXIT | CORRECTION_REQUIRED -> EXPIRED
```

`USED`, `CANCELLED`, and `EXPIRED` are terminal. No endpoint may reopen them.

## 8. Module identity and dependencies

Proposed manifest identity:

```js
{
  key: 'custom.dispatch',
  name: 'Despachos y báscula',
  version: '0.1.0',
  kind: 'FEATURE',
  icon: 'Scale',
  color: '#D97706',
  pwa: {
    shortName: 'Despachos',
    startPath: '/operacion',
  },
  dependencies: [{ key: 'runly.core' }]
}
```

Core integrations used when available:

- `runly.identity`: users, memberships and RBAC.
- `runly.company`: branding and company identity.
- `runly.contacts`: optional customer reference; snapshots remain authoritative.
- `runly.catalog`: optional product reference for material profiles.
- `runly.files`: voucher, payment and ejido attachments.
- `runly.activity`: deferred bridge for global activity. The MVP renders its own
  `dispatch_ticket_event` timeline because the current RME3 `moduleContext` does not
  expose activity publishing.
- `runly.notifications`: real-time alerts to assigned scale operators.

The module stores snapshots of external names/codes on each voucher. Historical
vouchers must not change when a catalog product or contact is renamed.

## 9. Proposed module layout

```text
modules/custom/custom.dispatch/
  module.manifest.js
  README.md
  models/
    site.model.js
    station.model.js
    station-assignment.model.js
    material-profile.model.js
    folio-series.model.js
    ticket.model.js
    weighing.model.js
    exit-attempt.model.js
    document-reference.model.js
    ticket-event.model.js
  validators/
    index.js
    ticket.validators.js
    weighing.validators.js
    exit.validators.js
    catalog.validators.js
  api/
    index.js
    service-helpers.js
    ticket-service.js
    ticket-routes.js
    weighing-service.js
    weighing-routes.js
    exit-service.js
    exit-routes.js
    catalog-service.js
    catalog-routes.js
    export-service.js
    export-routes.js
    voucher-pdf.js
  views/
    operation.custom.js
    volume-ticket.custom.js
    scale-ticket.custom.js
    scale-exit.custom.js
    exit-queue.custom.js
    ticket-detail.custom.js
    tickets.table.js
    catalogs.custom.js
  components/
    index.js
    DispatchDashboard.jsx
    VolumeTicketForm.jsx
    ScaleTicketForm.jsx
    ScaleExitCapture.jsx
    ExitApprovalQueue.jsx
    TicketDetail.jsx
    DispatchCatalogs.jsx
    TicketStatusBadge.jsx
    MeasurementSummary.jsx
  tests/
    ticket-service.test.js
    weighing-service.test.js
    exit-service.test.js
    tenant-isolation.test.js
    concurrency.test.js
    permissions.test.js
```

All API business functions live inside their `createXxxService({ prisma, ... })`
factory closure. Module tables are accessed only through `$queryRaw` tagged templates
or parameterized `$queryRawUnsafe`. UUIDs are generated by PostgreSQL.

## 10. Data model

All tables are company-scoped. Every mutable catalog entity uses `enabled`; operational
history is never hard-deleted. All timestamps are UTC and rendered in the site's
configured timezone.

### 10.1 `dispatch_site`

Represents a mine, quarry, yard, or loading facility.

| Field | Type | Notes |
|---|---|---|
| `code` | text | Unique per company |
| `name` | text | User-facing name |
| `timezone` | text | Defaults from company configuration |
| `address_text` | text? | Optional operational address |
| `enabled` | boolean | Soft-delete flag |

Indexes: unique `(company_id, code)`; `(company_id, enabled)`.

### 10.2 `dispatch_station`

| Field | Type | Notes |
|---|---|---|
| `site_id` | relation | Owning site |
| `code` | text | Unique within site |
| `name` | text | Example: Báscula principal |
| `station_type` | select | `SALES`, `SCALE`, `GATE` |
| `location_note` | text? | Physical reference |
| `enabled` | boolean | Soft-delete flag |

Indexes: unique `(company_id, site_id, code)`;
`(company_id, site_id, station_type, enabled)`.

### 10.3 `dispatch_station_assignment`

Routes scan alerts to the correct users without hardcoding role names.

| Field | Type | Notes |
|---|---|---|
| `station_id` | relation | Assigned station |
| `user_id` | relation/UUID | Runly user profile id |
| `assignment_type` | select | `OPERATOR`, `SUPERVISOR`, `GUARD` |
| `receives_exit_alerts` | boolean | Normally true for scale operators |
| `enabled` | boolean | Soft-delete flag |

Unique `(company_id, station_id, user_id, assignment_type)`.

### 10.4 `dispatch_material_profile`

Module-owned operational configuration for a material.

| Field | Type | Notes |
|---|---|---|
| `site_id` | relation | Site where material is dispatched |
| `catalog_product_id` | UUID? | Optional link to `runly.catalog` |
| `code` | text | Stable local code |
| `name` | text | Operational name |
| `allowed_modes` | multiselect | `M3`, `TONS` |
| `density_kg_m3` | decimal? | Informational until conversion is explicitly enabled |
| `enabled` | boolean | Soft-delete flag |

Indexes: unique `(company_id, site_id, code)`; `(company_id, site_id, enabled)`.

No density conversion is applied automatically in the MVP.

### 10.5 `dispatch_folio_series`

| Field | Type | Notes |
|---|---|---|
| `site_id` | relation | Series scope |
| `voucher_type` | select | `SCALE`, `VOLUME` |
| `prefix` | text | Example: `VB`, `VV` |
| `next_number` | number | Next atomic integer |
| `padding` | number | Default 6 |
| `enabled` | boolean | Soft-delete flag |

Unique `(company_id, site_id, voucher_type)` and unique
`(company_id, site_id, prefix)`.

Folio assignment runs in the same database transaction as ticket insertion:

```sql
UPDATE dispatch_folio_series
SET next_number = next_number + 1, updated_at = NOW()
WHERE id = $1 AND company_id = $2
RETURNING prefix, next_number - 1 AS assigned_number, padding;
```

The formatted folio is stored on the ticket with a unique
`(company_id, site_id, folio)` index. Gaps are acceptable after a rolled-back or
cancelled business operation; duplicates are not.

### 10.6 `dispatch_ticket`

The authoritative internal voucher.

#### Identity and scope

| Field | Type | Notes |
|---|---|---|
| `site_id` | relation | Required |
| `origin_station_id` | relation | Sales or scale station |
| `voucher_type` | select | `SCALE`, `VOLUME` |
| `folio` | text | Atomically assigned internal folio |
| `status` | select | Voucher state from section 7 |
| `expires_at` | datetime? | Optional expiry |

#### Customer and vehicle snapshot

| Field | Type | Notes |
|---|---|---|
| `sold_to_type` | select | `CUSTOMER`, `WALK_IN` |
| `customer_contact_id` | UUID? | Optional `runly.contacts` reference |
| `customer_name` | text? | Required snapshot for contract customer |
| `buyer_email` | email? | Optional |
| `external_voucher_reference` | text? | Customer's voucher/receipt folio |
| `vehicle_plate` | text | Normalized snapshot |
| `driver_name` | text? | Free-text snapshot |

#### Material and commercial quantity snapshot

| Field | Type | Notes |
|---|---|---|
| `material_profile_id` | relation | Operational material profile |
| `material_code` | text | Immutable snapshot |
| `material_name` | text | Immutable snapshot |
| `measurement_mode` | select | `TONS` for SCALE, `M3` for VOLUME |
| `requested_quantity` | decimal? | Customer-requested quantity if present |
| `sold_volume_m3` | decimal? | Required for VOLUME |

#### Payment declaration

| Field | Type | Notes |
|---|---|---|
| `payment_method` | select? | `CASH`, `DEPOSIT`, `OTHER` |
| `payment_reference` | text? | Optional unless local policy requires it |

These fields record what was declared at the window. They do not constitute a
financial settlement or accounting entry.

#### Weighing exception and QR

| Field | Type | Notes |
|---|---|---|
| `weighing_exception` | boolean | Default false |
| `weighing_exception_reason` | textarea? | Required when true |
| `weighing_exception_by` | UUID? | User who authorized it |
| `weighing_exception_at` | datetime? | Authorization time |
| `qr_version` | number | Starts at 1 |
| `qr_token_hash` | text | Hash only; raw token is never stored |

#### Lifecycle attribution

| Field | Type | Notes |
|---|---|---|
| `created_by` | UUID | Runly user profile id |
| `used_at` | datetime? | Final approval time |
| `cancelled_at` | datetime? | Cancellation time |
| `cancelled_by` | UUID? | Cancelling user |
| `cancel_reason` | textarea? | Required on cancellation |

Indexes:

- unique `(company_id, site_id, folio)`
- unique `(company_id, qr_token_hash)`
- `(company_id, site_id, status, created_at)`
- `(company_id, vehicle_plate, created_at)`
- `(company_id, external_voucher_reference)`
- `(company_id, material_profile_id, created_at)`

### 10.7 `dispatch_weighing`

Append-oriented scale readings. Corrections add a new row and supersede the old row;
they never overwrite a historical value.

| Field | Type | Notes |
|---|---|---|
| `ticket_id` | relation | Owning voucher |
| `station_id` | relation | Capturing scale station |
| `reading_type` | select | `TARE`, `GROSS`, `AUXILIARY_EXIT_GROSS` |
| `weight_kg` | decimal | Canonical storage unit, must be positive |
| `source` | select | `MANUAL`, `DEVICE` |
| `captured_by` | UUID | Runly user profile id |
| `captured_at` | datetime | Server time |
| `supersedes_id` | relation? | Prior reading corrected by this row |
| `correction_reason` | textarea? | Required when superseding |
| `device_reference` | text? | Future hardware adapter identifier |

Indexes: `(company_id, ticket_id, reading_type, captured_at)`;
`(company_id, station_id, captured_at)`.

The current effective reading is the latest non-superseded row of each required type.
For `SCALE`, the server calculates `net_weight_kg = gross - tare` and rejects
`gross <= tare`. Net is returned as a derived value and may be snapshotted in event
metadata; it is not manually editable.

### 10.8 `dispatch_exit_attempt`

| Field | Type | Notes |
|---|---|---|
| `ticket_id` | relation | Owning voucher |
| `gate_station_id` | relation | Gate where scan occurred |
| `attempt_number` | number | 1-based per voucher |
| `status` | select | Attempt state from section 7 |
| `scanned_by` | UUID | Guard/user responsible for scan |
| `scanned_at` | datetime | Server time |
| `scan_idempotency_key` | text | Prevents duplicate device submissions |
| `decided_by` | UUID? | Scale operator/supervisor |
| `decided_at` | datetime? | Decision time |
| `rejection_reason` | textarea? | Required when rejected |
| `communication_method` | select? | `RADIO`, `PHONE`, `IN_PERSON`, `OTHER` |
| `guard_notified_at` | datetime? | Optional operational record |
| `notes` | textarea? | Optional |

Indexes:

- unique `(company_id, ticket_id, attempt_number)`
- unique `(company_id, scan_idempotency_key)`
- `(company_id, status, scanned_at)`
- `(company_id, gate_station_id, scanned_at)`

Only one pending attempt may exist per ticket. If Runly ORM cannot express the partial
unique constraint, the service enforces it with a row lock and transactional lookup.

### 10.9 `dispatch_document_reference`

Tracks external documents and their custody; binary files use `runly.files`.

| Field | Type | Notes |
|---|---|---|
| `ticket_id` | relation | Owning voucher |
| `document_type` | select | `CUSTOMER_VOUCHER`, `EJIDO_VOUCHER`, `PAYMENT_EVIDENCE`, `OTHER` |
| `external_reference` | text? | External folio |
| `file_asset_id` | file/UUID? | Optional Runly file asset |
| `received` | boolean | Whether the physical document was received |
| `received_by` | UUID? | Runly user profile id |
| `received_at` | datetime? | Receipt time |
| `custody_note` | text? | Who retained which physical copy |

Index `(company_id, ticket_id, document_type)`.

### 10.10 `dispatch_ticket_event`

Append-only domain history complementing the core AuditLog.

| Field | Type | Notes |
|---|---|---|
| `ticket_id` | relation | Owning voucher |
| `event_type` | text/select | Stable event name |
| `actor_id` | UUID? | Null only for scheduled/system events |
| `station_id` | relation? | Physical source when applicable |
| `attempt_id` | relation? | Related exit attempt |
| `metadata` | json | Event-specific snapshot |
| `occurred_at` | datetime | Server time |

Initial event taxonomy:

```text
TICKET_CREATED
FOLIO_ASSIGNED
TARE_RECORDED
GROSS_RECORDED
AUXILIARY_WEIGHT_RECORDED
WEIGHING_CORRECTED
WEIGHING_EXCEPTION_AUTHORIZED
READY_FOR_EXIT
VOUCHER_PRINTED
VOUCHER_REPRINTED
QR_SCANNED_EXIT_GATE
EXIT_APPROVED
EXIT_REJECTED
GUARD_NOTIFICATION_RECORDED
DOCUMENT_RECEIVED
TICKET_CANCELLED
TICKET_EXPIRED
```

## 11. Transaction and concurrency rules

1. Ticket creation, series increment, folio assignment, QR hash insertion, ticket
   event, and AuditLog entry are one transaction.
2. QR scanning locks the ticket row before validating state and creating/reusing the
   pending attempt.
3. Approval/rejection locks both ticket and attempt rows and verifies that the attempt
   is still pending.
4. Two simultaneous approvals produce one state transition; the second response is
   idempotent and returns the already-decided attempt.
5. No service accepts `company_id`, `created_by`, `decided_by`, or status directly from
   the client. They are resolved from the authenticated context and transition logic.
6. All cross-entity lookups include `company_id`, including site, station, material,
   assignment, ticket, attempt, and document lookups.
7. `$queryRawUnsafe` is allowed only for dynamic clauses with positional placeholders;
   table and column names are never taken from request data.
8. AuditLog is written for every mutation. The domain event is written for every
   operational milestone.

## 12. QR contract

The printed QR contains an opaque versioned token, for example:

```text
RUNLY-DISPATCH:1:<random-token>
```

It does not contain customer, material, plate, quantity, weight, status, company id,
or database ids.

Server behavior:

1. Generate a cryptographically random token during ticket creation.
2. Store only a SHA-256 hash.
3. Resolve the ticket by company/site scope and token hash.
4. Reject `USED`, `CANCELLED`, `EXPIRED`, malformed, or unknown tokens.
5. Reject `CREATED` tickets that are not ready for exit.
6. Accept `READY_FOR_EXIT` and `CORRECTION_REQUIRED`.
7. Reuse the existing pending attempt when the same ticket is scanned again before a
   decision.
8. Create a new numbered attempt after a rejection.

QR rotation is permitted only before `USED`. A rotation invalidates the previous token
and records an event.

## 13. API contract

All initial routes are authenticated and mounted by the RME3 route loader.

### 13.1 Dashboard and tickets

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/dispatch/dashboard` | `dispatch.dashboard.read` | Counts, pending exits, recent vouchers |
| GET | `/dispatch/tickets` | `dispatch.ticket.read` | Paginated/filterable list |
| POST | `/dispatch/tickets/volume` | `dispatch.ticket.create_volume` | Create VOLUME ticket |
| POST | `/dispatch/tickets/scale` | `dispatch.ticket.create_scale` | Create SCALE ticket |
| GET | `/dispatch/tickets/:id` | `dispatch.ticket.read` | Full detail/projection |
| PATCH | `/dispatch/tickets/:id` | `dispatch.ticket.update` | Correct allowed pre-use fields |
| POST | `/dispatch/tickets/:id/cancel` | `dispatch.ticket.cancel` | Cancel with reason |
| POST | `/dispatch/tickets/:id/weighing-exception` | `dispatch.weighing.override` | Authorize missing readings |
| GET | `/dispatch/tickets/:id/pdf` | `dispatch.ticket.print` | Branded three-copy PDF |
| POST | `/dispatch/tickets/:id/print-event` | `dispatch.ticket.print` | Record physical print/reprint |

### 13.2 Weighings

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/dispatch/tickets/:id/weighings/tare` | `dispatch.weighing.capture` | Capture tare |
| POST | `/dispatch/tickets/:id/weighings/gross` | `dispatch.weighing.capture` | Capture gross and derive net |
| POST | `/dispatch/tickets/:id/weighings/auxiliary-exit` | `dispatch.weighing.capture` | Capture VOLUME gross observation |
| POST | `/dispatch/weighings/:id/correct` | `dispatch.weighing.override` | Append corrected reading |

### 13.3 Gate and approval

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/dispatch/gate/scan` | `dispatch.gate.scan` | Validate QR and create/reuse attempt |
| GET | `/dispatch/exits/pending` | `dispatch.exit.review` | Scale operator queue |
| GET | `/dispatch/exits/:id` | `dispatch.exit.review` | Review projection |
| POST | `/dispatch/exits/:id/approve` | `dispatch.exit.decide` | Approve and atomically mark ticket USED |
| POST | `/dispatch/exits/:id/reject` | `dispatch.exit.decide` | Reject attempt with reason |
| POST | `/dispatch/exits/:id/guard-notified` | `dispatch.exit.decide` | Optional communication record |

### 13.4 Catalogs and export

CRUD endpoints cover sites, stations, assignments, material profiles, and folio series,
guarded by `dispatch.catalog.manage`. Excel export is guarded by `dispatch.export` and
reads the complete filtered dataset, not only the current page.

## 14. Notifications and real-time behavior

When `QR_SCANNED_EXIT_GATE` commits:

1. Resolve enabled station assignments with `receives_exit_alerts = true` for the
   scale station/site.
2. From the authenticated route context, publish one
   `dispatch.exit.approval_required` notification per recipient through
   `moduleContext.notifications.publishFromContext(c, payload)`.
3. Use a dedupe key based on the attempt id.
4. Link directly to the pending exit review.
5. Mark priority `critical` or `high` and channel `in_app`; web push can follow user
   preferences.

Notification failure must not roll back a valid scan. The scan transaction commits
first; notification delivery is attempted immediately afterward and failures are
logged/retryable.

The approval queue also polls/refetches defensively so operation does not depend solely
on Realtime delivery.

## 15. Voucher PDF and physical copies

The voucher PDF is generated on the API using the shared Runly branding service. Raw
browser print is not the document source of truth.

The PDF contains three clearly labelled copies:

1. **COPIA BÁSCULA — ARCHIVO**
2. **COPIA CHOFER**
3. **COPIA CARGADOR**

Each copy contains:

- Company/site branding.
- Internal folio and voucher type.
- QR.
- Material and primary commercial quantity.
- Customer/walk-in identity as applicable.
- Plate and driver.
- External voucher reference when applicable.
- Payment method/reference for VOLUME when applicable.
- Tare/gross/net for SCALE when already available.
- Auxiliary gross weight for VOLUME when available, explicitly labelled.
- Creation timestamp and operator.
- Expiration, if configured.

Default paper size is `LETTER` for the pilot, but is kept configurable before final
print QA. Every generation/reprint records an event with copy count and actor.

## 16. UI design

Operational screens use RME3 `CUSTOM` views because they combine state transitions,
large touch targets, derived weights, queues, and real-time updates. Administrative
catalogs and historical lists use `RunlyTable`/blueprints where practical.

### 16.1 Navigation

| Label | Route | Primary permission |
|---|---|---|
| Operación | `/app/m/custom.dispatch/operacion` | `dispatch.dashboard.read` |
| Nuevo vale | `/app/m/custom.dispatch/nuevo` | create volume or scale |
| Vales | `/app/m/custom.dispatch/vales` | `dispatch.ticket.read` |
| Salidas pendientes | `/app/m/custom.dispatch/salidas` | `dispatch.exit.review` |
| Configuración | `/app/m/custom.dispatch/configuracion` | `dispatch.catalog.manage` |

### 16.2 Operations dashboard

- `PageHeader` with current site/station context.
- KPI cards: created today, ready for exit, pending approval, rejected today, used
  today.
- High-visibility pending-exit queue.
- Recent vouchers table.
- Quick actions for `Nuevo por volumen`, `Nuevo por báscula`, and `Capturar salida`.

### 16.3 Volume voucher screen

- Single focused form using React Hook Form and Zod.
- Material through `ComboboxField` or `CreatableComboboxField` according to catalog
  permission.
- m³, plate, driver, payment method, payment reference, optional buyer email, notes.
- Optional inline payment evidence via `AttachmentsPanel` after ticket creation.
- Success state presents folio, QR preview, PDF/print action, and next operational step.

### 16.4 Scale voucher screen

- Step 1: customer/external voucher/material/plate/driver.
- Step 2: tare capture or authorized exception.
- Step 3: generate folio and print copies.
- Existing customer and vehicle references are optional conveniences; text snapshots
  remain supported.

### 16.5 Scale exit capture

- Search by folio or plate.
- Large tare and gross summary.
- Gross input, derived net, validation that gross is greater than tare.
- Clear exception banner when weights are incomplete.
- Confirmation through `Dialog`; no native browser dialogs.

### 16.6 Exit approval queue

- Newest pending scan first.
- Cards show folio, material, quantity, plate, customer, weights, attempt number, and
  elapsed waiting time.
- Primary actions: `Aprobar salida` and `Rechazar`.
- Rejection uses a required reason form in `Dialog`.
- Approval uses `ConfirmDialog` and explains that the voucher becomes `USED`.
- Previous rejected attempts are visible before deciding.

### 16.7 Voucher detail

- Current status and primary operational action.
- Commercial snapshot.
- Weighing summary and correction history.
- Exit-attempt history.
- `AttachmentsPanel` for external voucher, ejido voucher and payment evidence.
- Module-owned domain event timeline sourced from `dispatch_ticket_event`; it can move
  to the shared activity component after RME3 exposes an activity publishing bridge.
- PDF, print, export, cancel, and correction actions according to permissions/state.

### 16.8 UI standards

- Every screen starts with `PageHeader`.
- Entity lists use `RunlyTable`.
- Loading uses `Skeleton`; empty/error states use `EmptyState`/`ErrorState`.
- Mutations show `sonner` success/error toasts.
- All form controls come from `@runly/ui`.
- No native `input`, `select`, `textarea`, table, modal, alert, confirm, or prompt when
  an Runly equivalent exists.
- Screens work at 375 px and at desktop scale-operator resolutions.
- Status must never be communicated only by colour.

## 17. Security

1. All MVP routes require an authenticated Runly user.
2. Company and actor ids are server-resolved and never trusted from request bodies.
3. Guard scan responses expose no ticket details beyond whether the scan was accepted.
4. QR values are opaque and hashes are stored at rest.
5. Every query is company-scoped, including joins and relation validation.
6. Cross-company ids return 404/403 without leaking the foreign record.
7. Authorization uses granular permissions and station assignments.
8. Attachments use Runly private file storage and signed access.
9. Operational tables are accessed through the Runly API, not directly from the
   browser through Supabase Data API.
10. Service-role credentials never enter module browser bundles.
11. Domain events and AuditLog preserve before/after information for corrections,
    exceptions, decisions and cancellations.

## 18. Validation rules

### 18.1 General

- Plate is normalized to uppercase and trimmed; punctuation policy is configurable.
- Quantities and weights must be positive.
- Material, site, and station must be enabled and belong to the active company.
- Gate station must have type `GATE`; weighing station must have type `SCALE`.
- Terminal tickets reject every mutating operational endpoint.

### 18.2 VOLUME

- `measurement_mode = M3`.
- `sold_volume_m3` is required.
- Tare and net are not required.
- `AUXILIARY_EXIT_GROSS` is optional when the route bypasses the scale.
- Auxiliary weight cannot be labelled or reported as net material weight.

### 18.3 SCALE

- `measurement_mode = TONS`.
- Customer snapshot and external voucher reference are required by default.
- Effective tare and gross are required before `READY_FOR_EXIT`.
- An authorized exception may replace one or both required readings.
- If both exist, gross must be greater than tare.

### 18.4 Exit

- Scan accepts only `READY_FOR_EXIT` or `CORRECTION_REQUIRED`.
- Rejection requires a human-readable reason.
- Approval is only valid for the current pending attempt.
- Approval and transition to `USED` are atomic.
- A rejected attempt never changes the ticket to a terminal state.

## 19. Testing strategy

Tests use Node.js `node:test`.

### 19.1 Service tests

1. Create VOLUME ticket and atomically assign `VV-000001`.
2. Create SCALE ticket and atomically assign `VB-000001`.
3. Reject mixed primary measurement modes.
4. Capture tare then gross and derive net.
5. Reject gross less than or equal to tare.
6. Capture auxiliary VOLUME gross without creating a fake net.
7. Require override permission and reason for weighing exception.
8. Reject scan before ticket is ready.
9. Create pending attempt and notification target list.
10. Reuse pending attempt on duplicate scan.
11. Reject attempt, rescan same QR, create attempt 2, approve, mark ticket USED.
12. Reject use of USED/CANCELLED/EXPIRED QR.
13. Correct weighing by superseding rather than overwriting.
14. Cancel only non-terminal vouchers with reason.

### 19.2 Concurrency tests

1. Parallel ticket creation cannot duplicate folios.
2. Parallel scans cannot create two pending attempts.
3. Parallel approval/rejection cannot produce conflicting decisions.
4. Retried idempotency keys return the original result.

### 19.3 Isolation and permission tests

1. Every read and mutation rejects foreign-company ids.
2. Guard cannot approve/reject.
3. Sales operator cannot authorize a weighing exception.
4. Scale operator cannot manage catalogs without permission.
5. Station assignment controls alert recipients.

### 19.4 UI and document QA

1. 375 px, tablet and desktop responsive checks.
2. Keyboard-only form and approval flow.
3. Scanner input burst behavior if a keyboard-wedge adapter is used later.
4. Dark/light theme and non-colour status labels.
5. Three voucher copies render correctly on the configured paper size.
6. QR remains readable after ordinary office printing.

## 20. Delivery phases

### Phase 1 — Module foundation and catalogs

- Create `custom.dispatch` from the Dev Kit golden path.
- Manifest/PWA identity, permissions, navigation and models.
- Sites, stations, assignments, materials and folio series.
- Company isolation and catalog tests.

### Phase 2 — Voucher creation and printing

- VOLUME and SCALE creation services/forms.
- Atomic folios and QR tokens.
- Three-copy branded PDF.
- Ticket list/detail, attachments and event timeline.

### Phase 3 — Weighing lifecycle

- Tare, gross, derived net and auxiliary volume gross.
- Correction history and weighing exceptions.
- Ready-for-exit transition rules.

### Phase 4 — Gate scan and remote approval

- Authenticated gate scan endpoint/adapter.
- Exit attempts and retries.
- Pending queue, notifications, approval/rejection and `USED` transition.
- Concurrency and idempotency tests.

### Phase 5 — Pilot hardening

- Real printer/QR QA.
- Station-level permissions and operator assignments.
- Performance, audit, Excel export and responsive QA.
- Confirm actual scanner and scale hardware before adding device integration.

### Deferred phases

- Website requests and public tracking.
- External customer email delivery.
- Municipal reporting/export.
- Automatic scale adapter.
- Offline gate scan queue.
- Promotion to an official `runly.dispatch` module after reuse is proven.

## 21. Acceptance criteria for the internal MVP

1. A sales operator can create and print a VOLUME voucher with m³, plate, driver,
   payment declaration, optional email, folio, QR and three copies.
2. A scale operator can create a SCALE voucher, capture tare/gross, see net, and print
   the voucher.
3. A permitted supervisor can authorize a missing-reading exception with a mandatory
   reason.
4. A guard scan creates exactly one pending exit attempt and alerts the assigned scale
   operators.
5. A scale operator can approve the attempt; the ticket becomes `USED` atomically.
6. A scale operator can reject with reason; the same QR can create the next attempt
   after correction.
7. The detail screen shows every attempt, reading, correction, document, print and
   decision.
8. Used, cancelled and expired vouchers cannot be used again.
9. Parallel operations do not duplicate folios, attempts or final decisions.
10. No company can read or mutate another company's dispatch data.

## 22. Remaining pilot configuration, not design blockers

These values can be decided during deployment without changing the domain model:

- Initial site/station names and codes.
- Initial material list and catalog links.
- Folio prefixes and starting numbers.
- Default voucher expiration policy.
- Letter-page copy layout and printer margins.
- Radio/telephone communication labels.
- Which users receive alerts at each scale station.
- Whether a specific route permits weighing exceptions.

## 23. Approval gate

No production code should be implemented from this document until the product owner
reviews at least:

1. Voucher states and terminal behavior.
2. VOLUME auxiliary gross interpretation.
3. SCALE exception policy.
4. Actor/permission separation.
5. Data captured on the three printed copies.
6. Phase ordering and deferred scope.
