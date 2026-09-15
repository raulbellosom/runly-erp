// Registry key: runly.fleet:HistorySection
// Props (RunlyDetail "component" section contract): { data, token }
import { ActivityTimeline } from '@runly/ui'
import { runly } from '../../../lib/runly'
import { FLEET_VEHICLE_ACTIVITY_FIELD_LABELS } from '../lib/activity-field-labels.js'

export default function FleetVehicleHistorySection({ data, token }) {
  return (
    <ActivityTimeline
      sdk={runly}
      token={token}
      entityType="Vehicle"
      entityId={data?.id}
      limit={50}
      heightClass="max-h-[480px]"
      emptyMessage="Sin actividad registrada para este vehículo."
      changeLabels={FLEET_VEHICLE_ACTIVITY_FIELD_LABELS}
    />
  )
}
