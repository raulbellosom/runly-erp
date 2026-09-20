# `custom.dispatch` — Phase 2 Implementation Plan

- Date: 2026-09-20
- Status: In progress
- Design: `docs/2026-08-31-custom-dispatch-design.md`
- Scope: (A) split the operational Setup UI into standalone pages (no shared tab
  switcher), and (B) voucher creation, atomic folios, QR issuance, and the
  ticket list/detail screens.

## Outcome

Every catalog and every ticket screen is its own page/route/component — no
screen composes unrelated sections behind a `Tabs` control. A sales operator
can create and view a `VOLUME` voucher; a scale operator can create a `SCALE`
voucher. Both get an atomic folio and a QR token. Tickets can be listed and
inspected in detail, including their event timeline.

## Part A — Page architecture refactor (no tabs)

Problem found in the current build: all five catalog routes (`/sitios`,
`/estaciones`, `/materiales`, `/responsables`, `/folios`) and `/operacion`
render the same `custom.dispatch:DispatchSetup` component, which reads
`location.pathname` to decide what to show and renders a `SetupNavigation`
tab bar to jump between catalogs without navigating. This is the pattern to
remove.

1. Delete `components/DispatchSetup.jsx` and `components/setup/SetupNavigation.jsx`.
2. Add `components/pages/CatalogPage.jsx` — a thin, reusable shell (own
   `PageHeader`, own `useQuery`/mutations, renders `CatalogWorkspace` for a
   single `resource` passed as a prop). Reuse, not a tab switcher: nothing
   lets you leave the page's resource without navigating.
3. Add five one-line page components that each mount `CatalogPage` with a
   fixed resource: `SitesPage.jsx`, `StationsPage.jsx`, `MaterialsPage.jsx`,
   `AssignmentsPage.jsx`, `SeriesPage.jsx`.
4. Add `components/pages/OperationDashboard.jsx` for `/operacion` — the real
   landing dashboard (readiness checklist + quick links today; ticket KPIs
   once Phase 2 ships), reusing `SetupOverview`'s content as its own page.
5. Update the six `views/*.custom.js` `component` fields to the new registry
   keys; update `components/index.js` registrations accordingly.

`CatalogWorkspace.jsx` and `CatalogEditorDialog.jsx` are kept as-is — they are
a reusable CRUD table/dialog, not the tab-switching violation.

## Part B — Voucher creation and printing (subset of design Section 20 Phase 2)

Included in this pass:

- `dispatch_ticket` and `dispatch_ticket_event` models.
- Atomic folio assignment (row-lock increment on `dispatch_folio_series`,
  same transaction as ticket insert).
- QR token generation: random token, SHA-256 hash stored, raw token returned
  once in the creation response for the frontend to render as `RUNLY-DISPATCH:1:<token>`.
- `POST /dispatch/tickets/volume`, `POST /dispatch/tickets/scale`,
  `GET /dispatch/tickets`, `GET /dispatch/tickets/:id` — all guarded by the
  Phase 1 permission keys (`dispatch.ticket.*`), already declared in the
  manifest.
- Four ticket pages, each its own route/component:
  `vales/nueva-volumen`, `vales/nueva-bascula`, `vales` (list), `vales/:id`
  (detail with event timeline).

Explicitly deferred to a follow-up pass (Phase 2b / Phase 3 per the design doc):

- Branded 3-copy PDF generation and print/reprint events.
- `AttachmentsPanel` wiring (`dispatch_document_reference`).
- Weighing capture (tare/gross/net), weighing exceptions. — done, see
  `2026-09-20-custom-dispatch-phase3.md`.
- Gate scan, exit attempts, approval queue, notifications. — done, see
  `2026-09-20-custom-dispatch-phase4.md`.
- `PATCH /dispatch/tickets/:id` and `POST /dispatch/tickets/:id/cancel`
  (design section 13.1) were also missing after this pass; added afterward —
  correcting administrative fields (plate, customer, driver, payment) and
  cancelling with a required reason, both restricted to
  `CREATED`/`READY_FOR_EXIT`/`CORRECTION_REQUIRED` tickets. UI lives on the
  ticket detail page itself (`Editar` / `Cancelar vale`), not a new page —
  these are actions on that entity's own detail screen, same as the
  catalog rows' edit/deactivate actions.

A `SCALE` ticket is created at `status = CREATED` and stays there until
Phase 3 (weighing) lands — there is nothing else in this module yet that can
move it to `READY_FOR_EXIT`. A `VOLUME` ticket has no further required
capture, so it is created directly at `READY_FOR_EXIT`.

## Data model (this pass only)

`dispatch_ticket` — trimmed from the design's full field list to what Phase 2
needs; weighing-exception fields are added when Phase 3 introduces weighing.

`dispatch_ticket_event` — append-only, `companyScoped: true`, no soft delete.
Events written this pass: `TICKET_CREATED`, `FOLIO_ASSIGNED`.

## Tests

`node --test` has no live Postgres connection available in this environment,
so this pass adds model/validator-level coverage only (manifest+model
contract test, Zod schema tests for the two creation payloads). Service-level
tests (folio atomicity, company isolation, concurrent scan/approve) are
deferred to whoever runs this against the real Supabase instance, per the
existing `19. Testing strategy` section of the design doc.
