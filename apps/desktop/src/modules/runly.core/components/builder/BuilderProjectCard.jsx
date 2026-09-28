// Module Builder — one project card on the Constructor list: module icon and
// human name first, version and status, description, what it contains
// (entities, fields, views, custom designs, relations, files) and whether it
// is edited visually or in "modo desarrollador".
import { Button } from "@runly/ui";
import { ArrowRight, Code2, Database, LayoutGrid, LayoutTemplate, Link2, Paperclip, Rows3, Trash2 } from "lucide-react";
import { ModuleIcon } from "../../../../components/ModuleCard";
import { PROJECT_STATUS, projectSummary } from "../../lib/builderProjectSummary";

function formatUpdated(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

function Stat({ icon: Icon, value, label }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-[hsl(var(--muted))] px-2 py-1 text-xs text-[hsl(var(--muted-foreground))]">
      <Icon className="h-3.5 w-3.5" />
      <span className="font-medium text-[hsl(var(--foreground))]">{value}</span>
      {label}
    </span>
  );
}

export function StatusPill({ status }) {
  const meta = PROJECT_STATUS[status] ?? PROJECT_STATUS.DRAFT;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.tone}`} title={meta.hint}>
      {status === "ADVANCED" && <Code2 className="h-3 w-3" />}
      {meta.label}
    </span>
  );
}

export function BuilderProjectCard({ project, onOpen, onDelete }) {
  const summary = projectSummary(project);
  const updated = formatUpdated(summary.updatedAt);
  const versionLabel = summary.publishedVersion && summary.publishedVersion !== summary.version
    ? `v${summary.version} · publicada v${summary.publishedVersion}`
    : `v${summary.version}`;

  return (
    <article className="group flex flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <ModuleIcon module={{ key: summary.moduleKey, name: summary.name, icon: summary.icon, color: summary.color }} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 font-semibold leading-snug">{summary.name}</h3>
            <StatusPill status={summary.status} />
          </div>
          <p className="mt-0.5 truncate text-xs text-[hsl(var(--muted-foreground))]">
            {versionLabel}
            <span className="font-mono"> · {summary.moduleKey}</span>
          </p>
        </div>
      </div>

      <p className={`mt-3 line-clamp-2 text-sm ${summary.description ? "text-[hsl(var(--muted-foreground))]" : "italic text-[hsl(var(--muted-foreground))]/70"}`}>
        {summary.description || "Sin descripción. Agrégala en la pestaña General del editor."}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Stat icon={Database} value={summary.entityCount} label={summary.entityCount === 1 ? "entidad" : "entidades"} />
        <Stat icon={Rows3} value={summary.fieldCount} label="campos" />
        <Stat icon={LayoutGrid} value={summary.viewCount} label={summary.viewCount === 1 ? "vista" : "vistas"} />
        <Stat icon={LayoutTemplate} value={summary.designedEntities} label={summary.designedEntities === 1 ? "diseño propio" : "diseños propios"} />
        <Stat icon={Link2} value={summary.relationCount} label={summary.relationCount === 1 ? "relación" : "relaciones"} />
        <Stat icon={Paperclip} value={summary.fileCount} label={summary.fileCount === 1 ? "archivo" : "archivos"} />
      </div>

      {summary.unpublishedChanges && (
        <p className="mt-3 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">Tiene cambios sin publicar.</p>
      )}
      {summary.advanced && (
        <p className="mt-3 rounded-lg bg-violet-500/10 px-2.5 py-1.5 text-xs text-violet-700 dark:text-violet-300">
          Se edita como código: descarga su ZIP desde el editor y súbelo en Módulos.
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <span className="text-xs text-[hsl(var(--muted-foreground))]">{updated ? `Actualizado ${updated}` : ""}</span>
        <div className="flex items-center gap-1">
          {!summary.published && (
            <Button size="icon" variant="ghost" className="text-red-600 hover:text-red-700" aria-label={`Eliminar ${summary.name}`} onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button size="sm" onClick={onOpen}>
            Abrir
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </article>
  );
}
