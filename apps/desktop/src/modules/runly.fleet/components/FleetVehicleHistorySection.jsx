// Registry key: runly.fleet:HistorySection — the vehicle's audit trail.
// Props (RunlyDetail "component" section contract): { data, apiBaseUrl, token, companyId }
import { AuditTrail } from '@runly/ui'
import { FLEET_VEHICLE_ACTIVITY_FIELD_LABELS } from '../lib/activity-field-labels.js'

export default function FleetVehicleHistorySection({ data, apiBaseUrl, token, companyId }) {
  return (
    <AuditTrail
      apiBaseUrl={apiBaseUrl}
      token={token}
      companyId={companyId}
      entityType="Vehicle"
      entityId={data?.id}
      emptyMessage="Sin cambios registrados para este vehículo."
      changeLabels={FLEET_VEHICLE_ACTIVITY_FIELD_LABELS}
    />
  )
}
