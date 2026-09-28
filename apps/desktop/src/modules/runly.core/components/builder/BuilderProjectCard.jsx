// Module Builder — one project card on the Constructor list: module icon and
// human name first, version and status, description and a compact summary
// (entities, views, relations). Cards share a fixed layout so every card in
// the grid has the same height.
import { Link } from "react-router-dom";
import { Button } from "@runly/ui";
import { ArrowRight, Code2, Database, LayoutGrid, Link2, Trash2 } from "lucide-react";
import { ModuleIcon } from "../../../../components/ModuleCard";
import { INSTALL_STATE, PROJECT_STATUS, projectSummary } from "../../lib/builderProjectSummary";

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

export function BuilderProjectCard({ project, runtimeModule = null, href, onDelete }) {
  const summary = projectSummary(project, runtimeModule);
  const install = INSTALL_STATE[summary.install] ?? INSTALL_STATE.NOT_INSTALLED;
  const updated = formatUpdated(summary.updatedAt);
  const versionLabel = summary.publishedVersion && summary.publishedVersion !== summary.version
    ? `v${summary.version} · publicada v${summary.publishedVersion}`
    : `v${summary.version}`;

  return (
    <article className="group flex h-full flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <Link to={href} aria-label={`Abrir ${summary.name}`} className="shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]/40">
          <ModuleIcon module={{ key: summary.moduleKey, name: summary.name, icon: summary.icon, color: summary.color }} size="md" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 font-semibold leading-snug">
              <Link to={href} className="hover:underline focus-visible:underline focus-visible:outline-none">
                {summary.name}
              </Link>
            </h3>
            <StatusPill status={summary.status} />
          </div>
          <p className="mt-0.5 truncate text-xs text-[hsl(var(--muted-foreground))]">
            {versionLabel}
            <span className="font-mono"> · {summary.moduleKey}</span>
          </p>
        </div>
      </div>

      <p className={`mt-3 line-clamp-2 min-h-10 text-sm ${summary.description ? "text-[hsl(var(--muted-foreground))]" : "italic text-[hsl(var(--muted-foreground))]/70"}`}>
        {summary.description || "Sin descripción. Agrégala en la pestaña General del editor."}
      </p>

      <div className="mt-3 flex min-h-6.5 flex-wrap gap-1.5">
        <Stat icon={Database} value={summary.entityCount} label={summary.entityCount === 1 ? "entidad" : "entidades"} />
        <Stat icon={LayoutGrid} value={summary.viewCount} label={summary.viewCount === 1 ? "vista" : "vistas"} />
        <Stat icon={Link2} value={summary.relationCount} label={summary.relationCount === 1 ? "relación" : "relaciones"} />
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <div className="min-w-0 text-xs text-[hsl(var(--muted-foreground))]">
          <p className="flex items-center gap-1.5 font-medium text-[hsl(var(--foreground))]" title={install.hint}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${install.dot}`} />
            {install.label}
            {summary.unpublishedChanges && (
              <span className="font-normal text-amber-600 dark:text-amber-400">· cambios sin publicar</span>
            )}
          </p>
          <p className="mt-0.5 truncate">{updated ? `Actualizado ${updated}` : " "}</p>
        </div>
        <div className="flex items-center gap-1">
          {!summary.published && (
            <Button size="icon" variant="ghost" className="text-red-600 hover:text-red-700" aria-label={`Eliminar ${summary.name}`} onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button size="sm" asChild>
            <Link to={href}>
              Abrir
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}
