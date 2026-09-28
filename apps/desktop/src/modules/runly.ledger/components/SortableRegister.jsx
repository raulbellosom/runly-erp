// apps/desktop/src/modules/runly.ledger/components/SortableRegister.jsx
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { GripVertical } from 'lucide-react'

// Drag-and-drop reordering for the transaction register (desktop grid and
// mobile cards). Dragging only starts from the DragHandle — it carries
// `touch-action: none`, so on touch devices the rest of the row still scrolls
// the page normally and only the handle grabs the row.
export function RegisterDndContext({ ids, onReorder, children }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    onReorder(String(active.id), String(over.id))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

export function useSortableRow(id, disabled) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id, disabled })
  const style = {
    // Vertical only: the register never reorders sideways.
    transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined,
    transition,
    position: isDragging ? 'relative' : undefined,
    zIndex: isDragging ? 20 : undefined,
  }
  const handleProps = { ref: setActivatorNodeRef, ...attributes, ...listeners }
  return { setNodeRef, style, handleProps, isDragging }
}

export function DragHandle({ handleProps, disabled, disabledReason, label }) {
  return (
    <button
      type="button"
      {...(disabled ? {} : handleProps)}
      disabled={disabled}
      aria-label={label}
      title={disabled ? disabledReason : 'Arrastra para reordenar'}
      className="flex h-8 w-7 items-center justify-center rounded text-[hsl(var(--muted-foreground))] touch-none cursor-grab active:cursor-grabbing hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <GripVertical size={14} />
    </button>
  )
}

// Given the current order and a drop, returns the new order plus the move
// payload the API expects: before the next row when dropped first, otherwise
// after the preceding row.
export function computeReorder(rows, activeId, overId) {
  const from = rows.findIndex((r) => r.id === activeId)
  const to = rows.findIndex((r) => r.id === overId)
  if (from < 0 || to < 0 || from === to) return null
  const next = rows.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  const move = to === 0 ? { before_id: next[1].id } : { after_id: next[to - 1].id }
  return { next, move }
}
