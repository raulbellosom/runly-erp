import { boxOf, centerOf, hitObject, isLinear, rotatePoint } from '../engine/geometry.js'

const CONNECTABLE = new Set(['rectangle', 'ellipse', 'polygon', 'text', 'image', 'hotspot'])
export const isConnectable = (object) => CONNECTABLE.has(object?.type)

// Point where the ray from the shape's centre towards `toward` leaves it.
export function borderPoint(object, toward) {
  const b = boxOf(object), c = centerOf(b)
  const local = rotatePoint(toward, c, -b.rotation)
  const dx = local.x - c.x, dy = local.y - c.y
  if (!dx && !dy) return c
  const hw = Math.abs(b.width) / 2, hh = Math.abs(b.height) / 2
  let t
  if (object.type === 'ellipse' || object.type === 'hotspot') t = 1 / Math.sqrt((dx * dx) / (hw * hw || 1) + (dy * dy) / (hh * hh || 1))
  else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
  return rotatePoint({ x: c.x + dx * t, y: c.y + dy * t }, c, b.rotation)
}

// Lines/arrows with properties.connect get endpoints on their shapes' borders.
// Returns the same array when nothing is connected (cheap per frame).
export function resolveConnectors(objects) {
  if (!objects.some((o) => isLinear(o) && (o.properties?.connect?.start || o.properties?.connect?.end))) return objects
  const byId = new Map(objects.map((o) => [o.id, o]))
  return objects.map((object) => {
    const connect = object.properties?.connect
    if (!isLinear(object) || !connect) return object
    const startShape = connect.start ? byId.get(connect.start) : null
    const endShape = connect.end && connect.end !== connect.start ? byId.get(connect.end) : null
    if (!startShape && !endShape) return object
    const b = boxOf(object)
    let start = { x: b.x, y: b.y }, end = { x: b.x + b.width, y: b.y + b.height }
    const startRef = startShape ? centerOf(boxOf(startShape)) : start, endRef = endShape ? centerOf(boxOf(endShape)) : end
    if (startShape) start = borderPoint(startShape, endRef)
    if (endShape) end = borderPoint(endShape, startRef)
    return { ...object, transform: { ...object.transform, x: start.x, y: start.y }, geometry: { ...object.geometry, x2: end.x - start.x, y2: end.y - start.y } }
  })
}

// Topmost connectable shape under `point`, skipping `excludeId`.
export function connectTargetAt(point, objects, excludeId) {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index]
    if (object.id !== excludeId && isConnectable(object) && hitObject(point, object, 0)) return object
  }
  return null
}
