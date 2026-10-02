import { Button } from '@runly/ui'
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical,
  AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter,
  ArrowDownToLine, ArrowUpToLine, Copy, Library, Trash2,
} from 'lucide-react'
import { CANVAS_COLORS } from '../../lib/objectFactory.js'
import { Choice, ColorSwatches, Section } from './fields.jsx'

const OPACITY = [0.25, 0.5, 0.75, 1].map((value) => ({ value, label: `${value * 100}%` }))
const common = (rows, read) => { const values = new Set(rows.map(read)); return values.size === 1 ? [...values][0] : null }

const ALIGN_MODES = [
  { mode: 'left', label: 'Alinear a la izquierda', icon: AlignStartVertical },
  { mode: 'hcenter', label: 'Centrar horizontalmente', icon: AlignCenterVertical },
  { mode: 'right', label: 'Alinear a la derecha', icon: AlignEndVertical },
  { mode: 'top', label: 'Alinear arriba', icon: AlignStartHorizontal },
  { mode: 'vcenter', label: 'Centrar verticalmente', icon: AlignCenterHorizontal },
  { mode: 'bottom', label: 'Alinear abajo', icon: AlignEndHorizontal },
]

// Style edits applied to every selected element at once; values shown only
// when all elements share them.
export function MultiInspector({ rows, lockedCount, onPatch, onDelete, onDuplicate, onArrange, onAlign, onDistribute, onSaveToLibrary }) {
  const shapes = rows.filter((row) => !['image', 'text', 'hotspot'].includes(row.type))
  const closed = shapes.filter((row) => !['line', 'arrow'].includes(row.type))
  const alignable = rows.length - lockedCount
  const canDistribute = alignable >= 3
  return (
    <div className="space-y-5">
      <div className="px-0.5">
        <p className="text-sm font-semibold tabular-nums">{rows.length} elementos seleccionados</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Arrástralos juntos en el lienzo o edita su estilo aquí.{lockedCount ? ` ${lockedCount} en capas bloqueadas no se modificarán.` : ''}
        </p>
      </div>
      {shapes.length ? (
        <Section title="Apariencia">
          <ColorSwatches label="Borde / color" value={common(shapes, (row) => row.style?.stroke ?? '#3b82f6')} colors={CANVAS_COLORS} onChange={(stroke) => onPatch(shapes, { style: { stroke } })} />
          {closed.length ? (
            <ColorSwatches label="Relleno" value={common(closed, (row) => row.style?.fill ?? row.style?.stroke ?? '#3b82f6')} colors={CANVAS_COLORS} allowNone noneLabel="Sin relleno" onChange={(fill) => onPatch(closed, { style: { fill } })} />
          ) : null}
        </Section>
      ) : null}
      <Section title="Opacidad">
        <Choice label="Opacidad" value={common(rows, (row) => Number(row.style?.opacity ?? 1))} options={OPACITY} onChange={(opacity) => onPatch(rows, { style: { opacity } })} />
      </Section>
      <Section title="Alinear">
        <div className="grid grid-cols-6 gap-1.5">
          {ALIGN_MODES.map(({ mode, label, icon: Icon }) => (
            <Button key={mode} type="button" variant="outline" size="icon" aria-label={label} title={label} onClick={() => onAlign(mode)}>
              <Icon />
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button type="button" variant="outline" size="icon" className="w-full" aria-label="Distribuir horizontal" title="Distribuir horizontal" disabled={!canDistribute} onClick={() => onDistribute('h')}>
            <AlignHorizontalDistributeCenter />
          </Button>
          <Button type="button" variant="outline" size="icon" className="w-full" aria-label="Distribuir vertical" title="Distribuir vertical" disabled={!canDistribute} onClick={() => onDistribute('v')}>
            <AlignVerticalDistributeCenter />
          </Button>
        </div>
      </Section>
      <Section title="Organizar">
        <div className="grid grid-cols-3 gap-1.5">
          <Button type="button" variant="outline" size="sm" className="h-11 flex-col gap-0.5 px-1 text-[11px] sm:h-12" onClick={onDuplicate}><Copy />Duplicar</Button>
          <Button type="button" variant="outline" size="sm" className="h-11 flex-col gap-0.5 px-1 text-[11px] sm:h-12" onClick={() => onArrange('front')}><ArrowUpToLine />Al frente</Button>
          <Button type="button" variant="outline" size="sm" className="h-11 flex-col gap-0.5 px-1 text-[11px] sm:h-12" onClick={() => onArrange('back')}><ArrowDownToLine />Al fondo</Button>
        </div>
      </Section>
      <Button type="button" variant="outline" className="w-full" onClick={() => onSaveToLibrary(rows)}>
        <Library />Guardar en biblioteca
      </Button>
      <Button type="button" variant="outline" className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onDelete}>
        <Trash2 />Eliminar {rows.length} elementos
      </Button>
    </div>
  )
}
