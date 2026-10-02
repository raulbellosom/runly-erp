// Applies `canvas.changed` object deltas to a page's cached rows. The sender
// receives its own delta too; rows whose cached revision is already as new
// are left untouched, so echoes are harmless.
export function applyObjectDelta(rows = [], pageId, { upserts = [], deletedIds = [] } = {}) {
  let next = rows, changed = false
  const deleted = new Set(deletedIds)
  if (deleted.size && next.some((row) => deleted.has(row.id))) { next = next.filter((row) => !deleted.has(row.id)); changed = true }
  for (const incoming of upserts) {
    if (incoming.pageId !== pageId || incoming.deletedAt) continue
    const index = next.findIndex((row) => row.id === incoming.id)
    if (index === -1) { next = [...next, incoming]; changed = true; continue }
    const cached = next[index]
    if ((cached.revision ?? 0) >= (incoming.revision ?? 0)) continue
    next = next.map((row, i) => i === index ? { ...incoming, hotspot: incoming.hotspot ?? cached.hotspot } : row)
    changed = true
  }
  return changed ? next : rows
}

// Which cached queries a non-delta `canvas.changed` action makes stale.
const TARGETS = {
  board: ['board'], page: ['board'], layer: ['board'], layers: ['board'], collaborator: ['board'],
  hotspot: ['objects'], attachment: [], comment: [], 'entity-link': ['links'],
}
export function invalidationTargets(action = '') {
  if (action === 'version.restored') return ['board', 'objects', 'links', 'versions']
  if (action === 'version.created') return ['versions', 'board']
  const prefix = action.split('.')[0]
  return TARGETS[prefix] ?? ['board', 'objects']
}
