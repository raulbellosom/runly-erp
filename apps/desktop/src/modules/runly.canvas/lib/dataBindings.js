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

export function chunk(list, size) {
  const out = []
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size))
  return out
}
