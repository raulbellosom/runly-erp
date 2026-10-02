import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button, cn } from '@runly/ui'
import { ArrowUpRight, Circle, Diamond, Eye, EyeOff, GripVertical, Image, LocateFixed, Lock, LockOpen, Minus, MapPin, Square, Triangle, Type } from 'lucide-react'
import { objectLabel } from '../../lib/objectFactory.js'
import { shapeKindOf } from '../../lib/shapeConvert.js'

const TYPE_ICONS = {
  rectangle: Square, ellipse: Circle, triangle: Triangle, diamond: Diamond,
  line: Minus, arrow: ArrowUpRight, text: Type, image: Image, hotspot: MapPin,
}
function iconFor(object) { return TYPE_ICONS[shapeKindOf(object)] ?? Square }

// One row for an element inside an expanded layer: type icon, name, eye,
// lock, a focus ("Enfocar") button and the drag handle. Clicking the row
// selects the element (and, per BoardEditor's `select`, switches the active
// layer to its own). Hidden/locked elements are dimmed but keep their icon
// legible, per the spec's edge cases.
export function ElementItem({ object, selected, onSelect, onFocus, onToggleVisible, onToggleLocked, readOnly }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: object.id, disabled: readOnly })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  const Icon = iconFor(object)
  const hidden = Boolean(object.properties?.hidden), locked = Boolean(object.properties?.locked)

  return (
    <li ref={setNodeRef} style={style} className={cn('flex items-center gap-0.5 rounded-lg pl-7 pr-1 transition-colors', selected ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted)/0.6)]')}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          'flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-1.5 text-left text-sm lg:h-8',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
          selected ? 'font-medium text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]',
          (hidden || locked) && 'opacity-50',
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{objectLabel(object)}</span>
      </button>
      <Button type="button" variant="ghost" size="icon" aria-label="Enfocar" onClick={(event) => { event.stopPropagation(); onFocus() }} className="h-9 w-9 shrink-0 lg:h-7 lg:w-7">
        <LocateFixed className="h-3.5 w-3.5" />
      </Button>
      {readOnly ? (
        <span className="flex shrink-0 items-center gap-1 px-1 text-[hsl(var(--muted-foreground))]" aria-label={`${hidden ? 'Oculto' : ''}${hidden && locked ? ', ' : ''}${locked ? 'Bloqueado' : ''}`}>
          {hidden ? <EyeOff className="h-3.5 w-3.5" /> : null}
          {locked ? <Lock className="h-3.5 w-3.5" /> : null}
        </span>
      ) : (
        <>
          <Button type="button" variant="ghost" size="icon" aria-label={hidden ? 'Mostrar elemento' : 'Ocultar elemento'} onClick={(event) => { event.stopPropagation(); onToggleVisible() }} className="h-9 w-9 shrink-0 lg:h-7 lg:w-7">
            {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={locked ? 'Desbloquear elemento' : 'Bloquear elemento'} onClick={(event) => { event.stopPropagation(); onToggleLocked() }} className="h-9 w-9 shrink-0 lg:h-7 lg:w-7">
            {locked ? <Lock className="h-3.5 w-3.5 text-[hsl(var(--foreground))]" /> : <LockOpen className="h-3.5 w-3.5" />}
          </Button>
          <button
            type="button"
            aria-label={`Reordenar ${objectLabel(object)}`}
            {...attributes}
            {...listeners}
            className="flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-[hsl(var(--muted-foreground))] active:cursor-grabbing lg:h-7"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </li>
  )
}
