// Hotspot pins. "screen" pins keep a constant on-screen size (map style) and
// are anchored at the centre of their stored box; "plan" pins live inside
// their world box and scale with zoom.
export const PIN_SIZES = { sm: 24, md: 32, lg: 44 }
const HEAD = 0.62 // head centre height above the tip, as a fraction of pin height

export function pinOf(object) {
  const pin = object.style?.pin ?? {}
  const size = PIN_SIZES[pin.size] ? pin.size : 'md'
  const scale = pin.scale === 'plan' ? 'plan' : 'screen'
  const t = object.transform ?? {}, g = object.geometry ?? {}
  const anchor = { x: Number(t.x ?? 0) + Number(g.width ?? 36) / 2, y: Number(t.y ?? 0) + Number(g.height ?? 36) / 2 }
  return { size, scale, anchor, height: PIN_SIZES[size] }
}

// World-space point inside a screen pin (head circle or the stem to the tip)?
export function hitPin(point, pin, zoom, slop = 4) {
  const h = pin.height / zoom, r = (pin.height * 0.36) / zoom, s = slop / zoom
  const head = { x: pin.anchor.x, y: pin.anchor.y - HEAD * h }
  if (Math.hypot(point.x - head.x, point.y - head.y) <= r + s) return true
  return Math.abs(point.x - pin.anchor.x) <= r * 0.5 + s && point.y <= pin.anchor.y + s && point.y >= head.y
}

export const PIN_HEAD = HEAD

export function labelsOverlap(rect, placed) {
  return placed.some((o) => rect.x < o.x + o.width && rect.x + rect.width > o.x && rect.y < o.y + o.height && rect.y + rect.height > o.y)
}
