// Uniform scaling of a multi-selection (e.g. a library item inserted as many
// shapes) from one corner of its bounding box, the opposite corner staying
// fixed. Uniform so rotated shapes and icons keep their proportions.

import { boxOf, canResize, centerOf, geometryFromBox, isLinear, MIN_SIZE } from './geometry.js'

export const GROUP_PAD_PX = 6
const CORNERS = ['nw', 'ne', 'se', 'sw']
const OPPOSITE = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }

// Corner points of the padded group box (as drawn by drawGroupBox).
export function groupHandles(bounds, zoom = 1) {
  const pad = GROUP_PAD_PX / zoom
  const left = bounds.x - pad, top = bounds.y - pad, right = bounds.x + bounds.width + pad, bottom = bounds.y + bounds.height + pad
  const points = { nw: { x: left, y: top }, ne: { x: right, y: top }, se: { x: right, y: bottom }, sw: { x: left, y: bottom } }
  return CORNERS.map((id) => ({ id, ...points[id] }))
}

export function hitGroupHandle(point, bounds, zoom, radiusPx = 8) {
  const radius = radiusPx / zoom
  return groupHandles(bounds, zoom).find((handle) => Math.abs(point.x - handle.x) <= radius && Math.abs(point.y - handle.y) <= radius)?.id ?? null
}

// Scale factor for dragging `handle` to `point`: the larger of the two axis
// ratios, never shrinking the group below a few pixels. The handle sits
// GROUP_PAD_PX outside the box, so that padding is discounted.
export function groupScale(bounds, handle, point, zoom = 1) {
  const origin = anchorPoint(bounds, OPPOSITE[handle]), pad = GROUP_PAD_PX / zoom
  const sx = (Math.abs(point.x - origin.x) - pad) / Math.max(bounds.width, 1)
  const sy = (Math.abs(point.y - origin.y) - pad) / Math.max(bounds.height, 1)
  const minScale = MIN_SIZE / Math.max(Math.min(bounds.width, bounds.height), 1)
  return { scale: Math.max(sx, sy, minScale), origin }
}

function anchorPoint(bounds, corner) {
  return { x: corner.includes('w') ? bounds.x : bounds.x + bounds.width, y: corner.includes('n') ? bounds.y : bounds.y + bounds.height }
}

const scaleAround = (point, origin, s) => ({ x: origin.x + (point.x - origin.x) * s, y: origin.y + (point.y - origin.y) * s })

export function scaleObject(object, origin, s) {
  const b = boxOf(object)
  if (isLinear(object)) {
    const start = scaleAround({ x: b.x, y: b.y }, origin, s)
    return { ...object, transform: { ...object.transform, x: start.x, y: start.y }, geometry: { ...object.geometry, x2: b.width * s, y2: b.height * s } }
  }
  const center = scaleAround(centerOf(b), origin, s)
  // Screen-fixed pins keep their size; only their position follows the group.
  if (!canResize(object)) return { ...object, transform: { ...object.transform, x: center.x - b.width / 2, y: center.y - b.height / 2 } }
  const width = b.width * s, height = b.height * s
  const fontSize = Number(object.style?.fontSize)
  return {
    ...object,
    transform: { ...object.transform, x: center.x - width / 2, y: center.y - height / 2 },
    geometry: geometryFromBox(object.type, { width, height }, object.geometry),
    ...(Number.isFinite(fontSize) ? { style: { ...object.style, fontSize: Math.max(4, Math.round(fontSize * s * 10) / 10) } } : {}),
  }
}
