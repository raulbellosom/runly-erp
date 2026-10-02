import { objectBounds } from '../../engine/geometry.js'

// Runtime/positional fields that only make sense inside the Board they were
// read from; a library item must be safe to drop onto any Board/page/layer.
const STRIP_KEYS = ['id', 'pageId', 'layerId', 'revision', 'position', 'pending', 'hotspot', 'createdAt', 'updatedAt']

function sceneBoundsOf(objects) {
  if (!objects.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const object of objects) {
    const box = objectBounds(object)
    minX = Math.min(minX, box.x); minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width); maxY = Math.max(maxY, box.y + box.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function stripObject(object) {
  const clean = { ...object }
  for (const key of STRIP_KEYS) delete clean[key]
  return clean
}

function translate(object, dx, dy) {
  const transform = object.transform ?? {}
  return { ...object, transform: { ...transform, x: (transform.x ?? 0) + dx, y: (transform.y ?? 0) + dy } }
}

// Relative-coordinate payload for a library item (saved selection or an
// imported element): the bounding box of `objects` is moved to (0,0) so the
// item can be re-centred anywhere on insert. Returns the shape persisted at
// CanvasLibraryItem.payload: `{ objects, width, height }`.
export function normalizeObjects(objects) {
  const cleaned = (objects ?? []).map(stripObject)
  const bounds = sceneBoundsOf(cleaned)
  if (!bounds) return { objects: [], width: 0, height: 0 }
  const translated = cleaned.map((object) => translate(object, -bounds.x, -bounds.y))
  return { objects: translated, width: bounds.width, height: bounds.height }
}

// Places a normalized item's objects (already relative to (0,0), as stored
// in `item.objects`/`item.payload.objects`) at `origin`, keeping their
// original relative order and offsets.
export function placeObjects(item, origin) {
  const objects = item?.objects ?? []
  return objects.map((object) => translate(object, origin?.x ?? 0, origin?.y ?? 0))
}
