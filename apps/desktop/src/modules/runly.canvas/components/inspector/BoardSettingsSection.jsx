import { SwitchField } from '@runly/ui'
import { FieldLabel, NumberInput, Section } from './fields.jsx'

const GRID_MIN = 4, GRID_MAX = 200

// Grid and snapping for the whole Board; shown when nothing is selected.
export function BoardSettingsSection({ settings, onChange, readOnly = false }) {
  if (!settings) return null
  const grid = settings.grid
  return (
    <Section title="Ajustes del Board">
      <div className="space-y-3 px-0.5">
        <SwitchField
          id="canvas-grid-enabled" label="Mostrar cuadrícula" checked={grid.enabled} disabled={readOnly}
          onChange={(enabled) => onChange({ ...settings, grid: { ...grid, enabled } })}
        />
        <div>
          <FieldLabel>Tamaño de cuadrícula</FieldLabel>
          <NumberInput
            label="Tamaño de cuadrícula" short="#" suffix="px" value={grid.size} min={GRID_MIN} max={GRID_MAX}
            disabled={readOnly || !grid.enabled}
            onCommit={(size) => onChange({ ...settings, grid: { ...grid, size: Math.round(size) } })}
          />
        </div>
        <SwitchField
          id="canvas-grid-snapping" label="Ajustar a la cuadrícula"
          description="Mantén Alt al arrastrar para desactivarlo un momento."
          checked={settings.snapping} disabled={readOnly || !grid.enabled}
          onChange={(snapping) => onChange({ ...settings, snapping })}
        />
      </div>
    </Section>
  )
}
