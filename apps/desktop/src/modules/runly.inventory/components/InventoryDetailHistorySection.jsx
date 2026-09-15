import { ActivityTimeline } from '@runly/ui'
import { runly } from '../../../lib/runly'
import { INVENTORY_ACTIVITY_FIELD_LABELS } from '../lib/activity-field-labels.js'

export default function InventoryDetailHistorySection({ data, token }) {
  return (
    <ActivityTimeline
      sdk={runly}
      token={token}
      entityType="InvItem"
      entityId={data?.id}
      limit={50}
      heightClass="max-h-[480px]"
      emptyMessage="Sin actividad registrada para este activo."
      changeLabels={INVENTORY_ACTIVITY_FIELD_LABELS}
    />
  )
}
