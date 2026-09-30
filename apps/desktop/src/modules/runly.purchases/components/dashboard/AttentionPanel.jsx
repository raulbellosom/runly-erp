import { useState } from 'react'
import { Button, EmptyState, SegmentedControl } from '@runly/ui'
import { BellRing, CheckCircle2 } from 'lucide-react'
import { Panel } from './dashboard-theme.jsx'
import { TONES, kindOf } from '../../lib/purchases-constants.js'
import { daysUntil, formatDate, formatMoney } from '../../lib/format.js'

// "What needs me now": one list per enabled queue, switched with a segmented
// control so the panel keeps a fixed footprint.
export function AttentionPanel({ attention = {}, has, onOpen, onSeeAll }) {
  const queues = [
    has('approvals') && { key: 'approvals', label: 'Aprobaciones', rows: attention.approvals ?? [], route: 'approvals', tone: TONES.violet },
    has('invoices') && { key: 'overdue', label: 'Vencidas', rows: attention.overdueInvoices ?? [], route: has('payments') ? 'payments' : 'invoices', tone: TONES.rose },
    has('receipts') && { key: 'receipts', label: 'Por recibir', rows: attention.awaitingReceipt ?? [], route: 'receipts', tone: TONES.emerald },
  ].filter(Boolean)
  const [active, setActive] = useState(queues[0]?.key)
  const queue = queues.find((q) => q.key === active) ?? queues[0]
  if (!queue) return null

  return (
    <Panel title="Requiere atención" subtitle="Lo más antiguo primero" icon={BellRing} tone={TONES.amber}>
      {queues.length > 1 ? (
        <SegmentedControl ariaLabel="Cola" value={queue.key} onChange={setActive} className="mb-3"
          options={queues.map((q) => ({ value: q.key, label: `${q.label} ${q.rows.length ? `(${q.rows.length})` : ''}`.trim() }))} />
      ) : null}
      {!queue.rows.length ? (
        <EmptyState icon={CheckCircle2} title="Todo al día" description="No hay pendientes en esta cola." />
      ) : (
        <ul className="space-y-1.5">
          {queue.rows.slice(0, 6).map((row) => {
            const kind = row.ownerKind ?? kindOf(row.ownerType ?? row.kind ?? row.type) ?? (queue.key === 'receipts' ? 'orders' : 'invoices')
            const targetId = row.ownerId ?? row.id
            const due = row.dueDate ? daysUntil(row.dueDate) : null
            return (
              <li key={row.id}>
                <button type="button" onClick={() => onOpen(kind, targetId)}
                  className="flex w-full items-center gap-3 rounded-xl bg-[hsl(var(--muted))]/35 px-3 py-2 text-left transition-colors hover:bg-[hsl(var(--muted))]/70">
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: queue.tone }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium tabular-nums">{row.number ?? row.ownerNumber ?? 'Documento'}</span>
                    <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">
                      {row.supplierName || row.reason || 'Sin proveedor'}
                      {due != null ? `, venció hace ${Math.abs(due)} ${Math.abs(due) === 1 ? 'día' : 'días'}` : row.expectedDate ? `, esperada ${formatDate(row.expectedDate)}` : ''}
                    </span>
                  </span>
                  {(row.ownerTotal ?? row.total) != null ? <span className="shrink-0 text-sm font-medium tabular-nums">{formatMoney(row.ownerTotal ?? row.total, row.currency)}</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => onSeeAll(queue.route)}>Ver todo</Button>
    </Panel>
  )
}
