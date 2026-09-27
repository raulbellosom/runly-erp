// apps/desktop/src/modules/runly.catalog/components/MovementsTrendChart.jsx
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMonthLabel } from '../lib/aggregateMovements.js'

const C_IN  = 'var(--color-success)'
const C_OUT = 'var(--color-destructive)'
const C_GRID = 'hsl(var(--border) / 0.6)'

export default function MovementsTrendChart({ data }) {
  const rows = data.map(d => ({ ...d, label: formatMonthLabel(d.month) }))
  return (
    <div className="h-56 w-full min-w-0" style={{ minHeight: 224 }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={180} debounce={1}>
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={32}
            allowDecimals={false}
          />
          <Tooltip
            formatter={(value, name) => [value, name === 'entradas' ? 'Entradas' : 'Salidas']}
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '0.5rem',
              color: 'hsl(var(--popover-foreground))',
            }}
          />
          <Bar dataKey="entradas" fill={C_IN} radius={[4, 4, 0, 0]} />
          <Bar dataKey="salidas" fill={C_OUT} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
