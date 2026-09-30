import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyState, Skeleton } from '@runly/ui'
import { Building2, CalendarRange, History } from 'lucide-react'
import { AXIS, ChartTooltip, Panel } from './dashboard-theme.jsx'
import { TONES, statusMeta, kindOf } from '../../lib/purchases-constants.js'
import { formatDate, formatMoney, formatMoneyCompact, monthLabel } from '../../lib/format.js'
import { PurchaseStatusBadge } from '../PurchaseStatusBadge.jsx'

// Ordered vs invoiced over 12 months. With orders disabled only invoices show.
export function SpendTrendPanel({ monthly = [], showOrdered = true }) {
  const rows = monthly.map((d) => ({ ...d, label: monthLabel(d.month) }))
  const sum = (key) => rows.reduce((acc, r) => acc + Number(r[key] || 0), 0)
  return (
    <Panel title="Compras de los últimos 12 meses" icon={CalendarRange}
      subtitle={showOrdered ? `Ordenado ${formatMoneyCompact(sum('ordered'))}, facturado ${formatMoneyCompact(sum('invoiced'))}` : `Facturado ${formatMoneyCompact(sum('invoiced'))}`}>
      <div className="h-64 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 1, height: 1 }}>
          <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="pur-ordered" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: TONES.teal, stopOpacity: 0.4 }} />
                <stop offset="100%" style={{ stopColor: TONES.teal, stopOpacity: 0 }} />
              </linearGradient>
              <linearGradient id="pur-invoiced" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: TONES.sky, stopOpacity: 0.35 }} />
                <stop offset="100%" style={{ stopColor: TONES.sky, stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => formatMoneyCompact(v)} />
            <Tooltip content={<ChartTooltip formatter={(v) => formatMoney(v)} />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            {showOrdered ? <Area type="monotone" dataKey="ordered" name="Ordenado" stroke={TONES.teal} strokeWidth={2.5} fill="url(#pur-ordered)" dot={false} activeDot={{ r: 5 }} /> : null}
            <Area type="monotone" dataKey="invoiced" name="Facturado" stroke={TONES.sky} strokeWidth={2.5} fill="url(#pur-invoiced)" dot={false} activeDot={{ r: 5 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}

// Ranking of suppliers by amount.
export function SupplierRankingPanel({ rows = [], onSelect }) {
  const data = rows.map((r) => ({ id: r.id, name: r.name, total: Number(r.total || 0), documents: r.documents }))
  return (
    <Panel title="Proveedores con más compra" subtitle="Top 6 por monto en 12 meses" icon={Building2} tone={TONES.petrol}>
      {!data.length ? <EmptyState variant="compact" icon={Building2} title="Aún no hay compras con proveedor" /> : (
        <div className="w-full min-w-0" style={{ height: Math.max(170, data.length * 38) }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 1, height: 1 }}>
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }} barCategoryGap={8}>
              <defs>
                <linearGradient id="pur-suppliers" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" style={{ stopColor: TONES.teal, stopOpacity: 0.55 }} />
                  <stop offset="100%" style={{ stopColor: TONES.petrol, stopOpacity: 1 }} />
                </linearGradient>
              </defs>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={130} tick={{ ...AXIS, fill: 'hsl(var(--foreground))' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip formatter={(v, p) => `${formatMoney(v)} en ${p.payload.documents ?? 0} documentos`} />} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
              <Bar dataKey="total" name="Monto" fill="url(#pur-suppliers)" radius={[4, 8, 8, 4]} className="cursor-pointer"
                label={{ position: 'right', fill: 'hsl(var(--muted-foreground))', fontSize: 11, formatter: (v) => formatMoneyCompact(v) }}
                onClick={(entry) => entry?.id && onSelect?.(entry)} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  )
}

const KIND_LABEL = { orders: 'Orden', invoices: 'Factura', requests: 'Solicitud', receipts: 'Recepción', cases: 'Expediente', quotes: 'Cotización' }

export function RecentPanel({ rows = [], onOpen }) {
  return (
    <Panel title="Movimiento reciente" subtitle="Últimos documentos registrados" icon={History} tone={TONES.slate}>
      {!rows.length ? <EmptyState variant="compact" icon={History} title="Todavía no hay documentos" /> : (
        <ul className="divide-y divide-[hsl(var(--border))]">
          {rows.map((row) => {
            const kind = kindOf(row.kind) ?? 'orders'
            return (
              <li key={`${row.kind}:${row.id}`}>
                <button type="button" onClick={() => onOpen(kind, row.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left transition-colors hover:bg-[hsl(var(--muted))]/40">
                  <span className="w-20 shrink-0 text-xs text-[hsl(var(--muted-foreground))]">{KIND_LABEL[kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold tabular-nums">{row.number}</span>
                    <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">{row.supplierName || 'Sin proveedor'}, {formatDate(row.date)}</span>
                  </span>
                  <span className="hidden text-right sm:block">
                    <span className="block text-sm font-medium tabular-nums">{formatMoney(row.total, row.currency)}</span>
                  </span>
                  <PurchaseStatusBadge kind={kind} status={row.status} label={statusMeta(kind, row.status).label} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

export function ChartsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
    </div>
  )
}
