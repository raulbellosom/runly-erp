import { sceneBounds } from '../engine/Canvas2DRenderer.js'
import { fitBounds } from '../engine/viewport.js'
import { renderScene } from './renderScene.js'

export const THUMB_WIDTH = 640
export const THUMB_HEIGHT = 360

// `fitBounds` already caps zoom at 1 and centers the scene, so the
// thumbnail viewport is just a fit into the thumbnail dimensions.
export function thumbnailViewport(bounds) {
  if (!bounds) return null
  return fitBounds(bounds, { width: THUMB_WIDTH, height: THUMB_HEIGHT }, 24)
}

// Renders a Board's objects into a detached canvas and returns a PNG blob
// (or null for an empty scene), reusing the app's current theme and capping
// zoom at 1 so a single small object is not blown up.
export async function renderThumbnail(objects, { imageUrls } = {}) {
  if (!thumbnailViewport(sceneBounds(objects))) return null
  const canvas = await renderScene(objects, { width: THUMB_WIDTH, height: THUMB_HEIGHT, padding: 24, imageUrls, maxZoom: 1 })
  if (!canvas) return null
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}
