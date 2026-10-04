// Stable field ids (spec 2026-10-03-rme3-module-platform-v2 §10.6): every
// Builder field gets an immutable `fieldId` (UUID v7), emitted as the field
// `id` in models/*.model.js, so a later rename keeps the column and its data.
// Assigned by the Builder service before publishing (never inside
// compileModule, which must stay deterministic for package classification).

export function uuidv7(now = Date.now()) {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  let ms = BigInt(now)
  for (let i = 5; i >= 0; i -= 1) { bytes[i] = Number(ms & 0xffn); ms >>= 8n }
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Returns { definition, changed }: fields without fieldId get one.
export function assignFieldIds(definition) {
  let changed = false
  const entities = (definition?.entities ?? []).map((entity) => ({
    ...entity,
    fields: (entity.fields ?? []).map((field) => {
      if (field.fieldId) return field
      changed = true
      return { ...field, fieldId: uuidv7() }
    }),
  }))
  return { definition: changed ? { ...definition, entities } : definition, changed }
}
