// Registry key: runly.hr:HistorySection — the employee's audit trail.
// Props (RunlyDetail "component" section contract): { data, apiBaseUrl, token, companyId }
import { AuditTrail } from "@runly/ui";
import { HR_EMPLOYEE_ACTIVITY_FIELD_LABELS } from "../lib/activity-field-labels.js";

export default function HrEmployeeActivityPanel({ data, apiBaseUrl, token, companyId }) {
  return (
    <AuditTrail
      apiBaseUrl={apiBaseUrl}
      token={token}
      companyId={companyId}
      entityType="HrEmployee"
      entityId={data?.id}
      emptyMessage="Sin cambios registrados para este colaborador."
      changeLabels={HR_EMPLOYEE_ACTIVITY_FIELD_LABELS}
    />
  );
}
