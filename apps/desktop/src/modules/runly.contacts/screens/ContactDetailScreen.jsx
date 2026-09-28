import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityTimeline,
  AttachmentsPanel,
  Button,
  ConfirmDialog,
  ErrorState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@runly/ui";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider";
import { runly } from "../../../lib/runly";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import { ContactHeroCard } from "../components/detail/ContactHeroCard";
import { ContactPeopleTab, ContactSummaryTab } from "../components/detail/ContactSummaryTab";
import { ContactActivityTab } from "../components/detail/ContactActivityTab";

const LIST_PATH = "/app/m/runly.contacts/contacts";
const TABS = ["resumen", "actividad", "personas", "archivos", "historial"];

const ATTACHMENTS_CONFIG = {
  label: "Archivos",
  listPath: "/files?moduleKey=runly.contacts&entityType=Contact&sourceEntityId=:id&pageSize=100",
  removePath: "/files/:docId",
  upload: { endpoint: "/files/upload", moduleKey: "runly.contacts", entityType: "Contact" },
  fields: {
    id: "id",
    fileAssetId: "id",
    fileName: "originalName",
    mimeType: "mimeType",
    sizeBytes: "sizeBytes",
    createdAt: "createdAt",
  },
  signedUrl: { endpointTemplate: "/files/:fileId/signed-url" },
  limits: { maxFiles: 30, maxSizeMB: 10, allowMultiple: true },
};

function useContactId() {
  const { "*": wildcard } = useParams();
  return useMemo(() => {
    const segs = String(wildcard ?? "").replace(/^\/+/, "").split("/").filter(Boolean);
    return segs[0] === "contacts" ? segs[1] ?? null : null;
  }, [wildcard]);
}

function DetailSkeleton() {
  return (
    <div className="space-y-5 p-4 md:p-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-56 w-full rounded-2xl" />
      <Skeleton className="h-10 w-full max-w-lg" />
      <div className="grid gap-5 xl:grid-cols-3">
        <Skeleton className="h-72 rounded-2xl xl:col-span-2" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}

export default function ContactDetailScreen() {
  const contactId = useContactId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const { activeCompanyId } = useActiveCompany();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (key) => Boolean(userProfile?.isAdmin || permissions.includes(key));
  const canRead = hasPermission("contacts.contacts.read");
  const canUpdate = hasPermission("contacts.contacts.update");
  const canDelete = hasPermission("contacts.contacts.delete");
  const canReadFiles = hasPermission("files.assets.read");
  const canCreateFiles = hasPermission("files.assets.create");

  const tabParam = searchParams.get("tab");
  const tab = TABS.includes(tabParam) ? tabParam : "resumen";

  const profileKey = ["contact-profile", contactId, activeCompanyId];
  const profileQuery = useQuery({
    queryKey: profileKey,
    queryFn: () => runly.contacts.getProfile(contactId, token),
    enabled: Boolean(token && contactId && canRead),
    retry: false,
  });
  const activityQuery = useQuery({
    queryKey: ["contact-activity", contactId, activeCompanyId],
    queryFn: () => runly.contacts.getActivity(contactId, { limit: 100 }, token),
    enabled: Boolean(token && contactId && canRead),
  });
  const contact = profileQuery.data?.data ?? null;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["contact-profile", contactId] });
    queryClient.invalidateQueries({ queryKey: ["contacts"] });
  }

  const avatarMutation = useMutation({
    mutationFn: (file) => runly.contacts.uploadAvatar(contactId, file, token),
    onSuccess: () => {
      invalidate();
      toast.success("Foto actualizada");
    },
    onError: (err) => toast.error(err?.message || "No se pudo actualizar la foto"),
  });

  const toggleMutation = useMutation({
    mutationFn: () => runly.contacts.setEnabled(contactId, !contact.enabled, token),
    onSuccess: () => {
      invalidate();
      toast.success(contact.enabled ? "Contacto desactivado" : "Contacto activado");
    },
    onError: () => toast.error("No se pudo actualizar el estado del contacto"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => runly.contacts.delete(contactId, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Contacto eliminado");
      navigate(LIST_PATH);
    },
    onError: () => toast.error("No se pudo eliminar el contacto"),
  });

  function setTab(next) {
    const params = new URLSearchParams(searchParams);
    if (next === "resumen") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  }

  const header = <PageHeader eyebrow="Runly Contacts" title="Contacto" />;

  if (!canRead) {
    return (
      <div className="min-h-dvh space-y-6 p-4 md:p-6">
        {header}
        <ErrorState title="No tienes permisos para ver los contactos." />
      </div>
    );
  }
  if (profileQuery.isLoading) return <DetailSkeleton />;
  if (!contact) {
    return (
      <div className="min-h-dvh space-y-6 p-4 md:p-6">
        {header}
        <ErrorState
          title="Contacto no encontrado"
          description="Es posible que se haya eliminado o pertenezca a otra empresa."
        />
        <Button variant="outline" onClick={() => navigate(LIST_PATH)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Volver a contactos
        </Button>
      </div>
    );
  }

  const tabCounts = {
    personas: contact.persons?.length || null,
    archivos: activityQuery.data?.data?.summary?.find((s) => s.key === "files")?.count || null,
    actividad: activityQuery.data?.data?.items?.length || null,
  };
  const tabLabels = {
    resumen: "Resumen",
    actividad: "Actividad",
    personas: "Personas",
    archivos: "Archivos",
    historial: "Historial",
  };
  const visibleTabs = TABS.filter(
    (key) => (key !== "archivos" || canReadFiles) && (key !== "personas" || contact.type !== "person"),
  );

  return (
    <div className="min-h-dvh space-y-5 p-4 md:p-6">
      <ContactHeroCard
        contact={contact}
        activity={activityQuery.data?.data}
        canUpdate={canUpdate}
        canDelete={canDelete}
        onEdit={() => navigate(`${LIST_PATH}/${contactId}/edit`)}
        onBack={() => navigate(LIST_PATH)}
        onToggleEnabled={() => toggleMutation.mutate()}
        onDelete={() => setConfirmDelete(true)}
        onAvatarSelected={(file) => avatarMutation.mutate(file)}
        avatarBusy={avatarMutation.isPending}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <TabsList className="w-max">
            {visibleTabs.map((key) => (
              <TabsTrigger key={key} value={key}>
                {tabLabels[key]}
                {tabCounts[key] ? (
                  <span className="ml-1.5 rounded-full bg-[hsl(var(--muted))] px-1.5 text-[11px] tabular-nums">
                    {tabCounts[key]}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="resumen" className="mt-5">
          <ContactSummaryTab contact={contact} />
        </TabsContent>
        <TabsContent value="actividad" className="mt-5">
          <ContactActivityTab
            activity={activityQuery.data?.data}
            isLoading={activityQuery.isLoading}
            isError={activityQuery.isError}
          />
        </TabsContent>
        <TabsContent value="personas" className="mt-5">
          <ContactPeopleTab contact={contact} />
        </TabsContent>
        {canReadFiles && (
          <TabsContent value="archivos" className="mt-5">
            <AttachmentsPanel
              apiBaseUrl={getApiUrl()}
              token={token}
              companyId={activeCompanyId}
              recordId={contact.id}
              config={ATTACHMENTS_CONFIG}
              context="detail"
              readOnly={!canUpdate || !canCreateFiles}
              showHeading={false}
              showViewToggle
              defaultViewMode="grid"
              onChange={() => queryClient.invalidateQueries({ queryKey: ["contact-activity", contactId] })}
              onError={(message) => message && toast.error(message)}
            />
          </TabsContent>
        )}
        <TabsContent value="historial" className="mt-5">
          <ActivityTimeline
            sdk={runly}
            token={token}
            entityType="Contact"
            entityId={contact.id}
            limit={50}
            emptyMessage="Sin cambios registrados para este contacto."
          />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Eliminar contacto"
        description="El contacto será eliminado permanentemente junto con sus medios, direcciones y personas. Esta acción no se puede deshacer."
        detail={contact.name}
        confirmLabel="Eliminar"
        onConfirm={() => deleteMutation.mutate()}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
