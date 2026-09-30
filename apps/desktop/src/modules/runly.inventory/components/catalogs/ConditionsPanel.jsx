import { useState } from 'react'
import { DataTable, TextField, TextareaField, cn } from '@runly/ui'
import { Activity } from 'lucide-react'
import { toast } from 'sonner'
import { useInventoryConditions, useSaveInventoryCondition, useDeleteInventoryCondition } from '../../hooks/useInventoryAdmin.js'
import { CatalogPanel } from './CatalogPanel.jsx'
import { CatalogRowActions } from './CatalogRowActions.jsx'
import { CatalogCountLink, INVENTORY_PATH } from './CatalogCountLink.jsx'
import { CatalogEditSheet } from './CatalogEditSheet.jsx'

const COLORS = ['#16a34a', '#22c55e', '#0ea5e9', '#6366f1', '#8b5cf6', '#ca8a04', '#ea580c', '#dc2626', '#a3a3a3', '#78716c']
const EMPTY = { name: '', description: '', color: COLORS[0] }

// Physical condition catalog (Nuevo, En uso, Descompuesto...). Descriptive
// only: it has no rules, unlike the administrative status.
export function ConditionsPanel() {
  const { data, isLoading, isError, refetch } = useInventoryConditions()
  const rows = (data?.data ?? data ?? []).filter((row) => row.enabled !== false)
  const save = useSaveInventoryCondition()
  const remove = useDeleteInventoryCondition()
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)

  function open(row) {
    setEditing(row ?? {})
    setForm(row ? { name: row.name, description: row.description ?? '', color: row.color ?? COLORS[0] } : EMPTY)
  }
  async function submit() {
    try {
      await save.mutateAsync({ ...(editing?.id ? { id: editing.id } : {}), ...form, name: form.name.trim() })
      toast.success(editing?.id ? 'Condición actualizada' : 'Condición creada')
      setEditing(null)
    } catch (err) { toast.error(err?.message ?? 'No se pudo guardar la condición') }
  }

  const columns = [
    { accessorKey: 'name', header: 'Condición', cell: ({ row }) => (
      <span className="flex items-center gap-2 font-medium">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.original.color ?? '#94a3b8' }} />{row.original.name}
      </span>
    ) },
    { accessorKey: 'description', header: 'Descripción' },
    { accessorKey: 'itemCount', header: 'Activos', cell: ({ row }) => (
      <CatalogCountLink label={`${row.original.itemCount ?? 0} activos`} to={`${INVENTORY_PATH}?conditionId=${row.original.id}`} />
    ) },
    { id: 'actions', header: '', enableSorting: false, cell: ({ row }) => (
      <CatalogRowActions name={row.original.name} onEdit={() => open(row.original)}
        onDelete={() => remove.mutateAsync(row.original.id).then(() => toast.success('Condición eliminada')).catch((err) => toast.error(err.message))} />
    ) },
  ]

  return (
    <CatalogPanel catalogKey="conditions" createLabel="Nueva condición" onCreate={() => open(null)}>
      <DataTable columns={columns} data={rows} isLoading={isLoading} isError={isError} onRetry={refetch} getRowId={(row) => row.id}
        searchPlaceholder="Buscar condición..." emptyTitle="Sin condiciones" emptyDescription="Crea las condiciones físicas que usas para tus activos."
        emptyIcon={Activity} emptyAction={{ label: 'Nueva condición', onClick: () => open(null) }} />
      <CatalogEditSheet open={Boolean(editing)} onOpenChange={(value) => { if (!value) setEditing(null) }}
        title={editing?.id ? 'Editar condición' : 'Nueva condición'} busy={save.isPending}
        saveDisabled={!form.name.trim()} onSave={submit}>
        <TextField label="Nombre" required value={form.name} maxLength={100} placeholder="Semi nuevo" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
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
        <TextareaField label="Descripción" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      </CatalogEditSheet>
    </CatalogPanel>
  )
}
