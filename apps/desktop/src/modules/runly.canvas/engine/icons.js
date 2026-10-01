// Lucide icons for hotspot pins. The app already ships every lucide icon in
// its ui-vendor chunk (several @runly/ui renderers import the full
// namespace), so reusing that namespace costs nothing extra — no per-icon
// chunks, no network round trips. Each icon's raw SVG node list is read from
// the component once and drawn straight onto the Canvas2D context as vectors
// (crisp at any zoom). Names are lucide's kebab-case ids, as stored in
// CanvasHotspot.icon.
import * as LucideIcons from 'lucide-react'

let registry = null
let canonical = null
const toKebab = (value) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Za-z])(\d)/g, '$1-$2').toLowerCase()

// kebab name -> node list, built on first use from the components' icon data.
// Aliases (older names lucide renamed, e.g. trash-2) resolve too, so stored
// names keep working across lucide upgrades; `canonical` lists each icon once.
function buildRegistry() {
  const map = new Map()
  canonical = new Set()
  for (const [exportName, component] of Object.entries(LucideIcons)) {
    if (!/^[A-Z]/.test(exportName) || exportName.endsWith('Icon') || exportName.startsWith('Lucide') || typeof component?.render !== 'function') continue
    try {
      const data = component.render({}, null)?.props?.icon
      if (!data?.name || !Array.isArray(data.node)) continue
      if (!map.has(data.name)) { map.set(data.name, data.node); canonical.add(data.name) }
      const alias = toKebab(exportName)
      if (!map.has(alias)) map.set(alias, data.node)
    } catch {
      // Not an icon component (e.g. Icon, createLucideIcon); skip.
    }
  }
  return map
}
function icons() { return (registry ??= buildRegistry()) }

export function allIconNames() { icons(); return [...canonical].sort() }
export function isKnownIcon(name) { return Boolean(name && icons().has(name)) }
export function getIconNode(name) { return name ? icons().get(name) ?? null : null }

const points = (value) => String(value ?? '').trim().split(/[\s,]+/).map(Number)

// Draws a 24x24 lucide node list centered at (cx, cy) with the given size.
export function drawIconNode(ctx, node, cx, cy, size, color, strokeWidth = 2) {
  const scale = size / 24
  ctx.save()
  ctx.translate(cx - size / 2, cy - size / 2)
  ctx.scale(scale, scale)
  ctx.lineWidth = strokeWidth
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.strokeStyle = color; ctx.fillStyle = color
  ctx.setLineDash([])
  for (const [tag, attrs = {}] of node) {
    const n = (key) => Number(attrs[key] ?? 0)
    let path
    if (tag === 'path') path = new Path2D(attrs.d)
    else {
      path = new Path2D()
      if (tag === 'circle') path.arc(n('cx'), n('cy'), n('r'), 0, Math.PI * 2)
      else if (tag === 'ellipse') path.ellipse(n('cx'), n('cy'), n('rx'), n('ry'), 0, 0, Math.PI * 2)
      else if (tag === 'rect') path.roundRect(n('x'), n('y'), n('width'), n('height'), Math.min(n('rx') || n('ry'), n('width') / 2, n('height') / 2))
      else if (tag === 'line') { path.moveTo(n('x1'), n('y1')); path.lineTo(n('x2'), n('y2')) }
      else if (tag === 'polyline' || tag === 'polygon') {
        const values = points(attrs.points)
        for (let i = 0; i + 1 < values.length; i += 2) { if (i === 0) path.moveTo(values[i], values[i + 1]); else path.lineTo(values[i], values[i + 1]) }
        if (tag === 'polygon') path.closePath()
      } else continue
    }
    if (attrs.fill && attrs.fill !== 'none') ctx.fill(path)
    ctx.stroke(path)
  }
  ctx.restore()
}
