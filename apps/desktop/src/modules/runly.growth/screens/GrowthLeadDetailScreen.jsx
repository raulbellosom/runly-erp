import { useActiveCompany } from '../../../company/ActiveCompanyProvider.jsx'
import { companyFetch } from '../../../lib/companyFetch.js'
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdvancedFileViewer,
  AttachmentsPanel,
  Badge,
  Button,
  Card,
  CommentThread,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SelectField,
  TextareaField,
} from "@runly/ui";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  FileText,
  Files,
  Mail,
  MessageSquareText,
  Phone,
  RotateCcw,
  UserRoundCheck,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { useAuth } from "../../../auth/AuthProvider.jsx";
import { runly } from "../../../lib/runly.js";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import { ConvertLeadDialog } from "../components/ConvertLeadDialog.jsx";
import { GenerateDocumentDialog } from "../components/GenerateDocumentDialog.jsx";
import {
  useCreateGrowthLeadComment,
  useDeleteGrowthLeadComment,
  useGrowthLeadComments,
  useToggleGrowthLeadCommentReaction,
  useUpdateGrowthLeadComment,
} from "../hooks/useGrowthLeadComments.js";
import {
  LEAD_PRIORITY_OPTIONS,
  describeLeadActivity,
  getAllowedLeadStatuses,
  getGrowthLeadId,
  getLeadActivityLabel,
  getLeadPriorityLabel,
  getLeadPriorityVariant,
  getLeadStatusLabel,
  getLeadStatusVariant,
} from "../lib/growth-leads.js";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value) {
  if (!value) return "Sin fecha";
  return DATE_TIME_FORMATTER.format(new Date(value));
}

function DetailItem({ label, value, icon: Icon }) {
  return (
    <div className="flex gap-3">
      {Icon ? (
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
      ) : null}
      <div className="min-w-0">
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{label}</p>
        <p className="break-words text-sm">{value || "Sin información"}</p>
      </div>
    </div>
  );
}

export default function GrowthLeadDetailScreen() {
  const { "*": wildcard } = useParams();
  const leadId = useMemo(() => getGrowthLeadId(wildcard), [wildcard]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeCompanyId } = useActiveCompany();
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (key) =>
    Boolean(userProfile?.isAdmin || permissions.includes(key));
  const canRead = hasPermission("growth.leads.read");
  const canUpdate = hasPermission("growth.leads.update");
  const canAssign = hasPermission("growth.leads.assign");
  const canConvert = hasPermission("growth.leads.convert");
  const canDisable = hasPermission("growth.leads.delete");
  const canUseExistingContact = hasPermission("contacts.contacts.read");
  const canCreateContact = hasPermission("contacts.contacts.create");
  const canReadFiles = hasPermission("files.assets.read");
  const canCreateFiles = hasPermission("files.assets.create");
  const canGenerateDocuments = hasPermission("documents.generated.create");

  const [note, setNote] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);
  const handleAttachmentsError = useCallback((message) => toast.error(message), []);
  const [disableOpen, setDisableOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generatedFile, setGeneratedFile] = useState(null);
  const [attachmentsVersion, setAttachmentsVersion] = useState(0);

  const {
    data: leadResponse,
    isLoading: isLeadLoading,
    isError: isLeadError,
    refetch: refetchLead,
  } = useQuery({
    queryKey: ["growth", "leads", "detail", leadId],
    queryFn: () => runly.growth.getLead(leadId, token),
    enabled: Boolean(token && leadId && canRead),
  });
  const { data: assigneesResponse } = useQuery({
    queryKey: ["growth", "leads", "assignees"],
    queryFn: () => runly.growth.listLeadAssignees(token),
    enabled: Boolean(token && canAssign),
    staleTime: 60_000,
  });

  const refreshLead = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["growth", "leads", "detail", leadId],
      }),
      queryClient.invalidateQueries({ queryKey: ["growth", "leads", "list"] }),
      queryClient.invalidateQueries({
        queryKey: ["growth", "leads", "summary"],
      }),
    ]);
  }, [leadId, queryClient]);

  const updateMutation = useMutation({
    mutationFn: (payload) => runly.growth.updateLead(leadId, payload, token),
    onSuccess: async () => {
      await refreshLead();
      toast.success("Lead actualizado");
    },
    onError: (error) =>
      toast.error(error?.message || "No se pudo actualizar el lead"),
  });
  const noteMutation = useMutation({
    mutationFn: (payload) => runly.growth.addLeadNote(leadId, payload, token),
    onSuccess: async () => {
      setNote("");
      await refreshLead();
      toast.success("Nota agregada");
    },
    onError: (error) =>
      toast.error(error?.message || "No se pudo agregar la nota"),
  });
  const convertMutation = useMutation({
    mutationFn: (payload) => runly.growth.convertLead(leadId, payload, token),
    onSuccess: async () => {
      setConvertOpen(false);
      await refreshLead();
      toast.success("Lead convertido");
    },
    onError: (error) =>
      toast.error(error?.message || "No se pudo convertir el lead"),
  });
  const enabledMutation = useMutation({
    mutationFn: ({ enabled, updatedAt }) =>
      runly.growth.setLeadEnabled(
        leadId,
        { enabled, updatedAt },
        token,
      ),
    onSuccess: async (_, variables) => {
      setDisableOpen(false);
      await refreshLead();
      toast.success(
        variables.enabled ? "Lead habilitado" : "Lead deshabilitado",
      );
    },
    onError: (error) =>
      toast.error(error?.message || "No se pudo cambiar el estado del lead"),
  });

  const commentsQuery     = useGrowthLeadComments(leadId);
  const createComment     = useCreateGrowthLeadComment(leadId);
  const updateComment     = useUpdateGrowthLeadComment(leadId);
  const deleteComment     = useDeleteGrowthLeadComment(leadId);
  const toggleReaction    = useToggleGrowthLeadCommentReaction(leadId);

  const { data: filesData } = useQuery({
    queryKey: ["growth", "leads", leadId, "files"],
    queryFn: async () => {
      const res = await companyFetch(`${getApiUrl()}/growth/leads/${leadId}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Files fetch failed (${res.status})`);
      }
      return res.json();
    },
    enabled: Boolean(leadId && token && canReadFiles),
    staleTime: 30_000,
  });

  const membersQuery = useQuery({
    queryKey: ['identity', 'users'],
    queryFn: () => runly.identity.listCandidates(token, { action: 'growth' }),
    enabled: Boolean(token),
    staleTime: 10 * 60 * 1000,
  });
  const members = useMemo(() => {
    const raw = membersQuery.data?.data ?? membersQuery.data ?? [];
    return Array.isArray(raw)
      ? raw.map(u => ({
          id: u.id,
          displayName: u.displayName || u.email || u.id,
          email: u.email || '',
          avatarUrl: u.avatarUrl || null,
        }))
      : [];
  }, [membersQuery.data]);

  const comments = useMemo(() => {
    const raw = commentsQuery.data?.data ?? commentsQuery.data ?? [];
    return Array.isArray(raw) ? raw : [];
  }, [commentsQuery.data]);

  const attachmentsConfig = useMemo(
    () => ({
      label: "Archivos",
      listPath: "/growth/leads/:id/files",
      addPath: "/growth/leads/:id/files",
      removePath: "/growth/leads/:id/files/:docId",
      upload: {
        endpoint: "/files/upload",
        moduleKey: "runly.growth",
        entityType: "GrowthLead",
      },
      fields: {
        id: "id",
        fileAssetId: "id",
        fileName: "originalName",
        mimeType: "mimeType",
        sizeBytes: "sizeBytes",
        createdAt: "createdAt",
      },
      signedUrl: { endpointTemplate: "/files/:fileId/signed-url" },
      limits: { maxFiles: 20, maxSizeMB: 10, allowMultiple: true },
    }),
    [],
  );

  if (!canRead) {
    return (
      <div className="min-h-dvh p-4 md:p-6">
        <PageHeader eyebrow="Runly Growth" title="Detalle del lead" />
        <ErrorState message="No tienes permisos para consultar este lead." />
      </div>
    );
  }
  if (isLeadLoading) {
    return (
      <div className="p-4 md:p-6">
        <LoadingState />
      </div>
    );
  }
  if (isLeadError || !leadResponse?.data) {
    return (
      <div className="min-h-dvh p-4 md:p-6">
        <PageHeader eyebrow="Runly Growth" title="Detalle del lead" />
        <ErrorState
          title="No se pudo cargar el lead"
          onRetry={refetchLead}
        />
      </div>
    );
  }

  const lead = leadResponse.data;
  const mutable = lead.enabled && lead.status !== "converted";
  const assignees = assigneesResponse?.data ?? [];
  const assigneeOptions = [
    { value: "__none__", label: "Sin responsable" },
    ...assignees.map((assignee) => ({
      value: assignee.id,
      label: assignee.displayName || assignee.email,
    })),
  ];
  const statusOptions = getAllowedLeadStatuses(lead.status);

  return (
    <div className="min-h-dvh space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Runly Growth"
        title={lead.name || lead.email || "Lead sin nombre"}
        description={`Recibido ${formatDate(lead.createdAt)}`}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => navigate("/app/m/runly.growth/leads")}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver
            </Button>
            {canConvert &&
            mutable &&
            (canUseExistingContact || canCreateContact) ? (
              <Button onClick={() => setConvertOpen(true)}>
                <UserRoundCheck className="mr-2 h-4 w-4" />
                Convertir
              </Button>
            ) : null}
            {canGenerateDocuments ? (
              <Button variant="outline" onClick={() => setGenerateOpen(true)}>
                <Files className="mr-2 h-4 w-4" />
                Generar documento
              </Button>
            ) : null}
            {canDisable ? (
              <Button
                variant="outline"
                onClick={() =>
                  lead.enabled
                    ? setDisableOpen(true)
                    : enabledMutation.mutate({
                        enabled: true,
                        updatedAt: lead.updatedAt,
                      })
                }
                disabled={enabledMutation.isPending}
              >
                {lead.enabled ? (
                  <Ban className="mr-2 h-4 w-4" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                {lead.enabled ? "Deshabilitar" : "Habilitar"}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge variant={getLeadStatusVariant(lead.status)}>
          {getLeadStatusLabel(lead.status)}
        </Badge>
        <Badge variant={getLeadPriorityVariant(lead.priority)}>
          Prioridad {getLeadPriorityLabel(lead.priority).toLowerCase()}
        </Badge>
        {!lead.enabled ? <Badge variant="destructive">Deshabilitado</Badge> : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="space-y-6">
          <Card className="space-y-5 p-5">
            <h2 className="text-base font-semibold">Información del lead</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <DetailItem label="Correo" value={lead.email} icon={Mail} />
              <DetailItem label="Teléfono" value={lead.phone} icon={Phone} />
              <DetailItem label="Empresa" value={lead.companyName} />
              <DetailItem label="Origen" value={lead.source} />
            </div>
            {lead.message ? (
              <div className="rounded-xl bg-[hsl(var(--muted))] p-4">
                <p className="mb-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                  Mensaje
                </p>
                <p className="whitespace-pre-wrap text-sm">{lead.message}</p>
              </div>
            ) : null}
          </Card>

          <Card className="space-y-4 p-5">
            <div>
              <h2 className="text-base font-semibold">Actividad</h2>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Historial operativo y envíos vinculados.
              </p>
            </div>
            {lead.activities?.length ? (
              <div className="space-y-4">
                {lead.activities.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex gap-3 border-b border-[hsl(var(--border))] pb-4 last:border-0 last:pb-0"
                  >
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
                      <MessageSquareText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {getLeadActivityLabel(activity.activityType)}
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-[hsl(var(--muted-foreground))]">
                        {describeLeadActivity(activity)}
                      </p>
                      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                        {formatDate(activity.occurredAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={MessageSquareText}
                title="Sin actividad"
                description="Los cambios y notas aparecerán aquí."
              />
            )}
          </Card>

          {canReadFiles ? (
            <Card className="p-5">
              <AttachmentsPanel
                    companyId={activeCompanyId}
                key={attachmentsVersion}
                apiBaseUrl={getApiUrl()}
                token={token}
                recordId={lead.id}
                config={attachmentsConfig}
                context="detail"
                readOnly={!canUpdate || !canCreateFiles}
                showHeading
                showViewToggle
                defaultViewMode="grid"
                canRemoveItem={(item) =>
                  item.raw?.moduleKey === "runly.growth"
                }
                onError={handleAttachmentsError}
                prefetchedData={Array.isArray(filesData) ? filesData : filesData?.data}
              />
            </Card>
          ) : null}

          <CommentThread
            comments={comments}
            members={members}
            currentUserId={userProfile?.id}
            loading={commentsQuery.isLoading}
            isSubmitting={createComment.isPending}
            isActing={updateComment.isPending || deleteComment.isPending || toggleReaction.isPending}
            onSubmit={(body) => createComment.mutate({ body })}
            onUpdate={({ commentId, body }) => updateComment.mutateAsync({ commentId, body })}
            onDelete={(commentId) => deleteComment.mutateAsync(commentId)}
            onToggleReaction={({ commentId, emoji }) => toggleReaction.mutate({ commentId, emoji })}
          />
        </div>

        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <h2 className="text-base font-semibold">Clasificación</h2>
            <SelectField
              label="Estado"
              value={lead.status}
              options={statusOptions}
              disabled={!canUpdate || !mutable || updateMutation.isPending}
              onValueChange={(status) => {
                if (status === lead.status) return;
                updateMutation.mutate({
                  status,
                  updatedAt: lead.updatedAt,
                  ...(status === "discarded"
                    ? { discardReason: "Descartado desde la bandeja" }
                    : {}),
                });
              }}
            />
            <SelectField
              label="Prioridad"
              value={lead.priority}
              options={LEAD_PRIORITY_OPTIONS}
              disabled={!canUpdate || !mutable || updateMutation.isPending}
              onValueChange={(priority) =>
                updateMutation.mutate({
                  priority,
                  updatedAt: lead.updatedAt,
                })
              }
            />
            {canAssign ? (
              <SelectField
                label="Responsable"
                value={lead.assigneeUserId || "__none__"}
                options={assigneeOptions}
                disabled={!mutable || updateMutation.isPending}
                onValueChange={(assigneeUserId) =>
                  updateMutation.mutate({
                    assigneeUserId:
                      assigneeUserId === "__none__" ? null : assigneeUserId,
                    updatedAt: lead.updatedAt,
                  })
                }
              />
            ) : null}
            {lead.discardReason ? (
              <DetailItem label="Motivo de descarte" value={lead.discardReason} />
            ) : null}
            {lead.convertedAt ? (
              <DetailItem
                label="Conversión"
                value={formatDate(lead.convertedAt)}
                icon={CheckCircle2}
              />
            ) : null}
          </Card>

          {canUpdate && mutable ? (
            <Card className="space-y-4 p-5">
              <h2 className="text-base font-semibold">Agregar nota</h2>
              <TextareaField
                label="Seguimiento"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={5000}
                rows={5}
                placeholder="Registra llamadas, acuerdos o próximos pasos..."
              />
              <Button
                className="w-full"
                disabled={!note.trim() || noteMutation.isPending}
                onClick={() =>
                  noteMutation.mutate({
                    note: note.trim(),
                    updatedAt: lead.updatedAt,
                  })
                }
              >
                <MessageSquareText className="mr-2 h-4 w-4" />
                {noteMutation.isPending ? "Guardando..." : "Agregar nota"}
              </Button>
            </Card>
          ) : null}

          {lead.submissions?.length ? (
            <Card className="space-y-3 p-5">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                <h2 className="text-base font-semibold">Formularios</h2>
              </div>
              {lead.submissions.map((submission) => (
                <div
                  key={submission.id}
                  className="rounded-xl border border-[hsl(var(--border))] p-3"
                >
                  <p className="text-sm font-medium">Envío web</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    {formatDate(submission.submittedAt)}
                  </p>
                </div>
              ))}
            </Card>
          ) : null}
        </div>
      </div>

      <ConvertLeadDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        lead={lead}
        token={token}
        canUseExisting={canUseExistingContact}
        canCreateContact={canCreateContact}
        loading={convertMutation.isPending}
        onConfirm={(payload) => convertMutation.mutate(payload)}
      />

      <GenerateDocumentDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        leadId={lead.id}
        token={token}
        onGenerated={({ generated, download }) => {
          setAttachmentsVersion((current) => current + 1);
          setGeneratedFile({
            id: generated.fileAssetId ?? generated.id,
            originalName: `${lead.name || "lead"}-documento.pdf`,
            mimeType: "application/pdf",
            signedUrl: download.url,
          });
        }}
      />
      {generatedFile && (
        <AdvancedFileViewer
          open={Boolean(generatedFile)}
          onOpenChange={(open) => !open && setGeneratedFile(null)}
          files={[generatedFile]}
          activeIndex={0}
          onIndexChange={() => {}}
          onResolveSignedUrl={(file) => file.signedUrl}
        />
      )}

      <ConfirmDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        title="Deshabilitar lead"
        description="El lead quedará fuera de la bandeja activa y no admitirá cambios hasta volver a habilitarlo."
        confirmLabel="Deshabilitar"
        loading={enabledMutation.isPending}
        onConfirm={() =>
          enabledMutation.mutate({
            enabled: false,
            updatedAt: lead.updatedAt,
          })
        }
      />
    </div>
  );
}
