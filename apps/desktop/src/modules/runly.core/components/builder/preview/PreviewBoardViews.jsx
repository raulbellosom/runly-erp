// Module Builder preview — KANBAN (one column per group value) and
// DASHBOARD (stat / chart / list widgets with deterministic sample figures).
// Dashboard samples are computed client-side from the draft definition:
// the server returns no rows for entity-less views.
import { LayoutDashboard, SquareKanban, TrendingUp } from "lucide-react";
import { FieldValue, PreviewCaption, PreviewSurface, formatPlain, optionLabel } from "./previewPrimitives";

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];
const AGGREGATE_LABELS = { count: "Conteo", sum: "Suma", avg: "Promedio", min: "Mínimo", max: "Máximo" };

function groupsFor(field) {
  if (!field) return [];
  if (field.type === "boolean") return [{ value: true, label: "Sí" }, { value: false, label: "No" }];
  if (field.type === "select") {
    return (field.options ?? []).map((o) => {
      const value = typeof o === "string" ? o : o.value;
      return { value, label: optionLabel(field, value) };
    });
  }
  return [];
}

export function KanbanPreview({ view, entity, rows }) {
  const fields = entity?.fields ?? [];
  const groupField = fields.find((f) => f.key === view.groupBy);
  const titleField = fields.find((f) => f.key === view.card?.titleField) ?? fields.find((f) => f.type === "text");
  const subtitleField = fields.find((f) => f.key === view.card?.subtitleField);
  const columns = groupsFor(groupField);

  return (
    <div className="space-y-3">
      <PreviewCaption icon={SquareKanban} title={view.title || "Tablero Kanban"}>
        {groupField
          ? `Una columna por cada valor de "${groupField.label}". Arrastrar una tarjeta entre columnas cambia ese valor.`
          : "Elige en la pestaña Vistas el campo que define las columnas."}
      </PreviewCaption>
      {columns.length > 0 && (
        <PreviewSurface className="p-3">
          <div className="flex gap-3 overflow-x-auto pb-1">
            {columns.map((column, index) => {
              const cards = rows.filter((r) => r[groupField.key] === column.value);
              return (
                <div key={String(column.value)} className="flex w-60 shrink-0 flex-col gap-2 rounded-xl bg-[hsl(var(--muted))]/50 p-2">
                  <div className="flex items-center gap-2 px-1 py-1">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                    <span className="flex-1 truncate text-sm font-medium">{column.label}</span>
                    <span className="rounded-full bg-[hsl(var(--background))] px-2 text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{cards.length}</span>
                  </div>
                  {cards.map((row) => (
                    <div key={row.id} className="space-y-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-sm">
                      <p className="truncate text-sm font-medium">{titleField ? formatPlain(titleField, row[titleField.key]) : row.id}</p>
                      {subtitleField && <div className="truncate text-xs text-[hsl(var(--muted-foreground))]"><FieldValue field={subtitleField} value={row[subtitleField.key]} compact /></div>}
                    </div>
                  ))}
                  {!cards.length && <p className="rounded-lg border border-dashed border-[hsl(var(--border))] px-2 py-4 text-center text-xs text-[hsl(var(--muted-foreground))]">Sin tarjetas</p>}
                </div>
              );
            })}
          </div>
        </PreviewSurface>
      )}
    </div>
  );
}

function seededValues(seed, count) {
  let x = [...seed].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) || 7;
  return Array.from({ length: count }, () => {
    x = (x * 9301 + 49297) % 233280;
    return 4 + Math.round((x / 233280) * 20);
  });
}

function BarChart({ data }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex h-36 items-end gap-2">
      {data.map((d, i) => (
        <div key={d.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1 min-w-0">
          <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{d.value}</span>
          <div className="w-full max-w-10 rounded-t-md" style={{ height: `${(d.value / max) * 75}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
          <span className="w-full truncate text-center text-[11px] text-[hsl(var(--muted-foreground))]">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function LineChart({ data }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const points = data.map((d, i) => `${(i / Math.max(data.length - 1, 1)) * 100},${40 - (d.value / max) * 34}`).join(" ");
  return (
    <div className="space-y-1">
      <svg viewBox="0 0 100 42" preserveAspectRatio="none" className="h-32 w-full overflow-visible" role="img" aria-label="Gráfica de línea de ejemplo">
        <polyline points={points} fill="none" stroke={CHART_COLORS[0]} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[11px] text-[hsl(var(--muted-foreground))]">
        {data.map((d) => <span key={d.label} className="truncate">{d.label}</span>)}
      </div>
    </div>
  );
}

function PieChart({ data, donut }) {
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  let acc = 0;
  const stops = data.map((d, i) => {
    const start = (acc / total) * 360;
    acc += d.value;
    return `${CHART_COLORS[i % CHART_COLORS.length]} ${start}deg ${(acc / total) * 360}deg`;
  });
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-28 w-28 shrink-0 rounded-full" style={{ background: `conic-gradient(${stops.join(", ")})` }}>
        {donut && <div className="absolute inset-5 rounded-full bg-[hsl(var(--background))]" />}
      </div>
      <ul className="min-w-0 flex-1 space-y-1 text-xs">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="flex-1 truncate">{d.label}</span>
            <span className="tabular-nums text-[hsl(var(--muted-foreground))]">{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WidgetBody({ widget, entity }) {
  const fields = entity?.fields ?? [];
  const aggregate = widget.source?.aggregate ?? "count";
  if (widget.type === "stat") {
    const field = fields.find((f) => f.key === widget.source?.aggregateField);
    const [value] = seededValues(widget.key ?? "stat", 1);
    const shown = aggregate === "count" ? value * 7 : field ? formatPlain(field, value * 125.5) : value * 125;
    return (
      <div className="space-y-1">
        <p className="text-3xl font-semibold tabular-nums">{shown}</p>
        <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><TrendingUp className="h-3.5 w-3.5" />+12% vs. mes anterior</p>
      </div>
    );
  }
  if (widget.type === "list") {
    const titleField = fields.find((f) => f.key === widget.display?.titleField);
    const subtitleField = fields.find((f) => f.key === widget.display?.subtitleField);
    return (
      <ul className="divide-y divide-[hsl(var(--border))]">
        {[1, 2, 3].map((n) => (
          <li key={n} className="py-2">
            <p className="truncate text-sm font-medium">{titleField ? `${titleField.label} ${n}` : `${entity?.label ?? "Registro"} ${n}`}</p>
            {subtitleField && <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{subtitleField.label} de ejemplo</p>}
          </li>
        ))}
      </ul>
    );
  }
  const groupField = fields.find((f) => f.key === widget.source?.groupBy);
  const labels = groupsFor(groupField).map((g) => g.label);
  const categories = (labels.length ? labels : ["Grupo A", "Grupo B", "Grupo C", "Grupo D"]).slice(0, 6);
  const values = seededValues(widget.key ?? "chart", categories.length);
  const data = categories.map((label, i) => ({ label, value: values[i] }));
  if (widget.chart === "line") return <LineChart data={data} />;
  if (widget.chart === "pie" || widget.chart === "donut") return <PieChart data={data} donut={widget.chart === "donut"} />;
  return <BarChart data={data} />;
}

export function DashboardPreview({ view, definition }) {
  const widgets = view.widgets ?? [];
  return (
    <div className="space-y-3">
      <PreviewCaption icon={LayoutDashboard} title={view.title || "Dashboard"}>
        Resumen con indicadores y gráficas. Las cifras son de ejemplo; en el módulo se calculan con los registros reales.
      </PreviewCaption>
      {widgets.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {widgets.map((widget) => {
            const entity = definition?.entities?.find((e) => e.key === widget.source?.entity);
            return (
              <PreviewSurface key={widget.key} className={`p-4 space-y-3 ${widget.type === "chart" ? "sm:col-span-2" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{widget.title || "Sin título"}</p>
                  <span className="shrink-0 text-[11px] text-[hsl(var(--muted-foreground))]">
                    {entity?.pluralLabel ?? entity?.label}{widget.type !== "list" ? ` · ${AGGREGATE_LABELS[widget.source?.aggregate ?? "count"]}` : ""}
                  </span>
                </div>
                <WidgetBody widget={widget} entity={entity} />
              </PreviewSurface>
            );
          })}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
          Este dashboard no tiene widgets todavía. Agrégalos en la pestaña Vistas.
        </p>
      )}
    </div>
  );
}
