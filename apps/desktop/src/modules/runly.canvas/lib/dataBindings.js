// Objects bound to ERP records (properties.binding = { source, id }).
export const BINDABLE_TYPES = new Set(['rectangle', 'ellipse', 'polygon', 'text', 'hotspot'])
export const canBind = (object) => BINDABLE_TYPES.has(object?.type)
export const bindingKey = (binding) => (binding?.source && binding?.id ? `${binding.source}:${binding.id}` : null)

// Unique { source, id } refs of persisted (non-pending) bound rows, in first
// occurrence order — the same record bound to several objects resolves once.
export function bindingRefs(rows) {
  const seen = new Map()
  for (const row of rows) {
    const binding = row.properties?.binding, key = bindingKey(binding)
    if (key && !row.pending && !seen.has(key)) seen.set(key, { source: binding.source, id: binding.id })
  }
  return [...seen.values()]
}

// Lucide icon (kebab name, see engine/icons.js) per data source, drawn in
// the object's data badge so the record type reads at a glance.
export const SOURCE_ICONS = Object.freeze({
  task: 'list-checks', project: 'folder-kanban', contact: 'contact', hr_employee: 'user-round', vehicle: 'car',
  inventory_item: 'package', inventory_location: 'warehouse', calendar_event: 'calendar', ledger_account: 'wallet',
  file: 'file-text', pos_table: 'utensils',
})
export const sourceIcon = (source) => SOURCE_ICONS[source] ?? 'database'

// Only a real status (inventory, POS…) colours the shape; sources that
// report no status resolve as 'neutral', and painting them grey would just
// override the user's colours. The user can also opt out (binding.tint).
export const hasStatusTone = (data) => Boolean(data?.tone && data.tone !== 'neutral')
export const statusTintOf = (binding, data) => (binding?.tint !== false && hasStatusTone(data) ? data.tone : null)

export function chunk(list, size) {
  const out = []
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size))
  return out
}
