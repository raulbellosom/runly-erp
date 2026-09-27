import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, List, Sigma } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/Card.jsx'
import { EmptyState } from '../components/EmptyState.jsx'
import { ErrorState } from '../components/ErrorState.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { Skeleton } from '../components/Skeleton.jsx'
import { StatCard } from '../components/StatCard.jsx'

const CHART_COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))']

function formatValue(value, format = 'number', currency = 'MXN') {
  const numeric = Number(value ?? 0)
  if (format === 'currency') return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(numeric)
  if (format === 'percentage') return new Intl.NumberFormat('es-MX', { style: 'percent', maximumFractionDigits: 1 }).format(numeric / 100)
  return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(numeric)
}

function WidgetFrame({ title, children }) {
  return <Card variant="solid" className="h-full overflow-hidden"><CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent>{children}</CardContent></Card>
}

function ChartWidget({ widget, data }) {
  const rows = data?.rows ?? []
  if (!rows.length) return <WidgetFrame title={widget.title ?? widget.label}><EmptyState variant="compact" icon={BarChart3} title="No hay datos para mostrar" /></WidgetFrame>
  const axes = <><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip /></>
  let chart
  if (widget.chart === 'line') chart = <LineChart data={rows}>{axes}<Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} /></LineChart>
  else if (widget.chart === 'pie' || widget.chart === 'donut') chart = <PieChart><Tooltip /><Pie data={rows} dataKey="value" nameKey="label" innerRadius={widget.chart === 'donut' ? 58 : 0} outerRadius={88} paddingAngle={2}>{rows.map((row, index) => <Cell key={row.label} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie></PieChart>
  else chart = <BarChart data={rows}>{axes}<Bar dataKey="value" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} /></BarChart>
  return <WidgetFrame title={widget.title ?? widget.label}><div className="h-64 min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0}>{chart}</ResponsiveContainer></div></WidgetFrame>
}

function ListWidget({ widget, data }) {
  const rows = data?.rows ?? []
  if (!rows.length) return <WidgetFrame title={widget.title ?? widget.label}><EmptyState variant="compact" icon={List} title="No hay registros para mostrar" /></WidgetFrame>
  return <WidgetFrame title={widget.title ?? widget.label}><div className="divide-y divide-[hsl(var(--border))]">{rows.map((row) => <div key={row.id} className="py-3 first:pt-0 last:pb-0"><p className="truncate text-sm font-medium text-[hsl(var(--foreground))]">{row[widget.display?.titleField] ?? row.id}</p>{widget.display?.subtitleField && <p className="mt-0.5 truncate text-xs text-[hsl(var(--muted-foreground))]">{row[widget.display.subtitleField]}</p>}</div>)}</div></WidgetFrame>
}

function Widget({ widget, result, loading, retry, queryError }) {
  if (loading) return <Card variant="solid" className="h-full p-5"><Skeleton className="h-3 w-28" /><Skeleton className="mt-5 h-24 w-full" /></Card>
  if (queryError) return <ErrorState className="h-full py-8" title={widget.title ?? widget.label} description="No se pudo consultar el dashboard." onRetry={retry} />
  if (result?.status === 'error') return <ErrorState className="h-full py-8" title={widget.title ?? widget.label} description={result.error?.message} onRetry={retry} />
  if (widget.type === 'stat') return <StatCard label={widget.label ?? widget.title} value={formatValue(result?.data?.value, widget.format, widget.currency)} icon={Sigma} />
  if (widget.type === 'chart') return <ChartWidget widget={widget} data={result?.data} />
  return <ListWidget widget={widget} data={result?.data} />
}

export const dashboardWidgetRegistry = Object.freeze({ stat: Widget, chart: Widget, list: Widget })

export function RunlyDashboard({ blueprint, moduleKey, companyId, queryDashboard }) {
  const schema = blueprint?.schema ?? {}
  const widgets = schema.widgets ?? []
  const query = useQuery({
    queryKey: ['runly-dashboard', companyId, moduleKey, blueprint?.key, widgets.map((widget) => widget.key)],
    queryFn: () => queryDashboard({ viewKey: blueprint.key, widgets: widgets.map((widget) => widget.key) }),
    enabled: Boolean(companyId && moduleKey && blueprint?.key && queryDashboard),
    staleTime: 30_000,
  })
  return <div className="p-4 md:p-6 space-y-6"><PageHeader title={schema.title} description={schema.description} />{!widgets.length ? <EmptyState title="Dashboard vacío" description="Agrega widgets a la definición del dashboard." /> : <div className="grid grid-cols-12 gap-4 md:gap-5">{widgets.map((widget) => { const Renderer = dashboardWidgetRegistry[widget.type]; const span = widget.layout?.w ?? (widget.type === 'stat' ? 3 : 6); return <div key={widget.key} className="col-span-12 md:col-span-[var(--widget-span)]" style={{ '--widget-span': span }}>{Renderer ? <Renderer widget={widget} result={query.data?.[widget.key]} loading={query.isLoading} queryError={query.error} retry={query.refetch} /> : <ErrorState title="Widget no soportado" description={`El tipo ${widget.type} no está registrado.`} />}</div> })}</div>}</div>
}
