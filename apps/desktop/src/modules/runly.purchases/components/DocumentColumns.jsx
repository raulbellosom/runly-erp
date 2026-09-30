import { cn } from '@runly/ui'
import { PurchaseStatusBadge } from './PurchaseStatusBadge.jsx'
import { MoneyText } from './MoneyText.jsx'
import { PRIORITY_OPTIONS } from '../lib/purchases-constants.js'
import { daysUntil, formatDate, toNumber } from '../lib/format.js'

const PRIORITY_TONE = { LOW: 'text-slate-500', NORMAL: 'text-[hsl(var(--foreground))]', HIGH: 'text-amber-600 dark:text-amber-400', URGENT: 'text-rose-600 dark:text-rose-400 font-semibold' }
const OPEN_INVOICE = new Set(['PENDING', 'PARTIALLY_PAID', 'PENDING_APPROVAL'])

function Folio({ number, sub, onOpen }) {
  return (
    <button type="button" onClick={onOpen} className="group block max-w-[18rem] text-left focus-visible:outline-none">
      <span className="block truncate font-semibold tabular-nums text-[hsl(var(--foreground))] group-hover:text-teal-700 group-hover:underline group-focus-visible:underline dark:group-hover:text-teal-300">{number || 'Sin folio'}</span>
      <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">{sub}</span>
    </button>
  )
}

function DueDate({ value, status }) {
  if (!value) return <span className="text-[hsl(var(--muted-foreground))]">Sin vencimiento</span>
  const days = daysUntil(value)
  const open = OPEN_INVOICE.has(status)
  return (
    <span className="block">
      <span className="block tabular-nums">{formatDate(value)}</span>
      {open && days != null ? (
        <span className={cn('block text-xs', days < 0 ? 'text-rose-600 dark:text-rose-400' : days <= 7 ? 'text-amber-600 dark:text-amber-400' : 'text-[hsl(var(--muted-foreground))]')}>
          {days < 0 ? `Vencida hace ${-days} d` : days === 0 ? 'Vence hoy' : `En ${days} d`}
        </span>
      ) : null}
    </span>
  )
}

const right = (node) => <div className="text-right">{node}</div>

// Column builders keyed by name (see lib/list-config.js).
export function buildColumns(names, { kind, open }) {
  const defs = {
    folio: { id: 'folio', header: 'Folio', cell: ({ row: { original: r } }) => <Folio number={r.number} sub={r.supplierName || 'Sin proveedor'} onOpen={() => open(r.id)} /> },
    request: { id: 'request', header: 'Solicitud', cell: ({ row: { original: r } }) => <Folio number={r.number} sub={r.title} onOpen={() => open(r.id)} /> },
    caseTitle: { id: 'caseTitle', header: 'Expediente', cell: ({ row: { original: r } }) => <Folio number={r.number} sub={[r.title, r.supplierName].filter(Boolean).join(', ')} onOpen={() => open(r.id)} /> },
    order: { id: 'order', header: 'Orden', cell: ({ row: { original: r } }) => <span className="tabular-nums">{r.orderNumber ?? r.order?.number ?? 'Sin orden'}</span> },
    issueDate: { accessorKey: 'issueDate', header: 'Fecha', cell: ({ getValue }) => <span className="tabular-nums">{formatDate(getValue())}</span> },
    createdAt: { accessorKey: 'createdAt', header: 'Abierto', cell: ({ getValue }) => <span className="tabular-nums">{formatDate(getValue())}</span> },
    receivedAt: { accessorKey: 'receivedAt', header: 'Recibida', cell: ({ getValue }) => <span className="tabular-nums">{formatDate(getValue())}</span> },
    expectedDate: { accessorKey: 'expectedDate', header: 'Entrega', cell: ({ getValue }) => <span className="tabular-nums">{getValue() ? formatDate(getValue()) : 'Sin fecha'}</span> },
    neededBy: { accessorKey: 'neededBy', header: 'Se necesita', cell: ({ getValue }) => <DueDate value={getValue()} status="PENDING" /> },
    dueDate: { accessorKey: 'dueDate', header: 'Vence', cell: ({ row: { original: r } }) => <DueDate value={r.dueDate} status={r.status} /> },
    priority: {
      accessorKey: 'priority', header: 'Prioridad',
      cell: ({ getValue }) => <span className={PRIORITY_TONE[getValue()] ?? ''}>{PRIORITY_OPTIONS.find((p) => p.value === getValue())?.label ?? 'Normal'}</span>,
    },
    status: { accessorKey: 'status', header: 'Estado', cell: ({ getValue }) => <PurchaseStatusBadge kind={kind} status={getValue()} /> },
    total: { accessorKey: 'total', header: () => right('Total'), cell: ({ row: { original: r } }) => right(<MoneyText value={r.total} currency={r.currency} className="font-medium" />) },
    estimatedTotal: { accessorKey: 'estimatedTotal', header: () => right('Estimado'), cell: ({ row: { original: r } }) => right(<MoneyText value={r.estimatedTotal} currency={r.currency} />) },
    paid: { accessorKey: 'paidAmount', header: () => right('Pagado'), cell: ({ row: { original: r } }) => right(<MoneyText value={r.paidAmount} currency={r.currency} tone="emerald" />) },
    balance: {
      id: 'balance', header: () => right('Saldo'),
      cell: ({ row: { original: r } }) => {
        const balance = r.status === 'CANCELLED' ? 0 : Math.max(0, toNumber(r.total) - toNumber(r.paidAmount))
        return right(<MoneyText value={balance} currency={r.currency} tone={balance > 0 ? 'amber' : undefined} className="font-medium" />)
      },
    },
  }
  return names.map((name) => defs[name]).filter(Boolean)
}
