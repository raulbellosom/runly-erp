import { InventoryAssignmentPanel } from './InventoryAssignmentPanel.jsx'

// Adapter for RunlyDetail's "component" section type — translates the generic
// { data, apiBaseUrl, token, companyId } contract into InventoryAssignmentPanel's
// existing `item` prop, without changing that component at all.
export default function InventoryDetailAssignmentSection({ data }) {
  return <InventoryAssignmentPanel item={data} />
}
