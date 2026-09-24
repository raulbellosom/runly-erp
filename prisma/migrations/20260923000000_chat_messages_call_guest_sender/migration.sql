-- Attribute a chat message to a call guest (call_guest), distinct from the
-- existing sender_guest_id (chat_guest_sessions — the website-inbox guest).
-- See docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md §10.
ALTER TABLE "chat_messages"
  ADD COLUMN "sender_call_guest_id" UUID REFERENCES "call_guest"("id") ON DELETE SET NULL;

CREATE INDEX "chat_messages_sender_call_guest_id_idx"
  ON "chat_messages" ("sender_call_guest_id")
  WHERE "sender_call_guest_id" IS NOT NULL;
