// Normalization + reference validation for the records view kinds (CARDS,
// CALENDAR, TIMELINE, REPORT). Kept out of definition.js so that file stays
// focused on the module-level contract; mirrors the Kanban helpers there.
import { RECORDS_VIEW_DATE_FIELD_TYPES, RECORDS_VIEW_KINDS, validateRecordsViewSchema } from '@runly/module-engine'
import { moduleSlug, toKebab } from './templates/helpers.js'

export { RECORDS_VIEW_KINDS }

const PATH_SUFFIX = { CARDS: 'cards', CALENDAR: 'calendar', TIMELINE: 'timeline', REPORT: 'report' }
const NUMERIC_TYPES = new Set(['number', 'decimal'])
const SYSTEM_FIELDS = new Set(['created_at', 'updated_at'])

function diagnostic(path, code, message) {
  return { path, code, message, severity: 'error' }
}

export function isRecordsViewKind(kind) {
  return RECORDS_VIEW_KINDS.includes(kind)
}

export function recordsViewSchemaFromView(view, definition) {
  if (view.schema) return view.schema
  const entity = view.entity
  const slug = moduleSlug(definition.key ?? 'custom.invalid')
  const base = {
    title: view.title ?? definition.name,
    description: view.description,
    path: view.path ?? `/app/m/${definition.key}/${entity}-${PATH_SUFFIX[view.kind]}`,
    entity,
    apiPath: view.apiPath ?? `/${slug}/${toKebab(entity ?? '')}s`,
    filters: view.filters ?? [],
  }
  if (view.orderBy) base.orderBy = view.orderBy
  if (view.kind === 'CARDS') return { ...base, card: view.card ?? {}, limit: view.limit ?? 200 }
  if (view.kind === 'CALENDAR') return { ...base, dateField: view.dateField, titleField: view.titleField, colorField: view.colorField || undefined, limit: view.limit ?? 500 }
  if (view.kind === 'TIMELINE') return { ...base, dateField: view.dateField, titleField: view.titleField, descriptionField: view.descriptionField || undefined, badgeField: view.badgeField || undefined, limit: view.limit ?? 200 }
  return { ...base, groupBy: view.groupBy, measures: view.measures ?? [] }
}

export function normalizeRecordsView(view, definition) {
  return { key: view.key, kind: view.kind, version: view.version ?? '0.1.0', generated: false, schema: recordsViewSchemaFromView(view, definition) }
}

function diagnosticCode(message) {
  if (message.includes('path')) return 'UNSAFE_PATH'
  if (message.includes('filters')) return 'INVALID_FILTER'
  if (message.includes('orderBy')) return 'INVALID_ORDER_FIELD'
  if (message.includes('measures')) return 'INVALID_REPORT_MEASURE'
  return 'INVALID_RECORDS_VIEW'
}

export function validateRecordsView(view, definition, viewIndex, errors) {
  const schema = recordsViewSchemaFromView(view, definition)
  const path = `views[${viewIndex}].schema`
  for (const message of validateRecordsViewSchema(view.kind, schema).errors) errors.push(diagnostic(`views[${viewIndex}]`, diagnosticCode(message), message))

  const entity = (definition.entities ?? []).find((item) => item.key === schema.entity)
  if (!entity) return
  const fields = new Map((entity.fields ?? []).map((field) => [field.key, field]))
  const expectField = (property, fieldKey, { types, allowSystem = false, display = true } = {}) => {
    if (!fieldKey) return
    const field = fields.get(fieldKey)
    if (!field) {
      if (allowSystem && SYSTEM_FIELDS.has(fieldKey)) return
      errors.push(diagnostic(`${path}.${property}`, 'UNKNOWN_FIELD', `Unknown field "${fieldKey}".`))
      return
    }
    if (display && field.type === 'relation') errors.push(diagnostic(`${path}.${property}`, 'UNSUPPORTED_FIELD', 'Relation fields cannot be displayed in this view yet.'))
    if (types && !types.includes(field.type)) errors.push(diagnostic(`${path}.${property}`, 'INVALID_FIELD_TYPE', `"${fieldKey}" must be of type ${types.join(' or ')}.`))
  }

  if (view.kind === 'CARDS') {
    expectField('card.titleField', schema.card?.titleField)
    expectField('card.subtitleField', schema.card?.subtitleField)
    expectField('card.descriptionField', schema.card?.descriptionField)
    expectField('card.badgeField', schema.card?.badgeField)
    expectField('card.imageField', schema.card?.imageField, { types: ['file'] })
  }
  if (view.kind === 'CALENDAR' || view.kind === 'TIMELINE') {
    expectField('dateField', schema.dateField, { types: RECORDS_VIEW_DATE_FIELD_TYPES, allowSystem: true })
    expectField('titleField', schema.titleField)
  }
  if (view.kind === 'CALENDAR') expectField('colorField', schema.colorField, { types: ['select', 'boolean'] })
  if (view.kind === 'TIMELINE') {
    expectField('descriptionField', schema.descriptionField)
    expectField('badgeField', schema.badgeField)
  }
  if (view.kind === 'REPORT') {
    expectField('groupBy', schema.groupBy)
    for (const [index, measure] of (schema.measures ?? []).entries()) {
      if (measure.aggregate === 'count') continue
      const numeric = ['sum', 'avg'].includes(measure.aggregate)
      expectField(`measures[${index}].field`, measure.field, { types: numeric ? [...NUMERIC_TYPES] : undefined, display: false })
    }
  }
  const available = new Set([...fields.keys(), ...SYSTEM_FIELDS])
  if (schema.orderBy && !available.has(schema.orderBy.field)) errors.push(diagnostic(`${path}.orderBy.field`, 'INVALID_ORDER_FIELD', `Unknown order field "${schema.orderBy.field}".`))
  for (const filter of schema.filters ?? []) if (!available.has(filter.field) && filter.field !== 'enabled') errors.push(diagnostic(`${path}.filters`, 'INVALID_FILTER', `Unknown filter field "${filter.field}".`))
}
