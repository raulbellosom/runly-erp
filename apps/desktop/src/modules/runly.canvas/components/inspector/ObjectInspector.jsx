import { Badge, Button, Switch, Textarea } from '@runly/ui'
import { ArrowDownToLine, ArrowUpToLine, Copy, Lock, MapPin, Pencil, Trash2 } from 'lucide-react'
import { boxOf, canRotate, centerOf, isLinear } from '../../engine/geometry.js'
import { CANVAS_COLORS, objectLabel } from '../../lib/objectFactory.js'
import { measureTextHeight } from '../../engine/text.js'
import { Choice, ColorSwatches, NumberInput, Section } from './fields.jsx'

const STROKE_WIDTHS = [0, 1, 2, 4, 8].map((value) => ({ value, label: value === 0 ? '—' : String(value), ariaLabel: value === 0 ? 'Sin borde' : `${value} px` }))
const DASHES = [{ value: 'solid', label: '———', ariaLabel: 'Continua' }, { value: 'dashed', label: '– – –', ariaLabel: 'Discontinua' }, { value: 'dotted', label: '· · ·', ariaLabel: 'Punteada' }]
const FILL_OPACITY = [{ value: 0.12, label: 'Suave' }, { value: 0.5, label: 'Media' }, { value: 1, label: 'Sólido' }]
const OPACITY = [0.25, 0.5, 0.75, 1].map((value) => ({ value, label: `${value * 100}%` }))
const RADIUS = [0, 8, 16, 32].map((value) => ({ value, label: String(value), ariaLabel: `Radio ${value}` }))
const FONT_SIZES = [14, 18, 24, 36, 48].map((value) => ({ value, label: String(value), ariaLabel: `${value} px` }))

function GeometryFields({ object, onPatch }) {
  const b = boxOf(object), linear = isLinear(object), fixedSize = object.type === 'hotspot'
  // Width/height edits keep the visual center where it is, like design tools.
  const setSize = (key, value) => {
    if (linear) return onPatch({ geometry: { [key === 'width' ? 'x2' : 'y2']: value } })
    const next = { ...b, [key]: Math.max(4, value) }
    const center = centerOf(b)
    onPatch({ transform: { x: center.x - next.width / 2, y: center.y - next.height / 2 }, geometry: { width: next.width, height: next.height } })
  }
  const setRotation = (value) => onPatch({ transform: { rotation: ((Math.round(value) % 360) + 360) % 360 } })
  return (
    <Section title="Posición y tamaño">
      <div className="grid grid-cols-2 gap-2">
        <NumberInput label="X" value={b.x} onCommit={(x) => onPatch({ transform: { x } })} />
        <NumberInput label="Y" value={b.y} onCommit={(y) => onPatch({ transform: { y } })} />
        {!fixedSize ? (
          <>
            <NumberInput label={linear ? 'Desplazamiento X' : 'Ancho'} short={linear ? 'ΔX' : 'An'} value={b.width} onCommit={(value) => setSize('width', value)} />
            <NumberInput label={linear ? 'Desplazamiento Y' : 'Alto'} short={linear ? 'ΔY' : 'Al'} value={b.height} onCommit={(value) => setSize('height', value)} />
          </>
        ) : null}
        {canRotate(object) ? <NumberInput label="Rotación" short="R" value={b.rotation} suffix="°" onCommit={setRotation} /> : null}
      </div>
    </Section>
  )
}

function StyleFields({ object, onPatch }) {
  const style = object.style ?? {}, setStyle = (patch) => onPatch({ style: patch })
  if (object.type === 'image') {
    return <Section title="Apariencia"><Choice label="Opacidad" value={Number(style.opacity ?? 1)} options={OPACITY} onChange={(opacity) => setStyle({ opacity })} /></Section>
  }
  if (object.type === 'text') {
    const setText = (text) => {
      const width = boxOf(object).width
      onPatch({ properties: { text }, geometry: { height: measureTextHeight(text, style, width) } })
    }
    const setFont = (patch) => onPatch({ style: patch, geometry: { height: measureTextHeight(object.properties?.text || 'Texto', { ...style, ...patch }, boxOf(object).width) } })
    return (
      <Section title="Texto">
        <Textarea
          aria-label="Contenido del texto"
          defaultValue={object.properties?.text ?? ''}
          key={`${object.id}-${object.revision}`}
          rows={3}
          onBlur={(event) => { if (event.target.value !== (object.properties?.text ?? '')) setText(event.target.value) }}
          placeholder="Escribe el texto…"
        />
        <Choice label="Tamaño" value={Number(style.fontSize ?? 18)} options={FONT_SIZES} onChange={(fontSize) => setFont({ fontSize })} />
        <label className="flex items-center justify-between gap-2 py-1 text-sm">
          Negrita
          <Switch checked={style.fontWeight === 'bold'} onCheckedChange={(checked) => setFont({ fontWeight: checked ? 'bold' : 'normal' })} />
        </label>
        <ColorSwatches label="Color" value={style.textColor ?? '#0f172a'} colors={CANVAS_COLORS} onChange={(textColor) => setStyle({ textColor })} />
      </Section>
    )
  }
  const linear = isLinear(object), closed = !linear && object.type !== 'hotspot'
  return (
    <Section title="Apariencia">
      <ColorSwatches label={linear ? 'Color' : 'Borde'} value={style.stroke ?? '#3b82f6'} colors={CANVAS_COLORS} onChange={(stroke) => setStyle({ stroke })} />
      {closed ? (
        <>
          <ColorSwatches label="Relleno" value={style.fill ?? style.stroke ?? '#3b82f6'} colors={CANVAS_COLORS} allowNone noneLabel="Sin relleno" onChange={(fill) => setStyle({ fill })} />
          {style.fill !== 'none' ? <Choice label="Intensidad del relleno" value={Number(style.fillOpacity ?? (style.fill ? 1 : 0.12))} options={FILL_OPACITY} onChange={(fillOpacity) => setStyle({ fillOpacity })} /> : null}
        </>
      ) : null}
      {object.type !== 'hotspot' ? <Choice label="Grosor" value={Number(style.strokeWidth ?? 2)} options={linear ? STROKE_WIDTHS.slice(1) : STROKE_WIDTHS} onChange={(strokeWidth) => setStyle({ strokeWidth })} /> : null}
      {object.type !== 'hotspot' ? <Choice label="Trazo" value={style.dash ?? 'solid'} options={DASHES} onChange={(dash) => setStyle({ dash })} /> : null}
      {object.type === 'rectangle' ? <Choice label="Esquinas" value={Number(style.radius ?? 8)} options={RADIUS} onChange={(radius) => setStyle({ radius })} /> : null}
      <Choice label="Opacidad" value={Number(style.opacity ?? 1)} options={OPACITY} onChange={(opacity) => setStyle({ opacity })} />
    </Section>
  )
}

export function ObjectInspector({ object, layerName, locked, onPatch, onDelete, onDuplicate, onArrange, onOpenHotspot, onEditText, children }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{objectLabel(object)}</p>
          {layerName ? <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">Capa: {layerName}</p> : null}
        </div>
        {locked ? <Badge variant="outline" className="shrink-0 gap-1"><Lock className="h-3 w-3" />Bloqueada</Badge> : null}
      </div>

      {object.type === 'hotspot' ? (
        <Button type="button" className="w-full" onClick={onOpenHotspot}><MapPin />Información del hotspot</Button>
      ) : null}
      {object.type === 'text' && !locked ? (
        <Button type="button" variant="outline" className="w-full" onClick={onEditText}><Pencil />Editar texto</Button>
      ) : null}

      {locked ? (
        <p className="rounded-lg bg-[hsl(var(--muted)/0.6)] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">Desbloquea la capa para editar este elemento.</p>
      ) : (
        <>
          <GeometryFields object={object} onPatch={onPatch} />
          <StyleFields object={object} onPatch={onPatch} />
          <Section title="Organizar">
            <div className="grid grid-cols-3 gap-1.5">
              <Button type="button" variant="outline" size="sm" className="h-11 flex-col gap-0.5 px-1 text-[11px] sm:h-12" onClick={onDuplicate}><Copy />Duplicar</Button>
              <Button type="button" variant="outline" size="sm" className="h-11 flex-col gap-0.5 px-1 text-[11px] sm:h-12" onClick={() => onArrange('front')}><ArrowUpToLine />Al frente</Button>
              <Button type="button" variant="outline" size="sm" className="h-11 flex-col gap-0.5 px-1 text-[11px] sm:h-12" onClick={() => onArrange('back')}><ArrowDownToLine />Al fondo</Button>
            </div>
          </Section>
        </>
      )}

      {children}

      {!locked ? (
        <Button type="button" variant="outline" className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onDelete}>
          <Trash2 />Eliminar
        </Button>
      ) : null}
    </div>
  )
}

