import { Canvas2DRenderer, sceneBounds } from '../engine/Canvas2DRenderer.js'
import { LIGHT_THEME } from '../engine/theme.js'
import { resolveConnectors } from './connectors.js'

export const EXPORT_PADDING = 24
export const EXPORT_MAX = 8000

// Pixel size for exporting `bounds` at 2x (lower if it would exceed the cap).
export function exportSize(bounds) {
  const w = bounds.width + EXPORT_PADDING * 2, h = bounds.height + EXPORT_PADDING * 2
  const pixelRatio = Math.min(2, EXPORT_MAX / w, EXPORT_MAX / h)
  return { width: Math.round(w * pixelRatio), height: Math.round(h * pixelRatio), pixelRatio }
}

// Frames `bounds` inside a `size` (px) area with `padding`, zoom capped at
// `maxZoom` (uncapped for exports; 1 for the thumbnail so a small scene is
// not blown up). Unlike `engine/viewport.js#fitBounds` this has no fixed
// cap, since an export legitimately zooms in past 100% to fill its canvas.
function fitScene(bounds, size, padding, maxZoom) {
  const availableW = Math.max(1, size.width - padding * 2), availableH = Math.max(1, size.height - padding * 2)
  const zoom = Math.min(maxZoom, availableW / Math.max(bounds.width, 1), availableH / Math.max(bounds.height, 1))
  return {
    zoom, rotation: 0,
    x: size.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: size.height / 2 - (bounds.y + bounds.height / 2) * zoom,
  }
}

// Images are fetched with CORS so the canvas stays exportable; any that
// fail (no CORS, deleted file) are drawn as placeholders by the renderer.
async function loadImages(urls) {
  const images = new Map()
  await Promise.all(Object.entries(urls ?? {}).map(async ([fileId, url]) => {
    try {
      const response = await fetch(url, { mode: 'cors' })
      if (!response.ok) return
      const bitmap = await createImageBitmap(await response.blob())
      images.set(fileId, Object.assign(bitmap, { complete: true, naturalWidth: bitmap.width }))
    } catch { /* placeholder */ }
  }))
  return images
}

// Renders `objects` into a detached canvas at the given pixel size and
// returns the canvas element (callers read it with toBlob/toDataURL, or null
// for an empty scene). The canvas is attached offscreen while rendering so
// `readCanvasTheme` can resolve real design-system tokens (getComputedStyle
// on a detached node returns no custom properties) when `light` is not set.
export async function renderScene(objects, { width, height, padding = EXPORT_PADDING, imageUrls, bindings = {}, light = false, background = null, maxZoom = Infinity } = {}) {
  objects = resolveConnectors(objects)
  const bounds = sceneBounds(objects)
  if (!bounds) return null
  const canvas = document.createElement('canvas')
  canvas.style.position = 'fixed'
  canvas.style.left = '-10000px'
  canvas.style.top = '0'
  document.body.appendChild(canvas)
  try {
    const renderer = new Canvas2DRenderer(canvas)
    if (light) renderer.setTheme(LIGHT_THEME)
    renderer.resize(width, height, 1)
    const viewport = fitScene(bounds, { width, height }, padding, maxZoom)
    const draw = (images) => renderer.render({ objects, viewport, images, selectedIds: new Set(), grid: { enabled: false }, interactive: false, bindings, background })
    draw(await loadImages(imageUrls))
    // Drawing a cross-origin image without CORS taints the canvas and makes
    // every read (toBlob/toDataURL/getImageData) throw; a 1x1 readback is
    // the cheapest way to detect that before the caller encodes the image.
    try { canvas.getContext('2d').getImageData(0, 0, 1, 1) } catch { draw(new Map()) }
    return canvas
  } finally {
    canvas.remove()
  }
}
