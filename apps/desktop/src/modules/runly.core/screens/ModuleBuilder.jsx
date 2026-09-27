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
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
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
} from "@runly/ui";
import { Hammer, Plus, Trash2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";

const TEMPLATE_OPTIONS = [
  { value: "blank", label: "Módulo vacío" },
  { value: "simple-crud", label: "CRUD simple (una entidad)" },
  { value: "inventory-lite", label: "Inventario ligero (con Kanban y dashboard)" },
];

const STATUS_LABEL = { DRAFT: "Borrador", VALIDATED: "Validado", PUBLISHED: "Publicado" };
const STATUS_VARIANT = { DRAFT: "secondary", VALIDATED: "outline", PUBLISHED: "default" };

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

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="truncate">{project.name}</CardTitle>
                  <Badge variant={STATUS_VARIANT[project.status] ?? "secondary"}>
                    {STATUS_LABEL[project.status] ?? project.status}
                  </Badge>
                </div>
                <CardDescription className="font-mono text-xs">{project.moduleKey}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 text-sm text-[hsl(var(--muted-foreground))]">
                {project.description || "Sin descripción."}
                {project.status === "PUBLISHED" && project.hasUnpublishedChanges && (
                  <p className="mt-2 text-amber-600 dark:text-amber-400">Hay cambios sin publicar.</p>
                )}
              </CardContent>
              <CardFooter className="flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  className="text-red-600 hover:text-red-700"
                  disabled={project.status === "PUBLISHED"}
                  onClick={() => setConfirmDelete(project)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button onClick={() => navigate(`/app/m/runly.core/module-builder/${project.id}`)}>
                  Abrir
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
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
        description={`Se eliminará el borrador "${confirmDelete?.name}". Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(confirmDelete.id)}
      />
    </div>
  );
}
