import { formatArea, formatLength, objectMeasures } from '../../lib/measure.js'
import { Section } from './fields.jsx'

function Row({ label, value }) {
  return (
    <>
      <dt className="text-[hsl(var(--muted-foreground))]">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </>
  )
}

// Width/height (or length for lines), area and perimeter for closed shapes,
// in the page's calibrated unit or in px when there is no calibration.
export function MeasuresSection({ object, scale }) {
  if (object.type === 'hotspot' || object.type === 'text') return null
  const measures = objectMeasures(object)
  return (
    <Section title="Medidas">
      <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
        {measures.length !== undefined ? (
          <Row label="Longitud" value={formatLength(measures.length, scale)} />
        ) : (
          <>
            <Row label="Ancho" value={formatLength(measures.width, scale)} />
            <Row label="Alto" value={formatLength(measures.height, scale)} />
            {measures.area !== undefined ? <Row label="Área" value={formatArea(measures.area, scale)} /> : null}
            {measures.perimeter !== undefined ? <Row label="Perímetro" value={formatLength(measures.perimeter, scale)} /> : null}
          </>
        )}
      </dl>
      {!scale ? <p className="text-xs text-[hsl(var(--muted-foreground))]">Calibra la escala para medir en unidades reales.</p> : null}
    </Section>
  )
}
