// Pure shape-conversion helpers: turning a closed shape (rectangle, ellipse,
// triangle, diamond) or a linear one (line, arrow) into another member of
// the same family, keeping position, size, style, bindings and connections.
import { POLYGON_POINTS } from './objectFactory.js'

export const SHAPE_KINDS = { closed: ['rectangle', 'ellipse', 'triangle', 'diamond'], linear: ['line', 'arrow'] }

// The "kind" a user picks in the inspector/menu: the object's own type,
// except polygons, which are reported as the named shape they represent
// (triangle/diamond) so the Choice field can highlight the right option.
export function shapeKindOf(object) {
  if (object?.type === 'polygon') return object.properties?.shape ?? 'polygon'
  return object?.type
}

// Returns the object patched to the requested kind (type/geometry/properties
// only — the caller merges this into a real update). Returns the same
// reference when the kind is already current, so callers can skip a no-op
// patch.
export function convertShape(object, kind) {
  if (shapeKindOf(object) === kind) return object
  const toPolygon = Boolean(POLYGON_POINTS[kind])
  const type = toPolygon ? 'polygon' : kind
  const { shape: _shape, ...restProperties } = object.properties ?? {}
  const properties = toPolygon ? { ...restProperties, shape: kind } : restProperties
  const { points: _points, ...restGeometry } = object.geometry ?? {}
  const geometry = toPolygon ? { ...restGeometry, points: POLYGON_POINTS[kind] } : restGeometry
  return { ...object, type, geometry, properties }
}
