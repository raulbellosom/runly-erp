-- =============================================================================
-- Atlas ERP — Chat message search (pg_trgm fuzzy search)
-- Migration: 20260902000000_chat_message_search
-- Adds trigram infrastructure so /chat/search/messages can match message body,
-- sender display name, and attachment file names accent-insensitively, by
-- partial word, and with typo tolerance (word_similarity).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() is only STABLE (it depends on the text-search config resolved at
-- call time), so it cannot be used in a generated column or an index. Pinning
-- the dictionary with ::regdictionary makes this wrapper genuinely IMMUTABLE.
CREATE OR REPLACE FUNCTION atlas_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE PARALLEL SAFE STRICT
  SET search_path = public, extensions
  AS $$ SELECT unaccent('unaccent'::regdictionary, $1) $$;

-- Normalised body: lower-cased, accent-stripped. STORED (not an expression
-- index) because the search service reads it back to compute match offsets for
-- the highlighted snippet.
ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "body_norm" text
    GENERATED ALWAYS AS (atlas_unaccent(lower("body"))) STORED;

CREATE INDEX IF NOT EXISTS "chat_messages_body_norm_trgm_idx"
  ON "chat_messages" USING gin ("body_norm" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "user_profile_display_name_trgm_idx"
  ON "user_profile" USING gin (atlas_unaccent(lower("display_name")) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "chat_attachments_file_name_trgm_idx"
  ON "chat_attachments" USING gin (atlas_unaccent(lower("file_name")) gin_trgm_ops);
