// Module Builder preview — FORM (create/edit form, one control per field
// type) and DETAIL (read-only record sheet with Editar/Desactivar actions),
// mirroring what generateFormView/generateDetailView compile to.
import { Button } from "@runly/ui";
import { Calendar, ChevronDown, Clock, FileText, Pencil, Power, Search, SquarePen } from "lucide-react";
import {
  FieldValue,
  PreviewCaption,
  PreviewSurface,
  WIDE_TYPES,
  fieldIcon,
  formatPlain,
  recordTitle,
} from "./previewPrimitives";
import { FilePreviewControl, PreviewHero, PreviewLayoutBody } from "./PreviewLayout";
import { resolveLayoutForPreview } from "../../../lib/layoutHelpers";

const INPUT = "flex min-h-11 w-full items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm";

function FauxControl({ field, value }) {
  const text = formatPlain(field, value);
  switch (field.type) {
    case "boolean":
      return (
        <div className="flex min-h-11 items-center gap-3">
          <span className={`relative h-6 w-10 rounded-full ${value ? "bg-primary" : "bg-[hsl(var(--muted-foreground)/0.3)]"}`}>
            <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm ${value ? "left-5" : "left-1"}`} />
          </span>
          <span className="text-sm">{value ? "Sí" : "No"}</span>
        </div>
      );
    case "select":
    case "multiselect":
      return (
        <div className={INPUT}>
          <span className="flex-1 min-w-0"><FieldValue field={field} value={value} compact /></span>
          <ChevronDown className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
        </div>
      );
    case "relation":
      return (
        <div className={INPUT}>
          <Search className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <span className="flex-1 truncate">{text}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
        </div>
      );
    case "date":
    case "datetime":
      return (
        <div className={INPUT}>
          {field.type === "date" ? <Calendar className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" /> : <Clock className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />}
          <span className="truncate">{text}</span>
        </div>
      );
    case "color":
      return <div className={INPUT}><FieldValue field={field} value={value} /></div>;
    case "file":
      return <FilePreviewControl field={field} />;
    case "textarea":
    case "markdown":
    case "richtext":
    case "json":
      return <div className={`${INPUT} min-h-24 items-start py-2.5`}><span className="line-clamp-3">{text}</span></div>;
    default:
      return (
        <div className={INPUT}>
          <span className={`truncate ${["number", "decimal"].includes(field.type) ? "tabular-nums" : ""}`}>{text}</span>
        </div>
      );
  }
}

function FormFieldPreview({ field, value }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">
        {field.label}
        {field.required && <span className="ml-1 text-xs text-red-500">*</span>}
      </span>
      <FauxControl field={field} value={value} />
    </div>
  );
}

function DetailFieldPreview({ field, value }) {
  const Icon = fieldIcon(field.type);
  return (
    <div className="space-y-1">
      <dt className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
        <Icon className="h-3.5 w-3.5" />
        {field.label}
      </dt>
      <dd className="text-sm min-w-0"><FieldValue field={field} value={value} /></dd>
    </div>
  );
}

export function FormPreview({ entity, rows }) {
  const fields = entity?.fields ?? [];
  const row = rows[0] ?? {};
  const layout = resolveLayoutForPreview(entity);
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const label = (entity?.label ?? "registro").toLowerCase();
  return (
    <div className="space-y-3">
      <PreviewCaption icon={SquarePen} title="Formulario">
        Se abre al crear o editar un registro. Cada tipo de campo usa su propio control; los campos con * son obligatorios.
      </PreviewCaption>
      <PreviewSurface>
        <div className="border-b border-[hsl(var(--border))] px-5 py-4">
          <h3 className="font-semibold">Editar {label}</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Datos de ejemplo precargados</p>
        </div>
        {layout ? (
          <PreviewLayoutBody layout={layout} fieldsByKey={fieldsByKey} renderField={(field) => <FormFieldPreview field={field} value={row[field.key]} />} />
        ) : (
        <div className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.key} className={`space-y-1.5 ${WIDE_TYPES.has(field.type) ? "sm:col-span-2" : ""}`}>
              <span className="text-sm font-medium">
                {field.label}
                {field.required && <span className="ml-1 text-xs text-red-500">*</span>}
              </span>
              <FauxControl field={field} value={row[field.key]} />
            </div>
          ))}
          {!fields.length && <p className="text-sm text-[hsl(var(--muted-foreground))] sm:col-span-2">Agrega campos a la entidad para ver el formulario.</p>}
        </div>
        )}
        <div className="flex justify-end gap-2 border-t border-[hsl(var(--border))] px-5 py-3" aria-hidden="true">
          <Button size="sm" variant="outline" tabIndex={-1} className="pointer-events-none">Cancelar</Button>
          <Button size="sm" tabIndex={-1} className="pointer-events-none bg-(--brand-primary) text-(--brand-primary-foreground)">Guardar {label}</Button>
        </div>
      </PreviewSurface>
    </div>
  );
}

export function DetailPreview({ entity, rows }) {
  const fields = entity?.fields ?? [];
  const row = rows[0] ?? {};
  const layout = resolveLayoutForPreview(entity);
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const highlight = fields.filter((f) => f.type === "select" || f.type === "boolean").slice(0, 3);
  return (
    <div className="space-y-3">
      <PreviewCaption icon={FileText} title="Detalle del registro">
        Ficha de solo lectura que se abre al hacer clic en una fila de la tabla, con acciones para editar o desactivar.
      </PreviewCaption>
      <PreviewSurface>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[hsl(var(--border))] px-5 py-4">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{entity?.label}</p>
            <h3 className="text-lg font-semibold leading-tight break-words">{recordTitle(entity, row)}</h3>
            {highlight.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {highlight.map((field) => <FieldValue key={field.key} field={field} value={row[field.key]} compact />)}
              </div>
            )}
          </div>
          <div className="flex gap-2" aria-hidden="true">
            <Button size="sm" variant="outline" tabIndex={-1} className="pointer-events-none"><Pencil className="h-3.5 w-3.5" />Editar</Button>
            <Button size="sm" variant="ghost" tabIndex={-1} className="pointer-events-none text-red-600"><Power className="h-3.5 w-3.5" />Desactivar</Button>
          </div>
        </div>
        {layout ? (
          <>
            <PreviewHero layout={layout} fieldsByKey={fieldsByKey} row={row} />
            <PreviewLayoutBody layout={layout} fieldsByKey={fieldsByKey} renderField={(field) => <DetailFieldPreview field={field} value={row[field.key]} />} />
          </>
        ) : (
        <dl className="grid gap-px bg-[hsl(var(--border))] sm:grid-cols-2">
          {fields.map((field) => {
            const Icon = fieldIcon(field.type);
            return (
              <div key={field.key} className={`space-y-1 bg-[hsl(var(--background))] px-5 py-3 ${WIDE_TYPES.has(field.type) ? "sm:col-span-2" : ""}`}>
                <dt className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                  <Icon className="h-3.5 w-3.5" />
                  {field.label}
                </dt>
                <dd className="text-sm min-w-0"><FieldValue field={field} value={row[field.key]} /></dd>
              </div>
            );
          })}
        </dl>
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-[hsl(var(--border))] px-5 py-3 text-xs text-[hsl(var(--muted-foreground))]">
          <span>Creado: {formatPlain({ type: "datetime" }, row.created_at)}</span>
          <span>Actualizado: {formatPlain({ type: "datetime" }, row.updated_at)}</span>
        </div>
      </PreviewSurface>
    </div>
  );
}
