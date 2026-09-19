export const IDENTIFIER_FIELDS = ['serialNumber', 'partNumber', 'assetTag']
export function identifiersFor(unit, common) {
  return { serialNumber: unit.serialNumber || null, partNumber: (unit.partNumber ?? common.partNumber) || null, assetTag: unit.assetTag || null }
}
export function confirmationKey(unit, common) { return JSON.stringify(identifiersFor(unit, common)) }
export function collectSuggestions(images) {
  const fields = {}
  for (const image of images) for (const observation of image.result?.observations ?? []) {
    if (!observation.value) continue
    const list = fields[observation.field] ?? (fields[observation.field] = [])
    const compare = value => ['brandName', 'categoryName'].includes(observation.field) ? value.trim().toLocaleLowerCase('es') : value
    const existing = list.find(o => compare(o.value) === compare(observation.value))
    if (existing) {
      if (!existing.imageIds.includes(image.id)) existing.imageIds.push(image.id)
      if (observation.status !== 'observed') existing.uncertain = true
    } else list.push({ value: observation.value, uncertain: observation.status !== 'observed', imageIds: [image.id] })
  }
  return fields
}
export async function intakeRequest({ apiBaseUrl, token, companyId, path, body, signal, method }) {
  const form = body instanceof FormData
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'), signal,
    headers: { Authorization: `Bearer ${token}`, 'X-Runly-Company-Id': companyId, ...(!form && body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: form ? body : JSON.stringify(body) } : {}),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) { const error = new Error(payload.error || 'No se pudo completar la operación.'); error.status = response.status; error.issues = payload.issues ?? []; throw error }
  return payload.data
}
