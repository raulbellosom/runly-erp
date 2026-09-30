import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BadgeCheck, CheckCircle2 } from 'lucide-react'
import { Button, EmptyState, ErrorState, PageHeader, SegmentedControl, Skeleton } from '@runly/ui'
import { useApprovals, useCapabilities, useDecideApproval, usePurchasesCan } from '../hooks/usePurchases.js'
import { ROOT, STATUS, kindOf } from '../lib/purchases-constants.js'
import { formatDate, formatMoney } from '../lib/format.js'
import { PurchaseStatusBadge } from '../components/PurchaseStatusBadge.jsx'
import { TransitionConfirmDialog } from '../components/detail/TransitionConfirmDialog.jsx'

const FILTERS = [
  { value: 'PENDING', label: 'Pendientes' },
  { value: 'APPROVED', label: 'Aprobadas' },
  { value: 'REJECTED', label: 'Rechazadas' },
]
const OWNER_LABEL = { orders: 'Orden de compra', invoices: 'Factura', requests: 'Solicitud' }
const REJECT = {
  action: 'reject', label: 'Rechazar', tone: 'danger',
  confirm: { title: 'Rechazar', description: 'Explica el motivo; queda en el historial del documento.', comment: true, confirmLabel: 'Rechazar' },
}
const APPROVE = {
  action: 'approve', label: 'Aprobar', tone: 'primary',
  confirm: { title: 'Aprobar', description: 'Puedes dejar un comentario para quien lo solicitó.', comment: true, confirmLabel: 'Aprobar' },
}

// Approvals inbox: every document waiting for a decision, oldest first.
export default function PurchaseApprovalsScreen() {
  const navigate = useNavigate()
  const caps = useCapabilities()
  const can = usePurchasesCan()
  const [status, setStatus] = useState('PENDING')
  const query = useApprovals({ status })
  const decide = useDecideApproval()
  const [pending, setPending] = useState(null)
  const rows = query.data?.data ?? []
  const canDecide = can('purchases.approval.decide')

  if (!caps.isLoading && !caps.has('approvals')) {
    return <div className="min-h-dvh p-4 md:p-6"><EmptyState icon={BadgeCheck} title="Las aprobaciones no están activas" description="Actívalas en Configuración si un responsable debe autorizar las compras." /></div>
  }

  return (
    <div className="min-h-dvh space-y-5 p-4 md:p-6">
      <PageHeader eyebrow="Compras" title="Aprobaciones" description="Documentos que esperan la decisión de un responsable, según tu política de compras." />
      <SegmentedControl ariaLabel="Estado" options={FILTERS} value={status} onChange={setStatus} className="w-full sm:w-auto" />

      {query.isError ? <ErrorState title="No se pudieron cargar las aprobaciones" onRetry={() => query.refetch()} /> : query.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : !rows.length ? (
        <EmptyState icon={CheckCircle2} title={status === 'PENDING' ? 'Nada por decidir' : 'Sin registros'} description={status === 'PENDING' ? 'Cuando un documento requiera autorización aparecerá aquí.' : 'No hay decisiones con este estado.'} />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const kind = row.ownerKind ?? kindOf(row.ownerType) ?? 'orders'
            return (
              <li key={row.id} className="flex flex-col gap-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm md:flex-row md:items-center">
                <span className="hidden h-12 w-1 shrink-0 rounded-full bg-violet-500 md:block" />
                <button type="button" onClick={() => navigate(`${ROOT}/${kind}/${row.ownerId}`)} className="min-w-0 flex-1 text-left">
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">{OWNER_LABEL[kind] ?? 'Documento'}</span>
                  <span className="block truncate text-lg font-semibold tabular-nums hover:underline">{row.ownerNumber ?? 'Documento'}{row.ownerTitle ? <span className="ml-2 text-sm font-normal text-[hsl(var(--muted-foreground))]">{row.ownerTitle}</span> : null}</span>
                  <span className="block truncate text-sm text-[hsl(var(--muted-foreground))]">
                    {[row.supplierName, row.reason ?? 'Requiere autorización', formatDate(row.createdAt)].filter(Boolean).join('. ')}
                  </span>
                  {row.comment ? <span className="mt-1 block text-sm italic text-[hsl(var(--muted-foreground))]">{row.comment}</span> : null}
                </button>
                <div className="flex items-center justify-between gap-4 md:justify-end">
                  {row.ownerTotal != null ? <span className="text-lg font-semibold tabular-nums">{formatMoney(row.ownerTotal, row.currency)}</span> : null}
                  {row.status === 'PENDING' && canDecide ? (
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setPending({ row, action: REJECT })}>Rechazar</Button>
                      <Button onClick={() => setPending({ row, action: APPROVE })}>Aprobar</Button>
                    </div>
                  ) : <PurchaseStatusBadge kind="approvals" status={row.status} label={STATUS.approvals[row.status]?.label} />}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <TransitionConfirmDialog action={pending?.action} open={Boolean(pending)} onOpenChange={(o) => { if (!o) setPending(null) }} loading={decide.isPending}
        onConfirm={({ comment }) => decide.mutate(
          { id: pending.row.id, decision: pending.action.action === 'approve' ? 'APPROVED' : 'REJECTED', comment },
          { onSuccess: () => setPending(null) },
        )} />
    </div>
  )
}
