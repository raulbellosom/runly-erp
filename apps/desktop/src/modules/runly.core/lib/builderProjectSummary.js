// Module Builder — display summary of a project for list cards and the
// editor header. Name/description/icon/color/version live in the module
// definition (edited in the General tab); the project row keeps only the
// values captured at creation, so the definition wins.

// Real install state of the project's module in this instance. `runtimeModule`
// is the merged row from GET /modules (null when unknown or not readable).
function installState(runtimeModule, published) {
  if (runtimeModule) {
    if (runtimeModule.status === "ERROR") return "ERROR";
    if (runtimeModule.status === "INSTALLED") return runtimeModule.enabled === false ? "DISABLED" : "ACTIVE";
    if (runtimeModule.status === "DISABLED") return "DISABLED";
    return published ? "UNINSTALLED" : "NOT_INSTALLED";
  }
  return published ? "ACTIVE" : "NOT_INSTALLED";
}

export function projectSummary(project, runtimeModule = null) {
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
    install: installState(runtimeModule, published),
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

export const INSTALL_STATE = {
  ACTIVE: { label: "Instalado", hint: "Instalado y activo en la instancia", dot: "bg-emerald-500" },
  DISABLED: { label: "Desactivado", hint: "Instalado pero desactivado en Módulos", dot: "bg-slate-400" },
  ERROR: { label: "Con error", hint: "La instalación tiene un error; revísalo en Módulos", dot: "bg-red-500" },
  UNINSTALLED: { label: "Desinstalado", hint: "Se publicó pero ya no está instalado", dot: "bg-slate-400" },
  NOT_INSTALLED: { label: "Sin instalar", hint: "Aún no se ha publicado", dot: "bg-slate-300 dark:bg-slate-600" },
};

// FilterBar definitions for the Constructor list; `match` maps a selected
// option value to a predicate over a project summary.
export const PROJECT_FILTERS = [
  {
    key: "install",
    label: "Estado",
    options: Object.entries(INSTALL_STATE).map(([value, meta]) => ({ value, label: meta.label })),
    match: (summary, value) => summary.install === value,
  },
  {
    key: "edition",
    label: "Edición",
    options: [
      { value: "visual", label: "Visual" },
      { value: "advanced", label: "Modo desarrollador" },
    ],
    match: (summary, value) => (value === "advanced") === summary.advanced,
  },
  {
    key: "changes",
    label: "Cambios",
    options: [
      { value: "pending", label: "Sin publicar" },
      { value: "clean", label: "Al día" },
    ],
    match: (summary, value) => (value === "pending") === summary.unpublishedChanges,
  },
];

export function matchesFilters(summary, values) {
  return PROJECT_FILTERS.every((filter) => !values[filter.key] || filter.match(summary, values[filter.key]));
}

export function matchesSearch(summary, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [summary.name, summary.moduleKey, summary.description].some((value) => value?.toLowerCase().includes(needle));
}
