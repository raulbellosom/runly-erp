# Builder automations — plan

Spec: `docs/superpowers/specs/2026-10-04-builder-automations-design.md`

- [x] **Task 1 — Contract.** `DOMAIN_EVENT_PAYLOADS` in
  `packages/module-engine/src/contracts.js`.
- [x] **Task 2 — Compiler.** `packages/module-compiler/src/automations.js`
  (validate, derive consumes/events), wire into `definition.js` (validate +
  normalize), `templates/manifest.js`, new `templates/automations.js`
  (runtime + events.js), hooks in `templates/routes.js`, `compiler.js`; export
  helpers from `browser.js`. Tests.
- [x] **Task 3 — Publish grants.** `module-builder-service.publishProject`
  `canGrant` + `services`/`pendingGrants`; builder route passes it.
- [x] **Task 4 — Builder UI.** `AutomationsTab.jsx`,
  `AutomationArgsEditor.jsx`, tab in `ModuleBuilderEditor.jsx`, publish dialog
  services list.
- [x] **Task 5 — Docs.** `docs/developers/` page for automations + regenerate.
- [x] **Task 6 — Verify.** Unit tests, lint, `pnpm build:web`, real E2E.

Verified: 2026-10-04 (node --test module-compiler + module-engine 251/251 incl. automations.test.js (validation, derived manifest, generated runtime imported and exercised); builder API tests 33/33; eslint clean; `pnpm build:web` OK after adding Vite aliases for @runly/module-engine/browser|contracts; real E2E `.e2e/automations-e2e.mjs` on a test API :4011 + worker: 11/11 (validate, publish grants 4 services, record create -> calendar event with origin, update "changed" -> notification only on real change, failing automation keeps the save and reports the error, fleet event -> contact once); UI smoke `.e2e/ui-automations.mjs` on Vite :5174: tab renders 4 cards desktop + 390px, no console errors. Test module uninstalled, purged and project deleted.)
