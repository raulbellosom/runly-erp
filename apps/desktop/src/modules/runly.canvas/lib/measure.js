import { boxOf } from '../engine/geometry.js'

export const UNIT_LABELS = { m: 'm', cm: 'cm', mm: 'mm', ft: 'ft' }
const number = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 })

// Real units per world pixel for a page calibration, or null.
export function calibrationScale(calibration) {
  if (!calibration?.a || !calibration?.b || !(calibration.distance > 0)) return null
  const px = Math.hypot(calibration.b.x - calibration.a.x, calibration.b.y - calibration.a.y)
  return px >= 1 ? calibration.distance / px : null
}

// `scale` = { scale, unit } from the page, or null for pixels.
export function formatLength(px, scale) {
  return scale ? `${number.format(px * scale.scale)} ${UNIT_LABELS[scale.unit]}` : `${Math.round(px)} px`
}
export function formatArea(px2, scale) {
  return scale ? `${number.format(px2 * scale.scale * scale.scale)} ${UNIT_LABELS[scale.unit]}²` : `${Math.round(px2)} px²`
}

function polygonArea(points, w, h) {
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i], q = points[(i + 1) % points.length]
    sum += p.x * w * q.y * h - q.x * w * p.y * h
  }
  return Math.abs(sum) / 2
}
function polygonPerimeter(points, w, h) {
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i], q = points[(i + 1) % points.length]
    sum += Math.hypot((q.x - p.x) * w, (q.y - p.y) * h)
  }
  return sum
}

// Measures in world px (rotation does not change them).
export function objectMeasures(object) {
  const b = boxOf(object)
  if (object.type === 'line' || object.type === 'arrow') return { length: Math.hypot(b.width, b.height) }
  const w = Math.abs(b.width), h = Math.abs(b.height)
  if (object.type === 'ellipse') {
    const a = w / 2, c = h / 2
    // Ramanujan's perimeter approximation.
    return { width: w, height: h, area: Math.PI * a * c, perimeter: Math.PI * (3 * (a + c) - Math.sqrt((3 * a + c) * (a + 3 * c))) }
  }
  if (object.type === 'polygon' && Array.isArray(object.geometry?.points) && object.geometry.points.length > 2) {
    const points = object.geometry.points
    return { width: w, height: h, area: polygonArea(points, w, h), perimeter: polygonPerimeter(points, w, h) }
  }
  if (object.type === 'rectangle' || object.type === 'image') return { width: w, height: h, area: w * h, perimeter: 2 * (w + h) }
  return { width: w, height: h }
}
