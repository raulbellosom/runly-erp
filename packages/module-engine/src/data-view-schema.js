export const DATA_VIEW_FILTER_OPERATORS = Object.freeze(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'isNull'])
export const DATA_VIEW_MAX_FILTER_VALUES = 100
export const DATA_VIEW_IDENTIFIER = /^[a-z][a-z0-9_]*$/

export function validateDataViewFilters(filters, path = 'filters') {
  const errors = []
  if (filters === undefined) return errors
  if (!Array.isArray(filters)) return [`${path} must be an array`]
  for (const [index, filter] of filters.entries()) {
    const at = `${path}[${index}]`
    if (!DATA_VIEW_IDENTIFIER.test(filter?.field ?? '')) errors.push(`${at}.field is invalid`)
    if (!DATA_VIEW_FILTER_OPERATORS.includes(filter?.operator)) errors.push(`${at}.operator is unsupported`)
    if (filter?.field === 'company_id') errors.push(`${at} cannot control company_id`)
    if (filter?.operator === 'in' && (!Array.isArray(filter.value) || !filter.value.length || filter.value.length > DATA_VIEW_MAX_FILTER_VALUES)) errors.push(`${at}.value must contain 1-${DATA_VIEW_MAX_FILTER_VALUES} values`)
  }
  return errors
}

export function validateDataViewOrder(orderBy, path = 'orderBy') {
  if (orderBy === undefined) return []
  if (!orderBy || !DATA_VIEW_IDENTIFIER.test(orderBy.field ?? '') || !['asc', 'desc'].includes(orderBy.direction)) return [`${path} is invalid`]
  return []
}
