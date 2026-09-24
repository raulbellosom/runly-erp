# Rediseño visual de runly.ledger (Libro de cuentas)

Date: 2026-09-23
Status: Approved
Author: Claude (agent session, commissioned directly by Raul — see Context)
Spec file: docs/superpowers/specs/2026-09-23-ledger-ui-redesign-design.md
Plan file: docs/superpowers/plans/2026-09-23-ledger-ui-redesign.md

---

## 1. Feature title

Rediseño visual del módulo runly.ledger (Cuentas, Grupos, Categorías, Resumen y el registro de movimientos tipo hoja de cálculo).

## 2. Status

In Progress — implemented 2026-09-23; lint/build/existing-tests/global-chrome-diff all pass, but the manual browser walkthrough of acceptance criteria (§25) was not performed in this session (no browser-automation tool or live-Supabase test credentials available — see the plan file's Task 7 and Verification Gate). Move to `Complete` once that walkthrough is done.

## 3. Context

The user is working from a Stitch-generated redesign reference located at
`C:\Users\raulb\Downloads\stitch_runly_ledger_finance_manager` (`DESIGN.md` design-token
doc, `code.html` static markup, `screen.png` rendered mock — all local reference files,
not committed to the repo). The reference reimagines `runly.ledger`'s "Cuentas" screen as
a dense fintech ledger: KPI strip, filter/search strip, a sticky-header spreadsheet-style
transaction grid with a totals footer, and a slide-over sheet for transaction detail. The
reference uses its own placeholder color system (green/orange "Material" palette, Inter
font) — that palette is NOT Runly's brand and must not be copied literally.

The current `runly.ledger` desktop screens (`apps/desktop/src/modules/runly.ledger/`)
already implement the same functional shape (inline-editable spreadsheet register with
keyboard navigation, tabs, export actions, group/membership management) but with plainer,
inconsistent visual treatment, and a duplicated "Grupos" concept: the sidebar's "Grupos"
nav item (`GroupsScreen.jsx`) and the "Cuentas" screen's own "Grupos" tab
(`AccountsScreen.jsx`) both independently list the same groups, both offer "Nuevo grupo",
and both navigate to the same `GroupScreen.jsx` detail — pure duplication with no
behavioral difference.

## 4. Problem

1. The ledger's content screens (Cuentas, Grupos, Categorías, account detail, transaction
   register) do not visually match Runly's current brand system (glass cards, flame/navy
   brand tokens, `@runly/ui` primitives like `StatCard`/`StatStrip`/`FilterBar`/`Badge`) —
   they use ad-hoc `hsl(var(--border))` divs instead of the shared component vocabulary,
   so the module reads as visually inconsistent with the rest of the app.
2. The transaction register lacks the "spreadsheet of record" polish the user wants
   (Ragic-style): no KPI summary above it, no search/type/category filtering, no totals
   footer row, no color-coded debit/credit columns, plain browser-default table styling.
3. "Grupos" is modeled twice in the UI (sidebar page + Cuentas tab) for no functional
   reason, forcing the user to maintain a mental map of two entry points to the same list.

## 5. Goals

1. Every `runly.ledger` content screen (Cuentas, cuenta detail — Registro/Resumen/Acceso,
   Grupos, grupo detail, Categorías, Mis membresías) visually matches Runly's existing
   brand system by building exclusively from `@runly/ui` primitives and CSS custom
   properties already defined in `apps/desktop/src/styles.css` (no new color palette).
2. The transaction register (`SpreadsheetRegister` + `DesktopTransactionTable`) gains a
   KPI strip (saldo inicial/actual, ingresos, egresos for the active date range), a
   filter strip (búsqueda de texto + tipo + categoría, client-side over loaded rows), and
   a totals footer row — while preserving 100% of the existing inline-edit / keyboard
   navigation behavior (Tab/Enter/Escape/arrow-key cell nav, always-last new-row, blur-to-save).
3. The "Grupos" duplication is resolved: the "Cuentas" screen's own "Grupos" tab is
   removed (the sidebar's "Grupos" nav item remains the single place to browse/manage
   groups, unchanged route); account cards that belong to a group show a small badge
   linking to that group so the relationship stays visible without a second full listing.
4. The global app chrome (top bar, left `AppShell` sidebar, and the module's own
   navigation entries defined in `runlyLedgerManifest.navigation`) is not modified in any way.
5. The transaction detail/edit affordance keeps its literal spreadsheet-grid identity
   (a Ragic-style dense editable table), not a card list or a form-first pattern — visual
   polish is layered on top of the existing `<table>`-based grid, not a replacement of it.

## 6. Non-goals

1. No new Prisma models, API endpoints, SDK methods, Zod validators, permissions, or
   navigation entries. This is a frontend-only visual/UX redesign of existing screens.
2. No change to `AppShell`, `ModuleSidebar`, the global top bar, or
   `runlyLedgerManifest.navigation` (the five nav items — Cuentas/Grupos/Categorías/
   Tipos/Mis membresías — stay exactly as declared in
   `apps/api/src/manifests/official/core-modules.js`).
3. No server-side pagination, search, or filtering — the register's new search/type/
   category filters operate client-side over the already-fetched page of transactions
   (same `limit`/"Cargar anteriores" model that exists today). True server-side filtering
   is listed under Future enhancements.
4. No changes to `TypesScreen.jsx` (already a generic blueprint-driven `RunlyCrudView`
   screen, consistent with the rest of the app) beyond what's incidentally needed for
   visual consistency — treated as out of scope.
5. No changes to `AiImportScreen.jsx` / `ImportWizard.jsx` (CSV/AI import flow) — out of
   scope for this visual pass.
6. No changes to the offline/SQLite ledger cache logic, mutation logic, or any
   `use-ledger-queries.js` / `useTransactionMutations.js` business logic beyond adding
   read-only client-side derived state (filtered rows, totals) needed to render the new UI.
7. Mobile transaction list/sheet (`MobileTransactionList.jsx`, `MobileTransactionSheet.jsx`)
   get only a light token/color consistency pass, not a structural redesign — the
   reference itself is desktop-first (`DESIGN.md` describes mobile as "dense ledger
   transforms into summary ledger cards", which is what already exists).

## 7. User stories

- As a Runly ledger user, I want the accounts list, account detail, and transaction
  register to look and feel like the rest of the Runly app (glass cards, brand colors,
  consistent spacing) so the module doesn't feel bolted-on.
- As a user reviewing a bank account's movements, I want a KPI summary (saldo, ingresos,
  egresos) above the register so I don't have to open the "Resumen" tab for a quick read.
- As a user with many movements, I want to search/filter the visible register by text,
  type, and category so I can find a specific movement quickly.
- As a user entering movements, I want the register to keep behaving like a spreadsheet
  (click a cell, type, Tab/Enter to the next cell, Escape to cancel) exactly as it does today.
- As a user managing shared accounts, I want a single obvious place to see and manage
  "Grupos" instead of two different screens that show the same list.

## 8. UX requirements

- All UI labels stay in Spanish, matching existing copy (`Cuentas`, `Grupos`, `Registro`,
  `Resumen`, `Acceso`, `Nueva cuenta`, `Nuevo movimiento`, etc.) — no new user-facing
  strings are translated from the English reference; Spanish equivalents already used
  elsewhere in the module are reused (e.g. "Filtrar por concepto, factura..." pattern
  already exists on `SpreadsheetRegister`'s search).
- Color usage is restricted to existing tokens: `--brand-primary`/`--brand-primary-hover`
  for primary actions and active states, `--color-success` for income/credit, existing
  `--color-destructive` for expense/debit, `hsl(var(--muted-foreground))` for secondary
  text, `Card`/`.glass*` classes for containers. No hex literals copied from
  `DESIGN.md`'s green/orange Material palette.
- Build every new piece of UI from existing `@runly/ui` exports first
  (`StatStrip`, `FilterBar`, `SearchInput`, `Badge`, `Card`, `PageHeader`, `Tabs`,
  `EmptyState`, `ErrorState`, `ConfirmDialog`, `Sheet`) per the CLAUDE.md UI-first policy.
  New one-off markup is only acceptable for the transaction grid itself (a native
  `<table>` of inputs/selects), which has no existing `@runly/ui` equivalent that
  supports cell-level inline editing.
- The transaction register must keep every current keyboard/interaction behavior
  unchanged: Tab-like Enter-to-next-cell, Ctrl+Enter to save row, Escape to discard row
  draft, Arrow Up/Down to move within the same column, blur-outside-row to auto-save,
  the always-present trailing "new row", and the mobile bottom-sheet fallback for
  narrow viewports.
- Loading states: keep the existing skeleton pattern (pulse blocks) in each screen;
  update their sizing/shape only if needed to match the new layout.
- Empty states: use `EmptyState` consistently (already used); no behavior change.
- Error states: use `ErrorState` consistently (already used); no behavior change.
- Dark mode must keep full contrast — verify manually in both themes since the reference
  screenshot is light-mode only and provides no dark-mode guidance.
- Responsive behavior: preserve the existing `sm:`/`hidden` breakpoints that already
  split desktop-table vs. mobile-card rendering in `DesktopTransactionTable.jsx` /
  `MobileTransactionList.jsx`.

## 9. Routes/screens

No routes change. All screens keep their existing paths (resolved via
`apps/desktop/src/app/module-screen-resolver.js`, unchanged).

| Route | Screen | Module | Description |
|---|---|---|---|
| /app/m/runly.ledger/accounts | AccountsScreen | runly.ledger | Visual facelift; "Grupos" tab removed, group badge added to account cards |
| /app/m/runly.ledger/accounts/:id | AccountScreen | runly.ledger | Header redesign (icon, badges, balance block, export segmented control) |
| /app/m/runly.ledger/accounts/:id (tab=Registro) | SpreadsheetRegister + DesktopTransactionTable | runly.ledger | KPI strip, filter strip, totals footer, Ragic-style grid facelift |
| /app/m/runly.ledger/accounts/:id (tab=Resumen) | AccountSummary | runly.ledger | Swap local `KpiCard` for `@runly/ui` `StatCard`; token color pass |
| /app/m/runly.ledger/groups | GroupsScreen | runly.ledger | Visual facelift; becomes the sole groups entry point |
| /app/m/runly.ledger/groups/:id | GroupScreen | runly.ledger | Visual facelift only |
| /app/m/runly.ledger/categories | CategoriesScreen | runly.ledger | Visual facelift (Card container, Badge for kind) |
| /app/m/runly.ledger/memberships | MembershipsScreen | runly.ledger | Visual facelift only |

## 10. Data model

N/A — no entity changes. All new UI state (search text, active type/category filter,
computed totals) is derived client-side from data already returned by existing endpoints.

### New models

N/A

### Modified models

N/A

## 11. Prisma impact

New models: N/A
Modified models: N/A
New migration required: No
Migration safety notes: N/A

## 12. API contract

N/A — no new or modified endpoints. The register continues to call the existing
`GET /ledger/accounts/:id/transactions` (via `useAccountTransactions`) and existing
mutation endpoints (via `useTransactionMutations`) unchanged. The new KPI strip on the
Registro tab reuses the existing `GET` backing `useAccountSummary` (already called by
the Resumen tab) instead of adding a new call.

## 13. SDK contract

N/A — no `@runly/sdk` changes (this module talks to the API via `companyFetch` +
`getApiUrl()` directly, as it already does; no SDK domain exists for ledger today and
none is introduced by this visual pass).

## 14. Validator contract

N/A — no new or modified Zod schemas. No request/response shapes change.

## 15. Module manifest impact

N/A — `runlyLedgerManifest` in `apps/api/src/manifests/official/core-modules.js` is not
modified: no new permissions, no dependency changes, no navigation changes.

## 16. Navigation impact

N/A — no navigation items are added, removed, or relabeled. The existing five items
(Cuentas, Grupos, Categorías, Tipos, Mis membresías) are unchanged, per the explicit
constraint that the app's navbar/sidebar must not be touched.

## 17. Blueprint impact

N/A — no blueprint changes. `TypesScreen.jsx`'s existing `RunlyCrudView` blueprints
(`ledger.types.table` / `.form` / `.detail`) are untouched.

## 18. RBAC/permissions

N/A — no permission keys are added, removed, or reguarded. Existing client-side gates
(`canEdit`, `canWrite`, `isOwner`, `myRole === 'admin'`, `isUsingLocalLedger`) keep
driving what actions render, unchanged in logic — only their visual presentation
(buttons, badges) changes.

## 19. Multi-company behavior

Unchanged. Every request continues to go through `companyFetch`, which already scopes
requests to the active company; this spec touches no request-building code paths, only
rendering.

## 20. Files/storage impact

N/A — no Supabase Storage interaction changes. Export (PDF/Excel/CSV) keeps using the
existing `GET /ledger/accounts/:id/export/:format` blob-download flow unchanged, just
regrouped visually into a segmented control.

## 21. Export/import requirements

No new export/import requirements. Existing PDF/Excel/CSV export and CSV import
(`Importar` button → `/accounts/:id/import`) keep their current behavior; only their
button grouping/styling on the account header changes (segmented control, matching the
reference's "Export Split Controls" pattern) — same three actions, same handlers.

## 22. Audit log requirements

N/A — no new mutating actions are introduced. Every existing mutation (create/update/
delete transaction, create/rename group, invite/remove member, edit account) already
goes through its existing API endpoint unchanged; whatever audit logging exists there
today is untouched.

## 23. Edge cases

1. Account with zero transactions: KPI strip and totals footer must render zeroed/empty
   gracefully (reuse `useAccountSummary`'s existing zero-state, already handled by
   `AccountSummary`'s `!hasData` branch pattern).
2. Offline / `isUsingLocalLedger`: the KPI strip's `useAccountSummary` call must respect
   the same offline/local-cache branching already implemented in `use-ledger-queries.js`
   (it already does — no query key/enabled logic changes needed); if the summary is
   unavailable offline, the KPI strip degrades to showing only locally-known fields
   (`account.current_balance`) rather than blocking the register.
3. Read-only accounts (`canWriteRegister === false`, shared viewer role): filter strip
   and KPI strip render normally; only the "Agregar"/inline-edit affordances stay hidden,
   exactly as `canEdit` already gates today.
4. Search/type/category filters must combine with the AND semantics and operate only on
   currently-loaded rows (post "Cargar anteriores"); filtering must not hide the
   always-present trailing "new row" or block "Cargar anteriores" from working.
5. Very long `nombre`/`concepto` values must truncate/wrap without breaking row height
   consistency in the grid (already handled by existing `<input>` cells; verify with the
   new tighter row styling).
6. USD vs. MXN currency formatting must keep using `toLocaleString('es-MX', { style:
   'currency', currency: account.currency })` exactly as today — no hardcoded "MXN"/"$".
7. Group-owned accounts hide the "Acceso" collaborator UI in favor of the existing
   "Pertenece a un grupo" notice (unchanged) — the new group badge on `AccountsScreen`
   cards must link to `/app/m/runly.ledger/groups/:groupId`, which requires exposing
   `group_id`/`group_name` from the accounts list response; confirm the field is already
   present on `useAccountList()` rows (`ledger-data-client.js`) before relying on it —
   if `group_name` isn't already returned, the badge falls back to a generic "En grupo"
   label with a link by `group_id` alone (no new API field is added; see Non-goal #1).
8. Dark mode contrast for the new success/destructive amount coloring and KPI strip must
   be verified manually (the reference is light-mode only).

## 24. Risks

1. Risk: Restyling `DesktopTransactionTable.jsx`'s cell markup could accidentally break
   the `data-row`/`data-col` selectors that `SpreadsheetRegister.jsx`'s `focusCell()`
   keyboard navigation depends on. Mitigation: keep every `data-row`/`data-col`/`aria-label`
   attribute exactly as-is; only change `className`/wrapping markup, never remove/rename
   the selector attributes touched by `handleKeyDown`/`focusCell`.
2. Risk: Removing the "Grupos" tab from `AccountsScreen.jsx` could strand users who
   relied on the tab muscle-memory. Mitigation: the sidebar's "Grupos" item is unchanged
   and remains one click away; the new group badge on account cards gives a second,
   more direct path into a specific group.
3. Risk: Introducing `useAccountSummary` into `SpreadsheetRegister`/`AccountScreen`'s
   Registro tab duplicates a network call already made when the user later opens
   "Resumen". Mitigation: React Query dedupes identical `queryKey`s
   (`['ledger-summary', accountId, dateFrom, dateTo, ...]`) automatically — switching tabs
   afterward is a cache hit, not a second fetch.
4. Risk: Client-side filtering only searches the currently-loaded page (`limit`), which
   could confuse users expecting a global search. Mitigation: documented as Non-goal #3
   and Future enhancement #1; the filter strip's helper text (row count) already
   distinguishes "loaded" vs. "total" (`rows.length === total ? ... : '${rows.length} de
   ${total}'`), kept and reused.
5. Risk: Introducing `StatStrip`/`FilterBar` into a file already near the 1000-line
   guardrail (`AccountScreen.jsx` at 634 lines, `GroupScreen.jsx` at 547 lines) could push
   them over. Mitigation: track line counts after each task in the plan; extract a
   sub-component if any touched file would exceed ~800 lines post-change (none are
   currently projected to, per the plan's estimates).

## 25. Acceptance criteria

1. Given the Cuentas screen, when it loads, then only two tabs are shown ("Mis cuentas",
   "Compartidas conmigo") — no "Grupos" tab.
2. Given an account that belongs to a group, when its card renders on the Cuentas screen,
   then a group badge is visible and clicking it navigates to
   `/app/m/runly.ledger/groups/:groupId`.
3. Given the sidebar's "Grupos" nav item, when clicked, then `GroupsScreen` still renders
   at the same route with the same create/rename/navigate-to-detail behavior as before,
   visually restyled.
4. Given an account detail screen's "Registro" tab, when it loads, then a KPI strip
   (saldo actual, ingresos, egresos for the active date range) renders above the register.
5. Given the register's filter strip, when the user types in the search box or picks a
   tipo/categoría filter, then only matching loaded rows render, the always-present new
   row stays visible, and clearing filters restores the full loaded set.
6. Given the register grid, when a user clicks a cell, types, and presses Enter, then
   focus moves to the next editable column in the same row exactly as before the redesign
   (no regression in `data-row`/`data-col` keyboard navigation).
7. Given the register grid with loaded rows, when rendered, then a totals footer row
   shows the sum of visible ingresos, egresos, and the latest saldo.
8. Given dark mode is active, when any redesigned ledger screen is viewed, then text/
   background contrast remains readable (manual check, no automated a11y regression).
9. Given the app's global top bar and left `AppShell` sidebar, when any ledger screen is
   viewed before and after this change, then their markup/behavior is byte-for-byte
   unchanged (verified by diff — no edits to `AppShell.jsx`, `ModuleSidebar.jsx`, or
   `core-modules.js`'s `runlyLedgerManifest.navigation`).

## 26. Verification plan

- `node --check <each modified .jsx/.js file>` — syntax check on every touched file.
- `pnpm lint` — ESLint guardrail (local-date-from-toISOString ban, etc.) passes on
  touched files.
- `node --test apps/desktop/src/modules/runly.ledger/lib/__tests__/` (if present) and any
  other existing ledger unit tests — confirm no regression (no new tests are required
  since no new business logic is introduced; existing tests must keep passing).
- Manual (`pnpm dev:frontend`, run in a browser):
  - Load Cuentas screen, confirm two tabs, confirm group badge navigation.
  - Open an account, confirm KPI strip + filter strip + totals footer on Registro.
  - Exercise keyboard navigation (Tab/Enter/Escape/Arrow keys) in the grid — confirm
    unchanged behavior.
  - Type in the search box / pick a tipo+categoría filter — confirm client-side filtering.
  - Switch to Resumen, Acceso tabs — confirm no regression.
  - Visit Grupos, grupo detail, Categorías, Mis membresías — confirm visual consistency
    and unchanged functionality (create/rename/invite/remove/leave flows all still work).
  - Toggle dark mode — confirm contrast on every touched screen.
  - Resize to a narrow/mobile viewport — confirm `MobileTransactionList`/
    `MobileTransactionSheet` still render and function.
- `git diff -- apps/desktop/src/shell apps/desktop/src/app/AppShell* packages/ui/src/components/AppShell.jsx packages/ui/src/components/ModuleSidebar.jsx apps/api/src/manifests/official/core-modules.js` — must show no changes (confirms Non-goal #2 / Goal #4).

## 27. Rollback plan

No migrations, no API/manifest changes — rollback is a plain `git revert` of the
frontend commit(s) touching `apps/desktop/src/modules/runly.ledger/**`. No data,
schema, or permission state is affected, so there is nothing to roll back beyond source
files.

## 28. Future enhancements

1. Server-side search/type/category/date filtering for the register (today: client-side
   over the loaded page only) — would need a new query-param contract on
   `GET /ledger/accounts/:id/transactions`.
2. True page-based pagination (page 1/2/3…N, like the reference mock) instead of the
   current "Cargar anteriores" incremental-load model — would need offset/cursor support
   on the same endpoint.
3. Reconciliation status badges ("Conciliado") on transaction rows — the reference shows
   these, but no `conciliado`/reconciliation field exists in the current transaction
   model; deferred until that data model work is scoped separately.
4. A dedicated `@runly/sdk` domain for `runly.ledger` (today it calls `companyFetch`
   directly) — orthogonal to this visual redesign, worth its own spec.
