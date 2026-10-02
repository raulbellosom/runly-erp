// CanvasPage.calibration: two world points and the real distance between
// them. Everything measured on the page scales by distance / |b - a|.
export const CALIBRATION_UNITS = ['m', 'cm', 'mm', 'ft']
const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const invalid = () => Object.assign(new Error('La calibración de escala no es válida.'), { status: 400 })

export function normalizeCalibration(input) {
  if (input === null) return null
  if (!input || typeof input !== 'object') throw invalid()
  const { a, b, distance, unit } = input
  if (![a?.x, a?.y, b?.x, b?.y].every(finite) || Math.hypot(b.x - a.x, b.y - a.y) < 1) throw invalid()
  if (!finite(distance) || distance <= 0 || !CALIBRATION_UNITS.includes(unit)) throw invalid()
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, distance, unit }
}
