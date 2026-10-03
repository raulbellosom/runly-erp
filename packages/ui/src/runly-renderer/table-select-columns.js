// Select columns in Builder/ZIP tables often omit `type`/`options` (the form
// view has them). Fill them from the form blueprint so the table shows the
// option label as a colored badge instead of the raw stored value.

// "EN_PROCESO" -> "En proceso"; anything with lowercase is kept as written.
function humanize(value) {
  const text = String(value)
  if (text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text
  const words = text.replace(/_/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function normalizeSelectOptions(options) {
  if (!Array.isArray(options)) return null
  return options.map((option) => (option !== null && typeof option === 'object'
    ? { ...option, value: option.value, label: option.label ?? humanize(option.value) }
    : { value: option, label: humanize(option) }))
}

function formFields(blueprint) {
  const schema = blueprint?.schema ?? {}
  const sections = Array.isArray(schema.sections) ? schema.sections : []
  const tabs = Array.isArray(schema.tabs) ? schema.tabs : []
  return [
    ...sections.flatMap((section) => section?.fields ?? []),
    ...tabs.flatMap((tab) => (tab?.sections ?? []).flatMap((section) => section?.fields ?? [])),
    ...(Array.isArray(schema.fields) ? schema.fields : []),
  ].filter((field) => field && typeof field === 'object')
}

export function withSelectColumnOptions(tableBlueprint, formBlueprint) {
  const columns = tableBlueprint?.schema?.columns
  if (!Array.isArray(columns)) return tableBlueprint
  const selects = new Map(formFields(formBlueprint)
    .filter((field) => field.type === 'select' && Array.isArray(field.options))
    .map((field) => [String(field.field ?? field.name ?? field.key), field.options]))
  let changed = false
  const next = columns.map((column) => {
    if (!column || typeof column !== 'object') return column
    const name = String(column.field ?? column.key ?? column.name ?? '')
    const source = column.options ?? (column.type == null || column.type === 'select' ? selects.get(name) : null)
    if (!source) return column
    changed = true
    return { ...column, type: 'select', options: normalizeSelectOptions(source) }
  })
  return changed ? { ...tableBlueprint, schema: { ...tableBlueprint.schema, columns: next } } : tableBlueprint
}
