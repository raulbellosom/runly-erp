-- Retire "atlas.admin" as a live role key. Fresh installs have seeded
-- "runly.admin" since migration 20260913-era catalog rename; "atlas.admin"
-- was only kept in application guards for installs seeded before that
-- rebrand. This repo's environment has no persisted "atlas.admin" data
-- (confirmed 2026-09-23), so this migration is expected to be a no-op here,
-- but is written defensively/idempotently for any environment that does
-- carry the legacy key.
--
-- Spec: docs/superpowers/specs/2026-09-23-identity-user-sessions-design.md
--
-- For every role row with key = 'atlas.admin':
--   - if a sibling 'runly.admin' role already exists in the same company
--     scope (company_id compared NULL-safe, since company_id can be NULL
--     for the system scope), reassign its memberships and role_permission
--     rows onto the sibling, then drop the now-orphaned atlas.admin row;
--   - otherwise, just rename the row's key in place.
DO $$
DECLARE
  legacy RECORD;
  target_id uuid;
BEGIN
  FOR legacy IN SELECT id, company_id FROM "role" WHERE key = 'atlas.admin' LOOP
    SELECT id INTO target_id
    FROM "role"
    WHERE key = 'runly.admin'
      AND company_id IS NOT DISTINCT FROM legacy.company_id
    LIMIT 1;

    IF target_id IS NOT NULL THEN
      UPDATE "membership" SET role_id = target_id WHERE role_id = legacy.id;

      INSERT INTO "role_permission" (id, role_id, permission_id)
      SELECT gen_random_uuid(), target_id, rp.permission_id
      FROM "role_permission" rp
      WHERE rp.role_id = legacy.id
      ON CONFLICT (role_id, permission_id) DO NOTHING;

      DELETE FROM "role_permission" WHERE role_id = legacy.id;
      DELETE FROM "role" WHERE id = legacy.id;
    ELSE
      UPDATE "role" SET key = 'runly.admin' WHERE id = legacy.id;
    END IF;
  END LOOP;
END $$;

-- Realtime/RLS admin-bypass check: same signature as the original
-- (20260919140000_user_resource_isolation), only the admin-key branch
-- changes — no dependent policy or grant needs to be touched.
CREATE OR REPLACE FUNCTION public.runly_member_active(p_company uuid, p_user uuid, p_permission text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membership m
    JOIN public.user_profile u ON u.id = m.user_id AND u.enabled
    JOIN public.company c ON c.id = m.company_id AND c.enabled
    LEFT JOIN public.role r ON r.id = m.role_id
    WHERE m.company_id = p_company AND m.user_id = p_user AND m.enabled
      AND (m.role_id IS NULL OR (r.enabled AND (r.company_id IS NULL OR r.company_id = m.company_id)))
      AND (p_permission IS NULL OR r.key = 'runly.admin' OR (r.key = 'system.admin' AND r.company_id IS NULL)
        OR EXISTS (SELECT 1 FROM public.role_permission rp JOIN public.permission p ON p.id = rp.permission_id
          WHERE rp.role_id = r.id AND p.key = p_permission AND p.active)
        OR EXISTS (SELECT 1 FROM public.user_permission_grant g JOIN public.permission p ON p.id = g.permission_id
          WHERE g.company_id = m.company_id AND g.user_id = m.user_id AND p.key = p_permission AND p.active))
  );
$$;
