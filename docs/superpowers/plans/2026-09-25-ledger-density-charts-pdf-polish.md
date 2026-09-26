# runly.ledger — Densidad, gráficas, compartir y PDF — Implementation Plan

Date: 2026-09-25
Spec: docs/superpowers/specs/2026-09-25-ledger-density-charts-pdf-polish-design.md
Status: Draft

> **For agentic workers:** Declare `Mode: IMPLEMENTATION` before starting. Do not begin coding until the spec is approved and this plan is approved. Use checkbox syntax (`- [ ]`) to track progress. Mark each task completed only after its validation commands pass.

Mode: PLAN
Spec: docs/superpowers/specs/2026-09-25-ledger-density-charts-pdf-polish-design.md
Plan: docs/superpowers/plans/2026-09-25-ledger-density-charts-pdf-polish.md

## Goal

Deliver every goal in the spec's §5: a shared, height-flexible step indicator for both ledger import wizards; a default-collapsed account header plus a merged date/search filter row on the register; a donut-chart geometry fix and theme-aware tooltip cursors on the Resumen tab, plus two new charts fed by an additive `by_month` field; a default member listing in the "Compartir" modal backed by an optional `q` on `GET /users/search`; and a PDF/Excel export pass that measures real row height (no more overlapping text), adds `account_number` next to the currency, and stamps a Runly product-mark watermark. No new Prisma models, no new permissions, no manifest/navigation changes (spec §§10-18 are Prisma/manifest/navigation N/A).

## Architecture summary

Pure frontend + two narrow backend touches, all inside `runly.ledger`'s existing files — no new routes, no new SDK domain, no new validators package changes beyond one existing schema. The two backend changes are additive/widening only: `summary-service.js` gains a `by_month` field alongside the existing `kpis`/`balance_series`/`by_category` (same query shape, one more aggregation), and `users-routes.js` + its Zod schema in `apps/api/src/routes/ledger/validators.js` make `q` optional instead of required, mirroring the precedented `createUserAccessService.listCandidates` pattern already used by `runly.notes` (spec §12, §28.2 — not merged, just following the same "optional search" shape). The new `ImportStepIndicator` shared component follows CLAUDE.md's UI-first/no-duplication rule: both `AiImportScreen.jsx` and `ImportWizard.jsx` currently hardcode near-identical `STEPS`/step-pill markup and fixed-pixel `max-h-*` review tables (spec §3, discovery), so the component is extracted once into `@runly/ui` and both screens adopt it, rather than patching the same bug twice. The PDF row-height fix keeps `export-service.js`'s existing page-break check (`y > page.height - margins.bottom - 30`) intact — it only changes what feeds `y`'s increment (measured height via `doc.heightOfString(...)` instead of a hardcoded `12`), so large exports keep paginating correctly (spec risk #1).

---

## File Structure Map

### Create

- `packages/ui/src/components/ImportStepIndicator.jsx`
- `apps/api/src/assets/runly-mark.png` (or `.svg` if pdfkit's vector support is preferred — decided in Task 10)

### Modify

- `packages/ui/src/index.js` — export `ImportStepIndicator`
- `docs/ai-context/rme3-runtime-capabilities.md` — document the new component
- `apps/desktop/src/modules/runly.ledger/screens/AiImportScreen.jsx` — adopt `ImportStepIndicator`, remove local `STEPS`/`StepIndicator`, un-cap the review table height
- `apps/desktop/src/modules/runly.ledger/screens/ImportWizard.jsx` — same adoption, remove local `STEPS`/step-pills, un-cap `max-h-40`/`max-h-64`
- `apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx` — default `headerCollapsed` based on transaction count; move date filters next to the register's search row; move tabs to their own row
- `apps/desktop/src/modules/runly.ledger/screens/SpreadsheetRegister.jsx` — receive/host the relocated date-range filters next to its existing `SearchInput`
- `apps/desktop/src/modules/runly.ledger/screens/AccountSummary.jsx` — donut geometry fix, `cursor` on all `Tooltip`s, new "Top categorías" + "Ingresos vs egresos por mes" sections
- `apps/api/src/routes/ledger/summary-service.js` — add `by_month` aggregation to `getAccountSummary`
- `packages/ui/src/components/UserSearchModal.jsx` — fetch and render a default member list when `query` is empty
- `apps/api/src/routes/users-routes.js` — make `q` optional, default-list branch
- `apps/api/src/routes/ledger/validators.js` — `userSearchQuerySchema`: `q` becomes `.optional()`
- `apps/api/src/routes/ledger/export-service.js` — measured row-height wrap in `buildPdfBuffer`; `account_number` in PDF subtitle and in `buildExcelBuffer`'s Resumen sheet
- `apps/api/src/services/pdf-branding-service.js` — load and draw the Runly isotipo watermark in `drawPdfFooter`

---

## Task 1 — Shared `ImportStepIndicator` component

**Files:**
- Create: `packages/ui/src/components/ImportStepIndicator.jsx`
- Modify: `packages/ui/src/index.js`
- Modify: `docs/ai-context/rme3-runtime-capabilities.md`

**Changes:**
- [ ] Extract the shape of `AiImportScreen.jsx`'s local `StepIndicator`/`STEPS` (lines 15-61) into a reusable `ImportStepIndicator({ steps, current })` component: `steps` is `{ key, label, icon }[]`, `current` is the active step key — same props shape the two screens already compute locally, just lifted out.
- [ ] Desktop layout (`sm:` and up): render as a narrow vertical rail (`w-56 shrink-0 flex flex-col gap-2`) instead of the current horizontal `flex-wrap` row of `min-w-48` cards.
- [ ] Mobile layout (below `sm:`): render as a single compact horizontal strip (icon + "Paso N" only, no full label block) so it doesn't consume width from the review table on narrow viewports (spec §23 edge case #7).
- [ ] Keep the existing done/active/pending visual states (checkmark vs number badge, brand-tinted active card) — same tokens (`--brand-primary`, `--brand-soft`, `hsl(var(--border))`) already used today, no new palette.
- [ ] Export from `packages/ui/src/index.js`.
- [ ] Add a row for `ImportStepIndicator` under the appropriate table in `docs/ai-context/rme3-runtime-capabilities.md` (per CLAUDE.md's "Adding a new reusable component" steps 1-3).

**Validation:**
```bash
npx eslint packages/ui/src/components/ImportStepIndicator.jsx packages/ui/src/index.js
```
Result: no errors/warnings.

---

## Task 2 — Un-cap `AiImportScreen.jsx`'s review table and adopt the shared stepper

**Files:**
- Modify: `apps/desktop/src/modules/runly.ledger/screens/AiImportScreen.jsx`

**Changes:**
- [ ] Remove the local `STEPS` array and `StepIndicator` function (lines 15-61); import `ImportStepIndicator` from `@runly/ui` instead, passing the same `STEPS`-shaped array inline or as a module-level const reused by the render.
- [ ] Restructure the screen's outer layout to `h-full flex` with `ImportStepIndicator` as a fixed-width sidebar (desktop) / top strip (mobile), and the step content (`flex-1 overflow-auto ...` at line 197) as the remaining flex child.
- [ ] Replace the review table's `max-h-112` (line 278, desktop) and `max-h-140` (line 365, mobile) with `flex-1 min-h-0` inside a `flex flex-col h-full` ancestor, so the table fills whatever vertical space the viewport actually has.
- [ ] Re-verify keyboard/row-editing handlers (`updateRow`, duplicate-row checkbox) are untouched — this task only changes container className/structure, not row logic.

**Validation:**
```bash
npx eslint apps/desktop/src/modules/runly.ledger/screens/AiImportScreen.jsx
wc -l apps/desktop/src/modules/runly.ledger/screens/AiImportScreen.jsx
```
Result: no lint errors; line count stays well under the 800-line proactive-split threshold.
Manual: `pnpm dev`, upload a statement, confirm the paso 2 table fills the window at several heights and the stepper reads correctly on a narrow (mobile-width) browser.

---

## Task 3 — Same fix on `ImportWizard.jsx` (manual CSV/XLSX import)

**Files:**
- Modify: `apps/desktop/src/modules/runly.ledger/screens/ImportWizard.jsx`

**Changes:**
- [ ] Remove the local `STEPS`/step-pill markup (around line 201); adopt `ImportStepIndicator` the same way as Task 2.
- [ ] Replace `max-h-40` (line 324) and `max-h-64` (line 336) with `flex-1 min-h-0` under a `flex flex-col h-full` ancestor.
- [ ] Confirm this screen's own row-editing/commit logic is untouched — layout-only change, mirroring Task 2's scope discipline.

**Validation:**
```bash
npx eslint apps/desktop/src/modules/runly.ledger/screens/ImportWizard.jsx
wc -l apps/desktop/src/modules/runly.ledger/screens/ImportWizard.jsx
```
Result: no lint errors; line count checked.
Manual: `pnpm dev`, run the manual CSV/XLSX import end to end, confirm layout parity with Task 2.

---

## Task 4 — `AccountScreen.jsx`: default-collapsed header + merged filter row

**Files:**
- Modify: `apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx`
- Modify: `apps/desktop/src/modules/runly.ledger/screens/SpreadsheetRegister.jsx`

**Changes:**
- [ ] In `AccountScreen.jsx`, initialize `headerCollapsed` based on the transaction count `SpreadsheetRegister` already loads for the active account (thread a `rowCount`/`onRowCountChange` callback or lift the count up, per spec §23 edge case #8 — no new query). Define the threshold (e.g. `> 20`) as a named constant near `TABS`. Recompute when `accountId` changes (effect keyed on `accountId`, not just mount) so switching accounts without a full reload re-evaluates the default.
- [ ] Remove the `Desde`/`Hasta` `DatePickerField` pair from the tabs row (lines 423-455, desktop; 460-488, mobile) and instead pass `dateFrom`/`dateTo`/`setDateFrom`/`setDateTo` down as props to `SpreadsheetRegister`.
- [ ] In `SpreadsheetRegister.jsx`, render the received date-range controls in the same row as the existing `SearchInput` (line ~197-201), reusing the exact same `DatePickerField`/clear-button markup being moved (no new component, no new styling decisions).
- [ ] Tabs (Registro/Resumen/Acceso) keep their own row, now without the date filters beside them.

**Validation:**
```bash
npx eslint apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx apps/desktop/src/modules/runly.ledger/screens/SpreadsheetRegister.jsx
wc -l apps/desktop/src/modules/runly.ledger/screens/AccountScreen.jsx
```
Result: no lint errors; line count checked against the 800/1000/1500 thresholds.
Manual: open an account with >20 movements and confirm the header starts collapsed; open one with fewer and confirm it starts expanded; confirm date filters now sit beside the search input at desktop width, and tabs are alone in their row.

---

## Task 5 — Backend: `by_month` in `GET /ledger/accounts/:id/summary`

**Files:**
- Modify: `apps/api/src/routes/ledger/summary-service.js`

**Changes:**
- [ ] Add a `byMonthRows` query alongside the existing `byCategoryRows` query, grouping by `date_trunc('month', fecha)` instead of category, within the same `dateFrom`/`dateTo` window, ordering chronologically by the truncated date (not the formatted string — spec §23 edge case #9).
- [ ] Map rows to `{ month: 'YYYY-MM', deposito: number, retiro: number }` and add as `by_month` in the returned object, alongside `kpis`/`balance_series`/`by_category` (purely additive — no existing key removed or renamed).

**Validation:**
```bash
node --check apps/api/src/routes/ledger/summary-service.js
```
Result: syntax check passes.
Manual: `GET /ledger/accounts/:id/summary` via the running dev API (browser devtools network tab while viewing the Resumen tab, or a local curl with a real session) and confirm `by_month` appears, sorted chronologically, for a date range spanning a year boundary.

---

## Task 6 — `AccountSummary.jsx`: donut fix, theme-aware cursors, two new charts

**Files:**
- Modify: `apps/desktop/src/modules/runly.ledger/screens/AccountSummary.jsx`

**Changes:**
- [ ] Fix the "Distribución" Pie's clipping: recompute `cy`/`outerRadius` (or reserve legend height explicitly, e.g. via a fixed `Legend` height subtracted from the container height before computing `cy`) so the ring never overlaps the legend or the card edge, including the single-slice case (spec §23 edge case #6).
- [ ] Add `cursor={{ fill: 'hsl(var(--muted) / 0.15)' }}` to the Bar chart's `<Tooltip>` (currently line 327) and a theme-aware line cursor (`stroke={C_BORDER}`) to the Area chart's `<Tooltip>` (currently line 231), removing Recharts' default gray/white cursor in both.
- [ ] Add a "Top categorías" `Section` (reusing the existing horizontal-bar pattern from "Por categoria"): sort `by_category` by `deposito + retiro` descending, take the top 5, fold the remainder into a synthetic "Otras" row — purely a frontend reshape of data already returned today, no new query.
- [ ] Add an "Ingresos vs egresos por mes" `Section`: grouped vertical bars (Ingreso/Egreso) keyed by the new `by_month` field from Task 5, `tickFormatter` reusing `fmtCompact`, x-axis labeled by month.
- [ ] Both new sections follow the existing `hasData`-gated rendering pattern (don't render, or show nothing extra, when their backing array is empty).

**Validation:**
```bash
npx eslint apps/desktop/src/modules/runly.ledger/screens/AccountSummary.jsx
```
Result: no lint errors.
Manual: `pnpm dev`, open Resumen in dark mode, confirm the donut is no longer clipped (including on an account with only one of Ingreso/Egreso present), confirm hover cursors on bar/area charts are theme-aware, and confirm "Top categorías" and "Ingresos vs egresos por mes" render with real data.

---

## Task 7 — Backend: `GET /users/search` accepts an absent `q`

**Files:**
- Modify: `apps/api/src/routes/ledger/validators.js`
- Modify: `apps/api/src/routes/users-routes.js`

**Changes:**
- [ ] `userSearchQuerySchema`: change `q` from required-min-2 to `.optional()` (still `.min(2)` when present); confirm `limit` keeps its existing default/clamp.
- [ ] `users-routes.js`: when `q` is absent, skip the `ILIKE` predicate entirely (list first `limit` — default 20 in this branch, per spec §12/§24 risk #2 — company members ordered by `display_name`, still excluding the actor and bots via the same `WHERE` clauses already in place); when `q` is present, keep today's exact query and its existing `limit`.
- [ ] Keep the `requirePermission('ledger.accounts.read')` guard unchanged.

**Validation:**
```bash
node --check apps/api/src/routes/users-routes.js apps/api/src/routes/ledger/validators.js
```
Result: syntax check passes.
Manual: call `GET /users/search` (no `q`) via the dev API and confirm it returns up to 20 company members instead of a 400; confirm `GET /users/search?q=a` still 400s (min 2 chars) and `?q=an` still searches as before.

---

## Task 8 — `UserSearchModal.jsx`: default member listing

**Files:**
- Modify: `packages/ui/src/components/UserSearchModal.jsx`

**Changes:**
- [ ] On open (and whenever `query` is empty), fire the same debounced fetch already used for search, but with no `q` query param, capped at `limit=20`, so the "no selection yet" results list (lines 75-99) is populated by default instead of only appearing once `query.length >= 2`.
- [ ] Preserve `excludeIds` filtering exactly as it works today (already applied client-side to `results`, line 41).
- [ ] Keep the existing empty-state copy ("No se encontraron usuarios.") for the case where the company has no other eligible users (spec §23 edge case #4).
- [ ] No change to the post-selection role picker (`SelectField` at lines 122-130) or the confirm/cancel footer.

**Validation:**
```bash
npx eslint packages/ui/src/components/UserSearchModal.jsx
```
Result: no lint errors.
Manual: open "Compartir" from the Acceso tab on an account whose company has ≥2 other members and confirm the default list appears immediately; confirm it still narrows correctly once text is typed; confirm a single-user company shows the "no encontrados" message instead of hanging.

---

## Task 9 — PDF: measured row-height wrap + `account_number` in header/Excel

**Files:**
- Modify: `apps/api/src/routes/ledger/export-service.js`

**Changes:**
- [ ] In `buildPdfBuffer`'s `drawRow`, replace the fixed `y += 12` with a measured height: compute `doc.heightOfString(text, { width: cols[i] - 4 })` for every cell in the row (with `lineBreak` enabled, dropping the current `lineBreak: false`), take the max across cells, and advance `y` by that value (plus the existing small padding).
- [ ] Move the existing page-break check (`if (y > doc.page.height - ...) { doc.addPage(); ... }`) so it evaluates using the row's *measured* height before drawing that row's text, not after — preventing a tall wrapped row from being split across the page boundary mid-row (spec §23 edge case #1).
- [ ] Change the header call's `subtitle` (currently `` `${account?.name ?? ''} — ${currency}` `` at line 174, and again in the mid-export `addPage` branch) to append `` — ${account.account_number}`` only when `account.account_number` is a non-empty string (spec §23 edge case #2).
- [ ] In `buildExcelBuffer`'s "Resumen" sheet (around line 104), add `summary.addRow(['Numero de cuenta', account?.account_number ?? ''])` next to the existing `Cuenta`/`Banco`/`Moneda` rows.

**Validation:**
```bash
node --check apps/api/src/routes/ledger/export-service.js
```
Result: syntax check passes.
Manual: export the PDF for an account containing a transaction with a `concepto` >150 characters; visually confirm the row wraps without overlapping the next row, confirm the page-break still triggers correctly for a large export (several hundred synthetic rows), confirm the subtitle shows `nombre — moneda — numero_de_cuenta`, and confirm the Excel "Resumen" sheet has the new row.

---

## Task 10 — PDF: Runly isotipo watermark

**Files:**
- Create: `apps/api/src/assets/runly-mark.png` (or `.svg`, decided during this task based on pdfkit's image support and file size)
- Modify: `apps/api/src/services/pdf-branding-service.js`

**Changes:**
- [ ] Add the static Runly product-mark asset under `apps/api/src/assets/` (distinct from the per-company `logoBuffer` already loaded from Supabase Storage — spec §20 draws this distinction explicitly; do not reuse `branding.logoBuffer` for this).
- [ ] Load it once at module init (cached in memory, not re-read per request) via a path resolved from `import.meta.url`.
- [ ] In `drawPdfFooter`, draw the mark at low opacity (`doc.opacity(0.08)`–`0.12`, restoring `doc.opacity(1)` afterward) centered in the footer area or as a page watermark — pick the placement that stays legible against the existing footer text/rule during the manual check in this task.
- [ ] Confirm the watermark renders even when `branding` is `EMPTY_BRANDING` (no per-company logo configured) — it must not depend on `branding.logoBuffer` (spec §23 edge case #3).

**Validation:**
```bash
node --check apps/api/src/services/pdf-branding-service.js
pnpm build
```
Result: syntax check passes; `pnpm build` confirms the asset resolves inside the built `apps/api` output, not only under `pnpm dev:api` (spec risk #4 — verify the file is actually present/reachable in the build output, not just working via a dev-time relative path).
Manual: export a PDF for a company with no branding configured and one with branding configured; confirm the Runly watermark appears in both, and that it doesn't visually collide with the existing "Hecho con Runly ERP" text or the page-number block.

---

## Rollback Notes

- No migrations are involved at any point in this plan — every task can be reverted independently with `git revert` of its commit(s).
- If aborted after Task 5 (`by_month` added) but before Task 6 consumes it: the API response simply carries an unused extra field; safe to leave in place or revert, no cleanup needed either way.
- If aborted after Task 7 (`q` optional) but before Task 8 uses it: `GET /users/search` behaves identically for every existing caller that always sends `q`; only a caller that omits `q` would notice, and none exists yet before Task 8 ships.
- If aborted mid-Task 9/10 (PDF changes): revert `export-service.js`/`pdf-branding-service.js` to restore the exact prior PDF output; no other task depends on these files.

---

## Verification Gate

Before marking any task complete in `docs/TASKS.md` (if this work is logged there):

- [ ] All task validation commands have been run.
- [ ] All commands exited without errors.
- [ ] Verification checklist at `docs/superpowers/templates/verification-checklist-template.md` has been filled in.
- [ ] Manual browser walkthrough of the spec's §25 acceptance criteria (all 11) has been performed — this plan's per-task "Manual" steps cover them individually, but a final end-to-end pass over the account used for the original screenshots ("Prueba") is the closing check before calling this Complete.
- [ ] `docs/TASKS.md` updated with `Verified: YYYY-MM-DD (commands executed)` if this work is tracked there as a phase/checklist entry.
