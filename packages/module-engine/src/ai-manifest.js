// Validation for the optional manifest `ai` section (spec:
// docs/superpowers/specs/2026-09-28-module-ai-public-lookup-design.md).
//
//   ai: { publicLookup: [{ model: 'vehicles', publicFields: ['make', 'model', 'year'], topics: ['ficha tecnica'] }] }
//
// publicFields are the only record values ever sent to an internet search, so
// fields that identify a unit, person or company are rejected.

const IDENTIFYING_FIELD_RE = /^(serial|assettag|asset_tag|plate|placa|vin|owner|email|phone|telefono|notes|notas|address|direccion)/i
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/

export function isIdentifyingAiField(key) {
  return IDENTIFYING_FIELD_RE.test(String(key ?? '').replace(/[\s-]/g, ''))
}

export function validateAiManifest(ai, errors) {
  if (ai === undefined) return
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) { errors.push('ai must be an object'); return }
  if (ai.publicLookup === undefined) return
  if (!Array.isArray(ai.publicLookup)) { errors.push('ai.publicLookup must be an array'); return }
  const seen = new Set()
  ai.publicLookup.forEach((entry, i) => {
    const at = `ai.publicLookup[${i}]`
    if (!entry || typeof entry !== 'object') { errors.push(`${at} must be an object`); return }
    if (typeof entry.model !== 'string' || !KEY_RE.test(entry.model)) errors.push(`${at}.model must be a model name`)
    else if (seen.has(entry.model)) errors.push(`${at}.model "${entry.model}" is declared twice`)
    else seen.add(entry.model)
    if (!Array.isArray(entry.publicFields) || !entry.publicFields.length || entry.publicFields.length > 8) {
      errors.push(`${at}.publicFields must list 1-8 field keys`)
    } else {
      entry.publicFields.forEach((field) => {
        if (typeof field !== 'string' || !KEY_RE.test(field)) errors.push(`${at}.publicFields contains an invalid key`)
        else if (isIdentifyingAiField(field)) errors.push(`${at}.publicFields must not include identifying field "${field}"`)
      })
    }
    if (entry.topics !== undefined && (!Array.isArray(entry.topics) || entry.topics.length > 6 || entry.topics.some(t => typeof t !== 'string' || !t.trim() || t.length > 80))) {
      errors.push(`${at}.topics must be up to 6 short strings`)
    }
  })
}
