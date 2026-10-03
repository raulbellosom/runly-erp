// Human label of a record for titles, sheet headers and confirmations. Never
// an id: a UUID as a title tells the user nothing (reported 2026-10-03 on a
// Builder module whose first field was a relation).
//
// Order: well-known name keys -> the blueprint's declared title/label field ->
// the first text-like field of the blueprints' sections/columns -> a relation's
// resolved label (`<field>__label`) -> null (callers fall back to the entity
// label or a generic word).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NAME_KEYS = ['name', 'nombre', 'full_name', 'fullName', 'title', 'titulo', 'label', 'plate', 'placa', 'code', 'codigo', 'folio', 'description', 'descripcion']
const TEXT_TYPES = new Set([undefined, null, '', 'text', 'string', 'email', 'phone', 'select', 'textarea', 'markdown'])

function usable(value) {
  if (value === null || value === undefined || typeof value === 'object') return null
  const text = String(value).trim()
  if (!text || UUID_RE.test(text)) return null
  return text.length > 120 ? `${text.slice(0, 117)}…` : text
}

const isIdLike = (name) => name === 'id' || /(?:^|_)id$/i.test(name) || /Id$/.test(name) || name.endsWith('__url')

// [{ name, type }] in display order, from schema.sections[].fields / schema.fields / schema.columns.
function blueprintFields(blueprint) {
  const schema = blueprint?.schema ?? {}
  const out = []
  const push = (entry) => {
    if (!entry) return
    if (typeof entry === 'string') out.push({ name: entry, type: undefined })
    else if (typeof entry === 'object') {
      const name = String(entry.field ?? entry.name ?? entry.key ?? '').trim()
      if (name) out.push({ name, type: entry.type })
    }
  }
  for (const section of Array.isArray(schema.sections) ? schema.sections : []) {
    for (const field of Array.isArray(section?.fields) ? section.fields : []) push(field)
  }
  for (const field of Array.isArray(schema.fields) ? schema.fields : []) push(field)
  for (const column of Array.isArray(schema.columns) ? schema.columns : []) push(column)
  return out
}

export function resolveRecordLabel(record, blueprints = []) {
  if (!record || typeof record !== 'object') return null
  for (const key of NAME_KEYS) {
    const label = usable(record[key])
    if (label) return label
  }
  const list = (Array.isArray(blueprints) ? blueprints : [blueprints]).filter(Boolean)
  for (const blueprint of list) {
    const schema = blueprint?.schema ?? {}
    for (const key of [schema.hero?.titleField, schema.titleField, schema.labelField]) {
      const label = key ? usable(record[key]) : null
      if (label) return label
    }
  }
  const fields = list.flatMap(blueprintFields)
  for (const field of fields) {
    if (isIdLike(field.name) || !TEXT_TYPES.has(field.type)) continue
    const label = usable(record[field.name])
    if (label) return label
  }
  for (const field of fields) {
    const label = usable(record[`${field.name.replace(/__label$/, '')}__label`])
    if (label) return label
  }
  for (const [key, value] of Object.entries(record)) {
    if (key.endsWith('__label')) {
      const label = usable(value)
      if (label) return label
    }
  }
  return null
}
