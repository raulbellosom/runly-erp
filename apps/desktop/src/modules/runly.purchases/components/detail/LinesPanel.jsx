import { useMemo } from 'react'
import { PackagePlus, Rows3 } from 'lucide-react'
import { Button, DataTable } from '@runly/ui'
import { MoneyText } from '../MoneyText.jsx'
import { computeTotals } from '../../lib/document-math.js'
import { formatMoney, formatQty, toNumber } from '../../lib/format.js'

const right = (node) => <div className="text-right">{node}</div>

function ReceivedBar({ line }) {
  const qty = toNumber(line.quantity)
  const got = toNumber(line.receivedQuantity)
  const pct = qty ? Math.min(100, Math.round((got / qty) * 100)) : 0
  return (
    <div className="min-w-[6rem]">
      <span className="text-xs tabular-nums">{formatQty(got)} de {formatQty(qty)}</span>
      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
        <span className={`block h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-violet-500'}`} style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}

// Concepts of a saved document. Goods lines can spawn inventory items.
export function LinesPanel({ kind, doc, canCreateItems, onCreateItems }) {
  const lines = useMemo(() => doc.lines ?? [], [doc.lines])
  const totals = computeTotals(lines.map((l) => ({ ...l, taxRate: l.taxRate ?? 0 })))
  const priced = kind !== 'receipts'
  const showReceived = kind === 'orders' && lines.some((l) => l.receivedQuantity != null)

  const columns = useMemo(() => [
    {
      id: 'concept', header: 'Concepto',
      cell: ({ row: { original: l, index } }) => (
        <div className="flex min-w-[14rem] gap-3">
          <span className="w-5 shrink-0 pt-0.5 text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{index + 1}</span>
          <div className="min-w-0">
            <p className="font-medium">{l.description || (l.itemKind === 'SERVICE' ? 'Servicio sin concepto' : 'Sin concepto')}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{l.itemKind === 'SERVICE' ? 'Servicio' : 'Bien'}{l.unit ? `, por ${l.unit}` : ''}</p>
          </div>
        </div>
      ),
    },
    { id: 'qty', header: () => right('Cantidad'), cell: ({ row: { original: l } }) => right(<span className="tabular-nums">{formatQty(l.quantity)}</span>) },
    ...(showReceived ? [{ id: 'received', header: 'Recibido', cell: ({ row: { original: l } }) => <ReceivedBar line={l} /> }] : []),
    ...(priced ? [{ id: 'price', header: () => right('Precio'), cell: ({ row: { original: l } }) => right(<MoneyText value={l.unitAmount} currency={doc.currency} />) },
    { id: 'tax', header: () => right('Impuesto'), cell: ({ row: { original: l } }) => right(<span className="tabular-nums text-[hsl(var(--muted-foreground))]">{l.taxRate != null ? `${Math.round(toNumber(l.taxRate) * 100)}%` : formatMoney(l.taxAmount, doc.currency)}</span>) },
    { id: 'total', header: () => right('Importe'), cell: ({ row: { original: l } }) => right(<MoneyText value={l.total} currency={doc.currency} className="font-medium" />) }] : []),
    ...(canCreateItems ? [{
      id: 'inventory', header: '',
      cell: ({ row: { original: l } }) => (l.itemKind !== 'SERVICE' && l.id ? (
        <Button variant="ghost" size="sm" onClick={() => onCreateItems(l)} title="Dar de alta en Inventario"><PackagePlus className="h-4 w-4" />Crear activos</Button>
      ) : null),
    }] : []),
  ], [priced, showReceived, canCreateItems, doc.currency, onCreateItems])

  return (
    <div className="space-y-4">
      <DataTable columns={columns} data={lines} manualPagination showToolbar={false} showPagination={false} pageSize={Math.max(10, lines.length)}
        emptyIcon={Rows3} emptyTitle="Sin conceptos" emptyDescription="Este documento no tiene conceptos capturados." getRowId={(l, i) => l.id ?? String(i)} />
      {lines.length && priced ? (
        <dl className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-[hsl(var(--muted-foreground))]">Subtotal</dt><dd className="tabular-nums">{formatMoney(doc.subtotal ?? totals.subtotal, doc.currency)}</dd></div>
          <div className="flex justify-between"><dt className="text-[hsl(var(--muted-foreground))]">Impuestos</dt><dd className="tabular-nums">{formatMoney(doc.tax ?? totals.tax, doc.currency)}</dd></div>
          <div className="flex justify-between border-t border-dashed border-[hsl(var(--border))] pt-1.5 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(doc.total ?? doc.estimatedTotal ?? totals.total, doc.currency)}</dd></div>
        </dl>
      ) : null}
    </div>
  )
}
