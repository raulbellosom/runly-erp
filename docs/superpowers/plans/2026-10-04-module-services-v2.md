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

## Round 2 — ledger, fleet, pfm + phase 2 (spec §6)

- [x] **Task 5 — Contracts.** `number` arg type, 14 ledger/fleet/pfm
  contracts (`action` names the MirAI action), `system` flags,
  `IDEMPOTENCY_ARG`.
- [x] **Task 6 — Handlers.** `action-backed-services.js` (prepare/execute
  bridge + reads); calendar services now run `createCalendarEventEffects`.
- [x] **Task 7 — Gateway.** `forSystem`, idempotency through audit metadata,
  `describe()` exposes `system`; dispatcher passes `services` to handlers;
  worker builds `createModuleServices`.
- [x] **Task 8 — Events.** `calendar.event.created|updated|cancelled`,
  `files.file.created`, `fleet.vehicle.created|updated`.
- [x] **Task 9 — Docs + verify.**

Verified: 2026-10-04 (node --test module-services + module-engine + module-compiler + domain-events + calendar + fleet + files: 446/446; full apps/api suite 2284 pass / 3 fail — the 3 failures (createTasksService, atlas.growth manifest, storefront contract) fail identically with these changes stashed, so pre-existing; eslint clean on touched files; catalog builds 32 services with every MirAI action found. Not verified: real API/worker run against the database.)
