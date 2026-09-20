BEGIN;
CREATE TABLE public.realtime_authorization_revision (id boolean PRIMARY KEY DEFAULT true CHECK (id), revision bigint NOT NULL DEFAULT 1);
INSERT INTO public.realtime_authorization_revision DEFAULT VALUES;
CREATE TABLE public.realtime_user_presence (
  topic text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (topic, user_id)
);
ALTER TABLE public.realtime_authorization_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.realtime_user_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.realtime_authorization_revision, public.realtime_user_presence FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.runly_realtime_revision() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT revision::text FROM public.realtime_authorization_revision WHERE id;
$$;
REVOKE ALL ON FUNCTION public.runly_realtime_revision() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.runly_realtime_revision() TO authenticated, anon;

CREATE FUNCTION public.runly_rotate_realtime() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.realtime_authorization_revision SET revision = revision + 1 WHERE id;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.runly_rotate_realtime() FROM PUBLIC, anon, authenticated;

-- Existing sockets keep cached Realtime authorization. Stop sending to their
-- old topic after any grant changes; receiving clients rejoin the new revision.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['membership', 'role', 'permission', 'role_permission', 'user_permission_grant', 'company', 'note_shares'] LOOP
    EXECUTE format('CREATE TRIGGER runly_realtime_grants AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.runly_rotate_realtime()', t);
  END LOOP;
END $$;
CREATE TRIGGER runly_realtime_profile AFTER UPDATE OF enabled ON public.user_profile FOR EACH STATEMENT EXECUTE FUNCTION public.runly_rotate_realtime();
CREATE TRIGGER runly_realtime_chat_members AFTER UPDATE OF left_at, role, role_id, external_access OR DELETE ON public.chat_conversation_members FOR EACH STATEMENT EXECUTE FUNCTION public.runly_rotate_realtime();
CREATE TRIGGER runly_realtime_chat_resource AFTER UPDATE OF company_id, deleted_at ON public.chat_conversations FOR EACH STATEMENT EXECUTE FUNCTION public.runly_rotate_realtime();
CREATE TRIGGER runly_realtime_note_resource AFTER UPDATE OF company_id, owner_user_id, is_public, deleted_at ON public.notes FOR EACH STATEMENT EXECUTE FUNCTION public.runly_rotate_realtime();
CREATE TRIGGER runly_realtime_guest_resource AFTER UPDATE OF closed_at, expires_at OR DELETE ON public.chat_guest_sessions FOR EACH STATEMENT EXECUTE FUNCTION public.runly_rotate_realtime();
CREATE TRIGGER runly_realtime_channel_roles AFTER UPDATE OR DELETE ON public.chat_channel_roles FOR EACH STATEMENT EXECUTE FUNCTION public.runly_rotate_realtime();

-- Reuse every existing topic policy, including read-only published notes and
-- guest support sessions, while requiring the current revision.
DO $$ DECLARE p record; predicate text; BEGIN
  FOR p IN SELECT * FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages' LOOP
    IF p.qual IS NOT NULL THEN
      predicate := replace(p.qual, 'realtime.topic()', 'split_part(realtime.topic(), ''@'', 1)');
      EXECUTE format('ALTER POLICY %I ON realtime.messages USING ((%s) AND split_part(realtime.topic(), ''@'', 2) = public.runly_realtime_revision())', p.policyname, predicate);
    END IF;
  END LOOP;
END $$;
-- Client writes use the Hono relay, which rechecks access for every event.
-- Native Presence also has cached grants: presence uses authorized heartbeats.
DROP POLICY IF EXISTS runly_realtime_server_writes ON realtime.messages;
CREATE POLICY runly_realtime_server_writes ON realtime.messages AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
COMMIT;
