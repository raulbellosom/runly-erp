// Page backgrounds. A map background fixes the page to metres on a tangent
// plane at `origin`, so it also sets calibration and coordinate system.
export const AUTO_CALIBRATION = Object.freeze({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, distance: 100, unit: 'm' })
const SCREEN = { unit: 'px', origin: { x: 0, y: 0 }, axis: 'screen' }
const invalid = () => Object.assign(new Error('El fondo de mapa no es válido.'), { status: 400 })
const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const sameCalibration = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Returns the page fields to write for a new `background` (current = page row).
export function pageGeoPatch(background, current) {
  if (background === null) {
    if (current?.background?.type !== 'map') return { background: null }
    return { background: null, coordinateSystem: SCREEN, ...(sameCalibration(current.calibration, AUTO_CALIBRATION) ? { calibration: null } : {}) }
  }
  if (background?.type !== 'map') return { background }
  const { lat, lng } = background.origin ?? {}
  if (!finite(lat) || !finite(lng) || lat < -85 || lat > 85 || lng < -180 || lng > 180) throw invalid()
  const bbox = background.bbox ?? null
  if (bbox !== null && (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(finite))) throw invalid()
  const origin = { lat, lng }
  return {
    background: { type: 'map', origin, label: typeof background.label === 'string' ? background.label.slice(0, 300) : null, bbox },
    calibration: { ...AUTO_CALIBRATION },
    coordinateSystem: { unit: 'm', axis: 'geo', origin },
  }
}
