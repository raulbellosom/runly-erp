import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button, cn } from '@runly/ui'
import { ChevronRight, Eye, EyeOff, GripVertical, Lock, LockOpen } from 'lucide-react'
import { LAYER_KINDS, layerKind } from '../../lib/layerKinds.js'

// One row in the Layers tree: chevron (expand/collapse its elements), kind
// icon + label, name, element count, eye, lock and a drag handle. The handle
// is the only part wired to dnd-kit's listeners, so the rest of the row
// (and the panel) keeps scrolling normally on touch — see
// runly.projects/components/KanbanView.jsx for the same convention.
export function LayerItem({ layer, active, expanded, onToggleExpand, onSelect, onToggleVisible, onToggleLocked, count, readOnly }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: layer.id, disabled: readOnly })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  const kind = LAYER_KINDS[layerKind(layer)], Icon = kind.icon

  return (
    <li ref={setNodeRef} style={style} className={cn('group flex items-center gap-0.5 rounded-lg pr-1 transition-colors', active ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted)/0.6)]')}>
      <button
        type="button"
        aria-label={expanded ? `Contraer ${layer.name}` : `Expandir ${layer.name}`}
        aria-expanded={expanded}
        onClick={onToggleExpand}
        className="flex h-9 w-7 shrink-0 cursor-pointer items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
      >
        <ChevronRight className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')} />
      </button>
      <button
        type="button"
        aria-pressed={active}
        onClick={onSelect}
        className={cn(
          'flex h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 text-left text-sm lg:h-9',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
          active ? 'font-medium text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]',
          !layer.visible && 'opacity-50',
        )}
      >
        <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate">{layer.name}</span>
          <span className="truncate text-[11px] font-normal text-[hsl(var(--muted-foreground))]">{kind.label}</span>
        </span>
        {count ? <span className="ml-auto text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{count}</span> : null}
      </button>
      {readOnly ? (
        <span className="flex shrink-0 items-center gap-1 px-1.5 text-[hsl(var(--muted-foreground))]" aria-label={`${layer.visible ? 'Visible' : 'Oculta'}${layer.locked ? ', bloqueada' : ''}`}>
          {layer.visible ? null : <EyeOff className="h-4 w-4" />}
          {layer.locked ? <Lock className="h-4 w-4" /> : null}
        </span>
      ) : (
        <>
          <Button type="button" variant="ghost" size="icon" aria-label={layer.visible ? `Ocultar ${layer.name}` : `Mostrar ${layer.name}`} onClick={(event) => { event.stopPropagation(); onToggleVisible() }} className="h-9 w-9 shrink-0 lg:h-7 lg:w-7">
            {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={layer.locked ? `Desbloquear ${layer.name}` : `Bloquear ${layer.name}`} onClick={(event) => { event.stopPropagation(); onToggleLocked() }} className="h-9 w-9 shrink-0 lg:h-7 lg:w-7">
            {layer.locked ? <Lock className="h-4 w-4 text-[hsl(var(--foreground))]" /> : <LockOpen className="h-4 w-4" />}
          </Button>
          <button
            type="button"
            aria-label={`Reordenar ${layer.name}`}
            {...attributes}
            {...listeners}
            className="flex h-9 w-7 shrink-0 cursor-grab touch-none items-center justify-center text-[hsl(var(--muted-foreground))] active:cursor-grabbing lg:h-7"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </>
      )}
    </li>
  )
}
