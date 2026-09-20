-- Closes the notes realtime co-editing gap flagged in
-- docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §10:
-- SupabaseYjsProvider.js and SupabaseCanvasSync.js join Supabase Realtime
-- broadcast/presence channels named `note:ydoc:<id>` / `note:canvas:<id>`
-- with NO server-side authorization — any client holding a note's UUID could
-- join and both read live edits and inject updates, entirely bypassing the
-- REST-layer checks that already exist in ydoc-service.js. Turns on Supabase
-- Realtime Authorization (RLS on realtime.messages, evaluated per-topic via
-- realtime.topic()) so the Realtime server itself enforces the same
-- ownership/share rules the REST endpoints already use. The application
-- code change (passing `{ config: { private: true } }` when joining these
-- two channels) ships alongside this migration.
--
-- Scoped ONLY to `note:ydoc:*` / `note:canvas:*` topics. No other channel in
-- the app (chat, calls, company presence/events) opts into `private: true`
-- today, so enabling RLS here has no effect on them — a non-private channel
-- never consults realtime.messages policies at all.
--
-- Deliberately NOT running `ALTER TABLE "realtime"."messages" ENABLE ROW
-- LEVEL SECURITY` here (removed 2026-09-20): Supabase's own Realtime
-- Authorization docs confirm RLS is already enabled by default on this
-- table, and the statement requires literal ownership of realtime.messages
-- (owned by supabase_realtime_admin) — a role the `postgres` connection
-- string used by every self-hosted/CLI-provisioned Supabase instance is NOT
-- a member of, unlike CREATE/ALTER/DROP POLICY on the same table, which
-- Postgres permits without ownership. Verified by reproducing this exact
-- migration against a brand-new `supabase start` instance: `relrowsecurity`
-- is already `t` before this migration runs, and re-issuing ENABLE ROW LEVEL
-- SECURITY as `postgres` fails with `must be owner of table messages`
-- (42501) while the CREATE POLICY statements below succeed unmodified.

-- note:ydoc:<uuid> — the TipTap collaborative editor. Never joined by an
-- unauthenticated/public client (NoteEditor.jsx gates collabEnabled on
-- having a session token), so authenticated-only.

CREATE POLICY "note_ydoc_receive" ON "realtime"."messages"
FOR SELECT
TO authenticated
USING (
  realtime.topic() ~ '^note:ydoc:[0-9a-fA-F-]{36}$'
  AND EXISTS (
    SELECT 1
    FROM public.notes n
    JOIN public.user_profile up ON up.auth_user_id = auth.uid()
    WHERE n.id = substring(realtime.topic() FROM 11)::uuid
      AND (
        n.owner_user_id = up.id
        OR EXISTS (
          SELECT 1 FROM public.note_shares ns
          WHERE ns.note_id = n.id AND ns.shared_with_user_id = up.id
        )
      )
  )
);

CREATE POLICY "note_ydoc_send" ON "realtime"."messages"
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.topic() ~ '^note:ydoc:[0-9a-fA-F-]{36}$'
  AND EXISTS (
    SELECT 1
    FROM public.notes n
    JOIN public.user_profile up ON up.auth_user_id = auth.uid()
    WHERE n.id = substring(realtime.topic() FROM 11)::uuid
      AND (
        n.owner_user_id = up.id
        OR EXISTS (
          SELECT 1 FROM public.note_shares ns
          WHERE ns.note_id = n.id AND ns.shared_with_user_id = up.id AND ns.permission = 'edit'
        )
      )
  )
);

-- note:canvas:<uuid> — the Excalidraw canvas. ALSO joined by the
-- unauthenticated public read-only view (PublicCanvasView.jsx, readOnly:
-- true, anon Supabase client) when the note is published (is_public = true),
-- so the receive policy additionally allows `anon` for public notes. Sending
-- is never done by the public view — insert stays authenticated-only, same
-- owner/edit-share rule as ydoc.

CREATE POLICY "note_canvas_receive" ON "realtime"."messages"
FOR SELECT
TO anon, authenticated
USING (
  realtime.topic() ~ '^note:canvas:[0-9a-fA-F-]{36}$'
  AND (
    EXISTS (
      SELECT 1 FROM public.notes n
      WHERE n.id = substring(realtime.topic() FROM 13)::uuid AND n.is_public = true
    )
    OR (
      auth.role() = 'authenticated'
      AND EXISTS (
        SELECT 1
        FROM public.notes n
        JOIN public.user_profile up ON up.auth_user_id = auth.uid()
        WHERE n.id = substring(realtime.topic() FROM 13)::uuid
          AND (
            n.owner_user_id = up.id
            OR EXISTS (
              SELECT 1 FROM public.note_shares ns
              WHERE ns.note_id = n.id AND ns.shared_with_user_id = up.id
            )
          )
      )
    )
  )
);

CREATE POLICY "note_canvas_send" ON "realtime"."messages"
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.topic() ~ '^note:canvas:[0-9a-fA-F-]{36}$'
  AND EXISTS (
    SELECT 1
    FROM public.notes n
    JOIN public.user_profile up ON up.auth_user_id = auth.uid()
    WHERE n.id = substring(realtime.topic() FROM 13)::uuid
      AND (
        n.owner_user_id = up.id
        OR EXISTS (
          SELECT 1 FROM public.note_shares ns
          WHERE ns.note_id = n.id AND ns.shared_with_user_id = up.id AND ns.permission = 'edit'
        )
      )
  )
);
