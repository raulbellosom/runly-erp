import { useState } from 'react'
import { DataTable, TextField, TextareaField } from '@runly/ui'
import { MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { useInventoryLocations, useCreateInventoryLocation, useUpdateInventoryLocation, useDeleteInventoryLocation } from '../../hooks/useInventoryCatalogs.js'
import { CatalogPanel } from './CatalogPanel.jsx'
import { CatalogRowActions } from './CatalogRowActions.jsx'
import { CatalogCountLink, INVENTORY_PATH } from './CatalogCountLink.jsx'
import { CatalogEditSheet } from './CatalogEditSheet.jsx'

const EMPTY = { name: '', description: '', address: '' }

export function LocationsPanel({ onImport }) {
  const { data, isLoading, isError, refetch } = useInventoryLocations()
  const rows = (data?.data ?? data ?? []).filter((row) => row.enabled !== false)
  const create = useCreateInventoryLocation()
  const update = useUpdateInventoryLocation()
  const remove = useDeleteInventoryLocation()
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)

  function open(row) {
    setEditing(row ?? {})
    setForm(row ? { name: row.name, description: row.description ?? '', address: row.address ?? '' } : EMPTY)
  }
  async function save() {
    try {
      if (editing?.id) { await update.mutateAsync({ id: editing.id, ...form }); toast.success('Ubicación actualizada') }
      else { await create.mutateAsync(form); toast.success('Ubicación creada') }
      setEditing(null)
    } catch (err) { toast.error(err?.message ?? 'No se pudo guardar la ubicación') }
  }

  const columns = [
    { accessorKey: 'name', header: 'Ubicación', cell: ({ row }) => (
      <span className="flex items-center gap-2 font-medium"><MapPin className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />{row.original.name}</span>
    ) },
    { accessorKey: 'address', header: 'Dirección' },
    { accessorKey: 'itemCount', header: 'Activos', cell: ({ row }) => (
      <CatalogCountLink label={`${row.original.itemCount ?? 0} activos`} to={`${INVENTORY_PATH}?locationId=${row.original.id}`} />
    ) },
    { id: 'actions', header: '', enableSorting: false, cell: ({ row }) => (
      <CatalogRowActions name={row.original.name} onEdit={() => open(row.original)}
        onDelete={() => remove.mutateAsync(row.original.id).then(() => toast.success('Ubicación eliminada')).catch((err) => toast.error(err.message))} />
    ) },
  ]

  return (
    <CatalogPanel catalogKey="locations" createLabel="Nueva ubicación" onCreate={() => open(null)} onImport={onImport}>
      <DataTable columns={columns} data={rows} isLoading={isLoading} isError={isError} onRetry={refetch} getRowId={(row) => row.id}
        searchPlaceholder="Buscar ubicación..." emptyTitle="Sin ubicaciones" emptyDescription="Crea una ubicación o importa una lista."
        emptyIcon={MapPin} emptyAction={{ label: 'Nueva ubicación', onClick: () => open(null) }} />
      <CatalogEditSheet open={Boolean(editing)} onOpenChange={(value) => { if (!value) setEditing(null) }}
        title={editing?.id ? 'Editar ubicación' : 'Nueva ubicación'} busy={create.isPending || update.isPending}
        saveDisabled={!form.name.trim()} onSave={save}>
        <TextField label="Nombre" required value={form.name} maxLength={100} placeholder="Oficina central" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <TextField label="Dirección" value={form.address} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        <TextareaField label="Descripción" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      </CatalogEditSheet>
    </CatalogPanel>
  )
}
