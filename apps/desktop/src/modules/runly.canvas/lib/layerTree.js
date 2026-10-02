// Pure helpers that turn flat layers/objects rows into the tree the Layers
// panel renders (top-most first, matching paint order) and back into the
// position/layerId patches a drag-and-drop move needs.
//
// Paint order convention (shared with screens/BoardEditor.jsx): within a
// layer, ascending `position` paints bottom-first, so the top-most element
// (the one the user sees in front) has the highest `position`. Tree order is
// the reverse of that: top-most first.

export function buildLayerTree(layers, rows) {
  const byLayer = new Map()
  for (const row of rows) {
    const list = byLayer.get(row.layerId)
    if (list) list.push(row)
    else byLayer.set(row.layerId, [row])
  }
  const sortedLayers = [...layers].sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
  return sortedLayers.map((layer) => ({
    ...layer,
    elements: (byLayer.get(layer.id) ?? []).sort((a, b) =>
      (b.position ?? 0) - (a.position ?? 0) || new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0)),
  }))
}

// Computes the minimal `{ id, position, layerId? }` patches for dropping
// element `id` into `layerId` at tree index `index` (0 = top). The whole
// destination layer is renumbered — top of the tree order gets the highest
// position — but only elements whose position (or layer) actually changes
// are returned, so a drop that does not reorder anything emits nothing.
export function moveElement(rows, id, { layerId, index }) {
  const moved = rows.find((row) => row.id === id)
  if (!moved) return []
  const destination = rows
    .filter((row) => row.layerId === layerId && row.id !== id)
    .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
  const order = [...destination]
  order.splice(Math.max(0, Math.min(index, order.length)), 0, moved)
  const count = order.length
  const patches = []
  order.forEach((row, treeIndex) => {
    const position = count - treeIndex
    const layerChanged = row.layerId !== layerId
    if (position !== row.position || layerChanged) {
      const patch = { id: row.id, position }
      if (layerChanged) patch.layerId = layerId
      patches.push(patch)
    }
  })
  return patches
}

// The Layers panel shows layers top-most first (same convention as the
// tree); the API stores/paints them bottom-first, so persisting a drag
// reorder needs the list reversed back.
export function reorderedLayerIds(visualOrder) {
  return [...visualOrder].reverse()
}
