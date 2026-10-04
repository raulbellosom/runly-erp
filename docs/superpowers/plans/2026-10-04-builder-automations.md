# Builder automations — plan

Spec: `docs/superpowers/specs/2026-10-04-builder-automations-design.md`

- [ ] **Task 1 — Contract.** `DOMAIN_EVENT_PAYLOADS` in
  `packages/module-engine/src/contracts.js`.
- [ ] **Task 2 — Compiler.** `packages/module-compiler/src/automations.js`
  (validate, derive consumes/events), wire into `definition.js` (validate +
  normalize), `templates/manifest.js`, new `templates/automations.js`
  (runtime + events.js), hooks in `templates/routes.js`, `compiler.js`; export
  helpers from `browser.js`. Tests.
- [ ] **Task 3 — Publish grants.** `module-builder-service.publishProject`
  `canGrant` + `services`/`pendingGrants`; builder route passes it.
- [ ] **Task 4 — Builder UI.** `AutomationsTab.jsx`,
  `AutomationArgsEditor.jsx`, tab in `ModuleBuilderEditor.jsx`, publish dialog
  services list.
- [ ] **Task 5 — Docs.** `docs/developers/` page for automations + regenerate.
- [ ] **Task 6 — Verify.** Unit tests, lint, `pnpm build:web`, real E2E.
