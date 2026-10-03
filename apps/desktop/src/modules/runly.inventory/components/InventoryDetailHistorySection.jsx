import { AuditTrail } from '@runly/ui'
import { INVENTORY_ACTIVITY_FIELD_LABELS } from '../lib/activity-field-labels.js'

// Registry key: runly.inventory:HistorySection — the item's audit trail.
export default function InventoryDetailHistorySection({ data, apiBaseUrl, token, companyId }) {
  return (
    <AuditTrail
      apiBaseUrl={apiBaseUrl}
      token={token}
      companyId={companyId}
      entityType="InvItem"
      entityId={data?.id}
      emptyMessage="Sin cambios registrados para este activo."
      changeLabels={INVENTORY_ACTIVITY_FIELD_LABELS}
    />
  )
}
