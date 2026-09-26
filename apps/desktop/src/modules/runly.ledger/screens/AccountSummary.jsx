// apps/desktop/src/modules/runly.ledger/screens/AccountSummary.jsx
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Wallet, TrendingUp, ArrowDownLeft, ArrowUpRight, LineChart, PieChart as PieChartIcon, BarChart3, Layers, CalendarRange } from 'lucide-react'
import { ErrorState, Card } from '@runly/ui'
import { useAccountSummary } from '../hooks/use-ledger-queries.js'
import { LedgerStatCard } from '../components/LedgerStatCard.jsx'

// Theme-aware — resolve against the app's own brand/semantic CSS custom
// properties (styles.css) so charts and KPI cards read correctly in both
// light and dark mode, and match the rest of Runly's brand system instead of
// a one-off palette.
const C_INCOME = 'var(--color-success)'
const C_EXPENSE = 'var(--color-destructive)'
const C_BALANCE = 'var(--brand-primary-computed, var(--brand-primary))'
const C_MUTED = 'hsl(var(--muted-foreground))'
const C_GRID = 'hsl(var(--border) / 0.6)'
const C_BORDER = 'hsl(var(--border))'

function fmt(value, currency = 'MXN') {
  return Number(value ?? 0).toLocaleString('es-MX', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  })
}

function fmtCompact(value) {
  return Number(value).toLocaleString('es-MX', { notation: 'compact', maximumFractionDigits: 1 })
}

function fmtDay(dateStr) {
  if (!dateStr) return ''
  const parts = String(dateStr).split('-')
  return `${parts[2]}/${parts[1]}`
}

const MONTH_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function fmtMonth(monthStr) {
  if (!monthStr) return ''
  const [year, month] = String(monthStr).split('-')
  const label = MONTH_ABBR[Number(month) - 1] ?? month
  return `${label} ${String(year).slice(2)}`
}

function TooltipShell({ children }) {
  return (
    <div style={{
      background: 'hsl(var(--popover))',
      color: 'hsl(var(--popover-foreground))',
      border: '1px solid hsl(var(--border))',
      borderRadius: 10,
      padding: '8px 14px',
      boxShadow: '0 4px 24px rgba(0,0,0,.18)',
      fontSize: 12,
      minWidth: 130,
      lineHeight: 1.6,
    }}
    >
      {children}
    </div>
  )
}

function BalanceTip({ active, payload, label, currency }) {
  if (!active || !payload?.length) return null
  return (
    <TooltipShell>
      <div style={{ color: C_MUTED, marginBottom: 2 }}>{fmtDay(label)}</div>
      <div style={{ color: C_BALANCE, fontWeight: 700 }}>{fmt(payload[0].value, currency)}</div>
    </TooltipShell>
  )
}

function CategoryTip({ active, payload, label, currency }) {
  if (!active || !payload?.length) return null
  return (
    <TooltipShell>
      <div style={{ color: C_MUTED, marginBottom: 4 }}>{label}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} style={{ color: entry.color, fontWeight: 600 }}>
          {entry.name}: {fmt(entry.value, currency)}
        </div>
      ))}
    </TooltipShell>
  )
}

function MonthTip({ active, payload, label, currency }) {
  if (!active || !payload?.length) return null
  return (
    <TooltipShell>
      <div style={{ color: C_MUTED, marginBottom: 4 }}>{fmtMonth(label)}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} style={{ color: entry.color, fontWeight: 600 }}>
          {entry.name}: {fmt(entry.value, currency)}
        </div>
      ))}
    </TooltipShell>
  )
}

function PieTip({ active, payload, currency }) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  return (
    <TooltipShell>
      <div style={{ color: entry.payload.fill, fontWeight: 700 }}>{entry.name}</div>
      <div>{fmt(entry.value, currency)}</div>
    </TooltipShell>
  )
}

function KpiCard({ label, value, currency, icon, tone }) {
  return (
    <LedgerStatCard
      label={label}
      icon={icon}
      tone={tone}
      value={<span className="font-mono">{fmt(value, currency)}</span>}
    />
  )
}

function Section({ title, icon: Icon, children, aside }) {
  return (
    <Card variant="solid" className="rounded-xl p-5">
      <div className="flex items-center gap-2.5 mb-5">
        {Icon && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-(--brand-soft) text-(--brand-primary)">
            <Icon size={14} />
          </span>
        )}
        <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">{title}</h3>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </Card>
  )
}

function Dot({ color }) {
  return <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
}

function renderLegend(value) {
  return <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: 11 }}>{value}</span>
}

export default function AccountSummary({ accountId, currency = 'MXN', dateFrom, dateTo }) {
  const { data, isLoading, isError, refetch } = useAccountSummary(accountId, { dateFrom, dateTo })

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((index) => (
            <div key={index} className="h-[72px] rounded-xl bg-[hsl(var(--muted))] animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 h-64 rounded-xl bg-[hsl(var(--muted))] animate-pulse" />
          <div className="h-64 rounded-xl bg-[hsl(var(--muted))] animate-pulse" />
        </div>
        <div className="h-48 rounded-xl bg-[hsl(var(--muted))] animate-pulse" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-6">
        <ErrorState description="No se pudo cargar el resumen." onRetry={refetch} />
      </div>
    )
  }

  const { kpis = {}, balance_series = [], by_category = [], by_month = [] } = data ?? {}
  const totalIng = Number(kpis.total_deposito ?? 0)
  const totalEgr = Number(kpis.total_retiro ?? 0)
  const areaData = balance_series.map((row) => ({ fecha: row.fecha, balance: Number(row.balance) }))
  const pieData = [
    { name: 'Ingreso', value: totalIng, fill: C_INCOME },
    { name: 'Egreso', value: totalEgr, fill: C_EXPENSE },
  ].filter((entry) => entry.value > 0)
  const barData = by_category.map((row) => ({
    categoria: row.category_name,
    Ingreso: Number(row.deposito),
    Egreso: Number(row.retiro),
  }))
  const hasData = areaData.length > 1 || barData.length > 0

  // Top 5 categories by combined volume, remainder folded into "Otras" — a
  // client-side reshape of the same by_category data the "Por categoria"
  // section already uses, no extra query.
  const TOP_CATEGORY_COUNT = 5
  const sortedByCategory = [...by_category].sort(
    (a, b) => (Number(b.deposito) + Number(b.retiro)) - (Number(a.deposito) + Number(a.retiro)),
  )
  const topCategoryRows = sortedByCategory.slice(0, TOP_CATEGORY_COUNT)
  const restCategoryRows = sortedByCategory.slice(TOP_CATEGORY_COUNT)
  const otherCategoryRow = restCategoryRows.length > 0
    ? {
      category_name: 'Otras',
      deposito: restCategoryRows.reduce((sum, row) => sum + Number(row.deposito), 0),
      retiro: restCategoryRows.reduce((sum, row) => sum + Number(row.retiro), 0),
    }
    : null
  const topCategoryData = [...topCategoryRows, ...(otherCategoryRow ? [otherCategoryRow] : [])].map((row) => ({
    categoria: row.category_name,
    Ingreso: Number(row.deposito),
    Egreso: Number(row.retiro),
  }))
  const topCategoryH = Math.max(180, topCategoryData.length * 52 + 32)

  const monthData = by_month.map((row) => ({
    month: row.month,
    Ingreso: Number(row.deposito),
    Egreso: Number(row.retiro),
  }))

  const barH = Math.max(180, barData.length * 52 + 32)

  return (
    <div className="p-6 overflow-y-auto h-full space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Saldo inicial" value={kpis.opening_balance} currency={currency} icon={Wallet} tone="neutral" />
        <KpiCard label="Saldo actual" value={kpis.current_balance} currency={currency} icon={TrendingUp} tone="brand" />
        <KpiCard label="Total ingresos" value={kpis.total_deposito} currency={currency} icon={ArrowDownLeft} tone="success" />
        <KpiCard label="Total egresos" value={kpis.total_retiro} currency={currency} icon={ArrowUpRight} tone="destructive" />
      </div>

      {!hasData && (
        <Card variant="solid" className="rounded-xl py-16 text-center text-sm text-[hsl(var(--muted-foreground))]">
          Agrega movimientos para ver estadísticas.
        </Card>
      )}

      {(areaData.length > 1 || pieData.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {areaData.length > 1 && (
            <Section
              title="Saldo en el tiempo"
              icon={LineChart}
              aside={(
                <span className="text-xs font-mono font-bold text-(--brand-primary) bg-(--brand-soft) px-2.5 py-1 rounded-full">
                  {fmt(kpis.current_balance, currency)}
                </span>
              )}
            >
              <div className="lg:col-span-2">
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={areaData} margin={{ top: 4, right: 8, left: 0, bottom: 36 }}>
                    <defs>
                      <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C_BALANCE} stopOpacity={0.18} />
                        <stop offset="100%" stopColor={C_BALANCE} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} />
                    <XAxis
                      dataKey="fecha"
                      tickFormatter={fmtDay}
                      tick={{ fontSize: 10, fill: C_MUTED }}
                      tickLine={false}
                      axisLine={{ stroke: C_BORDER }}
                      angle={-30}
                      textAnchor="end"
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickFormatter={fmtCompact}
                      tick={{ fontSize: 10, fill: C_MUTED }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                    />
                    <Tooltip content={<BalanceTip currency={currency} />} cursor={{ stroke: C_BORDER, strokeWidth: 1 }} />
                    <Area
                      type="monotone"
                      dataKey="balance"
                      stroke={C_BALANCE}
                      strokeWidth={2.5}
                      fill="url(#balGrad)"
                      dot={false}
                      activeDot={{ r: 5, strokeWidth: 0, fill: C_BALANCE }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Section>
          )}

          {pieData.length > 0 && (
            <Section title="Distribucion" icon={PieChartIcon}>
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="42%"
                    innerRadius={52}
                    outerRadius={74}
                    paddingAngle={3}
                    cornerRadius={5}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {pieData.map((entry) => (
                      <Cell key={`${entry.name}-${entry.fill}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <text x="50%" y="42%" textAnchor="middle" dominantBaseline="middle">
                    <tspan x="50%" dy="-0.55em" style={{ fontSize: 10, fill: C_MUTED }}>
                      Flujo neto
                    </tspan>
                    <tspan
                      x="50%"
                      dy="1.4em"
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        fill: totalIng >= totalEgr ? C_INCOME : C_EXPENSE,
                        fontFamily: 'monospace',
                      }}
                    >
                      {fmtCompact(totalIng - totalEgr)}
                    </tspan>
                  </text>
                  <Tooltip content={<PieTip currency={currency} />} />
                  <Legend iconType="circle" iconSize={8} formatter={renderLegend} wrapperStyle={{ paddingTop: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </Section>
          )}
        </div>
      )}

      {barData.length > 0 && (
        <Section
          title="Por categoria"
          icon={BarChart3}
          aside={(
            <div className="flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
              <span className="flex items-center gap-1.5"><Dot color={C_INCOME} />Ingreso</span>
              <span className="flex items-center gap-1.5"><Dot color={C_EXPENSE} />Egreso</span>
            </div>
          )}
        >
          <ResponsiveContainer width="100%" height={barH}>
            <BarChart
              data={barData}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
              barCategoryGap="28%"
              barGap={3}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={fmtCompact}
                tick={{ fontSize: 10, fill: C_MUTED }}
                tickLine={false}
                axisLine={{ stroke: C_BORDER }}
              />
              <YAxis
                type="category"
                dataKey="categoria"
                width={110}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<CategoryTip currency={currency} />} cursor={{ fill: 'hsl(var(--muted) / 0.15)' }} />
              <Bar dataKey="Ingreso" fill={C_INCOME} radius={[0, 4, 4, 0]} />
              <Bar dataKey="Egreso" fill={C_EXPENSE} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
      )}

      {topCategoryData.length > 0 && (
        <Section
          title="Top categorias"
          icon={Layers}
          aside={(
            <div className="flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
              <span className="flex items-center gap-1.5"><Dot color={C_INCOME} />Ingreso</span>
              <span className="flex items-center gap-1.5"><Dot color={C_EXPENSE} />Egreso</span>
            </div>
          )}
        >
          <ResponsiveContainer width="100%" height={topCategoryH}>
            <BarChart
              data={topCategoryData}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
              barCategoryGap="28%"
              barGap={3}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={fmtCompact}
                tick={{ fontSize: 10, fill: C_MUTED }}
                tickLine={false}
                axisLine={{ stroke: C_BORDER }}
              />
              <YAxis
                type="category"
                dataKey="categoria"
                width={110}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<CategoryTip currency={currency} />} cursor={{ fill: 'hsl(var(--muted) / 0.15)' }} />
              <Bar dataKey="Ingreso" fill={C_INCOME} radius={[0, 4, 4, 0]} />
              <Bar dataKey="Egreso" fill={C_EXPENSE} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
      )}

      {monthData.length > 0 && (
        <Section
          title="Ingresos vs egresos por mes"
          icon={CalendarRange}
          aside={(
            <div className="flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
              <span className="flex items-center gap-1.5"><Dot color={C_INCOME} />Ingreso</span>
              <span className="flex items-center gap-1.5"><Dot color={C_EXPENSE} />Egreso</span>
            </div>
          )}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={monthData}
              margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
              barCategoryGap="24%"
              barGap={3}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={fmtMonth}
                tick={{ fontSize: 10, fill: C_MUTED }}
                tickLine={false}
                axisLine={{ stroke: C_BORDER }}
              />
              <YAxis
                tickFormatter={fmtCompact}
                tick={{ fontSize: 10, fill: C_MUTED }}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <Tooltip content={<MonthTip currency={currency} />} cursor={{ fill: 'hsl(var(--muted) / 0.15)' }} />
              <Bar dataKey="Ingreso" fill={C_INCOME} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Egreso" fill={C_EXPENSE} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
      )}
    </div>
  )
}
