import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AttachmentsPanel,
  Button,
  ErrorState,
  FormCompletionRing,
  PageHeader,
  SectionCard,
  SectionIndex,
  Skeleton,
} from "@runly/ui";
import { contactFormSchema } from "@runly/validators";
import { AlertTriangle, ArrowLeft, AtSign, Eye, Paperclip, Plug, Building2, Landmark, MapPin, StickyNote, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider";
import { runly } from "../../../lib/runly";
import { FiscalSection, GeneralSection, NotesSection } from "../components/form/ContactFormBasics";
import {
  AddressesSection,
  ChannelsSection,
  EMPTY_CHANNEL,
  PeopleSection,
} from "../components/form/ContactFormCollections";
import { useDuplicateCheck } from "../hooks/useDuplicateCheck";
import { CONTACT_ATTACHMENTS_CONFIG } from "../lib/attachments";
import { useConnectionForm } from "../../../shell/connections/useConnectionForm.js";
import { ConnectionFormSections } from "../../../shell/connections/ConnectionFormSections.jsx";
import { getApiUrl } from "../../../lib/runtimeConfig.js";

const LIST_PATH = "/app/m/runly.contacts/contacts";

function useRouteContactId() {
  const { "*": wildcard } = useParams();
  return useMemo(() => {
    const segs = String(wildcard ?? "").replace(/^\/+/, "").split("/").filter(Boolean);
    return segs[1] && segs[1] !== "new" ? segs[1] : null;
  }, [wildcard]);
}

const text = (value) => value ?? "";

function toFormValues(contact) {
  if (!contact) {
    return {
      type: "company", name: "", legalName: "", industry: "", website: "", tags: [],
      taxId: "", taxRegime: "", fiscalPostalCode: "", cfdiUse: "", notesMarkdown: "",
      channels: [{ ...EMPTY_CHANNEL("phone"), isPrimary: true }, { ...EMPTY_CHANNEL("email"), isPrimary: true }],
      addresses: [],
      persons: [],
    };
  }
  return {
    type: contact.type,
    name: contact.name,
    legalName: text(contact.legalName),
    industry: text(contact.industry),
    website: text(contact.website),
    tags: contact.tags ?? [],
    taxId: text(contact.taxId),
    taxRegime: text(contact.taxRegime),
    fiscalPostalCode: text(contact.fiscalPostalCode),
    cfdiUse: text(contact.cfdiUse),
    notesMarkdown: text(contact.notesMarkdown),
    channels: (contact.channels ?? []).map((c) => ({
      id: c.id, kind: c.kind, label: c.label ?? "other", value: c.value,
      countryCode: c.countryCode ?? (c.kind === "phone" ? "+52" : ""), isPrimary: Boolean(c.isPrimary),
    })),
    addresses: (contact.addresses ?? []).map((a) => ({
      id: a.id, kind: a.kind, label: text(a.label), street: a.street, extNumber: text(a.extNumber),
      intNumber: text(a.intNumber), neighborhood: text(a.neighborhood), postalCode: text(a.postalCode),
      city: text(a.city), state: text(a.state), country: a.country ?? "MX", isDefault: Boolean(a.isDefault),
    })),
    persons: (contact.persons ?? []).map((p) => ({
      id: p.id, name: p.name, role: text(p.role), phone: text(p.phone), email: text(p.email), isPrimary: Boolean(p.isPrimary),
    })),
  };
}

// Blank repeatable rows are dropped instead of failing validation.
function cleanCollections(values) {
  return {
    ...values,
    channels: (values.channels ?? []).filter((c) => String(c.value ?? "").trim()),
    addresses: (values.addresses ?? []).filter((a) => String(a.street ?? "").trim()),
    persons: (values.persons ?? []).filter((p) => String(p.name ?? "").trim()),
  };
}

function toPayload(values) {
  const stripId = (row) => ({ ...row, id: row.id || undefined });
  return {
    ...values,
    channels: values.channels.map(stripId),
    addresses: values.addresses.map(stripId),
    persons: values.type === "person" ? [] : values.persons.map(stripId),
  };
}

const COMPLETION_CHECKS = [
  (v) => v.name, (v) => v.legalName, (v) => v.industry, (v) => v.taxId, (v) => v.taxRegime,
  (v) => v.fiscalPostalCode, (v) => v.cfdiUse,
  (v) => v.channels?.some((c) => c.kind === "phone" && c.value),
  (v) => v.channels?.some((c) => c.kind === "email" && c.value),
  (v) => v.addresses?.some((a) => a.street),
];

export default function ContactFormScreen() {
  const contactId = useRouteContactId();
  const isEdit = Boolean(contactId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Connected modules' sections, saved atomically with the contact (Connections D3).
  const connectionForm = useConnectionForm({ targetType: "contact", targetId: contactId ?? null });
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const { activeCompanyId } = useActiveCompany();
  const [scrollRoot, setScrollRoot] = useState(null);
  const [avatarPending, setAvatarPending] = useState(null);
  const attachmentsController = useRef(null);

  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (key) => Boolean(userProfile?.isAdmin || permissions.includes(key));
  const allowed = hasPermission(isEdit ? "contacts.contacts.update" : "contacts.contacts.create");
  const canReadFiles = hasPermission("files.assets.read");
  const canCreateFiles = hasPermission("files.assets.create");

  const profileQuery = useQuery({
    queryKey: ["contact-profile", contactId, activeCompanyId],
    queryFn: () => runly.contacts.getProfile(contactId, token),
    enabled: Boolean(isEdit && token && allowed),
    retry: false,
  });
  const contact = profileQuery.data?.data ?? null;

  const form = useForm({
    resolver: async (values, context, options) =>
      zodResolver(contactFormSchema)(cleanCollections(values), context, options),
    defaultValues: toFormValues(null),
    mode: "onSubmit",
  });
  const { handleSubmit, reset, watch, formState } = form;

  useEffect(() => {
    if (contact) reset(toFormValues(contact));
  }, [contact, reset]);

  const values = watch();
  const filled = COMPLETION_CHECKS.filter((check) => check(values)).length;
  const duplicates = useDuplicateCheck({ values, excludeId: contactId, token });
  const detailPath = (id) => `${LIST_PATH}/${id}`;

  const saveMutation = useMutation({
    mutationFn: async (formValues) => {
      const payload = { ...toPayload(formValues), connections: connectionForm.payload() ?? undefined };
      let saved;
      try {
        saved = isEdit
          ? await runly.contacts.update(contactId, payload, token)
          : await runly.contacts.create(payload, token);
      } catch (err) {
        connectionForm.applyErrorResponse(err?.details);
        throw err;
      }
      const id = saved?.data?.id ?? contactId;
      if (avatarPending instanceof File) {
        await runly.contacts.uploadAvatar(id, avatarPending, token).catch(() => {
          toast.error("El contacto se guardó, pero no se pudo subir la foto");
        });
      } else if (avatarPending === "remove") {
        await runly.contacts.removeAvatar(id, token).catch(() => {});
      }
      // New contacts stage their files until the record exists.
      if (!isEdit && attachmentsController.current?.flushPending) {
        const result = await attachmentsController.current.flushPending(id);
        if (result?.failed?.length) toast.error("El contacto se guardó, pero algunos archivos no se subieron");
      }
      return id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["contact-profile", id] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      toast.success(isEdit ? "Contacto actualizado" : "Contacto creado");
      navigate(detailPath(id));
    },
    onError: (err) => toast.error(err?.message || "No se pudo guardar el contacto"),
  });

  const onInvalid = () => toast.error("Revisa los campos marcados.");
  const cancel = () => navigate(isEdit ? detailPath(contactId) : LIST_PATH);

  if (!allowed) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState title={isEdit ? "No tienes permisos para editar contactos." : "No tienes permisos para crear contactos."} />
      </div>
    );
  }
  if (isEdit && profileQuery.isLoading) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }
  if (isEdit && !contact) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState title="Contacto no encontrado" />
      </div>
    );
  }

  const showPeople = values.type !== "person";
  const sections = [
    { id: "cf-general", label: "General", icon: Building2 },
    { id: "cf-contacto", label: "Canales de contacto", icon: AtSign, badge: values.channels?.length || null },
    { id: "cf-fiscal", label: "Datos fiscales", icon: Landmark },
    { id: "cf-direcciones", label: "Direcciones", icon: MapPin, badge: values.addresses?.length || null },
    ...(showPeople ? [{ id: "cf-personas", label: "Personas clave", icon: Users, badge: values.persons?.length || null }] : []),
    { id: "cf-notas", label: "Notas", icon: StickyNote },
    ...(connectionForm.sections.length ? [{ id: "cf-conexiones", label: "Módulos conectados", icon: Plug }] : []),
    ...(canReadFiles ? [{ id: "cf-archivos", label: "Archivos", icon: Paperclip }] : []),
  ];

  return (
    <form
      onSubmit={handleSubmit((v) => saveMutation.mutate(v), onInvalid)}
      className="flex h-full min-h-0 flex-col"
      noValidate
    >
      <div className="shrink-0 px-4 pt-4 md:px-6 md:pt-6">
        <PageHeader
          eyebrow={isEdit ? "Editar contacto" : "Runly Contacts"}
          title={isEdit ? contact?.name ?? "Editar contacto" : "Nuevo contacto"}
          actions={
            <Button type="button" variant="outline" onClick={cancel}>
              {isEdit ? <Eye className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
              {isEdit ? "Ver detalle" : "Volver a contactos"}
            </Button>
          }
        />
      </div>

      <div ref={setScrollRoot} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:flex-row md:p-6">
          <aside className="md:w-56 md:shrink-0">
            <div className="md:sticky md:top-0 space-y-4">
              <SectionIndex
                sections={sections}
                scrollRoot={scrollRoot}
                title="Secciones"
                footer={
                  <div className="mt-4 rounded-xl border border-[hsl(var(--border))] p-3">
                    <FormCompletionRing
                      percent={Math.round((filled / COMPLETION_CHECKS.length) * 100)}
                      filledCount={filled}
                      totalCount={COMPLETION_CHECKS.length}
                    />
                  </div>
                }
              />
            </div>
          </aside>

          <div className="min-w-0 flex-1 space-y-5 pb-6">
            {duplicates.length > 0 && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                <div className="min-w-0 flex-1 space-y-1">
                  {duplicates.map((dup) => (
                    <p key={dup.id}>
                      Ya existe un contacto con {dup.matchedOn === "taxId" ? "este RFC" : dup.matchedOn === "email" ? "este correo" : "este teléfono"}:{" "}
                      <Link to={detailPath(dup.id)} target="_blank" className="font-semibold text-[hsl(var(--primary))] hover:underline">
                        {dup.name}
                      </Link>
                    </p>
                  ))}
                </div>
              </div>
            )}

            <section id="cf-general" className="scroll-mt-4">
              <SectionCard title="1. Datos generales">
                <GeneralSection
                  form={form}
                  token={token}
                  avatarUrl={contact?.avatarUrl}
                  avatarPending={avatarPending}
                  setAvatarPending={setAvatarPending}
                />
              </SectionCard>
            </section>
            <section id="cf-contacto" className="scroll-mt-4">
              <SectionCard title="2. Canales de contacto" description="Marca uno como principal por tipo; es el que se muestra en listas y otros módulos.">
                <ChannelsSection form={form} />
              </SectionCard>
            </section>
            <section id="cf-fiscal" className="scroll-mt-4">
              <SectionCard title="3. Datos fiscales" description="Catálogos del SAT para CFDI 4.0.">
                <FiscalSection form={form} />
              </SectionCard>
            </section>
            <section id="cf-direcciones" className="scroll-mt-4">
              <SectionCard title="4. Direcciones">
                <AddressesSection form={form} />
              </SectionCard>
            </section>
            {showPeople && (
              <section id="cf-personas" className="scroll-mt-4">
                <SectionCard title="5. Personas clave" description="Las personas con las que tratas dentro de esta empresa.">
                  <PeopleSection form={form} />
                </SectionCard>
              </section>
            )}
            <section id="cf-notas" className="scroll-mt-4">
              <SectionCard title={`${showPeople ? 6 : 5}. Notas internas`}>
                <NotesSection form={form} />
              </SectionCard>
            </section>
            {connectionForm.sections.length > 0 && (
              <section id="cf-conexiones" className="scroll-mt-4">
                <ConnectionFormSections form={connectionForm} />
              </section>
            )}
            {canReadFiles && (
              <section id="cf-archivos" className="scroll-mt-4">
                <SectionCard
                  title={`${showPeople ? 7 : 6}. Archivos`}
                  description="Constancia fiscal, contratos, CFDI en XML o comprimidos en ZIP/RAR."
                >
                  <AttachmentsPanel
                    apiBaseUrl={getApiUrl()}
                    token={token}
                    companyId={activeCompanyId}
                    recordId={contactId}
                    config={CONTACT_ATTACHMENTS_CONFIG}
                    context="form"
                    readOnly={!canCreateFiles}
                    showHeading={false}
                    onControllerReady={(controller) => {
                      attachmentsController.current = controller;
                    }}
                    onChange={() => {
                      if (contactId) queryClient.invalidateQueries({ queryKey: ["contact-activity", contactId] });
                    }}
                    onError={(message) => message && toast.error(message)}
                  />
                </SectionCard>
              </section>
            )}
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-3 md:px-6">
        <Button type="button" variant="outline" onClick={cancel} disabled={saveMutation.isPending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saveMutation.isPending || (isEdit && !formState.isDirty && !avatarPending && !connectionForm.dirty)}>
          {saveMutation.isPending ? "Guardando..." : "Guardar contacto"}
        </Button>
      </footer>
    </form>
  );
}
