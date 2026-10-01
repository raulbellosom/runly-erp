-- MirAI sidebar v2 (spec 2026-10-01-mirai-sidebar-v2-design.md §2): a user can
-- keep several MirAI conversations per company. Creation is serialized with an
-- advisory lock in mirai-threads-service.js instead of this unique index.
DROP INDEX IF EXISTS "chat_conversations_one_mirai_per_company_user_idx";

-- Supports "latest MirAI conversation of this user" lookups.
CREATE INDEX IF NOT EXISTS "chat_conversations_mirai_owner_recent_idx"
  ON "chat_conversations" ("created_by_user_id", "company_id", "last_message_at" DESC)
  WHERE "type" = 'mirai' AND "deleted_at" IS NULL;
