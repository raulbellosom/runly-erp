// Declarative "records views" (CARDS, CALENDAR, TIMELINE, REPORT): read-only
// presentations of one owned entity, queried through the API's records-view
// endpoint. Same safety model as kanban-schema.js — identifiers only, no
// SQL/table/company controls, path confined to the module.
import { DATA_VIEW_IDENTIFIER, validateDataViewFilters, validateDataViewOrder } from './data-view-schema.js'

export const RECORDS_VIEW_KINDS = Object.freeze(['CARDS', 'CALENDAR', 'TIMELINE', 'REPORT'])
export const RECORDS_VIEW_DATE_FIELD_TYPES = Object.freeze(['date', 'datetime'])
export const RECORDS_VIEW_DEFAULT_LIMIT = 200
export const RECORDS_VIEW_MAX_LIMIT = 500
export const REPORT_AGGREGATES = Object.freeze(['count', 'sum', 'avg', 'min', 'max'])
export const REPORT_MAX_MEASURES = 6
export const REPORT_MAX_GROUPS = 100

const PATH = /^\/app\/m\/[a-z][a-z0-9]*\.[a-z][a-z0-9_]*(?:\/[a-zA-Z0-9._~-]+)*$/
const API_PATH = /^\/[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)+$/
const FORBIDDEN_KEYS = ['sql', 'query', 'table', 'companyId', 'company_id', 'companyScoped']

function checkIdentifier(errors, value, label, required) {
  if (value == null && !required) return
  if (!DATA_VIEW_IDENTIFIER.test(value ?? '')) errors.push(`${label} ${required ? 'is required' : 'is invalid'}`)
}

function validateReportMeasures(schema, errors) {
  const measures = schema.measures
  if (!Array.isArray(measures) || !measures.length || measures.length > REPORT_MAX_MEASURES) {
    errors.push(`REPORT schema.measures must contain 1-${REPORT_MAX_MEASURES} measures`)
    return
  }
  const keys = new Set()
  for (const [index, measure] of measures.entries()) {
    const at = `REPORT schema.measures[${index}]`
    if (!DATA_VIEW_IDENTIFIER.test(measure?.key ?? '')) errors.push(`${at}.key is invalid`)
    else if (keys.has(measure.key)) errors.push(`${at}.key must be unique`)
    keys.add(measure?.key)
    if (typeof measure?.label !== 'string' || !measure.label.trim()) errors.push(`${at}.label is required`)
    if (!REPORT_AGGREGATES.includes(measure?.aggregate)) errors.push(`${at}.aggregate is unsupported`)
    if (measure?.aggregate !== 'count') checkIdentifier(errors, measure?.field, `${at}.field`, true)
  }
}

export function validateRecordsViewSchema(kind, schema) {
  const errors = []
  if (!RECORDS_VIEW_KINDS.includes(kind)) return { valid: false, errors: [`Unsupported records view kind "${kind}"`] }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { valid: false, errors: [`${kind} schema must be a plain object`] }
  if (!schema.title || typeof schema.title !== 'string') errors.push(`${kind} schema.title is required`)
  if (!PATH.test(schema.path ?? '') || schema.path.includes('..')) errors.push(`${kind} schema.path must stay inside /app/m/<moduleKey>`)
  checkIdentifier(errors, schema.entity, `${kind} schema.entity`, true)
  if (schema.apiPath !== undefined && (!API_PATH.test(schema.apiPath) || schema.apiPath.includes('..'))) errors.push(`${kind} schema.apiPath is invalid`)
  if (schema.permissionKey !== undefined && (typeof schema.permissionKey !== 'string' || !schema.permissionKey.trim())) errors.push(`${kind} schema.permissionKey is invalid`)

  if (kind === 'CARDS') {
    if (!schema.card || typeof schema.card !== 'object') errors.push('CARDS schema.card.titleField is required')
    else {
      checkIdentifier(errors, schema.card.titleField, 'CARDS schema.card.titleField', true)
      for (const key of ['subtitleField', 'descriptionField', 'badgeField', 'imageField']) checkIdentifier(errors, schema.card[key], `CARDS schema.card.${key}`, false)
    }
  }
  if (kind === 'CALENDAR' || kind === 'TIMELINE') {
    checkIdentifier(errors, schema.dateField, `${kind} schema.dateField`, true)
    checkIdentifier(errors, schema.titleField, `${kind} schema.titleField`, true)
  }
  if (kind === 'CALENDAR') checkIdentifier(errors, schema.colorField, 'CALENDAR schema.colorField', false)
  if (kind === 'TIMELINE') {
    checkIdentifier(errors, schema.descriptionField, 'TIMELINE schema.descriptionField', false)
    checkIdentifier(errors, schema.badgeField, 'TIMELINE schema.badgeField', false)
  }
  if (kind === 'REPORT') {
    checkIdentifier(errors, schema.groupBy, 'REPORT schema.groupBy', true)
    validateReportMeasures(schema, errors)
  }

  errors.push(...validateDataViewOrder(schema.orderBy, `${kind} schema.orderBy`))
  errors.push(...validateDataViewFilters(schema.filters, `${kind} schema.filters`))
  if (schema.limit !== undefined && (!Number.isInteger(schema.limit) || schema.limit < 1 || schema.limit > RECORDS_VIEW_MAX_LIMIT)) errors.push(`${kind} schema.limit must be between 1 and ${RECORDS_VIEW_MAX_LIMIT}`)
  if (FORBIDDEN_KEYS.some((key) => key in schema)) errors.push(`${kind} schema contains forbidden data controls`)
  return { valid: errors.length === 0, errors }
}
