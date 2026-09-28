// Module Builder — editors for the records view kinds (CARDS, CALENDAR,
// TIMELINE, REPORT) plus the shared metadata (label/icon/description) every
// view kind uses in the Vistas tab. Field pickers only offer fields whose
// type the compiler accepts for that slot (records-views.js).
import { Button, SelectField, TextField } from "@runly/ui";
import {
  CalendarDays, Database, GanttChart, Group, Hash, Heading, Image, LayoutDashboard, LayoutGrid,
  Palette, Plus, SquareKanban, Subtitles, Table2, Tag, Trash2, Type, AlignLeft, Sigma, Gauge,
} from "lucide-react";
import { updateView } from "../../lib/builderHelpers";
import { FIELD_TYPE_ICONS } from "../../lib/builderFieldIcons";

export const VIEW_KIND_META = {
  DASHBOARD: { label: "Dashboard", icon: LayoutDashboard, description: "Indicadores y gráficas de una o varias entidades." },
  KANBAN: { label: "Kanban", icon: SquareKanban, description: "Tarjetas en columnas por estado; se mueven arrastrando." },
  CARDS: { label: "Tarjetas", icon: LayoutGrid, description: "Galería de registros con imagen, título y etiqueta." },
  CALENDAR: { label: "Calendario", icon: CalendarDays, description: "Registros ubicados en un calendario mensual por fecha." },
  TIMELINE: { label: "Línea de tiempo", icon: GanttChart, description: "Registros ordenados por fecha en una línea vertical." },
  REPORT: { label: "Reporte", icon: Table2, description: "Registros agrupados por un campo, con conteos y totales." },
};

const NONE = "__none__";
const DATE_TYPES = ["date", "datetime"];
const NUMERIC_TYPES = ["number", "decimal"];
const SYSTEM_DATE_OPTIONS = [
  { value: "created_at", label: "Fecha de creación", icon: CalendarDays },
  { value: "updated_at", label: "Última actualización", icon: CalendarDays },
];
const MEASURE_AGGREGATES = [
  { value: "count", label: "Conteo", icon: Hash },
  { value: "sum", label: "Suma", icon: Sigma },
  { value: "avg", label: "Promedio", icon: Gauge },
  { value: "min", label: "Mínimo", icon: Sigma },
  { value: "max", label: "Máximo", icon: Sigma },
];

function fieldOptions(entity, types, { optional = false } = {}) {
  const options = (entity?.fields ?? [])
    .filter((f) => f.type !== "relation" && (!types || types.includes(f.type)))
    .map((f) => ({ value: f.key, label: f.label, icon: FIELD_TYPE_ICONS[f.type] }));
  return optional ? [{ value: NONE, label: "Ninguno" }, ...options] : options;
}

function FieldPicker({ label, icon, entity, types, optional, value, onChange, readOnly, extraOptions = [], hint }) {
  const options = [...fieldOptions(entity, types, { optional }), ...extraOptions];
  return (
    <SelectField
      label={label}
      icon={icon}
      hint={hint}
      options={options}
      value={value ?? (optional ? NONE : "")}
      disabled={readOnly}
      placeholder={options.length ? "Selecciona un campo" : "La entidad no tiene campos compatibles"}
      onValueChange={(next) => onChange(next === NONE ? undefined : next)}
    />
  );
}

function CommonFields({ definition, view, patch, readOnly }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField label="Título de la vista" icon={Heading} value={view.title ?? ""} disabled={readOnly} onChange={(e) => patch({ title: e.target.value })} />
      <SelectField
        label="Entidad"
        icon={Database}
        options={definition.entities.map((e) => ({ value: e.key, label: e.label }))}
        value={view.entity ?? ""}
        disabled={readOnly}
        hint="Al cambiarla se reinician los campos elegidos."
        onValueChange={(value) => patch({ entity: value, card: {}, dateField: undefined, titleField: undefined, colorField: undefined, descriptionField: undefined, badgeField: undefined, groupBy: undefined, measures: [{ key: "total", label: "Registros", aggregate: "count" }] })}
      />
    </div>
  );
}

function CardsFields({ entity, view, patch, readOnly }) {
  const card = view.card ?? {};
  const set = (key) => (value) => patch({ card: { ...card, [key]: value } });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FieldPicker label="Título de la tarjeta" icon={Type} entity={entity} value={card.titleField} onChange={set("titleField")} readOnly={readOnly} />
      <FieldPicker label="Subtítulo" icon={Subtitles} entity={entity} optional value={card.subtitleField} onChange={set("subtitleField")} readOnly={readOnly} />
      <FieldPicker label="Descripción" icon={AlignLeft} entity={entity} optional value={card.descriptionField} onChange={set("descriptionField")} readOnly={readOnly} />
      <FieldPicker label="Etiqueta" icon={Tag} entity={entity} optional value={card.badgeField} onChange={set("badgeField")} readOnly={readOnly} />
      <FieldPicker label="Imagen" icon={Image} entity={entity} types={["file"]} optional value={card.imageField} onChange={set("imageField")} readOnly={readOnly} hint="Solo campos de tipo Archivo." />
    </div>
  );
}

function DateViewFields({ kind, entity, view, patch, readOnly }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FieldPicker label="Campo de fecha" icon={CalendarDays} entity={entity} types={DATE_TYPES} value={view.dateField} onChange={(v) => patch({ dateField: v })} readOnly={readOnly} extraOptions={SYSTEM_DATE_OPTIONS} hint="Define dónde se ubica cada registro." />
      <FieldPicker label="Título del registro" icon={Type} entity={entity} value={view.titleField} onChange={(v) => patch({ titleField: v })} readOnly={readOnly} />
      {kind === "CALENDAR" && (
        <FieldPicker label="Color por" icon={Palette} entity={entity} types={["select", "boolean"]} optional value={view.colorField} onChange={(v) => patch({ colorField: v })} readOnly={readOnly} hint="Colorea cada registro según una selección." />
      )}
      {kind === "TIMELINE" && (
        <>
          <FieldPicker label="Descripción" icon={AlignLeft} entity={entity} optional value={view.descriptionField} onChange={(v) => patch({ descriptionField: v })} readOnly={readOnly} />
          <FieldPicker label="Etiqueta" icon={Tag} entity={entity} optional value={view.badgeField} onChange={(v) => patch({ badgeField: v })} readOnly={readOnly} />
        </>
      )}
    </div>
  );
}

function ReportFields({ entity, view, patch, readOnly }) {
  const measures = view.measures ?? [];
  function patchMeasure(index, next) {
    const list = [...measures];
    list[index] = { ...list[index], ...next };
    if (next.aggregate === "count") delete list[index].field;
    patch({ measures: list });
  }
  function addMeasure() {
    const used = new Set(measures.map((m) => m.key));
    let n = measures.length + 1;
    while (used.has(`medida_${n}`)) n++;
    patch({ measures: [...measures, { key: `medida_${n}`, label: `Medida ${n}`, aggregate: "count" }] });
  }
  return (
    <div className="space-y-3">
      <FieldPicker label="Agrupar por" icon={Group} entity={entity} value={view.groupBy} onChange={(v) => patch({ groupBy: v })} readOnly={readOnly} hint="Cada valor distinto de este campo será una fila." />
      <div className="space-y-2">
        <span className="text-sm font-medium">Columnas de cálculo</span>
        {measures.map((measure, index) => (
          <div key={measure.key} className="grid gap-3 rounded-xl border border-[hsl(var(--border))] p-3 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_auto] sm:items-end">
            <TextField label="Nombre de la columna" icon={Heading} value={measure.label ?? ""} disabled={readOnly} onChange={(e) => patchMeasure(index, { label: e.target.value })} />
            <SelectField label="Cálculo" options={MEASURE_AGGREGATES} value={measure.aggregate} disabled={readOnly} onValueChange={(value) => patchMeasure(index, { aggregate: value })} />
            {measure.aggregate === "count" ? (
              <p className="pb-3 text-xs text-[hsl(var(--muted-foreground))]">Cuenta los registros de cada grupo.</p>
            ) : (
              <FieldPicker
                label="Campo"
                icon={Hash}
                entity={entity}
                types={["sum", "avg"].includes(measure.aggregate) ? NUMERIC_TYPES : [...NUMERIC_TYPES, ...DATE_TYPES]}
                value={measure.field}
                onChange={(v) => patchMeasure(index, { field: v })}
                readOnly={readOnly}
              />
            )}
            {!readOnly && (
              <Button size="icon" variant="ghost" className="text-red-600" disabled={measures.length === 1} aria-label={`Quitar ${measure.label}`} onClick={() => patch({ measures: measures.filter((_, i) => i !== index) })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
        {!readOnly && measures.length < 6 && (
          <Button size="sm" variant="outline" onClick={addMeasure}>
            <Plus className="h-3.5 w-3.5" />
            Columna de cálculo
          </Button>
        )}
      </div>
    </div>
  );
}

export function RecordsViewEditor({ definition, view, onChange, readOnly }) {
  const entity = definition.entities.find((e) => e.key === view.entity);
  const patch = (p) => onChange((d) => updateView(d, view.key, p));
  return (
    <div className="space-y-4">
      <CommonFields definition={definition} view={view} patch={patch} readOnly={readOnly} />
      {view.kind === "CARDS" && <CardsFields entity={entity} view={view} patch={patch} readOnly={readOnly} />}
      {(view.kind === "CALENDAR" || view.kind === "TIMELINE") && <DateViewFields kind={view.kind} entity={entity} view={view} patch={patch} readOnly={readOnly} />}
      {view.kind === "REPORT" && <ReportFields entity={entity} view={view} patch={patch} readOnly={readOnly} />}
    </div>
  );
}
