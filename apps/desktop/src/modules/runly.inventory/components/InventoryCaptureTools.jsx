import { useEffect } from 'react'
import { Button, SwitchField, TextareaField, cn } from '@runly/ui'
import { Pin, Rows3, Square } from 'lucide-react'
import { MAX_BULK_SERIALS, parseSerials, pinnedValues, saveCapture } from '../lib/capture.js'

const MODES = [
  { multi: false, label: 'Un equipo', icon: Square },
  { multi: true, label: 'Varios por serie', icon: Rows3 },
]

// Capture bar for the new-asset form (RunlyForm renderTools slot). Pins live on
// each field (RunlyForm fieldPins); "Fijar campos" only shows/hides them.
// Pinned values are written to this browser on every change.
export function InventoryCaptureTools({ values, patchValues, disabled, settings, setSettings, storageKey, serialsText, setSerialsText }) {
  useEffect(() => {
    saveCapture(storageKey, { ...settings, values: pinnedValues(values, settings.pinned) })
  }, [storageKey, settings, values])

  // Hides serial/tag fields (blueprint hiddenWhen __multi) in bulk mode.
  useEffect(() => {
    if (Boolean(values.__multi) !== settings.multi) patchValues({ __multi: settings.multi })
  }, [settings.multi, values.__multi, patchValues])

  const update = (patch) => setSettings((prev) => ({ ...prev, ...patch }))
  const { serials, repeated } = parseSerials(serialsText)
  const overLimit = serials.length > MAX_BULK_SERIALS
  const pinnedCount = settings.pinned.length

  return (
    <section className="glass-shell-flat mb-4 overflow-hidden rounded-2xl">
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div role="radiogroup" aria-label="Modo de captura" className="inline-flex w-full rounded-xl bg-[hsl(var(--muted))]/60 p-1 sm:w-auto">
          {MODES.map(({ multi, label, icon: Icon }) => {
            const active = settings.multi === multi
            return (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => update({ multi })}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all sm:flex-none',
                  active
                    ? 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-sm'
                    : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
                )}
              >
                <Icon className="h-4 w-4" />{label}
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant={settings.pinMode ? 'default' : 'outline'}
            disabled={disabled}
            aria-pressed={settings.pinMode}
            onClick={() => update({ pinMode: !settings.pinMode })}
          >
            <Pin className={cn('mr-1.5 h-3.5 w-3.5', pinnedCount > 0 && 'fill-current')} />
            {settings.pinMode ? 'Listo' : 'Fijar campos'}
            {pinnedCount > 0 ? (
              <span className="ml-1.5 rounded-full bg-[hsl(var(--primary))]/15 px-1.5 text-xs tabular-nums">{pinnedCount}</span>
            ) : null}
          </Button>
          <SwitchField label="Captura continua" checked={settings.continuous} disabled={disabled}
            onChange={(continuous) => update({ continuous: Boolean(continuous) })} />
        </div>
      </div>

      {settings.pinMode ? (
        <p className="border-t border-[hsl(var(--border))] bg-[hsl(var(--primary))]/5 px-4 py-2 text-xs text-[hsl(var(--muted-foreground))]">
          Toca el pin de cada campo para fijarlo. Los campos fijados conservan su valor al guardar y al recargar la página en este navegador.
        </p>
      ) : null}

      {settings.multi ? (
        <div className="space-y-1.5 border-t border-[hsl(var(--border))] p-4">
          <TextareaField
            label="Números de serie"
            rows={4}
            value={serialsText}
            disabled={disabled}
            placeholder="ABC123, ABC124, ABC125 o uno por línea"
            hint="Sepáralos con coma, espacio, punto y coma o salto de línea. Se crea un activo por serie con los datos de abajo, nombrado «Nombre · serie»."
            onChange={(e) => setSerialsText(e.target.value)}
          />
          <p className={cn('text-sm', overLimit ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--muted-foreground))]')}>
            <span className="font-medium tabular-nums text-[hsl(var(--foreground))]">{serials.length}</span> {serials.length === 1 ? 'serie' : 'series'}
            {repeated.length ? ` · ${repeated.length} repetida${repeated.length === 1 ? '' : 's'} (se omiten): ${repeated.slice(0, 5).join(', ')}${repeated.length > 5 ? '…' : ''}` : ''}
            {overLimit ? ` · máximo ${MAX_BULK_SERIALS} por captura` : ''}
          </p>
        </div>
      ) : null}
    </section>
  )
}
