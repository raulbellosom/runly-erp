// Editor helpers driven by the Board template (the catalog itself lives in
// the API: apps/api/src/routes/canvas/canvas-templates.js).
import { CREATION_TOOLS } from './objectFactory.js'

// Active layer when a page opens: the first drawing layer that is not the
// backdrop for inserted plans/PDFs, so new shapes land above it.
export function initialLayerId(page) {
  const layers = page?.layers ?? []
  const layer = layers.find((item) => item.type === 'vector' && !item.metadata?.mediaTarget)
    ?? layers.find((item) => item.type === 'vector')
    ?? layers[0]
  return layer?.id ?? null
}

export function mediaTargetLayer(layers) {
  return layers.find((layer) => layer.metadata?.mediaTarget) ?? null
}

// emptyState.action.kind: 'insert-media' | 'tool:<creation tool>' | 'map'
export function parseEmptyAction(kind) {
  if (kind === 'insert-media') return { type: 'insert-media' }
  if (kind === 'map') return { type: 'map' }
  const tool = typeof kind === 'string' && kind.startsWith('tool:') ? kind.slice(5) : null
  return tool && CREATION_TOOLS.has(tool) ? { type: 'tool', tool } : null
}
