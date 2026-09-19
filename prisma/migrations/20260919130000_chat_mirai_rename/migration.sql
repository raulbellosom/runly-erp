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
