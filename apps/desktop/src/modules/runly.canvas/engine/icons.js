// Lucide icons for hotspot pins, drawn straight onto the Canvas2D context as
// vectors (crisp at any zoom). The name -> node registry is shared with the
// rest of the app (@runly/ui icon library); names are lucide's kebab-case
// ids, as stored in CanvasHotspot.icon.
export { allIconNames, isKnownIcon, getIconNode } from '@runly/ui/icons'

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
