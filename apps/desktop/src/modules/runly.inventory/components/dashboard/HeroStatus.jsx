import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Skeleton } from '@runly/ui'
import { ADMIN_STATUSES } from '../../lib/admin-status.js'
import { ChartTooltip } from './dashboard-theme.jsx'

// The dashboard's one loud element: a violet glass band with the
// administrative-status donut (total in the middle) and a tile per status.
export function HeroStatus({ data, isLoading, onSelect }) {
  const total = data?.total ?? 0
  const slices = ADMIN_STATUSES.map((s) => ({ ...s, count: data?.byAdminStatus?.[s.value] ?? 0 }))
  const pie = slices.filter((s) => s.count > 0)

  return (
    <section className="relative overflow-hidden rounded-3xl p-6 text-white shadow-xl md:p-8"
      style={{ background: 'linear-gradient(135deg, #5b21b6 0%, #4338ca 55%, #1e3a8a 100%)' }}>
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-fuchsia-400/30 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 h-72 w-72 rounded-full bg-sky-400/25 blur-3xl" />

      <div className="relative grid items-center gap-8 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <div className="relative mx-auto h-56 w-56 md:h-60 md:w-60">
          {isLoading ? <Skeleton className="h-full w-full rounded-full bg-white/15" /> : (
            <>
              <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 1, height: 1 }}>
                <PieChart>
                  <Pie data={pie.length ? pie : [{ label: 'Sin activos', count: 1, color: 'rgba(255,255,255,0.18)' }]}
                    dataKey="count" nameKey="label" innerRadius="72%" outerRadius="100%" paddingAngle={pie.length > 1 ? 3 : 0}
                    cornerRadius={6} stroke="none" isAnimationActive>
                    {(pie.length ? pie : [{ color: 'rgba(255,255,255,0.18)' }]).map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                  {pie.length ? <Tooltip content={<ChartTooltip />} /> : null}
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-5xl font-bold tabular-nums tracking-tight">{total}</span>
                <span className="text-sm text-white/75">activos en total</span>
              </div>
            </>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Tu inventario hoy</h2>
            <p className="mt-1 max-w-xl text-sm text-white/75">
              {isLoading ? 'Cargando...' : `${data?.activeCount ?? 0} activos vigentes, ${data?.assignedCount ?? 0} asignados y ${data?.byAdminStatus?.deregistration_proposed ?? 0} propuestas de baja por decidir.`}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {slices.map((s) => {
              const pct = total ? Math.round((s.count / total) * 100) : 0
              return (
                <button key={s.value} type="button" onClick={() => onSelect?.(s.value)}
                  className="group rounded-2xl border border-white/15 bg-white/10 p-3 text-left backdrop-blur-md transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
                  <span className="flex items-center gap-2 text-xs text-white/80">
                    <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white/40" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </span>
                  <span className="mt-1 flex items-baseline gap-1.5">
                    {isLoading ? <Skeleton className="h-7 w-10 bg-white/20" /> : <span className="text-2xl font-semibold tabular-nums">{s.count}</span>}
                    <span className="text-xs tabular-nums text-white/65">{pct}%</span>
                  </span>
                  <span className="mt-2 block h-1 overflow-hidden rounded-full bg-white/15">
                    <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: s.color }} />
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
