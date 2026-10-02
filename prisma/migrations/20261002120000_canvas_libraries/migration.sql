BEGIN;

CREATE TABLE public.canvas_library (
  id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.user_profile(id), name text NOT NULL,
  scope text NOT NULL DEFAULT 'PERSONAL', source text NOT NULL DEFAULT 'custom',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canvas_library_scope_check CHECK (scope IN ('PERSONAL','COMPANY')),
  CONSTRAINT canvas_library_source_check CHECK (source IN ('custom','excalidraw','svg','mixed'))
);
CREATE INDEX canvas_library_company_scope_idx ON public.canvas_library(company_id, scope);
CREATE INDEX canvas_library_owner_idx ON public.canvas_library(owner_id);

CREATE TABLE public.canvas_library_item (
  id uuid PRIMARY KEY DEFAULT uuidv7(), library_id uuid NOT NULL REFERENCES public.canvas_library(id) ON DELETE CASCADE,
  name text NOT NULL, kind text NOT NULL, payload jsonb,
  file_asset_id uuid REFERENCES public.file_asset(id) ON DELETE SET NULL,
  width double precision, height double precision, position integer NOT NULL DEFAULT 0,
  created_by_id uuid NOT NULL REFERENCES public.user_profile(id), created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canvas_library_item_kind_check CHECK (kind IN ('objects','image'))
);
CREATE INDEX canvas_library_item_library_position_idx ON public.canvas_library_item(library_id, position);

-- Canvas is served only through Hono. Keep Data API roles away from the
-- domain tables even when the public schema is exposed by a Supabase
-- installation (mirrors 20261001120000_runly_canvas_foundation).
REVOKE ALL ON public.canvas_library, public.canvas_library_item FROM anon, authenticated;

COMMIT;
