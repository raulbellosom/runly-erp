import { boxOf, canEditVertices, centerOf, handlesOf, hitObject, isLinear, objectBounds, polygonHandles, ROTATE_HANDLE_OFFSET, rotatePoint } from './geometry.js'
import { readCanvasTheme } from './theme.js'
import { GROUP_PAD_PX, groupHandles } from './groupResize.js'
import { drawPin, pinGeometry } from './drawPin.js'
import { labelsOverlap, pinOf } from './pins.js'
import { TEXT_LINE_HEIGHT, textFont, wrapLines } from './text.js'
import { screenToWorld, worldToScreen } from './viewport.js'
import { bindingKey } from '../lib/dataBindings.js'

export { objectBounds }
const GRID_STEP = 24
const DASHES = { dashed: [8, 6], dotted: [2, 5] }

export function sceneBounds(objects) {
  if (!objects.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const object of objects) {
    const b = objectBounds(object)
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export class Canvas2DRenderer {
  constructor(canvas) {
    this.canvas = canvas
    this.context = canvas.getContext('2d')
    this.theme = readCanvasTheme(canvas)
    this.width = 0
    this.height = 0
  }

  setTheme(theme) { this.theme = theme; if (this.scene) this.render(this.scene) }

  resize(width, height, dpr = window.devicePixelRatio || 1) {
    const nextWidth = Math.max(1, Math.floor(width * dpr)), nextHeight = Math.max(1, Math.floor(height * dpr))
    if (this.canvas.width !== nextWidth || this.canvas.height !== nextHeight) {
      this.canvas.width = nextWidth; this.canvas.height = nextHeight
      this.canvas.style.width = `${width}px`; this.canvas.style.height = `${height}px`
    }
    this.dpr = dpr; this.width = width; this.height = height
    if (this.scene) this.render(this.scene)
  }

  render(scene) {
    this.scene = scene
    const { objects, viewport, selectedIds, images, linkedIds, overlay, marquee, interactive = true, remote = [], bindings = {}, measure = null, background = null, connectHint = null, drawers = {}, editVertices = true, polygonDraft = null, flash = null } = scene
    const ctx = this.context, dpr = this.dpr || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    // Exports paint a solid page background (e.g. white) before the grid
    // and objects; the editor leaves this unset and shows the app canvas.
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, this.width, this.height) }
    // Public links and older callers pass no grid: keep the dotted default.
    const grid = scene.grid ?? { enabled: true, size: GRID_STEP }
    if (grid.enabled) this.drawGrid(ctx, viewport, grid.size)
    ctx.save()
    ctx.translate(viewport.x, viewport.y); ctx.scale(viewport.zoom, viewport.zoom)
    const selected = [], pinLabels = []
    for (const object of objects) {
      this.drawObject(ctx, object, viewport, images, bindings, drawers, pinLabels)
      if (linkedIds?.has(object.id) || (object.hotspot && linkedIds?.has(object.hotspot.id))) this.drawLinkBadge(ctx, object, viewport.zoom)
      if (selectedIds?.has(object.id)) selected.push(object)
    }
    if (connectHint) this.drawConnectHint(ctx, connectHint, viewport.zoom)
    if (polygonDraft) this.drawPolygonDraft(ctx, polygonDraft, viewport.zoom)
    // Handles only make sense for a single object; a group gets outlines
    // plus one dashed box around everything.
    for (const object of selected) this.drawSelection(ctx, object, viewport.zoom, interactive && selected.length === 1, editVertices)
    if (selected.length > 1) this.drawGroupBox(ctx, selected, viewport.zoom, interactive)
    for (const cursor of remote) {
      for (const object of objects) if (cursor.selectedIds?.includes(object.id)) this.drawRemoteSelection(ctx, object, viewport.zoom, cursor.color)
    }
    if (flash && Date.now() < flash.until) {
      const target = objects.find((object) => object.id === flash.id)
      if (target) this.drawFlash(ctx, target, viewport.zoom, flash)
    }
    ctx.restore()
    // Pin labels are collected (not drawn) during the object loop above so
    // they can be placed in screen space, after every pin's shape is known,
    // skipping any that would overlap one already placed.
    this.drawPinLabels(ctx, pinLabels)
    if (measure) this.drawMeasure(ctx, measure, viewport)
    if (overlay?.object && overlay.text) this.drawOverlayLabel(ctx, overlay, viewport)
    if (marquee) this.drawMarquee(ctx, marquee)
    for (const cursor of remote) if (Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) this.drawRemoteCursor(ctx, cursor, viewport)
  }

  drawGrid(ctx, viewport, size = GRID_STEP) {
    let step = size * viewport.zoom
    while (step < 12) step *= 2
    const offsetX = ((viewport.x % step) + step) % step, offsetY = ((viewport.y % step) + step) % step
    const dotSize = viewport.zoom >= 0.75 ? 1.5 : 1
    ctx.fillStyle = this.theme.grid
    for (let x = offsetX; x < this.width; x += step) {
      for (let y = offsetY; y < this.height; y += step) ctx.fillRect(x - dotSize / 2, y - dotSize / 2, dotSize, dotSize)
    }
  }

  strokeColor(object) {
    if (object.type === 'hotspot') return object.hotspot?.color || object.style?.stroke || this.theme.hotspot
    return object.style?.stroke || this.theme.primary
  }

  applyFill(ctx, object, stroke) {
    const style = object.style ?? {}
    if (style.fill === 'none') return
    const alpha = ctx.globalAlpha
    ctx.globalAlpha = alpha * Number(style.fillOpacity ?? (style.fill ? 1 : 0.14))
    ctx.fillStyle = style.fill || stroke
    ctx.fill()
    ctx.globalAlpha = alpha
  }

  applyStroke(ctx, object, stroke) {
    const style = object.style ?? {}, width = Number(style.strokeWidth ?? 2)
    if (!width) return
    ctx.lineWidth = width
    ctx.strokeStyle = stroke
    ctx.setLineDash((DASHES[style.dash] ?? []).map((value) => value * Math.max(1, width / 2)))
    ctx.stroke()
    ctx.setLineDash([])
  }

  drawObject(ctx, object, viewport, images, bindings = {}, drawers = {}, pinLabels = []) {
    const zoom = viewport.zoom
    const b = boxOf(object), style = object.style ?? {}
    const key = bindingKey(object.properties?.binding)
    const data = key ? bindings[key] : null
    // Bound objects take their status colour unless the user opted out.
    const tint = data && object.properties?.binding?.tint !== false ? this.theme.tones[data.tone] ?? this.theme.tones.neutral : null
    const stroke = tint ?? this.strokeColor(object)
    ctx.save()
    ctx.globalAlpha = Number(style.opacity ?? 1)
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    if (isLinear(object)) { this.drawLine(ctx, object, b, stroke); ctx.restore(); return }
    // Hotspot pins draw in world coordinates around their anchor, not inside
    // the rotate/translate-to-centre transform every other shape uses below
    // (hotspots never rotate, and screen pins need their own zoom-independent
    // sizing — see drawPin.js).
    if (object.type === 'hotspot') { drawPin(ctx, object, viewport, stroke, this.theme, pinLabels); ctx.restore(); return }
    const c = centerOf(b)
    ctx.translate(c.x, c.y); ctx.rotate((b.rotation * Math.PI) / 180)
    const x = -b.width / 2, y = -b.height / 2, w = b.width, h = b.height
    // Custom types (e.g. pos.table) draw entirely through a plugged-in
    // drawer and never take the tint/data-label treatment below.
    if (drawers[object.type]) { drawers[object.type](ctx, object, { x, y, w, h, zoom, theme: this.theme }); ctx.restore(); return }
    const drawn = tint ? { ...object, style: { ...style, fill: tint, fillOpacity: 0.14 } } : object
    switch (object.type) {
      case 'ellipse': ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); this.applyFill(ctx, drawn, stroke); this.applyStroke(ctx, drawn, stroke); break
      case 'polygon': this.polygonPath(ctx, object, x, y, w, h); this.applyFill(ctx, drawn, stroke); this.applyStroke(ctx, drawn, stroke); break
      case 'text': this.drawText(ctx, object, x, y, w, tint); break
      case 'image': this.drawImage(ctx, object, x, y, w, h, images); break
      default: ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(Number(style.radius ?? 8), w / 2, h / 2)); this.applyFill(ctx, drawn, stroke); this.applyStroke(ctx, drawn, stroke)
    }
    // Text keeps its own glyph (tinted colour) and hotspots already returned
    // above; other bound shapes get the title/summary label and data badge.
    if (data && object.type !== 'text' && object.type !== 'image') {
      const badgeColor = tint ?? this.theme.tones.neutral
      this.drawDataLabel(ctx, data, x, y, w, h, zoom, badgeColor)
      this.drawDataBadge(ctx, x + w, y, zoom, badgeColor)
    }
    ctx.restore()
  }

  drawDataLabel(ctx, data, x, y, w, h, zoom, color) {
    if (!data) return
    const roomy = w * zoom >= 80 && h * zoom >= 40
    const title = data.title.length > 40 ? `${data.title.slice(0, 39)}…` : data.title
    ctx.save()
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = this.theme.foreground
    if (roomy) {
      const size = Math.min(16, Math.max(10, h / 5))
      ctx.font = `600 ${size}px ${this.theme.font}`
      ctx.fillText(title, x + w / 2, y + h / 2 - (data.summary ? size * 0.7 : 0), w - 12)
      if (data.summary) { ctx.font = `400 ${size * 0.85}px ${this.theme.font}`; ctx.fillStyle = color; ctx.fillText(data.summary, x + w / 2, y + h / 2 + size * 0.7, w - 12) }
    } else {
      const size = 12 / zoom
      ctx.font = `600 ${size}px ${this.theme.font}`; ctx.textBaseline = 'top'
      ctx.fillText(title, x + w / 2, y + h + 4 / zoom)
    }
    ctx.restore()
  }

  drawDataBadge(ctx, cx, cy, zoom, color) {
    const r = 7 / zoom
    ctx.save()
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2 / zoom
    // Tiny database glyph: two stacked ellipses.
    for (const dy of [-2.2, 1.8]) { ctx.beginPath(); ctx.ellipse(cx, cy + dy / zoom, 3.2 / zoom, 1.4 / zoom, 0, 0, Math.PI * 2); ctx.stroke() }
    ctx.restore()
  }

  // Points are box-relative (0..1); older rows without points fall back to
  // the named shape.
  polygonPath(ctx, object, x, y, w, h) {
    const points = Array.isArray(object.geometry?.points) && object.geometry.points.length > 2
      ? object.geometry.points
      : object.properties?.shape === 'diamond'
        ? [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }]
        : [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
    ctx.beginPath()
    points.forEach((point, index) => {
      const px = x + Number(point.x) * w, py = y + Number(point.y) * h
      if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    })
    ctx.closePath()
  }

  drawLine(ctx, object, b, stroke) {
    const end = { x: b.x + b.width, y: b.y + b.height }
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(end.x, end.y)
    this.applyStroke(ctx, object, stroke)
    if (object.type !== 'arrow') return
    const width = Number(object.style?.strokeWidth ?? 2), size = Math.max(10, width * 4), angle = Math.atan2(b.height, b.width)
    ctx.beginPath()
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(end.x - size * Math.cos(angle - Math.PI / 7), end.y - size * Math.sin(angle - Math.PI / 7))
    ctx.lineTo(end.x - size * Math.cos(angle + Math.PI / 7), end.y - size * Math.sin(angle + Math.PI / 7))
    ctx.closePath(); ctx.fillStyle = stroke; ctx.fill()
  }

  drawText(ctx, object, x, y, w, tint) {
    const style = object.style ?? {}, size = Number(style.fontSize ?? 18)
    ctx.font = textFont(style, this.theme.font)
    ctx.fillStyle = tint || style.textColor || style.stroke || this.theme.foreground
    ctx.textBaseline = 'top'
    const lines = wrapLines(ctx, object.properties?.text || 'Texto', w)
    lines.forEach((line, index) => ctx.fillText(line, x, y + index * size * TEXT_LINE_HEIGHT + size * 0.1))
  }

  drawImage(ctx, object, x, y, w, h, images) {
    const image = images?.get(object.properties?.fileId)
    if (image?.complete && image.naturalWidth) { ctx.drawImage(image, x, y, w, h); return }
    ctx.fillStyle = this.theme.grid; ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = this.theme.muted; ctx.lineWidth = 1; ctx.setLineDash([6, 4]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([])
  }

  // Labels are collected while drawing pins (see drawObject -> drawPin) and
  // placed here, after every pin is known, in screen space: a pill under the
  // tip (screen pins) or under the box (plan pins), skipping any that would
  // overlap one already placed (earlier-drawn pins win).
  drawPinLabels(ctx, pinLabels) {
    if (!pinLabels.length) return
    const placed = []
    ctx.save()
    ctx.font = `600 12px ${this.theme.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    for (const { text, rect } of pinLabels) {
      if (labelsOverlap(rect, placed)) continue
      placed.push(rect)
      ctx.globalAlpha = 0.9; ctx.fillStyle = this.theme.surface
      ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 6); ctx.fill()
      ctx.globalAlpha = 1; ctx.fillStyle = this.theme.foreground
      ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2)
    }
    ctx.restore()
  }

  drawLinkBadge(ctx, object, zoom) {
    const r = 8 / zoom
    let cx, cy
    if (object.type === 'hotspot' && pinOf(object).scale === 'screen') {
      const { head, r: headR } = pinGeometry(object, zoom)
      cx = head.x + headR * 0.75; cy = head.y - headR * 0.75
    } else {
      const bounds = objectBounds(object)
      cx = bounds.x + bounds.width + 2 / zoom; cy = bounds.y - 2 / zoom
    }
    ctx.save()
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = this.theme.primary; ctx.fill()
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4 / zoom
    ctx.translate(cx, cy); ctx.rotate(-Math.PI / 4)
    for (const offset of [-2.2, 2.2]) { ctx.beginPath(); ctx.roundRect(offset / zoom - 2.6 / zoom, -1.8 / zoom, 5.2 / zoom, 3.6 / zoom, 1.8 / zoom); ctx.stroke() }
    ctx.restore()
  }

  // Outlines the shape a dragged line/arrow endpoint would snap to.
  drawConnectHint(ctx, object, zoom) {
    const b = boxOf(object), c = centerOf(b)
    ctx.save()
    ctx.lineWidth = 2 / zoom; ctx.strokeStyle = this.theme.primary; ctx.setLineDash([])
    ctx.translate(c.x, c.y); ctx.rotate((b.rotation * Math.PI) / 180)
    if (object.type === 'ellipse' || object.type === 'hotspot') { ctx.beginPath(); ctx.ellipse(0, 0, b.width / 2, b.height / 2, 0, 0, Math.PI * 2); ctx.stroke() }
    else ctx.strokeRect(-b.width / 2, -b.height / 2, b.width, b.height)
    ctx.restore()
  }

  drawSelection(ctx, object, zoom, interactive, editVertices = true) {
    const b = boxOf(object), primary = this.theme.primary
    const screenPin = object.type === 'hotspot' && pinOf(object).scale === 'screen'
    ctx.save()
    ctx.lineWidth = 1.5 / zoom; ctx.strokeStyle = primary; ctx.fillStyle = this.theme.surface
    if (screenPin) {
      // A ring around the pin's head instead of a box: screen pins have no
      // resize/rotate handles, so there is nothing else to draw here.
      const { head, r } = pinGeometry(object, zoom)
      ctx.beginPath(); ctx.arc(head.x, head.y, r + 3 / zoom, 0, Math.PI * 2); ctx.lineWidth = 2 / zoom; ctx.stroke()
      ctx.restore(); return
    }
    if (!isLinear(object)) {
      const c = centerOf(b), pad = object.type === 'hotspot' ? 4 / zoom : 0
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate((b.rotation * Math.PI) / 180)
      ctx.strokeRect(-b.width / 2 - pad, -b.height / 2 - pad, b.width + pad * 2, b.height + pad * 2)
      ctx.restore()
    }
    if (interactive && editVertices && canEditVertices(object)) { this.drawVertexHandles(ctx, object, zoom, b); ctx.restore(); return }
    if (interactive) {
      const handles = handlesOf(object, zoom), size = 8 / zoom
      const rotate = handles.find((h) => h.id === 'rotate')
      if (rotate) {
        const top = rotatePoint({ x: centerOf(b).x, y: b.y }, centerOf(b), b.rotation)
        ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(rotate.x, rotate.y); ctx.stroke()
      }
      for (const handle of handles) {
        ctx.beginPath()
        if (handle.id === 'rotate' || handle.id === 'start' || handle.id === 'end') ctx.arc(handle.x, handle.y, size * 0.65, 0, Math.PI * 2)
        else { ctx.save(); ctx.translate(handle.x, handle.y); ctx.rotate((b.rotation * Math.PI) / 180); ctx.rect(-size / 2, -size / 2, size, size); ctx.restore() }
        // A connected endpoint handle is filled solid to show it is attached.
        const connected = (handle.id === 'start' || handle.id === 'end') && object.properties?.connect?.[handle.id]
        ctx.fillStyle = connected ? primary : this.theme.surface
        ctx.fill(); ctx.stroke()
      }
    }
    ctx.restore()
  }

  // Vertex handles (filled squares) + midpoint handles (small, half-opacity
  // circles) plus the rotate handle; no box resize handles for this mode.
  drawVertexHandles(ctx, object, zoom, b) {
    const primary = this.theme.primary
    const top = rotatePoint({ x: centerOf(b).x, y: b.y }, centerOf(b), b.rotation)
    const rotate = { id: 'rotate', ...rotatePoint({ x: centerOf(b).x, y: b.y - ROTATE_HANDLE_OFFSET / zoom }, centerOf(b), b.rotation) }
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(rotate.x, rotate.y); ctx.stroke()
    ctx.beginPath(); ctx.arc(rotate.x, rotate.y, (8 / zoom) * 0.65, 0, Math.PI * 2)
    ctx.fillStyle = this.theme.surface; ctx.fill(); ctx.stroke()
    for (const handle of polygonHandles(object)) {
      const isVertex = handle.id.startsWith('v:'), size = isVertex ? 7 / zoom : 5 / zoom
      ctx.save()
      ctx.globalAlpha = isVertex ? 1 : 0.5
      ctx.beginPath()
      if (isVertex) ctx.rect(handle.x - size / 2, handle.y - size / 2, size, size)
      else ctx.arc(handle.x, handle.y, size / 2, 0, Math.PI * 2)
      ctx.fillStyle = primary
      ctx.fill(); ctx.strokeStyle = this.theme.surface; ctx.lineWidth = 1 / zoom; ctx.stroke()
      ctx.restore()
    }
  }

  // Open polyline for the in-progress free-drawn polygon: committed points,
  // a dashed segment to the cursor, and a dot at each vertex.
  drawPolygonDraft(ctx, draft, zoom) {
    const { points, cursor } = draft
    if (!points.length) return
    ctx.save()
    ctx.lineWidth = 1.5 / zoom; ctx.strokeStyle = this.theme.primary
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y)
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y)
    ctx.stroke()
    if (cursor) {
      ctx.setLineDash([6 / zoom, 4 / zoom])
      ctx.beginPath(); ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y); ctx.lineTo(cursor.x, cursor.y); ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.fillStyle = this.theme.surface
    for (const point of points) { ctx.beginPath(); ctx.arc(point.x, point.y, 4 / zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke() }
    ctx.restore()
  }

  drawGroupBox(ctx, objects, zoom, interactive = false) {
    const b = sceneBounds(objects), pad = GROUP_PAD_PX / zoom
    ctx.save()
    ctx.setLineDash([6 / zoom, 4 / zoom]); ctx.lineWidth = 1 / zoom; ctx.strokeStyle = this.theme.primary
    ctx.strokeRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2)
    // Corner handles scale the whole selection (see engine/groupResize.js).
    if (interactive) {
      const size = 8 / zoom
      ctx.setLineDash([]); ctx.lineWidth = 1.5 / zoom; ctx.fillStyle = this.theme.surface
      for (const handle of groupHandles(b, zoom)) {
        ctx.fillRect(handle.x - size / 2, handle.y - size / 2, size, size)
        ctx.strokeRect(handle.x - size / 2, handle.y - size / 2, size, size)
      }
    }
    ctx.restore()
  }

  // Pulsing ring around a just-focused element (~1s window, see
  // hooks/useFocusAnimation.js); alpha oscillates from the remaining time so
  // it fades out rather than cutting off.
  drawFlash(ctx, object, zoom, flash) {
    const b = objectBounds(object), pad = 8 / zoom
    const remaining = Math.max(0, flash.until - Date.now())
    const pulse = 0.35 + 0.35 * Math.abs(Math.sin((remaining / 220) * Math.PI))
    ctx.save()
    ctx.globalAlpha = pulse * Math.min(1, remaining / 250)
    ctx.lineWidth = 3 / zoom
    ctx.strokeStyle = this.theme.primary
    ctx.beginPath(); ctx.roundRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2, 8 / zoom)
    ctx.stroke()
    ctx.restore()
  }

  drawRemoteSelection(ctx, object, zoom, color) {
    const b = objectBounds(object), pad = 5 / zoom
    ctx.save()
    ctx.setLineDash([5 / zoom, 4 / zoom]); ctx.lineWidth = 1.5 / zoom; ctx.strokeStyle = color
    ctx.strokeRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2)
    ctx.restore()
  }

  // Arrow pointer plus a name pill, in screen space.
  drawRemoteCursor(ctx, cursor, viewport) {
    const p = worldToScreen(cursor, viewport)
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 16); ctx.lineTo(4.5, 12); ctx.lineTo(8, 19); ctx.lineTo(10.5, 18); ctx.lineTo(7, 11); ctx.lineTo(12, 11); ctx.closePath()
    ctx.fillStyle = cursor.color; ctx.fill(); ctx.lineWidth = 1.25; ctx.strokeStyle = '#ffffff'; ctx.stroke()
    ctx.font = `600 11px ${this.theme.font}`; ctx.textBaseline = 'middle'
    const label = cursor.name.length > 24 ? `${cursor.name.slice(0, 23)}…` : cursor.name, width = ctx.measureText(label).width + 12
    ctx.beginPath(); ctx.roundRect(12, 18, width, 18, 9); ctx.fillStyle = cursor.color; ctx.fill()
    ctx.fillStyle = '#ffffff'; ctx.fillText(label, 18, 27.5)
    ctx.restore()
  }

  drawMarquee(ctx, rect) {
    ctx.save()
    ctx.fillStyle = this.theme.primary; ctx.globalAlpha = 0.08
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    ctx.globalAlpha = 1; ctx.strokeStyle = this.theme.primary; ctx.lineWidth = 1
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width, rect.height)
    ctx.restore()
  }

  // Dashed measure line with endpoints and a length pill, in screen space.
  drawMeasure(ctx, measure, viewport) {
    const a = worldToScreen(measure.a, viewport), b = worldToScreen(measure.b, viewport)
    ctx.save()
    ctx.strokeStyle = this.theme.primary; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4])
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([])
    for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = this.theme.primary; ctx.fill() }
    if (measure.text) {
      ctx.font = `600 11px ${this.theme.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 14 }, width = ctx.measureText(measure.text).width + 14
      ctx.fillStyle = this.theme.primary; ctx.beginPath(); ctx.roundRect(mid.x - width / 2, mid.y - 10, width, 20, 6); ctx.fill()
      ctx.fillStyle = '#ffffff'; ctx.fillText(measure.text, mid.x, mid.y + 0.5)
    }
    ctx.restore()
  }

  // Dimension / angle pill shown in screen space under the transformed object.
  drawOverlayLabel(ctx, overlay, viewport) {
    const bounds = objectBounds(overlay.object)
    const anchor = worldToScreen({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height }, viewport)
    ctx.save()
    ctx.font = `600 11px ${this.theme.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const width = ctx.measureText(overlay.text).width + 14, y = Math.min(anchor.y + 18, this.height - 14)
    ctx.fillStyle = this.theme.primary
    ctx.beginPath(); ctx.roundRect(anchor.x - width / 2, y - 10, width, 20, 6); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.fillText(overlay.text, anchor.x, y + 0.5)
    ctx.restore()
  }

  hitTest(screenPoint, objects, viewport, tolerance = 6) {
    const point = screenToWorld(screenPoint, viewport), slop = tolerance / viewport.zoom
    for (let index = objects.length - 1; index >= 0; index -= 1) {
      if (hitObject(point, objects[index], slop, viewport.zoom)) return objects[index]
    }
    return null
  }
}
