import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Plus, ShoppingCart } from 'lucide-react'
import { Button, ConfirmDialog, EmptyState, ErrorState, Skeleton } from '@runly/ui'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'
import { PURCHASES_BASE_PATH, STAGE_ORDER, formatMoney, hasPermission } from './InventoryPurchaseMeta.js'
import { InventoryPurchaseTimeline } from './InventoryPurchaseTimeline.jsx'
import { InventoryPurchaseLinkDialog } from './InventoryPurchaseLinkDialog.jsx'

// Unwraps `{ data }` when the SDK returns the envelope.
function unwrapSummary(response) {
  if (response?.data && (response.data.timeline || response.data.capabilities)) return response.data
  return response ?? null
}

// RunlyDetail "component" section of the inventory item detail: the item's
// purchase story from runly.purchases (GET /purchases/inventory/:id/summary).
export default function InventoryPurchaseSection({ data: item }) {
  const { session, userProfile } = useAuth()
  const token = session?.access_token
  const navigate = useNavigate()
  const client = useQueryClient()
  const [linkOpen, setLinkOpen] = useState(false)
  const [unlinkDoc, setUnlinkDoc] = useState(null)
  const itemId = item?.id
  const canRead = hasPermission(userProfile, 'purchases.relation.read')
  const canManage = hasPermission(userProfile, 'purchases.relation.manage')
  const summaryKey = ['purchases', 'inventory-summary', itemId]

  const summary = useQuery({
    queryKey: summaryKey,
    queryFn: () => runly.purchases.inventorySummary(itemId, token),
    enabled: Boolean(token && itemId && canRead),
  })
  const refresh = () => client.invalidateQueries({ queryKey: summaryKey })

  const unlink = useMutation({
    mutationFn: (doc) => runly.purchases.deleteRelation(doc.relationId, token),
    onSuccess: () => {
      refresh()
      client.invalidateQueries({ queryKey: ['purchases', 'relations'] })
      setUnlinkDoc(null)
      toast.success('Relación eliminada')
    },
    onError: (error) => toast.error(error?.message ?? 'No se pudo eliminar la relación'),
  })

  const model = unwrapSummary(summary.data)
  const capabilities = model?.capabilities ?? {}
  const stages = useMemo(() => {
    const rows = (model?.timeline ?? []).filter((stage) => Array.isArray(stage?.docs) && stage.docs.length > 0)
    const rank = (key) => { const i = STAGE_ORDER.indexOf(key); return i === -1 ? STAGE_ORDER.length : i }
    return rows.map((stage, index) => ({ stage, index })).sort((a, b) => rank(a.stage.stage) - rank(b.stage.stage) || a.index - b.index).map((row) => row.stage)
  }, [model])
  const linkedIds = useMemo(() => new Set(stages.flatMap((stage) => stage.docs.map((doc) => doc.id))), [stages])

  if (!canRead || !itemId) return null
  if (summary.isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    )
  }
  if (summary.isError) {
    return <ErrorState title="No se pudieron cargar las compras" description={summary.error?.message} onRetry={() => summary.refetch()} />
  }
  if (capabilities.inventoryRelations === false) {
    return <EmptyState variant="compact" icon={ShoppingCart} title="La relación con inventario está desactivada en Compras." />
  }

  const canOrder = capabilities.purchaseOrders !== false && hasPermission(userProfile, 'purchases.order.create')
  const canInvoice = capabilities.invoices !== false && hasPermission(userProfile, 'purchases.invoice.create')
  const linkTypes = [capabilities.purchaseOrders !== false && 'order', capabilities.invoices !== false && 'invoice'].filter(Boolean)
  const canLink = canManage && linkTypes.length > 0
  const create = (kind) => navigate(`${PURCHASES_BASE_PATH}/${kind}/new?inventoryId=${encodeURIComponent(itemId)}`)
  const documentCount = linkedIds.size
  const allocated = Number(model?.allocatedAmount ?? 0)

  const actions = (canOrder || canInvoice || canLink) ? (
    <div className="space-y-2">
      {(canOrder || canInvoice) ? (
        <div className={canOrder && canInvoice ? 'grid grid-cols-2 gap-2' : 'grid gap-2'}>
          {canOrder ? <Button type="button" size="sm" variant="outline" onClick={() => create('orders')}><Plus className="mr-1.5 h-3.5 w-3.5" />Crear orden</Button> : null}
          {canInvoice ? <Button type="button" size="sm" variant="outline" onClick={() => create('invoices')}><Plus className="mr-1.5 h-3.5 w-3.5" />Crear factura</Button> : null}
        </div>
      ) : null}
      {canLink ? (
        <Button type="button" size="sm" variant="ghost" className="w-full text-teal-700 hover:text-teal-800 dark:text-teal-300" onClick={() => setLinkOpen(true)}>
          <Link2 className="mr-1.5 h-3.5 w-3.5" />Relacionar existente
        </Button>
      ) : null}
    </div>
  ) : null

  return (
    <div className="space-y-4">
      {stages.length ? (
        <>
          <div className="flex items-end justify-between gap-3 rounded-xl border border-teal-500/20 bg-linear-to-br from-teal-500/10 via-teal-500/5 to-transparent px-4 py-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-800/80 dark:text-teal-200/80">Monto asignado</p>
              <p className="truncate text-xl font-semibold tabular-nums text-[hsl(var(--foreground))]">
                {allocated > 0 ? formatMoney(allocated, model?.currency) : 'Sin monto asignado'}
              </p>
            </div>
            <p className="shrink-0 text-xs text-[hsl(var(--muted-foreground))]">
              {documentCount} {documentCount === 1 ? 'documento' : 'documentos'}
            </p>
          </div>
          <InventoryPurchaseTimeline stages={stages} onOpen={(href) => navigate(href)} onUnlink={setUnlinkDoc} canUnlink={canManage} />
          {actions}
        </>
      ) : (
        <EmptyState
          icon={ShoppingCart}
          className="gap-3 px-4 py-8"
          title="Sin compras relacionadas"
          description={(canOrder || canInvoice || canLink)
            ? 'Registra la orden o factura con la que se adquirió este activo, o relaciona un documento que ya exista en Compras.'
            : 'Este activo todavía no tiene órdenes ni facturas de Compras.'}
        >
          {actions ? <div className="w-full pt-1">{actions}</div> : null}
        </EmptyState>
      )}

      {canLink ? (
        <InventoryPurchaseLinkDialog
          open={linkOpen}
          onOpenChange={setLinkOpen}
          inventoryId={itemId}
          token={token}
          types={linkTypes}
          linkedIds={linkedIds}
          onLinked={refresh}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(unlinkDoc)}
        onOpenChange={(open) => { if (!open) setUnlinkDoc(null) }}
        title="Quitar relación"
        description={`${unlinkDoc?.number ?? 'El documento'} seguirá existiendo en Compras; solo se quitará su vínculo con este activo.`}
        confirmLabel="Quitar relación"
        loading={unlink.isPending}
        onConfirm={() => unlinkDoc && unlink.mutate(unlinkDoc)}
      />
    </div>
  )
}
