import { geometryFromBox } from '../engine/geometry.js'

// Maps editor tools to persisted object types and their default look.
export const SHAPE_TOOLS = ['rectangle', 'ellipse', 'triangle', 'diamond', 'line', 'arrow']
export const CREATION_TOOLS = new Set([...SHAPE_TOOLS, 'text', 'hotspot'])

export const CANVAS_COLORS = [
  '#0f172a', '#64748b', '#ef4444', '#f97316', '#f59e0b', '#22c55e',
  '#14b8a6', '#0ea5e9', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
]
export const DEFAULT_STROKE = '#3b82f6'

const DEFAULT_SIZES = {
  rectangle: { width: 160, height: 100 },
  ellipse: { width: 140, height: 140 },
  triangle: { width: 140, height: 120 },
  diamond: { width: 140, height: 140 },
  line: { width: 160, height: 0 },
  arrow: { width: 160, height: 0 },
  text: { width: 220, height: 24 },
  hotspot: { width: 36, height: 36 },
}

// Polygon vertices in box-relative units (0..1), so resizing the box never
// rewrites them; the API requires at least two points for polygons.
export const POLYGON_POINTS = {
  triangle: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  diamond: [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }],
}

export function toolToType(tool) {
  if (POLYGON_POINTS[tool]) return { type: 'polygon', properties: { shape: tool } }
  return { type: tool, properties: {} }
}

export function geometryForTool(tool, box) {
  const { type } = toolToType(tool)
  const geometry = geometryFromBox(type, box)
  return POLYGON_POINTS[tool] ? { ...geometry, points: POLYGON_POINTS[tool] } : geometry
}

// Full create payload (minus page/layer/position) for a tool and a box.
export function buildObjectData(tool, box) {
  const { type, properties } = toolToType(tool)
  return {
    type,
    transform: { x: box.x, y: box.y, rotation: 0, scaleX: 1, scaleY: 1 },
    geometry: geometryForTool(tool, box),
    style: defaultStyle(tool),
    properties: tool === 'text' ? { text: 'Texto' } : properties,
  }
}

export function defaultStyle(tool) {
  if (tool === 'text') return { textColor: '#0f172a', fontSize: 18 }
  if (tool === 'hotspot') return { stroke: '#ef4444' }
  if (tool === 'line' || tool === 'arrow') return { stroke: '#0f172a', strokeWidth: 2 }
  return { stroke: DEFAULT_STROKE, strokeWidth: 2, fill: DEFAULT_STROKE, fillOpacity: 0.12, radius: tool === 'rectangle' ? 8 : 0 }
}

// Unsaved preview object used while the user drags out a new shape.
export function draftObject(tool, box) {
  return { id: '__draft__', ...buildObjectData(tool, box) }
}

// Box for a click without drag: default size centered on the click point.
export function defaultBox(tool, point) {
  const size = DEFAULT_SIZES[tool] ?? DEFAULT_SIZES.rectangle
  if (tool === 'line' || tool === 'arrow') return { x: point.x - size.width / 2, y: point.y, ...size }
  if (tool === 'text') return { x: point.x, y: point.y - size.height / 2, ...size }
  return { x: point.x - size.width / 2, y: point.y - size.height / 2, ...size }
}

export const TYPE_LABELS = {
  rectangle: 'Rectángulo', ellipse: 'Elipse', polygon: 'Polígono', triangle: 'Triángulo', diamond: 'Rombo',
  line: 'Línea', arrow: 'Flecha', text: 'Texto', image: 'Imagen', hotspot: 'Hotspot',
}

export function objectLabel(object) {
  if (object.type === 'polygon') return TYPE_LABELS[object.properties?.shape] ?? TYPE_LABELS.polygon
  if (object.type === 'hotspot' && object.hotspot?.title) return object.hotspot.title
  return TYPE_LABELS[object.type] ?? object.type
}
