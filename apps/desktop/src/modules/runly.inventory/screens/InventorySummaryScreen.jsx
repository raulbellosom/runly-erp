import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState, ErrorState } from '@runly/ui'
import { ClipboardCheck, List, ShieldCheck } from 'lucide-react'
import { useInventoryCan, useInventoryDashboard } from '../hooks/useInventoryAdmin.js'
import { reasonLabel } from '../lib/admin-status.js'
import { InventoryAdminTransitionDialog } from '../components/InventoryAdminTransitionDialog.jsx'
import { VIZ_VARS, Panel } from '../components/dashboard/dashboard-theme.jsx'
import { HeroStatus } from '../components/dashboard/HeroStatus.jsx'
import { MetricTiles } from '../components/dashboard/MetricTiles.jsx'
import { ChartsSkeleton, HoldersPanel } from '../components/dashboard/DashboardCharts.jsx'
import { TimelinePanel } from '../components/dashboard/TimelinePanel.jsx'
import { GaugesPanel } from '../components/dashboard/GaugesPanel.jsx'
import { DistributionPanel } from '../components/dashboard/DistributionPanel.jsx'
import { TypeRadarPanel } from '../components/dashboard/TypeRadarPanel.jsx'

const LIST_PATH = '/app/m/runly.inventory/inventory'
const formatDay = (value) => { const [y, m, d] = String(value).slice(0, 10).split('-'); return `${d}/${m}/${y}` }

// Module landing page. One loud element (the status hero), metrics with small
// visuals, then large interactive charts: a timeline (weeks/months, series,
// bars/lines/areas, zoom, click-to-inspect), health gauges, an explorable
// distribution (donut/pie/bars/mosaic by any dimension), a radar per type,
// people, warranties and the baja queue.
export default function InventorySummaryScreen() {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useInventoryDashboard(12)
  const can = useInventoryCan()
  const [review, setReview] = useState(null)
  const go = (params) => navigate(`${LIST_PATH}?${new URLSearchParams(params)}`)
  const canDecide = can('inventory.item.deregister')

  if (isError) {
    return (
      <div className="min-h-dvh p-4 md:p-6">
        <ErrorState title="No se pudo cargar el dashboard" description="Revisa tu conexión o que el servidor tenga las migraciones aplicadas, y vuelve a intentar." onRetry={refetch} />
      </div>
    )
  }

  return (
    <div className={`min-h-dvh space-y-5 p-4 md:p-6 ${VIZ_VARS}`}>
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => navigate(LIST_PATH)}><List className="mr-2 h-4 w-4" />Ver inventario</Button>
      </div>

      <HeroStatus data={data} isLoading={isLoading} onSelect={(value) => go({ adminStatus: value })} />
      <MetricTiles data={data} isLoading={isLoading} go={go} />

      <TimelinePanel onOpenList={go} />

      {isLoading || !data ? <ChartsSkeleton /> : (
        <>
          <GaugesPanel data={data} go={go} />
          <DistributionPanel data={data} onOpenList={go} />

          <div className="grid gap-4 xl:grid-cols-2">
            <TypeRadarPanel rows={data.typeProfile ?? []} />
            <HoldersPanel rows={data.top.holders} assignedTotal={data.assignedCount} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Bajas por autorizar" subtitle={canDecide ? 'Las más antiguas primero' : 'Las decide quien puede autorizar bajas'} icon={ClipboardCheck} tone="#d97706">
              {!data.pendingProposals.length ? (
                <EmptyState icon={ClipboardCheck} title="Todo al día" description="No hay propuestas de baja pendientes." />
              ) : (
                <ul className="space-y-2">
                  {data.pendingProposals.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-[hsl(var(--muted))]/35 p-3">
                      <button type="button" onClick={() => navigate(`${LIST_PATH}/${item.id}`)} className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-medium hover:underline">{item.name}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">{item.assetTag}{item.deregistrationReason ? `, ${reasonLabel(item.deregistrationReason).toLowerCase()}` : ''}</p>
                      </button>
                      {canDecide ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setReview({ action: 'reject_deregistration', item })}>Rechazar</Button>
                          <Button size="sm" variant="destructive" onClick={() => setReview({ action: 'approve_deregistration', item })}>Autorizar</Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                  {data.byAdminStatus.deregistration_proposed > data.pendingProposals.length ? (
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => go({ adminStatus: 'deregistration_proposed' })}>Ver todas las propuestas</Button>
                  ) : null}
                </ul>
              )}
            </Panel>
            <Panel title="Garantías próximas" subtitle={data.warranties.expired ? `${data.warranties.expired} ya vencidas` : 'Ninguna vencida'} icon={ShieldCheck} tone="#f59e0b">
              {!data.warranties.upcoming.length ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">No hay garantías próximas registradas.</p>
              ) : (
                <ul className="space-y-1">
                  {data.warranties.upcoming.map((item) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => navigate(`${LIST_PATH}/${item.id}`)}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-[hsl(var(--muted))]/50">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                        <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                        <span className="shrink-0 tabular-nums text-[hsl(var(--muted-foreground))]">{formatDay(item.warrantyExpiry)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}

      <InventoryAdminTransitionDialog action={review?.action} itemId={review?.item.id}
        itemLabel={review ? `${review.item.name} (${review.item.assetTag})` : ''}
        open={Boolean(review)} onOpenChange={(open) => { if (!open) setReview(null) }} />
    </div>
  )
}
