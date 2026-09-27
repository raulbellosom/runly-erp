// Module Builder — Vistas tab (Etapa 9). TABLE/FORM/DETAIL/PAGE are always
// generated one-per-entity by the compiler (templates/views.js reads
// straight from entity.fields — there is no per-view column config to
// expose yet), so this tab shows those as an informational summary and
// lets the user add/configure the two view kinds that DO have a real
// declarative schema: DASHBOARD and KANBAN.
import { useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
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
import { Plus, Trash2, LayoutDashboard, SquareKanban, Table2 } from "lucide-react";
import { addView, updateView, removeView } from "../../lib/builderHelpers";

const AGGREGATE_OPTIONS = [
  { value: "count", label: "Conteo" },
  { value: "sum", label: "Suma" },
  { value: "avg", label: "Promedio" },
  { value: "min", label: "Mínimo" },
  { value: "max", label: "Máximo" },
];
const CHART_OPTIONS = [
  { value: "bar", label: "Barras" },
  { value: "line", label: "Línea" },
  { value: "pie", label: "Pastel" },
  { value: "donut", label: "Dona" },
];
const WIDGET_TYPE_OPTIONS = [
  { value: "stat", label: "Estadística" },
  { value: "chart", label: "Gráfica" },
  { value: "list", label: "Lista" },
];

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
        value={view.title ?? ""}
        disabled={readOnly}
        onChange={(e) => onChange(updateView(definition, view.key, { title: e.target.value }))}
      />
      {widgets.map((widget, index) => {
        const entity = definition.entities.find((e) => e.key === widget.source?.entity);
        return (
          <div key={index} className="rounded-lg border border-[hsl(var(--border))] p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <TextField className="flex-1" placeholder="Título" value={widget.title ?? ""} disabled={readOnly} onChange={(e) => patchWidget(index, { title: e.target.value })} />
              {!readOnly && (
                <Button size="icon" variant="ghost" className="text-red-600" onClick={() => removeWidget(index)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
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
                <SelectField label="Agrupar por" options={(entity?.fields ?? []).map((f) => ({ value: f.key, label: f.label }))} value={widget.source?.groupBy ?? ""} disabled={readOnly} onValueChange={(value) => patchWidget(index, { source: { ...widget.source, groupBy: value } })} />
                <SelectField label="Gráfica" options={CHART_OPTIONS} value={widget.chart ?? "bar"} disabled={readOnly} onValueChange={(value) => patchWidget(index, { chart: value })} />
              </div>
            )}
            {widget.type === "list" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label="Campo principal"
                  options={(entity?.fields ?? []).map((f) => ({ value: f.key, label: f.label }))}
                  value={widget.display?.titleField ?? ""}
                  disabled={readOnly}
                  onValueChange={(value) => patchWidget(index, { display: { ...widget.display, titleField: value } })}
                />
                <SelectField
                  label="Campo secundario (opcional)"
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
        <TextField label="Título" value={view.title ?? ""} disabled={readOnly} onChange={(e) => patch({ title: e.target.value })} />
        <SelectField
          label="Entidad"
          options={definition.entities.map((e) => ({ value: e.key, label: e.label }))}
          value={view.entity ?? ""}
          disabled={readOnly}
          onValueChange={(value) => patch({ entity: value, groupBy: null })}
        />
      </div>
      <SelectField
        label="Agrupar por (columnas)"
        options={groupableFields.map((f) => ({ value: f.key, label: f.label }))}
        value={view.groupBy ?? ""}
        disabled={readOnly}
        onValueChange={(value) => patch({ groupBy: value })}
        placeholder={groupableFields.length ? "Selecciona un campo" : "Esta entidad no tiene campos select/booleanos"}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Título de tarjeta" options={cardFields.map((f) => ({ value: f.key, label: f.label }))} value={view.card?.titleField ?? ""} disabled={readOnly} onValueChange={(value) => patch({ card: { ...view.card, titleField: value } })} />
        <SelectField label="Subtítulo de tarjeta" options={cardFields.map((f) => ({ value: f.key, label: f.label }))} value={view.card?.subtitleField ?? ""} disabled={readOnly} onValueChange={(value) => patch({ card: { ...view.card, subtitleField: value } })} />
      </div>
    </div>
  );
}

export function ViewsTab({ definition, onChange, capabilities, readOnly }) {
  const [addOpen, setAddOpen] = useState(false);
  const [newKind, setNewKind] = useState("DASHBOARD");
  const [newEntity, setNewEntity] = useState(definition.entities[0]?.key ?? "");
  const [confirmDelete, setConfirmDelete] = useState(null);

  const customViews = (definition.views ?? []).filter((v) => ["DASHBOARD", "KANBAN"].includes(v.kind));

  return (
    <div className="space-y-5 pt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Table2 className="h-4 w-4" />Vistas generadas automáticamente</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-2">
            Cada entidad recibe Tabla, Formulario, Detalle y Página automáticamente, con todos sus campos.
          </p>
          <div className="flex flex-wrap gap-2">
            {definition.entities.map((entity) => (
              <Badge key={entity.key} variant="outline">{entity.label}: tabla · formulario · detalle</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {!customViews.length && (
        <EmptyState
          icon={LayoutDashboard}
          title="Sin dashboards ni tableros Kanban"
          description="Añade uno para mostrar estadísticas o un flujo de trabajo por estado."
          action={!readOnly ? { label: "Añadir vista", onClick: () => setAddOpen(true) } : undefined}
        />
      )}

      {customViews.map((view) => (
        <Card key={view.key}>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-sm flex items-center gap-2">
              {view.kind === "DASHBOARD" ? <LayoutDashboard className="h-4 w-4" /> : <SquareKanban className="h-4 w-4" />}
              {view.kind === "DASHBOARD" ? "Dashboard" : "Kanban"}
            </CardTitle>
            {!readOnly && (
              <Button size="icon" variant="ghost" className="text-red-600" onClick={() => setConfirmDelete(view)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {view.kind === "DASHBOARD"
              ? <DashboardEditor definition={definition} view={view} onChange={onChange} readOnly={readOnly} />
              : <KanbanEditor definition={definition} view={view} onChange={onChange} readOnly={readOnly} capabilities={capabilities} />}
          </CardContent>
        </Card>
      ))}

      {!readOnly && customViews.length > 0 && (
        <Button variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          Añadir vista
        </Button>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva vista</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <SelectField label="Tipo" options={[{ value: "DASHBOARD", label: "Dashboard" }, { value: "KANBAN", label: "Kanban" }]} value={newKind} onValueChange={setNewKind} />
            {newKind === "KANBAN" && (
              <SelectField label="Entidad" options={definition.entities.map((e) => ({ value: e.key, label: e.label }))} value={newEntity} onValueChange={setNewEntity} />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => {
                onChange(addView(definition, { kind: newKind, entityKey: newKind === "KANBAN" ? newEntity : undefined }));
                setAddOpen(false);
              }}
            >
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title="Eliminar vista"
        description="Esta vista dejará de estar disponible en el módulo."
        confirmLabel="Eliminar"
        onConfirm={() => { onChange(removeView(definition, confirmDelete.key)); setConfirmDelete(null); }}
      />
    </div>
  );
}
