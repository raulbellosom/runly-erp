# Conditional layout + independent detail — Implementation Plan

> Executed inline (superpowers:executing-plans). Spec: `docs/superpowers/specs/2026-09-28-rme3-builder-conditional-layout-design.md`

**Architecture:** rules live in `entity.layout`; compiler validates (`layout.js`), emits `visibleWhen` into form/detail schemas (`layout-views.js`), relaxes conditional required fields in validators and emits a per-entity visibility module used by generated routes. UI evaluates rules with one shared helper. Builder edits rules and the optional detail tree.

## Tasks

### Task 1 — Compiler contract
- [ ] Tests (`layout.test.js`): each `LAYOUT_RULE_*` code; `detail.tabs` validated + unplaced fields appended; valid rules pass.
- [ ] `layout.js`: `validateRule`, rule checks for tabs/sections/fieldRules, detail tree validation (refactor tree validation into `validateTree(tabs, path)`), `resolveEntityLayout(entity, 'form'|'detail')`, `conditionalRequiredFields(entity)`.

### Task 2 — Compiler emission + API checks
- [ ] Tests: form/detail schemas carry `tabs[].visibleWhen`, `sections[].visibleWhen`, field `visibleWhen`; detail uses `detail.tabs` when present; create validator makes conditional required optional; generated `<entity>-visibility.js` + routes return 400 on create/update when a visible required field is missing (in-process Hono test with fake service).
- [ ] `layout-views.js` emission; `validators.js` takes the conditional set; new `templates/visibility.js`; `routes.js` wires checks; `compiler.js` emits the file.

### Task 3 — Runtime UI
- [ ] Tests (`schema-tabs.test.js` / new `visibility-rules.test.js`): `matchesVisibilityRule`, `visibleTabs`, section filtering.
- [ ] `visibility-rules.js` (shared), RunlyDetail uses it; `resolveSchemaTabs` keeps `visibleWhen`; RunlyForm/RunlyDetail hide tabs/sections; form validation/payload skip hidden sections' fields; active tab fallback.

### Task 4 — Builder
- [ ] Tests (`layoutHelpers.test.js`): set/clear rule on tab/section/field, rule summary text, enable/disable independent detail tree, pruneLayout also cleans rules and detail tree.
- [ ] `layoutHelpers.js` ops; `RuleDialog.jsx`; LayoutTree menus + badges and `tree` prop (form/detail); LayoutDesignerSheet target switch + independent-detail switch; LayoutRealPreview test values strip.

### Task 5 — Verify + docs
- [ ] All suites, `pnpm build:web`, `pnpm lint`; update `rme3-runtime-capabilities.md` and `docs/TASKS.md`.
