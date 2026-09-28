// Module Builder preview — TABLE (the records grid) and PAGE (the full menu
// screen that hosts that grid, as definePage() lays it out).
import { Button } from "@runly/ui";
import { ChevronRight, Filter, MoreHorizontal, PanelsTopLeft, Plus, Search, Table2 } from "lucide-react";
import { FieldValue, NUMERIC_TYPES, PreviewCaption, PreviewSurface, fieldIcon } from "./previewPrimitives";

function RecordsTable({ entity, rows }) {
  const fields = entity?.fields ?? [];
  if (!fields.length) {
    return <p className="px-4 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">Esta entidad no tiene campos: la tabla no tendrá columnas.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50">
            {fields.map((field) => {
              const Icon = fieldIcon(field.type);
              return (
                <th
                  key={field.key}
                  scope="col"
                  className={`px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-foreground))] whitespace-nowrap ${NUMERIC_TYPES.has(field.type) ? "text-right" : "text-left"}`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5" />
                    {field.label}
                  </span>
                </th>
              );
            })}
            <th className="w-10" aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id} className={`border-b border-[hsl(var(--border))] last:border-0 ${index === 0 ? "bg-[hsl(var(--muted))]/30" : ""}`}>
              {fields.map((field, fieldIndex) => (
                <td
                  key={field.key}
                  className={`px-4 py-3 max-w-64 ${NUMERIC_TYPES.has(field.type) ? "text-right" : ""} ${fieldIndex === 0 ? "font-medium" : ""}`}
                >
                  <FieldValue field={field} value={row[field.key]} compact />
                </td>
              ))}
              <td className="px-2 text-[hsl(var(--muted-foreground))]"><MoreHorizontal className="h-4 w-4" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableFooter({ count }) {
  return (
    <div className="flex items-center justify-between border-t border-[hsl(var(--border))] px-4 py-2.5 text-xs text-[hsl(var(--muted-foreground))]">
      <span>{count} registros de ejemplo</span>
      <span>Página 1 de 1</span>
    </div>
  );
}

export function TablePreview({ entity, rows }) {
  return (
    <div className="space-y-3">
      <PreviewCaption icon={Table2} title="Tabla de registros">
        Lista de {(entity?.pluralLabel ?? "registros").toLowerCase()} con una columna por campo. Se muestra dentro de la página de la entidad.
      </PreviewCaption>
      <PreviewSurface>
        <RecordsTable entity={entity} rows={rows} />
        <TableFooter count={rows.length} />
      </PreviewSurface>
    </div>
  );
}

export function PagePreview({ entity, rows, moduleName, path }) {
  const title = entity?.pluralLabel ?? entity?.label ?? "Registros";
  return (
    <div className="space-y-3">
      <PreviewCaption icon={PanelsTopLeft} title="Página del menú">
        Pantalla completa que abre la entrada de navegación: encabezado, buscador, acción para crear y la tabla.
      </PreviewCaption>
      <PreviewSurface>
        <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-4 py-2 text-xs text-[hsl(var(--muted-foreground))]">
          <span className="truncate">{moduleName}</span>
          <ChevronRight className="h-3 w-3 shrink-0" />
          <span className="truncate font-medium text-[hsl(var(--foreground))]">{title}</span>
          {path && <span className="ml-auto hidden truncate font-mono sm:block">{path}</span>}
        </div>
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold leading-tight">{title}</h3>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">{rows.length} registros</p>
            </div>
            <Button size="sm" tabIndex={-1} aria-hidden="true" className="pointer-events-none bg-(--brand-primary) text-(--brand-primary-foreground)">
              <Plus className="h-4 w-4" />
              Nuevo {(entity?.label ?? "registro").toLowerCase()}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 text-sm text-[hsl(var(--muted-foreground))]">
              <Search className="h-4 w-4" />
              Buscar {title.toLowerCase()}...
            </div>
            <div className="flex h-10 items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 text-sm text-[hsl(var(--muted-foreground))]">
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">Filtros</span>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-[hsl(var(--border))]">
            <RecordsTable entity={entity} rows={rows} />
            <TableFooter count={rows.length} />
          </div>
        </div>
      </PreviewSurface>
    </div>
  );
}
