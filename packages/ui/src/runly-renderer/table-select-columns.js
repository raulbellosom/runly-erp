// Select columns in Builder/ZIP tables often omit `type`/`options` (the form
// view has them). Fill them from the form blueprint so the table shows the
// option label as a colored badge instead of the raw stored value.

import { accentFor } from './records-view-format.js'

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

const KPI_TYPES = { date: 'date', datetime: 'datetime', decimal: 'currency', number: 'number', boolean: 'boolean' }

function formFieldMap(formBlueprint) {
  return new Map(formFields(formBlueprint).map((field) => [String(field.field ?? field.name ?? field.key), field]))
}

// Generated detail views name fields without display types: the hero subtitle
// points at a relation's raw id, KPIs show ISO dates and the status is plain
// text. Fill them from the form blueprint (relation -> `<field>__label`,
// select -> labeled pill, date -> formatted date). Explicit values win.
export function withDetailFieldTypes(detailBlueprint, formBlueprint) {
  const schema = detailBlueprint?.schema
  const fields = formFieldMap(formBlueprint)
  if (!schema || fields.size === 0) return detailBlueprint
  const select = (name) => {
    const field = fields.get(name)
    return field?.type === 'select' && Array.isArray(field.options) ? normalizeSelectOptions(field.options) : null
  }
  const next = { ...schema }
  if (schema.hero && typeof schema.hero === 'object') {
    const hero = { ...schema.hero }
    if (Array.isArray(hero.subtitleFields)) {
      hero.subtitleFields = hero.subtitleFields.map((name) => (fields.get(name)?.type === 'relation' ? `${name}__label` : name))
    }
    const statusOptions = hero.statusField && !hero.statusOptions && !hero.statusMap ? select(hero.statusField) : null
    if (statusOptions) {
      hero.statusOptions = statusOptions.map((option) => ({ ...option, color: option.color ?? accentFor({ options: statusOptions }, option.value) }))
    }
    next.hero = hero
  }
  if (Array.isArray(schema.kpis)) {
    next.kpis = schema.kpis.map((kpi) => {
      if (!kpi || typeof kpi !== 'object' || kpi.type) return kpi
      const options = select(kpi.field)
      if (options) return { ...kpi, type: 'select', options }
      const type = KPI_TYPES[fields.get(kpi.field)?.type]
      return type ? { ...kpi, type } : kpi
    })
  }
  if (Array.isArray(schema.sections)) {
    next.sections = schema.sections.map((section) => {
      if (!Array.isArray(section?.fields)) return section
      return {
        ...section,
        fields: section.fields.map((entry) => {
          if (!entry || typeof entry !== 'object' || entry.type) return entry
          const options = select(String(entry.field ?? entry.name ?? ''))
          return options ? { ...entry, type: 'select', options } : entry
        }),
      }
    })
  }
  return { ...detailBlueprint, schema: next }
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
