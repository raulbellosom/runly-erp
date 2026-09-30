# Inventory: administrative status (alta / baja) and physical condition

Date: 2026-09-28
Status: Approved 2026-09-29 (product owner)
Module: `runly.inventory`

## 1. Goal

Today `InvItem.status` mixes three concerns in one field: operational use
(`available`, `assigned`, `maintenance`), de facto deregistration
(`retired`, `lost`, `stolen`, `disposed`) and nothing at all for physical
condition. Deregistering an asset leaves no formal record (date, reason,
evidence, who authorized it).

This design splits the item into three independent axes:

| Axis | Field | Values | Rules |
|---|---|---|---|
| Administrative status | `adminStatus` (new) | `registration_pending`, `registered`, `deregistration_proposed`, `deregistered` | State machine with permissions (section 3) |
| Operational status | `status` (existing, narrowed) | `available`, `assigned`, `maintenance` | Unchanged assignment flow |
| Physical condition | `conditionId` (new) | Per-company editable catalog | Descriptive, no rules |

`registered` is the default for every new item.

UI labels (Spanish): Pendiente de alta, Alta, Propuesta de baja, Baja.

## 2. Data model (Prisma, forward migration)

`InvItem` new columns:

- `adminStatus` `VARCHAR(40)` default `'registered'`, indexed with `companyId`.
- `registeredAt` `DATE?` — alta date (backfilled from `createdAt`).
- `deregisteredAt` `DATE?` — effective baja date.
- `deregistrationReason` `VARCHAR(40)?` — current/last baja reason code.
- `conditionId` `UUID?` -> `InvCondition` (`onDelete: SetNull`).

New `InvCondition` (same shape as `InvLocation`): `id`, `companyId`, `name`,
`description?`, `color?`, `sortOrder`, `enabled`, timestamps,
`@@unique([companyId, name])`. Default set, seeded idempotently the first time
a company lists conditions: Nuevo, Semi nuevo, Sin usar, En uso, En desuso,
Instalado, Descompuesto, Otros.

New `InvItemAdminEvent` (formal ledger of every administrative transition,
source for the proposals queue and the item's baja record):

- `id`, `companyId`, `itemId` (cascade), `action`, `fromStatus`, `toStatus`,
  `reason?`, `comment?`, `effectiveDate?`, `fileId?` (evidence, `FileAsset`),
  `actorId` (`UserProfile`), `createdAt`.
- Indexes: `[itemId, createdAt]`, `[companyId, toStatus]`.

Deregistration reasons are a fixed code list (validators + UI constants):
`obsolescence`, `damage`, `loss`, `theft`, `sale`, `donation`, `destruction`,
`other` (Obsolescencia, Daño, Pérdida, Robo, Venta, Donación, Destrucción, Otro).

### Data migration (same forward migration)

- Items with `status` in `retired|lost|stolen|disposed` -> `adminStatus =
  'deregistered'`, `deregistrationReason` mapped (`retired`->`obsolescence`,
  `lost`->`loss`, `stolen`->`theft`, `disposed`->`destruction`),
  `deregisteredAt = updatedAt::date`, `status = 'available'`, and one
  `InvItemAdminEvent` with `action = 'migrated'` (actor: the item's
  `createdById`, or skipped when null — `actorId` is nullable for this case only).
- Every other item -> `adminStatus = 'registered'`, `registeredAt = createdAt::date`.

## 3. State machine and permissions

| Action | From -> To | Permission | Payload |
|---|---|---|---|
| `confirm_registration` | `registration_pending` -> `registered` | `inventory.item.register` (new) | `effectiveDate` (required), `comment?`, `fileId?` |
| `propose_deregistration` | `registered` -> `deregistration_proposed` | `inventory.item.update` | `reason` (required), `comment?`, `fileId?` |
| `approve_deregistration` | `deregistration_proposed` -> `deregistered` | `inventory.item.deregister` (new) | `effectiveDate` (required), `comment?`, `fileId?` |
| `reject_deregistration` | `deregistration_proposed` -> `registered` | `inventory.item.deregister` | `comment` (required) |
| `revert_deregistration` | `deregistered` -> `registered` | `inventory.item.deregister` | `comment` (required) |

Creating an item: default `registered` (`registeredAt` = today); the form
offers "Registrar como pendiente de alta" -> `registration_pending`.

Side effects and guards (all enforced in the API, same transaction):

- Approving a baja closes the active assignment (same logic as `returnItem`)
  and sets `status = 'available'`, `deregisteredAt`, `deregistrationReason`
  (from the proposal event).
- Reverting clears `deregisteredAt`/`deregistrationReason`.
- `assignItem` rejects items whose `adminStatus` is `registration_pending` or
  `deregistered` (409, Spanish message). `deregistration_proposed` items keep
  operating normally.
- `PATCH /inventory/items/:id` never accepts `adminStatus`; `status` only
  accepts `available|maintenance` (assignment still goes through assign/return).
  `ALLOWED_ITEM_STATUS_TRANSITIONS` is reduced accordingly.
- Deregistered items are read-only except for comments/files and
  `revert_deregistration`.
- Every transition writes the `InvItemAdminEvent` row plus an `AuditLog`
  entry (`inventory.item.<action>`) so `ActivityTimeline` shows it.
- A new proposal notifies users holding `inventory.item.deregister`
  (via `inventory-notification-service`).

## 4. API

- `POST /inventory/items/:id/admin-transition` `{ action, reason?, comment?,
  effectiveDate?, fileId? }` — single endpoint, permission checked per action.
- `POST /inventory/items/admin-transition/bulk` `{ action, ids[] (max 200),
  ... }` — same payload applied to many items; returns per-id
  `{ id, ok, error? }` (needed to process proposals and pending altas in batch).
- `GET /inventory/items/:id/admin-events` — administrative record of an item.
- `GET /inventory/items` gains `adminStatus` (CSV) and `conditionId` filters.
  Default when `adminStatus` is omitted: `registered,deregistration_proposed`.
- `GET /inventory/summary` — counts by `adminStatus`, by condition (including
  "Sin condición"), and by operational status, for the dashboard.
- Condition catalog CRUD under the existing catalogs routes
  (`inventory.catalog.read|manage`).
- Import (`import-routes.js`) and AI intake (`intake-validators.js`) accept
  `adminStatus` (only `registered|registration_pending`) and condition by name;
  legacy status values (`retired`, `lost`, ...) in an import are rejected with
  a clear message (bajas go through the transition flow).
- `inventory-chat-actions.js` / `inventory-query.js`: drop the legacy status
  values; the assistant can filter by `adminStatus` and condition but cannot
  approve bajas.

## 5. UI (`apps/desktop/src/modules/runly.inventory`)

- `InventoryScreen`: KPI strip (Total, Alta, Pendiente de alta, Propuesta de
  baja, Baja, each with % of total; clicking filters the list), `adminStatus`
  multi-filter (default Alta + Propuesta de baja), condition filter, columns
  "Situación" (badge) and "Condición". Group-by gains "Situación" and
  "Condición". Row selection enables bulk actions per permission.
- New `InventoryAdminStatusBadge` next to the existing `InventoryStatusBadge`.
- `InventoryItemDetail`: header badge + action menu (Confirmar alta, Proponer
  baja, Autorizar / Rechazar baja, Revertir baja, depending on state and
  permission); a "Situación administrativa" section with the baja/alta record
  (date, reason, comment, evidence link, actor) from `admin-events`.
- `InventoryAdminTransitionDialog` (`Dialog`, fixed header/footer): reason
  (`SelectField`), effective date (`DatePickerField`), comment
  (`TextareaField`), evidence (`FileUploader`). Reject/revert require comment.
- New "Resumen" view (navigation entry in the manifest): KPIs + donut by
  administrative status + bar/radial chart by condition + small table of
  pending proposals with approve/reject shortcuts.
- Catalogs screen gets a "Condiciones" tab (name, color, order, enabled).
- Form: condition picker (`CreatableComboboxField`), "Registrar como
  pendiente de alta" checkbox on create only.
- Help content (`help/runly.inventory/views/*.md`) updated for the new flow.

## 6. Permissions catalog

Add to `permission-catalog.js` (group `inventory`) and seed:
`inventory.item.register` ("Confirmar altas de activos") and
`inventory.item.deregister` ("Autorizar, rechazar y revertir bajas de activos").

## 7. Tests (lean)

- Service: each transition (happy path + wrong source state + missing
  permission-level payload), approve closes active assignment, assign rejected
  for pending/deregistered, bulk returns per-id results, PATCH ignores
  `adminStatus`.
- Migration mapping helper (status -> reason) unit test.
- Summary counts.

## 8. Out of scope

- Accounting impact (book value, depreciation, `runly.ledger` entries on baja).
- Multi-step or configurable approval chains (one authorizer level only).
- Printable baja certificate (acta) generation — evidence is an uploaded file.
- Custom per-company deregistration reasons.
