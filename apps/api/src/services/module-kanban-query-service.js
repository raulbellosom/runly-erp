import { KANBAN_DEFAULT_LIMIT, KANBAN_MAX_COLUMNS, KANBAN_MAX_LIMIT, validateKanbanSchema } from '@runly/module-engine'

const IDENTIFIER = /^[a-z][a-z0-9_]*$/
const SYSTEM_FIELDS = new Map([
  ['id', { name: 'id', type: 'text' }],
  ['created_at', { name: 'created_at', type: 'datetime' }],
  ['updated_at', { name: 'updated_at', type: 'datetime' }],
  ['enabled', { name: 'enabled', type: 'boolean' }],
])

function quoteIdentifier(value) {
  if (!IDENTIFIER.test(value ?? '')) throw Object.assign(new Error('INVALID_IDENTIFIER'), { code: 'INVALID_IDENTIFIER' })
  return `"${value}"`
}

function optionRecord(option) {
  return typeof option === 'object' && option !== null
    ? { value: option.value, label: option.label ?? String(option.value) }
    : { value: option, label: String(option) }
}

function normalizeRecord(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]))
}

export function createModuleKanbanQueryService({ prisma }) {
  async function loadModel(moduleKey, entity) {
    const slug = moduleKey.split('.').at(-1)
    const model = await prisma.runlyModel.findFirst({
      where: { moduleKey, enabled: true, name: { in: [entity, `${slug}.${entity}`] } },
      include: { fields: true },
    })
    if (!model || model.moduleKey !== moduleKey) throw Object.assign(new Error('CROSS_MODULE_SOURCE_REJECTED'), { code: 'CROSS_MODULE_SOURCE_REJECTED' })
    return model
  }

  function compileWhere({ model, schema, companyId }) {
    const fields = new Map([...model.fields.map((field) => [field.name, field]), ...SYSTEM_FIELDS])
    const clauses = []
    const values = []
    const parameter = (value) => { values.push(value); return `$${values.length}` }
    if (model.companyScoped) {
      if (!companyId) throw Object.assign(new Error('COMPANY_CONTEXT_REQUIRED'), { code: 'COMPANY_CONTEXT_REQUIRED' })
      clauses.push(`"company_id" = ${parameter(companyId)}::uuid`)
    }
    if (model.schema?.softDelete !== false) clauses.push('"enabled" = true')
    for (const filter of schema.filters ?? []) {
      if (!fields.has(filter.field) || filter.field === 'company_id') throw Object.assign(new Error('UNKNOWN_FIELD'), { code: 'UNKNOWN_FIELD' })
      const field = quoteIdentifier(filter.field)
      const operators = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }
      if (operators[filter.operator]) clauses.push(`${field} ${operators[filter.operator]} ${parameter(filter.value)}`)
      else if (filter.operator === 'isNull') clauses.push(`${field} IS ${filter.value === false ? 'NOT ' : ''}NULL`)
      else if (filter.operator === 'in' && Array.isArray(filter.value) && filter.value.length && filter.value.length <= 100) clauses.push(`${field} IN (${filter.value.map(parameter).join(', ')})`)
      else throw Object.assign(new Error('INVALID_FILTER'), { code: 'INVALID_FILTER' })
    }
    return { fields, clauses, values }
  }

  async function queryBoard({ moduleKey, schema, companyId }) {
    const validation = validateKanbanSchema(schema)
    if (!validation.valid) throw Object.assign(new Error('INVALID_KANBAN'), { code: 'INVALID_KANBAN', details: validation.errors })
    const model = await loadModel(moduleKey, schema.entity)
    const where = compileWhere({ model, schema, companyId })
    const groupField = where.fields.get(schema.groupBy)
    if (!groupField || !['select', 'boolean'].includes(groupField.type)) throw Object.assign(new Error('INVALID_GROUP_FIELD_TYPE'), { code: 'INVALID_GROUP_FIELD_TYPE' })
    const optionRows = groupField.type === 'boolean'
      ? [{ value: true, label: 'Sí' }, { value: false, label: 'No' }]
      : (groupField.options ?? []).map(optionRecord)
    if (!optionRows.length || optionRows.length > KANBAN_MAX_COLUMNS) throw Object.assign(new Error('INVALID_COLUMN_COUNT'), { code: 'INVALID_COLUMN_COUNT' })
    const schemaLabels = new Map((schema.columns ?? []).map(optionRecord).map((option) => [String(option.value), option.label]))
    const columns = optionRows.map((option) => ({ ...option, label: schemaLabels.get(String(option.value)) ?? option.label, acceptsDrop: true }))
    if (!groupField.required) columns.push({ value: null, label: 'Sin asignar', acceptsDrop: true })
    const selected = [...new Set(['id', schema.groupBy, ...Object.values(schema.card).filter(Boolean)])]
    for (const field of selected) if (!where.fields.has(field)) throw Object.assign(new Error('UNKNOWN_CARD_FIELD'), { code: 'UNKNOWN_CARD_FIELD' })
    const orderField = schema.orderBy?.field ?? 'created_at'
    if (!where.fields.has(orderField)) throw Object.assign(new Error('INVALID_ORDER_FIELD'), { code: 'INVALID_ORDER_FIELD' })
    const limit = Math.min(schema.limit ?? KANBAN_DEFAULT_LIMIT, KANBAN_MAX_LIMIT)
    const sql = `SELECT ${selected.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(model.tableName)}${where.clauses.length ? ` WHERE ${where.clauses.join(' AND ')}` : ''} ORDER BY ${quoteIdentifier(orderField)} ${schema.orderBy?.direction === 'asc' ? 'ASC' : 'DESC'} LIMIT ${limit + 1}`
    const fetched = (await prisma.$queryRawUnsafe(sql, ...where.values)).map(normalizeRecord)
    const records = fetched.slice(0, limit)
    const known = new Set(columns.map((column) => column.value === null ? '__NULL__' : String(column.value)))
    for (const record of records) {
      const value = record[schema.groupBy]
      const key = value == null ? '__NULL__' : String(value)
      if (!known.has(key)) { columns.push({ value, label: `Otros · ${value}`, acceptsDrop: false, legacy: true }); known.add(key) }
    }
    return { columns, records, truncated: fetched.length > limit, limit }
  }

  return { queryBoard }
}
