export const DEFAULT_VIEWPORT = Object.freeze({ x: 0, y: 0, zoom: 1, rotation: 0 })
export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 8

export function screenToWorld(point, viewport) {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom }
}

export function worldToScreen(point, viewport) {
  return { x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y }
}

export function zoomAt(viewport, screenPoint, nextZoom) {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
  const world = screenToWorld(screenPoint, viewport)
  return { ...viewport, zoom, x: screenPoint.x - world.x * zoom, y: screenPoint.y - world.y * zoom }
}

// Frames `bounds` (world units) inside a `size` (screen px) area with padding;
// never zooms in past 100% so a single small object is not blown up.
export function fitBounds(bounds, size, padding = 64) {
  if (!bounds || !size.width || !size.height) return { ...DEFAULT_VIEWPORT, x: size.width / 2 || 0, y: size.height / 2 || 0 }
  const availableW = Math.max(1, size.width - padding * 2), availableH = Math.max(1, size.height - padding * 2)
  const zoom = Math.min(1, Math.max(MIN_ZOOM, Math.min(availableW / Math.max(bounds.width, 1), availableH / Math.max(bounds.height, 1))))
  return {
    ...DEFAULT_VIEWPORT,
    zoom,
    x: size.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: size.height / 2 - (bounds.y + bounds.height / 2) * zoom,
  }
}
