import { useState } from 'react'
import {
  Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Sector, Tooltip, Treemap, XAxis, YAxis,
} from 'recharts'
import { SegmentedControl, SelectField, cn } from '@runly/ui'
import { BarChart3, CircleDot, LayoutGrid, PieChart as PieIcon, Shapes } from 'lucide-react'
import { ChartTooltip, LegendList, Panel, vizColor, withOthers } from './dashboard-theme.jsx'

const DIMENSIONS = [
  { value: 'types', label: 'Tipo', param: 'categoryId' },
  { value: 'brands', label: 'Marca', param: 'brandId' },
  { value: 'models', label: 'Modelo', param: 'modelId' },
  { value: 'locations', label: 'Ubicación', param: 'locationId' },
  { value: 'conditions', label: 'Condición', param: 'conditionId' },
]
const KINDS = [
  { value: 'donut', label: 'Dona', icon: CircleDot },
  { value: 'pie', label: 'Pastel', icon: PieIcon },
  { value: 'bar', label: 'Barras', icon: BarChart3 },
  { value: 'treemap', label: 'Mosaico', icon: LayoutGrid },
]

// Hovered slice grows outward and gets an outer ring.
function ActiveSlice(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props
  return (
    <g>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 8} startAngle={startAngle} endAngle={endAngle} fill={fill} cornerRadius={4} />
      <Sector cx={cx} cy={cy} innerRadius={outerRadius + 12} outerRadius={outerRadius + 16} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.5} />
    </g>
  )
}

function MosaicCell({ x, y, width, height, name, value, fill, depth }) {
  if (depth !== 1 || width <= 0 || height <= 0) return null
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={12} style={{ fill, stroke: 'hsl(var(--card))', strokeWidth: 4 }} />
      {width > 80 && height > 44 ? (
        <>
          <text x={x + 12} y={y + 24} fill="#fff" fontSize={13} fontWeight={600}>{String(name).slice(0, Math.floor(width / 8))}</text>
          <text x={x + 12} y={y + 42} fill="rgba(255,255,255,0.85)" fontSize={12}>{value}</text>
        </>
      ) : null}
      <title>{`${name}: ${value}`}</title>
    </g>
  )
}

// One big panel to explore how active items split by type, brand, model,
// location or condition, as donut, pie, bars or mosaic. Hover highlights,
// clicking a slice/bar/legend row opens the filtered list.
export function DistributionPanel({ data, onOpenList }) {
  const [dimension, setDimension] = useState('types')
  const [kind, setKind] = useState('donut')
  const [hover, setHover] = useState(null)
  const dim = DIMENSIONS.find((d) => d.value === dimension)
  const total = data.activeCount
  const source = dimension === 'conditions'
    ? data.byCondition.map((c) => ({ id: c.id, name: c.name, count: c.count, color: c.color }))
    : (data.top[dimension] ?? [])
  const slices = withOthers(source.map((r) => ({ key: r.id ?? `none-${r.name}`, id: r.id, label: r.name, count: r.count, color: r.color })), total)
    .map((s, i) => ({ ...s, fill: s.color ?? vizColor(s.others ? 7 : i), color: s.color ?? vizColor(s.others ? 7 : i) }))
  const open = (row) => { if (row?.id) onOpenList({ [dim.param]: row.id }) }
  const focus = hover !== null ? slices[hover] : null

  let chart
  if (!slices.length) {
    chart = <p className="py-16 text-center text-sm text-[hsl(var(--muted-foreground))]">Aún no hay activos para mostrar.</p>
  } else if (kind === 'bar') {
    chart = (
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 1, height: 1 }}>
        <BarChart data={slices} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 4 }} barCategoryGap={6}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={130} tick={{ fill: 'hsl(var(--foreground))', fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
          <Bar dataKey="count" name="Activos" radius={[4, 10, 10, 4]} onClick={open} className="cursor-pointer" isAnimationActive={false}>
            {slices.map((s) => <Cell key={s.key} fill={s.fill} />)}
            <LabelList dataKey="count" position="right" style={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  } else if (kind === 'treemap') {
    chart = (
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 1, height: 1 }}>
        <Treemap data={slices.map((s) => ({ name: s.label, size: s.count, fill: s.fill, id: s.id }))} dataKey="size" nameKey="name"
          isAnimationActive={false} content={<MosaicCell />} onClick={(node) => open(node)} />
      </ResponsiveContainer>
    )
  } else {
    chart = (
      <div className="relative h-full w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 1, height: 1 }}>
          <PieChart>
            <Pie data={slices} dataKey="count" nameKey="label" innerRadius={kind === 'donut' ? '58%' : 0} outerRadius="84%"
              paddingAngle={kind === 'donut' && slices.length > 1 ? 2 : 0} cornerRadius={kind === 'donut' ? 5 : 0}
              stroke="hsl(var(--card))" strokeWidth={2} activeShape={ActiveSlice}
              onMouseEnter={(_, i) => setHover(i)} onMouseLeave={() => setHover(null)} onClick={open} className="cursor-pointer" isAnimationActive={false}
              label={kind === 'pie' ? ({ percent }) => (percent >= 0.06 ? `${Math.round(percent * 100)}%` : '') : false} labelLine={false}>
              {slices.map((s, i) => <Cell key={s.key} fill={s.fill} fillOpacity={hover === null || hover === i ? 1 : 0.35} />)}
            </Pie>
            {/* The tooltip drives the active (grown) slice; the donut shows the value in its center instead. */}
            <Tooltip content={kind === 'pie' ? <ChartTooltip /> : () => null} />
          </PieChart>
        </ResponsiveContainer>
        {kind === 'donut' ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
            <span className="text-3xl font-bold tabular-nums">{focus ? focus.count : total}</span>
            <span className="line-clamp-2 text-xs text-[hsl(var(--muted-foreground))]">
              {focus ? `${focus.label} · ${total ? Math.round((focus.count / total) * 100) : 0}%` : 'activos vigentes'}
            </span>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <Panel title="Distribución" subtitle={`Activos vigentes por ${dim.label.toLowerCase()}`} icon={Shapes} tone="var(--viz-3)">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="hidden md:block">
          <SegmentedControl ariaLabel="Agrupar por" value={dimension} onChange={(v) => { setDimension(v); setHover(null) }} className="w-auto"
            options={DIMENSIONS.map(({ value, label }) => ({ value, label }))} />
        </div>
        <div className="w-40 md:hidden"><SelectField value={dimension} onValueChange={(v) => { setDimension(v); setHover(null) }} options={DIMENSIONS} /></div>
        <div className="ml-auto flex items-center gap-1 rounded-full border border-[hsl(var(--border))] p-1" role="radiogroup" aria-label="Tipo de gráfica">
          {KINDS.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={kind === o.value} title={o.label} onClick={() => setKind(o.value)}
              className={cn('flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                kind === o.value ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]')}>
              <o.icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="h-80 min-w-0">{chart}</div>
        <div onMouseLeave={() => setHover(null)}>
          <LegendList rows={slices} total={total} onSelect={open} onHover={setHover} activeIndex={hover} />
        </div>
      </div>
    </Panel>
  )
}
