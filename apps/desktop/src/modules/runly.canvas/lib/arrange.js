import { objectBounds } from '../engine/geometry.js'

const MODES = {
  left: (b, g) => ({ dx: g.x - b.x, dy: 0 }),
  hcenter: (b, g) => ({ dx: g.x + g.width / 2 - (b.x + b.width / 2), dy: 0 }),
  right: (b, g) => ({ dx: g.x + g.width - (b.x + b.width), dy: 0 }),
  top: (b, g) => ({ dx: 0, dy: g.y - b.y }),
  vcenter: (b, g) => ({ dx: 0, dy: g.y + g.height / 2 - (b.y + b.height / 2) }),
  bottom: (b, g) => ({ dx: 0, dy: g.y + g.height - (b.y + b.height) }),
}

function groupBounds(bounds) {
  const x = Math.min(...bounds.map((b) => b.x)), y = Math.min(...bounds.map((b) => b.y))
  return { x, y, width: Math.max(...bounds.map((b) => b.x + b.width)) - x, height: Math.max(...bounds.map((b) => b.y + b.height)) - y }
}

// Map id -> { dx, dy } that aligns every object's bounds to the selection box.
export function alignDeltas(rows, mode) {
  const bounds = rows.map((row) => ({ id: row.id, ...objectBounds(row) }))
  const group = groupBounds(bounds), fn = MODES[mode]
  return new Map(bounds.map((b) => [b.id, fn(b, group)]))
}

// Equal gaps between bounds along an axis ('h' | 'v'); outer objects stay.
export function distributeDeltas(rows, axis) {
  if (rows.length < 3) return new Map()
  const start = axis === 'h' ? 'x' : 'y', size = axis === 'h' ? 'width' : 'height'
  const bounds = rows.map((row) => ({ id: row.id, ...objectBounds(row) })).sort((a, b) => a[start] - b[start])
  const first = bounds[0], last = bounds.at(-1)
  const total = last[start] + last[size] - first[start], used = bounds.reduce((sum, b) => sum + b[size], 0)
  const gap = (total - used) / (bounds.length - 1)
  const deltas = new Map()
  let cursor = first[start]
  for (const b of bounds) {
    const move = cursor - b[start]
    deltas.set(b.id, axis === 'h' ? { dx: move, dy: 0 } : { dx: 0, dy: move })
    cursor += b[size] + gap
  }
  return deltas
}
