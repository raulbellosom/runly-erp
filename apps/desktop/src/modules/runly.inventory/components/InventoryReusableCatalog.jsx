import { useState } from 'react'
import { Button, DataTable, Sheet, SheetContent, SheetHeader, SheetTitle, TextField, TextareaField, ErrorState } from '@runly/ui'
import { useInventoryModels, useInventoryTypes, useCreateInventoryType } from '../hooks/useInventoryReusableCatalogs.js'
import { InventoryModelDialog } from './InventoryModelDialog.jsx'

const MODEL_COLUMNS = [
  { accessorKey: 'name', header: 'Nombre' },
  { id: 'type', accessorFn: row => row.details?.typeLabel ?? row.details?.itemType ?? '', header: 'Tipo' },
  { accessorKey: 'details.brandName', header: 'Marca' },
  { id: 'year', accessorFn: row => row.details?.year ?? '', header: 'Año' },
  { accessorKey: 'details.description', header: 'Descripción' },
]
const TYPE_COLUMNS = [{ accessorKey: 'name', header: 'Nombre' }, { accessorKey: 'details.description', header: 'Descripción' }]

export function InventoryReusableCatalog({ kind }) {
  const isModels = kind === 'models'
  const models = useInventoryModels()
  const types = useInventoryTypes()
  const createType = useCreateInventoryType()
  const query = isModels ? models : types
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  async function saveType() {
    setError('')
    try { await createType.mutateAsync({ name, description }); setOpen(false); setName(''); setDescription('') }
    catch (err) { setError(err.message) }
  }
  const rows = query.data ?? []
  return <div className="space-y-3"><div className="flex justify-end"><Button onClick={() => setOpen(true)}>Nuevo {isModels ? 'modelo' : 'tipo'}</Button></div>
    <DataTable columns={isModels ? MODEL_COLUMNS : TYPE_COLUMNS} data={rows} isLoading={query.isPending} isError={query.isError} onRetry={() => query.refetch()} emptyTitle="Sin registros" />
    {isModels
      ? <InventoryModelDialog open={open} onOpenChange={setOpen} />
      : <Sheet open={open} onOpenChange={setOpen}><SheetContent><SheetHeader><SheetTitle>Nuevo tipo</SheetTitle></SheetHeader><TextField label="Nombre" value={name} onChange={event => setName(event.target.value)} maxLength={50} /><TextareaField label="Descripción" value={description} onChange={event => setDescription(event.target.value)} />{error && <ErrorState title="No se pudo guardar" description={error} />}<Button disabled={createType.isPending || !name.trim()} onClick={saveType}>{createType.isPending ? 'Guardando…' : 'Guardar'}</Button></SheetContent></Sheet>}
  </div>
}
