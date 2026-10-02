// Pure adapter: planner element state (floorPlannerState.js) <-> Canvas
// engine objects (CanvasViewport/Canvas2DRenderer), for the editable floor
// designer (FloorPlannerStage). The read-only waiter view keeps its own
// adapter (floorObjects.js) — that one reads PosFloorElement + live table
// state; this one reads the planner's already-parsed numbers.
import { absolutePoints, boxOf } from '../../runly.canvas/engine/geometry.js'
import { DEFAULT_SIZES } from './floorPlannerState.js'
import { POLYGON_ZONE_COLORS } from './zoneColors.js'

const num = (value, fallback = 0) => { const n = Number.parseFloat(value); return Number.isFinite(n) ? n : fallback }
const round2 = (n) => Math.round(n * 100) / 100
const TABLE_KINDS = new Set(['TABLE_SQUARE', 'TABLE_ROUND'])

function base(el, type, layerId) {
  return {
    id: el.id, type, layerId,
    transform: { x: num(el.x), y: num(el.y), rotation: num(el.rotation), scaleX: 1, scaleY: 1 },
    geometry: { width: num(el.width, 1), height: num(el.height, 1) },
    style: {},
  }
}

function surfaceObject(floor) {
  return {
    id: '__surface__', type: 'pos.surface', layerId: 'pos-surface',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    geometry: { width: Math.max(num(floor?.canvasWidth, 1400), 1400), height: Math.max(num(floor?.canvasHeight, 900), 900) },
    style: {}, properties: {},
  }
}

function polygonObject(el) {
  const object = base(el, 'polygon', 'pos')
  const { x, y } = object.transform, { width, height } = object.geometry
  const points = el.points ?? []
  object.geometry.points = points.length > 2
    ? points.map((p) => ({ x: (num(p.x) - x) / (width || 1), y: (num(p.y) - y) / (height || 1) }))
    : [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
  const zone = el.color ?? 'neutral'
  const colors = POLYGON_ZONE_COLORS[zone] ?? POLYGON_ZONE_COLORS.neutral
  object.style = { stroke: colors.stroke, fill: colors.fill, fillOpacity: 1, dash: 'dashed' }
  object.properties = { kind: 'POLYGON', label: el.label ?? null, zone }
  return object
}

function zoneObject(el) {
  return { ...base(el, 'pos.zone', 'pos'), properties: { kind: 'FLOOR_ZONE', label: el.label ?? null, color: el.color ?? 'neutral' } }
}

function tableObject(el) {
  return {
    ...base(el, 'pos.table', 'pos'),
    properties: {
      kind: el.kind, round: el.kind === 'TABLE_ROUND', capacity: el.capacity ?? 0, chairStyle: el.chairStyle ?? 'auto',
      name: el.tableName ?? '', status: 'AVAILABLE', dimmed: false, orphan: false,
      tableId: el.tableId ?? null, label: el.label ?? null, planner: true,
    },
  }
}

function decorObject(el) {
  return { ...base(el, 'pos.decor', 'pos'), properties: { kind: el.kind, label: el.label ?? null } }
}

// Single planner element -> single Canvas object, used both when building
// the full scene and for the drag-to-create draft preview.
export function elementToObject(el) {
  if (el.kind === 'POLYGON') return polygonObject(el)
  if (el.kind === 'FLOOR_ZONE') return zoneObject(el)
  if (TABLE_KINDS.has(el.kind)) return tableObject(el)
  return decorObject(el)
}

// Surface first (locked layer), then zones/polygons, decor, tables — so
// tables always paint on top and zones always paint behind everything else,
// independent of the planner elements' array order (which still drives
// front/back ordering within each bucket, via bringForward/sendBackward).
export function plannerToObjects({ floor, elements = [] }) {
  const below = [], decor = [], tables = []
  for (const el of elements) {
    const object = elementToObject(el)
    if (el.kind === 'POLYGON' || el.kind === 'FLOOR_ZONE') below.push(object)
    else if (TABLE_KINDS.has(el.kind)) tables.push(object)
    else decor.push(object)
  }
  return [surfaceObject(floor), ...below, ...decor, ...tables]
}

// Canvas object (after a move/resize/rotate/vertex-edit commit) -> the
// planner APPLY patch shape. The reducer clamps x/y/width/height; rotation
// and (for polygons) absolute points pass through as-is.
export function objectToPatch(object) {
  const b = boxOf(object)
  const patch = { id: object.id, x: round2(b.x), y: round2(b.y), width: round2(b.width), height: round2(b.height), rotation: round2(b.rotation) }
  if (object.type === 'polygon') {
    patch.points = absolutePoints(object).map((p) => ({ x: round2(p.x), y: round2(p.y) }))
  }
  return patch
}

// Builds a new planner element (without an id — the caller assigns one) for
// a tool placed by click (`input` is just a point: `{ x, y }`, default size
// centered on it), by drag (`input` has `width`/`height`: drawn top-left
// box), or a free polygon (`input.points`, world-space, >= 3).
export function buildPlannerElement(kind, input, existing = []) {
  if (kind === 'POLYGON') {
    const points = input?.points ?? []
    if (points.length < 3) return null
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y)
    const x = Math.min(...xs), y = Math.min(...ys)
    const width = Math.max(20, Math.max(...xs) - x), height = Math.max(20, Math.max(...ys) - y)
    return {
      kind: 'POLYGON', x, y, width, height, rotation: 0, label: 'Área',
      tableId: null, tableName: '', capacity: 0, chairStyle: 'auto', color: 'neutral', points,
    }
  }
  const defaults = DEFAULT_SIZES[kind] ?? { width: 80, height: 80 }
  const hasSize = input?.width != null && input?.height != null
  const width = hasSize ? input.width : defaults.width
  const height = hasSize ? input.height : defaults.height
  const x = hasSize ? input.x : input.x - width / 2
  const y = hasSize ? input.y : input.y - height / 2
  const isTable = kind.startsWith('TABLE_')
  const tableCount = existing.filter((el) => el.kind?.startsWith('TABLE_')).length
  return {
    kind, x: Math.round(x), y: Math.round(y), width, height, rotation: 0,
    label: kind === 'FLOOR_ZONE' ? 'Zona' : null,
    tableId: null, tableName: isTable ? `Mesa ${tableCount + 1}` : '',
    capacity: isTable ? 2 : 0, chairStyle: isTable ? 'auto' : undefined, color: kind === 'FLOOR_ZONE' ? 'neutral' : undefined,
  }
}
