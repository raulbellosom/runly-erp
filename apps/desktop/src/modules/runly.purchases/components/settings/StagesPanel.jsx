import { SegmentedControl, SwitchField } from '@runly/ui'
import { CAPABILITIES, MODE_OPTIONS, STAGE_ORDER, stageMeta } from '../../lib/purchases-constants.js'
import { stageEnabled } from '../../lib/settings-form.js'

// What is used (capability switches) and how strict each stage is (mode).
export function StagesPanel({ capabilities, modes, onCapability, onMode, disabled }) {
  const stages = STAGE_ORDER.filter((type) => stageEnabled(type, capabilities))
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/70 p-4 shadow-sm md:p-5">
        <h2 className="text-base font-semibold">Qué usa tu empresa</h2>
        <p className="mb-4 text-sm text-[hsl(var(--muted-foreground))]">Lo que apagues desaparece del menú, de los documentos y de Inventario.</p>
        <div className="divide-y divide-[hsl(var(--border))]">
          {CAPABILITIES.map((cap) => (
            <div key={cap.key} className="py-3 first:pt-0 last:pb-0">
              <SwitchField id={`cap-${cap.key}`} label={cap.label} description={cap.description} checked={Boolean(capabilities[cap.key])}
                onChange={(v) => onCapability(cap.key, v)} disabled={disabled} />
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/70 p-4 shadow-sm md:p-5">
        <h2 className="text-base font-semibold">Cuándo es obligatoria cada etapa</h2>
        <p className="mb-4 text-sm text-[hsl(var(--muted-foreground))]">Condicional significa que la exige una regla de la política (por ejemplo, un monto).</p>
        <ul className="space-y-3">
          {stages.map((type) => {
            const Icon = stageMeta(type).icon
            return (
              <li key={type} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4 text-teal-700 dark:text-teal-300" />{stageMeta(type).label}</span>
                <SegmentedControl ariaLabel={`Modo de ${stageMeta(type).label}`} disabled={disabled || type === 'CLOSE'} className="w-full sm:w-auto"
                  options={type === 'CLOSE' ? MODE_OPTIONS.slice(0, 1) : MODE_OPTIONS}
                  value={modes[type] ?? (type === 'CLOSE' ? 'REQUIRED' : type === 'RELATE' ? 'DISABLED' : 'OPTIONAL')} onChange={(v) => onMode(type, v)} />
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
