-- RME3 Connections (spec 2026-10-03-rme3-module-platform-v2 §10.1-10.2):
-- registry/config per company and the central index kept by triggers that
-- Runly ORM creates on each connected source table at module install time.
BEGIN;

CREATE TABLE public.module_connection (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  connection_key text NOT NULL,
  kind text NOT NULL,
  target_type text NOT NULL,
  source_entity text NOT NULL,
  source_table text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  field_config jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  offered_version text,
  needs_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_connection_kind_check CHECK (kind IN ('fields','related')),
  CONSTRAINT module_connection_status_check CHECK (status IN ('pending','active','disabled'))
);
CREATE UNIQUE INDEX module_connection_company_id_module_key_connection_key_key ON public.module_connection(company_id, module_key, connection_key);
CREATE INDEX module_connection_company_id_target_type_status_idx ON public.module_connection(company_id, target_type, status);

CREATE TABLE public.connection_record (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  module_key text NOT NULL,
  connection_key text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  source_record_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_text tsvector,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX connection_record_module_key_connection_key_source_record_id_key ON public.connection_record(module_key, connection_key, source_record_id);
CREATE INDEX connection_record_company_id_target_type_target_id_idx ON public.connection_record(company_id, target_type, target_id);
CREATE INDEX connection_record_module_key_connection_key_idx ON public.connection_record(module_key, connection_key);
CREATE INDEX connection_record_search_idx ON public.connection_record USING gin(search_text);

-- Served only through Hono; keep Data API roles away (same as other domain tables).
REVOKE ALL ON public.module_connection, public.connection_record FROM anon, authenticated;

COMMIT;
