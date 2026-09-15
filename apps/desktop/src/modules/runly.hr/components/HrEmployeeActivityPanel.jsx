import { ActivityTimeline } from "@runly/ui";
import { runly } from "../../../lib/runly";
import { HR_EMPLOYEE_ACTIVITY_FIELD_LABELS } from "../lib/activity-field-labels.js";

/**
 * Embeddable activity panel for HR Employee detail.
 * Shows the activity stream filtered to this employee entity.
 */
export default function HrEmployeeActivityPanel({ employeeId, token }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
        <h3 className="text-sm font-semibold">Actividad reciente</h3>
      </div>
      <ActivityTimeline
        sdk={runly}
        token={token}
        entityType="HrEmployee"
        entityId={employeeId}
        limit={50}
        heightClass="max-h-[480px]"
        emptyMessage="Sin actividad registrada para este colaborador."
        changeLabels={HR_EMPLOYEE_ACTIVITY_FIELD_LABELS}
      />
    </div>
  );
}
