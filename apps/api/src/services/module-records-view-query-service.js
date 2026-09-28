// Read queries for the records view kinds (CARDS, CALENDAR, TIMELINE,
// REPORT). Same safety model as module-kanban-query-service.js: only the
// module's own model, company scope + soft-delete enforced server-side,
// identifiers whitelisted against the model's fields, values parameterized.
import {
  RECORDS_VIEW_DATE_FIELD_TYPES,
  RECORDS_VIEW_DEFAULT_LIMIT,
  RECORDS_VIEW_MAX_LIMIT,
  REPORT_MAX_GROUPS,
  validateRecordsViewSchema,
} from '@runly/module-engine'

const IDENTIFIER = /^[a-z][a-z0-9_]*$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 93
const NUMERIC_TYPES = new Set(['number', 'decimal'])
const SYSTEM_FIELDS = new Map([
  ['id', { name: 'id', label: 'ID', type: 'text' }],
  ['created_at', { name: 'created_at', label: 'Creado', type: 'datetime' }],
  ['updated_at', { name: 'updated_at', label: 'Actualizado', type: 'datetime' }],
  ['enabled', { name: 'enabled', label: 'Activo', type: 'boolean' }],
])
const FILTER_OPERATORS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }

function fail(code) {
  return Object.assign(new Error(code), { code })
}

function quoteIdentifier(value) {
  if (!IDENTIFIER.test(value ?? '')) throw fail('INVALID_IDENTIFIER')
  return `"${value}"`
}

function normalizeRecord(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]))
}

function fieldMeta(field) {
  return { name: field.name, label: field.label ?? field.name, type: field.type, options: field.options ?? null }
}

// Fields a records view reads, per kind — the only columns ever selected.
export function referencedFields(kind, schema) {
  if (kind === 'CARDS') return Object.values(schema.card ?? {}).filter(Boolean)
  if (kind === 'CALENDAR') return [schema.dateField, schema.titleField, schema.colorField].filter(Boolean)
  if (kind === 'TIMELINE') return [schema.dateField, schema.titleField, schema.descriptionField, schema.badgeField].filter(Boolean)
  return [schema.groupBy, ...(schema.measures ?? []).map((measure) => measure.field)].filter(Boolean)
}

function parseRange(range) {
  if (!range) return null
  if (!ISO_DATE.test(range.from ?? '') || !ISO_DATE.test(range.to ?? '')) throw fail('INVALID_RANGE')
  const from = new Date(`${range.from}T00:00:00Z`)
  const to = new Date(`${range.to}T00:00:00Z`)
  const days = (to - from) / 86400000
  if (!(days > 0) || days > MAX_RANGE_DAYS) throw fail('INVALID_RANGE')
  return { from: range.from, to: range.to }
}

export function createModuleRecordsViewQueryService({ prisma }) {
  async function loadModel(moduleKey, entity) {
    const slug = moduleKey.split('.').at(-1)
    const model = await prisma.runlyModel.findFirst({
      where: { moduleKey, enabled: true, name: { in: [entity, `${slug}.${entity}`] } },
      include: { fields: true },
    })
    if (!model || model.moduleKey !== moduleKey) throw fail('CROSS_MODULE_SOURCE_REJECTED')
    return model
  }

  function compileWhere({ model, schema, companyId }) {
    const fields = new Map([...model.fields.map((field) => [field.name, field]), ...SYSTEM_FIELDS])
    const clauses = []
    const values = []
    const parameter = (value) => { values.push(value); return `$${values.length}` }
    if (model.companyScoped) {
      if (!companyId) throw fail('COMPANY_CONTEXT_REQUIRED')
      clauses.push(`"company_id" = ${parameter(companyId)}::uuid`)
    }
    if (model.schema?.softDelete !== false) clauses.push('"enabled" = true')
    for (const filter of schema.filters ?? []) {
      if (!fields.has(filter.field) || filter.field === 'company_id') throw fail('UNKNOWN_FIELD')
      const field = quoteIdentifier(filter.field)
      if (FILTER_OPERATORS[filter.operator]) clauses.push(`${field} ${FILTER_OPERATORS[filter.operator]} ${parameter(filter.value)}`)
      else if (filter.operator === 'isNull') clauses.push(`${field} IS ${filter.value === false ? 'NOT ' : ''}NULL`)
      else if (filter.operator === 'in' && Array.isArray(filter.value) && filter.value.length && filter.value.length <= 100) clauses.push(`${field} IN (${filter.value.map(parameter).join(', ')})`)
      else throw fail('INVALID_FILTER')
    }
    return { fields, clauses, values, parameter }
  }

  async function queryRecords({ moduleKey, kind, schema, companyId, range }) {
    const model = await loadModel(moduleKey, schema.entity)
    const where = compileWhere({ model, schema, companyId })
    const referenced = referencedFields(kind, schema)
    for (const name of referenced) if (!where.fields.has(name)) throw fail('UNKNOWN_FIELD')
    let defaultOrder = { field: 'created_at', direction: 'desc' }
    if (kind === 'CALENDAR' || kind === 'TIMELINE') {
      if (!RECORDS_VIEW_DATE_FIELD_TYPES.includes(where.fields.get(schema.dateField)?.type)) throw fail('INVALID_DATE_FIELD')
      defaultOrder = { field: schema.dateField, direction: kind === 'CALENDAR' ? 'asc' : 'desc' }
    }
    const parsedRange = kind === 'CALENDAR' ? parseRange(range) : null
    if (parsedRange) {
      const date = quoteIdentifier(schema.dateField)
      where.clauses.push(`${date} >= ${where.parameter(parsedRange.from)}::date`, `${date} < ${where.parameter(parsedRange.to)}::date`)
    }
    const orderBy = schema.orderBy ?? defaultOrder
    if (!where.fields.has(orderBy.field)) throw fail('INVALID_ORDER_FIELD')
    const limit = Math.min(schema.limit ?? RECORDS_VIEW_DEFAULT_LIMIT, RECORDS_VIEW_MAX_LIMIT)
    const selected = [...new Set(['id', ...referenced])]
    const sql = `SELECT ${selected.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(model.tableName)}${where.clauses.length ? ` WHERE ${where.clauses.join(' AND ')}` : ''} ORDER BY ${quoteIdentifier(orderBy.field)} ${orderBy.direction === 'asc' ? 'ASC' : 'DESC'} NULLS LAST LIMIT ${limit + 1}`
    const fetched = (await prisma.$queryRawUnsafe(sql, ...where.values)).map(normalizeRecord)
    return {
      records: fetched.slice(0, limit),
      truncated: fetched.length > limit,
      limit,
      fields: referenced.map((name) => fieldMeta(where.fields.get(name))),
    }
  }

  async function queryReport({ moduleKey, schema, companyId }) {
    const model = await loadModel(moduleKey, schema.entity)
    const where = compileWhere({ model, schema, companyId })
    const groupField = where.fields.get(schema.groupBy)
    if (!groupField) throw fail('UNKNOWN_FIELD')
    const expressions = schema.measures.map((measure) => {
      if (measure.aggregate === 'count') return `COUNT(*)::float8 AS ${quoteIdentifier(measure.key)}`
      const field = where.fields.get(measure.field)
      if (!field) throw fail('UNKNOWN_FIELD')
      if (['sum', 'avg'].includes(measure.aggregate) && !NUMERIC_TYPES.has(field.type)) throw fail('AGGREGATE_TYPE_MISMATCH')
      return `${measure.aggregate.toUpperCase()}(${quoteIdentifier(measure.field)})::float8 AS ${quoteIdentifier(measure.key)}`
    })
    const table = quoteIdentifier(model.tableName)
    const whereSql = where.clauses.length ? ` WHERE ${where.clauses.join(' AND ')}` : ''
    const group = quoteIdentifier(schema.groupBy)
    const groupsSql = `SELECT ${group}::text AS "__group", ${expressions.join(', ')} FROM ${table}${whereSql} GROUP BY ${group} ORDER BY "__group" ASC NULLS LAST LIMIT ${REPORT_MAX_GROUPS + 1}`
    const totalsSql = `SELECT ${expressions.join(', ')} FROM ${table}${whereSql}`
    const [groupRows, totalRows] = await Promise.all([
      prisma.$queryRawUnsafe(groupsSql, ...where.values),
      prisma.$queryRawUnsafe(totalsSql, ...where.values),
    ])
    const options = new Map((groupField.options ?? []).map((option) => typeof option === 'object' && option !== null
      ? [String(option.value), option.label ?? String(option.value)]
      : [String(option), String(option)]))
    const measureValues = (row) => Object.fromEntries(schema.measures.map((measure) => [measure.key, row?.[measure.key] ?? null]))
    const groups = groupRows.map(normalizeRecord).slice(0, REPORT_MAX_GROUPS).map((row) => {
      const value = row.__group
      let label = value == null ? 'Sin valor' : options.get(value) ?? value
      if (groupField.type === 'boolean' && value != null) label = value === 'true' ? 'Sí' : 'No'
      return { value, label, measures: measureValues(row) }
    })
    return {
      groups,
      truncated: groupRows.length > REPORT_MAX_GROUPS,
      totals: measureValues(normalizeRecord(totalRows[0] ?? {})),
      fields: [fieldMeta(groupField), ...schema.measures.filter((m) => m.field).map((m) => fieldMeta(where.fields.get(m.field)))],
    }
  }

  async function queryView({ moduleKey, kind, schema, companyId, range }) {
    const validation = validateRecordsViewSchema(kind, schema)
    if (!validation.valid) throw Object.assign(fail('INVALID_RECORDS_VIEW'), { details: validation.errors })
    if (kind === 'REPORT') return queryReport({ moduleKey, schema, companyId })
    return queryRecords({ moduleKey, kind, schema, companyId, range })
  }

  return { queryView }
}
