-- One-time backfill: content_text was never populated for document-type
-- notes (only canvas notes computed it correctly via canvas-service.js's
-- extractSceneText), which silently broke full-text search on note body
-- content for every note created before the accompanying frontend fix
-- (NoteEditor.jsx now sends editor.getText() as contentText on autosave).
-- `content` is stored as a JSON-encoded HTML STRING (JSON.stringify(html)
-- cast to jsonb, not a JSON object) — `#>> '{}'` is the correct Postgres
-- operator to unwrap a jsonb scalar string back to plain SQL text.
-- regexp_replace strips HTML tags the same way the old client-side search
-- used to (content.replace(/<[^>]*>/g, '')). Idempotent: only touches rows
-- that still have the untouched empty default, so it never overwrites a
-- row a user's later edit (or a prior run of this migration) already
-- populated correctly.
UPDATE notes
SET content_text = regexp_replace(content #>> '{}', '<[^>]*>', ' ', 'g')
WHERE content_text = ''
  AND note_type = 'document'
  AND content IS NOT NULL;
