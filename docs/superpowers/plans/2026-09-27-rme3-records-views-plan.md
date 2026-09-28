# RME3 records views — implementation plan

Spec: `docs/superpowers/specs/2026-09-27-rme3-records-views-design.md`

1. [x] module-engine: kinds in `constants.js`, `records-view-schema.js`,
       hook into `define-view.js`, export from `index.js`; tests.
2. [x] module-compiler: `records-views.js` (normalize, schema-from-view,
       reference validation), wire into `definition.js`, template
       `templates/records-view.js`, `compiler.js` + manifest listing; tests.
3. [x] API: `module-records-view-query-service.js` (records + report),
       route in `routes/modules.js`, builder capabilities `viewKinds`; tests.
4. [x] SDK: `modules.queryRecordsView(key, payload, token)`.
5. [x] UI: renderers in `packages/ui/src/runly-renderer/`, export, document in
       `docs/ai-context/rme3-runtime-capabilities.md`.
6. [x] Desktop shell: route the four kinds in `BlueprintCrudScreen.jsx`.
7. [x] Builder: `addView`/`navigationTargets` for the new kinds, Vistas tab
       editors, preview renderers.
8. [x] Verification: `node --test` for touched packages, `pnpm lint`,
       `vite build`.

Verified: 2026-09-27 (node --test: module-engine 8 files / 120 pass incl.
records-view-schema; module-compiler archive + module-compiler +
records-views 16 pass; API records-view, kanban, dashboard query services and
module-builder-service 28 pass; desktop builderHelpers 3 pass; builder
addView -> JSON -> compileModule integration for all four kinds; `pnpm lint`;
`vite build`). Not yet verified: a real publish + install of a module with
these views and the runtime screens in a browser.
