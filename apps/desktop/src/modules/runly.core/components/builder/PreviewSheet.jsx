// Module Builder — declarative preview (Etapa 13). Renders the server's
// buildPreview() response (normalized view + synthetic sample rows) with
// lightweight preview components (./preview/*) — not the production
// RunlyTable/RunlyForm/RunlyDashboard components, which are wired for live
// API data and column-config persistence. This keeps preview instant and
// side-effect free (no install, no real data) at the cost of not being a
// pixel-perfect match for the installed screen.
import { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SelectField,
  Tabs,
  TabsList,
  TabsTrigger,
  ErrorState,
  Skeleton,
} from "@runly/ui";
import { CalendarDays, Database, FileText, GanttChart, LayoutDashboard, LayoutGrid, PanelsTopLeft, Sheet as SheetIcon, SquareKanban, SquarePen, Table2 } from "lucide-react";
import { runly } from "../../../../lib/runly";
import { navigationItems } from "../../lib/builderHelpers";
import { PagePreview, TablePreview } from "./preview/PreviewListViews";
import { DetailPreview, FormPreview } from "./preview/PreviewRecordViews";
import { DashboardPreview, KanbanPreview } from "./preview/PreviewBoardViews";
import { RecordsViewPreview } from "./preview/PreviewRecordsViews";

const DASHBOARDS_TARGET = "__dashboards";
const KIND_META = {
  PAGE: { label: "Página", icon: PanelsTopLeft, order: 0 },
  TABLE: { label: "Tabla", icon: Table2, order: 1 },
  FORM: { label: "Formulario", icon: SquarePen, order: 2 },
  DETAIL: { label: "Detalle", icon: FileText, order: 3 },
  KANBAN: { label: "Kanban", icon: SquareKanban, order: 4 },
  CARDS: { label: "Tarjetas", icon: LayoutGrid, order: 5 },
  CALENDAR: { label: "Calendario", icon: CalendarDays, order: 6 },
  TIMELINE: { label: "Línea de tiempo", icon: GanttChart, order: 7 },
  REPORT: { label: "Reporte", icon: SheetIcon, order: 8 },
  DASHBOARD: { label: "Dashboard", icon: LayoutDashboard, order: 9 },
};

function targetOf(view) {
  return view.entity ?? DASHBOARDS_TARGET;
}

function PreviewBody({ data, definition }) {
  const view = data.view.schema ? { ...data.view.schema, key: data.view.key } : data.view;
  switch (data.view.kind) {
    case "PAGE": {
      const nav = navigationItems(definition).find((item) => item.page === data.view.key);
      return <PagePreview entity={data.entity} rows={data.rows} moduleName={definition.name} path={nav?.path} />;
    }
    case "TABLE": return <TablePreview entity={data.entity} rows={data.rows} />;
    case "FORM": return <FormPreview entity={data.entity} rows={data.rows} />;
    case "DETAIL": return <DetailPreview entity={data.entity} rows={data.rows} />;
    case "KANBAN": return <KanbanPreview view={view} entity={data.entity} rows={data.rows} />;
    case "DASHBOARD": return <DashboardPreview view={view} definition={definition} />;
    case "CARDS":
    case "CALENDAR":
    case "TIMELINE":
    case "REPORT": return <RecordsViewPreview kind={data.view.kind} view={view} entity={data.entity} rows={data.rows} />;
    default: return <ErrorState title="Tipo de vista no soportado" description={data.view.kind} />;
  }
}

export function PreviewSheet({ open, onOpenChange, projectId, token, definition }) {
  const [viewKey, setViewKey] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    runly.builder.previewProject(projectId, viewKey, token)
      .then((res) => {
        if (cancelled) return;
        setData(res.data);
        if (!viewKey) setViewKey(res.data.view.key);
      })
      .catch((err) => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewKey, projectId]);

  const availableViews = data?.availableViews ?? [];
  const currentView = availableViews.find((v) => v.key === viewKey);
  const target = currentView ? targetOf(currentView) : null;

  const targetOptions = useMemo(() => {
    const targets = [...new Set(availableViews.map(targetOf))];
    return targets.map((key) => {
      if (key === DASHBOARDS_TARGET) return { value: key, label: "Dashboards", icon: LayoutDashboard };
      const entity = definition?.entities?.find((e) => e.key === key);
      return { value: key, label: entity?.pluralLabel || entity?.label || key, icon: Database };
    });
  }, [availableViews, definition]);

  const targetViews = availableViews
    .filter((v) => targetOf(v) === target)
    .sort((a, b) => (KIND_META[a.kind]?.order ?? 9) - (KIND_META[b.kind]?.order ?? 9));
  const repeatedKinds = new Set(targetViews.map((v) => v.kind).filter((kind, i, all) => all.indexOf(kind) !== i));

  function tabLabel(view) {
    const meta = KIND_META[view.kind];
    if (!repeatedKinds.has(view.kind)) return meta?.label ?? view.kind;
    return `${meta?.label ?? view.kind} · ${view.key.split(".").slice(1, -1).join(".") || view.key}`;
  }

  function selectTarget(nextTarget) {
    const first = availableViews
      .filter((v) => targetOf(v) === nextTarget)
      .sort((a, b) => (KIND_META[a.kind]?.order ?? 9) - (KIND_META[b.kind]?.order ?? 9))[0];
    if (first) setViewKey(first.key);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl flex flex-col gap-0 overflow-hidden">
        <SheetHeader className="shrink-0 space-y-4 pb-4 pr-8">
          <div className="space-y-1">
            <SheetTitle>Vista previa</SheetTitle>
            <SheetDescription>Así se verá el módulo instalado, con datos de ejemplo generados a partir de los tipos de campo.</SheetDescription>
          </div>
          {targetOptions.length > 0 && (
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              {targetOptions.length > 1 && (
                <div className="shrink-0 md:w-56">
                  <SelectField
                    label="Entidad"
                    options={targetOptions}
                    value={target ?? ""}
                    onValueChange={selectTarget}
                  />
                </div>
              )}
              <div className="min-w-0 flex-1 overflow-x-auto">
                <Tabs value={viewKey ?? ""} onValueChange={setViewKey}>
                  <TabsList>
                    {targetViews.map((view) => {
                      const Icon = KIND_META[view.kind]?.icon ?? Table2;
                      return (
                        <TabsTrigger key={view.key} value={view.key} className="gap-1.5">
                          <Icon className="h-3.5 w-3.5" />
                          {tabLabel(view)}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </Tabs>
              </div>
            </div>
          )}
        </SheetHeader>

        <div className="-mx-6 flex-1 min-h-0 overflow-y-auto border-t border-[hsl(var(--border))] px-6 pt-4">
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-14 w-full rounded-xl" />
              <Skeleton className="h-72 w-full rounded-2xl" />
            </div>
          )}
          {!loading && error && (
            <ErrorState
              title="No se pudo generar la vista previa"
              description={error.message === "Failed to fetch" ? "No hubo respuesta del servidor. Verifica tu conexión e inténtalo de nuevo." : error.message}
            />
          )}
          {!loading && !error && data && <PreviewBody data={data} definition={definition} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
