import { useMemo, useRef, useState } from 'react'
import { ClipboardList, GitMerge } from 'lucide-react'
import { ComboboxField, SwitchField } from '@runly/ui'
import { usePropagationPreview, useSearchDocuments } from '../../hooks/usePurchases.js'
import { formatMoney } from '../../lib/format.js'

// Orders this invoice bills. When the orders already have inventory items,
// the API can copy those relations to the invoice (inheritItems, origin INHERITED).
export function LinkedOrdersField({ value = [], onChange, known = {}, inherit, onInheritChange, invoiceId, supplierId, disabled }) {
  const [search, setSearch] = useState('')
  const cache = useRef(new Map(Object.entries(known)))
  Object.entries(known).forEach(([id, doc]) => cache.current.set(id, doc))
  const query = useSearchDocuments({ type: 'order', search: search || undefined, supplierId: supplierId || undefined, page: 1 })
  const rows = useMemo(() => query.data?.data ?? [], [query.data?.data])
  rows.forEach((row) => cache.current.set(row.id, row))

  const options = useMemo(() => {
    const list = rows.map((row) => ({
      value: row.id,
      label: row.number,
      description: [row.supplierName, row.total != null ? formatMoney(row.total, row.currency) : null].filter(Boolean).join(', '),
      icon: ClipboardList,
    }))
    value.forEach((id) => {
      if (!list.some((o) => o.value === id)) list.push({ value: id, label: cache.current.get(id)?.number ?? cache.current.get(id)?.label ?? 'Orden', icon: ClipboardList })
    })
    return list
  }, [rows, value])

  const preview = usePropagationPreview({ orderIds: value.join(','), ...(invoiceId ? { invoiceId } : {}) }, value.length > 0 && !disabled)
  const inheritable = Array.isArray(preview.data) ? preview.data : preview.data?.items ?? preview.data?.data ?? []

  return (
    <div className="space-y-3">
      <ComboboxField
        label="Órdenes que cubre esta factura"
        multiple
        options={options}
        value={value}
        onChange={(next) => onChange(next ?? [])}
        onSearchChange={setSearch}
        filter={false}
        loading={query.isFetching && !rows.length}
        disabled={disabled}
        placeholder="Buscar orden por folio"
        searchPlaceholder="OC-000123"
        emptyText="Sin órdenes"
        hint={supplierId ? 'Se muestran las órdenes del proveedor elegido.' : 'Elige primero el proveedor para acotar la búsqueda.'}
      />
      {value.length && inheritable.length ? (
        <div className="flex items-start gap-3 rounded-xl border border-teal-600/25 bg-teal-500/[0.07] p-3">
          <GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300" />
          <div className="min-w-0 flex-1">
            <SwitchField id="inherit-items" label={`Heredar ${inheritable.length} ${inheritable.length === 1 ? 'activo' : 'activos'} de las órdenes`}
              description={inheritable.slice(0, 3).map((i) => i.label ?? i.name ?? i.other?.label).filter(Boolean).join(', ') + (inheritable.length > 3 ? ` y ${inheritable.length - 3} más` : '')}
              checked={inherit} onChange={onInheritChange} disabled={disabled} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
