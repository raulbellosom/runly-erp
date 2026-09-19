import { createContext, useContext } from 'react'
import { Button, Checkbox, DataTable, Input } from '@runly/ui'
import { Trash2 } from 'lucide-react'
import { confirmationKey } from '../lib/intake.js'

const CaptureContext = createContext(null)
const getRowId = unit => unit.id

function IdentifierCell({ row, column }) {
  const { busy, updateUnit } = useContext(CaptureContext)
  const field = column.id
  return <Input aria-label={`${field === 'serialNumber' ? 'Serie' : 'Etiqueta'} del equipo ${row.index + 1}`}
    placeholder={field === 'assetTag' ? 'Automática' : ''} value={row.original[field]} disabled={busy}
    onChange={event => updateUnit(row.original.id, { [field]: event.target.value })} />
}
function ConfirmationCell({ row }) {
  const { busy, values, setUnits } = useContext(CaptureContext)
  return <label className="flex items-center gap-2 text-sm"><Checkbox disabled={busy}
    checked={row.original.confirmation === confirmationKey(row.original, values)}
    onCheckedChange={checked => setUnits(current => current.map(unit => unit.id === row.original.id
      ? { ...unit, confirmation: checked ? confirmationKey(unit, values) : null } : unit))} />Confirmo identificadores</label>
}
function PhotosCell({ row }) {
  const { busy, photos, updateUnit } = useContext(CaptureContext)
  return <div className="flex flex-wrap gap-2">{photos.map((photo, index) => <label key={photo.id} className="flex items-center gap-1 text-xs">
    <Checkbox disabled={busy} checked={row.original.photoIds.includes(photo.id)}
      onCheckedChange={checked => updateUnit(row.original.id, { photoIds: checked
        ? [...row.original.photoIds, photo.id] : row.original.photoIds.filter(id => id !== photo.id) })} />{index + 1}</label>)}</div>
}
function RemoveCell({ row }) {
  const { busy, setUnits } = useContext(CaptureContext)
  return <Button type="button" variant="ghost" size="icon" aria-label="Quitar de la captura" disabled={busy}
    onClick={() => setUnits(current => current.filter(unit => unit.id !== row.original.id))}><Trash2 className="h-4 w-4" /></Button>
}
// Stable cell component identities keep an edited input mounted on each keystroke.
const COLUMNS = [
  { header: 'Serie', accessorKey: 'serialNumber', cell: IdentifierCell, enableSorting: false },
  { header: 'Etiqueta interna', accessorKey: 'assetTag', cell: IdentifierCell, enableSorting: false },
  { header: 'Revisión', id: 'confirmation', cell: ConfirmationCell },
  { header: 'Fotos', id: 'photos', cell: PhotosCell },
  { header: '', id: 'remove', cell: RemoveCell },
]
export function InventoryCaptureTable({ units, ...context }) {
  return <CaptureContext.Provider value={context}><div className="overflow-x-auto">
    <DataTable columns={COLUMNS} data={units} getRowId={getRowId} autoResetPageIndex={false}
      showToolbar={false} pageSize={20} emptyTitle="Agrega equipos a la captura" />
  </div></CaptureContext.Provider>
}
