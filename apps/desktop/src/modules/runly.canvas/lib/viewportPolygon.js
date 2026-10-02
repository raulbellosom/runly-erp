import { worldToScreen } from '../engine/viewport.js'

// Screen-space tolerance for closing a free-drawn polygon back onto its
// first point.
export const POLYGON_CLOSE_PX = 8

// Cursor for a hovered selection handle: vertex/midpoint handles (ids
// `v:i`/`m:i`) are always a pointer; box/rotate/line-endpoint handles use the
// viewport's static id -> cursor map.
export function cursorForHandle(id, handleCursors) {
  if (id.startsWith('v:') || id.startsWith('m:')) return 'pointer'
  return handleCursors[id] ?? 'default'
}

// True when a click at `screen` should close the in-progress free polygon:
// at least three points already placed, landing back near the first one.
export function closesPolygonDraft(points, screen, viewport) {
  if (points.length < 3) return false
  const first = worldToScreen(points[0], viewport)
  return Math.hypot(screen.x - first.x, screen.y - first.y) <= POLYGON_CLOSE_PX
}
