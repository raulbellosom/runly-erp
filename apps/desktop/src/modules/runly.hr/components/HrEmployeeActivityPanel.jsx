// Registry key: runly.hr:HistorySection
// Props (RunlyDetail "component" section contract): { data, token }
import { ActivityTimeline } from "@runly/ui";
import { runly } from "../../../lib/runly";
import { HR_EMPLOYEE_ACTIVITY_FIELD_LABELS } from "../lib/activity-field-labels.js";

export default function HrEmployeeActivityPanel({ data, token }) {
  return (
    <ActivityTimeline
      sdk={runly}
      token={token}
      entityType="HrEmployee"
      entityId={data?.id}
      limit={50}
      heightClass="max-h-[480px]"
      emptyMessage="Sin actividad registrada para este colaborador."
      changeLabels={HR_EMPLOYEE_ACTIVITY_FIELD_LABELS}
    />
  );
}
