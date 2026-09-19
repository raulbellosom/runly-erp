# MirAI Identity Migration — Implementation Plan

Date: 2026-09-19
Spec: docs/superpowers/specs/2026-09-19-mirai-identity-migration-design.md
Status: Implementation verified; shared-database deployment pending

> **For agentic workers:** Declare `Mode: IMPLEMENTATION` before starting. Do not begin coding until the spec is approved and this plan is approved. Use checkbox syntax (`- [ ]`) to track progress. Mark each task completed only after its validation commands pass.

## Goal

Rename the AI assistant from Meridian/MeridIAn to MirAI across `runly.chat` and `runly.inventory`, including every internal identifier (files, functions, components, hooks, constants, permission key, env vars, table/column names), while preserving all existing persisted data (chat history, per-company bot profiles, role grants, existing "Meridian" conversations) with zero duplication and zero access regression. Matches spec sections 5 (Goals) and 8 (UX requirements), including the two-tone "Mir"/"AI" wordmark treatment.

## Architecture summary

Backend-first, outside-in: the DB data/schema migration (Task 1) and permission-key rename (Task 2) land first since everything else depends on their final names being correct. Then the service/route layer (Task 3), its tests (Task 4), the SDK (Task 5), frontend lib/hooks (Task 6), a new shared two-tone wordmark component (Task 7), frontend components (Task 8), and finally env vars/docs (Task 9). Each task is independently testable and independently revertible via `git revert`, per spec section 27 (Rollback plan). Historical docs (`docs/superpowers/specs/2026-09-07-chat-meridian-*`, `docs/superpowers/plans/2026-09-07-chat-meridian-*`, `docs/TASKS.md`, `docs/migrations/runly-module-keys-source-audit.json`, all four applied `20260907*_chat_meridian_*` migrations) are explicitly out of scope for every task below — confirmed during discovery that `docs/TASKS.md`'s only two "Meridian" mentions are about a *different*, already-dead "Meridian Edition" marketing label (unrelated to the assistant, removed from live UI back on 2026-09-13) and are append-only historical changelog entries that this repo's convention never rewrites.

---

## File Structure Map

### Create

- `prisma/migrations/20260919130000_chat_mirai_rename/migration.sql`
- `packages/ui/src/components/AssistantWordmark.jsx`
- `scripts/__tests__/mirai-migration.test.js` — isolated PostgreSQL regression verification.
- `docs/superpowers/verification/2026-09-19-mirai-identity-migration.md` — actual verification results.

### Rename (git mv) + Modify

Backend:
- `apps/api/src/routes/chat/meridian-service.js` → `mirai-service.js`
- `apps/api/src/routes/chat/meridian-tools.js` → `mirai-tools.js`
- `apps/api/src/routes/chat/meridian-routes.js` → `mirai-routes.js`
- `apps/api/src/routes/chat/meridian-conversation-guard.js` → `mirai-conversation-guard.js`
- `apps/api/src/routes/chat/__tests__/meridian-service.test.js` → `mirai-service.test.js`
- `apps/api/src/routes/chat/__tests__/meridian-tools.test.js` → `mirai-tools.test.js`
- `apps/api/src/routes/chat/__tests__/meridian-module-tools.test.js` → `mirai-module-tools.test.js`
- `apps/api/src/routes/chat/__tests__/meridian-routes.test.js` → `mirai-routes.test.js`
- `apps/api/src/routes/chat/__tests__/meridian-routing.test.js` → `mirai-routing.test.js`
- `apps/api/src/routes/chat/__tests__/meridian-panel.test.js` → `mirai-panel.test.js`
- `apps/api/src/routes/chat/__tests__/meridian-guard.test.js` → `mirai-guard.test.js`
- `apps/api/src/routes/chat/__tests__/meridian-mention.test.js` → `mirai-mention.test.js`
- `apps/api/src/routes/chat/__tests__/meridian-mount-scope.test.js` → `mirai-mount-scope.test.js`

Frontend:
- `apps/desktop/src/modules/runly.chat/lib/meridian.js` → `mirai.js`
- `apps/desktop/src/modules/runly.chat/lib/__tests__/meridian.test.js` → `mirai.test.js`
- `apps/desktop/src/modules/runly.chat/hooks/useMeridian.js` → `useMirAI.js`
- `apps/desktop/src/modules/runly.chat/hooks/useMeridianPanel.js` → `useMirAIPanel.js`
- `apps/desktop/src/modules/runly.chat/components/MeridianPanel.jsx` → `MirAIPanel.jsx`
- `apps/desktop/src/modules/runly.chat/components/MeridianIntro.jsx` → `MirAIIntro.jsx`

### Modify only (no rename)

Backend:
- `apps/api/src/index.js`
- `apps/api/src/services/vision-service.js`
- `apps/api/src/services/inventory-assistant-service.js`
- `apps/api/src/services/__tests__/inventory-assistant-service.test.js`
- `apps/api/src/routes/chat/index.js`
- `apps/api/src/routes/chat/chat-service.js`
- `apps/api/src/routes/chat/chat-conversation-reads-service.js`
- `apps/api/src/routes/chat/chat-conversations-write-service.js`
- `apps/api/src/routes/chat/__tests__/chat-service.test.js`
- `apps/api/src/routes/chat/__tests__/chat-tenant.test.js`
- `apps/api/src/routes/chat/__tests__/chat-conversation-pin-hide.test.js`
- `apps/api/src/services/__tests__/permission-grants.test.js`
- `apps/api/src/permission-catalog.js`
- `apps/api/src/manifests/official/feature-modules.js`
- `prisma/schema.prisma`
- `prisma/seed.js`

SDK:
- `packages/sdk/src/domains/chat.js`

Frontend:
- `packages/ui/src/index.js`
- `apps/desktop/src/modules/runly.chat/screens/ChatScreen.jsx`
- `apps/desktop/src/modules/runly.chat/components/ChatWindow.jsx`
- `apps/desktop/src/modules/runly.chat/components/ChatHeader.jsx`
- `apps/desktop/src/modules/runly.chat/components/ChatMessageList.jsx`
- `apps/desktop/src/modules/runly.chat/components/ChatMessageBubble.jsx`
- `apps/desktop/src/modules/runly.chat/components/ChatConversationItem.jsx`
- `apps/desktop/src/modules/runly.chat/components/MessageComposer.jsx`
- `apps/desktop/src/modules/runly.chat/components/AssistantMarkdown.jsx`
- `apps/desktop/src/modules/runly.chat/lib/messageActions.jsx`
- `apps/desktop/src/modules/runly.chat/hooks/useMentionCandidates.js`
- `apps/desktop/src/modules/runly.chat/hooks/useChatWindowData.js`
- `apps/desktop/src/modules/runly.inventory/components/InventoryAssistant.jsx`
- `apps/desktop/src/modules/runly.identity/components/PermissionFeatureTree.jsx`

Docs/config:
- `.env.example`
- `CLAUDE.md`
- `docs/ai-context/inventory-ai.md`

### Explicitly out of scope (do not touch)

- `docs/superpowers/specs/2026-09-07-chat-meridian-*.md`, `docs/superpowers/plans/2026-09-07-chat-meridian-*.md` — historical record.
- `prisma/migrations/20260907010000_chat_meridian/`, `.../20260907020000_chat_meridian_conv_unique/`, `.../20260907030000_chat_meridian_route/`, `.../20260907040000_chat_meridian_surface/`, `.../20260907050000_chat_meridian_panel/` — applied, immutable.
- `docs/TASKS.md` — append-only changelog; its two "Meridian" mentions are the unrelated, already-dead "Meridian Edition" marketing label (see `apps/desktop/src/lib/appConfig.js`'s `RUNLY_EDITION_NAME`, now `"Jaguar"`), not the assistant.
- `docs/migrations/runly-module-keys-source-audit.json` — frozen point-in-time audit snapshot from an unrelated prior migration.
- `apps/desktop/src/lib/appConfig.js` — same reason as `docs/TASKS.md`; do not touch.
- Any other `docs/superpowers/plans/2026-09-*.md` file that mentions "Meridian" only in passing while documenting a different feature (e.g. `runly-brand-assets.md`, `runly-catalog-default.md`, `runly-packages-devkit.md`, `runly-visible-branding.md`, `atlas-calls-recording-a-api.md`, `multi-tenant-plan-3-schema-identity.md`, `mobile-layout-and-chat-batch.md`, `per-user-permission-grants-plan-b-ui.md`, `chat-bugfix-batch.md`, `external-chat-feature-parity.md`) — historical record of other work.

---

## Task 1 — Database migration: rename tables, permission key, conversation type, bot profile

**Files:**
- Create: `prisma/migrations/20260919130000_chat_mirai_rename/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed.js`

**Changes:**

This is the highest-risk task (spec sections 10, 11, 23, 24) — it must land first and be internally idempotent (every statement safe to run twice), since it targets the shared self-hosted Supabase dev instance.

- [x] Step 1: Write `prisma/migrations/20260919130000_chat_mirai_rename/migration.sql`:

```sql
-- MirAI identity migration — renames the Meridian/MeridIAn assistant's
-- persisted identifiers to MirAI. Safe to run twice (every statement is
-- IF EXISTS / WHERE NOT EXISTS guarded). Must be applied before (or in the
-- same deploy as) code that only recognizes the new names/values.

BEGIN;

-- A prematurely seeded new permission must not silently strand grants on
-- the old row. Stop before any change so the conflicting rows can be reviewed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "permission" WHERE "key" = 'chat.meridian.use')
     AND EXISTS (SELECT 1 FROM "permission" WHERE "key" = 'chat.mirai.use') THEN
    RAISE EXCEPTION 'Both assistant permission keys exist; reconcile grants before applying the MirAI migration';
  END IF;
END $$;

-- 1. Conversation type: widen the CHECK to accept 'mirai' alongside the old
--    value, so the data UPDATE below is legal mid-migration.
ALTER TABLE "chat_conversations" DROP CONSTRAINT IF EXISTS "chat_conversations_type_check";
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_type_check"
  CHECK ("type" IN ('direct', 'group', 'channel', 'external_support', 'meridian', 'mirai'));

-- 2. Migrate existing conversation rows.
UPDATE "chat_conversations" SET "type" = 'mirai' WHERE "type" = 'meridian';

-- 3. Narrow the CHECK back down now that no row uses 'meridian'.
ALTER TABLE "chat_conversations" DROP CONSTRAINT IF EXISTS "chat_conversations_type_check";
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_type_check"
  CHECK ("type" IN ('direct', 'group', 'channel', 'external_support', 'mirai'));

-- 4. Replace the partial unique index tied to the old predicate (a plain
--    RENAME cannot change the WHERE clause).
DROP INDEX IF EXISTS "chat_conversations_one_meridian_per_user_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "chat_conversations_one_mirai_per_user_idx"
  ON "chat_conversations" ("created_by_user_id")
  WHERE "type" = 'mirai' AND "deleted_at" IS NULL;

-- 5. Bot user_profile rows: rename display name and email to match what
--    prisma/seed.js's INSERT produces for a brand-new bot profile
--    (display_name='MirAI', first_name='MirAI', last_name=''). display_name
--    is the column actually rendered as the sender name across chat
--    (see chat-conversation-reads-service.js, chat-search-service.js) —
--    missing it here would leave existing bot profiles showing "MeridIAn"
--    forever, since seed.js's own idempotency check (is_bot=true + an
--    existing membership row for the company) skips already-provisioned
--    bots unconditionally and never re-touches their columns.
UPDATE "user_profile"
SET "display_name" = 'MirAI',
    "first_name" = 'MirAI',
    "last_name" = '',
    "email" = regexp_replace("email", '^meridian\+', 'mirai+')
WHERE "is_bot" = true AND "email" ~ '^meridian\+.*@bots\.runly\.local$';

-- 6. Bot-per-company unique index (guarded the same way the original
--    migration guards it, since company_id may not exist on this DB).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profile' AND column_name = 'company_id'
  ) THEN
    EXECUTE 'ALTER INDEX IF EXISTS "user_profile_meridian_bot_per_company_idx"
             RENAME TO "user_profile_mirai_bot_per_company_idx"';
  END IF;
END $$;

-- 7. Permission key: update the existing row IN PLACE (same id) so every
--    company's existing RolePermission/UserPermissionGrant row keeps
--    working without re-granting. Only touches the row if the new key
--    doesn't already exist (idempotent / safe to run twice).
UPDATE "permission"
SET "key" = 'chat.mirai.use',
    "name" = 'Usar MirAI',
    "description" = 'Permite conversar con el asistente de IA MirAI dentro del chat.'
WHERE "key" = 'chat.meridian.use'
  AND NOT EXISTS (SELECT 1 FROM "permission" WHERE "key" = 'chat.mirai.use');

-- 8. Table + index renames (Prisma-mapped tables). IF EXISTS makes every
--    statement a no-op on a second run.
ALTER TABLE IF EXISTS "chat_meridian_run" RENAME TO "chat_mirai_run";
ALTER INDEX IF EXISTS "chat_meridian_run_company_created_idx" RENAME TO "chat_mirai_run_company_created_idx";
ALTER INDEX IF EXISTS "chat_meridian_run_conversation_idx" RENAME TO "chat_mirai_run_conversation_idx";

ALTER TABLE IF EXISTS "chat_meridian_thread" RENAME TO "chat_mirai_thread";
ALTER INDEX IF EXISTS "chat_meridian_thread_owner_host_idx" RENAME TO "chat_mirai_thread_owner_host_idx";

ALTER TABLE IF EXISTS "chat_meridian_message" RENAME TO "chat_mirai_message";
ALTER INDEX IF EXISTS "chat_meridian_message_thread_idx" RENAME TO "chat_mirai_message_thread_idx";

-- Table renames preserve constraint names. Rename the primary/foreign keys
-- and named NOT NULL constraints (PostgreSQL 18+) too. Renaming a primary
-- key also renames its backing index. Limit this to the three renamed tables.
DO $$
DECLARE
  identity RECORD;
BEGIN
  FOR identity IN
    SELECT c.relname AS table_name, k.conname AS old_name,
           replace(k.conname, 'chat_meridian_', 'chat_mirai_') AS new_name
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    WHERE k.conrelid IN (to_regclass('chat_mirai_run'),
                        to_regclass('chat_mirai_thread'),
                        to_regclass('chat_mirai_message'))
      AND starts_with(k.conname, 'chat_meridian_')
  LOOP
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I',
      identity.table_name, identity.old_name, identity.new_name);
  END LOOP;
END $$;

COMMIT;
```

- [x] Step 2: In `prisma/schema.prisma`, rename the three models (find them via the `ChatMeridianRun`/`ChatMeridianThread`/`ChatMeridianMessage` model names found at lines ~3486-3535 during discovery):

```prisma
/// Per-turn audit for the MirAI chat assistant. No message content
/// stored here — see chat_mirai_thread/chat_mirai_message for that.
model ChatMiraiRun {
  // ...same fields as before...
  @@map("chat_mirai_run")
}

/// MirAI assistant panel: one private thread per (owner, host
/// conversation) pair.
model ChatMiraiThread {
  // ...same fields as before, relation renamed to ChatMiraiMessage...
  messages           ChatMiraiMessage[]
  @@map("chat_mirai_thread")
}

model ChatMiraiMessage {
  // ...same fields as before...
  thread    ChatMiraiThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  @@map("chat_mirai_message")
}
```

Keep every field/index/relation attribute identical — only the model names, the doc comments, and the `@@map` table names change.

- [x] Step 3: In `prisma/seed.js` (around the "MeridIAn bot profile" block found at lines ~386-412 during discovery), rename the email pattern and log text so future seed runs match the migrated rows instead of creating duplicates:

```javascript
  // MirAI bot profile — one per company, linked via membership. Idempotent.
  ...
      const email = `mirai+${company.id}@bots.runly.local`
      ...
        VALUES (uuidv7(), gen_random_uuid(), 'MirAI', 'MirAI', '', ${email}, true, true, NOW())
      ...
  console.log(`MirAI bot profile ensured for ${allCompanies.length} company(s) (${botsEnsured} created)`)
```

- [x] Step 4: Run `pnpm db:generate` to confirm the Prisma client regenerates cleanly against the renamed schema (this does not touch the database).

**Validation:**

```bash
pnpm db:generate
node --check prisma/seed.js
```

Expected: both exit 0. Do **not** run `pnpm db:migrate` yet — applying it to the shared Supabase dev instance is a separate, explicitly confirmed step (see Rollback Notes and spec section 24, risk 4). Flag to the user when this task is done and wait for their go-ahead before running `pnpm db:migrate`.

---

## Task 2 — Permission catalog and module manifest

**Files:**
- Modify: `apps/api/src/permission-catalog.js`
- Modify: `apps/api/src/manifests/official/feature-modules.js`

**Changes:**

- [x] Step 1: In `apps/api/src/permission-catalog.js` (line ~1398), rename the catalog entry key and copy:

```javascript
  "chat.mirai.use": {
    displayNameEs: "Usar MirAI (IA del chat)",
    descriptionEs: "Permite conversar con el asistente de IA MirAI dentro del chat.",
```

- [x] Step 2: In `apps/api/src/manifests/official/feature-modules.js` (lines ~841 and ~850, the `runly.chat` manifest's `permissions` array entry and its `acl.actions`/similar map), rename both occurrences:

```javascript
    { key: 'chat.mirai.use',         name: 'Usar MirAI' },
    ...
      'chat.mirai.use':         'chat.mirai.use',
```

**Validation:**

```bash
node --check apps/api/src/permission-catalog.js
node --check apps/api/src/manifests/official/feature-modules.js
```

Expected: both exit 0. (The seed re-run that actually applies this against the DB happens later, after Task 1's migration is applied — see Task 10.)

---

## Task 3 — Backend service/route/guard layer

**Files:**
- Rename: `apps/api/src/routes/chat/meridian-service.js` → `mirai-service.js`
- Rename: `apps/api/src/routes/chat/meridian-tools.js` → `mirai-tools.js`
- Rename: `apps/api/src/routes/chat/meridian-routes.js` → `mirai-routes.js`
- Rename: `apps/api/src/routes/chat/meridian-conversation-guard.js` → `mirai-conversation-guard.js`
- Modify: `apps/api/src/index.js`
- Modify: `apps/api/src/services/vision-service.js`
- Modify: `apps/api/src/services/inventory-assistant-service.js`
- Modify: `apps/api/src/routes/chat/index.js`
- Modify: `apps/api/src/routes/chat/chat-service.js`
- Modify: `apps/api/src/routes/chat/chat-conversation-reads-service.js`
- Modify: `apps/api/src/routes/chat/chat-conversations-write-service.js`

**Changes:**

- [x] Step 1: `git mv` the four files listed above.

- [x] Step 2: In `mirai-service.js` (formerly `meridian-service.js`), apply this identifier map throughout the file (functions, exports, comments, and every persisted-value literal — these now match what Task 1's migration produced):

| Old | New |
|---|---|
| `createMeridianService` | `createMiraiService` |
| `ensureMeridianConversation` | `ensureMiraiConversation` |
| `'MeridIAn'` (INSERT literal at line ~254) | `'MirAI'` |
| `'meridian'` (conversation type literal, lines ~277, ~290-291, ~298) | `'mirai'` |
| `MERIDIAN_MENTION_ID` | `MIRAI_MENTION_ID` (keep the UUID value `00000000-0000-0000-0000-00000000b07a` unchanged — spec section 23, edge case 6) |
| `MERIDIAN_NOT_CONFIGURED` / `MERIDIAN_RATE_LIMITED` error codes | `MIRAI_NOT_CONFIGURED` / `MIRAI_RATE_LIMITED` |
| `{ userId: "meridian", isTyping }` (line ~622) | `{ userId: "mirai", isTyping }` |
| Self-introduction copy (if any "soy MeridIAn..." string lives here — confirm while editing) | "Soy MirAI, tu asistente inteligente de Runly." |
| File-level/section comments mentioning "MeridIAn"/"Meridian" | "MirAI" |

- [x] Step 3: In `mirai-tools.js` (formerly `meridian-tools.js`): rename `senderName` fallback strings `"MeridIAn"` → `"MirAI"` (lines ~161, ~508), update comments referencing `meridian-routes.js`/`meridian-service` to the new filenames, and rename the `@meridIAn` channel-mention comment/tool description text to `@MirAI`.

- [x] Step 4: In `mirai-routes.js` (formerly `meridian-routes.js`): rename the exported factory `createMeridianRoutes` → `createMiraiRoutes`, its `meridianService` param → `miraiService`, every route path `/chat/meridian...` → `/chat/mirai...` (per spec section 12's table), every `requirePermission("chat.meridian.use")` → `requirePermission("chat.mirai.use")`, and every user-facing error string ("No se pudo abrir el chat con MeridIAn.", "MeridIAn no esta configurado...", etc.) to the MirAI wording.

- [x] Step 5: In `mirai-conversation-guard.js` (formerly `meridian-conversation-guard.js`): rename `assertNotMeridian` → `assertNotMirai`, its `row?.type === "meridian"` check → `"mirai"`, and its error string "No puedes ... el chat con MeridIAn." → "...con MirAI.".

- [x] Step 6: In `apps/api/src/index.js`: update the import path/name for the renamed service/routes files (find via `createMeridianService`/`createMeridianRoutes` imports).

- [x] Step 7: In `apps/api/src/routes/chat/index.js`: update the import (`createMeridianRoutes` → `createMiraiRoutes`), the `meridian` local variable/mount (`meridian.route(...)`, `app.route("", meridian)`) → `mirai`, the `senderName: "MeridIAn"` literal (line ~144) → `"MirAI"`, and the `conv?.type === "meridian"` check (line ~353) → `"mirai"`.

- [x] Step 8: In `apps/api/src/routes/chat/chat-service.js`: update the two comments referencing `meridian-conversation-guard.js`/"the 'meridian' chat" (lines ~164, ~169) to `mirai-conversation-guard.js`/"the 'mirai' chat", and update the import of `assertNotMeridian` → `assertNotMirai`.

- [x] Step 9: In `apps/api/src/routes/chat/chat-conversation-reads-service.js`: update the comment at line ~15 referencing `meridian-conversation-guard.js`/"the 'meridian' chat" the same way.

- [x] Step 10: In `apps/api/src/routes/chat/chat-conversations-write-service.js`: re-check for any `type === "meridian"`/`assertNotMeridian` reference found during discovery and update to `mirai` equivalents (confirm exact lines while editing — discovery grep flagged this file as a match but the excerpt shown was for `type === "direct"/"channel"/"group"`, so re-grep the file for `meridian` specifically before editing to avoid missing an occurrence).

- [x] Step 11: In `apps/api/src/services/vision-service.js`: update the comment at line ~164 ("Generic image description for the MeridIAn chat assistant...") to "...for the MirAI chat assistant...".

- [x] Step 12: In `apps/api/src/services/inventory-assistant-service.js`: update the import (`createMeridianService` from `../routes/chat/meridian-service.js` → `createMiraiService` from `../routes/chat/mirai-service.js`) and the `meridian` parameter/local name → `mirai` throughout the file (function signature default and every call site: `mirai.searchPublicModel`, `mirai.answerWithTools`).

**Validation:**

```bash
node --check apps/api/src/index.js
node --check apps/api/src/routes/chat/index.js
node --check apps/api/src/routes/chat/mirai-service.js
node --check apps/api/src/routes/chat/mirai-tools.js
node --check apps/api/src/routes/chat/mirai-routes.js
node --check apps/api/src/routes/chat/mirai-conversation-guard.js
node --check apps/api/src/routes/chat/chat-service.js
node --check apps/api/src/routes/chat/chat-conversation-reads-service.js
node --check apps/api/src/routes/chat/chat-conversations-write-service.js
node --check apps/api/src/services/vision-service.js
node --check apps/api/src/services/inventory-assistant-service.js
```

Expected: every command exits 0.

---

## Task 4 — Backend test suite rename

**Files:**
- Rename + modify all nine `apps/api/src/routes/chat/__tests__/meridian-*.test.js` files listed in the File Structure Map.
- Modify: `apps/api/src/routes/chat/__tests__/chat-service.test.js`
- Modify: `apps/api/src/routes/chat/__tests__/chat-tenant.test.js`
- Modify: `apps/api/src/routes/chat/__tests__/chat-conversation-pin-hide.test.js`
- Modify: `apps/api/src/services/__tests__/permission-grants.test.js`
- Modify: `apps/api/src/services/__tests__/inventory-assistant-service.test.js`

**Changes:**

- [x] Step 1: `git mv` each `meridian-*.test.js` file to its `mirai-*.test.js` name.

- [x] Step 2: In each renamed test file, update: imports (`from "../meridian-service.js"` → `"../mirai-service.js"`, `createMeridianService` → `createMiraiService`, etc.), every literal `"meridian"` conversation-type/permission-key/sentinel string used as test fixture data → `"mirai"`, and every `describe`/`it` title mentioning "Meridian"/"MeridIAn" → "MirAI". Do not change assertions' *structure* — only the identifier/string values, per spec's "no unnecessary behavior change" principle.

- [x] Step 3: In `chat-service.test.js`, `chat-tenant.test.js`, `chat-conversation-pin-hide.test.js`, `permission-grants.test.js`: update any fixture rows or assertions that reference `type: "meridian"` or `chat.meridian.use` (re-grep each file for `meridian` before editing — the discovery pass matched these files but did not show every line).

- [x] Step 4: In `inventory-assistant-service.test.js`: update the mock/import of `createMeridianService`/`meridian` parameter to `createMiraiService`/`mirai`, matching Task 3 Step 12's production rename.

**Validation:**

```bash
node --test apps/api/src/routes/chat/__tests__/
node --test apps/api/src/services/__tests__/
```

Expected: all tests pass, same pass count as before the rename (a pure rename should not change behavior or test count).

---

## Task 5 — SDK

**Files:**
- Modify: `packages/sdk/src/domains/chat.js`

**Changes:**

- [x] Step 1: Rename the `meridian: { ... }` group (lines ~450-466) to `mirai: { ... }`, keeping method names (`ensure`, `status`, `panel`, `panelSend`, `panelClear`) unchanged, and update every request path from `/chat/meridian...` to `/chat/mirai...`:

```javascript
    // ----------------------------------------------------------------
    // MirAI assistant
    // ----------------------------------------------------------------
    mirai: {
      ensure: (token) => request("/chat/mirai", { headers: withAuthHeaders(token) }),
      status: (token) => request("/chat/mirai/status", { headers: withAuthHeaders(token) }),
      panel: (conversationId, token) =>
        request(`/chat/mirai/panel/${encodeURIComponent(conversationId)}`, { headers: withAuthHeaders(token) }),
      panelSend: (conversationId, data, token) =>
        request(`/chat/mirai/panel/${encodeURIComponent(conversationId)}/messages`, {
          method: "POST", headers: withAuthHeaders(token), body: JSON.stringify(data),
        }),
      panelClear: (conversationId, token) =>
        request(`/chat/mirai/panel/${encodeURIComponent(conversationId)}`, {
          method: "DELETE", headers: withAuthHeaders(token),
        }),
    },
```

**Validation:**

```bash
node --check packages/sdk/src/domains/chat.js
```

Expected: exits 0. (Consumers are updated in Task 6; a repo-wide `pnpm build` in Task 10 is the real end-to-end check.)

---

## Task 6 — Frontend lib/hooks

**Files:**
- Rename: `apps/desktop/src/modules/runly.chat/lib/meridian.js` → `mirai.js`
- Rename: `apps/desktop/src/modules/runly.chat/lib/__tests__/meridian.test.js` → `mirai.test.js`
- Rename: `apps/desktop/src/modules/runly.chat/hooks/useMeridian.js` → `useMirAI.js`
- Rename: `apps/desktop/src/modules/runly.chat/hooks/useMeridianPanel.js` → `useMirAIPanel.js`
- Modify: `apps/desktop/src/modules/runly.chat/hooks/useMentionCandidates.js`
- Modify: `apps/desktop/src/modules/runly.chat/hooks/useChatWindowData.js`

**Changes:**

- [x] Step 1: `git mv` the four files.

- [x] Step 2: Rewrite `mirai.js` (formerly `lib/meridian.js`):

```javascript
// apps/desktop/src/modules/runly.chat/lib/mirai.js
//
// Pure helpers for the MirAI AI assistant surfaces in runly.chat.
// No React, no network — safe to unit-test with node --test.

export const MIRAI_NAME = "MirAI";
export const MIRAI_SUBTITLE = "Asistente de IA · solo tú ves este chat";

// Fixed sentinel id for the "@MirAI" mention candidate in the composer.
// Not a real user id and not a valid UUIDv7 (version/variant nibbles are 0),
// so it can never collide with a member. Rides the same @[id:name] token
// format MentionTextarea uses; the API detects it in matchMiraiMention.
// MUST stay byte-identical to MIRAI_MENTION_ID in
// apps/api/src/routes/chat/mirai-service.js.
export const MIRAI_MENTION_ID = "00000000-0000-0000-0000-00000000b07a";

// Server broadcasts typing as { userId: "mirai", isTyping } on the
// conversation's presence channel — this sentinel is not a real user id.
export const MIRAI_TYPING_SENTINEL = "mirai";

export const MIRAI_EXAMPLE_PROMPTS = [
  "Resume los mensajes que reenvié aquí",
  "¿Qué archivos e imágenes he compartido en el chat esta semana?",
  "Explícame el último mensaje que me reenviaron",
];

export function isMiraiConversation(conversation) {
  return Boolean(conversation && conversation.type === "mirai");
}

export function isAssistantMessage(message) {
  return Boolean(message && message.sender_type === "assistant");
}

// Replace the typing sentinel with the display name; pass everything else
// through unchanged so real users' typing labels are untouched.
export function mapTypingNames(list) {
  return (list ?? []).map((x) => (x === MIRAI_TYPING_SENTINEL ? MIRAI_NAME : x));
}
```

- [x] Step 3: In `mirai.test.js` (formerly `lib/__tests__/meridian.test.js`), update the import path to `../mirai.js` and every `MERIDIAN_*`/`isMeridianConversation` reference to its `MIRAI_*`/`isMiraiConversation` equivalent, keeping test case structure/assertions the same.

- [x] Step 4: In `useMirAI.js` (formerly `hooks/useMeridian.js`): rename `useMeridianStatus` → `useMiraiStatus`, `useEnsureMeridianConversation` → `useEnsureMiraiConversation`, query keys `"chat-meridian-status"`/`"chat-meridian-ensure"` → `"chat-mirai-status"`/`"chat-mirai-ensure"`, and the `runly.chat.meridian.status(token)`/`.ensure(token)` calls → `runly.chat.mirai.status(token)`/`.ensure(token)` (matching Task 5's SDK rename). Update the file-header comment ("Is MeridIAn available... chat.meridian.use?") to MirAI/`chat.mirai.use`.

- [x] Step 5: In `useMirAIPanel.js` (formerly `hooks/useMeridianPanel.js`): rename `useMeridianPanelThread` → `useMiraiPanelThread`, `useSendMeridianPanel` → `useSendMiraiPanel`, `useClearMeridianPanel` → `useClearMiraiPanel`, query key `"chat-meridian-panel"` → `"chat-mirai-panel"`, and every `runly.chat.meridian.panel*` call → `runly.chat.mirai.panel*`.

- [x] Step 6: In `useMentionCandidates.js` and `useChatWindowData.js`: re-grep each file for `meridian`/`Meridian` (discovery matched these files without showing every line) and update imports from `../lib/meridian.js`/`../hooks/useMeridian(Panel)?.js` to their new paths, plus any `MERIDIAN_*` constant usage to `MIRAI_*`.

**Validation:**

```bash
node --check apps/desktop/src/modules/runly.chat/lib/mirai.js
node --test apps/desktop/src/modules/runly.chat/lib/__tests__/
```

Expected: exits 0, tests pass (desktop tests run through the repo's configured test runner — confirm with `pnpm --filter @runly/desktop test` if `node --test` alone doesn't pick up JSX-adjacent files; use whichever this repo's existing `lib/__tests__` suite already uses, matching how it ran before this change).

---

## Task 7 — Shared two-tone MirAI wordmark component

**Files:**
- Create: `packages/ui/src/components/AssistantWordmark.jsx`
- Modify: `packages/ui/src/index.js`

**Changes:**

Per spec section 8 (UX requirements): "Mir" in the default foreground color, "AI" in `var(--brand-primary)` — the same CSS variable already used for the assistant's Sparkles-icon avatar background in `MeridianPanel.jsx`/`MeridianIntro.jsx`/`InventoryAssistant.jsx` (confirmed during discovery), so no new color token is introduced.

- [x] Step 1: Create `packages/ui/src/components/AssistantWordmark.jsx`:

```jsx
// packages/ui/src/components/AssistantWordmark.jsx
//
// Two-tone "MirAI" wordmark: "Mir" in the current text color, "AI" in
// var(--brand-primary). Temporary text treatment until an official MirAI
// graphic exists (see spec docs/superpowers/specs/2026-09-19-mirai-identity-migration-design.md).
// Use for name/label/heading/avatar-tooltip contexts, not inside flowing
// sentence prose ("MirAI está analizando..." stays a plain string there).
export function AssistantWordmark({ className = "" }) {
  return (
    <span className={className}>
      Mir<span style={{ color: "var(--brand-primary)" }}>AI</span>
    </span>
  );
}
```

- [x] Step 2: In `packages/ui/src/index.js`, add the export alongside the other component exports:

```javascript
export { AssistantWordmark } from "./components/AssistantWordmark.jsx";
```

- [x] Step 3: Document it in `docs/ai-context/rme3-runtime-capabilities.md` under the `@runly/ui` component table, per CLAUDE.md's "Adding a new reusable component" rule (step 3).

**Validation:**

```bash
pnpm --filter @runly/desktop build:web # compiles the shared JSX export and its consumers
```

Expected: exits 0. Node.js does not parse `.jsx` with `--check`; the Vite build validates JSX. Visual confirmation happens in Task 8's manual check.

---

## Task 8 — Frontend components

**Files:**
- Rename: `apps/desktop/src/modules/runly.chat/components/MeridianPanel.jsx` → `MirAIPanel.jsx`
- Rename: `apps/desktop/src/modules/runly.chat/components/MeridianIntro.jsx` → `MirAIIntro.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/screens/ChatScreen.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/components/ChatWindow.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/components/ChatHeader.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/components/ChatMessageList.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/components/ChatMessageBubble.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/components/ChatConversationItem.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/components/MessageComposer.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/components/AssistantMarkdown.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/lib/messageActions.jsx`
- Modify: `apps/desktop/src/modules/runly.inventory/components/InventoryAssistant.jsx`
- Modify: `apps/desktop/src/modules/runly.identity/components/PermissionFeatureTree.jsx`

**Changes:**

- [x] Step 1: `git mv` `MeridianPanel.jsx` → `MirAIPanel.jsx`, `MeridianIntro.jsx` → `MirAIIntro.jsx`.

- [x] Step 2: In `MirAIPanel.jsx`: rename the component `MeridianPanel` → `MirAIPanel`, update imports (`useMeridianStatus` → `useMiraiStatus`, `useMeridianPanelThread`/`useSendMeridianPanel`/`useClearMeridianPanel` → their `Mirai` equivalents from `../hooks/useMirAIPanel.js`, `MERIDIAN_NAME` → `MIRAI_NAME` from `../lib/mirai.js`), and import `AssistantWordmark` from `@runly/ui` for the panel title, replacing the plain `MERIDIAN_NAME`/`MIRAI_NAME` text render with `<AssistantWordmark />` where it's rendered as a heading (per spec UX requirement — confirm exact render line while editing, e.g. inside `SheetTitle`).

- [x] Step 3: In `MirAIIntro.jsx`: rename the component `MeridianIntro` → `MirAIIntro`, update the import of `MERIDIAN_EXAMPLE_PROMPTS` → `MIRAI_EXAMPLE_PROMPTS` from `../lib/mirai.js`, and replace the plain `<p className="text-sm font-semibold">MeridIAn</p>` with `<p className="text-sm font-semibold"><AssistantWordmark /></p>` (import `AssistantWordmark` from `@runly/ui`).

- [x] Step 4: In `ChatScreen.jsx`, `ChatWindow.jsx`: update imports of `MeridianPanel`/`MeridianIntro` → `MirAIPanel`/`MirAIIntro`, `useMeridianStatus`/`useEnsureMeridianConversation` → their Mirai equivalents, and any inline "Meridian"/"MeridIAn" string still present after re-grepping the file.

- [x] Step 5: In `ChatHeader.jsx`, `ChatMessageList.jsx`, `ChatMessageBubble.jsx`, `ChatConversationItem.jsx`, `MessageComposer.jsx`, `AssistantMarkdown.jsx`, `messageActions.jsx`: re-grep each file for `meridian`/`Meridian` (discovery matched these files without showing every line) and, for each occurrence: if it's the assistant's name rendered as a label/heading, use `AssistantWordmark`; if it's inside flowing prose or a code-level identifier (import name, sentinel comparison, mention detection), use the plain `MirAI`/`mirai` token consistent with Tasks 3-6's renames.

- [x] Step 6: In `InventoryAssistant.jsx`: replace both `<span className="block text-sm font-semibold">Meridian</span>` (line ~51) and the `>Meridian</span>` hover label (line ~64) with `<AssistantWordmark className="block text-sm font-semibold" />` / `<AssistantWordmark />` respectively (import from `@runly/ui`); update the busy-state copy at line ~175 ("Meridian está analizando y consultando" → "MirAI está analizando y consultando").

- [x] Step 7: In `PermissionFeatureTree.jsx` (line ~80): rename the `FEATURE_LABELS` entry key to match the new permission key's middle segment:

```javascript
  // chat
  mirai: "MirAI",
```

**Validation:**

```bash
pnpm --filter @runly/desktop build:web
```

Expected: the web build compiles both JSX components and succeeds with no unresolved-import errors (this is the fastest way to catch a missed import rename across the ~10 files touched in Step 5).

Manual: with `pnpm dev`, open `runly.chat`, confirm the MirAI panel title/intro card render "Mir" + "AI" in two colors; open `runly.inventory`, confirm the assistant dock label does the same.

---

## Task 9 — Env vars and docs

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`
- Modify: `docs/ai-context/inventory-ai.md`

**Changes:**

- [x] Step 1: In `.env.example` (lines ~144-156): rename `CHAT_MERIDIAN_MODEL` → `CHAT_MIRAI_MODEL`, `CHAT_MERIDIAN_WEB` → `CHAT_MIRAI_WEB`, `CHAT_MERIDIAN_WEB_MODEL` → `CHAT_MIRAI_WEB_MODEL`, `CHAT_MERIDIAN_ROUTER_MODEL` → `CHAT_MIRAI_ROUTER_MODEL`, and update the inline comment ("CHAT_MERIDIAN_WEB=false lo desactiva del todo.") to reference the new name. Also update every place these env vars are read in code (`process.env.CHAT_MERIDIAN_MODEL` etc. — most likely inside `mirai-service.js`, confirm during Task 3 and finish here if any were missed).

- [x] Step 2: In `CLAUDE.md`'s `GROQ_API_KEY` description (the line documenting `runly.pfm` receipt OCR + PFM assistant sidebar + `the runly.chat MeridIAn assistant`) and its `PFM_ASSISTANT_MODEL / CHAT_MERIDIAN_MODEL / CHAT_MERIDIAN_ROUTER_MODEL / CHAT_MERIDIAN_WEB_MODEL` line: update to MirAI/`CHAT_MIRAI_*`. **Do not touch** the unrelated line 230 ("Current release edition: 'Jaguar' (previously 'Meridian')") — that documents a different, already-retired marketing edition-name history, not the assistant (confirmed during discovery: `RUNLY_EDITION_NAME` in `appConfig.js` is already `'Jaguar'`, and the "Meridian Edition" UI label was already removed on 2026-09-13 per `docs/TASKS.md`).

- [x] Step 3: In `docs/ai-context/inventory-ai.md`: update the active-documentation "Meridian" mentions (lines ~19, ~56, ~66, ~68, ~72, ~77, ~84 per discovery) to "MirAI", including the `CHAT_MERIDIAN_MODEL`/`CHAT_MERIDIAN_WEB` env var mentions at line ~56. Leave the historical pass/fail counts ("189 pruebas aprobadas", "237 pruebas automatizadas") as numbers unchanged — only the name token changes.

**Validation:**

```bash
node -e "require('fs').readFileSync('.env.example','utf8')" # sanity parse
```

Manual: `grep -ri meridian .env.example CLAUDE.md docs/ai-context/inventory-ai.md` returns only the explicitly preserved Jaguar edition history in CLAUDE.md (Windows Git Bash: use the repo's Grep tool, not a raw shell grep, per this session's tooling conventions).

---

## Task 10 — Full verification

**Files:**
- None (verification only).

**Changes:**

- [ ] Step 1: Confirm the migration from Task 1 has been applied by the user (manual `pnpm db:migrate`, confirmed out loud before running) before doing any DB-dependent manual check.
- [x] Step 2: Run the full lint and build.
- [x] Step 3: Run every touched test suite.
- [x] Step 4: Repo-wide sweep for any remaining *active* "meridian"/"Meridian"/"MeridIAn" reference outside the explicitly out-of-scope list in the File Structure Map.
- [ ] Step 5: Re-run `pnpm db:seed` (after the user has applied the migration) and confirm no duplicate bot profile / permission row was created (spec acceptance criteria 2), by having the user check row counts themselves (never print DB query results containing tokens that look like secrets — this is a plain count, safe to show).

**Validation:**

```bash
pnpm lint
pnpm build
node --test apps/api/src/routes/chat/__tests__/
node --test apps/api/src/services/__tests__/
node --test apps/desktop/src/modules/runly.chat/lib/__tests__/
```

Expected: every command exits 0 with no failing tests. Then, as a discovery-only check (not an edit):

```bash
# via the Grep tool, case-insensitive, repo-wide, excluding the explicit
# out-of-scope paths listed in the File Structure Map
```

Expected: zero matches outside the historical/out-of-scope files.

---

## Rollback Notes

- If aborted before Task 1's migration is applied to the DB (i.e., only the migration *file* exists, never run): revert all commits with `git revert`; no DB cleanup needed since nothing was applied.
- If aborted after Task 1's migration was applied to the shared DB but before later tasks land: the DB is already fully on the new names (tables, permission key, conversation type, bot profiles) — either finish the remaining tasks (recommended, since the DB and code must agree) or write a new forward "down" migration that reverses each of migration `20260919130000`'s eight steps in the opposite order (rename tables/indexes back, `UPDATE chat_conversations SET type='meridian' WHERE type='mirai'` with the CHECK constraint widened/narrowed the same two-step way, `UPDATE permission SET key='chat.meridian.use' WHERE key='chat.mirai.use'`, restore bot profile `email`/`first_name`/`last_name`) — never edit the `20260919130000` migration file itself once applied.
- Code-side rollback for any task is a plain `git revert` of that task's commit(s); no task depends on a later task's *code* being present (only Task 1's DB state is a shared dependency for Tasks 3+ to function correctly against a live DB).

---

## Verification Gate

Before marking this work complete:

- [ ] All 10 tasks' validation commands have been run.
- [ ] All commands exited without errors.
- [ ] The user has explicitly applied `pnpm db:migrate` (agent does not run this unattended — spec risk 4).
- [ ] `pnpm db:seed` re-run confirmed no duplicate bot profiles or permission rows.
- [x] Isolated Chromium UI check confirms the two-tone MirAI wordmark renders correctly in chat and inventory components (desktop/mobile, light/dark; live integration remains pending).
- [ ] Manual check confirms an existing pre-migration conversation still loads with full history.
- [x] Verification checklist based on `docs/superpowers/templates/verification-checklist-template.md` filled in at `docs/superpowers/verification/2026-09-19-mirai-identity-migration.md`.
- [x] This plan's file updated with actual results (pass/fail counts) once run, matching this repo's evidence convention.

## Execution evidence — 2026-09-19

Tasks 1–9 are implemented. Task 10's local checks pass; shared-database deployment remains pending explicit confirmation. The real `.env` and deployed secrets remain an owner-managed step, as approved.

| Tasks | Verification |
|---|---|
| 1 | Prisma Client 7.8.0 generated; seed syntax passes; isolated PostgreSQL migration integration 5/5 passed. |
| 2–3 | Syntax checks and full ESLint pass. |
| 4 | Chat 331 passed; services 488 passed, 2 skipped, no failures. |
| 5 | SDK syntax and no-network smoke check of all five endpoints passed. |
| 6 | Frontend helper tests 71/71 passed; hooks/helper syntax passed. |
| 7–8 | Vite web build and full native build passed; JSX parsed through Vite. Chromium visual checks passed on desktop/mobile in light/dark themes. |
| 9 | Active config/documentation sweep passed; only unrelated Jaguar edition history retained in CLAUDE.md. |
| 10 (local) | `pnpm lint`, `pnpm build`, touched test suites and reference sweep passed. React Doctor: no errors, eight existing warnings, 70/100. |

Verified: 2026-09-19 (commands and detailed results in the [verification record](../verification/2026-09-19-mirai-identity-migration.md)).

Corrections found during implementation review:

- Added explicit transaction boundaries, guarded constraint renames and fail-fast handling for coexisting permission identities to the new migration. PostgreSQL tests confirm full rollback and preservation of IDs, history, grants, RLS and index definitions.
- Updated nine stale chat-test expectations and one related fixture from `/app/m/atlas.*` to the already-existing `/app/m/runly.*` production URLs. Stored module/permission identities were not changed.
- Added explicit self-identification instructions to chat and inventory prompts.
- Covered the inventory mobile label and adjusted hover/selected-label contrast so the brand-colored `AI` stays visible.
- The old-name reference sweep intentionally allows migration source/fixtures, historical documents, the current migration's design/plan/verification records and unrelated edition history.
- `node --check` cannot parse `.jsx`; Vite compilation replaces those invalid validation commands. Windows Node suite commands use `*.test.js` globs.

No shared Supabase writes, real `.env` changes or commits were performed during local validation. Historical documents and already-applied migrations remain unchanged.
