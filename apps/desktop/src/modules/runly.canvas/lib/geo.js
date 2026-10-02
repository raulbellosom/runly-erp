// Web Mercator (EPSG:3857) and a local tangent frame: world units are
// mercator metres scaled by cos(lat0), i.e. ~ground metres near the origin,
// with y growing south like the canvas.
const R = 6378137, EARTH = 40075016.686, TILE = 512
const rad = (deg) => (deg * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI

export function mercator({ lat, lng }) {
  return { x: R * rad(lng), y: R * Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2)) }
}
export function inverseMercator({ x, y }) {
  return { lat: deg(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2), lng: deg(x / R) }
}

export function createGeoFrame(origin) {
  const o = mercator(origin), k = Math.cos(rad(origin.lat))
  return {
    origin, k,
    toWorld(point) { const m = mercator(point); return { x: (m.x - o.x) * k + 0, y: -(m.y - o.y) * k + 0 } },
    toLatLng(world) { return inverseMercator({ x: o.x + world.x / k, y: o.y - world.y / k }) },
  }
}

// MapLibre camera matching a canvas viewport (screen = world * zoom + offset).
export function mapCamera(viewport, size, frame) {
  const center = frame.toLatLng({ x: (size.width / 2 - viewport.x) / viewport.zoom, y: (size.height / 2 - viewport.y) / viewport.zoom })
  return { center, zoom: Math.log2((EARTH * frame.k * viewport.zoom) / TILE) }
}

// Nominatim bbox [south, north, west, east] -> world rectangle.
export function worldBoundsOfBbox(bbox, frame) {
  const [south, north, west, east] = bbox
  const a = frame.toWorld({ lat: north, lng: west }), b = frame.toWorld({ lat: south, lng: east })
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}
