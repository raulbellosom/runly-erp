# Rediseño visual de runly.ledger — Implementation Plan

Date: 2026-09-23
Spec: docs/superpowers/specs/2026-09-23-ledger-ui-redesign-design.md
Status: Complete — see Verification Gate for what was actually run

Mode: IMPLEMENTATION
Spec: docs/superpowers/specs/2026-09-23-ledger-ui-redesign-design.md
Plan: docs/superpowers/plans/2026-09-23-ledger-ui-redesign.md

> Commissioned directly by the user with explicit instruction to proceed through spec,
> plan, and implementation without further check-ins ("no me preguntes solo haslo
> completamente"). That instruction is this plan's approval gate.

## Goal

Give every `runly.ledger` content screen (Cuentas, cuenta detail, transaction register,
Grupos, grupo detail, Categorías, Mis membresías) a visual facelift that matches Runly's
existing brand system (glass cards, flame/navy tokens, `@runly/ui` primitives), give the
transaction register a KPI strip + filter strip + totals footer while preserving its
exact spreadsheet keyboard-editing behavior, and resolve the "Grupos" duplication between
`AccountsScreen`'s tab and the sidebar's dedicated `GroupsScreen`. No backend, manifest,
navigation, or permission changes (spec sections 10–22 are all N/A).

## Architecture summary

Pure frontend visual/structural pass over existing screens in
`apps/desktop/src/modules/runly.ledger/`. No new files are strictly required — every
change fits inside existing files, well under the 1000-line soft limit (see per-task line
estimates below). Reused `@runly/ui` building blocks: `StatStrip` (KPI row), `FilterBar` +
`SearchInput` (register filter strip), `Badge` (group badge, category/kind chips), `Card`
(container surfaces), existing `PageHeader`/`Tabs`/`EmptyState`/`ErrorState`/`ConfirmDialog`/
`Sheet` (already in use, kept). The transaction grid stays a native `<table>` of
inputs/selects (no `@runly/ui` equivalent supports cell-level inline editing) — only its
`className`s change; every `data-row`/`data-col`/`aria-label` selector that
`SpreadsheetRegister.jsx`'s keyboard-nav logic depends on is preserved verbatim (spec risk #1).

The register's new KPI strip reuses the existing `useAccountSummary` hook (already used by
`AccountSummary.jsx`) — React Query dedupes the identical `queryKey` when the user later
opens the "Resumen" tab, so no extra network cost in practice (spec risk #3).

The "Grupos" duplication is resolved by deleting the third tab from `AccountsScreen.jsx`
(down to "Mis cuentas" / "Compartidas conmigo") and adding a group badge to account cards
that already belong to a group, using the `group_id` already present on each account row
(`SELECT a.*` in `ledger-service.js`) matched against `AccountsScreen`'s already-fetched
`groupsData` (`/ledger/groups`) to resolve the display name — no API change needed.

---

## File Structure Map

### Create

(none — every change fits in existing files)

### Modify

- `apps/desktop/src/modules/runly.ledger/screens/AccountsScreen.jsx` — remove "Grupos" tab; restyle account cards with `Card`/`Badge`; add group badge+link on grouped accounts
- `apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx` — header redesign (icon avatar, badge strip, balance block, segmented export control), tab bar restyle
- `apps/desktop/src/modules/runly.ledger/screens/AccountSummary.jsx` — replace local `KpiCard` with `@runly/ui` `StatCard`; move chart accent colors to CSS tokens
- `apps/desktop/src/modules/runly.ledger/screens/SpreadsheetRegister.jsx` — add KPI strip (`useAccountSummary`), filter strip (`SearchInput` + `FilterBar` for tipo/categoría, client-side), restyle toolbar/footer
- `apps/desktop/src/modules/runly.ledger/components/DesktopTransactionTable.jsx` — Ragic-style visual facelift (sticky header, zebra/hover, colored tabular amounts, totals footer row); zero changes to `data-row`/`data-col`/`aria-label`/keyboard handlers
- `apps/desktop/src/modules/runly.ledger/components/MobileTransactionList.jsx` — token/color consistency pass only
- `apps/desktop/src/modules/runly.ledger/screens/GroupsScreen.jsx` — visual facelift (Card-based group grid, PageHeader consistency)
- `apps/desktop/src/modules/runly.ledger/screens/GroupScreen.jsx` — visual facelift only (tabs, cards, Badge for roles)
- `apps/desktop/src/modules/runly.ledger/screens/MembershipsScreen.jsx` — visual facelift only
- `apps/desktop/src/modules/runly.ledger/screens/CategoriesScreen.jsx` — visual facelift (Card container instead of raw table wrapper, Badge for kind/system)

---

## Task 1 — Resolve the "Grupos" duplication on AccountsScreen

**Files:**
- Modify: `apps/desktop/src/modules/runly.ledger/screens/AccountsScreen.jsx`

**Changes:**
- [x] Remove `'groups'` from the `TABS` array (keep `own`, `shared`); drop the `effectiveTab === 'groups'` render branch and its "Nuevo grupo" action-button branch in `PageHeader actions`.
- [x] Keep `groupsData` query (still needed to resolve group names for badges) but stop rendering it as a tab.
- [x] In `AccountGrid`, when `account.group_id` is set, resolve `groupsData.data.find(g => g.id === account.group_id)` and render a small `Badge` (e.g. `<Badge variant="secondary">` with a `FolderOpen` icon + group name) that navigates to `/app/m/runly.ledger/groups/${account.group_id}` on click (`stopPropagation` so it doesn't also trigger the card's own `onSelect`). Fallback label "En grupo" if the id isn't found in the loaded list (e.g. shared/member-only view).
- [x] Restyle account cards to use `Card` (`variant="interactive"`) instead of the raw `border border-[hsl(var(--border))]` div, keeping every existing click/edit/keyboard handler.
- [x] Removed the dead `newGrpOpen`/`renameGroup` dialog state, handlers, and markup entirely — they were only reachable from the removed tab's action button and empty state.

**Validation:**
```bash
npx eslint apps/desktop/src/modules/runly.ledger/screens/AccountsScreen.jsx
```
Result: 2026-09-23 — no errors/warnings. (`node --check` doesn't support `.jsx`; eslint was used instead, which also parses JSX and catches unused vars/undefined refs.)
Manual browser walkthrough: NOT performed — see plan Verification Gate for why.

---

## Task 2 — Restyle GroupsScreen, GroupScreen, MembershipsScreen

**Files:**
- Modify: `apps/desktop/src/modules/runly.ledger/screens/GroupsScreen.jsx`
- Modify: `apps/desktop/src/modules/runly.ledger/screens/GroupScreen.jsx`
- Modify: `apps/desktop/src/modules/runly.ledger/screens/MembershipsScreen.jsx`

**Changes:**
- [x] `GroupsScreen.jsx`: swap the raw bordered-div grid for `Card` (`variant="interactive"`) tiles; keep `FolderOpen` icon, role label, member/account counts, create-group `Dialog` untouched functionally.
- [x] `GroupScreen.jsx`: restyle the `cuentas`/`miembros` tab strip using the same tab visual language as `AccountScreen.jsx` (Task 3) for consistency; restyle account/member list rows as `Card`; replace bare `capitalize` role text with `Badge` (`admin`/`editor`/`viewer` → variant mapping, e.g. admin=default, editor=secondary, viewer=outline).
- [x] `MembershipsScreen.jsx`: restyle group/account rows as `Card`; keep `ConfirmDialog` "Salir" flows unchanged.
- [x] No functional/handler changes in any of the three files — only markup/className and, where noted, swapping a bare `<div>` row for `Card`/`Badge`.

**Validation:**
```bash
npx eslint apps/desktop/src/modules/runly.ledger/screens/GroupsScreen.jsx apps/desktop/src/modules/runly.ledger/screens/GroupScreen.jsx apps/desktop/src/modules/runly.ledger/screens/MembershipsScreen.jsx
```
Result: 2026-09-23 — no errors/warnings.
Manual browser walkthrough: NOT performed — see plan Verification Gate for why.

---

## Task 3 — Redesign AccountScreen header

**Files:**
- Modify: `apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx`

**Changes:**
- [x] Add a small rounded icon avatar (Landmark icon in a `bg-[hsl(var(--muted))]`/brand-tinted square) beside the `PageHeader` title, matching the reference's "Rich Account Header Card" icon treatment — using existing tokens, not the reference's literal colors.
- [x] Render a badge strip under the title: bank name, masked account number (`•••• 1234` — reuse the last 4 chars of `account.account_number` if present), currency — using `Badge variant="secondary"`/`outline`. Do not fabricate data not present on `account` (no fake "Ledger Engine" or sync-time badges, per spec §8/§23).
- [x] Move the large balance display (`account.current_balance`) into its own right-aligned block with a small "Saldo actual" label above it, reusing the existing `fmtCurrency` helper — replaced with `text-(--brand-primary)` (the real brand token) for both-theme correctness.
- [x] Group the four export/import buttons (PDF/Excel/CSV/Importar) into a single segmented control (rounded container, `Button variant="ghost"` items) instead of four separate outline buttons — same `handleExport`/`navigate` handlers, no behavior change.
- [x] Keep the `Pencil`/"Editar" action, the Registro/Resumen/Acceso tab strip (restyle only), and the date-range filters exactly where they are.
- [x] Line count re-checked: 657 lines (was 634), comfortably under the 800-line proactive-split threshold.

**Validation:**
```bash
npx eslint apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx
wc -l apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx
```
Result: 2026-09-23 — no lint errors; 657 lines.
Manual browser walkthrough: NOT performed — see plan Verification Gate for why.

---

## Task 4 — KPI strip + filter strip + totals footer on the register

**Files:**
- Modify: `apps/desktop/src/modules/runly.ledger/screens/SpreadsheetRegister.jsx`
- Modify: `apps/desktop/src/modules/runly.ledger/components/DesktopTransactionTable.jsx`

**Changes:**
- [x] `SpreadsheetRegister.jsx`: calls `useAccountSummary(accountId, { dateFrom, dateTo })` and renders a `StatStrip` above the toolbar with 3 items: Saldo actual, Ingresos, Egresos (from `kpis.current_balance`/`total_deposito`/`total_retiro`), formatted with a local `fmtCurrency` helper. `currency` is now a prop, threaded from `AccountScreen` (`account?.currency ?? "MXN"`).
- [x] Added a filter strip row using `SearchInput` (free-text over `nombre`/`concepto`/`referencia`/`numero`, case-insensitive) + `FilterBar` with `tipo`/`categoria` filters (each only shown when its options list is non-empty).
- [x] Chose the CSS-hide approach explicitly called out as the safe fallback: `visibleRowIds` (a `Set` of matching row ids) is computed via `useMemo` and passed to `DesktopTransactionTable`, which adds a `hidden` class per non-matching `<tr>` — `rows` and every `rowIdx` stay exactly as before, so `data-row` and the `focusCell`/`handleKeyDown` math are untouched. `MobileTransactionList` (no index-based keyboard nav) safely receives a real filtered `visibleRows` array instead.
- [x] `FilterBar`'s built-in "Limpiar filtros" is used; the toolbar's "Agregar" buttons, the trailing new-row, and "Cargar anteriores" are all outside the filtered/hidden rows and stay visible regardless of filter state. Added a "Sin movimientos que coincidan con los filtros." note when a filter yields zero matches.
- [x] `DesktopTransactionTable.jsx`: sticky `<thead>` restyled (uppercase tracked, `bg-[hsl(var(--muted))]`); zebra (`odd:bg-[hsl(var(--muted)/0.12)]`) + hover; Ingreso/Egreso/Saldo columns right-aligned with `tabular-nums`; deposito/retiro inputs get conditional `text-success`/`text-destructive` (the actual Tailwind v4 `@theme` utility classes generated from `styles.css`'s `--color-success`/`--color-destructive` — NOT the `text-[hsl(var(--color-success))]` form originally sketched in this plan, which would double-wrap an already-`hsl()`-valued token); added a `<tfoot>` totals row summing the *visible* Ingreso/Egreso and showing the last row's Saldo. Every `data-row`/`data-col`/`aria-label`/`onChange`/`onKeyDown`/`disabled` prop is untouched — verified by diff review.
- [x] `MobileTransactionList.jsx`: swapped `text-emerald-600`/`text-rose-600` for `text-success`/`text-destructive`.

**Validation:**
```bash
npx eslint apps/desktop/src/modules/runly.ledger/screens/SpreadsheetRegister.jsx apps/desktop/src/modules/runly.ledger/components/DesktopTransactionTable.jsx apps/desktop/src/modules/runly.ledger/components/MobileTransactionList.jsx
wc -l apps/desktop/src/modules/runly.ledger/screens/SpreadsheetRegister.jsx apps/desktop/src/modules/runly.ledger/components/DesktopTransactionTable.jsx
```
Result: 2026-09-23 — no lint errors; SpreadsheetRegister.jsx 308 lines, DesktopTransactionTable.jsx 381 lines. `pnpm --filter @runly/desktop dev:web` build (`vite build`) also compiled this screen's chunk (`AccountScreen-*.js`) with zero errors.

Manual keyboard-nav/filter walkthrough (the highest-risk item per spec risk #1): **NOT performed** — no browser-automation tool was available in this session (no `mcp__Claude_Browser__*`/`mcp__claude-in-chrome__*`/computer-use tools were loaded), and the app requires an authenticated session against the team's live self-hosted Supabase instance with no test credentials available to this session. What *was* done instead: the API and web dev servers were started and confirmed to boot cleanly (`Runly API running on http://localhost:4010`, Vite ready on `:5173`, both stopped after the check), and every `data-row`/`data-col`/`aria-label`/handler prop in `DesktopTransactionTable.jsx` was diff-reviewed line by line against the pre-redesign version to confirm none were altered. This is static/structural confidence, not a substitute for actually pressing the keys — recommend the user (or a session with browser/computer-use access) runs through the Task 4 manual checklist below before treating the keyboard-nav behavior as fully confirmed:
- Click a cell, type, press Enter → focus moves to next editable column.
- Ctrl+Enter → row saves. Escape → row draft discards. Arrow Up/Down → same-column adjacent row.
- Blur the row (click outside) → row auto-saves if dirty.
- Type in the new search box / pick a tipo or categoría filter → matching rows filter, new-row and "Cargar anteriores" stay visible.
- Clear filters → all loaded rows return.
- Totals footer sums match a manual spot-check against the visible rows.

---

## Task 5 — AccountSummary: adopt @runly/ui StatCard, token colors

**Files:**
- Modify: `apps/desktop/src/modules/runly.ledger/screens/AccountSummary.jsx`

**Changes:**
- [x] Confirmed `StatCard.jsx` has no per-item accent-color prop, so kept a thin local `KpiCard` wrapper around `@runly/ui`'s `StatCard` (passes `label`/`icon`, and `value` as a colored `<span>` for the semantic income/expense/brand tint) instead of reinventing the card chrome. `Section`'s outer container was also switched from a raw bordered `<div>` to `@runly/ui`'s `Card`.
- [x] Replaced the hardcoded hex constants with the real CSS custom properties: `C_INCOME = 'var(--color-success)'`, `C_EXPENSE = 'var(--color-destructive)'`, `C_BALANCE = 'var(--brand-primary-computed, var(--brand-primary))'` — **not** wrapped in an extra `hsl(...)`, since `--color-success`/`--color-destructive` are themselves already full `hsl(...)` values in `styles.css`'s `@theme` block (double-wrapping would have produced invalid CSS). Also fixed the pie chart's center-label hardcoded `#15803d`/`#e11d48` to reuse `C_INCOME`/`C_EXPENSE`.
- [x] No layout/chart-structure changes — same three chart sections (área de saldo, distribución, por categoría).

**Validation:**
```bash
npx eslint apps/desktop/src/modules/runly.ledger/screens/AccountSummary.jsx
```
Result: 2026-09-23 — no lint errors; 331 lines (was 340).
Manual browser walkthrough (chart colors in light/dark mode): NOT performed — see plan Verification Gate for why.

---

## Task 6 — CategoriesScreen visual consistency pass

**Files:**
- Modify: `apps/desktop/src/modules/runly.ledger/screens/CategoriesScreen.jsx`

**Changes:**
- [x] Wrapped the existing `<table>` in a `Card` container (`variant="solid"`, `p-0 overflow-hidden`) instead of a bare `rounded-xl border` div.
- [x] Added a `Badge` for the `kind` column (Ingreso/Egreso/Ambos) via a `KIND_BADGE_VARIANT` map (`income→success`, `expense→destructive`, `both→secondary`); the existing "Sistema" badge usage was left as-is.
- [x] No changes to the create/edit `Dialog`, `ConfirmDialog` deactivate flow, or `react-hook-form`/Zod validation.

**Validation:**
```bash
npx eslint apps/desktop/src/modules/runly.ledger/screens/CategoriesScreen.jsx
```
Result: 2026-09-23 — no lint errors.
Manual browser walkthrough: NOT performed — see plan Verification Gate for why.

---

## Task 7 — Full-module verification pass

**Files:** none (verification only)

**Changes:**
- [x] Ran `npx eslint` across every touched file individually and across the whole `apps/desktop/src/modules/runly.ledger` directory — zero errors/warnings in all cases.
- [x] Ran a production `vite build` (`apps/desktop`) — succeeded in 4.96s with every ledger screen's chunk compiling (e.g. `AccountScreen-*.js`), confirming valid JSX/imports app-wide, not just in the touched files. Build output (`dist/`) was deleted afterward — not committed.
- [x] Ran the existing ledger unit test (`node --test apps/desktop/src/modules/runly.ledger/lib/__tests__/ledger-data-client.test.js` — the directory-glob form of `node --test` doesn't resolve on this Windows Node build, unrelated to this change) — both existing tests pass.
- [x] Ran `git diff --stat` against `AppShell.jsx`/`ModuleSidebar.jsx`/`apps/desktop/src/app/ModuleOutlet.jsx`/`apps/desktop/src/shell` and `core-modules.js` — zero lines changed in any of them by this work (the one line that *does* show in `core-modules.js` is a pre-existing, unrelated in-progress change from before this session — a `identity.users.sessions.read` permission for a different feature — confirmed by reading its diff).
- [ ] Manually ran through spec §25's 9 acceptance criteria in a real browser (light/dark mode, desktop + narrow viewport): **NOT performed.** No browser-automation tool (`mcp__Claude_Browser__*` / `mcp__claude-in-chrome__*` / computer-use) was available in this session, and the app requires an authenticated session against the team's live self-hosted Supabase instance, which this session has no credentials for. The API (`pnpm dev:api`) and web (`pnpm dev:frontend`) dev servers were started and confirmed to boot without errors, then stopped — that only confirms the app *starts*, not that the redesigned screens render/behave correctly.

**Validation:**
```bash
npx eslint apps/desktop/src/modules/runly.ledger
node --test apps/desktop/src/modules/runly.ledger/lib/__tests__/ledger-data-client.test.js
git diff --stat -- apps/desktop/src/shell apps/desktop/src/app/ModuleOutlet.jsx apps/api/src/manifests/official/core-modules.js packages/ui/src/components/AppShell.jsx packages/ui/src/components/ModuleSidebar.jsx
cd apps/desktop && npx vite build   # then rm -rf dist
```
Result 2026-09-23: lint clean, tests pass (2/2), build succeeds, diff confirms no global-chrome changes from this work. **Not** independently confirmed: actual rendered appearance and interactive/keyboard behavior in a live, authenticated browser session.

---

## Rollback Notes

- Every task only touches files under `apps/desktop/src/modules/runly.ledger/`. If aborted
  at any point, `git checkout -- apps/desktop/src/modules/runly.ledger/` (or a targeted
  per-file revert) fully restores prior behavior — no migrations, no generated client, no
  seed data to unwind.
- No task depends on a prior task's runtime state (each screen file is independently
  revertible), so a partial rollback (e.g. keep Task 1–2, revert Task 4) is safe.

---

## Verification Gate

- [x] All task validation commands have been run.
- [x] All commands exited without errors.
- [ ] Every acceptance criterion in spec §25 manually confirmed — **not done in this session** (see Task 7: no browser-automation tool available, no test credentials for the live Supabase-backed dev environment). Recommend the user click through the Task 4 checklist and spec §25 in `pnpm dev` before treating this as fully done, especially the register's keyboard navigation (highest-risk item, spec risk #1).
- [x] `git diff --stat` confirms zero changes outside `apps/desktop/src/modules/runly.ledger/**` (plus this spec/plan pair under `docs/superpowers/`) — the one unrelated line in `core-modules.js` predates this session (identity user-sessions work in progress).

---

## Round 2 — feedback-driven amendment (same session, 2026-09-23)

User feedback after Round 1: "las pestañas demás como las principales se miran iguales, no veo casi cambios en el diseño" — the hand-rolled underline tab strips (Cuentas' Mis cuentas/Compartidas, AccountScreen's Registro/Resumen/Acceso, GroupScreen's Cuentas/Miembros) kept the *exact same visual language* as before (a border-bottom on a plain button), just with a different active color — so at a glance nothing looked different. The secondary screens (Grupos/Categorías/Mis membresías) also only got a light `Card`/`Badge` touch-up in Round 1, not the bolder header/KPI treatment `AccountScreen`/`SpreadsheetRegister` got. Follow-up questioning confirmed the user wants this visible everywhere, not just Cuentas/Registro.

Round 2 changes (same files, no new ones, no scope outside `runly.ledger`):

- **Every hand-rolled tab strip replaced with `@runly/ui`'s actual `Tabs`/`TabsList`/`TabsTrigger`** (Radix-based, controlled via `value`/`onValueChange`) — the real glass/pill active-state component already used elsewhere in the app (e.g. `PosSettingsScreen.jsx`), not a repainted copy of the old underline pattern. Applied to: `AccountsScreen.jsx` (Mis cuentas/Compartidas), `AccountScreen.jsx` (Registro/Resumen/Acceso, each tab now carries an icon), `GroupScreen.jsx` (Cuentas/Miembros, with icons).
- **`StatStrip` KPI rows added to every list/detail screen that didn't already have one**: `AccountsScreen.jsx` (cuentas propias/compartidas/grupos counts), `GroupsScreen.jsx` (grupos/miembros totales/cuentas en grupos), `GroupScreen.jsx` (miembros/cuentas), `MembershipsScreen.jsx` (grupos/cuentas compartidas), `CategoriesScreen.jsx` (total/ingreso/egreso/ambos counts).
- **`AccountsScreen.jsx`**: added a client-side search box (name/bank/account number) next to the tabs; account cards got a real icon avatar, larger tabular balance, and masked account number — matching the same card language `GroupScreen.jsx`'s account cards and `AccountScreen.jsx`'s header now share.
- **`GroupScreen.jsx`**: header rebuilt as a hero (icon avatar in title, role badge as description) via `PageHeader`'s `onBack`, matching `AccountScreen.jsx`'s pattern instead of a hand-rolled back-link button.
- **`AccountScreen.jsx`**: the "Acceso" tab (previously almost unchanged from Round 1) rebuilt — group-membership notice and each collaborator row now render as `Card`s with an avatar-initial circle and a role `Badge`, instead of plain bordered `<div>`s.
- **`AccountSummary.jsx`**: each chart `Section` now carries an icon in a brand-tinted chip, for the same visual language as the rest of the module.
- **`MembershipsScreen.jsx`**: group/account rows got icon avatars matching the other list screens.

**Validation (2026-09-23):** `npx eslint apps/desktop/src/modules/runly.ledger` — clean. `cd apps/desktop && npx vite build` — succeeded (5.16s), `dist/` deleted after. No new files, no changes outside `apps/desktop/src/modules/runly.ledger/**`. Manual browser walkthrough: still not performed, same environment constraint as Round 1 — unchanged recommendation to the user above.

---

## Round 3 — feedback-driven amendment (same session, 2026-09-23)

User feedback after Round 2 (with screenshots comparing the running app to the reference, plus a fuller reference export the user had not originally shared — `cuentas_bancarias`, `detalle_de_cuenta_registro` [identical to the Round 1 reference, byte-for-byte — confirmed via `md5sum`], `detalle_de_cuenta_resumen`, `importar_con_ia`, `precision_ledger`/`DESIGN.md`):

1. Search inputs were capped at `max-w-xs` (20rem) everywhere, reading as tiny on a wide desktop viewport.
2. Account cards "feel very empty on large screens" / need more design (`AccountsScreen.jsx`'s cards were still a single flat icon + name + balance).
3. Header/cards should match the density of the attached reference image.
4. `AiImportScreen.jsx` ("Importar con IA") had not been touched at all, and the new reference includes a full redesign of it.

**Important scoping note:** the new `cuentas_bancarias` and `detalle_de_cuenta_resumen` references include numeric fields with no backing data model — investment/cash-box account "types", TIR/plazo, a reconciliation ("Conciliado"/"Predeterminada") status, AI category-confidence percentages, month-over-month trend percentages, and a cross-account "Últimos movimientos sincronizados" feed. None of these fields exist on `ledger_account` (confirmed by reading `prisma/migrations/20260528130000_add_ledger_tables/migration.sql` — `ledger_account` has only `name`/`bank`/`account_number`/`currency`/`opening_balance`/`enabled`) or on the AI-import service's response shape (confirmed by reading `apps/api/src/routes/ledger/ai-import-service.js` — `recognize()` returns only `detectedAccount`/`candidateAccounts`/`existingTransactions`, no confidence scores or category suggestions). Per spec §8/§23 ("do not fabricate data not present on `account`") and Non-goal #1 (no API changes), this round intentionally does **not** reproduce those specific fields — it reproduces the *density and polish*, grounded in real fields only. This is a judgment call, not a spec deviation requiring a separate decision log, since it's a direct application of an existing spec constraint.

Round 3 changes:

- **New shared component** `components/AccountCard.jsx` (+ `lib/account-visuals.js` helper): a richer account tile — deterministic per-bank-name colored icon avatar (hash-based, not random, so the same bank always gets the same color — pure presentation, not fabricated data), split integer/decimal balance typography, uppercase "Saldo actual" label, a `DropdownMenu` ("⋮") for per-card actions instead of a hover-only pencil icon. Takes an `actions` array so callers plug in their own actions (`AccountsScreen.jsx` → "Editar cuenta", `GroupScreen.jsx` → "Quitar del grupo", destructive-styled) instead of forking the component. Replaces both screens' previous near-duplicate inline card markup.
- **`AccountsScreen.jsx`**: search input now flexes to fill available width (`flex-1`) instead of `max-w-xs`; added `ViewModeSwitch` (`@runly/ui`, persisted via `localStorage`) so users can switch between the card grid and a dense table/list view — directly answers "cards feel empty on large screens" by giving a real, width-efficient alternative rather than just enlarging cards further; `StatStrip` now leads with a real "Saldo total" figure (summed **per currency**, never mixing MXN/USD into one misleading number, via the new `splitCurrency` helper).
- **`SpreadsheetRegister.jsx`**: same search-width fix (`flex-1 max-w-md`).
- **`AiImportScreen.jsx`** (previously untouched) — full pass: a real 3-step indicator (Cargar archivo → Revisión y mapeo → Confirmar e importar, driven by actual upload/review/commit state, not decorative), the stats row converted to `StatStrip`, "Cuenta destino" wrapped in a `Card` with an icon avatar, the review table restyled to the same Ragic sticky-header/zebra/`text-success`/`text-destructive` language as the main register, "Nuevo"/"Posible duplicado" badges gained icons, and the confirm button became a sticky bottom summary bar (real included-count and real deposit/withdrawal totals — both already computed client-side — plus a "Descartar todo" reset action) instead of a single right-aligned button.

**Validation (2026-09-23):** `npx eslint apps/desktop/src/modules/runly.ledger` — clean (including the two new files). `cd apps/desktop && npx vite build` — succeeded (5.17s), `dist/` deleted after. `wc -l` on every touched/created file — all comfortably under the 800-line proactive-split threshold (largest: `AccountScreen.jsx` at 681, `GroupScreen.jsx` at 553, `AccountsScreen.jsx` at 527, `AiImportScreen.jsx` at 446). `git status --short` outside `apps/desktop/src/modules/runly.ledger/**` and `docs/superpowers/**` — unchanged from before this round (same pre-existing, unrelated files). Manual browser walkthrough: still not performed, same environment constraint as Rounds 1–2.

---

## Round 4 — feedback-driven amendment (same session, 2026-09-23)

User feedback after Round 3 (with two more screenshots of the running app, light mode): icons in the KPI strip read as "muy pequeños" (too small); cards need "mucho mas color" and felt "muy simplonas"/empty on large screens; wanted less-rounded corners; buttons (the export segmented control specifically) had no visible hover feedback; wanted the account header collapsible to save space; wanted the "Resumen" tab to carry more design; wanted the in-account "Importar" action to offer both AI and CSV import with matching polish; and reiterated that the external account cards need more real information density.

Round 4 changes:

- **New `components/LedgerStatCard.jsx`** (`LedgerStatCard` + `LedgerStatStrip`): replaces every `@runly/ui` `StatStrip` usage across the module (`AccountsScreen.jsx`, `SpreadsheetRegister.jsx`, `GroupsScreen.jsx`, `GroupScreen.jsx`, `MembershipsScreen.jsx`, `CategoriesScreen.jsx`, `AiImportScreen.jsx`, and `AccountSummary.jsx`'s `KpiCard` wrapper). Bigger icons (22px in a colored chip vs. the generic component's ~14px), a colored left accent bar, `rounded-xl` instead of `rounded-2xl`, and a `tone` prop (`brand`/`success`/`destructive`/`amber`/`violet`/`neutral`) so each KPI strip now uses a *different* color per item instead of one flat gray — directly answers "más color"/"iconos muy pequeños". Real numbers only — `tone` is presentation, not new data.
- **Root cause of the invisible button hover**: `AccountScreen.jsx`'s export segmented control put `variant="ghost"` buttons (whose own hover is `hover:bg-[hsl(var(--muted))]`) inside a `bg-[hsl(var(--muted))]` container — same color on top of itself, so the hover state was firing but invisible. Fixed with an explicit `hover:bg-[hsl(var(--card))] hover:text-(--brand-primary) hover:shadow-sm` override.
- **`AccountScreen.jsx`**: added a collapse/expand toggle (chevron button next to "Editar") that hides the badge strip + export-actions row to save vertical space, leaving title/balance/tabs visible — a real, working feature, not decorative.
- **`components/AccountCard.jsx`**: now fetches the account's real current-month ingresos/egresos via the existing `useAccountSummary` hook (same one the Resumen tab uses — React Query caches/shares it) and renders a 2-column mini-stat row, matching the reference's density without inventing figures. Table/list view passes `showMonthlyStats={false}` to skip the extra per-row request there. Cards also gained a colored left accent bar (`border-l-4`, color keyed to the same per-bank hash as the icon avatar) and `rounded-xl`.
- **Import unification**: `AccountScreen.jsx`'s "Importar" button is now a `DropdownMenu` offering "Importar con IA" or "Importar CSV manual" instead of jumping straight to the CSV wizard. Choosing AI import navigates to `AiImportScreen.jsx` with `{ state: { accountId, accountName } }` (React Router navigation state — no route/manifest change); `AiImportScreen.jsx` reads that to pre-select the account, label it "Cuenta preseleccionada", and send the user back to that account (not the generic accounts list) on back/cancel.
- **`ImportWizard.jsx`** (the CSV wizard, previously unrestyled) — brought to the same visual language: pill step indicator (replacing the inline `style={{...}}` circles), `LedgerStatStrip` for the valid/error row counts, the preview table restyled to the sticky-header/zebra/`text-success`/`text-destructive` pattern, error list in a `Card`.
- Applied `rounded-xl` consistently across the module's remaining `Card` usages (member/group rows, group tiles, Acceso-tab cards, Resumen sections) that were still on the default `rounded-2xl`, per "tal vez no tan redondas".

**Validation (2026-09-23):** `npx eslint apps/desktop/src/modules/runly.ledger` — clean. `cd apps/desktop && npx vite build` — succeeded (4.90s), `dist/` deleted after. `wc -l` — all files still comfortably under 800 (largest: `AccountScreen.jsx` 713, `GroupScreen.jsx` 554, `AccountsScreen.jsx` 528). `git status --short` outside the module/docs — unchanged (29 pre-existing unrelated files, same as before this round). Manual browser walkthrough: still not performed, same environment constraint as Rounds 1–3 — in particular, the per-card `useAccountSummary` calls in `AccountCard.jsx` (Round 4's biggest behavioral addition) have not been watched fire in a real network tab.
