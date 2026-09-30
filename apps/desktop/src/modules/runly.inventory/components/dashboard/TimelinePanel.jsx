import { useMemo, useState } from 'react'
import {
  Area, Bar, Brush, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Button, SegmentedControl, SelectField, Skeleton, cn } from '@runly/ui'
import { AreaChart as AreaIcon, BarChart3, CalendarRange, LineChart as LineIcon, X } from 'lucide-react'
import { useInventoryDashboardTrend } from '../../hooks/useInventoryAdmin.js'
import { ChartTooltip, Panel } from './dashboard-theme.jsx'

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const dayLabel = (iso) => { const [, m, d] = iso.split('-'); return `${Number(d)} ${MONTHS[Number(m) - 1]}` }
const bucketLabel = (iso, granularity) => {
  const [y, m] = iso.split('-')
  return granularity === 'week' ? dayLabel(iso) : `${MONTHS[Number(m) - 1]} ${y.slice(2)}`
}
const periodTitle = (point, granularity) => (granularity === 'week'
  ? `Semana del ${dayLabel(point.start)}${point.end ? ` al ${dayLabel(point.end)}` : ''}`
  : `${MONTHS[Number(point.start.slice(5, 7)) - 1]} ${point.start.slice(0, 4)}`)

// Series take categorical slots 1-4 in this fixed order.
const SERIES = [
  { key: 'altas', label: 'Altas', color: 'var(--viz-1)' },
  { key: 'bajas', label: 'Bajas', color: 'var(--viz-2)' },
  { key: 'asignaciones', label: 'Asignaciones', color: 'var(--viz-3)' },
  { key: 'devoluciones', label: 'Devoluciones', color: 'var(--viz-4)' },
]
const RANGES = {
  week: [{ value: '8', label: '8 semanas' }, { value: '12', label: '12 semanas' }, { value: '26', label: '6 meses' }, { value: '52', label: '1 año' }],
  month: [{ value: '6', label: '6 meses' }, { value: '12', label: '12 meses' }, { value: '24', label: '2 años' }, { value: '36', label: '3 años' }],
}
const AXIS = { fill: 'hsl(var(--muted-foreground))', fontSize: 12 }

// Big, interactive timeline: weeks or months, a range, which series to show,
// bars/lines/areas, a brush to zoom, and a click-to-inspect period with a
// shortcut to the items registered in it.
export function TimelinePanel({ onOpenList }) {
  const [granularity, setGranularity] = useState('month')
  const [periods, setPeriods] = useState('12')
  const [view, setView] = useState('movements')
  const [kind, setKind] = useState('bar')
  const [visible, setVisible] = useState(['altas', 'bajas'])
  const [selected, setSelected] = useState(null)
  const { data, isLoading, isFetching } = useInventoryDashboardTrend(granularity, periods)

  const rows = useMemo(() => (data?.points ?? []).map((p) => ({ ...p, label: bucketLabel(p.start, data.granularity) })), [data])
  const shown = SERIES.filter((s) => visible.includes(s.key))
  const totals = Object.fromEntries(SERIES.map((s) => [s.key, rows.reduce((sum, r) => sum + r[s.key], 0)]))
  const point = selected ? rows.find((r) => r.start === selected) : null

  const changeGranularity = (next) => {
    setGranularity(next)
    setPeriods('12')
    setSelected(null)
  }
  const toggle = (key) => setVisible((cur) => (cur.includes(key) ? (cur.length > 1 ? cur.filter((k) => k !== key) : cur) : [...cur, key]))

  const renderSeries = (s) => {
    const common = { dataKey: s.key, name: s.label, stroke: s.color, fill: s.color, isAnimationActive: false }
    if (kind === 'line') return <Line key={s.key} {...common} type="monotone" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0 }} activeDot={{ r: 6 }} />
    if (kind === 'area') return <Area key={s.key} {...common} type="monotone" strokeWidth={2.5} fill={`url(#tl-${s.key})`} activeDot={{ r: 6 }} />
    return <Bar key={s.key} {...common} radius={[5, 5, 0, 0]} maxBarSize={granularity === 'week' ? 14 : 26} />
  }

  return (
    <Panel title="Línea de tiempo" icon={CalendarRange} tone="var(--viz-1)"
      subtitle={view === 'growth' ? 'Activos vigentes al cierre de cada periodo' : 'Haz clic en un periodo para ver su detalle; arrastra la barra inferior para acercar'}>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SegmentedControl ariaLabel="Vista" value={view} onChange={(v) => { setView(v); setSelected(null) }} className="w-auto"
          options={[{ value: 'movements', label: 'Movimientos' }, { value: 'growth', label: 'Crecimiento' }]} />
        <SegmentedControl ariaLabel="Agrupar por" value={granularity} onChange={changeGranularity} className="w-auto"
          options={[{ value: 'week', label: 'Semanas' }, { value: 'month', label: 'Meses' }]} />
        <div className="w-36"><SelectField value={periods} onValueChange={(v) => { setPeriods(v); setSelected(null) }} options={RANGES[granularity]} /></div>
        {view === 'movements' ? (
          <div className="ml-auto flex items-center gap-1 rounded-full border border-[hsl(var(--border))] p-1" role="radiogroup" aria-label="Tipo de gráfica">
            {[{ value: 'bar', icon: BarChart3, label: 'Barras' }, { value: 'line', icon: LineIcon, label: 'Líneas' }, { value: 'area', icon: AreaIcon, label: 'Áreas' }].map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={kind === o.value} title={o.label} onClick={() => setKind(o.value)}
                className={cn('flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                  kind === o.value ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]')}>
                <o.icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {view === 'movements' ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {SERIES.map((s) => {
            const on = visible.includes(s.key)
            return (
              <button key={s.key} type="button" aria-pressed={on} onClick={() => toggle(s.key)}
                className={cn('flex items-center gap-2 rounded-xl border px-3 py-1.5 text-left transition-colors',
                  on ? 'border-transparent bg-[hsl(var(--muted))]/60' : 'border-[hsl(var(--border))] opacity-55 hover:opacity-90')}>
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{s.label}</span>
                <span className="text-sm font-semibold tabular-nums text-[hsl(var(--foreground))]">{totals[s.key]}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {isLoading ? <Skeleton className="h-96 w-full rounded-xl" /> : (
        <div className={cn('h-96 w-full min-w-0 transition-opacity', isFetching && 'opacity-60')}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 1, height: 1 }}>
            <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}
              onClick={(state) => { const p = state?.activePayload?.[0]?.payload; if (p) setSelected((cur) => (cur === p.start ? null : p.start)) }}
              className="cursor-pointer">
              <defs>
                {[...SERIES, { key: 'vigentes', color: 'var(--viz-7)' }].map((s) => (
                  <linearGradient key={s.key} id={`tl-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 0.45 }} />
                    <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0.02 }} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" vertical={false} />
              <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} width={44} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted) / 0.35)' }} />
              {point ? <ReferenceArea x1={point.label} x2={point.label} fill="hsl(var(--primary))" fillOpacity={0.08} /> : null}
              {view === 'growth'
                ? <Area dataKey="vigentes" name="Activos vigentes" type="monotone" stroke="var(--viz-7)" strokeWidth={3} fill="url(#tl-vigentes)" activeDot={{ r: 6 }} isAnimationActive={false} />
                : shown.map(renderSeries)}
              {view === 'movements' ? <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} /> : null}
              {rows.length > 8 ? <Brush dataKey="label" height={26} travellerWidth={10} stroke="hsl(var(--primary))" fill="hsl(var(--card))" /> : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {point ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[hsl(var(--foreground))]">{periodTitle(point, data.granularity)}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{point.vigentes} activos vigentes al cierre</p>
          </div>
          <div className="flex flex-wrap gap-4">
            {SERIES.map((s) => (
              <div key={s.key}>
                <p className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />{s.label}</p>
                <p className="text-lg font-semibold tabular-nums">{point[s.key]}</p>
              </div>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" disabled={!point.altas}
              onClick={() => onOpenList({ createdFrom: point.start, ...(point.end ? { createdTo: point.end } : {}), adminStatus: 'all' })}>
              Ver activos dados de alta
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Cerrar detalle" onClick={() => setSelected(null)}><X className="h-4 w-4" /></Button>
          </div>
        </div>
      ) : null}
    </Panel>
  )
}
