import { ActivityTimeline } from '@runly/ui'
import { runly } from '../../../lib/runly'

export default function InventoryDetailHistorySection({ data, token }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
        <h3 className="text-sm font-semibold">Historial de auditoría</h3>
      </div>
      <ActivityTimeline
        sdk={runly}
        token={token}
        entityType="InvItem"
        entityId={data?.id}
        limit={50}
        heightClass="max-h-[480px]"
        emptyMessage="Sin actividad registrada para este activo."
      />
    </div>
  )
}
