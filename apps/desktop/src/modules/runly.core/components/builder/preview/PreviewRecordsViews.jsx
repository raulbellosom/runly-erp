// Module Builder preview — CARDS / CALENDAR / TIMELINE / REPORT rendered with
// the real runtime renderers from @runly/ui, fed with the preview's sample
// rows shaped like the records-view query response (records + field meta,
// or groups + totals for REPORT, aggregated client-side here).
import { useState } from "react";
import { RunlyCalendarView, RunlyCardsView, RunlyReportView, RunlyTimelineView } from "@runly/ui";
import { CalendarDays, GanttChart, LayoutGrid, Table2 } from "lucide-react";
import { PreviewCaption } from "./previewPrimitives";

const SYSTEM_FIELDS = [
  { name: "created_at", label: "Fecha de creación", type: "datetime", options: null },
  { name: "updated_at", label: "Última actualización", type: "datetime", options: null },
];

const CAPTIONS = {
  CARDS: { icon: LayoutGrid, title: "Tarjetas", text: "Galería de registros. Al hacer clic en una tarjeta se abre su detalle." },
  CALENDAR: { icon: CalendarDays, title: "Calendario", text: "Cada registro aparece en el día de su fecha. En teléfonos se muestra como agenda." },
  TIMELINE: { icon: GanttChart, title: "Línea de tiempo", text: "Registros ordenados por fecha, agrupados por día." },
  REPORT: { icon: Table2, title: "Reporte", text: "Una fila por cada valor del campo agrupador, con sus cálculos y una fila de totales." },
};

function fieldsMeta(entity) {
  return [
    ...(entity?.fields ?? []).map((field) => ({ name: field.key, label: field.label, type: field.type, options: field.options ?? null })),
    ...SYSTEM_FIELDS,
  ];
}

function aggregate(measure, rows) {
  if (measure.aggregate === "count") return rows.length;
  const values = rows.map((row) => Number(row[measure.field])).filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  if (measure.aggregate === "sum") return values.reduce((a, b) => a + b, 0);
  if (measure.aggregate === "avg") return values.reduce((a, b) => a + b, 0) / values.length;
  return measure.aggregate === "min" ? Math.min(...values) : Math.max(...values);
}

function reportData(view, rows, fields) {
  const groupField = fields.find((field) => field.name === view.groupBy);
  const buckets = new Map();
  for (const row of rows) {
    const raw = row[view.groupBy];
    const key = raw == null ? "__null__" : String(typeof raw === "object" ? raw.label ?? raw.id : raw);
    if (!buckets.has(key)) buckets.set(key, { raw, rows: [] });
    buckets.get(key).rows.push(row);
  }
  const labelOf = (raw) => {
    if (raw == null) return "Sin valor";
    if (groupField?.type === "boolean") return raw ? "Sí" : "No";
    const option = (groupField?.options ?? []).find((o) => (typeof o === "object" ? o.value : o) === raw);
    return option ? (typeof option === "object" ? option.label : option) : String(typeof raw === "object" ? raw.label ?? raw.id : raw);
  };
  const measures = view.measures ?? [];
  const measureValues = (list) => Object.fromEntries(measures.map((m) => [m.key, aggregate(m, list)]));
  return {
    groups: [...buckets.values()].map((bucket) => ({ value: bucket.raw, label: labelOf(bucket.raw), measures: measureValues(bucket.rows) })),
    totals: measureValues(rows),
    fields,
  };
}

export function RecordsViewPreview({ kind, view, entity, rows }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const caption = CAPTIONS[kind];
  const fields = fieldsMeta(entity);
  const data = kind === "REPORT" ? reportData(view, rows, fields) : { records: rows, fields };
  return (
    <div className="space-y-3">
      <PreviewCaption icon={caption.icon} title={view.title || caption.title}>{caption.text}</PreviewCaption>
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 sm:p-4">
        {kind === "CARDS" && <RunlyCardsView schema={view} data={data} />}
        {kind === "CALENDAR" && <RunlyCalendarView schema={view} data={data} month={month} onMonthChange={setMonth} />}
        {kind === "TIMELINE" && <RunlyTimelineView schema={view} data={data} />}
        {kind === "REPORT" && <RunlyReportView schema={view} data={data} />}
      </div>
    </div>
  );
}
