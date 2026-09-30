import { Area, AreaChart, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts'
import { Skeleton, cn } from '@runly/ui'
import { Banknote, PackagePlus, ShieldAlert, UserCheck } from 'lucide-react'
import { ITEM_STATUSES } from '../../lib/inventory-constants.js'

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', notation: 'compact', maximumFractionDigits: 1 })

function Tile({ icon: Icon, tone, label, value, hint, onClick, children }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={cn('relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 p-4 text-left shadow-sm',
        onClick && 'transition-colors hover:border-[hsl(var(--ring))]/50')}
      style={{ backgroundImage: `linear-gradient(160deg, color-mix(in oklab, ${tone} 16%, transparent), transparent 55%)` }}>
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

// Four headline metrics, each with the small visual that fits it: a
// sparkline for a trend, a ring for a share, a segmented bar for a split.
export function MetricTiles({ data, isLoading, go }) {
  if (isLoading || !data) {
    return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
  }
  const active = data.activeCount
  const altas = data.monthly.reduce((sum, m) => sum + m.altas, 0)
  const pctAssigned = active ? Math.round((data.assignedCount / active) * 100) : 0
  const statusParts = ITEM_STATUSES.map((s) => ({ ...s, count: data.byStatus?.[s.value] ?? 0 }))
  const w = data.warranties

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile icon={PackagePlus} tone="#0ea5e9" label="Altas en 12 meses" value={altas} hint={`${data.monthly.at(-1)?.altas ?? 0} este mes`}>
        <div className="h-12 w-28">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 1, height: 1 }}>
            <AreaChart data={data.monthly} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="spark-altas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: '#0ea5e9', stopOpacity: 0.45 }} />
                  <stop offset="100%" style={{ stopColor: '#0ea5e9', stopOpacity: 0 }} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="altas" stroke="#0ea5e9" strokeWidth={2} fill="url(#spark-altas)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Tile>

      <Tile icon={UserCheck} tone="#8b5cf6" label="Asignados" value={`${pctAssigned}%`} hint={`${data.assignedCount} de ${active} vigentes`} onClick={() => go({ status: 'assigned' })}>
        <div className="h-14 w-14">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 1, height: 1 }}>
            <RadialBarChart innerRadius="72%" outerRadius="100%" data={[{ value: pctAssigned }]} startAngle={90} endAngle={-270}>
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar dataKey="value" cornerRadius={8} fill="#8b5cf6" background={{ fill: 'hsl(var(--muted))' }} isAnimationActive={false} />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
      </Tile>

      <Tile icon={Banknote} tone="#10b981" label="Valor de compra" value={money.format(data.purchaseValue)} hint={`${data.pricedCount} activos con precio`}>
        <div className="flex h-12 w-28 flex-col justify-end gap-1.5">
          <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" title={statusParts.map((s) => `${s.label}: ${s.count}`).join(', ')}>
            {statusParts.filter((s) => s.count).map((s) => (
              <span key={s.value} style={{ flexGrow: s.count, backgroundColor: s.color }} />
            ))}
            {!statusParts.some((s) => s.count) ? <span className="flex-1 bg-[hsl(var(--muted))]" /> : null}
          </div>
          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">Disponibilidad</p>
        </div>
      </Tile>

      <Tile icon={ShieldAlert} tone="#f59e0b" label="Garantías por vencer" value={w.in30} hint="en los próximos 30 días">
        <div className="flex items-end gap-1.5">
          {[
            { label: 'Vencidas', value: w.expired, color: '#ef4444' },
            { label: '30 días', value: w.in30, color: '#f59e0b' },
            { label: '90 días', value: w.in90, color: '#fbbf24' },
          ].map((b) => {
            const max = Math.max(1, w.expired, w.in90)
            return (
              <div key={b.label} className="flex flex-col items-center gap-1" title={`${b.label}: ${b.value}`}>
                <span className="w-4 rounded-md" style={{ height: `${8 + (b.value / max) * 36}px`, backgroundColor: b.color }} />
                <span className="text-[9px] text-[hsl(var(--muted-foreground))]">{b.label.split(' ')[0]}</span>
              </div>
            )
          })}
        </div>
      </Tile>
    </div>
  )
}
