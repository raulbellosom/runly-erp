BEGIN;
-- Revoke corporate participant grants when their source membership disappears.
-- Explicit external grants are independent and are revoked on the resource.
CREATE FUNCTION public.runly_prune_membership_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.chat_conversation_members m SET left_at = now()
    FROM public.chat_conversations c, public.user_profile u
    WHERE c.id = m.conversation_id AND u.id = m.user_id
      AND m.left_at IS NULL AND NOT m.external_access AND NOT u.is_bot
      AND NOT public.runly_member_active(c.company_id, m.user_id, 'chat.conversations.read');
  DELETE FROM public.note_shares s USING public.notes n
    WHERE n.id = s.note_id AND NOT s.external_access
      AND NOT public.runly_member_active(n.company_id, s.shared_with_user_id, 'notes.notes.read');
  DELETE FROM public.calendar_share s USING public.calendar_calendar c
    WHERE c.id = s.calendar_id AND c.company_id IS NOT NULL
      AND NOT public.runly_member_active(c.company_id, s.user_id);
  DELETE FROM public.project_member m USING public.project p
    WHERE p.id = m.project_id AND NOT public.runly_member_active(p.company_id, m.user_id, 'projects.project.read');
  UPDATE public.notification_delivery d SET status = 'failed', last_error = 'Access revoked'
    FROM public.notification n WHERE n.id = d.notification_id AND d.status IN ('queued', 'sending')
      AND NOT public.runly_member_active(n.company_id, n.user_id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.runly_prune_membership_access() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER runly_membership_revocation AFTER UPDATE OF enabled, role_id OR DELETE ON public.membership
  FOR EACH STATEMENT EXECUTE FUNCTION public.runly_prune_membership_access();
CREATE TRIGGER runly_role_revocation AFTER UPDATE OF enabled OR DELETE ON public.role
  FOR EACH STATEMENT EXECUTE FUNCTION public.runly_prune_membership_access();
CREATE TRIGGER runly_permission_revocation AFTER UPDATE OF active ON public.permission
  FOR EACH STATEMENT EXECUTE FUNCTION public.runly_prune_membership_access();
CREATE CONSTRAINT TRIGGER runly_role_permission_revocation AFTER DELETE ON public.role_permission
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.runly_prune_membership_access();
CREATE CONSTRAINT TRIGGER runly_grant_revocation AFTER DELETE ON public.user_permission_grant
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.runly_prune_membership_access();
CREATE TRIGGER runly_profile_revocation AFTER UPDATE OF enabled ON public.user_profile
  FOR EACH STATEMENT EXECUTE FUNCTION public.runly_prune_membership_access();
CREATE TRIGGER runly_company_revocation AFTER UPDATE OF enabled ON public.company
  FOR EACH STATEMENT EXECUTE FUNCTION public.runly_prune_membership_access();

-- Protect cross-company references even for writes made outside the HTTP API.
CREATE FUNCTION public.runly_validate_user_reference() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE co uuid; target uuid; v_project_id uuid; row_data jsonb := to_jsonb(NEW);
BEGIN
  -- Keep historical assignees on ordinary edits; validate changes to the
  -- reference or its enclosing resource, as well as every insert.
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME <> 'membership'
    AND (to_jsonb(OLD) -> TG_ARGV[0]) IS NOT DISTINCT FROM (row_data -> TG_ARGV[0])
    AND (to_jsonb(OLD) -> 'company_id') IS NOT DISTINCT FROM (row_data -> 'company_id')
    AND (to_jsonb(OLD) -> 'project_id') IS NOT DISTINCT FROM (row_data -> 'project_id')
    AND (to_jsonb(OLD) -> 'task_id') IS NOT DISTINCT FROM (row_data -> 'task_id')
    AND (to_jsonb(OLD) -> 'account_id') IS NOT DISTINCT FROM (row_data -> 'account_id')
    AND (to_jsonb(OLD) -> 'group_id') IS NOT DISTINCT FROM (row_data -> 'group_id')
    AND (to_jsonb(OLD) -> 'calendar_id') IS NOT DISTINCT FROM (row_data -> 'calendar_id')
    AND (to_jsonb(OLD) -> 'event_id') IS NOT DISTINCT FROM (row_data -> 'event_id')
    AND (to_jsonb(OLD) -> 'comment_id') IS NOT DISTINCT FROM (row_data -> 'comment_id') THEN RETURN NEW; END IF;
  target := (row_data ->> TG_ARGV[0])::uuid;
  IF target IS NULL THEN RETURN NEW; END IF;
  CASE TG_TABLE_NAME
    WHEN 'membership' THEN
      IF NEW.role_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.role r WHERE r.id = NEW.role_id AND (r.company_id IS NULL OR r.company_id = NEW.company_id)) THEN
        RAISE EXCEPTION 'Resource unavailable' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    WHEN 'project_member' THEN SELECT company_id INTO co FROM public.project WHERE id = NEW.project_id;
    WHEN 'task' THEN SELECT company_id INTO co FROM public.project WHERE id = NEW.project_id; v_project_id := NEW.project_id;
    WHEN 'project_task_assignee' THEN SELECT p.company_id, p.id INTO co, v_project_id FROM public.task t JOIN public.project p ON p.id = t.project_id WHERE t.id = NEW.task_id;
    WHEN 'pos_order' THEN co := NEW.company_id;
    WHEN 'ledger_account_member' THEN SELECT company_id INTO co FROM public.ledger_account WHERE id = NEW.account_id;
    WHEN 'ledger_group_member' THEN SELECT company_id INTO co FROM public.ledger_group WHERE id = NEW.group_id;
    WHEN 'calendar_share' THEN SELECT company_id INTO co FROM public.calendar_calendar WHERE id = NEW.calendar_id;
    WHEN 'calendar_event_attendee' THEN SELECT c.company_id INTO co FROM public.calendar_event e JOIN public.calendar_calendar c ON c.id = e.calendar_id WHERE e.id = NEW.event_id;
    WHEN 'entity_comment_mention' THEN SELECT company_id INTO co FROM public.entity_comment WHERE id = NEW.comment_id;
    WHEN 'inv_mention' THEN SELECT company_id INTO co FROM public.inv_comment WHERE id = NEW.comment_id;
    ELSE RAISE EXCEPTION 'Unsupported user reference';
  END CASE;
  IF NOT public.runly_member_active(co, target) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE = '42501'; END IF;
  IF v_project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.project_member m WHERE m.project_id = v_project_id AND m.user_id = target)
    AND NOT EXISTS (SELECT 1 FROM public.project p WHERE p.id = v_project_id AND p.owner_id = target) THEN
    RAISE EXCEPTION 'Resource unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.runly_validate_user_reference() FROM PUBLIC, anon, authenticated;
DO $$ DECLARE t text; col text; BEGIN
  FOREACH t IN ARRAY ARRAY['membership','project_member','project_task_assignee','task','pos_order','ledger_account_member','ledger_group_member','calendar_share','calendar_event_attendee','entity_comment_mention','inv_mention'] LOOP
    col := CASE t WHEN 'task' THEN 'assignee_id' WHEN 'pos_order' THEN 'waiter_id' ELSE 'user_id' END;
    EXECUTE format('CREATE TRIGGER runly_user_reference BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.runly_validate_user_reference(%L)', t, col);
  END LOOP;
END $$;
-- Apply the same quarantine to development data already present at upgrade.
-- Statement triggers run once even when this touches no membership rows.
UPDATE public.membership SET enabled = enabled WHERE false;
DELETE FROM public.project_task_assignee a USING public.task t, public.project p
  WHERE t.id = a.task_id AND p.id = t.project_id AND NOT public.runly_member_active(p.company_id, a.user_id, 'projects.project.read');
UPDATE public.task t SET assignee_id = NULL FROM public.project p
  WHERE p.id = t.project_id AND t.assignee_id IS NOT NULL AND NOT public.runly_member_active(p.company_id, t.assignee_id, 'projects.project.read');
UPDATE public.pos_order SET waiter_id = NULL WHERE waiter_id IS NOT NULL AND NOT public.runly_member_active(company_id, waiter_id);
DELETE FROM public.ledger_account_member m USING public.ledger_account a
  WHERE a.id = m.account_id AND NOT public.runly_member_active(a.company_id, m.user_id);
DELETE FROM public.ledger_group_member m USING public.ledger_group g
  WHERE g.id = m.group_id AND NOT public.runly_member_active(g.company_id, m.user_id);
COMMIT;
