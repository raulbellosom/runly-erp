import { useState } from 'react'
import { Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Radar as RadarIcon } from 'lucide-react'
import { cn } from '@runly/ui'
import { ChartTooltip, Panel } from './dashboard-theme.jsx'

// Three series only: the first three palette slots are safe together in any
// arrangement (radar polygons overlap each other everywhere).
const SERIES = [
  { key: 'available', label: 'Disponibles', color: 'var(--viz-3)' },
  { key: 'assigned', label: 'Asignados', color: 'var(--viz-1)' },
  { key: 'maintenance', label: 'En mantenimiento', color: 'var(--viz-2)' },
]

// Spider chart: one axis per type, one polygon per availability — shows at a
// glance which types sit idle and which are in use or in the shop.
export function TypeRadarPanel({ rows }) {
  const [visible, setVisible] = useState(SERIES.map((s) => s.key))
  const data = rows.map((r) => ({ ...r, axis: r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name }))
  return (
    <Panel title="Perfil por tipo" subtitle="Disponibilidad de los tipos con más activos" icon={RadarIcon} tone="var(--viz-1)">
      {data.length < 3 ? (
        <p className="py-16 text-center text-sm text-[hsl(var(--muted-foreground))]">Se necesitan al menos 3 tipos con activos para dibujar el perfil.</p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-2">
            {SERIES.map((s) => {
              const on = visible.includes(s.key)
              return (
                <button key={s.key} type="button" aria-pressed={on}
                  onClick={() => setVisible((cur) => (on ? (cur.length > 1 ? cur.filter((k) => k !== s.key) : cur) : [...cur, s.key]))}
                  className={cn('flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-opacity', on ? 'border-transparent bg-[hsl(var(--muted))]/60' : 'border-[hsl(var(--border))] opacity-50')}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />{s.label}
                </button>
              )
            })}
          </div>
          <div className="h-80 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 1, height: 1 }}>
              <RadarChart data={data} outerRadius="72%">
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="axis" tick={{ fill: 'hsl(var(--foreground))', fontSize: 12 }} />
                <PolarRadiusAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} allowDecimals={false} angle={90} />
                {SERIES.filter((s) => visible.includes(s.key)).map((s) => (
                  <Radar key={s.key} dataKey={s.key} name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.22} strokeWidth={2.5}
                    dot={{ r: 3, fill: s.color, strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                ))}
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Panel>
  )
}
