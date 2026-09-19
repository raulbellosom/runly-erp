import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
} from "@runly/ui";
import { ArrowLeft, ChevronDown, Eye, FilePlus2, Save, Search, Send, UserRoundSearch, X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { useAuth } from "../../../auth/AuthProvider.jsx";
import { runly } from "../../../lib/runly.js";
import {
  getLeadStatusLabel,
  getLeadStatusVariant,
} from "../../runly.growth/lib/growth-leads.js";
import { DocumentBlockEditor } from "../components/DocumentBlockEditor.jsx";
import { DocumentPreviewDialog } from "../components/DocumentPreviewDialog.jsx";

const STARTER_BLOCKS = [
  {
    id: "title",
    type: "heading",
    text: "Resumen de {{lead.name}}",
    level: 1,
    align: "left",
  },
  {
    id: "contact",
    type: "fields",
    columns: 2,
    fields: [
      { label: "Correo", value: "{{lead.email}}" },
      { label: "Telefono", value: "{{lead.phone}}" },
    ],
  },
  {
    id: "message",
    type: "paragraph",
    text: "{{lead.message}}",
    align: "left",
  },
];

const LEAD_SOURCE_TYPE = "growth.lead";

function LeadPickerDialog({ token, selectedId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const leadsQuery = useQuery({
    queryKey: ["growth", "leads", "picker"],
    queryFn: () => runly.growth.listLeads(token, { page: 1, pageSize: 100, enabled: true }),
    enabled: Boolean(token),
    staleTime: 60_000,
  });

  const rows = leadsQuery.data?.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (lead) =>
        lead.name?.toLowerCase().includes(q) ||
        lead.email?.toLowerCase().includes(q) ||
        lead.companyName?.toLowerCase().includes(q) ||
        lead.source?.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const selected = rows.find((lead) => lead.id === selectedId);

  function pick(lead) {
    onSelect(lead.id);
    setOpen(false);
    setSearch("");
  }

  function clear(e) {
    e.stopPropagation();
    onSelect("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm transition-colors hover:bg-muted"
      >
        {selected ? (
          <span className="flex min-w-0 flex-col items-start text-left">
            <span className="truncate font-medium leading-tight">
              {selected.name || selected.email || "Lead sin nombre"}
            </span>
            {selected.name && selected.email ? (
              <span className="truncate text-xs text-muted-foreground leading-tight mt-0.5">
                {selected.email}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground">Seleccionar lead...</span>
        )}
        <span className="flex shrink-0 items-center gap-1">
          {selected ? (
            <span
              role="button"
              tabIndex={0}
              onClick={clear}
              onKeyDown={(e) => e.key === "Enter" && clear(e)}
              className="rounded p-0.5 hover:bg-muted-foreground/20"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          ) : null}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg p-0">
          <DialogHeader className="px-5 pt-5 pb-0">
            <DialogTitle>Seleccionar lead para vista previa</DialogTitle>
          </DialogHeader>

          <div className="px-5 pt-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-9"
                placeholder="Buscar por nombre, correo, empresa..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="max-h-105 overflow-y-auto px-5 pb-5 pt-3 space-y-1.5">
            {leadsQuery.isLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Cargando leads...</p>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {search ? "Sin resultados para esa busqueda" : "No hay leads disponibles"}
              </p>
            ) : (
              filtered.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => pick(lead)}
                  className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
                  style={lead.id === selectedId ? { backgroundColor: "hsl(var(--primary)/0.06)", borderColor: "hsl(var(--primary)/0.3)" } : {}}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                    <UserRoundSearch className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">
                        {lead.name || "Sin nombre"}
                      </span>
                      <Badge variant={getLeadStatusVariant(lead.status)} className="text-[10px] shrink-0">
                        {getLeadStatusLabel(lead.status)}
                      </Badge>
                    </div>
                    {lead.email ? (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{lead.email}</p>
                    ) : null}
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {lead.companyName ? (
                        <span className="text-[11px] text-muted-foreground">{lead.companyName}</span>
                      ) : null}
                      {lead.source ? (
                        <span className="text-[11px] text-muted-foreground opacity-70">{lead.source}</span>
                      ) : null}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PreviewSourcePicker({ sourceType, token, value, onChange }) {
  if (sourceType === LEAD_SOURCE_TYPE) {
    return <LeadPickerDialog token={token} selectedId={value} onSelect={onChange} />;
  }
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="ID del recurso"
    />
  );
}

function EditorWorkspace({ template, version, variables, token, canPublish }) {
  const queryClient = useQueryClient();
  const [blocks, setBlocks] = useState(() => version.blocks);
  const [sourceId, setSourceId] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBlob, setPreviewBlob] = useState(null);

  const saveMutation = useMutation({
    mutationFn: () =>
      runly.documents.updateVersion(
        template.id,
        version.id,
        { blocks, updatedAt: version.updatedAt },
        token,
      ),
    onSuccess: async () => {
      toast.success("Borrador guardado");
      await queryClient.invalidateQueries({ queryKey: ["documents", "versions", template.id] });
    },
    onError: (error) => toast.error(error.message),
  });

  const previewMutation = useMutation({
    mutationFn: () =>
      runly.documents.preview(
        template.id,
        { sourceId, versionId: version.id },
        token,
      ),
    onSuccess: (blob) => {
      setPreviewBlob(blob);
      setPreviewOpen(true);
    },
    onError: (error) => {
      setPreviewOpen(true);
      toast.error(error.message);
    },
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      runly.documents.publishVersion(
        template.id,
        version.id,
        { updatedAt: version.updatedAt },
        token,
      ),
    onSuccess: async () => {
      toast.success("Version publicada");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents", "template", template.id] }),
        queryClient.invalidateQueries({ queryKey: ["documents", "versions", template.id] }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <DocumentBlockEditor blocks={blocks} onChange={setBlocks} variables={variables} />

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-5!">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Version {version.versionNumber}</p>
                <Badge variant="secondary">{version.status}</Badge>
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                <Save className="mr-2 h-4 w-4" /> Guardar borrador
              </Button>
              {canPublish ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  disabled={publishMutation.isPending}
                  onClick={() => publishMutation.mutate()}
                >
                  <Send className="mr-2 h-4 w-4" /> Publicar
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-5!">
              <p className="text-sm font-semibold">Vista previa</p>
              <PreviewSourcePicker
                sourceType={template.sourceType}
                token={token}
                value={sourceId}
                onChange={setSourceId}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={!sourceId || previewMutation.isPending}
                onClick={() => previewMutation.mutate()}
              >
                <Eye className="mr-2 h-4 w-4" />
                {previewMutation.isPending ? "Generando..." : "Generar vista previa"}
              </Button>
            </CardContent>
          </Card>

          {variables.length > 0 ? (
            <Card>
              <CardContent className="p-5!">
                <p className="mb-3 text-sm font-semibold">Variables disponibles</p>
                <p className="mb-3 text-xs text-muted-foreground">
                  Copia y pega en cualquier campo de texto:{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{"{{variable}}"}</code>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {variables.map((v) => (
                    <button
                      key={v.path}
                      type="button"
                      className="rounded-full border bg-muted px-2.5 py-0.5 text-[11px] font-mono hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-colors cursor-pointer"
                      title={v.label}
                      onClick={() => {
                        navigator.clipboard.writeText(`{{${v.path}}}`).then(() => {
                          toast.success(`{{${v.path}}} copiado`);
                        });
                      }}
                    >
                      {v.path}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <DocumentPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        blob={previewBlob}
        loading={previewMutation.isPending}
        error={previewMutation.error}
      />
    </>
  );
}

export default function DocumentTemplateEditorScreen() {
  const { "*": wildcard } = useParams();
  const id = wildcard?.split("/")[1] ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const allowed = (key) => userProfile?.isAdmin || (userProfile?.permissions ?? []).includes(key);

  const templateQuery = useQuery({
    queryKey: ["documents", "template", id],
    queryFn: () => runly.documents.getTemplate(id, token),
    enabled: Boolean(token && id),
    staleTime: 30_000,
  });
  const versionsQuery = useQuery({
    queryKey: ["documents", "versions", id],
    queryFn: () => runly.documents.listVersions(id, token),
    enabled: Boolean(token && id),
    staleTime: 15_000,
  });
  const schemaQuery = useQuery({
    queryKey: ["documents", "provider", templateQuery.data?.sourceType],
    queryFn: () => runly.documents.getProviderSchema(templateQuery.data.sourceType, token),
    enabled: Boolean(token && templateQuery.data?.sourceType),
    staleTime: 5 * 60_000,
  });
  const createVersion = useMutation({
    mutationFn: () => {
      const published = versionsQuery.data?.find(
        (version) => version.id === templateQuery.data?.publishedVersionId,
      );
      return runly.documents.createVersion(
        id,
        { blocks: published?.blocks ?? STARTER_BLOCKS },
        token,
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["documents", "versions", id] });
    },
    onError: (error) => toast.error(error.message),
  });

  if (templateQuery.isLoading || versionsQuery.isLoading) {
    return <LoadingState label="Cargando plantilla..." />;
  }
  if (templateQuery.isError || versionsQuery.isError) {
    return <ErrorState description="No se pudo cargar la plantilla." />;
  }

  const template = templateQuery.data;
  const draft = versionsQuery.data?.find((version) => version.status === "draft");
  const variables = schemaQuery.data?.fields ?? [];

  return (
    <div className="min-h-dvh space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Runly Documents"
        title={template.name}
        description={`${template.key} · ${template.sourceType}`}
        actions={(
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate("/app/m/runly.documents/templates")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver
          </Button>
        )}
      />
      {draft ? (
        <EditorWorkspace
          key={draft.id}
          template={template}
          version={draft}
          variables={variables}
          token={token}
          canPublish={allowed("documents.templates.publish")}
        />
      ) : (
        <EmptyState
          icon={FilePlus2}
          title="No hay un borrador editable"
          description="Crea una nueva version a partir de la publicada o de la plantilla inicial."
          action={allowed("documents.templates.update") ? {
            label: "Crear borrador",
            onClick: () => createVersion.mutate(),
          } : undefined}
        />
      )}
    </div>
  );
}
