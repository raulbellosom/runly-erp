import { objectBounds } from '../engine/geometry.js'

export const MAX_SHARP_SIDE = 7200

// Extra resolution needed for a PDF page image at this zoom: 0 (the stored
// raster is enough) or a power of two (2, 4, 8…) relative to the raster,
// capped so the longest side stays under MAX_SHARP_SIDE.
export function neededBucket(object, zoom) {
  const p = object.properties ?? {}, width = Math.abs(object.geometry?.width ?? 0)
  if (!p.naturalWidth || !width) return 0
  const screenPx = width * zoom * (globalThis.devicePixelRatio || 1)
  const ratio = screenPx / p.naturalWidth
  if (ratio <= 1.2) return 0
  const longest = Math.max(p.naturalWidth, p.naturalHeight ?? p.naturalWidth)
  const cap = MAX_SHARP_SIDE / longest
  if (cap < 2) return 0
  let bucket = 2
  while (bucket < ratio && bucket * 2 <= cap) bucket *= 2
  return bucket
}

const intersects = (a, b) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y

// PDF page images (they carry sourceFileId + page) inside the visible area.
export function sharpCandidates(objects, viewportBounds) {
  return objects.filter((o) => o.type === 'image' && o.properties?.sourceFileId && o.properties?.page && intersects(objectBounds(o), viewportBounds))
}
