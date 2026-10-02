// DXF import: flattens entities (and block inserts) into plain segments,
// circles, arcs and texts, measures their extents, and rasterizes them onto
// a canvas so the drawing can be inserted through the normal image pipeline.
// `dxf-parser` gives ARC angles already in radians and TEXT/MTEXT/INSERT
// rotation in degrees — see its `entities/arc.js` vs `entities/text.js`.
//
// Pure helpers below (`unitOf`, `collectSegments`, `drawingExtents`) never
// touch `document`, so they stay testable in plain Node.

// $INSUNITS -> calibration unit + factor to convert a drawing unit into it.
// Code 1 (inches) is expressed in feet, like the rest of the imperial rows.
export const DXF_UNITS = {
  1: { unit: 'ft', toUnit: 1 / 12 },
  2: { unit: 'ft', toUnit: 1 },
  4: { unit: 'mm', toUnit: 1 },
  5: { unit: 'cm', toUnit: 1 },
  6: { unit: 'm', toUnit: 1 },
}

export function unitOf(code) {
  return DXF_UNITS[code] ?? null
}

const PRIMITIVE_LIMIT = 200_000
const MAX_BLOCK_DEPTH = 8
const point = (value) => ({ x: value?.x ?? 0, y: value?.y ?? 0 })

// Local-to-parent transform for an INSERT: scale, then rotate (degrees),
// then translate — applied in the block's own coordinate space.
function insertTransform(insert) {
  const xScale = insert.xScale ?? 1, yScale = insert.yScale ?? 1
  const rotation = ((insert.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(rotation), sin = Math.sin(rotation)
  const origin = point(insert.position)
  return (raw) => {
    const p = point(raw)
    const x = p.x * xScale, y = p.y * yScale
    return { x: x * cos - y * sin + origin.x, y: x * sin + y * cos + origin.y }
  }
}

// Flattens LINE, LWPOLYLINE/POLYLINE, CIRCLE, ARC, TEXT, MTEXT and INSERT
// (recursively expanding block definitions, depth-limited) into world-space
// primitives. Throws once the drawing is too large to rasterize sensibly.
export function collectSegments(dxf) {
  const segments = [], circles = [], arcs = [], texts = []
  let count = 0
  const checked = (push) => (...args) => {
    count += 1
    if (count > PRIMITIVE_LIMIT) throw new Error('El DXF es demasiado grande para importarlo.')
    push(...args)
  }
  const addSegment = checked((p, q) => segments.push([p, q]))
  const addCircle = checked((x, y, r) => circles.push({ x, y, r }))
  const addArc = checked((x, y, r, start, end) => arcs.push({ x, y, r, start, end }))
  const addText = checked((x, y, h, text, rotation) => texts.push({ x, y, h, text, rotation }))

  function walk(entities, blocks, transform, depth) {
    for (const entity of entities ?? []) {
      switch (entity.type) {
        case 'LINE': {
          const vertices = entity.vertices ?? []
          if (vertices.length >= 2) addSegment(transform(vertices[0]), transform(vertices[1]))
          break
        }
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          const vertices = entity.vertices ?? []
          for (let i = 0; i < vertices.length - 1; i += 1) addSegment(transform(vertices[i]), transform(vertices[i + 1]))
          if ((entity.shape || entity.closed) && vertices.length > 2) {
            addSegment(transform(vertices[vertices.length - 1]), transform(vertices[0]))
          }
          break
        }
        case 'CIRCLE': {
          const c = transform(entity.center)
          addCircle(c.x, c.y, entity.radius ?? 0)
          break
        }
        case 'ARC': {
          const c = transform(entity.center)
          addArc(c.x, c.y, entity.radius ?? 0, entity.startAngle ?? 0, entity.endAngle ?? 0)
          break
        }
        case 'TEXT': {
          const p = transform(entity.startPoint)
          addText(p.x, p.y, entity.textHeight ?? 0, entity.text ?? '', entity.rotation ?? 0)
          break
        }
        case 'MTEXT': {
          const p = transform(entity.position)
          addText(p.x, p.y, entity.height ?? 0, entity.text ?? '', entity.rotation ?? 0)
          break
        }
        case 'INSERT': {
          if (depth >= MAX_BLOCK_DEPTH) break
          const block = blocks?.[entity.name]
          if (!block?.entities) break
          const local = insertTransform(entity)
          walk(block.entities, blocks, (raw) => transform(local(raw)), depth + 1)
          break
        }
        default:
          break
      }
    }
  }

  walk(dxf?.entities ?? [], dxf?.blocks ?? {}, point, 0)
  return { segments, circles, arcs, texts }
}

// Bounding box over every primitive (circles/arcs counted centre ± radius).
export function drawingExtents({ segments = [], circles = [], arcs = [], texts = [] }) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const consider = (x, y) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (const segment of segments) for (const p of segment) consider(p.x, p.y)
  for (const c of circles) { consider(c.x - c.r, c.y - c.r); consider(c.x + c.r, c.y + c.r) }
  for (const a of arcs) { consider(a.x - a.r, a.y - a.r); consider(a.x + a.r, a.y + a.r) }
  for (const t of texts) consider(t.x, t.y)
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

const STROKE = '#111827'

// Parses a DXF file's text and draws it onto an offscreen canvas, flipping Y
// (DXF grows up, canvas grows down) so the raster reads right-side up.
// Returns the PNG blob, its pixel size, the drawing's extents in DXF units
// and the calibration unit declared by $INSUNITS (or null if undeclared).
export async function rasterizeDxf(text, { maxSide = 4096 } = {}) {
  const { default: DxfParser } = await import('dxf-parser')
  let dxf
  try {
    dxf = new DxfParser().parseSync(text)
  } catch {
    throw new Error('No se pudo leer el DXF.')
  }
  if (!dxf) throw new Error('No se pudo leer el DXF.')

  const { segments, circles, arcs, texts } = collectSegments(dxf)
  const extents = drawingExtents({ segments, circles, arcs, texts })
  const extentsWidth = Math.max(extents.maxX - extents.minX, 1e-6)
  const extentsHeight = Math.max(extents.maxY - extents.minY, 1e-6)
  const margin = 0.02
  const drawWidth = extentsWidth * (1 + margin * 2), drawHeight = extentsHeight * (1 + margin * 2)
  const scale = maxSide / Math.max(drawWidth, drawHeight)
  const width = Math.max(1, Math.round(drawWidth * scale)), height = Math.max(1, Math.round(drawHeight * scale))
  const originX = extents.minX - extentsWidth * margin, originY = extents.minY - extentsHeight * margin
  const toCanvas = (x, y) => ({ x: (x - originX) * scale, y: height - (y - originY) * scale })

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = STROKE
  ctx.fillStyle = STROKE
  ctx.lineWidth = 1

  ctx.beginPath()
  for (const [p, q] of segments) {
    const a = toCanvas(p.x, p.y), b = toCanvas(q.x, q.y)
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
  }
  ctx.stroke()

  for (const circle of circles) {
    const c = toCanvas(circle.x, circle.y)
    ctx.beginPath()
    ctx.arc(c.x, c.y, Math.max(circle.r * scale, 0.5), 0, Math.PI * 2)
    ctx.stroke()
  }

  // Angles are already radians (dxf-parser); flipping Y reverses the sweep.
  for (const arc of arcs) {
    const c = toCanvas(arc.x, arc.y)
    ctx.beginPath()
    ctx.arc(c.x, c.y, Math.max(arc.r * scale, 0.5), -arc.start, -arc.end, true)
    ctx.stroke()
  }

  for (const t of texts) {
    if (!t.text) continue
    const p = toCanvas(t.x, t.y)
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate((-(t.rotation ?? 0) * Math.PI) / 180)
    ctx.font = `${Math.max(8, (t.h || 2) * scale)}px sans-serif`
    ctx.fillText(t.text, 0, 0)
    ctx.restore()
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('No se pudo generar la imagen')), 'image/png')
  })
  return { blob, width, height, extents: { width: extentsWidth, height: extentsHeight }, unit: unitOf(dxf.header?.$INSUNITS) }
}
