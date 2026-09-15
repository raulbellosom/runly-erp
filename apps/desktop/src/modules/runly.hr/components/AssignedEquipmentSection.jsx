// Registry key: runly.hr:AssignedEquipmentSection
// Props (RunlyDetail "component" section contract): { data }
// Thin adapter — InventoryEmployeeWidget takes `employeeId` directly (it
// predates the component-registry contract and lives in a different
// module), this just bridges the two without touching that component.
import { InventoryEmployeeWidget } from "../../runly.inventory/components/InventoryEmployeeWidget.jsx";

export default function AssignedEquipmentSection({ data }) {
  return <InventoryEmployeeWidget employeeId={data?.id} />;
}
