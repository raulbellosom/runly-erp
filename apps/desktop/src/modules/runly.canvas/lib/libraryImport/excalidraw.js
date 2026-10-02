import { POLYGON_POINTS } from '../objectFactory.js'

// Excalidraw library import (spec:
// docs/superpowers/specs/2026-10-02-canvas-libraries-design.md §21/§23).
// Converts v1 (`library: Element[][]`) and v2 (`libraryItems: [{ name,
// elements }]`) .excalidrawlib JSON into Canvas object payloads. Elements
// with `isDeleted: true` and unsupported types (image, frame, embeddable…)
// are skipped and counted; nothing else in the file is trusted beyond the
// fields read here.
const FILL_OPACITY = { solid: 1, hachure: 0.35, 'cross-hatch': 0.35 }
const DASH_STYLES = { dashed: 'dashed', dotted: 'dotted' }
const MAX_FREEDRAW_POINTS = 40

const num = (value, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? n : fallback }
const degrees = (radians) => (num(radians) * 180) / Math.PI

function styleFor(element) {
  const transparentStroke = element.strokeColor === 'transparent'
  const style = {
    stroke: element.strokeColor ?? '#000000',
    strokeWidth: transparentStroke ? 0 : num(element.strokeWidth, 1),
    fill: !element.backgroundColor || element.backgroundColor === 'transparent' ? 'none' : element.backgroundColor,
    fillOpacity: FILL_OPACITY[element.fillStyle] ?? 1,
    opacity: typeof element.opacity === 'number' ? element.opacity / 100 : 1,
  }
  const dash = DASH_STYLES[element.strokeStyle]
  if (dash) style.dash = dash
  return style
}

function boxTransform(element) {
  return { x: num(element.x), y: num(element.y), rotation: degrees(element.angle), scaleX: 1, scaleY: 1 }
}

function mapRectangle(element) {
  return [{
    type: 'rectangle',
    transform: boxTransform(element),
    geometry: { width: Math.abs(num(element.width)), height: Math.abs(num(element.height)) },
    style: { ...styleFor(element), radius: element.roundness ? 8 : 0 },
    properties: {},
  }]
}

function mapEllipse(element) {
  return [{
    type: 'ellipse',
    transform: boxTransform(element),
    geometry: { width: Math.abs(num(element.width)), height: Math.abs(num(element.height)) },
    style: styleFor(element),
    properties: {},
  }]
}

function mapDiamond(element) {
  return [{
    type: 'polygon',
    transform: boxTransform(element),
    geometry: { width: Math.abs(num(element.width)), height: Math.abs(num(element.height)), points: POLYGON_POINTS.diamond },
    style: styleFor(element),
    properties: { shape: 'diamond' },
  }]
}

function mapText(element) {
  return [{
    type: 'text',
    transform: boxTransform(element),
    geometry: { width: Math.abs(num(element.width)), height: Math.abs(num(element.height, 24)) },
    style: { textColor: element.strokeColor ?? '#000000', fontSize: num(element.fontSize, 20) },
    properties: { text: String(element.text ?? '') },
  }]
}

function pointOf(raw) {
  return Array.isArray(raw) ? { x: num(raw[0]), y: num(raw[1]) } : { x: num(raw?.x), y: num(raw?.y) }
}

// Lines/arrows never rotate in the Canvas model (their endpoints carry
// direction), so a rotated Excalidraw element has its points pre-rotated
// around the element's local center instead of carrying a rotation field.
function rotateLocal(point, center, radians) {
  if (!radians) return point
  const cos = Math.cos(radians), sin = Math.sin(radians)
  const dx = point.x - center.x, dy = point.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

function decimate(points, max) {
  if (points.length <= max) return points
  const step = (points.length - 1) / (max - 1)
  const result = []
  for (let i = 0; i < max; i += 1) result.push(points[Math.round(i * step)])
  return result
}

// One `line` per consecutive pair of points; for an `arrow`, only the last
// segment becomes `arrow` (and only when `endArrowhead` is set) — the tip
// belongs at the end of the stroke, not every segment.
function mapLinearPoints(element, points, isArrow) {
  if (points.length < 2) return []
  const center = { x: num(element.width) / 2, y: num(element.height) / 2 }
  const angle = num(element.angle)
  const normalized = points.map((raw) => rotateLocal(pointOf(raw), center, angle))
  const style = styleFor(element)
  const x = num(element.x), y = num(element.y)
  const segments = []
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const start = normalized[i], end = normalized[i + 1]
    const isLast = i === normalized.length - 2
    const type = isArrow && isLast && element.endArrowhead ? 'arrow' : 'line'
    segments.push({
      type,
      transform: { x: x + start.x, y: y + start.y, rotation: 0, scaleX: 1, scaleY: 1 },
      geometry: { x2: end.x - start.x, y2: end.y - start.y },
      style,
      properties: {},
    })
  }
  return segments
}

function mapLinear(element) {
  return mapLinearPoints(element, Array.isArray(element.points) ? element.points : [], element.type === 'arrow')
}

function mapFreedraw(element) {
  const points = decimate(Array.isArray(element.points) ? element.points : [], MAX_FREEDRAW_POINTS)
  return mapLinearPoints(element, points, false)
}

const MAPPERS = {
  rectangle: mapRectangle,
  ellipse: mapEllipse,
  diamond: mapDiamond,
  line: mapLinear,
  arrow: mapLinear,
  freedraw: mapFreedraw,
  text: mapText,
}

// Returns an array of Canvas objects for a supported element, or `null` for
// an unsupported type (image, frame, embeddable…) so the caller can count it.
function mapElement(element) {
  const mapper = MAPPERS[element?.type]
  return mapper ? mapper(element) : null
}

function libraryGroups(json, fallbackName) {
  if (Array.isArray(json?.libraryItems)) {
    return json.libraryItems.map((item, index) => ({
      name: (typeof item?.name === 'string' && item.name.trim()) || `Elemento ${index + 1}`,
      elements: Array.isArray(item?.elements) ? item.elements : [],
    }))
  }
  if (Array.isArray(json?.library)) {
    return json.library.map((elements, index) => ({ name: `Elemento ${index + 1}`, elements: Array.isArray(elements) ? elements : [] }))
  }
  if (Array.isArray(json?.elements)) {
    return [{ name: fallbackName || 'Elemento 1', elements: json.elements }]
  }
  return []
}

// Parses an .excalidrawlib document (v1 or v2) or a regular .excalidraw scene into
// `{ items: [{ name, objects }], skipped }`. `skipped` counts individual
// elements omitted for being deleted or of an unsupported type.
export function parseExcalidrawLibrary(json, fallbackName = null) {
  let skipped = 0
  const items = libraryGroups(json, fallbackName).map((group) => {
    const objects = []
    for (const element of group.elements) {
      if (!element || element.isDeleted) { skipped += 1; continue }
      const mapped = mapElement(element)
      if (mapped === null) { skipped += 1; continue }
      objects.push(...mapped)
    }
    return { name: group.name, objects }
  })
  return { items, skipped }
}
