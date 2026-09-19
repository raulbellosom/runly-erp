-- The public note page (PublicNoteScreen.jsx, anon Supabase client, no
-- session) only ever refreshed on tab focus/remount — there was no live
-- transport for the rich-text (Y.js) note type, unlike the canvas note type
-- which already gets a live public view via note_canvas_receive (migration
-- 20260911120000_notes_realtime_authorization). This closes that gap by
-- extending note_ydoc_receive the same way note_canvas_receive was extended:
-- `anon` may SUBSCRIBE (receive-only) to `note:ydoc:<id>` when the note is
-- published, using the notes_realtime_is_public() helper added in migration
-- 20260911130000_notes_realtime_authorization_fix. Sending stays
-- authenticated-only (note_ydoc_send is unchanged) — the public page never
-- edits, it only applies incoming ydoc.update broadcasts to a local,
-- read-only Y.Doc (see SupabaseYjsProvider's `readOnly` mode).

DROP POLICY IF EXISTS "note_ydoc_receive" ON "realtime"."messages";

CREATE POLICY "note_ydoc_receive" ON "realtime"."messages"
FOR SELECT
TO anon, authenticated
USING (
  realtime.topic() ~ '^note:ydoc:[0-9a-fA-F-]{36}$'
  AND (
    public.notes_realtime_is_public(substring(realtime.topic() FROM 11)::uuid)
    OR (
      auth.role() = 'authenticated'
      AND public.notes_realtime_can_access(substring(realtime.topic() FROM 11)::uuid, false)
    )
  )
);
