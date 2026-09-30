import { Check } from 'lucide-react'
import { cn } from '@runly/ui'
import { PRESETS } from '../../lib/purchases-constants.js'
import { PurchaseFlowRibbon } from '../PurchaseFlowRibbon.jsx'

// Each template shows its own track, so the choice is visual, not a label.
export function PresetCards({ presets = {}, value, customStages, onChange, disabled }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {PRESETS.map((preset) => {
        const active = value === preset.key
        const stages = (preset.key === 'CUSTOM' ? customStages : presets[preset.key]?.stages ?? []).filter((s) => s.mode !== 'DISABLED')
        return (
          <button key={preset.key} type="button" disabled={disabled} onClick={() => onChange(preset.key)} aria-pressed={active}
            className={cn('flex min-w-0 flex-col rounded-2xl border bg-[hsl(var(--card))] p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:cursor-not-allowed',
              active ? 'border-teal-600 ring-2 ring-teal-600/15' : 'border-[hsl(var(--border))] hover:border-teal-600/40')}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{preset.name}</p>
                <p className="mt-0.5 text-sm text-[hsl(var(--muted-foreground))]">{preset.description}</p>
              </div>
              <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', active ? 'border-teal-600 bg-teal-600 text-white' : 'border-[hsl(var(--border))]')}>
                {active ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
              </span>
            </div>
            <div className="pointer-events-none mt-4 origin-left scale-[0.85]">
              <PurchaseFlowRibbon stages={stages.map((s) => ({ ...s, state: active ? 'done' : undefined, mode: undefined }))} />
            </div>
          </button>
        )
      })}
    </div>
  )
}
