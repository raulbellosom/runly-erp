CREATE TABLE public.collaboration_invitation (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  token_hash text NOT NULL UNIQUE,
  resource_type text NOT NULL CHECK (resource_type IN ('chat', 'note')),
  resource_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.user_profile(id),
  permission text NOT NULL CHECK (permission IN ('read', 'edit')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  accepted_by uuid REFERENCES public.user_profile(id),
  accepted_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX collaboration_invitation_resource_idx ON public.collaboration_invitation(resource_type, resource_id);
ALTER TABLE public.collaboration_invitation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.collaboration_invitation FROM PUBLIC, anon, authenticated;
