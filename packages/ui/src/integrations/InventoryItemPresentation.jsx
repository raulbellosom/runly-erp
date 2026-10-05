import { RunlyDetail } from '../runly-renderer/RunlyDetail.jsx'
import { INVENTORY_ITEM_DETAIL } from './inventory/detail-blueprint.js'
import { buildItemFormBlueprint } from './inventory/form-blueprint.js'

// Same blueprints as the ERP. The portable slice explicitly omits private
// file/business slots; it is never advertised as the full inventory application.
export function inventoryPresentationBlueprint(kind, { simulated = false, isEdit = true } = {}) {
  const blueprint = kind === 'FORM' ? buildItemFormBlueprint(isEdit) : INVENTORY_ITEM_DETAIL
  if (!simulated) return blueprint
  const result = structuredClone(blueprint)
  delete result.schema.hero?.imageDocsPath
  delete result.schema.preview?.imageDocsPath
  result.schema.sections = result.schema.sections.filter(section => !section.type)
    .map(section => ({ ...section, fields: section.fields?.filter(field => field.type !== 'relation') }))
  return result
}

export function InventoryItemPresentation({ simulated = false, ...props }) {
  return <RunlyDetail blueprint={inventoryPresentationBlueprint('DETAIL', { simulated })} {...props} />
}
