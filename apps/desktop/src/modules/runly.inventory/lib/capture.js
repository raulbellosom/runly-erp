// Capture helpers for the new-asset form: pinned fields that survive saves and
// reloads (stored in this browser), and bulk creation from a list of serials.

export const MAX_BULK_SERIALS = 200

// Groups of form fields the user can pin together.
export const PIN_GROUPS = [
  { key: 'name', label: 'Nombre', fields: ['name'] },
  { key: 'classification', label: 'Modelo, tipo y marca', fields: ['modelId', 'model', 'categoryId', 'brandId'] },
  { key: 'location', label: 'Ubicación', fields: ['locationId'] },
  { key: 'status', label: 'Estado', fields: ['status'] },
  { key: 'purchase', label: 'Compra', fields: ['purchaseDate', 'purchasePrice', 'vendorName', 'invoiceNumber'] },
  { key: 'warranty', label: 'Garantía', fields: ['warrantyExpiry', 'warrantyNotes'] },
  { key: 'notes', label: 'Notas', fields: ['notes'] },
]

export const DEFAULT_CAPTURE = { pinned: [], values: {}, continuous: false, multi: false }

// Serials separated by commas, semicolons, spaces or new lines. Repeats are
// dropped (first occurrence kept) and reported.
export function parseSerials(text) {
  const serials = []
  const repeated = []
  const seen = new Set()
  for (const raw of String(text ?? '').split(/[\s,;]+/)) {
    const serial = raw.trim()
    if (!serial) continue
    if (seen.has(serial)) { if (!repeated.includes(serial)) repeated.push(serial) } else { seen.add(serial); serials.push(serial) }
  }
  return { serials, repeated }
}

export function pinnedValues(values, pinned) {
  const out = {}
  for (const group of PIN_GROUPS) {
    if (!pinned.includes(group.key)) continue
    for (const field of group.fields) {
      const value = values?.[field]
      if (value !== undefined && value !== null && value !== '') out[field] = value
    }
  }
  return out
}

export function bulkUnitName(name, serial) {
  return `${String(name ?? '').trim()} · ${serial}`.slice(0, 255)
}

export function captureStorageKey(companyId, userId) {
  return companyId && userId ? `runly.inventory.capture:${companyId}:${userId}` : null
}

export function loadCapture(key, storage = globalThis.localStorage) {
  if (!key) return DEFAULT_CAPTURE
  try {
    const parsed = JSON.parse(storage?.getItem(key) ?? 'null')
    return parsed && typeof parsed === 'object' ? { ...DEFAULT_CAPTURE, ...parsed } : DEFAULT_CAPTURE
  } catch { return DEFAULT_CAPTURE }
}

export function saveCapture(key, state, storage = globalThis.localStorage) {
  if (!key) return
  try { storage?.setItem(key, JSON.stringify(state)) } catch { /* private mode / quota: pinning just won't persist */ }
}
