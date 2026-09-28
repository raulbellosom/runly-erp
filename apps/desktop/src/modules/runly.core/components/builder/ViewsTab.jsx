// Module Builder — Vistas tab (Etapa 9). TABLE/FORM/DETAIL/PAGE are always
// generated one-per-entity by the compiler (templates/views.js reads
// straight from entity.fields — there is no per-view column config to
// expose yet), so this tab shows those as an informational summary and
// lets the user add/configure the view kinds that DO have a real declarative
// schema: DASHBOARD, KANBAN and the records views (RecordsViewEditors.jsx).
import { useState } from "react";
import {
  Button,
  Badge,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  TextField,
  SelectField,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  EmptyState,
} from "@runly/ui";
import {
  Plus, Trash2, LayoutDashboard, SquareKanban, Table2, Database, Heading, Sigma, Hash, Group, Columns3,
  BarChart3, LineChart, PieChart, CircleDashed, List, Gauge, Subtitles, Type, ChevronRight, MoreHorizontal,
} from "lucide-react";
import { addView, updateView, removeView, CUSTOM_VIEW_KINDS, RECORDS_VIEW_KINDS } from "../../lib/builderHelpers";
import { RecordsViewEditor, VIEW_KIND_META } from "./RecordsViewEditors";
import { CodeExtensionsCard } from "./CodeExtensionsCard";

const AGGREGATE_OPTIONS = [
  { value: "count", label: "Conteo", icon: Hash },
  { value: "sum", label: "Suma", icon: Sigma },
  { value: "avg", label: "Promedio", icon: Gauge },
  { value: "min", label: "Mínimo", icon: Sigma },
  { value: "max", label: "Máximo", icon: Sigma },
];
const CHART_OPTIONS = [
  { value: "bar", label: "Barras", icon: BarChart3 },
  { value: "line", label: "Línea", icon: LineChart },
  { value: "pie", label: "Pastel", icon: PieChart },
  { value: "donut", label: "Dona", icon: CircleDashed },
];
const WIDGET_TYPE_OPTIONS = [
  { value: "stat", label: "Estadística", icon: Hash },
  { value: "chart", label: "Gráfica", icon: BarChart3 },
  { value: "list", label: "Lista", icon: List },
];

function WidgetIcon({ type }) {
  const Icon = WIDGET_TYPE_OPTIONS.find((option) => option.value === type)?.icon ?? Hash;
  return <Icon className="h-3.5 w-3.5" />;
}

function numericFields(entity) {
  return (entity?.fields ?? []).filter((f) => ["number", "decimal"].includes(f.type));
}

// dashboard-schema.js forbids `source.aggregate` on list widgets and
// requires it (or groupBy) on stat/chart widgets — switching a widget's
// type in the dropdown without dropping the fields the old type left
// behind produced a definition that failed validation the moment someone
// picked "Lista" for a widget that started as "Estadística" or "Gráfica".
// Found during golden-path QA while building the Dashboard's list widget.
function widgetPatchForTypeChange(widget, nextType) {
  const source = widget.source ?? {};
  if (nextType === "list") {
    const { aggregate, aggregateField, groupBy, ...rest } = source;
    return { type: nextType, chart: undefined, source: rest };
  }
  if (nextType === "stat") {
    const { groupBy, ...rest } = source;
    return { type: nextType, chart: undefined, source: { ...rest, aggregate: rest.aggregate ?? "count" } };
  }
  return { type: nextType, chart: widget.chart ?? "bar", source: { ...source, aggregate: source.aggregate ?? "count" } };
}

function DashboardEditor({ definition, view, onChange, readOnly }) {
  const widgets = view.widgets ?? [];

  function patchWidget(index, patch) {
    const next = [...widgets];
    next[index] = { ...next[index], ...patch };
    onChange(updateView(definition, view.key, { widgets: next }));
  }
  function addWidget() {
    const key = `widget_${widgets.length + 1}`;
    onChange(updateView(definition, view.key, { widgets: [...widgets, { key, type: "stat", title: "Nueva estadística", source: { entity: definition.entities[0]?.key, aggregate: "count" } }] }));
  }
  function removeWidget(index) {
    onChange(updateView(definition, view.key, { widgets: widgets.filter((_, i) => i !== index) }));
  }

  return (
    <div className="space-y-3">
      <TextField
        label="Título del dashboard"
        icon={Heading}
        value={view.title ?? ""}
        disabled={readOnly}
        onChange={(e) => onChange(updateView(definition, view.key, { title: e.target.value }))}
      />
      {widgets.map((widget, index) => {
        const entity = definition.entities.find((e) => e.key === widget.source?.entity);
        return (
          <div key={index} className="rounded-xl border border-[hsl(var(--border))] p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))]">
                  <WidgetIcon type={widget.type} />
                </span>
                <span className="truncate text-sm font-medium">Widget {index + 1}</span>
              </span>
              {!readOnly && (
                <Button size="icon" variant="ghost" className="text-red-600" aria-label={`Eliminar widget ${index + 1}`} onClick={() => removeWidget(index)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <TextField
              label="Título del widget"
              icon={Heading}
              placeholder="Ej. Total de registros"
              hint="Se muestra como encabezado del widget en el dashboard."
              value={widget.title ?? ""}
              disabled={readOnly}
              onChange={(e) => patchWidget(index, { title: e.target.value })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label="Tipo"
                options={WIDGET_TYPE_OPTIONS}
                value={widget.type}
                disabled={readOnly}
                onValueChange={(value) => patchWidget(index, widgetPatchForTypeChange(widget, value))}
              />
              <SelectField
                label="Entidad"
                icon={Database}
                options={definition.entities.map((e) => ({ value: e.key, label: e.label }))}
                value={widget.source?.entity ?? ""}
                disabled={readOnly}
                onValueChange={(value) => patchWidget(index, { source: { ...widget.source, entity: value } })}
              />
            </div>
            {widget.type !== "list" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField label="Agregación" options={AGGREGATE_OPTIONS} value={widget.source?.aggregate ?? "count"} disabled={readOnly} onValueChange={(value) => patchWidget(index, { source: { ...widget.source, aggregate: value } })} />
                {["sum", "avg", "min", "max"].includes(widget.source?.aggregate) && (
                  <SelectField
                    label="Campo numérico"
                    icon={Hash}
                    options={numericFields(entity).map((f) => ({ value: f.key, label: f.label }))}
                    value={widget.source?.aggregateField ?? ""}
                    disabled={readOnly}
                    onValueChange={(value) => patchWidget(index, { source: { ...widget.source, aggregateField: value } })}
                  />
                )}
              </div>
            )}
            {widget.type === "chart" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField label="Agrupar por" icon={Group} options={(entity?.fields ?? []).map((f) => ({ value: f.key, label: f.label }))} value={widget.source?.groupBy ?? ""} disabled={readOnly} onValueChange={(value) => patchWidget(index, { source: { ...widget.source, groupBy: value } })} />
                <SelectField label="Gráfica" options={CHART_OPTIONS} value={widget.chart ?? "bar"} disabled={readOnly} onValueChange={(value) => patchWidget(index, { chart: value })} />
              </div>
            )}
            {widget.type === "list" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label="Campo principal"
                  icon={Type}
                  options={(entity?.fields ?? []).map((f) => ({ value: f.key, label: f.label }))}
                  value={widget.display?.titleField ?? ""}
                  disabled={readOnly}
                  onValueChange={(value) => patchWidget(index, { display: { ...widget.display, titleField: value } })}
                />
                <SelectField
                  label="Campo secundario (opcional)"
                  icon={Subtitles}
                  options={(entity?.fields ?? []).map((f) => ({ value: f.key, label: f.label }))}
                  value={widget.display?.subtitleField ?? ""}
                  disabled={readOnly}
                  onValueChange={(value) => patchWidget(index, { display: { ...widget.display, subtitleField: value } })}
                />
              </div>
            )}
          </div>
        );
      })}
      {!readOnly && (
        <Button variant="outline" size="sm" onClick={addWidget}>
          <Plus className="h-3.5 w-3.5" />
          Widget
        </Button>
      )}
    </div>
  );
}

function KanbanEditor({ definition, view, onChange, readOnly, capabilities }) {
  const entity = definition.entities.find((e) => e.key === view.entity);
  const groupableFields = (entity?.fields ?? []).filter((f) => (capabilities?.kanbanGroupFieldTypes ?? ["select", "boolean"]).includes(f.type));
  const cardFields = entity?.fields ?? [];

  function patch(p) {
    onChange(updateView(definition, view.key, p));
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Título" icon={Heading} value={view.title ?? ""} disabled={readOnly} onChange={(e) => patch({ title: e.target.value })} />
        <SelectField
          label="Entidad"
          icon={Database}
          options={definition.entities.map((e) => ({ value: e.key, label: e.label }))}
          value={view.entity ?? ""}
          disabled={readOnly}
          onValueChange={(value) => patch({ entity: value, groupBy: null })}
        />
      </div>
      <SelectField
        label="Agrupar por (columnas)"
        icon={Columns3}
        options={groupableFields.map((f) => ({ value: f.key, label: f.label }))}
        value={view.groupBy ?? ""}
        disabled={readOnly}
        onValueChange={(value) => patch({ groupBy: value })}
        placeholder={groupableFields.length ? "Selecciona un campo" : "Esta entidad no tiene campos select/booleanos"}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Título de tarjeta" icon={Type} options={cardFields.map((f) => ({ value: f.key, label: f.label }))} value={view.card?.titleField ?? ""} disabled={readOnly} onValueChange={(value) => patch({ card: { ...view.card, titleField: value } })} />
        <SelectField label="Subtítulo de tarjeta" icon={Subtitles} options={cardFields.map((f) => ({ value: f.key, label: f.label }))} value={view.card?.subtitleField ?? ""} disabled={readOnly} onValueChange={(value) => patch({ card: { ...view.card, subtitleField: value } })} />
      </div>
    </div>
  );
}

function ViewCard({ view, definition, onChange, readOnly, capabilities, expanded, onToggle, onDelete }) {
  const meta = VIEW_KIND_META[view.kind] ?? VIEW_KIND_META.DASHBOARD;
  const Icon = meta.icon;
  const entity = definition.entities.find((e) => e.key === view.entity);
  return (
    <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <div className="flex items-center gap-2 px-3 py-3 sm:px-4">
        <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left" aria-expanded={expanded} onClick={onToggle}>
          <ChevronRight className={`h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform ${expanded ? "rotate-90" : ""}`} />
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--muted))]"><Icon className="h-4 w-4" /></span>
          <span className="min-w-0">
            <span className="block truncate font-semibold">{view.title || meta.label}</span>
            <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">{meta.label}{entity ? ` · ${entity.label}` : ""}</span>
          </span>
        </button>
        {!readOnly && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={`Acciones de ${view.title || meta.label}`}><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-red-600 focus:text-red-600" onSelect={onDelete}><Trash2 />Eliminar vista</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {expanded && (
        <div className="border-t border-[hsl(var(--border))] px-3 py-4 sm:px-4">
          {view.kind === "DASHBOARD" && <DashboardEditor definition={definition} view={view} onChange={onChange} readOnly={readOnly} />}
          {view.kind === "KANBAN" && <KanbanEditor definition={definition} view={view} onChange={onChange} readOnly={readOnly} capabilities={capabilities} />}
          {RECORDS_VIEW_KINDS.includes(view.kind) && <RecordsViewEditor definition={definition} view={view} onChange={onChange} readOnly={readOnly} />}
        </div>
      )}
    </section>
  );
}

function NewViewDialog({ open, onOpenChange, definition, onCreate }) {
  const [kind, setKind] = useState("CARDS");
  const [entityKey, setEntityKey] = useState(definition.entities[0]?.key ?? "");
  const needsEntity = kind !== "DASHBOARD";
  const entityExists = definition.entities.some((e) => e.key === entityKey);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Nueva vista</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Tipo de vista" className="grid gap-2 sm:grid-cols-2">
            {CUSTOM_VIEW_KINDS.map((value) => {
              const meta = VIEW_KIND_META[value];
              const Icon = meta.icon;
              const active = kind === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setKind(value)}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-colors ${active ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5" : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40"}`}
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-[hsl(var(--muted))]"}`}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{meta.label}</span>
                    <span className="block text-xs text-[hsl(var(--muted-foreground))]">{meta.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {needsEntity && (
            <SelectField
              label="Entidad"
              icon={Database}
              options={definition.entities.map((e) => ({ value: e.key, label: e.label }))}
              value={entityExists ? entityKey : ""}
              onValueChange={setEntityKey}
              placeholder={definition.entities.length ? "Selecciona una entidad" : "Crea una entidad en la pestaña Datos"}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={needsEntity && !entityExists} onClick={() => onCreate({ kind, entityKey: needsEntity ? entityKey : undefined })}>Crear</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ViewsTab({ definition, onChange, capabilities, readOnly }) {
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const customViews = (definition.views ?? []).filter((v) => CUSTOM_VIEW_KINDS.includes(v.kind));
  const [expandedKeys, setExpandedKeys] = useState(() => new Set(customViews.length <= 2 ? customViews.map((v) => v.key) : []));

  function toggle(key) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleCreate({ kind, entityKey }) {
    const next = addView(definition, { kind, entityKey });
    const created = next.views[next.views.length - 1];
    onChange(next);
    setExpandedKeys((current) => new Set(current).add(created.key));
    setAddOpen(false);
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Vistas</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Formas adicionales de ver los registros. Después, agrégalas al menú en la pestaña Navegación.</p>
        </div>
        {!readOnly && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Añadir vista
          </Button>
        )}
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-4 py-3">
        <Table2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm">Cada entidad ya incluye automáticamente <span className="font-medium">Página, Tabla, Formulario y Detalle</span>.</p>
          <div className="flex flex-wrap gap-1.5">
            {definition.entities.map((entity) => <Badge key={entity.key} variant="outline">{entity.label}</Badge>)}
          </div>
        </div>
      </div>

      <CodeExtensionsCard definition={definition} onChange={onChange} readOnly={readOnly} />

      {!customViews.length && (
        <EmptyState
          icon={LayoutDashboard}
          title="Sin vistas adicionales"
          description="Añade tarjetas, un calendario, una línea de tiempo, un reporte, un tablero Kanban o un dashboard."
          action={!readOnly ? { label: "Añadir vista", onClick: () => setAddOpen(true) } : undefined}
        />
      )}

      {customViews.map((view) => (
        <ViewCard
          key={view.key}
          view={view}
          definition={definition}
          onChange={onChange}
          readOnly={readOnly}
          capabilities={capabilities}
          expanded={expandedKeys.has(view.key)}
          onToggle={() => toggle(view.key)}
          onDelete={() => setConfirmDelete(view)}
        />
      ))}

      {addOpen && <NewViewDialog open={addOpen} onOpenChange={setAddOpen} definition={definition} onCreate={handleCreate} />}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title="Eliminar vista"
        description="Esta vista dejará de estar disponible en el módulo y se quitará del menú."
        confirmLabel="Eliminar"
        onConfirm={() => { onChange((d) => removeView(d, confirmDelete.key)); setConfirmDelete(null); }}
      />
    </div>
  );
}
