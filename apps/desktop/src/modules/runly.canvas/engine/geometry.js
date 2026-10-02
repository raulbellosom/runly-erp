// Pure geometry for Canvas objects. An object is a box (transform.x/y +
// geometry.width/height) rotated `transform.rotation` degrees around its
// center; lines and arrows are a segment from (x, y) to (x + x2, y + y2) —
// the API stores their signed end offset as geometry.x2/y2 and rejects
// negative width/height — and never rotate (the endpoints carry direction).

import { hitPin, pinOf } from './pins.js'

export const MIN_SIZE = 4
export const ROTATE_HANDLE_OFFSET = 28
const LINEAR = new Set(['line', 'arrow'])
const BOX_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const CORNER_HANDLES = ['nw', 'ne', 'se', 'sw']

export function isLinear(object) { return LINEAR.has(object?.type) }
export function canRotate(object) { return !isLinear(object) && object?.type !== 'hotspot' }
// Screen-fixed hotspot pins have a constant on-screen size and cannot be
// resized; plan-mode hotspots live inside their world box like any shape.
export function canResize(object) { return object?.type !== 'hotspot' || pinOf(object).scale === 'plan' }

const num = (value, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? n : fallback }

export function boxOf(object) {
  const t = object.transform ?? {}, g = object.geometry ?? {}
  if (isLinear(object)) return { x: num(t.x), y: num(t.y), width: num(g.x2 ?? g.width), height: num(g.y2 ?? g.height), rotation: 0 }
  return { x: num(t.x), y: num(t.y), width: num(g.width, 120), height: num(g.height, 80), rotation: num(t.rotation) }
}

// Persisted geometry for a box, in the shape the API validates per type.
export function geometryFromBox(type, box, previous = {}) {
  const { width: _w, height: _h, x2: _x2, y2: _y2, ...rest } = previous
  if (LINEAR.has(type)) return { ...rest, x2: box.width, y2: box.height }
  return { ...rest, width: Math.max(Math.abs(box.width), MIN_SIZE), height: Math.max(Math.abs(box.height), MIN_SIZE) }
}

// Axis-aligned bounds in world space (rotation included).
export function objectBounds(object) {
  const b = boxOf(object)
  if (isLinear(object)) {
    const x2 = b.x + b.width, y2 = b.y + b.height
    return { x: Math.min(b.x, x2), y: Math.min(b.y, y2), width: Math.abs(b.width) || 1, height: Math.abs(b.height) || 1 }
  }
  if (!b.rotation) return { x: b.x, y: b.y, width: b.width, height: b.height }
  const corners = boxCorners(b)
  const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y)
  const minX = Math.min(...xs), minY = Math.min(...ys)
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
}

export function centerOf(box) { return { x: box.x + box.width / 2, y: box.y + box.height / 2 } }

export function rotatePoint(point, center, degrees) {
  if (!degrees) return { x: point.x, y: point.y }
  const r = (degrees * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r)
  const dx = point.x - center.x, dy = point.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

function boxCorners(b) {
  const c = centerOf(b)
  return [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }].map((p) => rotatePoint(p, c, b.rotation))
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// `zoom` lets screen-fixed hotspot pins hit-test against their constant
// on-screen shape instead of their (zoom-dependent) stored box; without it,
// hit-testing falls back to the stored box as before.
export function hitObject(point, object, slop = 0, zoom = null) {
  const b = boxOf(object)
  if (isLinear(object)) {
    const width = num(object.style?.strokeWidth, 2)
    return distanceToSegment(point, { x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height }) <= slop + width / 2 + 2
  }
  if (object?.type === 'hotspot' && zoom) {
    const pin = pinOf(object)
    if (pin.scale === 'screen') return hitPin(point, pin, zoom, slop * zoom)
  }
  const local = rotatePoint(point, centerOf(b), -b.rotation)
  return local.x >= b.x - slop && local.x <= b.x + b.width + slop && local.y >= b.y - slop && local.y <= b.y + b.height + slop
}

// Handle positions in world units; `zoom` keeps the rotate stem a constant
// on-screen length.
export function handlesOf(object, zoom = 1) {
  const b = boxOf(object)
  if (isLinear(object)) return [{ id: 'start', x: b.x, y: b.y }, { id: 'end', x: b.x + b.width, y: b.y + b.height }]
  const c = centerOf(b), handles = []
  if (canResize(object)) {
    const local = {
      nw: [b.x, b.y], n: [c.x, b.y], ne: [b.x + b.width, b.y], e: [b.x + b.width, c.y],
      se: [b.x + b.width, b.y + b.height], s: [c.x, b.y + b.height], sw: [b.x, b.y + b.height], w: [b.x, c.y],
    }
    for (const id of object.type === 'hotspot' ? CORNER_HANDLES : BOX_HANDLES) handles.push({ id, ...rotatePoint({ x: local[id][0], y: local[id][1] }, c, b.rotation) })
  }
  if (canRotate(object)) handles.push(rotateHandlePoint(object, zoom))
  return handles
}

function rotateHandlePoint(object, zoom) {
  const b = boxOf(object), c = centerOf(b)
  return { id: 'rotate', ...rotatePoint({ x: c.x, y: b.y - ROTATE_HANDLE_OFFSET / zoom }, c, b.rotation) }
}

// A polygon with at least three relative points is eligible for vertex
// editing instead of box resize handles.
export function canEditVertices(object) {
  return object?.type === 'polygon' && Array.isArray(object.geometry?.points) && object.geometry.points.length >= 3
}

// Vertex + midpoint handles plus the rotate handle (no box resize handles).
export function vertexHandles(object, zoom = 1) {
  const handles = polygonHandles(object)
  if (canRotate(object)) handles.push(rotateHandlePoint(object, zoom))
  return handles
}

// Handle set used for hit-testing and drawing a selected object: vertex
// editing for eligible polygons (unless disabled), box handles otherwise.
export function interactionHandles(object, zoom = 1, editVertices = true) {
  return editVertices && canEditVertices(object) ? vertexHandles(object, zoom) : handlesOf(object, zoom)
}

export function hitHandle(point, object, zoom, radiusPx = 8, editVertices = true) {
  const radius = radiusPx / zoom
  return interactionHandles(object, zoom, editVertices).find((h) => Math.hypot(point.x - h.x, point.y - h.y) <= radius)?.id ?? null
}

// Resizes in the object's own (unrotated) frame so the opposite edge/corner
// stays fixed on screen even when the shape is rotated.
export function resizeObject(object, handle, point, { keepRatio = false } = {}) {
  const b = boxOf(object), c0 = centerOf(b)
  if (isLinear(object)) {
    const start = { x: b.x, y: b.y }, end = { x: b.x + b.width, y: b.y + b.height }
    const next = handle === 'start' ? { start: point, end } : { start, end: point }
    return withBox(object, { x: next.start.x, y: next.start.y, width: next.end.x - next.start.x, height: next.end.y - next.start.y })
  }
  const p = rotatePoint(point, c0, -b.rotation)
  let left = b.x, right = b.x + b.width, top = b.y, bottom = b.y + b.height
  if (handle.includes('w')) left = Math.min(p.x, right - MIN_SIZE)
  if (handle.includes('e')) right = Math.max(p.x, left + MIN_SIZE)
  if (handle.includes('n')) top = Math.min(p.y, bottom - MIN_SIZE)
  if (handle.includes('s')) bottom = Math.max(p.y, top + MIN_SIZE)
  if (keepRatio && handle.length === 2 && b.width && b.height) {
    const ratio = b.width / b.height, w = right - left, h = bottom - top
    if (w / h > ratio) { const nh = w / ratio; if (handle.includes('n')) top = bottom - nh; else bottom = top + nh }
    else { const nw = h * ratio; if (handle.includes('w')) left = right - nw; else right = left + nw }
  }
  const width = right - left, height = bottom - top
  const center = rotatePoint({ x: left + width / 2, y: top + height / 2 }, c0, b.rotation)
  return withBox(object, { x: center.x - width / 2, y: center.y - height / 2, width, height })
}

export function rotateObject(object, point, { snap = false } = {}) {
  const c = centerOf(boxOf(object))
  let angle = (Math.atan2(point.y - c.y, point.x - c.x) * 180) / Math.PI + 90
  if (snap) angle = Math.round(angle / 15) * 15
  angle = ((Math.round(angle) % 360) + 360) % 360
  return { ...object, transform: { ...object.transform, rotation: angle } }
}

export function moveObject(object, dx, dy) {
  const t = object.transform ?? {}
  return { ...object, transform: { ...t, x: num(t.x) + dx, y: num(t.y) + dy } }
}

export function withBox(object, box) {
  return {
    ...object,
    transform: { ...object.transform, x: box.x, y: box.y },
    geometry: geometryFromBox(object.type, box, object.geometry),
  }
}

// Box drawn by dragging from `a` to `b`. Shift constrains boxes to squares and
// lines to 45-degree steps.
export function boxFromDrag(type, a, b, { constrain = false } = {}) {
  let dx = b.x - a.x, dy = b.y - a.y
  if (LINEAR.has(type)) {
    if (constrain) {
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy)
      dx = Math.cos(angle) * len; dy = Math.sin(angle) * len
    }
    return { x: a.x, y: a.y, width: dx, height: dy }
  }
  if (constrain) { const side = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * side; dy = Math.sign(dy || 1) * side }
  return { x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), width: Math.max(Math.abs(dx), MIN_SIZE), height: Math.max(Math.abs(dy), MIN_SIZE) }
}

// ---- Polygon vertices (points are box-relative 0..1) -------------------
export function absolutePoints(object) {
  const b = boxOf(object), c = centerOf(b)
  return (object.geometry?.points ?? []).map((p) => rotatePoint({ x: b.x + p.x * b.width, y: b.y + p.y * b.height }, c, b.rotation))
}

// Rebuilds box + relative points from world points, keeping the rotation.
export function polygonFromAbsolute(object, world) {
  const b = boxOf(object), c = centerOf(b)
  const local = world.map((p) => rotatePoint(p, c, -b.rotation))
  const xs = local.map((p) => p.x), ys = local.map((p) => p.y)
  const minX = Math.min(...xs), minY = Math.min(...ys)
  const width = Math.max(Math.max(...xs) - minX, MIN_SIZE), height = Math.max(Math.max(...ys) - minY, MIN_SIZE)
  // The local box is unrotated around the old centre; place it so its centre maps back correctly.
  const localCenter = { x: minX + width / 2, y: minY + height / 2 }
  const worldCenter = rotatePoint(localCenter, c, b.rotation)
  return {
    ...object,
    transform: { ...object.transform, x: worldCenter.x - width / 2, y: worldCenter.y - height / 2 },
    geometry: { ...object.geometry, width, height, points: local.map((p) => ({ x: (p.x - minX) / width, y: (p.y - minY) / height })) },
  }
}

export function polygonHandles(object) {
  const points = absolutePoints(object)
  return [
    ...points.map((p, i) => ({ id: `v:${i}`, ...p })),
    ...points.map((p, i) => { const q = points[(i + 1) % points.length]; return { id: `m:${i}`, x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } }),
  ]
}

// handle 'v:i' moves vertex i; 'm:i' inserts after i; 'delete:i' removes i (min 3).
export function editVertex(object, handle, point) {
  const [kind, raw] = handle.split(':'), index = Number(raw)
  const points = absolutePoints(object)
  if (kind === 'v') points[index] = point
  else if (kind === 'm') points.splice(index + 1, 0, point)
  else if (kind === 'delete') { if (points.length <= 3) return object; points.splice(index, 1) }
  return polygonFromAbsolute(object, points)
}
