// Module Builder — display summary of a project for list cards and the
// editor header. Name/description/icon/color/version live in the module
// definition (edited in the General tab); the project row keeps only the
// values captured at creation, so the definition wins.

export function projectSummary(project) {
  const definition = project?.definition ?? {};
  const entities = definition.entities ?? [];
  const fields = entities.flatMap((entity) => entity.fields ?? []);
  const advanced = Boolean(project?.detachedAt);
  // `status` only describes the draft (every save sets DRAFT); whether the
  // module is installed comes from publishedAt.
  const published = Boolean(project?.publishedAt);
  return {
    name: definition.name?.trim() || project?.name || "Módulo sin nombre",
    description: definition.description?.trim() || project?.description?.trim() || "",
    moduleKey: project?.moduleKey ?? definition.key ?? "",
    icon: definition.icon ?? null,
    color: definition.color ?? null,
    version: definition.version ?? "0.1.0",
    publishedVersion: project?.publishedVersion ?? null,
    entityCount: entities.length,
    fieldCount: fields.length,
    viewCount: (definition.views ?? []).filter((view) => !view.generated).length,
    designedEntities: entities.filter((entity) => entity.layout).length,
    relationCount: fields.filter((field) => field.type === "relation").length,
    fileCount: fields.filter((field) => field.type === "file").length,
    status: advanced ? "ADVANCED" : published ? "PUBLISHED" : project?.status ?? "DRAFT",
    advanced,
    published,
    unpublishedChanges: !advanced && published && Boolean(project?.hasUnpublishedChanges),
    updatedAt: project?.updatedAt ?? null,
  };
}

export const PROJECT_STATUS = {
  DRAFT: { label: "Borrador", hint: "Aún no está instalado", tone: "bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  VALIDATED: { label: "Validado", hint: "Listo para publicar", tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  PUBLISHED: { label: "Publicado", hint: "Instalado en la instancia", tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  ADVANCED: { label: "Modo desarrollador", hint: "Se edita como código (ZIP)", tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
};
