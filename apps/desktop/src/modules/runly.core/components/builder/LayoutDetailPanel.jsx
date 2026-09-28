// Module Builder — "Diseño" right panel: how records open (page vs modal)
// and the detail presentation (hero, KPI strip, two columns).
import { Button, SelectField, SwitchField, TextField } from "@runly/ui";
import { Plus, Trash2 } from "lucide-react";
import { MAX_KPIS, updateDetail } from "../../lib/layoutHelpers";

const NONE = "__none";
const MODE_OPTIONS = [
  { value: "auto", label: "Automático" },
  { value: "page", label: "Página completa" },
  { value: "sheet", label: "Ventana lateral (modal)" },
];
const KPI_TYPES = new Set(["number", "decimal", "date", "datetime", "select"]);

function options(fields, emptyLabel) {
  return [{ value: NONE, label: emptyLabel }, ...fields.map((field) => ({ value: field.key, label: field.label }))];
}

function fromOption(value) {
  return value === NONE ? undefined : value;
}

export function LayoutDetailPanel({ layout, entity, readOnly, onChange }) {
  const fields = entity.fields ?? [];
  const detail = layout.detail ?? {};
  const hero = detail.hero ?? {};
  const kpis = detail.kpis ?? [];
  const textFields = fields.filter((field) => !["file", "relation", "json", "boolean"].includes(field.type));
  const selectFields = fields.filter((field) => field.type === "select");
  const imageFields = fields.filter((field) => field.type === "file" && field.accept === "image");
  const kpiFields = fields.filter((field) => KPI_TYPES.has(field.type));

  function patchHero(patch) {
    const next = { ...hero, ...patch };
    onChange(updateDetail(layout, { hero: next.titleField ? next : undefined }));
  }

  function patchKpi(index, patch) {
    onChange(updateDetail(layout, { kpis: kpis.map((kpi, i) => (i === index ? { ...kpi, ...patch } : kpi)) }));
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Apertura de registros</h3>
        <SelectField
          label="Modo"
          hint="Automático usa página completa cuando el formulario es grande."
          options={MODE_OPTIONS}
          value={layout.mode ?? "auto"}
          disabled={readOnly}
          onValueChange={(mode) => onChange({ ...layout, mode })}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Encabezado del detalle</h3>
        <SelectField label="Título" options={options(textFields, "Sin encabezado")} value={hero.titleField ?? NONE} disabled={readOnly} onValueChange={(value) => patchHero({ titleField: fromOption(value) })} />
        {hero.titleField && (
          <>
            <SelectField label="Subtítulo" options={options(textFields.filter((field) => field.key !== hero.titleField), "Ninguno")} value={hero.subtitleFields?.[0] ?? NONE} disabled={readOnly} onValueChange={(value) => patchHero({ subtitleFields: fromOption(value) ? [value] : undefined })} />
            <SelectField label="Estado" hint="Campo de selección que se muestra como etiqueta." options={options(selectFields, "Ninguno")} value={hero.statusField ?? NONE} disabled={readOnly} onValueChange={(value) => patchHero({ statusField: fromOption(value) })} />
            <SelectField
              label="Imagen"
              hint={imageFields.length ? undefined : "Crea un campo Archivo de tipo Imagen para usarlo aquí."}
              options={options(imageFields, "Ninguna")}
              value={hero.imageField ?? NONE}
              disabled={readOnly || !imageFields.length}
              onValueChange={(value) => patchHero({ imageField: fromOption(value) })}
            />
          </>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Indicadores (KPIs)</h3>
          {!readOnly && kpis.length < MAX_KPIS && kpiFields.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onChange(updateDetail(layout, { kpis: [...kpis, { field: kpiFields[0].key, label: kpiFields[0].label }] }))}>
              <Plus className="h-3.5 w-3.5" /> Agregar
            </Button>
          )}
        </div>
        {!kpiFields.length && <p className="text-xs text-[hsl(var(--muted-foreground))]">Necesitas campos numéricos, de fecha o de selección.</p>}
        {kpis.map((kpi, index) => (
          <div key={index} className="flex items-end gap-2">
            <SelectField className="flex-1" label="Campo" options={kpiFields.map((field) => ({ value: field.key, label: field.label }))} value={kpi.field} disabled={readOnly} onValueChange={(value) => patchKpi(index, { field: value })} />
            <TextField className="flex-1" label="Etiqueta" value={kpi.label ?? ""} disabled={readOnly} onChange={(e) => patchKpi(index, { label: e.target.value })} />
            {!readOnly && (
              <Button size="icon" variant="ghost" className="text-red-600" aria-label="Eliminar indicador" onClick={() => onChange(updateDetail(layout, { kpis: kpis.filter((_, i) => i !== index) }))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </section>

      <SwitchField
        label="Detalle en dos columnas"
        description="Las secciones de documentos se muestran en la columna lateral."
        checked={Boolean(detail.twoColumn)}
        disabled={readOnly}
        onChange={(checked) => onChange(updateDetail(layout, { twoColumn: checked || undefined }))}
      />
    </div>
  );
}
