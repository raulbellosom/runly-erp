import { companyFetch } from '../../../lib/companyFetch.js'
import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Pencil, Trash2, ChevronRight } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { ConfirmDialog } from '@runly/ui'
import { toast } from 'sonner'
import MenuItemDialog from './MenuItemDialog.jsx'

function SortableItem({ item, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-3 py-2.5 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg group"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] touch-none"
      >
        <GripVertical size={14} />
      </button>
      <span className="flex-1 text-sm font-medium text-[hsl(var(--foreground))]">{item.label}</span>
      {item.url && (
        <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono truncate max-w-[120px]">
          {item.url}
        </span>
      )}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onEdit(item)}
          className="p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={() => onDelete(item)}
          className="p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--destructive))]"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

function ChildItem({ item, onEdit, onDelete }) {
  return (
    <div className="flex items-center gap-2 ml-6 px-3 py-2 bg-[hsl(var(--muted)/0.4)] border border-[hsl(var(--border))] rounded-lg group">
      <ChevronRight size={12} className="text-[hsl(var(--muted-foreground))]" />
      <span className="flex-1 text-sm text-[hsl(var(--foreground))]">{item.label}</span>
      {item.url && (
        <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono truncate max-w-[100px]">
          {item.url}
        </span>
      )}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onEdit(item)}
          className="p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={() => onDelete(item)}
          className="p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--destructive))]"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

export default function MenuItemTree({ menuId, items = [], onReorder, onRefresh }) {
  const { session } = useAuth()
  const token = session?.access_token

  const [editItem, setEditItem] = useState(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [confirmItem, setConfirmItem] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const rootItems = items.filter((i) => !i.parent_id)
  const childItems = items.filter((i) => i.parent_id)

  const reorderMutation = useMutation({
    mutationFn: async (reordered) => {
      const res = await companyFetch(`${getApiUrl()}/website/menus/${menuId}/items/reorder`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: reordered.map((item, idx) => ({ id: item.id, sortOrder: idx * 10 })),
        }),
      })
      if (!res.ok) throw new Error('Error al reordenar')
    },
    onError: () => toast.error('Error al guardar el orden'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (itemId) => {
      const res = await companyFetch(`${getApiUrl()}/website/menu-items/${itemId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Error al eliminar')
    },
    onSuccess: () => { toast.success('Elemento eliminado'); setConfirmItem(null); onRefresh() },
    onError: () => { toast.error('Error al eliminar elemento'); setConfirmItem(null) },
  })

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = rootItems.findIndex((i) => i.id === active.id)
    const newIndex  = rootItems.findIndex((i) => i.id === over.id)
    const reordered = arrayMove(rootItems, oldIndex, newIndex)
    onReorder(reordered)
    reorderMutation.mutate(reordered)
  }

  function handleEdit(item) {
    setEditItem(item)
    setDialogOpen(true)
  }

  function handleDelete(item) {
    setConfirmItem(item)
  }

  if (rootItems.length === 0 && childItems.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-8 text-center">
          <p className="text-[hsl(var(--muted-foreground))] text-sm">No hay elementos en este menu.</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="w-full rounded-lg border border-dashed border-[hsl(var(--border))] py-2 text-sm text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))] transition-colors"
        >
          + Agregar elemento
        </button>
        <MenuItemDialog
          menuId={menuId}
          item={null}
          open={addOpen}
          onOpenChange={setAddOpen}
          onSaved={onRefresh}
          rootItems={rootItems}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rootItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {rootItems.map((root) => (
              <div key={root.id} className="space-y-1">
                <SortableItem item={root} onEdit={handleEdit} onDelete={handleDelete} />
                {childItems
                  .filter((c) => c.parent_id === root.id)
                  .map((child) => (
                    <ChildItem key={child.id} item={child} onEdit={handleEdit} onDelete={handleDelete} />
                  ))}
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <button
        onClick={() => setAddOpen(true)}
        className="w-full rounded-lg border border-dashed border-[hsl(var(--border))] py-2 text-sm text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))] transition-colors"
      >
        + Agregar elemento
      </button>

      <MenuItemDialog
        menuId={menuId}
        item={null}
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={onRefresh}
        rootItems={rootItems}
      />

      <MenuItemDialog
        menuId={menuId}
        item={editItem}
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditItem(null) }}
        onSaved={onRefresh}
        rootItems={rootItems}
      />

      <ConfirmDialog
        open={Boolean(confirmItem)}
        onOpenChange={(open) => { if (!open) setConfirmItem(null) }}
        title="Eliminar elemento"
        description={`Se eliminara permanentemente el elemento "${confirmItem?.label}". Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(confirmItem?.id)}
      />
    </div>
  )
}
