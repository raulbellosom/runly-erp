import { DASHBOARD_DEFAULT_LIST_LIMIT, DASHBOARD_MAX_LIST_LIMIT } from '@runly/module-engine'

const IDENTIFIER = /^[a-z][a-z0-9_]*$/
const NUMERIC_TYPES = new Set(['number', 'decimal'])
const SYSTEM_FIELDS = new Map([
  ['id', { name: 'id', type: 'text' }],
  ['created_at', { name: 'created_at', type: 'datetime' }],
  ['updated_at', { name: 'updated_at', type: 'datetime' }],
])

function quoteIdentifier(value) {
  if (!IDENTIFIER.test(value ?? '')) throw Object.assign(new Error('INVALID_IDENTIFIER'), { code: 'INVALID_IDENTIFIER' })
  return `"${value}"`
}

function normalizeRows(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value])))
}

export function createModuleDashboardQueryService({ prisma }) {
  async function loadOwnedModel(moduleKey, entity) {
    const candidates = [entity, `${moduleKey.split('.').at(-1)}.${entity}`]
    const model = await prisma.runlyModel.findFirst({
      where: { moduleKey, enabled: true, name: { in: candidates } },
      include: { fields: true },
    })
    if (!model || model.moduleKey !== moduleKey) throw Object.assign(new Error('CROSS_MODULE_SOURCE_REJECTED'), { code: 'CROSS_MODULE_SOURCE_REJECTED' })
    return model
  }

  function compileWhere({ model, source, companyId }) {
    const fields = new Map([...model.fields.map((field) => [field.name, field]), ...SYSTEM_FIELDS])
    const clauses = []
    const values = []
    const pushValue = (value) => { values.push(value); return `$${values.length}` }
    if (model.companyScoped) {
      if (!companyId) throw Object.assign(new Error('COMPANY_CONTEXT_REQUIRED'), { code: 'COMPANY_CONTEXT_REQUIRED' })
      clauses.push(`"company_id" = ${pushValue(companyId)}::uuid`)
    }
    if (model.schema?.softDelete !== false) clauses.push('"enabled" = true')
    for (const filter of source.filters ?? []) {
      if (!fields.has(filter.field) || filter.field === 'company_id') throw Object.assign(new Error('UNKNOWN_FIELD'), { code: 'UNKNOWN_FIELD' })
      const field = quoteIdentifier(filter.field)
      const operators = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }
      if (operators[filter.operator]) clauses.push(`${field} ${operators[filter.operator]} ${pushValue(filter.value)}`)
      else if (filter.operator === 'isNull') clauses.push(`${field} IS ${filter.value === false ? 'NOT ' : ''}NULL`)
      else if (filter.operator === 'in') {
        if (!Array.isArray(filter.value) || !filter.value.length || filter.value.length > 100) throw Object.assign(new Error('INVALID_FILTER'), { code: 'INVALID_FILTER' })
        clauses.push(`${field} IN (${filter.value.map(pushValue).join(', ')})`)
      } else throw Object.assign(new Error('INVALID_FILTER_OPERATOR'), { code: 'INVALID_FILTER_OPERATOR' })
    }
    return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', values, fields }
  }

  async function executeWidget({ moduleKey, widget, companyId }) {
    const source = widget.source
    const model = await loadOwnedModel(moduleKey, source.entity)
    const table = quoteIdentifier(model.tableName)
    const where = compileWhere({ model, source, companyId })
    // List widgets never carry `source.aggregate` — the schema validator
    // (dashboard-schema.js) explicitly forbids it for `type: 'list'` — so
    // these two aggregate checks must not run for them. They used to run
    // unconditionally before the `widget.type === 'list'` branch below,
    // which made every list widget fail with a bare AGGREGATE_FIELD_REQUIRED
    // regardless of its actual (valid) declaration. Found during golden-path
    // QA: the Builder's own "Últimos vehículos" list widget reproduced it.
    const field = source.aggregateField ? where.fields.get(source.aggregateField) : null
    if (widget.type !== 'list' && source.aggregate !== 'count' && !field) throw Object.assign(new Error('AGGREGATE_FIELD_REQUIRED'), { code: 'AGGREGATE_FIELD_REQUIRED' })
    if (widget.type !== 'list' && ['sum', 'avg'].includes(source.aggregate) && !NUMERIC_TYPES.has(field?.type)) throw Object.assign(new Error('AGGREGATE_TYPE_MISMATCH'), { code: 'AGGREGATE_TYPE_MISMATCH' })

    if (widget.type === 'list') {
      const selected = ['id', widget.display?.titleField, widget.display?.subtitleField].filter(Boolean)
      for (const name of selected) if (!where.fields.has(name)) throw Object.assign(new Error('UNKNOWN_FIELD'), { code: 'UNKNOWN_FIELD' })
      const orderField = source.orderBy?.field ?? 'created_at'
      if (!where.fields.has(orderField)) throw Object.assign(new Error('UNKNOWN_FIELD'), { code: 'UNKNOWN_FIELD' })
      const direction = source.orderBy?.direction === 'asc' ? 'ASC' : 'DESC'
      const limit = Math.min(source.limit ?? DASHBOARD_DEFAULT_LIST_LIMIT, DASHBOARD_MAX_LIST_LIMIT)
      const sql = `SELECT ${selected.map(quoteIdentifier).join(', ')} FROM ${table}${where.sql} ORDER BY ${quoteIdentifier(orderField)} ${direction} LIMIT ${limit}`
      return { kind: 'records', rows: normalizeRows(await prisma.$queryRawUnsafe(sql, ...where.values)) }
    }

    const aggregate = source.aggregate.toUpperCase()
    const expression = source.aggregate === 'count' ? 'COUNT(*)' : `${aggregate}(${quoteIdentifier(source.aggregateField)})`
    if (source.groupBy) {
      if (!where.fields.has(source.groupBy)) throw Object.assign(new Error('UNKNOWN_FIELD'), { code: 'UNKNOWN_FIELD' })
      const group = quoteIdentifier(source.groupBy)
      const sql = `SELECT ${group}::text AS label, ${expression}::float8 AS value FROM ${table}${where.sql} GROUP BY ${group} ORDER BY value DESC LIMIT 100`
      return { kind: 'series', rows: normalizeRows(await prisma.$queryRawUnsafe(sql, ...where.values)) }
    }
    const sql = `SELECT ${expression}::float8 AS value FROM ${table}${where.sql}`
    const [row] = normalizeRows(await prisma.$queryRawUnsafe(sql, ...where.values))
    return { kind: 'value', value: row?.value ?? 0 }
  }

  async function executeDashboard({ moduleKey, widgets, companyId }) {
    const entries = await Promise.all(widgets.map(async (widget) => {
      try { return [widget.key, { status: 'success', data: await executeWidget({ moduleKey, widget, companyId }) }] }
      catch (error) { return [widget.key, { status: 'error', error: { code: error.code ?? 'QUERY_FAILED', message: 'No se pudo cargar este widget.' } }] }
    }))
    return Object.fromEntries(entries)
  }

  return { executeWidget, executeDashboard }
}
