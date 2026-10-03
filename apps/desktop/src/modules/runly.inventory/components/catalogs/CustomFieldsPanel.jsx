import { useEffect, useState } from 'react'
import { EmptyState, LoadingState, SelectField, SortableList, TextField, resolveLucideIcon } from '@runly/ui'
import { SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import {
  useInventoryCustomFields, useCreateInventoryCustomField, useUpdateInventoryCustomField, useDeleteInventoryCustomField, useReorderInventoryCustomFields,
} from '../../hooks/useInventoryCatalogs.js'
import { typeOptions, useTypeRows } from '../InventoryCatalogPickers.jsx'
import { CatalogPanel } from './CatalogPanel.jsx'
import { CatalogListRow } from './CatalogListRow.jsx'
import { CatalogPager, usePagedList } from './CatalogPager.jsx'
import { ActiveFilterChip, useCatalogUrlFilter } from './CatalogCountLink.jsx'
import { CatalogEditSheet } from './CatalogEditSheet.jsx'

const FIELD_TYPES = [
  { value: 'text', label: 'Texto' }, { value: 'textarea', label: 'Texto largo' }, { value: 'number', label: 'Número' },
  { value: 'date', label: 'Fecha' }, { value: 'boolean', label: 'Sí/No' }, { value: 'select', label: 'Lista de opciones' },
  { value: 'url', label: 'URL' }, { value: 'email', label: 'Email' },
]
const ALL_TYPES = '__all__'
// On-demand fields: never automatic, added per item from its form.
const ON_DEMAND = '__on_demand__'
const EMPTY = { label: '', fieldKey: '', fieldType: 'text', categoryId: ALL_TYPES, optionsText: '' }
const toOptionsText = (options) => (Array.isArray(options) ? options.map((o) => (typeof o === 'string' ? o : o?.label ?? o?.value)).join(', ') : '')

export function CustomFieldsPanel() {
  const { data, isLoading } = useInventoryCustomFields('all')
  const rows = (data?.data ?? data ?? []).filter((row) => row.enabled !== false)
  const types = useTypeRows()
  const typeById = new Map(types.map((type) => [type.id, type]))
  const create = useCreateInventoryCustomField()
  const update = useUpdateInventoryCustomField()
  const remove = useDeleteInventoryCustomField()
  const reorder = useReorderInventoryCustomFields()
  const [order, setOrder] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  useEffect(() => { setOrder(null) }, [data])
  const [typeFilter, clearTypeFilter] = useCatalogUrlFilter('typeId')
  const listed = typeFilter ? rows.filter((row) => row.categoryId === typeFilter) : (order ?? rows)
  const paged = usePagedList(listed)

  function open(row) {
    setEditing(row ?? {})
    setForm(row ? { label: row.label, fieldKey: row.fieldKey, fieldType: row.fieldType, categoryId: row.onDemand ? ON_DEMAND : (row.categoryId ?? ALL_TYPES), optionsText: toOptionsText(row.options) } : EMPTY)
  }
  async function save() {
    const { optionsText, ...rest } = form
    const options = optionsText.split(/[,\n]/).map((o) => o.trim()).filter(Boolean)
    const onDemand = form.categoryId === ON_DEMAND
    const payload = { ...rest, onDemand, categoryId: form.categoryId === ALL_TYPES || onDemand ? null : form.categoryId, ...(form.fieldType === 'select' ? { options } : {}) }
    try {
      if (editing?.id) { await update.mutateAsync({ id: editing.id, ...payload }); toast.success('Campo actualizado') }
      else { await create.mutateAsync(payload); toast.success('Campo creado') }
      setEditing(null)
    } catch (err) { toast.error(err?.message ?? 'No se pudo guardar el campo') }
  }
  function handleReorder(next) {
    setOrder(next)
    reorder.mutate(next.map((row, index) => ({ id: row.id, sortOrder: index * 10 })))
  }

  const fieldTypeLabel = (value) => FIELD_TYPES.find((t) => t.value === value)?.label ?? value

  return (
    <CatalogPanel catalogKey="custom-fields" createLabel="Nuevo campo" onCreate={() => open(null)}>
      {isLoading ? <LoadingState /> : rows.length === 0 ? (
        <EmptyState icon={SlidersHorizontal} title="Sin campos" description="Crea campos que se piden al registrar activos de un tipo." action={{ label: 'Nuevo campo', onClick: () => open(null) }} />
      ) : (
        <div className="space-y-1.5">
          {typeFilter ? <ActiveFilterChip label={`Tipo: ${typeById.get(typeFilter)?.name ?? '...'}`} onClear={clearTypeFilter} /> : null}
          <SortableList
            items={paged.pageItems}
            onReorder={(next) => { if (!typeFilter) handleReorder(paged.replacePage(next)) }}
            renderItem={(row, { dragHandleProps, isDragging }) => {
              const type = row.categoryId ? typeById.get(row.categoryId) : null
              return (
                <CatalogListRow
                  icon={(type && resolveLucideIcon(type.icon)) || SlidersHorizontal}
                  color={type?.color ?? '#475569'}
                  title={row.label}
                  subtitle={`${row.onDemand ? 'A demanda' : type ? type.name : 'Todos los tipos'} · ${row.fieldKey}`}
                  badges={[fieldTypeLabel(row.fieldType), ...(row.required ? ['Obligatorio'] : [])]}
                  dragHandleProps={dragHandleProps}
                  isDragging={isDragging}
                  onEdit={() => open(row)}
                  onDelete={() => remove.mutateAsync(row.id).then(() => toast.success('Campo eliminado')).catch((err) => toast.error(err.message))}
                />
              )
            }}
          />
          <CatalogPager {...paged} />
        </div>
      )}
      <CatalogEditSheet open={Boolean(editing)} onOpenChange={(value) => { if (!value) setEditing(null) }}
        title={editing?.id ? 'Editar campo' : 'Nuevo campo personalizado'} busy={create.isPending || update.isPending}
        saveDisabled={!form.label.trim() || !form.fieldKey.trim() || (form.fieldType === 'select' && !form.optionsText.trim())} onSave={save}>
        <TextField label="Nombre del campo" required value={form.label} placeholder="Memoria RAM" onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
        <TextField label="Clave" value={form.fieldKey} placeholder="memoria_ram" hint="Solo letras minúsculas, números y guiones bajos"
          disabled={Boolean(editing?.id)} onChange={(e) => setForm((f) => ({ ...f, fieldKey: e.target.value.toLowerCase().replace(/\s+/g, '_') }))} />
        <SelectField label="Tipo de campo" value={form.fieldType} onValueChange={(fieldType) => setForm((f) => ({ ...f, fieldType }))} options={FIELD_TYPES} />
        {form.fieldType === 'select' ? (
          <TextField label="Opciones" required value={form.optionsText} placeholder="8 GB, 16 GB, 32 GB" hint="Sepáralas con comas."
            onChange={(e) => setForm((f) => ({ ...f, optionsText: e.target.value }))} />
        ) : null}
        <SelectField label="Se pide en" value={form.categoryId} onValueChange={(categoryId) => setForm((f) => ({ ...f, categoryId }))}
          hint={form.categoryId === ON_DEMAND ? 'No se pide automáticamente: se agrega a un activo desde su formulario.' : undefined}
          options={[{ value: ON_DEMAND, label: 'Solo a demanda (por activo)' }, { value: ALL_TYPES, label: 'Todos los tipos' }, ...typeOptions(types)]} />
      </CatalogEditSheet>
    </CatalogPanel>
  )
}
