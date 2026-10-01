# MirAI Remaining Modules Implementation Plan

> Spec: `docs/superpowers/specs/2026-09-30-mirai-remaining-modules-design.md`. Contract: `docs/ai-context/mirai-module-capabilities.md`. Templates: `apps/api/src/routes/calendar/` (`mirai-capabilities.js`, `calendar-mirai-queries.js`, `mirai-actions.js`, `calendar-event-effects.js`) and the matching tests in `__tests__/`.

**Rules:** JS only; UI Spanish, no emojis; files under 1000 lines; no git commits; never start/stop dev servers; tests with explicit globs; do NOT edit `apps/api/src/routes/chat/mirai-actions-wiring.js` or `help/runly.chat/overview.md` (the coordinator registers capabilities and updates the chat help) — report your capability factory name and its constructor arguments instead.

Two parallel tracks; each module follows the same steps.

## Per-module steps (M = module)

- [ ] **Map** — read M's HTTP routes for the entities in spec §3: service functions called, permission keys, side effects after the service call. Write the mapping as a short comment block at the top of `routes/M/mirai-actions.js`.
- [ ] **Effects** — if side effects are inline in routes, extract to `routes/M/M-effects.js` (calendar pattern, `actorContext` from `routes/calendar/calendar-event-effects.js` for non-HTTP calls) and make routes call it; run M's existing route tests → pass.
- [ ] **Queries** — `routes/M/M-mirai-queries.js`: tools per spec §3 (tool shape `{ name, permission, definition: { description, parameters }, run(args, actx) }`, names prefixed `M_`), exact aggregates, `total` + max 30 rows with ids.
- [ ] **Actions** — `routes/M/mirai-actions.js`: actions per spec §3 (prepare never writes; resolve names → ids, ambiguous → error listing options; preview fields Spanish with before/after on updates; delete actions are `operation: "delete"`; execute calls service + effects and returns `{ id, summary, link? }`).
- [ ] **Capability** — `routes/M/mirai-capabilities.js` exporting `createXMiraiCapabilities(deps)` with `moduleKey`, `label`, `summary`, `tools`, `actions`, `publicLookup`, `describeContext`.
- [ ] **Tests** — `routes/M/__tests__/M-mirai.test.js` per spec §4.
- [ ] **Frontend context** — M's detail screen(s) call `useMiraiRecordContext({ recordType, recordId, label })` from `apps/desktop/src/modules/runly.chat/lib/miraiPageContext.js`.
- [ ] **Help** — M's help `overview.md` (under `apps/api/src/manifests/official/help/<moduleKey>/`, only if it exists) gets 3-4 MirAI examples.

## Track A: runly.projects, runly.notes
Also: remove core `list_my_tasks` (TOOL_DEFS + runner + test names + prompt mentions in `mirai-service.js`) after the projects capability exists.

## Track B: runly.contacts, runly.purchases
Contacts service lives in `apps/api/src/services/contacts-service.js` / `services/contacts/` and routes in `routes/contacts-routes.js`; purchases services in `apps/api/src/services/purchase*.js` (reuse `purchases-assistant-context.js`) and routes in `routes/purchases/`. Module folders for the new files: `apps/api/src/routes/contacts/` (create) and `apps/api/src/routes/purchases/`.

## Verify (each track)
- [ ] `node --test` on the module test dirs touched + `apps/api/src/routes/chat/__tests__/*.test.js`.
- [ ] `npx eslint` on touched dirs; `pnpm build:web` inside `apps/desktop` if frontend files changed.
