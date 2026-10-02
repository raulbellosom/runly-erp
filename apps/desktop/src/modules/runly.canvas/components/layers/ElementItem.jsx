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

export function ElementItem({ object, selected, onSelect, onFocus, onToggleVisible, onToggleLocked, dragDisabled, readOnly }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: object.id, disabled: dragDisabled })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  const Icon = iconFor(object)
  const hidden = Boolean(object.properties?.hidden), locked = Boolean(object.properties?.locked)
  const label = objectLabel(object)

  return (
    <li ref={setNodeRef} style={style} className={cn('group/element relative flex min-h-11 items-center rounded-lg transition-colors [@media(hover:hover)]:min-h-9', selected ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted)/0.6)]')}>
      {!readOnly ? (
        <button
          type="button"
          aria-label={`Reordenar ${label}`}
          disabled={dragDisabled}
          {...attributes}
          {...listeners}
          className={cn(
            'flex h-11 w-7 shrink-0 touch-none items-center justify-center text-[hsl(var(--muted-foreground))] transition-opacity [@media(hover:hover)]:h-9',
            dragDisabled ? 'cursor-not-allowed opacity-30' : 'cursor-grab active:cursor-grabbing [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/element:opacity-100 [@media(hover:hover)]:group-focus-within/element:opacity-100',
          )}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      ) : <span className="w-2 shrink-0" />}
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch rounded-lg px-1.5 text-left text-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
          selected ? 'font-medium text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]',
          (hidden || locked) && 'opacity-50',
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
        {hidden ? <EyeOff className="h-3.5 w-3.5 shrink-0" aria-label="Oculto" /> : null}
        {locked ? <Lock className="h-3.5 w-3.5 shrink-0" aria-label="Bloqueado" /> : null}
      </button>
      {!readOnly ? (
        <div className={cn(
          'absolute inset-y-0 right-1 flex items-center rounded-lg bg-[hsl(var(--muted))] pl-1 transition-opacity',
          selected ? 'opacity-100' : 'opacity-100 [@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/element:pointer-events-auto [@media(hover:hover)]:group-hover/element:opacity-100 [@media(hover:hover)]:group-focus-within/element:pointer-events-auto [@media(hover:hover)]:group-focus-within/element:opacity-100',
        )}>
          <Button type="button" variant="ghost" size="icon" aria-label="Enfocar" onClick={(event) => { event.stopPropagation(); onFocus() }} className="h-11 w-11 shrink-0 [@media(hover:hover)]:h-7 [@media(hover:hover)]:w-7">
            <LocateFixed className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={hidden ? 'Mostrar elemento' : 'Ocultar elemento'} onClick={(event) => { event.stopPropagation(); onToggleVisible() }} className="h-11 w-11 shrink-0 [@media(hover:hover)]:h-7 [@media(hover:hover)]:w-7">
            {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={locked ? 'Desbloquear elemento' : 'Bloquear elemento'} onClick={(event) => { event.stopPropagation(); onToggleLocked() }} className="h-11 w-11 shrink-0 [@media(hover:hover)]:h-7 [@media(hover:hover)]:w-7">
            {locked ? <Lock className="h-3.5 w-3.5 text-[hsl(var(--foreground))]" /> : <LockOpen className="h-3.5 w-3.5" />}
          </Button>
        </div>
      ) : null}
    </li>
  )
}
