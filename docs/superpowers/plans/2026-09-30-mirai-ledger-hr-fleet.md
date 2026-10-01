# MirAI Ledger / HR / Fleet Implementation Plan

> Spec: `docs/superpowers/specs/2026-09-30-mirai-ledger-hr-fleet-design.md`. Per-module steps: identical to `docs/superpowers/plans/2026-09-30-mirai-remaining-modules.md` ("Per-module steps": Map, Effects, Queries, Actions, Capability, Tests, Frontend context, Help). Templates: `apps/api/src/routes/calendar/`, `routes/contacts/`, `routes/projects/` capability files.

**Rules:** JS only; UI Spanish, no emojis; files under 1000 lines; no git commits; never start/stop dev servers; tests with explicit globs; do NOT edit `apps/api/src/routes/chat/mirai-actions-wiring.js`, `chat/index.js` or `help/runly.chat/overview.md` (the coordinator wires) — report factory names + constructor args.

## Track A (ledger + shared attachment access)
- [ ] `apps/api/src/routes/chat/chat-attachment-access.js` per spec §2; refactor `read_attachment` and `describe_image` in `chat/mirai-tools.js` to use it (behavior identical; existing tests pass). Export the factory; `buildToolRunners` receives an `attachmentAccess` instance (default built from its existing deps so callers don't break).
- [ ] Ledger capability per spec §3 in `apps/api/src/routes/ledger/` (`ledger-mirai-queries.js`, `mirai-actions.js`, `mirai-capabilities.js` exporting `createLedgerMiraiCapabilities({ prisma, attachments })`). For `ledger.statement.import`, extract the recognize logic from `ai-import-routes.js` into a function both the route and the action call (route behavior unchanged); action execute calls the same `service.commit`.
- [ ] Remove core `list_bank_accounts` and `search_inventory` from `chat/mirai-tools.js` (TOOL_DEFS, runners, deps no longer needed, tests, prompt mentions in `chat/mirai-service.js`).
- [ ] Frontend: account detail screen publishes `useMiraiRecordContext({ recordType: "account", ... })`. Help: ledger overview examples.

## Track B (hr + fleet)
- [ ] HR capability per spec §4 (`apps/api/src/routes/hr/` — create the folder; HR service is `apps/api/src/services/hr-service.js`, routes `routes/hr-routes.js`) exporting `createHrMiraiCapabilities({ prisma })`. Mirror field restrictions from the HR routes exactly.
- [ ] Fleet capability per spec §5 in `apps/api/src/routes/fleet/` exporting `createFleetMiraiCapabilities({ prisma })` (with `publicLookup` + a `fleet_public_vehicle_info` tool using the shared public lookup like inventory/contacts do).
- [ ] Frontend context on employee detail and vehicle detail; help overviews.

## Verify (each track)
- [ ] `node --test` on touched module test dirs + `apps/api/src/routes/chat/__tests__/*.test.js`; `npx eslint` on touched dirs; `pnpm build:web` inside `apps/desktop` if frontend changed.
