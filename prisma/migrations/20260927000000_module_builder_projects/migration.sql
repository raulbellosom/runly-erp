-- Module Builder persistence (No-Code Module Builder MVP). A project's
-- `definition` column is the draft ModuleDefinition JSON consumed by
-- @runly/module-compiler; it is never itself an installed module. Ownership
-- is company-scoped (the creating company owns/edits the draft) but the
-- compiled artifact is always an instance-wide RunlyModule, activated per
-- company via CompanyModule, matching every other RME3 module. See
-- docs/superpowers/specs/2026-09-27-rme3-no-code-module-builder-architecture.md §21.

CREATE TYPE module_builder_project_status AS ENUM ('DRAFT', 'VALIDATED', 'PUBLISHED');

CREATE TABLE public.module_builder_project (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  module_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  status module_builder_project_status NOT NULL DEFAULT 'DRAFT',
  schema_version integer NOT NULL DEFAULT 1,
  definition jsonb NOT NULL,
  published_definition jsonb,
  published_package_hash text,
  published_version text,
  detached_at timestamptz,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX module_builder_project_company_status_idx ON public.module_builder_project(company_id, status);
ALTER TABLE public.module_builder_project ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.module_builder_project FROM PUBLIC, anon, authenticated;

CREATE TABLE public.module_builder_revision (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  project_id uuid NOT NULL REFERENCES public.module_builder_project(id) ON DELETE CASCADE,
  revision_number integer NOT NULL,
  definition jsonb NOT NULL,
  definition_hash text NOT NULL,
  published boolean NOT NULL DEFAULT false,
  package_hash text,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, revision_number)
);
CREATE INDEX module_builder_revision_project_created_idx ON public.module_builder_revision(project_id, created_at DESC);
ALTER TABLE public.module_builder_revision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.module_builder_revision FROM PUBLIC, anon, authenticated;
