// Grid snapping in world units. A size of 0 means snapping is off.
export const snapValue = (value, size) => (size ? Math.round(value / size) * size : value)
export const snapPoint = (point, size) => ({ x: snapValue(point.x, size), y: snapValue(point.y, size) })

// Offset that lands the dragged group's top-left corner on the grid.
export function snapMoveDelta(bounds, dx, dy, size) {
  if (!size) return { dx, dy }
  return { dx: snapValue(bounds.x + dx, size) - bounds.x, dy: snapValue(bounds.y + dy, size) - bounds.y }
}

// Snap step for a Board: off unless the grid is visible and snapping is on.
export function snapSizeFor(settings) {
  return settings?.snapping && settings?.grid?.enabled ? settings.grid.size : 0
}
