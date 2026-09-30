import { useNavigate } from 'react-router-dom'
import { Button, ErrorState } from '@runly/ui'
import { ClipboardList, FileQuestion, ReceiptText } from 'lucide-react'
import { useCapabilities, usePurchasesCan, usePurchasesDashboard } from '../hooks/usePurchases.js'
import { KINDS, ROOT } from '../lib/purchases-constants.js'
import { PipelineHero, STAGE_ROUTE } from '../components/dashboard/PipelineHero.jsx'
import { MetricTiles } from '../components/dashboard/MetricTiles.jsx'
import { AttentionPanel } from '../components/dashboard/AttentionPanel.jsx'
import { ChartsSkeleton, RecentPanel, SpendTrendPanel, SupplierRankingPanel } from '../components/dashboard/DashboardCharts.jsx'

// Module landing page: the process as a track (hero), headline figures,
// then one chart per question (trend, who we buy from, what is waiting).
export default function PurchasesDashboard() {
  const navigate = useNavigate()
  const dashboard = usePurchasesDashboard()
  const caps = useCapabilities()
  const can = usePurchasesCan()
  const go = (section) => navigate(`${ROOT}/${section}`)
  const open = (kind, id) => navigate(`${ROOT}/${kind}/${id}`)
  const isLoading = dashboard.isLoading || caps.isLoading
  const data = dashboard.data

  if (dashboard.isError) {
    return (
      <div className="min-h-dvh p-4 md:p-6">
        <ErrorState title="No se pudo cargar Compras" description="Revisa tu conexión o que el servidor tenga las migraciones aplicadas, y vuelve a intentar." onRetry={dashboard.refetch} />
      </div>
    )
  }

  const createActions = [
    caps.has('requests') && can(KINDS.requests.create) && { kind: 'requests', icon: FileQuestion },
    caps.has('purchaseOrders') && can(KINDS.orders.create) && { kind: 'orders', icon: ClipboardList },
    caps.has('invoices') && can(KINDS.invoices.create) && { kind: 'invoices', icon: ReceiptText },
  ].filter(Boolean)

  const actions = createActions.map(({ kind, icon: Icon }, index) => (
    <Button key={kind} onClick={() => navigate(`${ROOT}/${kind}/new`)}
      className={index === createActions.length - 1 ? 'bg-white text-teal-900 hover:bg-white/90' : 'border border-white/30 bg-white/10 text-white hover:bg-white/20'}>
      <Icon className="h-4 w-4" />{KINDS[kind].newLabel}
    </Button>
  ))

  return (
    <div className="min-h-dvh space-y-5 p-4 md:p-6">
      <PipelineHero data={data} stages={caps.stages} preset={caps.data?.preset} ordersEnabled={caps.has('purchaseOrders')}
        isLoading={isLoading} actions={actions.length ? actions : null}
        onStage={(stage) => { const route = STAGE_ROUTE[stage.type]; if (route) go(route) }} />

      <MetricTiles data={data} isLoading={isLoading} has={caps.has} go={go} />

      {isLoading || !data ? <ChartsSkeleton /> : (
        <>
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2"><SpendTrendPanel monthly={data.monthly} showOrdered={caps.has('purchaseOrders')} /></div>
            <AttentionPanel attention={data.attention} has={caps.has} onOpen={open} onSeeAll={go} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <SupplierRankingPanel rows={data.topSuppliers} onSelect={(row) => go(`suppliers/${row.id}`)} />
            <RecentPanel rows={data.recent} onOpen={open} />
          </div>
        </>
      )}
    </div>
  )
}
