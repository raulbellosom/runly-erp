import { useState, useEffect } from 'react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, sortableKeyboardCoordinates, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
  Button, ConfirmDialog, Input,
} from '@runly/ui'
import { Trash2, Plus, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import {
  useStatuses, useCreateStatus, useUpdateStatus, useDeleteStatus, useReorderStatuses,
} from '../hooks/useProjectsData'

function StatusRow({ status, projectId, onDelete }) {
  const updateStatus = useUpdateStatus(projectId)
  const [name, setName] = useState(status.name)
  const [color, setColor] = useState(status.color)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: status.id })

  useEffect(() => { setName(status.name) }, [status.name])
  useEffect(() => { setColor(status.color) }, [status.color])

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  function saveField(field, value) {
    updateStatus.mutate(
      { statusId: status.id, [field]: value },
      { onError: () => toast.error('No se pudo guardar el cambio') },
    )
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-3 py-2 group bg-background">
      <button
        {...attributes}
        {...listeners}
        type="button"
        className="text-muted-foreground shrink-0 opacity-50 group-hover:opacity-100 cursor-grab active:cursor-grabbing touch-none"
        aria-label="Reordenar columna"
      >
        <GripVertical size={14} />
      </button>
      <div className="relative shrink-0">
        <div
          className="w-5 h-5 rounded-full border-2 border-transparent hover:border-foreground/30 transition-all"
          style={{ background: color }}
          title="Cambiar color"
        />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          onBlur={() => { if (color !== status.color) saveField('color', color) }}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
        />
      </div>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const t = name.trim()
          if (t && t !== status.name) saveField('name', t)
        }}
        className="flex-1 h-8 text-sm"
      />
      {status.isDone && (
        <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
          Completado
        </span>
      )}
      <button
        onClick={() => !status.isDefault && onDelete(status)}
        className={[
          'transition-colors opacity-0 group-hover:opacity-100',
          status.isDefault ? 'cursor-not-allowed text-muted-foreground/30' : 'text-muted-foreground hover:text-destructive',
        ].join(' ')}
        title={status.isDefault ? 'No se puede eliminar la columna por defecto' : 'Eliminar columna'}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

export default function StatusEditor({ open, onOpenChange, projectId }) {
  const { data: statusesData } = useStatuses(projectId)
  const statuses = statusesData?.data ?? statusesData ?? []
  const createStatus = useCreateStatus(projectId)
  const deleteStatus = useDeleteStatus(projectId)
  const reorderStatuses = useReorderStatuses(projectId)

  const [newName, setNewName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleAddStatus(e) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    createStatus.mutate(
      { name, color: '#64748b' },
      {
        onSuccess: () => { setNewName(''); toast.success('Columna creada') },
        onError: () => toast.error('No se pudo crear la columna'),
      },
    )
  }

  function handleDelete() {
    if (!deleteTarget) return
    deleteStatus.mutate(deleteTarget.id, {
      onSuccess: () => { toast.success('Columna eliminada'); setDeleteTarget(null) },
      onError: () => toast.error('No se pudo eliminar la columna'),
    })
  }

  const sorted = [...statuses].sort((a, b) => a.position - b.position)

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const oldIndex = sorted.findIndex((s) => s.id === active.id)
    const newIndex = sorted.findIndex((s) => s.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(sorted, oldIndex, newIndex)
    reorderStatuses.mutate(reordered.map((s) => s.id))
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-md flex flex-col gap-0 p-0">
          <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
            <SheetTitle>Gestionar columnas</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={sorted.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <div className="divide-y divide-border">
                  {sorted.map((status) => (
                    <StatusRow
                      key={status.id}
                      status={status}
                      projectId={projectId}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <form onSubmit={handleAddStatus} className="mt-4 flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nueva columna..."
                className="flex-1 h-8 text-sm"
              />
              <Button size="sm" type="submit" disabled={!newName.trim() || createStatus.isPending}>
                <Plus size={14} />
              </Button>
            </form>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null) }}
        title="Eliminar columna"
        description={`Las tareas en "${deleteTarget?.name ?? ''}" se moveran a la columna por defecto.`}
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
      />
    </>
  )
}
