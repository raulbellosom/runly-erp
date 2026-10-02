// Maps POS floor elements (PosFloorElement + live table states) to the object
// shape the Canvas engine draws. POS data stays in POS; this is view-only.
const num = (value, fallback = 0) => { const n = Number.parseFloat(value); return Number.isFinite(n) ? n : fallback }
const TABLE_KINDS = new Set(['TABLE_SQUARE', 'TABLE_ROUND'])
export const isTableObject = (object) => object?.type === 'pos.table'

function base(el, type) {
  return {
    id: el.id, type,
    transform: { x: num(el.x), y: num(el.y), rotation: num(el.rotation), scaleX: 1, scaleY: 1 },
    geometry: { width: num(el.width, 1), height: num(el.height, 1) },
    style: {},
  }
}

function polygonObject(el) {
  const object = base(el, 'polygon'), points = el.style?.points ?? []
  const { x, y } = object.transform, { width, height } = object.geometry
  const zone = el.style?.color ?? 'neutral'
  object.geometry.points = points.length > 2
    ? points.map((p) => ({ x: (num(p.x) - x) / (width || 1), y: (num(p.y) - y) / (height || 1) }))
    : [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
  object.properties = { kind: 'POLYGON', zone, label: el.label ?? null }
  return object
}

export function floorToObjects({ elements = [], tableStates = {} }) {
  const below = [], decor = [], tables = []
  for (const el of elements) {
    if (el.kind === 'POLYGON') below.push(polygonObject(el))
    else if (el.kind === 'FLOOR_ZONE') below.push({ ...base(el, 'pos.zone'), properties: { kind: el.kind, label: el.label ?? null, color: el.style?.color ?? el.color ?? 'neutral' } })
    else if (TABLE_KINDS.has(el.kind)) {
      const table = el.tableId ? tableStates[el.tableId] : null
      tables.push({
        ...base(el, 'pos.table'),
        properties: {
          kind: el.kind, round: el.kind === 'TABLE_ROUND',
          capacity: table?.capacity ?? el.style?.capacity ?? 0, chairStyle: el.style?.chairStyle ?? 'auto',
          name: table?.name ?? el.label ?? '', status: table?.status ?? 'AVAILABLE',
          dimmed: table?.isMine === false, orphan: Boolean(el.tableId && !table), tableId: el.tableId ?? null, label: el.label ?? null,
        },
      })
    } else decor.push({ ...base(el, 'pos.decor'), properties: { kind: el.kind, label: el.label ?? null, capacity: Number(el.style?.capacity ?? 0) || 0 } })
  }
  return [...below, ...decor, ...tables]
}
