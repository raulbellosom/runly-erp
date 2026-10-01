BEGIN;

CREATE TABLE public.canvas_board (
  id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.user_profile(id), created_by_id uuid NOT NULL REFERENCES public.user_profile(id),
  updated_by_id uuid NOT NULL REFERENCES public.user_profile(id), name text NOT NULL, description text,
  template_type text NOT NULL DEFAULT 'blank', thumbnail_file_id uuid REFERENCES public.file_asset(id) ON DELETE SET NULL,
  settings jsonb, metadata jsonb, current_version_id uuid, archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX canvas_board_company_archived_updated_idx ON public.canvas_board(company_id, archived_at, updated_at DESC);
CREATE INDEX canvas_board_owner_updated_idx ON public.canvas_board(owner_id, updated_at DESC);

CREATE TABLE public.canvas_collaborator (
  id uuid PRIMARY KEY DEFAULT uuidv7(), board_id uuid NOT NULL REFERENCES public.canvas_board(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE CASCADE, role text NOT NULL DEFAULT 'VIEWER',
  created_by uuid NOT NULL REFERENCES public.user_profile(id), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(board_id, user_id),
  CONSTRAINT canvas_collaborator_role_check CHECK (role IN ('OWNER','EDITOR','COMMENTER','VIEWER'))
);
CREATE INDEX canvas_collaborator_user_role_idx ON public.canvas_collaborator(user_id, role);

CREATE TABLE public.canvas_page (
  id uuid PRIMARY KEY DEFAULT uuidv7(), board_id uuid NOT NULL REFERENCES public.canvas_board(id) ON DELETE CASCADE,
  name text NOT NULL, position integer NOT NULL, width double precision, height double precision,
  infinite boolean NOT NULL DEFAULT true, background jsonb, coordinate_system jsonb, calibration jsonb, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(board_id, position)
);
CREATE INDEX canvas_page_board_updated_idx ON public.canvas_page(board_id, updated_at DESC);

CREATE TABLE public.canvas_layer (
  id uuid PRIMARY KEY DEFAULT uuidv7(), page_id uuid NOT NULL REFERENCES public.canvas_page(id) ON DELETE CASCADE,
  name text NOT NULL, type text NOT NULL DEFAULT 'vector', position integer NOT NULL, visible boolean NOT NULL DEFAULT true,
  locked boolean NOT NULL DEFAULT false, opacity double precision NOT NULL DEFAULT 1, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(page_id, position),
  CONSTRAINT canvas_layer_opacity_check CHECK (opacity >= 0 AND opacity <= 1)
);
CREATE INDEX canvas_layer_page_type_visible_idx ON public.canvas_layer(page_id, type, visible);

CREATE TABLE public.canvas_object (
  id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  board_id uuid NOT NULL REFERENCES public.canvas_board(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES public.canvas_page(id) ON DELETE CASCADE,
  layer_id uuid NOT NULL REFERENCES public.canvas_layer(id) ON DELETE CASCADE,
  type text NOT NULL, position integer NOT NULL DEFAULT 0, transform jsonb NOT NULL, geometry jsonb NOT NULL,
  style jsonb, properties jsonb, metadata jsonb, revision integer NOT NULL DEFAULT 1,
  created_by_id uuid NOT NULL REFERENCES public.user_profile(id), updated_by_id uuid NOT NULL REFERENCES public.user_profile(id),
  deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canvas_object_revision_check CHECK (revision > 0)
);
CREATE INDEX canvas_object_company_board_page_deleted_idx ON public.canvas_object(company_id, board_id, page_id, deleted_at);
CREATE INDEX canvas_object_page_layer_position_idx ON public.canvas_object(page_id, layer_id, position);
CREATE INDEX canvas_object_board_updated_idx ON public.canvas_object(board_id, updated_at DESC);

CREATE TABLE public.canvas_hotspot (
  id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  board_id uuid NOT NULL REFERENCES public.canvas_board(id) ON DELETE CASCADE,
  object_id uuid NOT NULL UNIQUE REFERENCES public.canvas_object(id) ON DELETE CASCADE,
  title text NOT NULL, description text, icon text, color text, status text NOT NULL DEFAULT 'ACTIVE',
  tags jsonb, custom_fields jsonb, metadata jsonb, created_by_id uuid NOT NULL REFERENCES public.user_profile(id),
  updated_by_id uuid NOT NULL REFERENCES public.user_profile(id), archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX canvas_hotspot_company_board_status_idx ON public.canvas_hotspot(company_id, board_id, status);

CREATE TABLE public.canvas_entity_link (
  id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  board_id uuid NOT NULL REFERENCES public.canvas_board(id) ON DELETE CASCADE, target_type text NOT NULL,
  target_id uuid NOT NULL, module_key text NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL,
  relation_type text NOT NULL DEFAULT 'related', metadata jsonb,
  created_by_id uuid NOT NULL REFERENCES public.user_profile(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(board_id, target_type, target_id, module_key, entity_type, entity_id, relation_type)
);
CREATE INDEX canvas_entity_link_company_entity_idx ON public.canvas_entity_link(company_id, module_key, entity_type, entity_id);
CREATE INDEX canvas_entity_link_board_target_idx ON public.canvas_entity_link(board_id, target_type, target_id);

CREATE TABLE public.canvas_attachment (
  id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  board_id uuid NOT NULL REFERENCES public.canvas_board(id) ON DELETE CASCADE, target_type text NOT NULL,
  target_id uuid NOT NULL, file_asset_id uuid NOT NULL REFERENCES public.file_asset(id) ON DELETE CASCADE,
  label text, position integer NOT NULL DEFAULT 0, created_by_id uuid NOT NULL REFERENCES public.user_profile(id),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(board_id, target_type, target_id, file_asset_id)
);
CREATE INDEX canvas_attachment_company_file_idx ON public.canvas_attachment(company_id, file_asset_id);
CREATE INDEX canvas_attachment_board_target_position_idx ON public.canvas_attachment(board_id, target_type, target_id, position);

CREATE TABLE public.canvas_version (
  id uuid PRIMARY KEY DEFAULT uuidv7(), board_id uuid NOT NULL REFERENCES public.canvas_board(id) ON DELETE CASCADE,
  number integer NOT NULL, name text, description text, snapshot jsonb NOT NULL, object_count integer NOT NULL DEFAULT 0,
  created_by_id uuid NOT NULL REFERENCES public.user_profile(id), restored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(board_id, number)
);
CREATE INDEX canvas_version_board_created_idx ON public.canvas_version(board_id, created_at DESC);
ALTER TABLE public.canvas_board ADD CONSTRAINT canvas_board_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES public.canvas_version(id) ON DELETE SET NULL;

-- Canvas is served only through Hono. Keep Data API roles away from the domain
-- tables even when the public schema is exposed by a Supabase installation.
REVOKE ALL ON public.canvas_board, public.canvas_collaborator, public.canvas_page, public.canvas_layer,
  public.canvas_object, public.canvas_hotspot, public.canvas_entity_link, public.canvas_attachment,
  public.canvas_version FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.runly_canvas_user_access(p_board_id uuid, p_user_id uuid, p_edit boolean DEFAULT false)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.canvas_board b
    JOIN public.membership m ON m.company_id = b.company_id AND m.user_id = p_user_id AND m.enabled
    LEFT JOIN public.canvas_collaborator c ON c.board_id = b.id AND c.user_id = p_user_id
    WHERE b.id = p_board_id AND b.archived_at IS NULL
      AND (b.owner_id = p_user_id OR c.role IS NOT NULL)
      AND (NOT p_edit OR b.owner_id = p_user_id OR c.role IN ('OWNER','EDITOR'))
  );
$$;
REVOKE ALL ON FUNCTION public.runly_canvas_user_access(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.runly_canvas_user_access(uuid, uuid, boolean) TO authenticated;

-- Existing Runly clients append @<authorization revision> to protected topics.
CREATE POLICY canvas_board_receive ON realtime.messages FOR SELECT TO authenticated USING (
  split_part(realtime.topic(), '@', 1) ~ '^canvas:board:[0-9a-fA-F-]{36}$'
  AND split_part(realtime.topic(), '@', 2) = public.runly_realtime_revision()
  AND public.runly_canvas_user_access(
    substring(split_part(realtime.topic(), '@', 1) FROM 14)::uuid,
    public.current_profile_id(), false
  )
);

CREATE TRIGGER runly_realtime_canvas_acl AFTER INSERT OR UPDATE OR DELETE ON public.canvas_collaborator
FOR EACH STATEMENT EXECUTE FUNCTION public.runly_rotate_realtime();
CREATE TRIGGER runly_realtime_canvas_board AFTER UPDATE OF company_id, owner_id, archived_at OR DELETE ON public.canvas_board
FOR EACH STATEMENT EXECUTE FUNCTION public.runly_rotate_realtime();

COMMIT;
