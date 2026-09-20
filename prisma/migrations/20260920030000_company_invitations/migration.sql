ALTER TABLE public.collaboration_invitation DROP CONSTRAINT collaboration_invitation_resource_type_check;
ALTER TABLE public.collaboration_invitation ADD CONSTRAINT collaboration_invitation_resource_type_check CHECK (resource_type IN ('chat', 'note', 'company'));
ALTER TABLE public.collaboration_invitation ADD COLUMN email_hash text;
ALTER TABLE public.collaboration_invitation ADD COLUMN role_id uuid REFERENCES public.role(id);
ALTER TABLE public.collaboration_invitation ADD CONSTRAINT collaboration_company_invite_email CHECK (resource_type <> 'company' OR email_hash IS NOT NULL);
