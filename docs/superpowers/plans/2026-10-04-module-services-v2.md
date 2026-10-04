# Module Services v2 — plan

Spec: `docs/superpowers/specs/2026-10-04-module-services-v2-design.md`

- [x] **Task 1 — Shared contract.** `packages/module-engine/src/contracts.js`:
  `SERVICE_CONTRACTS` (existing 7 + 11 new), `SERVICE_KEYS` derived,
  `validateServiceArgs`. Expose `serviceContracts` in
  `packages/module-compiler/src/contracts.js` `RME3_CAPABILITIES`. Tests in
  `packages/module-engine/src/__tests__/service-contracts.test.js`.
- [x] **Task 2 — Gateway + handlers.** `module-services.js` validates args (422
  `invalid_args`), passes `moduleKey`/`activeContext`, audit metadata;
  `service-catalog.js` takes labels/permissions from the contract and adds the
  calendar, files, notifications and update handlers (task company check,
  calendar `own` scope). `index.js` passes `filesService`. Extend
  `module-services.test.js`.
- [x] **Task 3 — Docs.** `docs/developers/servicios-y-eventos.md` (service
  table, update semantics, origin, `own` scope, 422), regenerate ZIP docs with
  `node scripts/generate-module-developer-docs.mjs`.
- [x] **Task 4 — Verify.** `node --test` (module-engine, module-services,
  module-compiler), `pnpm lint`, API boot via existing dev server `/health`.

Verified: 2026-10-04 (node --test module-services + module-engine + module-compiler: 252/252 pass; eslint clean on touched files; service catalog imports with 18 handlers matching SERVICE_KEYS. Not verified: real API boot and calls against a running API — dev server on 4010 was down and is not started by agents.)
