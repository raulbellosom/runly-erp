// Module Builder — main editor shell (No-Code Module Builder MVP). Tabs for
// General / Datos / Vistas / Navegación / Permisos over one draft
// ModuleDefinition, autosaved as JSON, plus Preview / Validar / Publicar.
// Nothing here compiles or installs anything directly — every mutating
// action calls module-builder-service.js through the SDK, which is the only
// place @runly/module-compiler and the RME3 lifecycle get invoked.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  PageHeader,
  ErrorState,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  ConfirmDialog,
  Alert,
  AlertTitle,
  AlertDescription,
} from "@runly/ui";
import { ArrowLeft, Code2, Download, Eye, ShieldCheck, Rocket, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { GeneralTab } from "../components/builder/GeneralTab";
import { EntitiesTab } from "../components/builder/EntitiesTab";
import { ViewsTab } from "../components/builder/ViewsTab";
import { NavigationTab } from "../components/builder/NavigationTab";
import { PermissionsTab } from "../components/builder/PermissionsTab";
import { DiagnosticsPanel } from "../components/builder/DiagnosticsPanel";
import { PreviewSheet } from "../components/builder/PreviewSheet";
import { PublishDialog } from "../components/builder/PublishDialog";

const AUTOSAVE_DELAY_MS = 1200;

export default function ModuleBuilderEditor() {
  // ModuleOutlet.jsx mounts every module screen behind a single catch-all
  // route (no literal :id segment ever reaches react-router), so the id must
  // be parsed out of the wildcard remainder — same pattern ContactsScreen.jsx
  // and every other dynamic-detail screen in this codebase already uses.
  const { "*": wildcard } = useParams();
  const id = wildcard?.match(/^module-builder\/([^/]+)$/)?.[1] ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const token = session?.access_token;

  const [definition, setDefinition] = useState(null);
  const [activeTab, setActiveTab] = useState("general");
  const [saveStatus, setSaveStatus] = useState("saved"); // saved | saving | error
  const [diagnostics, setDiagnostics] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [capabilities, setCapabilities] = useState(null);

  const projectQuery = useQuery({
    queryKey: ["module-builder-project", id, token],
    queryFn: () => runly.builder.getProject(id, token),
    enabled: Boolean(id) && Boolean(token),
  });
  const project = projectQuery.data?.data;

  useEffect(() => {
    if (project && definition === null) setDefinition(project.definition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  useEffect(() => {
    runly.builder.getCapabilities(token).then((res) => setCapabilities(res.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const saveMutation = useMutation({
    mutationFn: (nextDefinition) => runly.builder.updateDefinition(id, { definition: nextDefinition }, token),
    onMutate: () => setSaveStatus("saving"),
    onSuccess: () => {
      setSaveStatus("saved");
      queryClient.invalidateQueries({ queryKey: ["module-builder-project", id] });
    },
    onError: (error) => {
      setSaveStatus("error");
      toast.error(error.message ?? "No se pudo guardar el borrador.");
    },
  });

  const autosaveTimer = useRef(null);
  const lastSavedRef = useRef(null);
  useEffect(() => {
    if (definition === null) return;
    if (lastSavedRef.current === null) { lastSavedRef.current = definition; return; }
    if (JSON.stringify(lastSavedRef.current) === JSON.stringify(definition)) return;
    setSaveStatus("saving");
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      lastSavedRef.current = definition;
      saveMutation.mutate(definition);
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(autosaveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition]);

  // Preview and Publish both read the SERVER's persisted draft
  // (module-builder-service.js's previewProject/getPublishImpact/
  // publishProject all load project.definition from the DB) — but autosave
  // is debounced, so opening either right after an edit could act on the
  // pre-edit draft still sitting on the server. Flushing any pending save
  // first — and waiting for it — closes that race; the un-awaited version
  // of this (fire the mutation but don't block) is exactly what publishing
  // a stale draft looks like.
  async function flushPendingSave() {
    if (JSON.stringify(lastSavedRef.current) === JSON.stringify(definition)) return;
    clearTimeout(autosaveTimer.current);
    lastSavedRef.current = definition;
    await saveMutation.mutateAsync(definition);
  }

  // In-app navigation (the "Volver" button, tab switches) already flushes
  // via flushPendingSave(). A hard browser close/refresh during the ~1.2s
  // autosave debounce is the one path that can still lose an edit — this
  // can only warn, not guarantee a save (browsers block synchronous work in
  // beforeunload), so it's a mitigation, not a fix.
  useEffect(() => {
    function handleBeforeUnload(event) {
      if (JSON.stringify(lastSavedRef.current) === JSON.stringify(definition)) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [definition]);

  const validateMutation = useMutation({
    mutationFn: () => runly.builder.validateProject(id, token),
    onSuccess: (res) => {
      setDiagnostics(res.data);
      if (res.data.valid) toast.success("El módulo es válido.");
      else toast.error(`${res.data.errors.length} error(es) de validación.`);
    },
    onError: (error) => toast.error(error.message ?? "No se pudo validar."),
  });

  // "Modo avanzado": the project stops being edited/published visually so a
  // hand-edited ZIP (custom React views) can never be overwritten.
  const [confirmDetach, setConfirmDetach] = useState(false);
  const detachMutation = useMutation({
    mutationFn: () => runly.builder.detachProject(id, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["module-builder-project", id] });
      toast.success("El módulo pasó a modo avanzado. Descarga el ZIP para editar su código.");
    },
    onError: (error) => toast.error(error.message ?? "No se pudo convertir a modo avanzado."),
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const blob = await runly.builder.exportPackage(id, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project?.moduleKey ?? "modulo"}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    onError: (error) => toast.error(error.message ?? "No se pudo exportar el ZIP."),
  });

  const statusLabel = useMemo(() => ({
    saving: "Guardando...",
    saved: "Guardado",
    error: "Error al guardar",
  })[saveStatus], [saveStatus]);

  // Order matters: a settled-but-failed/empty query must win over the
  // "still loading" branch below. definition stays null forever whenever
  // project never resolves (the effect that hydrates it only runs on
  // success), so checking `definition === null` first would keep this stuck
  // on the skeleton forever instead of ever showing the real error.
  if (!projectQuery.isLoading && (projectQuery.isError || !project)) {
    return (
      <div className="p-6">
        <ErrorState title="No se encontró el proyecto" description={projectQuery.error?.message} />
      </div>
    );
  }

  if (projectQuery.isLoading || definition === null) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  // Tabs pass either an updater `(current) => next` or an already-computed
  // next definition. Treating every argument as a function crashed the Datos
  // and Vistas tabs ("e is not a function") on their first edit.
  function patchDefinition(next) {
    setDefinition((current) => (typeof next === "function" ? next(current) : next));
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 p-4 md:p-6 space-y-4 pb-24">
        <PageHeader
          eyebrow={project.moduleKey}
          title={project.name}
          description={project.status === "PUBLISHED" ? "Módulo publicado — los cambios requieren volver a publicar." : "Borrador"}
          actions={
            <Button variant="ghost" onClick={() => flushPendingSave().then(() => navigate("/app/m/runly.core/module-builder"))}>
              <ArrowLeft className="h-4 w-4" />
              Volver
            </Button>
          }
        />

        {project.detachedAt && (
          <Alert>
            <Code2 className="h-4 w-4" />
            <AlertTitle>Modo avanzado</AlertTitle>
            <AlertDescription>
              Este módulo se edita como código (por ejemplo, con pantallas React propias), así que el Constructor ya no lo modifica ni lo publica. Usa "Descargar ZIP" para obtener el paquete con su guía de desarrollo y súbelo desde Módulos &gt; Subir módulo.
            </AlertDescription>
          </Alert>
        )}

        {diagnostics && !diagnostics.valid && <DiagnosticsPanel diagnostics={diagnostics} />}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="data">Datos</TabsTrigger>
            <TabsTrigger value="views">Vistas</TabsTrigger>
            <TabsTrigger value="navigation">Navegación</TabsTrigger>
            <TabsTrigger value="permissions">Permisos</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <GeneralTab definition={definition} onChange={patchDefinition} capabilities={capabilities} readOnly={Boolean(project.detachedAt)} />
          </TabsContent>
          <TabsContent value="data">
            <EntitiesTab
              definition={definition}
              onChange={patchDefinition}
              capabilities={capabilities}
              publishedDefinition={project.publishedDefinition}
              readOnly={Boolean(project.detachedAt)}
            />
          </TabsContent>
          <TabsContent value="views">
            <ViewsTab definition={definition} onChange={patchDefinition} capabilities={capabilities} readOnly={Boolean(project.detachedAt)} />
          </TabsContent>
          <TabsContent value="navigation">
            <NavigationTab definition={definition} onChange={patchDefinition} capabilities={capabilities} readOnly={Boolean(project.detachedAt)} />
          </TabsContent>
          <TabsContent value="permissions">
            <PermissionsTab definition={definition} published={project.status === "PUBLISHED"} />
          </TabsContent>
        </Tabs>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-[hsl(var(--border))] bg-[hsl(var(--background))]/95 backdrop-blur px-4 md:px-6 py-2.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] min-w-0">
          <span className={`h-2 w-2 shrink-0 rounded-full ${saveStatus === "error" ? "bg-red-500" : saveStatus === "saving" ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`} />
          <span className="truncate">{statusLabel}</span>
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => flushPendingSave().then(() => setPreviewOpen(true))}>
            <Eye className="h-4 w-4" />
            Preview
          </Button>
          <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => flushPendingSave().then(() => validateMutation.mutate())} disabled={validateMutation.isPending}>
            <ShieldCheck className="h-4 w-4" />
            {validateMutation.isPending ? "Validando..." : "Validar"}
          </Button>
          <Button
            size="sm"
            className="bg-(--brand-primary) text-(--brand-primary-foreground) hover:bg-(--brand-primary-hover) shadow-sm"
            onClick={() => flushPendingSave().then(() => setPublishOpen(true))}
            disabled={Boolean(project.detachedAt)}
          >
            <Rocket className="h-4 w-4" />
            Publicar
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Más acciones">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top">
              <DropdownMenuItem className="sm:hidden" onSelect={() => flushPendingSave().then(() => setPreviewOpen(true))}>
                <Eye />
                Preview
              </DropdownMenuItem>
              <DropdownMenuItem className="sm:hidden" disabled={validateMutation.isPending} onSelect={() => flushPendingSave().then(() => validateMutation.mutate())}>
                <ShieldCheck />
                Validar
              </DropdownMenuItem>
              <DropdownMenuItem disabled={exportMutation.isPending} onSelect={() => flushPendingSave().then(() => exportMutation.mutate())}>
                <Download />
                Descargar ZIP
              </DropdownMenuItem>
              {project.status === "PUBLISHED" && !project.detachedAt && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setConfirmDetach(true)}>
                    <Code2 />
                    Convertir a modo avanzado
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDetach}
        onOpenChange={setConfirmDetach}
        title="Convertir a modo avanzado"
        description="El módulo seguirá funcionando igual, pero ya no podrás editarlo ni publicarlo desde el Constructor: se trabajará como código (ZIP con pantallas React propias y su guía de desarrollo). Este cambio no se puede deshacer. Subir un ZIP modificado de este módulo también lo convierte automáticamente."
        confirmLabel="Convertir"
        onConfirm={() => {
          setConfirmDetach(false);
          detachMutation.mutate();
        }}
      />

      <PreviewSheet open={previewOpen} onOpenChange={setPreviewOpen} projectId={id} token={token} definition={definition} />
      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        projectId={id}
        token={token}
        moduleKey={project.moduleKey}
        onPublished={() => {
          queryClient.invalidateQueries({ queryKey: ["module-builder-project", id] });
          queryClient.invalidateQueries({ queryKey: ["modules"] });
          // The sidebar/menu and module screens read these, not ["modules"];
          // without them a freshly published module only appeared after a
          // full page reload. Same set ModuleCatalog invalidates on install.
          queryClient.invalidateQueries({ queryKey: ["runtime-modules"] });
          queryClient.invalidateQueries({ queryKey: ["blueprints"] });
        }}
      />
    </div>
  );
}
