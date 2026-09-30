# runly.purchases — core module redesign

Status: approved (2026-09-30, requested by the product owner as a full redesign)
Supersedes: the first iteration delivered on 2026-09-29 (migration
`20260929130000_core_purchases`, 5 generic screens, 10 endpoints), which was
built from a requirements brief that never landed in the repo. This document
records that brief (section 1) and the redesign that completes it.

## 1. Original requirements (condensed)

Compras manages the acquisition of goods and services with a process that each
company sizes to its needs:

- **Capabilities** decide *what* is used: `requests`, `quotes`, `approvals`,
  `purchaseOrders`, `receipts`, `invoices`, `payments`, `inventoryRelations`.
- **Workflow** decides *how* the stages are ordered:
  `REQUEST → QUOTES → APPROVAL → PURCHASE_ORDER → RECEIPT → INVOICE → PAYMENT → CLOSE`.
- **Policies** decide *when* a stage becomes mandatory (amount thresholds,
  goods vs services).
- Every stage has a mode: `REQUIRED | OPTIONAL | CONDITIONAL | DISABLED`.
- Presets: Simple (Factura → Relacionar → Cierre), Básico (OC → Factura →
  Cierre), Compras + Inventario (OC → Recepción → Factura → Cierre), Completo
  (all stages), Personalizado.
- Configuration is per company; the model must allow several workflows per
  company later (selection by amount).
- `PurchaseCase` (expediente) is the architectural container; it may be
  invisible in simple modes.
- Inventario owns objects; Compras owns orders, invoices, requests, quotes,
  receipts, suppliers data, amounts and fiscal documents.
- Legacy inventory purchase fields are migrated into relations, never deleted
  without a strategy (done in the first iteration: `MIGRATED` relations).
- Relations are N:N through the generic `entity_relation` table, with origin
  `MANUAL | INHERITED | AUTOMATIC | MIGRATED`; money split lives in
  `purchase_allocation`.
- Bidirectional navigation: from an inventory item create/link orders and
  invoices; from a document pick existing items (multi-select) or create new
  items through the official inventory service.
- Linking an invoice to an order proposes inheriting the order's items.
- Receipts support partial reception. Requests, quotes, approvals and payments
  are optional capabilities and must be invisible when disabled.
- Payments do not duplicate accounting: Compras records payment status and
  references; a future finance link is a relation.
- Navigation, routes, tabs, buttons and backend endpoints all honour
  capabilities. Backend validates `companyId`, ACL and capabilities; frontend
  hiding is cosmetic only.
- Every sensitive action is audited (`audit_log`) and broadcast through the
  existing realtime broadcaster (`purchase.*` events).
- Compras works without Inventario, Fleet or Finanzas installed.

## 2. What the redesign fixes

| Area | First iteration | Redesign |
|---|---|---|
| Entities | order, invoice, case only | + request, quote, approval, receipt (+ receipt lines), payment data on invoice |
| Documents | create only, no detail, no edit | full lifecycle: draft edit, status transitions, detail pages |
| Lines | stored, never shown | line editor (goods/service, qty, unit, tax rate), received qty, create inventory from line |
| Relations | raw UUIDs in UI | hydrated labels (number, name, asset tag, status, total, route) |
| Policies | stored, never evaluated | `evaluatePolicies()` blocks issuing an order/invoice when a required stage is missing |
| Inventory | flat list of relation ids | adaptive "Compra" timeline + purchase-side item picker + creation of items from lines |
| Suppliers | plain contact list | supplier profile (code, terms), spend and document history |
| Navigation | orders/invoices only filtered, extra in-page subnav | every entry mapped to a capability, in-page subnav removed (sidebar is the nav) |
| Visual | generic tables, no identity | teal "Compras" identity, flow ribbon as signature element, KPI strips, charts |

## 3. Data model (forward migration `20260930120000_purchases_redesign`)

Existing tables stay; applied migrations are immutable.

New tables (all with `company_id`, `uuidv7()` ids, RLS enabled + service_role
policy like the first migration):

- `purchase_request`: `case_id`, `number` (SOL-000001), `title`,
  `justification`, `needed_by` DATE, `priority` (LOW|NORMAL|HIGH|URGENT),
  `status` (DRAFT|SUBMITTED|APPROVED|REJECTED|ORDERED|CANCELLED),
  `estimated_total`, `currency`, `requester_id`, `created_by_id`, timestamps.
- `purchase_quote`: `case_id`, `request_id` NULL, `supplier_id` NULL,
  `reference`, `issue_date`, `valid_until`, `currency`, `subtotal`, `tax`,
  `total`, `delivery_days` INT NULL, `status` (RECEIVED|SELECTED|DISCARDED),
  `notes`, `created_by_id`, timestamps.
- `purchase_approval`: `case_id`, `owner_type` (PURCHASE_REQUEST|PURCHASE_ORDER|PURCHASE_INVOICE),
  `owner_id`, `reason` (policy text), `status` (PENDING|APPROVED|REJECTED),
  `requested_by_id`, `decided_by_id`, `decided_at`, `comment`, timestamps.
- `purchase_receipt`: `case_id`, `order_id`, `number` (REC-000001),
  `received_at` DATE, `status` (DRAFT|COMPLETED|CANCELLED), `notes`,
  `received_by_id`, timestamps.
- `purchase_receipt_line`: `receipt_id`, `order_line_id`, `quantity`.

New columns:

- `purchase_line`: `item_kind` (GOODS|SERVICE, default GOODS), `unit`
  VARCHAR(20), `tax_rate` DECIMAL(6,4) default 0, `received_quantity`
  DECIMAL(14,4) default 0, `inventory_category_id` UUID NULL.
- `purchase_order`: `expected_date`, `supplier_reference`, `payment_terms`,
  `issued_at`, `closed_at`, `cancelled_at`.
- `purchase_invoice`: `due_date`, `paid_at`, `payment_reference`,
  `payment_method`, `paid_amount` DECIMAL(14,2) default 0.
- `purchase_case`: `supplier_id` NULL, `request_id` NULL.

Status sets:

- Order: DRAFT, PENDING_APPROVAL, APPROVED, ISSUED, PARTIALLY_RECEIVED,
  RECEIVED, CLOSED, CANCELLED.
- Invoice: DRAFT, PENDING_APPROVAL, PENDING (por pagar), PARTIALLY_PAID, PAID,
  CANCELLED. Legacy `PENDING` rows stay valid.
- Case: OPEN, IN_PROGRESS, CLOSED, CANCELLED.

## 4. Policies

`workflow.policies` is an array:

```json
{ "id": "p1", "label": "Montos mayores a 50,000 requieren aprobación",
  "when": { "metric": "total", "op": "gt", "value": 50000 },
  "require": { "stage": "APPROVAL" } }
{ "when": { "metric": "total", "op": "gt", "value": 10000 },
  "require": { "stage": "QUOTES", "min": 3 } }
{ "when": { "metric": "hasGoods", "op": "eq", "value": true },
  "require": { "stage": "RECEIPT" } }
```

`evaluatePolicies(workflow, context)` is a pure function in
`purchase-policies.js` returning `[{ stage, min?, reason, satisfied }]`.
Context: `{ total, hasGoods, quotesCount, approved, receivedAll }`. A stage in
`REQUIRED` mode is always required; `CONDITIONAL` only when a policy matches;
`OPTIONAL` never blocks; `DISABLED` never appears. Unsatisfied requirements
block `issue` (order) and `pay`/`close` (invoice/case) with 409
`POLICY_BLOCKED` and the list of reasons; the UI shows them before the action.

## 5. Stage map

`buildStageMap(workflow, caseBundle)` (pure, same file) returns, for each
enabled stage, `{ type, label, mode, state: done|current|pending|skipped|blocked, refs: [{type,id,number,status}] }`.
It powers the flow ribbon in case, order, invoice detail and in the inventory
section.

## 6. API contract (all mounted with auth, all scoped by `companyId`)

Envelope: lists `{ data, total, page, pageSize }`; single `{ data }`; errors
`{ error, code }` (codes: `CAPABILITY_DISABLED` 409, `POLICY_BLOCKED` 409 with
`reasons`, `INVALID_TRANSITION` 409, `NOT_FOUND` 404, `VALIDATION` 400).

Settings: `GET /purchases/settings`, `PUT /purchases/settings`,
`GET /purchases/capabilities` (`{ capabilities, stages, preset, policies }`).

Dashboard: `GET /purchases/dashboard` →
`{ metrics: { openCases, ordersOpen, orderedAmount, invoicedAmount, payableAmount, overdueInvoices, pendingApprovals, pendingReceipts },
   monthly: [{ month: 'YYYY-MM', ordered, invoiced }] (12),
   topSuppliers: [{ id, name, total, documents }] (6),
   pipeline: [{ stage, count }],
   attention: { approvals: [...], overdueInvoices: [...], awaitingReceipt: [...] },
   recent: [{ kind, id, number, supplierName, total, status, date }] }`.

Documents (kind = cases | requests | quotes | orders | receipts | invoices):

- `GET /purchases/{kind}?search&status&supplierId&page&pageSize` — rows
  include `supplierName` where applicable.
- `GET /purchases/{kind}/:id` → `{ data: { ...doc, supplier, lines, relations, stageMap, approvals, receipts?, invoices?, orders?, quotes?, policyCheck } }`.
- `POST /purchases/{kind}` (requests, quotes, orders, invoices, receipts, cases).
- `PATCH /purchases/{kind}/:id` — editable only in DRAFT (orders/invoices/
  requests); lines are replaced as a set.
- `POST /purchases/{kind}/:id/transition { action, ...payload }`:
  - requests: submit, approve, reject, cancel, convert (→ creates draft order,
    returns `{ data: order }`).
  - quotes: select (discards siblings of the same case), discard.
  - orders: submit (→ PENDING_APPROVAL or APPROVED per policy), approve,
    reject, issue, close, cancel.
  - invoices: submit, approve, pay `{ amount, paidAt, reference, method }`,
    cancel.
  - cases: close, cancel, reopen.
- `POST /purchases/receipts { orderId, receivedAt, notes, lines: [{ orderLineId, quantity }] }`
  validates quantity ≤ pending, updates `received_quantity` and order status.

Approvals inbox: `GET /purchases/approvals?status=PENDING`,
`POST /purchases/approvals/:id/decide { decision: APPROVED|REJECTED, comment }`.

Relations:

- `GET /purchases/relations?moduleKey&entityType&entityId` → hydrated:
  `{ id, relationType, origin, createdAt, other: { module, type, id, label, sublabel, status, total, currency, path } }`.
- `POST /purchases/relations` (single), `POST /purchases/relations/bulk
  { sourceType, sourceId, targetType: 'inventory_item', targetIds[] }`,
  `DELETE /purchases/relations/:id`.
- `GET /purchases/relations/propagation?invoiceId&orderIds=a,b` → items linked
  to the orders but not the invoice; `POST /purchases/invoices` and
  `PATCH` accept `inheritItems: true`.

Inventory bridge:

- `GET /purchases/inventory/:itemId/summary` →
  `{ capabilities, timeline: [{ stage, label, docs: [{ type, id, number, status, total, currency, date, path, origin, relationId }] }], allocatedAmount, currency }`
  filtered by capability and the caller's read permissions.
- `GET /purchases/inventory/candidates?search&page` → inventory items of the
  company for the multi-select picker (`id, assetTag, name, status, categoryName`),
  404-safe when `runly.inventory` is not enabled (returns empty + `available:false`).
- `POST /purchases/lines/:lineId/inventory { items: [{ name, serialNumber, categoryId, locationId, modelId }] }`
  creates items through `inventoryService.createItem`, relates each to the
  line's document (origin AUTOMATIC) and writes a `purchase_allocation` with
  the line unit amount.
- `GET /purchases/documents/search?type=order|invoice&search&page` — for
  "Relacionar existente".

Suppliers: `GET /purchases/suppliers` (contacts + profile + `documents`,
`spend`), `GET /purchases/suppliers/:contactId` (profile, stats, recent docs,
monthly spend), `PUT /purchases/suppliers/:contactId/profile`.

Files use the existing generic attachments stack (`AttachmentsPanel`) with
entity types `purchase_order`, `purchase_invoice`, `purchase_receipt`,
`purchase_quote`; invoice PDF/XML are attachments labelled `pdf` / `xml`.

Every route checks: permission (`requirePermission`), capability (`assertCapability`),
company ownership of every referenced id.

## 7. Permissions

Existing keys stay. New keys: `purchases.request.read|create|update`,
`purchases.quote.read|manage`, `purchases.approval.decide`,
`purchases.receipt.read|create`, `purchases.payment.manage`,
`purchases.supplier.manage`, `purchases.case.read` reused for cases.

## 8. Navigation (manifest + runtime filter)

| Entry | Path | Capability |
|---|---|---|
| Resumen | /purchases | always |
| Expedientes | /purchases/cases | requests or quotes or approvals |
| Solicitudes | /purchases/requests | requests |
| Aprobaciones | /purchases/approvals | approvals |
| Órdenes | /purchases/orders | purchaseOrders |
| Recepciones | /purchases/receipts | receipts |
| Facturas | /purchases/invoices | invoices |
| Pagos | /purchases/payments | payments |
| Proveedores | /purchases/suppliers | always |
| Configuración | /purchases/settings | always (settings.read) |

Quotes live inside the case/request detail (compare view), not in the sidebar.

## 9. Visual identity

- Palette: deep teal → petrol hero gradient (`#0f766e → #115e59 → #0c4a6e`),
  emerald for completed, amber for money pending, rose for blocked/overdue.
  Module color stays `#0f766e`.
- Signature element: **flow ribbon** (`PurchaseFlowRibbon`) — the company's
  enabled stages as a connected horizontal track; on the dashboard each node
  shows its pipeline count, in a document it shows progress, in Settings it is
  the live preview of the chosen preset, in Inventario it collapses to a
  vertical timeline.
- Dashboard follows the inventory dashboard grammar: one loud hero, metric
  tiles, one chart per question (12-month ordered vs invoiced area chart,
  supplier ranking bars, attention lists).
- Documents: full-page editor (not a dialog) with header fields, a line editor
  and a sticky totals card; detail pages with hero (number, supplier, status
  pill, total), flow ribbon, tabs (Conceptos, Inventario, Documentos
  relacionados, Archivos, Actividad).
- Inputs: `ContactPicker`/`ComboboxField` for supplier, `DateField`,
  `CurrencyField`, `NumberField`, `SelectField` (currency, tax rate, priority),
  `SegmentedControl` (goods/service, stage mode), `SwitchField` (capabilities),
  `TextareaField` (notes), `ConfirmDialog` for destructive actions. No native
  inputs or browser dialogs.

## 10. MirAI groundwork

`purchases-assistant-context.js` exposes read-only, company-scoped helpers
(`pendingActions`, `findDocuments`, `supplierSpend`, `itemPurchaseHistory`)
returning compact JSON. It is not wired into MirAI in this iteration; the help
content and this spec document it as the integration point, following the
`inventory-chat-actions.js` pattern for a later iteration.

## 11. Out of scope

Automatic workflow selection by amount (model allows it: `purchase_case.workflow_id`),
finance/ledger posting, CFDI XML parsing, supplier portal, e-mailing POs.

## 12. Verification

- `node --test` for policies, stage map, receipt quantity rules, relation
  hydration isolation and the router contract.
- `pnpm lint`, `pnpm build:web`.
- Real API boot + curl smoke of the new routes (requires the forward migration
  applied by the owner; the database is shared, agents never run
  `db:migrate`).
