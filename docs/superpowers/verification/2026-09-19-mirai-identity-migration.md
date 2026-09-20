# Verification — MirAI identity migration

Date: 2026-09-19
Spec: [MirAI identity migration](../specs/2026-09-19-mirai-identity-migration-design.md)
Plan: [Implementation plan](../plans/2026-09-19-mirai-identity-migration.md)
Status: Implementation verified; shared-database deployment pending explicit confirmation.

## Build and automated checks

- [x] `pnpm db:generate`: exit 0, Prisma Client 7.8.0 regenerated.
- [x] JavaScript syntax checks: seed, SDK, renamed backend files, frontend helpers and hooks passed.
- [x] `pnpm lint`: exit 0.
- [x] `pnpm --filter @runly/desktop build:web`: exit 0; shared wordmark and renamed JSX compile.
- [x] `pnpm build`: exit 0; native Windows executable, MSI and NSIS installers produced.
- [x] Chat suite: `node --test apps/api/src/routes/chat/__tests__/*.test.js` — 331 passed.
- [x] Services suite: `node --test apps/api/src/services/__tests__/*.test.js` — 488 passed, 2 skipped, no failures.
- [x] Frontend helpers: `node --test apps/desktop/src/modules/runly.chat/lib/__tests__/*.test.js` — 71 passed.
- [x] SDK smoke check: all five `chat.mirai` methods use the expected paths, encoded IDs, auth headers, methods and payload; no network requests.
- [x] `npx -y react-doctor@latest . --verbose --diff`: exit 0, score 70/100, no errors. Eight warnings concern existing function complexity, sequential awaits and `transition-all`; no unrelated refactor included.

Verified: 2026-09-19 (commands above). Vite validates `.jsx`; stock Node `--check` does not accept that extension. Explicit `*.test.js` patterns are used for Windows Node test discovery. Web build reports existing large-chunk warnings.

Nine pre-existing chat assertions and one associated fixture expected `/app/m/atlas.*` although production already returned `/app/m/runly.*`. These expectations were corrected without changing production routes or stored `atlas.*` permission/module identities.

## Migration and persisted identity

- [x] Isolated PostgreSQL 18 integration: `scripts/__tests__/mirai-migration.test.js` — 5 passed, no skipped tests or failures.
- [x] Existing user/bot IDs, memberships, conversations, message content, audit rows and panel history survive unchanged except for intended identity fields.
- [x] Permission IDs and both role/user grants survive the in-place key rename.
- [x] Applying the migration twice and running the actual bot-provisioning seed block twice does not duplicate records.
- [x] Both legacy profile schemas, with and without `company_id`, pass.
- [x] Unique-index predicates, index column ordering, foreign keys, cascade behavior, RLS policies and SQL grants survive.
- [x] Table/index/constraint names are renamed, including PostgreSQL 18 named `NOT NULL` constraints.
- [x] An injected failure rolls back earlier schema/data changes. Coexisting old/new permission keys fail explicitly before modifying data, preserving grants for reconciliation.
- [x] Disposable container removed after tests; no shared database connection, credentials or `.env` used.

Verified: 2026-09-19 (20.28-second integration run, 5/5 passed; test-file ESLint passed).

Reproduce in PowerShell:

```powershell
$env:RUN_MIRAI_MIGRATION_TEST = '1'
node --test scripts/__tests__/mirai-migration.test.js
Remove-Item Env:RUN_MIRAI_MIGRATION_TEST
```

The test creates its own `postgres:18-alpine` container without networking, published ports or host database volumes. It does not load the real database URL.

## UI and deployment checks

- [x] Isolated Chromium visual check of chat/inventory labels, light/dark and desktop/mobile.
- [ ] Explicit confirmation to apply migration to shared Supabase.
- [ ] Shared `pnpm db:migrate` completed.
- [ ] Shared `pnpm db:seed` and before/after counts confirm no duplicated bots or permission rows.
- [ ] Existing pre-migration conversation opens with full history in the deployed application.
- [ ] Live assistant identifies itself as “MirAI, tu asistente inteligente de Runly” in chat and inventory.
- [ ] Real `.env` and deployed secrets updated from `CHAT_MERIDIAN_*` to `CHAT_MIRAI_*` by the environment owner.

The identity instruction is present in all four chat prompts and the inventory prompt. Provider calls and shared-database checks remain pending deployment; automated fixtures do not claim to verify the live environment.

Verified: 2026-09-19 (Chromium, real `MirAIIntro`, `AssistantWordmark` and `InventoryAssistantHost`; 1280×850 and 390×844, light/dark, eight screenshots). The name renders continuously as MirAI in two colors; desktop hover and mobile Sheet heading remain legible. No browser errors, external requests or horizontal overflow. Authentication/company/operational dependencies were mocked; this checks visual rendering, not live integration. Temporary server and harness were removed. Local evidence: `<TEMP>/runly-mirai-visual-7WYn4w/report.json` and the eight sibling PNG files.

## Documentation and scope

- [x] Plan records completed implementation tasks and pending deployment tasks separately.
- [x] Shared `AssistantWordmark` exported and listed in the UI component inventory.
- [x] Active SDK, application code, `.env.example` and inventory documentation use MirAI.
- [x] Historical specifications, applied migrations, `docs/TASKS.md`, frozen source audit and Jaguar edition history preserved.

Verified: 2026-09-19 (repository reference sweep and Git diff). Old tokens intentionally remain in the forward migration and its integration fixtures, current design/plan/verification documents, historical records and the unrelated edition-name history.

`docs/TASKS.md` was explicitly excluded by the approved plan, so this dedicated checklist provides the verification record without modifying that file.
