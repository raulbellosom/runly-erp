import { screenToWorld } from './viewport.js'
import { readCanvasTheme } from './theme.js'

const GRID_STEP = 24
const HANDLE_SIZE = 8

export function objectBounds(object) {
  const t = object.transform ?? {}
  const g = object.geometry ?? {}
  const x = Number(t.x ?? 0), y = Number(t.y ?? 0)
  if (object.type === 'line' || object.type === 'arrow') {
    const x2 = x + Number(g.x2 ?? g.width ?? 0), y2 = y + Number(g.y2 ?? g.height ?? 0)
    return { x: Math.min(x, x2), y: Math.min(y, y2), width: Math.abs(x2 - x) || 8, height: Math.abs(y2 - y) || 8 }
  }
  return { x, y, width: Number(g.width ?? 120), height: Number(g.height ?? 80) }
}

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

  setTheme(theme) {
    this.theme = theme
    if (this.scene) this.render(this.scene)
  }

  resize(width, height, dpr = window.devicePixelRatio || 1) {
    const nextWidth = Math.max(1, Math.floor(width * dpr)), nextHeight = Math.max(1, Math.floor(height * dpr))
    if (this.canvas.width !== nextWidth || this.canvas.height !== nextHeight) {
      this.canvas.width = nextWidth; this.canvas.height = nextHeight
      this.canvas.style.width = `${width}px`; this.canvas.style.height = `${height}px`
    }
    this.dpr = dpr
    this.width = width
    this.height = height
    if (this.scene) this.render(this.scene)
  }

  render(scene) {
    this.scene = scene
    const { objects, viewport, selectedId } = scene
    const ctx = this.context, dpr = this.dpr || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    this.drawGrid(ctx, viewport)
    ctx.save()
    ctx.translate(viewport.x, viewport.y); ctx.scale(viewport.zoom, viewport.zoom)
    let selected = null
    for (const object of objects) {
      this.drawObject(ctx, object, viewport.zoom)
      if (object.id === selectedId) selected = object
    }
    if (selected) this.drawSelection(ctx, selected, viewport.zoom)
    ctx.restore()
  }

  // Dot grid drawn in screen space so it stays crisp at any zoom; the step
  // doubles while dots would be closer than 12px to avoid visual noise.
  drawGrid(ctx, viewport) {
    let step = GRID_STEP * viewport.zoom
    while (step < 12) step *= 2
    const offsetX = ((viewport.x % step) + step) % step
    const offsetY = ((viewport.y % step) + step) % step
    const size = viewport.zoom >= 0.75 ? 1.5 : 1
    ctx.fillStyle = this.theme.grid
    for (let x = offsetX; x < this.width; x += step) {
      for (let y = offsetY; y < this.height; y += step) ctx.fillRect(x - size / 2, y - size / 2, size, size)
    }
  }

  drawObject(ctx, object, zoom) {
    const bounds = objectBounds(object), style = object.style ?? {}, theme = this.theme
    const isHotspot = object.type === 'hotspot'
    const stroke = style.stroke ?? (isHotspot ? theme.hotspot : theme.primary)
    ctx.save()
    ctx.globalAlpha = Number(style.opacity ?? 1)
    ctx.lineWidth = Number(style.strokeWidth ?? 1.5)
    ctx.strokeStyle = stroke
    ctx.lineJoin = 'round'
    if (isHotspot) {
      this.drawHotspot(ctx, bounds, stroke, zoom)
    } else if (object.type === 'ellipse') {
      ctx.beginPath(); ctx.ellipse(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width / 2, bounds.height / 2, 0, 0, Math.PI * 2)
      this.fillSoft(ctx, style.fill ?? stroke); ctx.stroke()
    } else if (object.type === 'line' || object.type === 'arrow') {
      ctx.beginPath(); ctx.moveTo(bounds.x, bounds.y); ctx.lineTo(bounds.x + bounds.width, bounds.y + bounds.height); ctx.stroke()
    } else if (object.type === 'text') {
      ctx.fillStyle = style.fill ?? theme.foreground
      ctx.font = `500 ${Number(style.fontSize ?? 16)}px ${theme.font}`
      ctx.textBaseline = 'top'
      ctx.fillText(object.properties?.text ?? 'Texto', bounds.x, bounds.y)
    } else {
      const radius = Number(style.radius ?? 8)
      ctx.beginPath(); ctx.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, radius)
      this.fillSoft(ctx, style.fill ?? stroke); ctx.stroke()
    }
    ctx.restore()
  }

  fillSoft(ctx, color) {
    const alpha = ctx.globalAlpha
    ctx.globalAlpha = alpha * 0.14
    ctx.fillStyle = color
    ctx.fill()
    ctx.globalAlpha = alpha
  }

  drawHotspot(ctx, bounds, color, zoom) {
    const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2
    const r = Math.min(bounds.width, bounds.height) / 2
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
    this.fillSoft(ctx, color)
    ctx.lineWidth = 2 / Math.max(zoom, 0.5); ctx.stroke()
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.38, 0, Math.PI * 2)
    ctx.fillStyle = color; ctx.fill()
  }

  // Selection chrome keeps a constant on-screen thickness regardless of zoom.
  drawSelection(ctx, object, zoom) {
    const b = objectBounds(object), pad = 4 / zoom, handle = HANDLE_SIZE / zoom
    const x = b.x - pad, y = b.y - pad, w = b.width + pad * 2, h = b.height + pad * 2
    ctx.save()
    ctx.lineWidth = 1.5 / zoom
    ctx.strokeStyle = this.theme.primary
    ctx.strokeRect(x, y, w, h)
    ctx.fillStyle = this.theme.surface
    for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      ctx.beginPath(); ctx.rect(hx - handle / 2, hy - handle / 2, handle, handle); ctx.fill(); ctx.stroke()
    }
    ctx.restore()
  }

  hitTest(screenPoint, objects, viewport, tolerance = 6) {
    const point = screenToWorld(screenPoint, viewport), slop = tolerance / viewport.zoom
    for (let index = objects.length - 1; index >= 0; index -= 1) {
      const bounds = objectBounds(objects[index])
      if (point.x >= bounds.x - slop && point.x <= bounds.x + bounds.width + slop && point.y >= bounds.y - slop && point.y <= bounds.y + bounds.height + slop) return objects[index]
    }
    return null
  }
}
