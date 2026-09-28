import { useEffect, useState } from 'react'
import { EmptyState, IconPickerField, LoadingState, SelectField, SortableList, TextField, TextareaField, resolveLucideIcon, cn } from '@runly/ui'
import { Package, Shapes } from 'lucide-react'
import { toast } from 'sonner'
import {
  useInventoryCategories, useCreateInventoryCategory, useUpdateInventoryCategory, useDeleteInventoryCategory, useReorderInventoryCategories,
} from '../../hooks/useInventoryCatalogs.js'
import { CatalogPanel } from './CatalogPanel.jsx'
import { CatalogListRow } from './CatalogListRow.jsx'
import { CatalogEditSheet } from './CatalogEditSheet.jsx'

const COLORS = ['#7c3aed', '#2563eb', '#0891b2', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#475569']
const NO_PARENT = '__none__'
const EMPTY = { name: '', description: '', icon: 'Package', color: COLORS[0], parentId: NO_PARENT }

export function TypesPanel({ onImport }) {
  const { data, isLoading } = useInventoryCategories()
  const rows = (data?.data ?? data ?? []).filter((row) => row.enabled !== false)
  const create = useCreateInventoryCategory()
  const update = useUpdateInventoryCategory()
  const remove = useDeleteInventoryCategory()
  const reorder = useReorderInventoryCategories()
  const [order, setOrder] = useState(null)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  useEffect(() => { setOrder(null) }, [data])

  const byId = new Map(rows.map((row) => [row.id, row]))
  const term = search.trim().toLowerCase()
  const items = order ?? rows
  const visible = term ? items.filter((row) => `${row.name} ${row.description ?? ''}`.toLowerCase().includes(term)) : items

  function open(row) {
    setEditing(row ?? {})
    setForm(row
      ? { name: row.name, description: row.description ?? '', icon: row.icon ?? 'Package', color: row.color ?? COLORS[0], parentId: row.parentId ?? NO_PARENT }
      : EMPTY)
  }

  async function save() {
    const payload = { ...form, name: form.name.trim(), parentId: form.parentId === NO_PARENT ? null : form.parentId }
    try {
      if (editing?.id) { await update.mutateAsync({ id: editing.id, ...payload }); toast.success('Tipo actualizado') }
      else { await create.mutateAsync(payload); toast.success('Tipo creado') }
      setEditing(null)
    } catch (err) { toast.error(err?.message ?? 'No se pudo guardar el tipo') }
  }

  function handleReorder(next) {
    setOrder(next)
    reorder.mutate(next.map((row, index) => ({ id: row.id, sortOrder: index * 10 })))
  }

  const renderRow = (row, drag = {}) => (
    <CatalogListRow
      icon={resolveLucideIcon(row.icon) ?? Package}
      color={row.color ?? COLORS[0]}
      title={row.name}
      subtitle={row.parentId && byId.has(row.parentId) ? `Subtipo de ${byId.get(row.parentId).name}` : (row.description || 'Sin descripción')}
      badges={[`${row.itemCount ?? 0} activos`, `${row.modelCount ?? 0} modelos`, `${row.customFieldCount ?? 0} campos`]}
      dragHandleProps={drag.dragHandleProps}
      isDragging={drag.isDragging}
      onEdit={() => open(row)}
      onDelete={() => remove.mutateAsync(row.id).then(() => toast.success('Tipo eliminado')).catch((err) => toast.error(err.message))}
    />
  )

  const parentOptions = [{ value: NO_PARENT, label: 'Ninguno (tipo principal)' },
    ...rows.filter((row) => !row.parentId && row.id !== editing?.id).map((row) => ({ value: row.id, label: row.name }))]

  return (
    <CatalogPanel catalogKey="types" createLabel="Nuevo tipo" onCreate={() => open(null)} onImport={onImport}>
      <TextField label="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar tipo..." />
      {isLoading ? <LoadingState /> : rows.length === 0 ? (
        <EmptyState icon={Shapes} title="Sin tipos" description="Crea tu primer tipo de activo o importa una lista." action={{ label: 'Nuevo tipo', onClick: () => open(null) }} />
      ) : term ? (
        <div className="space-y-1.5">{visible.map((row) => <div key={row.id}>{renderRow(row)}</div>)}</div>
      ) : (
        <div className="space-y-1.5">
          <SortableList items={visible} onReorder={handleReorder} renderItem={(row, drag) => renderRow(row, drag)} />
        </div>
      )}
      <CatalogEditSheet open={Boolean(editing)} onOpenChange={(value) => { if (!value) setEditing(null) }}
        title={editing?.id ? 'Editar tipo' : 'Nuevo tipo'} busy={create.isPending || update.isPending}
        saveDisabled={!form.name.trim()} onSave={save}>
        <TextField label="Nombre" required value={form.name} maxLength={100} placeholder="Laptop" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <IconPickerField label="Ícono" value={form.icon} onChange={(icon) => setForm((f) => ({ ...f, icon }))} />
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-[hsl(var(--foreground))]">Color</p>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((color) => (
              <button key={color} type="button" aria-label={`Color ${color}`} onClick={() => setForm((f) => ({ ...f, color }))}
                className={cn('h-8 w-8 rounded-full border-2 transition-transform', form.color === color ? 'scale-110 border-[hsl(var(--foreground))]' : 'border-transparent')}
                style={{ backgroundColor: color }} />
            ))}
          </div>
        </div>
        <SelectField label="Tipo padre" value={form.parentId} onValueChange={(parentId) => setForm((f) => ({ ...f, parentId }))} options={parentOptions} />
        <TextareaField label="Descripción" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      </CatalogEditSheet>
    </CatalogPanel>
  )
}
