import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { Skeleton, cn } from '@runly/ui'
import { BadgeCheck, ClipboardList, PackageCheck, ReceiptText, Wallet } from 'lucide-react'
import { TONES } from '../../lib/purchases-constants.js'
import { formatMoneyCompact } from '../../lib/format.js'

function Tile({ icon: Icon, tone, label, value, hint, onClick, children }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={cn('relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 p-4 text-left shadow-sm',
        onClick && 'transition-colors hover:border-teal-600/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40')}
      style={{ backgroundImage: `linear-gradient(160deg, color-mix(in oklab, ${tone} 14%, transparent), transparent 55%)` }}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ backgroundColor: tone }}><Icon className="h-4 w-4" /></span>
        <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">{label}</span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-2xl font-semibold tabular-nums text-[hsl(var(--foreground))]">{value}</p>
          {hint ? <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{hint}</p> : null}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </Tag>
  )
}

function Spark({ data, dataKey, color, id }) {
  return (
    <div className="h-12 w-28">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 1, height: 1 }}>
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.45 }} />
              <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function Bars({ bars }) {
  const max = Math.max(1, ...bars.map((b) => b.value))
  return (
    <div className="flex items-end gap-1.5">
      {bars.map((b) => (
        <div key={b.label} className="flex flex-col items-center gap-1" title={`${b.label}: ${b.value}`}>
          <span className="w-4 rounded-md" style={{ height: `${8 + (b.value / max) * 34}px`, backgroundColor: b.color }} />
          <span className="text-[9px] text-[hsl(var(--muted-foreground))]">{b.short}</span>
        </div>
      ))}
    </div>
  )
}

// Share of what was invoiced that is still unpaid.
function PayableMeter({ payable, invoiced }) {
  const pct = Number(invoiced) > 0 ? Math.min(100, Math.round((Number(payable) / Number(invoiced)) * 100)) : 0
  return (
    <div className="flex w-28 flex-col justify-end gap-1.5">
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-emerald-500/25" title={`${pct}% de lo facturado sigue por pagar`}>
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: TONES.amber }} />
      </div>
      <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{pct}% sin pagar</p>
    </div>
  )
}

// Four headline figures. Tiles for disabled capabilities are left out.
export function MetricTiles({ data, isLoading, has, go }) {
  if (isLoading || !data) {
    return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
  }
  const m = data.metrics ?? {}
  const monthly = data.monthly ?? []
  const last = monthly.at(-1) ?? {}
  const tiles = [
    has('purchaseOrders') && (
      <Tile key="ordered" icon={ClipboardList} tone={TONES.teal} label="Ordenado en 12 meses" value={formatMoneyCompact(m.orderedAmount)}
        hint={`${m.ordersOpen ?? 0} órdenes abiertas`} onClick={() => go('orders')}>
        <Spark data={monthly} dataKey="ordered" color={TONES.teal} id="spark-ordered" />
      </Tile>
    ),
    has('invoices') && (
      <Tile key="invoiced" icon={ReceiptText} tone={TONES.petrol} label="Facturado en 12 meses" value={formatMoneyCompact(m.invoicedAmount)}
        hint={`${formatMoneyCompact(last.invoiced)} este mes`} onClick={() => go('invoices')}>
        <Spark data={monthly} dataKey="invoiced" color={TONES.sky} id="spark-invoiced" />
      </Tile>
    ),
    has('invoices') && (
      <Tile key="payable" icon={Wallet} tone={TONES.amber} label="Por pagar" value={formatMoneyCompact(m.payableAmount)}
        hint={m.overdueInvoices ? `${m.overdueInvoices} vencidas` : 'Nada vencido'} onClick={() => go(has('payments') ? 'payments' : 'invoices')}>
        <PayableMeter payable={m.payableAmount} invoiced={m.invoicedAmount} />
      </Tile>
    ),
    (has('approvals') || has('receipts')) && (
      <Tile key="waiting" icon={has('approvals') ? BadgeCheck : PackageCheck} tone={TONES.violet} label="Esperando acción"
        value={(has('approvals') ? m.pendingApprovals ?? 0 : 0) + (has('receipts') ? m.pendingReceipts ?? 0 : 0)}
        hint={[has('approvals') && `${m.pendingApprovals ?? 0} aprobaciones`, has('receipts') && `${m.pendingReceipts ?? 0} recepciones`].filter(Boolean).join(', ')}
        onClick={() => go(has('approvals') ? 'approvals' : 'receipts')}>
        <Bars bars={[
          has('approvals') && { label: 'Aprobaciones', short: 'Aprob.', value: m.pendingApprovals ?? 0, color: TONES.violet },
          has('receipts') && { label: 'Recepciones', short: 'Recep.', value: m.pendingReceipts ?? 0, color: TONES.emerald },
        ].filter(Boolean)} />
      </Tile>
    ),
  ].filter(Boolean)

  return <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', tiles.length >= 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-3')}>{tiles}</div>
}
