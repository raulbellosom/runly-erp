import { useState } from 'react'
import { Badge, Button, Checkbox, cn } from '@runly/ui'
import { Check, X, ClipboardList, Boxes, Tag, LayoutGrid, MapPin, Package, Layers, ListPlus } from 'lucide-react'
import { ITEM_STATUSES, ITEM_TYPES } from '../lib/inventory-constants.js'

const KIND_ICONS = { item: Boxes, brand: Tag, category: LayoutGrid, location: MapPin, model: Package, type: Layers, customField: ListPlus }
const KINDS = { item: 'Equipo', brand: 'Marca', category: 'Categoría', location: 'Ubicación', model: 'Modelo', type: 'Tipo', customField: 'Campo personalizado' }
const LABELS = { name: 'Nombre', description: 'Descripción', itemType: 'Tipo', model: 'Modelo', brandName: 'Marca', categoryName: 'Categoría', locationName: 'Ubicación', serialNumber: 'Serie', assetTag: 'Etiqueta', partNumber: 'Número de parte', status: 'Estado', purchaseDate: 'Fecha de compra', purchasePrice: 'Precio de compra', vendorName: 'Proveedor', invoiceNumber: 'Factura', warrantyExpiry: 'Fin de garantía', warrantyNotes: 'Garantía', notes: 'Notas', licenseKey: 'Clave de licencia', licenseExpiry: 'Vencimiento de licencia', licenseSeats: 'Puestos de licencia', fieldKey: 'Clave', fieldType: 'Tipo de campo', label: 'Etiqueta', options: 'Opciones', required: 'Obligatorio', customValues: 'Campos personalizados' }
const STATUS = { pending: 'Por confirmar', executed: 'Guardado', cancelled: 'Cancelado', superseded: 'Reemplazado' }
const FIELD_TYPES = { text: 'Texto', textarea: 'Texto largo', number: 'Número', date: 'Fecha', boolean: 'Sí/No', select: 'Lista de opciones', url: 'URL', email: 'Correo electrónico' }
function display(value, key) {
  if (key === 'status') return ITEM_STATUSES.find(option => option.value === value)?.label || value
  if (key === 'itemType') return ITEM_TYPES.find(option => option.value === value)?.label || value
  if (key === 'fieldType') return FIELD_TYPES[value] || value
  if (Array.isArray(value)) return value.map(entry => typeof entry === 'object' ? `${entry.fieldKey}: ${entry.value}` : entry).join('\n')
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return String(value)
}
const STATUS_BADGE = { pending: 'outline', executed: 'success', cancelled: 'secondary', superseded: 'secondary' }

export function InventoryActionProposal({ message, busy, onDecide }) {
  const [reviewed, setReviewed] = useState(false)
  const proposal = message.proposal
  return <section aria-label="Propuesta de creación" className="space-y-3 rounded-xl border bg-background p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong className="flex items-center gap-1.5 text-sm"><ClipboardList className="h-4 w-4 text-muted-foreground" />{proposal.actions.length} registro{proposal.actions.length === 1 ? '' : 's'}</strong>
      <Badge variant={STATUS_BADGE[proposal.status] ?? 'outline'}>{STATUS[proposal.status]}</Badge>
    </div>
    <div className="max-h-80 space-y-2 overflow-y-auto">{proposal.actions.map((action, index) => {
      const Icon = KIND_ICONS[action.kind] ?? Boxes
      return <div key={`${proposal.id}:${index}`} className="space-y-2 rounded-lg border bg-[hsl(var(--muted))]/30 p-2.5">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"><Icon className="h-3.5 w-3.5" /></span>
          {KINDS[action.kind]} · {action.data.name || action.data.label}
        </p>
        <dl className="space-y-1 pl-8 text-xs">{Object.entries(action.data).filter(([, value]) => value != null && value !== '').map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2"><dt className="text-muted-foreground">{LABELS[key] || key}</dt><dd className="whitespace-pre-wrap wrap-break-word">{display(value, key)}</dd></div>)}</dl>
      </div>
    })}</div>
    {proposal.status === 'pending' && <><p className="text-xs text-muted-foreground">Revisa los datos y las series. Los catálogos que ya existan se reutilizarán. Puedes pedir cambios en el chat antes de confirmar.</p><label className="flex items-start gap-2 text-xs"><Checkbox checked={reviewed} disabled={busy} onCheckedChange={value => setReviewed(Boolean(value))} />Revisé los datos e identificadores de esta propuesta</label><div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || !reviewed} onClick={() => onDecide(message, 'confirm')}><Check className="h-4 w-4" />Confirmar y crear</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(message, 'cancel')}><X className="h-4 w-4" />Cancelar propuesta</Button></div></>}
    {proposal.results?.length > 0 && <div className="space-y-1 border-t pt-2">{proposal.results.map(result => <p key={`${result.kind}:${result.id}`} className={cn('flex items-center gap-1.5 text-xs', result.reused ? 'text-muted-foreground' : 'text-emerald-700 dark:text-emerald-300')}><Check className="h-3.5 w-3.5 shrink-0" />{result.reused ? 'Reutilizado' : 'Guardado'}: {KINDS[result.kind]} · {result.name}</p>)}</div>}
  </section>
}
