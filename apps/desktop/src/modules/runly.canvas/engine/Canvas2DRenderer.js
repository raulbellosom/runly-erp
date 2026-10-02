import { boxOf, centerOf, handlesOf, hitObject, isLinear, objectBounds, rotatePoint } from './geometry.js'
import { readCanvasTheme } from './theme.js'
import { drawIconNode, getIconNode } from './icons.js'
import { TEXT_LINE_HEIGHT, textFont, wrapLines } from './text.js'
import { screenToWorld, worldToScreen } from './viewport.js'

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
    const { objects, viewport, selectedIds, images, linkedIds, overlay, marquee, interactive = true } = scene
    const ctx = this.context, dpr = this.dpr || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    // Public links and older callers pass no grid: keep the dotted default.
    const grid = scene.grid ?? { enabled: true, size: GRID_STEP }
    if (grid.enabled) this.drawGrid(ctx, viewport, grid.size)
    ctx.save()
    ctx.translate(viewport.x, viewport.y); ctx.scale(viewport.zoom, viewport.zoom)
    const selected = []
    for (const object of objects) {
      this.drawObject(ctx, object, viewport.zoom, images)
      if (linkedIds?.has(object.id) || (object.hotspot && linkedIds?.has(object.hotspot.id))) this.drawLinkBadge(ctx, object, viewport.zoom)
      if (selectedIds?.has(object.id)) selected.push(object)
    }
    // Handles only make sense for a single object; a group gets outlines
    // plus one dashed box around everything.
    for (const object of selected) this.drawSelection(ctx, object, viewport.zoom, interactive && selected.length === 1)
    if (selected.length > 1) this.drawGroupBox(ctx, selected, viewport.zoom)
    ctx.restore()
    if (overlay?.object && overlay.text) this.drawOverlayLabel(ctx, overlay, viewport)
    if (marquee) this.drawMarquee(ctx, marquee)
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

  drawObject(ctx, object, zoom, images) {
    const b = boxOf(object), style = object.style ?? {}, stroke = this.strokeColor(object)
    ctx.save()
    ctx.globalAlpha = Number(style.opacity ?? 1)
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    if (isLinear(object)) { this.drawLine(ctx, object, b, stroke); ctx.restore(); return }
    const c = centerOf(b)
    ctx.translate(c.x, c.y); ctx.rotate((b.rotation * Math.PI) / 180)
    const x = -b.width / 2, y = -b.height / 2, w = b.width, h = b.height
    switch (object.type) {
      case 'hotspot': this.drawHotspot(ctx, object, w, h, stroke, zoom); break
      case 'ellipse': ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); this.applyFill(ctx, object, stroke); this.applyStroke(ctx, object, stroke); break
      case 'polygon': this.polygonPath(ctx, object, x, y, w, h); this.applyFill(ctx, object, stroke); this.applyStroke(ctx, object, stroke); break
      case 'text': this.drawText(ctx, object, x, y, w); break
      case 'image': this.drawImage(ctx, object, x, y, w, h, images); break
      default: ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(Number(style.radius ?? 8), w / 2, h / 2)); this.applyFill(ctx, object, stroke); this.applyStroke(ctx, object, stroke)
    }
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

  drawText(ctx, object, x, y, w) {
    const style = object.style ?? {}, size = Number(style.fontSize ?? 18)
    ctx.font = textFont(style, this.theme.font)
    ctx.fillStyle = style.textColor || style.stroke || this.theme.foreground
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

  drawHotspot(ctx, object, w, h, color, zoom) {
    const r = Math.min(w, h) / 2, iconNode = getIconNode(object.hotspot?.icon)
    if (iconNode) {
      // Solid pin with a white glyph; a thin light ring keeps it readable on
      // dark plans and photos.
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
      ctx.lineWidth = 2 / Math.max(zoom, 0.5); ctx.strokeStyle = '#ffffff'; ctx.stroke()
      drawIconNode(ctx, iconNode, 0, 0, r * 1.15, '#ffffff', 2.25)
    } else {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.globalAlpha *= 0.18; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha /= 0.18
      ctx.lineWidth = 2 / Math.max(zoom, 0.5); ctx.strokeStyle = color; ctx.stroke()
      ctx.beginPath(); ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
    }
    const title = object.hotspot?.title
    if (title && zoom >= 0.5) {
      const size = 12 / zoom
      ctx.font = `600 ${size}px ${this.theme.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
      const label = title.length > 32 ? `${title.slice(0, 31)}…` : title, width = ctx.measureText(label).width
      ctx.fillStyle = this.theme.surface; ctx.globalAlpha = 0.9
      ctx.beginPath(); ctx.roundRect(-width / 2 - 6 / zoom, r + 4 / zoom, width + 12 / zoom, size + 8 / zoom, 6 / zoom); ctx.fill()
      ctx.globalAlpha = 1; ctx.fillStyle = this.theme.foreground; ctx.fillText(label, 0, r + 8 / zoom)
    }
  }

  drawLinkBadge(ctx, object, zoom) {
    const bounds = objectBounds(object), r = 8 / zoom
    const cx = bounds.x + bounds.width + 2 / zoom, cy = bounds.y - 2 / zoom
    ctx.save()
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = this.theme.primary; ctx.fill()
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4 / zoom
    ctx.translate(cx, cy); ctx.rotate(-Math.PI / 4)
    for (const offset of [-2.2, 2.2]) { ctx.beginPath(); ctx.roundRect(offset / zoom - 2.6 / zoom, -1.8 / zoom, 5.2 / zoom, 3.6 / zoom, 1.8 / zoom); ctx.stroke() }
    ctx.restore()
  }

  drawSelection(ctx, object, zoom, interactive) {
    const b = boxOf(object), primary = this.theme.primary
    ctx.save()
    ctx.lineWidth = 1.5 / zoom; ctx.strokeStyle = primary; ctx.fillStyle = this.theme.surface
    if (!isLinear(object)) {
      const c = centerOf(b), pad = object.type === 'hotspot' ? 4 / zoom : 0
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate((b.rotation * Math.PI) / 180)
      ctx.strokeRect(-b.width / 2 - pad, -b.height / 2 - pad, b.width + pad * 2, b.height + pad * 2)
      ctx.restore()
    }
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
        ctx.fill(); ctx.stroke()
      }
    }
    ctx.restore()
  }

  drawGroupBox(ctx, objects, zoom) {
    const b = sceneBounds(objects), pad = 6 / zoom
    ctx.save()
    ctx.setLineDash([6 / zoom, 4 / zoom]); ctx.lineWidth = 1 / zoom; ctx.strokeStyle = this.theme.primary
    ctx.strokeRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2)
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
      if (hitObject(point, objects[index], slop)) return objects[index]
    }
    return null
  }
}
