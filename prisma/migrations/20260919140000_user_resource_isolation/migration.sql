-- Identity is global; membership and resource grants determine access.
-- Unknown historical scopes are quarantined, never assigned to a guessed company.
BEGIN;

ALTER TABLE public.chat_conversation_members ADD COLUMN external_access boolean NOT NULL DEFAULT false;
ALTER TABLE public.note_shares ADD COLUMN external_access boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.runly_member_active(p_company uuid, p_user uuid, p_permission text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membership m
    JOIN public.user_profile u ON u.id = m.user_id AND u.enabled
    JOIN public.company c ON c.id = m.company_id AND c.enabled
    LEFT JOIN public.role r ON r.id = m.role_id
    WHERE m.company_id = p_company AND m.user_id = p_user AND m.enabled
      AND (m.role_id IS NULL OR (r.enabled AND (r.company_id IS NULL OR r.company_id = m.company_id)))
      AND (p_permission IS NULL OR r.key IN ('runly.admin', 'atlas.admin') OR (r.key = 'system.admin' AND r.company_id IS NULL)
        OR EXISTS (SELECT 1 FROM public.role_permission rp JOIN public.permission p ON p.id = rp.permission_id
          WHERE rp.role_id = r.id AND p.key = p_permission AND p.active)
        OR EXISTS (SELECT 1 FROM public.user_permission_grant g JOIN public.permission p ON p.id = g.permission_id
          WHERE g.company_id = m.company_id AND g.user_id = m.user_id AND p.key = p_permission AND p.active))
  );
$$;

CREATE FUNCTION public.runly_chat_user_access(p_conversation uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_conversation_members m
    JOIN public.chat_conversations c ON c.id = m.conversation_id AND c.deleted_at IS NULL
    JOIN public.user_profile u ON u.id = m.user_id AND u.enabled
    JOIN public.company co ON co.id = c.company_id AND co.enabled
    WHERE m.conversation_id = p_conversation AND m.user_id = p_user AND m.left_at IS NULL
      AND (m.external_access OR public.runly_member_active(c.company_id, p_user, 'chat.conversations.read'))
  );
$$;

CREATE FUNCTION public.runly_note_user_access(p_note uuid, p_user uuid, p_edit boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.notes n
    JOIN public.user_profile u ON u.id = p_user AND u.enabled
    LEFT JOIN public.note_shares s ON s.note_id = n.id AND s.shared_with_user_id = p_user
    WHERE n.id = p_note AND n.deleted_at IS NULL
      AND (n.company_id IS NULL OR EXISTS (SELECT 1 FROM public.company c WHERE c.id = n.company_id AND c.enabled))
      AND ((n.owner_user_id = p_user AND (n.company_id IS NULL OR public.runly_member_active(n.company_id, p_user, 'notes.notes.read')))
        OR (s.id IS NOT NULL AND (NOT p_edit OR s.permission = 'edit')
          AND (s.external_access OR public.runly_member_active(n.company_id, p_user, 'notes.notes.read'))))
  );
$$;

REVOKE ALL ON FUNCTION public.runly_member_active(uuid, uuid, text), public.runly_chat_user_access(uuid, uuid), public.runly_note_user_access(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.current_profile_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM public.user_profile WHERE auth_user_id = auth.uid() AND enabled;
$$;
CREATE OR REPLACE FUNCTION public.company_is_member(p_company_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.runly_member_active(p_company_id, public.current_profile_id());
$$;
CREATE OR REPLACE FUNCTION public.chat_is_member(p_conversation_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.runly_chat_user_access(p_conversation_id, public.current_profile_id());
$$;
CREATE OR REPLACE FUNCTION public.notes_realtime_can_access(p_note_id uuid, p_require_edit boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.runly_note_user_access(p_note_id, public.current_profile_id(), p_require_edit);
$$;
CREATE OR REPLACE FUNCTION public.notes_realtime_is_public(p_note_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.notes n WHERE n.id = p_note_id AND n.is_public AND n.deleted_at IS NULL
    AND (n.company_id IS NULL OR EXISTS (SELECT 1 FROM public.company c WHERE c.id = n.company_id AND c.enabled)));
$$;

-- A participant row without company eligibility is not an external invitation.
UPDATE public.chat_conversation_members m SET left_at = now()
FROM public.chat_conversations c WHERE c.id = m.conversation_id AND m.user_id IS NOT NULL AND m.left_at IS NULL
  AND NOT public.runly_member_active(c.company_id, m.user_id)
  AND NOT EXISTS (SELECT 1 FROM public.user_profile u WHERE u.id = m.user_id AND u.is_bot);

DROP INDEX IF EXISTS public.chat_conversations_one_mirai_per_user_idx;
DROP INDEX IF EXISTS public.chat_conversations_one_meridian_per_user_idx;
CREATE UNIQUE INDEX chat_conversations_one_mirai_per_company_user_idx
ON public.chat_conversations (created_by_user_id, company_id) WHERE type = 'mirai' AND deleted_at IS NULL;

-- Backend-owned tables cannot be queried or mutated through PostgREST.
-- RLS remains a second boundary if someone accidentally grants access later.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t.tablename);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;

-- Only these source tables are consumed through postgres_changes; existing
-- participant/self policies govern reads. Writes always go through Hono.
GRANT SELECT ON public.chat_conversations, public.chat_conversation_members,
  public.chat_messages, public.chat_message_reads, public.chat_attachments,
  public.notification, public.call, public.call_participant TO authenticated;

CREATE POLICY runly_notification_current_membership ON public.notification
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (user_id = public.current_profile_id() AND public.company_is_member(company_id));

COMMIT;
