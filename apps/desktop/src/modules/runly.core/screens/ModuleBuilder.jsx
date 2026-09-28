// Module Builder — project list + "Crear módulo" entry point (No-Code
// Module Builder MVP). Reached from Módulos > Crear módulo, or the
// "Constructor de módulos" nav item. Every project here is a draft
// ModuleDefinition; nothing here is an installed module until Publicar.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  PageHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  TextField,
  TextareaField,
  SelectField,
  ConfirmDialog,
  SearchInput,
  FilterBar,
  ListPager,
  usePagedList,
} from "@runly/ui";
import { Hammer, Plus, SearchX } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { mergeRuntimeModules } from "../../../lib/runtimeModules";
import { BuilderProjectCard } from "../components/builder/BuilderProjectCard";
import { PROJECT_FILTERS, matchesFilters, matchesSearch, projectSummary } from "../lib/builderProjectSummary";

// 12 fills whole rows in both the 2- and 3-column grid.
const PAGE_SIZE = 12;

const TEMPLATE_OPTIONS = [
  { value: "blank", label: "Módulo vacío" },
  { value: "simple-crud", label: "CRUD simple (una entidad)" },
  { value: "inventory-lite", label: "Inventario ligero (con Kanban y dashboard)" },
];

export default function ModuleBuilder() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const isAdmin = Boolean(userProfile?.isAdmin);
  const canUse = isAdmin || (userProfile?.permissions ?? []).includes("core.modules.builder");

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", moduleKey: "", description: "", template: "blank" });
  const [confirmDelete, setConfirmDelete] = useState(null);

  const projectsQuery = useQuery({
    queryKey: ["module-builder-projects", token],
    queryFn: () => runly.builder.listProjects(token),
    enabled: Boolean(token) && canUse,
  });
  const projects = projectsQuery.data?.data ?? [];

  // Install state per module key — same cache as the Módulos catalog. Optional:
  // without core.modules.read the cards fall back to the project's publishedAt.
  const canReadModules = isAdmin || (userProfile?.permissions ?? []).includes("core.modules.read");
  const modulesQuery = useQuery({
    queryKey: ["modules", token],
    queryFn: () => runly.modules.list(token),
    enabled: Boolean(token) && canUse && canReadModules,
    staleTime: 60000,
  });
  const runtimeByKey = useMemo(
    () => new Map(mergeRuntimeModules(modulesQuery.data).map((module) => [module.key, module])),
    [modulesQuery.data],
  );

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({});
  const visibleRows = useMemo(
    () => projects
      .map((project) => {
        const runtimeModule = runtimeByKey.get(project.moduleKey) ?? null;
        return { project, runtimeModule, summary: projectSummary(project, runtimeModule) };
      })
      .filter((row) => matchesFilters(row.summary, filters) && matchesSearch(row.summary, search))
      .sort((a, b) => String(b.summary.updatedAt ?? "").localeCompare(String(a.summary.updatedAt ?? ""))),
    [projects, runtimeByKey, filters, search],
  );
  const paged = usePagedList(visibleRows, PAGE_SIZE);
  const hasQuery = Boolean(search.trim()) || Object.values(filters).some(Boolean);

  const suggestedKey = useMemo(() => {
    const slug = form.name
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
    return slug ? `custom.${slug}` : "";
  }, [form.name]);

  const createMutation = useMutation({
    mutationFn: () =>
      runly.builder.createProject(
        {
          name: form.name,
          moduleKey: form.moduleKey || undefined,
          description: form.description,
          template: form.template,
        },
        token,
      ),
    onSuccess: (result) => {
      toast.success("Proyecto creado.");
      setCreateOpen(false);
      setForm({ name: "", moduleKey: "", description: "", template: "blank" });
      queryClient.invalidateQueries({ queryKey: ["module-builder-projects"] });
      navigate(`/app/m/runly.core/module-builder/${result.data.id}`);
    },
    onError: (error) => toast.error(error.message ?? "No se pudo crear el proyecto."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => runly.builder.deleteDraft(id, token),
    onSuccess: () => {
      toast.success("Proyecto eliminado.");
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ["module-builder-projects"] });
    },
    onError: (error) => toast.error(error.message ?? "No se pudo eliminar el proyecto."),
  });

  if (!canUse) {
    return (
      <div className="p-6">
        <ErrorState title="Sin acceso" description="No tienes permiso para usar el Module Builder." />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 p-4 md:p-6 space-y-5">
        <PageHeader
          eyebrow="Runly Core"
          title="Constructor de módulos"
          description="Crea módulos RME3 completos — entidades, vistas, navegación y permisos — sin escribir código."
          actions={
            <Button
              className="bg-(--brand-primary) text-(--brand-primary-foreground) hover:bg-(--brand-primary-hover) shadow-sm"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Crear módulo
            </Button>
          }
        />

        {projectsQuery.isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
          </div>
        )}

        {projectsQuery.isError && (
          <ErrorState title="No se pudieron cargar los proyectos" description={projectsQuery.error?.message} />
        )}

        {!projectsQuery.isLoading && !projectsQuery.isError && projects.length === 0 && (
          <EmptyState
            icon={Hammer}
            title="Aún no has creado ningún módulo"
            description="Empieza desde una plantilla o un módulo vacío. Podrás editar entidades, vistas y permisos antes de publicar."
            action={{ label: "Crear módulo", onClick: () => setCreateOpen(true) }}
          />
        )}

        {projects.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput
                value={search}
                onChange={(e) => { setSearch(e.target.value); paged.setPage(0); }}
                placeholder="Buscar módulo..."
                className="w-full sm:w-72"
              />
              <FilterBar filters={PROJECT_FILTERS} value={filters} onChange={(next) => { setFilters(next); paged.setPage(0); }} />
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {hasQuery ? `${visibleRows.length} de ${projects.length} módulos` : `${projects.length} ${projects.length === 1 ? "módulo" : "módulos"}`}
            </p>
          </div>
        )}

        {projects.length > 0 && visibleRows.length === 0 && (
          <EmptyState
            icon={SearchX}
            title="Ningún módulo coincide"
            description="Prueba con otra búsqueda o cambia el filtro."
            action={{ label: "Limpiar filtros", onClick: () => { setSearch(""); setFilters({}); } }}
          />
        )}

        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {paged.pageItems.map(({ project, runtimeModule }) => (
            <BuilderProjectCard
              key={project.id}
              project={project}
              runtimeModule={runtimeModule}
              href={`/app/m/runly.core/module-builder/${project.id}`}
              onDelete={() => setConfirmDelete(project)}
            />
          ))}
        </div>
        <ListPager {...paged} />
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear módulo</DialogTitle>
            <DialogDescription>Elige un punto de partida. Podrás editarlo todo después.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <TextField
              label="Nombre"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Control de vehículos"
            />
            <TextField
              label="Module key"
              value={form.moduleKey}
              onChange={(e) => setForm((f) => ({ ...f, moduleKey: e.target.value }))}
              placeholder={suggestedKey || "custom.mi-modulo"}
              hint="Se sugiere automáticamente a partir del nombre. No podrá cambiarse después de guardar."
            />
            <TextareaField
              label="Descripción"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
            <SelectField
              label="Plantilla"
              options={TEMPLATE_OPTIONS}
              value={form.template}
              onValueChange={(value) => setForm((f) => ({ ...f, template: value }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              disabled={!form.name.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Creando..." : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title="Eliminar proyecto"
        description={`Se eliminará el borrador "${confirmDelete?.definition?.name || confirmDelete?.name}". Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(confirmDelete.id)}
      />
    </div>
  );
}
