# MirAI PFM Capability Implementation Plan

> Execute in order; `- [ ]` steps. Spec: `docs/superpowers/specs/2026-09-30-mirai-pfm-capability-design.md`. Contract and example: `docs/ai-context/mirai-module-capabilities.md`, `apps/api/src/routes/calendar/mirai-capabilities.js`, `calendar-mirai-queries.js`, `mirai-actions.js` — mirror their shapes exactly.

**Rules:** JS only; UI Spanish, no emojis; files under 1000 lines; no git commits; never start/stop dev servers; run tests with explicit globs (`node --test dir/__tests__/*.test.js`).

## Task 1: PFM queries
- [ ] Create `apps/api/src/routes/pfm/pfm-mirai-queries.js` exporting `createPfmMiraiQueries({ prisma, summary, wallets, budgets, categories })` → 7 tools per spec §2 (tool shape `{ name, permission, definition: { description, parameters }, run(args, actx) }`; PFM ctx `{ companyId: actx.companyId, actorId: actx.actorProfileId }`).
- [ ] Readable wallet ids come from `wallets.listWallets(ctx)`; `pfm_search_movements` / `pfm_spending_summary` use `prisma.$queryRaw` over `pfm_movement m JOIN pfm_wallet w ON w.id = m.wallet_id LEFT JOIN pfm_category c ON c.id = m.category_id` with `m.company_id = $companyId`, `m.wallet_id = ANY($ids::uuid[])`, `m.enabled = true`, status filter (default `POSTED` for summaries), date range on `m.occurred_on`, grouping always including `w.currency`. Check real column/table names in `summary-service.js` / `movements-service.js` before writing SQL. Amounts returned as numbers rounded to 2 decimals.
- [ ] `compareWithPrevious`: previous range = same length ending the day before `from`; per group return `{ actual, anterior, diferencia, porcentaje }` (porcentaje null when anterior is 0).
- [ ] Dates: `from`/`to`/`occurredOn` are `YYYY-MM-DD`, `month` is `YYYY-MM`; use `toLocalIso`/`toLocalMonth` from `@runly/core` for defaults; no `toISOString().slice` on instants.

## Task 2: PFM actions + capability
- [ ] Create `apps/api/src/routes/pfm/mirai-actions.js` exporting `createPfmMiraiActions({ wallets, movements, categories })` with `pfm.movement.create|update|delete` per spec §2 (prepare never writes; resolve wallet/category names case-insensitively, ambiguous → error listing options; reject `wallet.ledgerAccountId` with "Esta cartera refleja una cuenta bancaria; registra el movimiento en Libro de cuentas."; validate with `createMovementSchema` / `updateMovementSchema` from `./validators.js`; update/delete load the movement with `movements.getOwnedMovement` and check `wallets.canWriteWallet`; preview fields in Spanish with amounts formatted `$1,234.50 MXN`-style using the wallet currency; execute returns `{ id, summary, link: "/app/m/runly.pfm" }`).
- [ ] Create `apps/api/src/routes/pfm/mirai-capabilities.js` exporting `createPfmMiraiCapabilities({ prisma })` that builds the PFM services it needs the same way `routes/pfm/index.js` does (`createWalletsService({ prisma, calendarBridge: createPfmCalendarBridge({ prisma }) })`, movements, summary, budgets, categories) and returns `{ moduleKey: "runly.pfm", label: "Finanzas personales", summary: "Carteras, movimientos, gasto por categoria, presupuestos y cargos proximos; registrar, editar y eliminar movimientos.", tools, actions, publicLookup: [], describeContext }` (wallet description per spec).
- [ ] Register it in `apps/api/src/routes/chat/mirai-actions-wiring.js` (one line next to calendar).
- [ ] Tests `apps/api/src/routes/pfm/__tests__/pfm-mirai.test.js` (fake services/prisma, per spec §4).

## Task 3: Remove the PFM assistant
- [ ] Backend: delete `routes/pfm/assistant-service.js`, `assistant-tools.js`, `assistant-routes.js` and any `__tests__` for them; update `routes/pfm/index.js`. In `permission-catalog.js` append " (obsoleto: usa MirAI)" to the `pfm.assistant.use` description; leave `core-modules.js` as is.
- [ ] Frontend: `ModuleOutlet.jsx` drops the `runly.pfm` wrapper and the lazy import; delete `PfmAssistantSidebar.jsx`, `AssistantMessageList.jsx`, `AssistantActionCard.jsx` after `grep` confirms no other importers; remove `"runly.pfm"` from `HIDDEN_MODULES` in `apps/desktop/src/modules/runly.chat/lib/miraiPageContext.js` and update its test; remove the `pfm.assistant` block from `packages/sdk/src/index.js`.
- [ ] `WalletDetailScreen.jsx`: `useMiraiRecordContext({ recordType: "wallet", recordId: wallet?.id, label: wallet?.name })` (import from `../../runly.chat/lib/miraiPageContext.js`).
- [ ] Help: `apps/api/src/manifests/official/help/runly.pfm/` overview — replace any mention of the PFM assistant sidebar with MirAI examples from spec §5; add PFM to "Disponible hoy" in `runly.chat/overview.md`.

## Task 4: Verify
- [ ] `node --test apps/api/src/routes/pfm/__tests__/*.test.js apps/api/src/routes/chat/__tests__/*.test.js apps/api/src/routes/calendar/__tests__/*.test.js apps/desktop/src/modules/runly.chat/lib/__tests__/*.test.js` → all pass.
- [ ] `npx eslint apps/api/src/routes/pfm apps/api/src/routes/chat apps/desktop/src/modules/runly.pfm apps/desktop/src/app apps/desktop/src/modules/runly.chat packages/sdk/src` → no errors; `pnpm build:web` inside `apps/desktop` → ok.
- [ ] `grep -rn "pfm/assistant\|PfmAssistantSidebar\|assistant-tools" apps packages --include=*.js --include=*.jsx` → no hits outside deleted files.
