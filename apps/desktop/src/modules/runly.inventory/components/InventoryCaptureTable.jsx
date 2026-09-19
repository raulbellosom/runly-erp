import { createContext, useContext } from 'react'
import { Button, Checkbox, DataTable, Input, EmptyState, useIsMobile } from '@runly/ui'
import { Trash2, Boxes } from 'lucide-react'
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

// A 5-column table has no room to breathe on a phone screen — every input
// shrinks until its own value is unreadable. Stack one full-width card per
// unit there instead of relying on horizontal scroll.
function MobileUnitCard({ unit, index }) {
  const { busy, values, photos, updateUnit, setUnits } = useContext(CaptureContext)
  return <div className="space-y-3 rounded-xl border p-3">
    <div className="flex items-center justify-between">
      <p className="text-sm font-medium">Equipo {index + 1}</p>
      <Button type="button" variant="ghost" size="icon" aria-label={`Quitar equipo ${index + 1}`} disabled={busy}
        onClick={() => setUnits(current => current.filter(u => u.id !== unit.id))}><Trash2 className="h-4 w-4" /></Button>
    </div>
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor={`capture-serial-${unit.id}`}>Serie</label>
      <Input id={`capture-serial-${unit.id}`} value={unit.serialNumber} disabled={busy}
        onChange={event => updateUnit(unit.id, { serialNumber: event.target.value })} />
    </div>
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor={`capture-tag-${unit.id}`}>Etiqueta interna</label>
      <Input id={`capture-tag-${unit.id}`} placeholder="Automática" value={unit.assetTag} disabled={busy}
        onChange={event => updateUnit(unit.id, { assetTag: event.target.value })} />
    </div>
    <label className="flex items-center gap-2 text-sm"><Checkbox disabled={busy}
      checked={unit.confirmation === confirmationKey(unit, values)}
      onCheckedChange={checked => setUnits(current => current.map(u => u.id === unit.id
        ? { ...u, confirmation: checked ? confirmationKey(u, values) : null } : u))} />Confirmo identificadores</label>
    {photos.length > 0 && <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">Fotos de este equipo</p>
      <div className="flex flex-wrap gap-3">{photos.map((photo, photoIndex) => <label key={photo.id} className="flex items-center gap-1.5 text-xs">
        <Checkbox disabled={busy} checked={unit.photoIds.includes(photo.id)}
          onCheckedChange={checked => updateUnit(unit.id, { photoIds: checked
            ? [...unit.photoIds, photo.id] : unit.photoIds.filter(id => id !== photo.id) })} />Foto {photoIndex + 1}</label>)}</div>
    </div>}
  </div>
}

export function InventoryCaptureTable({ units, ...context }) {
  const isMobile = useIsMobile()
  if (isMobile) return <CaptureContext.Provider value={context}>
    {units.length ? <div className="space-y-3">{units.map((unit, index) => <MobileUnitCard key={unit.id} unit={unit} index={index} />)}</div>
      : <EmptyState icon={Boxes} title="Agrega equipos a la captura" />}
  </CaptureContext.Provider>
  return <CaptureContext.Provider value={context}><div className="overflow-x-auto">
    <DataTable columns={COLUMNS} data={units} getRowId={getRowId} autoResetPageIndex={false}
      showToolbar={false} pageSize={20} emptyTitle="Agrega equipos a la captura" />
  </div></CaptureContext.Provider>
}
