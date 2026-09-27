import { DATA_VIEW_IDENTIFIER, validateDataViewFilters, validateDataViewOrder } from './data-view-schema.js'

export const KANBAN_GROUP_FIELD_TYPES = Object.freeze(['select', 'boolean'])
export const KANBAN_MAX_COLUMNS = 50
export const KANBAN_DEFAULT_LIMIT = 200
export const KANBAN_MAX_LIMIT = 500

const PATH = /^\/app\/m\/[a-z][a-z0-9]*\.[a-z][a-z0-9_]*(?:\/[a-zA-Z0-9._~-]+)*$/
const API_PATH = /^\/[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)+$/

export function validateKanbanSchema(schema) {
  const errors = []
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { valid: false, errors: ['KANBAN schema must be a plain object'] }
  if (!schema.title || typeof schema.title !== 'string') errors.push('KANBAN schema.title is required')
  if (!PATH.test(schema.path ?? '') || schema.path.includes('..')) errors.push('KANBAN schema.path must stay inside /app/m/<moduleKey>')
  if (!DATA_VIEW_IDENTIFIER.test(schema.entity ?? '')) errors.push('KANBAN schema.entity is invalid')
  if (schema.apiPath !== undefined && (!API_PATH.test(schema.apiPath) || schema.apiPath.includes('..'))) errors.push('KANBAN schema.apiPath is invalid')
  if (!DATA_VIEW_IDENTIFIER.test(schema.groupBy ?? '')) errors.push('KANBAN schema.groupBy is invalid')
  if (!schema.card || !DATA_VIEW_IDENTIFIER.test(schema.card.titleField ?? '')) errors.push('KANBAN schema.card.titleField is required')
  for (const key of ['subtitleField', 'descriptionField', 'badgeField', 'imageField']) {
    if (schema.card?.[key] != null && !DATA_VIEW_IDENTIFIER.test(schema.card[key])) errors.push(`KANBAN schema.card.${key} is invalid`)
  }
  if (schema.columns !== undefined && (!Array.isArray(schema.columns) || schema.columns.length > KANBAN_MAX_COLUMNS || schema.columns.some((column) => !column || typeof column !== 'object' || !['string', 'number', 'boolean'].includes(typeof column.value) || typeof column.label !== 'string' || !column.label.trim()))) errors.push(`KANBAN schema.columns must contain at most ${KANBAN_MAX_COLUMNS} labeled scalar values`)
  errors.push(...validateDataViewOrder(schema.orderBy, 'KANBAN schema.orderBy'))
  errors.push(...validateDataViewFilters(schema.filters, 'KANBAN schema.filters'))
  if (schema.limit !== undefined && (!Number.isInteger(schema.limit) || schema.limit < 1 || schema.limit > KANBAN_MAX_LIMIT)) errors.push(`KANBAN schema.limit must be between 1 and ${KANBAN_MAX_LIMIT}`)
  if (['sql', 'query', 'table', 'companyId', 'company_id', 'companyScoped'].some((key) => key in schema)) errors.push('KANBAN schema contains forbidden data controls')
  return { valid: errors.length === 0, errors }
}
