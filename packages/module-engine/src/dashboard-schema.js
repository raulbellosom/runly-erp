export const DASHBOARD_WIDGET_TYPES = Object.freeze(['stat', 'chart', 'list'])
export const DASHBOARD_CHART_TYPES = Object.freeze(['bar', 'line', 'pie', 'donut'])
export const DASHBOARD_AGGREGATES = Object.freeze(['count', 'sum', 'avg', 'min', 'max'])
import { DATA_VIEW_FILTER_OPERATORS, validateDataViewFilters, validateDataViewOrder } from './data-view-schema.js'

export const DASHBOARD_FILTER_OPERATORS = DATA_VIEW_FILTER_OPERATORS
export const DASHBOARD_MAX_WIDGETS = 50
export const DASHBOARD_DEFAULT_LIST_LIMIT = 5
export const DASHBOARD_MAX_LIST_LIMIT = 100

const IDENTIFIER = /^[a-z][a-z0-9_]*$/
const WIDGET_KEY = /^[a-z][A-Za-z0-9_]*$/
const PATH = /^\/app\/m\/[a-z][a-z0-9]*\.[a-z][a-z0-9_]*(?:\/[a-zA-Z0-9._~-]+)*$/

export function validateDashboardSchema(schema) {
  const errors = []
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { valid: false, errors: ['DASHBOARD schema must be a plain object'] }
  if (!schema.title || typeof schema.title !== 'string') errors.push('DASHBOARD schema.title is required')
  if (!PATH.test(schema.path ?? '') || schema.path.includes('..')) errors.push('DASHBOARD schema.path must stay inside /app/m/<moduleKey>')
  if (schema.layout?.columns !== undefined && schema.layout.columns !== 12) errors.push('DASHBOARD schema.layout.columns must be 12')
  if (schema.layout?.gap !== undefined && !['sm', 'md', 'lg'].includes(schema.layout.gap)) errors.push('DASHBOARD schema.layout.gap is unsupported')
  if (!Array.isArray(schema.widgets) || schema.widgets.length === 0) errors.push('DASHBOARD schema.widgets must be a non-empty array')
  if ((schema.widgets?.length ?? 0) > DASHBOARD_MAX_WIDGETS) errors.push(`DASHBOARD supports at most ${DASHBOARD_MAX_WIDGETS} widgets`)
  const keys = new Set()
  for (const [index, widget] of (schema.widgets ?? []).entries()) {
    const at = `DASHBOARD schema.widgets[${index}]`
    if (!widget || typeof widget !== 'object' || Array.isArray(widget)) { errors.push(`${at} must be an object`); continue }
    if (!WIDGET_KEY.test(widget.key ?? '')) errors.push(`${at}.key must be a safe identifier`)
    if (keys.has(widget.key)) errors.push(`${at}.key must be unique`)
    keys.add(widget.key)
    if (!DASHBOARD_WIDGET_TYPES.includes(widget.type)) errors.push(`${at}.type is unsupported`)
    if (!widget.title && !widget.label) errors.push(`${at}.title or label is required`)
    const layout = widget.layout ?? {}
    if (layout.w !== undefined && (!Number.isInteger(layout.w) || layout.w < 1 || layout.w > 12)) errors.push(`${at}.layout.w must be an integer from 1 to 12`)
    if (layout.h !== undefined && (!Number.isInteger(layout.h) || layout.h < 1 || layout.h > 12)) errors.push(`${at}.layout.h must be an integer from 1 to 12`)
    const source = widget.source
    if (!source || typeof source !== 'object' || !IDENTIFIER.test(source.entity ?? '')) errors.push(`${at}.source.entity is required`)
    if (source && ['sql', 'query', 'table', 'companyId', 'company_id', 'companyScoped'].some((key) => key in source)) errors.push(`${at}.source contains forbidden query controls`)
    if (widget.type === 'chart' && !DASHBOARD_CHART_TYPES.includes(widget.chart)) errors.push(`${at}.chart is unsupported`)
    if (widget.type === 'chart' && !source?.groupBy) errors.push(`${at}.source.groupBy is required for charts`)
    if (widget.type === 'stat' && source?.groupBy) errors.push(`${at}.source.groupBy is not allowed for stat widgets`)
    if (widget.type !== 'list' && !DASHBOARD_AGGREGATES.includes(source?.aggregate)) errors.push(`${at}.source.aggregate is unsupported`)
    if (widget.type === 'list' && source?.aggregate) errors.push(`${at}.source.aggregate is not allowed for list widgets`)
    if (source?.groupBy !== undefined && !IDENTIFIER.test(source.groupBy)) errors.push(`${at}.source.groupBy must be a field identifier`)
    if (source?.aggregateField !== undefined && !IDENTIFIER.test(source.aggregateField)) errors.push(`${at}.source.aggregateField must be a field identifier`)
    if (source?.limit !== undefined && (!Number.isInteger(source.limit) || source.limit < 1 || source.limit > DASHBOARD_MAX_LIST_LIMIT)) errors.push(`${at}.source.limit must be between 1 and ${DASHBOARD_MAX_LIST_LIMIT}`)
    errors.push(...validateDataViewOrder(source?.orderBy, `${at}.source.orderBy`))
    errors.push(...validateDataViewFilters(source?.filters, `${at}.source.filters`))
  }
  return { valid: errors.length === 0, errors }
}
