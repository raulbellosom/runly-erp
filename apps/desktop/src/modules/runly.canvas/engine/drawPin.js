// Draws a hotspot as a map-style pin. "Screen" pins keep a constant
// on-screen size and are drawn directly in world coordinates around their
// anchor (the box centre), outside the usual per-object box transform;
// "plan" pins are drawn inside their world box (height = box height) and
// scale with zoom like any other shape. Both share the teardrop shape, the
// white border and the icon/dot glyph; only the height source and the label
// visibility threshold differ.
import { drawIconNode, getIconNode } from './icons.js'
import { PIN_HEAD, pinOf } from './pins.js'
import { worldToScreen } from './viewport.js'

const HEAD_RATIO = 0.36
const ICON_RATIO = 0.62
// Icon stroke in the icon's own 24-unit grid: drawIconNode already scales it
// with the glyph, so it must not depend on zoom (dividing by zoom made icons
// bold blobs when zoomed out).
const ICON_STROKE = 2.25
const DOT_RATIO = 0.12
const SCREEN_LABEL_ZOOM = 0.25
const PLAN_LABEL_ZOOM = 0.5

// Head centre, tip and radius for a hotspot's pin, in world coordinates.
// `h` is the pin's rendered height: a constant screen size (divided by zoom)
// for screen pins, or the stored box height for plan pins.
export function pinGeometry(object, zoom) {
  const pin = pinOf(object), plan = pin.scale === 'plan'
  const h = plan ? Math.abs(Number(object.geometry?.height) || pin.height) : pin.height / zoom
  const tip = plan ? { x: pin.anchor.x, y: pin.anchor.y + h / 2 } : { x: pin.anchor.x, y: pin.anchor.y }
  const head = { x: tip.x, y: tip.y - PIN_HEAD * h }
  return { plan, h, r: h * HEAD_RATIO, tip, head }
}

// Teardrop: a circle (the head) with two tangent lines down to a point (the
// tip) straight below its centre.
function teardropPath(ctx, head, r, tip) {
  const d = Math.max(tip.y - head.y, r)
  const theta = Math.asin(Math.min(1, r / d)), alpha = Math.PI / 2 - theta
  const a1 = Math.PI / 2 - alpha, a2 = Math.PI / 2 + alpha
  const p1 = { x: head.x + r * Math.cos(a1), y: head.y + r * Math.sin(a1) }
  const p2 = { x: head.x + r * Math.cos(a2), y: head.y + r * Math.sin(a2) }
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(p1.x, p1.y)
  ctx.arc(head.x, head.y, r, a1, a2, true)
  ctx.lineTo(tip.x, tip.y)
  ctx.closePath()
}

function drawGlyph(ctx, object, head, r) {
  const iconNode = getIconNode(object.hotspot?.icon)
  if (iconNode) { drawIconNode(ctx, iconNode, head.x, head.y, r * 2 * ICON_RATIO, '#ffffff', ICON_STROKE); return }
  ctx.beginPath(); ctx.arc(head.x, head.y, r * 2 * DOT_RATIO, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill()
}

// Draws the pin itself and, when there is room, pushes its label (text +
// screen-space rect) onto `pinLabels` for the renderer to place once every
// pin has been drawn (see Canvas2DRenderer.drawPinLabels for the overlap
// skip rule).
export function drawPin(ctx, object, viewport, color, theme, pinLabels) {
  const zoom = viewport.zoom, { plan, r, tip, head } = pinGeometry(object, zoom)
  ctx.save()
  teardropPath(ctx, head, r, tip)
  ctx.fillStyle = color
  ctx.fill()
  // Screen pins keep a constant 2px border; plan pins thin it out when zoomed in.
  ctx.lineWidth = plan ? 2 / Math.max(zoom, 0.5) : 2 / zoom
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  drawGlyph(ctx, object, head, r)
  ctx.restore()

  const title = object.hotspot?.title
  if (!title || zoom < (plan ? PLAN_LABEL_ZOOM : SCREEN_LABEL_ZOOM)) return
  const text = title.length > 32 ? `${title.slice(0, 31)}…` : title
  ctx.save(); ctx.font = `600 12px ${theme.font}`
  const width = ctx.measureText(text).width + 12
  ctx.restore()
  const anchor = worldToScreen(tip, viewport)
  pinLabels.push({ text, rect: { x: anchor.x - width / 2, y: anchor.y + 4, width, height: 20 } })
}
