import { ArrowLeft, FileSpreadsheet, ImageIcon } from 'lucide-react'
import { Alert, AlertDescription, Badge, SelectField, cn } from '@runly/ui'

export const NONE = '__none__'

// Step 2: one row per inventory field, grouped like the item form, each with a
// picker of the file's columns and a sample value from the file.
export function ImportMappingStep({ parsed, mapping, onMappingChange }) {
  const headerOptions = [{ value: NONE, label: 'No importar' }, ...parsed.headers.map((h) => ({ value: h, label: h }))]
  const usedHeaders = new Set(Object.values(mapping).filter(Boolean))
  const mappedCount = Object.values(mapping).filter(Boolean).length
  const sample = (header) => parsed.rows.find((row) => row[header])?.[header] ?? ''
  const embeddedPhotos = parsed.imageCounts.reduce((sum, n) => sum + n, 0)
  const groups = [...new Set(parsed.fields.map((f) => f.group))]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm text-[hsl(var(--foreground))]">
          <FileSpreadsheet className="h-4 w-4 shrink-0 text-(--brand-primary)" />
          <span className="truncate font-medium">{parsed.fileName}</span>
          <span className="shrink-0 text-[hsl(var(--muted-foreground))]">· {parsed.rows.length} filas</span>
        </p>
        <Badge variant="outline">{mappedCount} de {parsed.fields.length} campos relacionados</Badge>
      </div>

      {embeddedPhotos > 0 ? (
        <Alert>
          <ImageIcon className="h-4 w-4" />
          <AlertDescription>
            El archivo trae {embeddedPhotos} {embeddedPhotos === 1 ? 'foto' : 'fotos'} sobre sus filas; cada una se adjuntará al activo de su fila.
          </AlertDescription>
        </Alert>
      ) : null}
      {!mapping.name ? (
        <Alert>
          <AlertDescription>Sin columna de nombre, cada activo se nombra con su marca y modelo (p. ej. «Dell XPS 15»), o con su tipo.</AlertDescription>
        </Alert>
      ) : null}

      {groups.map((group) => (
        <section key={group} className="space-y-1.5">
          <h4 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{group}</h4>
          <div className="divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]">
            {parsed.fields.filter((f) => f.group === group).map((field) => {
              const current = mapping[field.key] ?? NONE
              const options = headerOptions.filter((o) => o.value === NONE || o.value === current || !usedHeaders.has(o.value))
              const example = current !== NONE ? sample(current) : ''
              return (
                <div key={field.key} className="grid items-center gap-2 px-4 py-2.5 sm:grid-cols-[1fr_auto_1.2fr] sm:gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[hsl(var(--foreground))]">{field.label}</p>
                    <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                      {example ? `Ej. ${example}` : field.hint ?? 'Sin columna'}
                    </p>
                  </div>
                  <ArrowLeft className={cn('hidden h-4 w-4 sm:block', current !== NONE ? 'text-(--brand-primary)' : 'text-[hsl(var(--muted-foreground))]/40')} />
                  <SelectField value={current} options={options}
                    onValueChange={(v) => onMappingChange({ ...mapping, [field.key]: v === NONE ? undefined : v })} />
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
