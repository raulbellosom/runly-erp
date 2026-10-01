-- MirAI confirmable write actions (spec 2026-09-30-mirai-actions-design.md §5).
-- A proposal is prepared by MirAI and only executed after the user confirms it.

CREATE TABLE "mirai_action_proposals" (
  "id"               UUID        PRIMARY KEY DEFAULT uuidv7(),
  "company_id"       UUID        NOT NULL,
  "conversation_id"  UUID        NOT NULL,
  "surface"          TEXT        NOT NULL DEFAULT 'direct',
  "thread_id"        UUID,
  "message_id"       UUID,
  "actor_profile_id" UUID        NOT NULL,
  "action_key"       TEXT        NOT NULL,
  "operation"        TEXT        NOT NULL,
  "target_id"        TEXT,
  "input"            JSONB       NOT NULL,
  "preview"          JSONB       NOT NULL,
  "destructive"      BOOLEAN     NOT NULL DEFAULT false,
  "status"           TEXT        NOT NULL DEFAULT 'pending',
  "result"           JSONB,
  "error"            TEXT,
  "expires_at"       TIMESTAMPTZ NOT NULL,
  "decided_at"       TIMESTAMPTZ,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "mirai_action_proposals_status_check"
    CHECK ("status" IN ('pending', 'executing', 'executed', 'cancelled', 'superseded', 'expired', 'failed')),
  CONSTRAINT "mirai_action_proposals_operation_check"
    CHECK ("operation" IN ('create', 'update', 'delete')),
  CONSTRAINT "mirai_action_proposals_surface_check"
    CHECK ("surface" IN ('direct', 'panel'))
);

CREATE INDEX "mirai_action_proposals_conversation_status_idx"
  ON "mirai_action_proposals" ("conversation_id", "status");
CREATE INDEX "mirai_action_proposals_actor_status_idx"
  ON "mirai_action_proposals" ("actor_profile_id", "status");

-- Panel replies (chat_mirai_message) have no metadata column; link the proposal here.
ALTER TABLE "chat_mirai_message" ADD COLUMN IF NOT EXISTS "proposal_id" UUID;
