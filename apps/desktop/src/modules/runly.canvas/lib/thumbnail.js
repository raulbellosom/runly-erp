import { Canvas2DRenderer, sceneBounds } from '../engine/Canvas2DRenderer.js'
import { fitBounds } from '../engine/viewport.js'

export const THUMB_WIDTH = 640
export const THUMB_HEIGHT = 360

// `fitBounds` already caps zoom at 1 and centers the scene, so the
// thumbnail viewport is just a fit into the thumbnail dimensions.
export function thumbnailViewport(bounds) {
  if (!bounds) return null
  return fitBounds(bounds, { width: THUMB_WIDTH, height: THUMB_HEIGHT }, 24)
}

// Images for the thumbnail are fetched with CORS so the canvas stays
// exportable; any that fail are drawn as placeholders.
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

// Renders a Board's objects into a detached canvas and returns a PNG blob
// (or null for an empty scene). The canvas is attached offscreen while
// rendering so `readCanvasTheme` can resolve real design-system tokens
// (getComputedStyle on a detached node returns no custom properties).
export async function renderThumbnail(objects, { imageUrls } = {}) {
  const viewport = thumbnailViewport(sceneBounds(objects))
  if (!viewport) return null
  const canvas = document.createElement('canvas')
  canvas.style.position = 'fixed'
  canvas.style.left = '-10000px'
  canvas.style.top = '0'
  document.body.appendChild(canvas)
  try {
    const renderer = new Canvas2DRenderer(canvas)
    renderer.resize(THUMB_WIDTH, THUMB_HEIGHT, 1)
    const draw = (images) => renderer.render({ objects, viewport, images, selectedIds: new Set(), grid: { enabled: false }, interactive: false })
    const toBlob = () => new Promise((resolve, reject) => { try { canvas.toBlob(resolve, 'image/png') } catch (error) { reject(error) } })
    draw(await loadImages(imageUrls))
    try { return await toBlob() } catch { draw(new Map()); return toBlob() }
  } finally {
    canvas.remove()
  }
}
