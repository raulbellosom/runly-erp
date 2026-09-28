import { useEffect } from 'react'
import { Button, CheckboxField, Popover, PopoverContent, PopoverTrigger, TextareaField, cn } from '@runly/ui'
import { Pin, Rows3, Square } from 'lucide-react'
import { MAX_BULK_SERIALS, PIN_GROUPS, parseSerials, pinnedValues, saveCapture } from '../lib/capture.js'

// Capture toolbar for the new-asset form (RunlyForm renderTools slot):
// "Un equipo" / "Varios por serie", continuous capture and pinned fields.
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
  const togglePin = (key, on) => update({ pinned: on ? [...settings.pinned, key] : settings.pinned.filter((k) => k !== key) })
  const { serials, repeated } = parseSerials(serialsText)
  const overLimit = serials.length > MAX_BULK_SERIALS

  return (
    <section className="glass-shell-flat mb-4 space-y-4 rounded-2xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-[hsl(var(--border))] p-0.5">
          {[{ multi: false, label: 'Un equipo', icon: Square }, { multi: true, label: 'Varios por serie', icon: Rows3 }].map(({ multi, label, icon: Icon }) => (
            <Button key={label} type="button" size="sm" disabled={disabled} variant={settings.multi === multi ? 'default' : 'ghost'} onClick={() => update({ multi })}>
              <Icon className="mr-1.5 h-3.5 w-3.5" />{label}
            </Button>
          ))}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" variant="outline" disabled={disabled}>
              <Pin className={cn('mr-1.5 h-3.5 w-3.5', settings.pinned.length && 'text-[hsl(var(--primary))]')} />
              Campos fijados{settings.pinned.length ? ` (${settings.pinned.length})` : ''}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-2">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Los campos fijados conservan su valor al guardar y al recargar la página (en este navegador).</p>
            {PIN_GROUPS.map((group) => (
              <CheckboxField key={group.key} label={group.label} checked={settings.pinned.includes(group.key)}
                onChange={(e) => togglePin(group.key, e.target.checked)} />
            ))}
          </PopoverContent>
        </Popover>
        <CheckboxField label="Captura continua: al guardar, empezar otro" checked={settings.continuous} disabled={disabled}
          onChange={(e) => update({ continuous: e.target.checked })} />
      </div>
      {settings.multi ? (
        <div className="space-y-1.5">
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
            {serials.length} {serials.length === 1 ? 'serie' : 'series'}
            {repeated.length ? ` · ${repeated.length} repetida${repeated.length === 1 ? '' : 's'} (se omiten): ${repeated.slice(0, 5).join(', ')}${repeated.length > 5 ? '…' : ''}` : ''}
            {overLimit ? ` · máximo ${MAX_BULK_SERIALS} por captura` : ''}
          </p>
        </div>
      ) : null}
    </section>
  )
}
