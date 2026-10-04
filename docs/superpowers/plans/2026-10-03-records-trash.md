# Desactivados — implementation plan

Spec: `docs/superpowers/specs/2026-10-03-records-trash-design.md`

1. **Registry + generic provider** — `apps/api/src/services/trash/{trash-errors,trash-registry,rme3-trash-provider,core-trash-providers}.js`; unit tests for label-column choice, SQL and 23503/P2003 mapping.
2. **Core providers** — inventory items (`inv_item`), contacts (`contact`, purge reuses the contact delete path so Connections restrict maps to 409), hr employees (`hr_employee`).
3. **Routes + permission + SDK** — `apps/api/src/routes/trash-routes.js` mounted in `index.js`; `core.records.purge` in `permission-catalog.js`; SDK `trash` domain.
4. **UI** — `apps/desktop/src/shell/trash/{TrashScreen.jsx,useTrashProviders.js}`; sidebar item injection in `RunlyApp.jsx`; route in `ModuleOutlet.jsx`.
5. **Docs + verification** — help page for runly.core, `docs/developers` note for Builder modules, TASKS; backend E2E + Playwright.
