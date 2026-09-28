import { useState } from 'react'
import { DataTable, TextField, TextareaField } from '@runly/ui'
import { Tag } from 'lucide-react'
import { toast } from 'sonner'
import { useInventoryBrands, useCreateInventoryBrand, useUpdateInventoryBrand, useDeleteInventoryBrand } from '../../hooks/useInventoryCatalogs.js'
import { CatalogPanel } from './CatalogPanel.jsx'
import { CatalogRowActions } from './CatalogRowActions.jsx'
import { CatalogEditSheet } from './CatalogEditSheet.jsx'

const EMPTY = { name: '', description: '', website: '' }

export function BrandsPanel({ onImport }) {
  const { data, isLoading, isError, refetch } = useInventoryBrands()
  const rows = (data?.data ?? data ?? []).filter((row) => row.enabled !== false)
  const create = useCreateInventoryBrand()
  const update = useUpdateInventoryBrand()
  const remove = useDeleteInventoryBrand()
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)

  function open(row) {
    setEditing(row ?? {})
    setForm(row ? { name: row.name, description: row.description ?? '', website: row.website ?? '' } : EMPTY)
  }
  async function save() {
    try {
      if (editing?.id) { await update.mutateAsync({ id: editing.id, ...form }); toast.success('Marca actualizada') }
      else { await create.mutateAsync(form); toast.success('Marca creada') }
      setEditing(null)
    } catch (err) { toast.error(err?.message ?? 'No se pudo guardar la marca') }
  }

  const columns = [
    { accessorKey: 'name', header: 'Marca', cell: ({ row }) => (
      <span className="flex items-center gap-2 font-medium"><Tag className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />{row.original.name}</span>
    ) },
    { accessorKey: 'website', header: 'Sitio web' },
    { accessorKey: 'modelCount', header: 'Modelos' },
    { accessorKey: 'itemCount', header: 'Activos' },
    { id: 'actions', header: '', enableSorting: false, cell: ({ row }) => (
      <CatalogRowActions name={row.original.name} onEdit={() => open(row.original)}
        onDelete={() => remove.mutateAsync(row.original.id).then(() => toast.success('Marca eliminada')).catch((err) => toast.error(err.message))} />
    ) },
  ]

  return (
    <CatalogPanel catalogKey="brands" createLabel="Nueva marca" onCreate={() => open(null)} onImport={onImport}>
      <DataTable columns={columns} data={rows} isLoading={isLoading} isError={isError} onRetry={refetch} getRowId={(row) => row.id}
        searchPlaceholder="Buscar marca..." emptyTitle="Sin marcas" emptyDescription="Crea una marca o importa una lista."
        emptyIcon={Tag} emptyAction={{ label: 'Nueva marca', onClick: () => open(null) }} />
      <CatalogEditSheet open={Boolean(editing)} onOpenChange={(value) => { if (!value) setEditing(null) }}
        title={editing?.id ? 'Editar marca' : 'Nueva marca'} busy={create.isPending || update.isPending}
        saveDisabled={!form.name.trim()} onSave={save}>
        <TextField label="Nombre" required value={form.name} maxLength={100} placeholder="Dell" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <TextField label="Sitio web" value={form.website} maxLength={255} placeholder="https://..." onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
        <TextareaField label="Descripción" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      </CatalogEditSheet>
    </CatalogPanel>
  )
}
