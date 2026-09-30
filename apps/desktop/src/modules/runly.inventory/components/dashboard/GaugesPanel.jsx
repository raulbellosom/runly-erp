import { Gauge } from 'lucide-react'
import { Panel } from './dashboard-theme.jsx'

const CX = 100
const CY = 104
const R_OUT = 92
const R_IN = 68

const point = (r, pct) => {
  const a = Math.PI - (pct / 100) * Math.PI
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)]
}
// Ring segment between two percentages of the half circle.
function arc(from, to) {
  const [x1, y1] = point(R_OUT, from)
  const [x2, y2] = point(R_OUT, to)
  const [x3, y3] = point(R_IN, to)
  const [x4, y4] = point(R_IN, from)
  return `M ${x1} ${y1} A ${R_OUT} ${R_OUT} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${R_IN} ${R_IN} 0 0 0 ${x4} ${y4} Z`
}

// Speedometer-style gauge: three bands (bad / fair / good), the filled value
// arc on top and a needle. `good` says which end is healthy.
function SemiGauge({ label, value, detail, good = 'high', onClick }) {
  const pct = Math.max(0, Math.min(100, value))
  const bands = good === 'high'
    ? [[0, 40, '#ef4444'], [40, 70, '#f59e0b'], [70, 100, '#16a34a']]
    : [[0, 30, '#16a34a'], [30, 60, '#f59e0b'], [60, 100, '#ef4444']]
  const tone = bands.find(([a, b]) => pct >= a && pct <= b)?.[2] ?? bands[2][2]
  const [nx, ny] = point(R_IN - 10, pct)
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} title={`${label}: ${pct}%`}
      className="flex min-w-0 flex-col items-center rounded-2xl p-3 text-center transition-colors hover:bg-[hsl(var(--muted))]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
      <svg viewBox="0 0 200 118" className="w-full max-w-60" role="img" aria-label={`${label}: ${pct}%`}>
        {bands.map(([a, b, c]) => <path key={a} d={arc(a, b)} fill={c} opacity={0.22} />)}
        {pct > 0 ? <path d={arc(0, pct)} fill={tone} /> : null}
        {[0, 25, 50, 75, 100].map((t) => {
          const [x1, y1] = point(R_OUT + 3, t)
          const [x2, y2] = point(R_OUT + 8, t)
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="hsl(var(--muted-foreground))" strokeWidth="1.5" strokeLinecap="round" />
        })}
        <line x1={CX} y1={CY} x2={nx} y2={ny} stroke="hsl(var(--foreground))" strokeWidth="4" strokeLinecap="round"
          style={{ transition: 'all 700ms cubic-bezier(.2,.8,.2,1)' }} />
        <circle cx={CX} cy={CY} r="8" fill="hsl(var(--foreground))" />
        <circle cx={CX} cy={CY} r="3.5" fill="hsl(var(--card))" />
      </svg>
      <p className="-mt-1 text-3xl font-bold tabular-nums" style={{ color: tone }}>{pct}%</p>
      <p className="text-sm font-medium text-[hsl(var(--foreground))]">{label}</p>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">{detail}</p>
    </Tag>
  )
}

export function GaugesPanel({ data, go }) {
  const active = data.activeCount || 0
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0)
  const inAlta = data.byAdminStatus?.registered ?? 0
  const maintenance = data.byStatus?.maintenance ?? 0
  return (
    <Panel title="Medidores" subtitle="Qué tan sano está tu inventario" icon={Gauge} tone="#16a34a">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SemiGauge label="En uso" value={pct(data.assignedCount, active)} detail={`${data.assignedCount} de ${active} asignados`} onClick={() => go({ status: 'assigned' })} />
        <SemiGauge label="Con garantía vigente" value={pct(data.warranties.active, active)} detail={`${data.warranties.active} de ${active}`} />
        <SemiGauge label="Dados de alta" value={pct(inAlta, data.total)} detail={`${inAlta} de ${data.total} registrados`} onClick={() => go({ adminStatus: 'registered' })} />
        <SemiGauge label="En mantenimiento" value={pct(maintenance, active)} detail={`${maintenance} de ${active}`} good="low" onClick={() => go({ status: 'maintenance' })} />
      </div>
    </Panel>
  )
}
