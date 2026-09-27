import { createHash } from 'node:crypto'
import { SQL_TYPE_MAP } from './field-types.js'
import { generateCreateTableSql } from './sql-generator.js'
import { ModuleEngineError } from './errors.js'

const IDENTIFIER_RE = /^[a-z][a-z0-9_]*$/

function identifier(value, label) {
  if (!IDENTIFIER_RE.test(value ?? '')) {
    throw new ModuleEngineError(`${label}: unsafe identifier "${value}"`, 'AME_UNSAFE_IDENTIFIER')
  }
  return value
}

function normalizeDefault(value) {
  if (value === undefined || value === null) return null
  if (['string', 'number', 'boolean'].includes(typeof value)) return value
  throw new ModuleEngineError('Only string, number, boolean and null defaults are supported', 'AME_UNSAFE_DEFAULT')
}

function normalizeIndex(table, index) {
  const fields = [...new Set((index?.fields ?? []).map((field) => identifier(field, 'index field')))]
  if (!fields.length) throw new ModuleEngineError('Index fields are required', 'AME_INVALID_MODEL')
  const name = identifier(index.name ?? `${table}_${fields.join('_')}_idx`, 'index name')
  return { name, fields, unique: index.unique === true }
}

export function normalizeModelSchema(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    throw new ModuleEngineError('normalizeModelSchema: model must be an object', 'AME_INVALID_MODEL')
  }
  const table = identifier(model.tableName, 'table name')
  const columns = [
    { name: 'id', sqlType: 'UUID', nullable: false, default: 'uuidv7()', managed: true },
    ...(model.companyScoped !== false
      ? [{ name: 'company_id', sqlType: 'UUID', nullable: false, default: null, managed: true }]
      : []),
    ...(model.fields ?? []).map((field) => {
      const mapper = SQL_TYPE_MAP[field.type]
      if (!mapper) throw new ModuleEngineError(`Unsupported field type "${field.type}"`, 'AME_UNSUPPORTED_FIELD_TYPE')
      return {
        name: identifier(field.name, 'column name'),
        sqlType: mapper(field).toUpperCase(),
        nullable: field.required !== true,
        default: normalizeDefault(field.default),
        managed: true,
      }
    }),
    ...(model.softDelete === true
      ? [{ name: 'enabled', sqlType: 'BOOLEAN', nullable: false, default: true, managed: true }]
      : []),
    { name: 'created_at', sqlType: 'TIMESTAMPTZ', nullable: false, default: 'now()', managed: true },
    { name: 'updated_at', sqlType: 'TIMESTAMPTZ', nullable: false, default: 'now()', managed: true },
  ]
  return {
    model: model.key ?? model.name,
    table,
    columns: columns.sort((a, b) => a.name.localeCompare(b.name)),
    indexes: (model.indexes ?? []).map((index) => normalizeIndex(table, index)).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

export function hashNormalizedSchema(schema) {
  return createHash('sha256').update(JSON.stringify(schema)).digest('hex')
}

function sameDefault(left, right) {
  if (left === right) return true
  const normalize = (value) => String(value ?? '').replaceAll('::character varying', '').replaceAll('::text', '').replace(/^'(.*)'$/, '$1').toLowerCase()
  return normalize(left) === normalize(right)
}

function compareColumn(expected, actual) {
  const mismatches = []
  if (expected.sqlType !== actual.sqlType) mismatches.push({ property: 'sqlType', expected: expected.sqlType, actual: actual.sqlType })
  if (expected.nullable !== actual.nullable) mismatches.push({ property: 'nullable', expected: expected.nullable, actual: actual.nullable })
  if (!sameDefault(expected.default, actual.default)) mismatches.push({ property: 'default', expected: expected.default, actual: actual.default })
  return mismatches
}

export function diffModelSchemas({ previous, desired, actual, rowCount = 0, modelDefinition }) {
  const operations = []
  const drift = []
  const warnings = []
  if (!previous && !actual?.exists) {
    operations.push({ type: 'CREATE_TABLE', table: desired.table, model: desired.model, safety: 'SAFE', modelDefinition })
    return { operations, drift, warnings }
  }
  if (!actual?.exists) {
    drift.push({ type: 'MISSING_TABLE', table: desired.table, expected: previous })
    return { operations, drift, warnings }
  }

  const actualColumns = new Map(actual.columns.map((column) => [column.name, column]))
  const previousColumns = new Map((previous?.columns ?? []).map((column) => [column.name, column]))
  const desiredColumns = new Map(desired.columns.map((column) => [column.name, column]))
  for (const expected of previous?.columns ?? []) {
    const found = actualColumns.get(expected.name)
    if (!found) drift.push({ type: 'MISSING_EXPECTED_COLUMN', table: desired.table, column: expected.name, expected })
    else for (const mismatch of compareColumn(expected, found)) {
      drift.push({ type: 'COLUMN_MISMATCH', table: desired.table, column: expected.name, ...mismatch })
    }
  }
  for (const found of actual.columns) {
    if (!previousColumns.has(found.name)) warnings.push({ type: 'UNEXPECTED_COLUMN', table: desired.table, column: found.name })
  }
  for (const oldColumn of previous?.columns ?? []) {
    if (!desiredColumns.has(oldColumn.name)) {
      operations.push({ type: 'DROP_COLUMN', table: desired.table, column: oldColumn.name, safety: 'DESTRUCTIVE' })
    }
  }
  for (const nextColumn of desired.columns) {
    const oldColumn = previousColumns.get(nextColumn.name)
    if (oldColumn) {
      const changes = compareColumn(oldColumn, nextColumn)
      for (const change of changes) {
        operations.push({
          type: change.property === 'sqlType' ? 'ALTER_COLUMN_TYPE' : 'ALTER_COLUMN',
          table: desired.table,
          column: nextColumn.name,
          safety: change.property === 'nullable' && nextColumn.nullable === false ? 'DESTRUCTIVE' : 'UNSUPPORTED',
          ...change,
        })
      }
      continue
    }
    const actualColumn = actualColumns.get(nextColumn.name)
    if (actualColumn) {
      const mismatches = compareColumn(nextColumn, actualColumn)
      if (mismatches.length) drift.push({ type: 'COLUMN_MISMATCH', table: desired.table, column: nextColumn.name, mismatches })
      else warnings.push({ type: 'BASELINE_COLUMN', table: desired.table, column: nextColumn.name })
      continue
    }
    const conditional = nextColumn.nullable === false && nextColumn.default === null
    operations.push({
      type: 'ADD_COLUMN', table: desired.table, column: nextColumn,
      safety: conditional ? (rowCount === 0 ? 'CONDITIONAL' : 'UNSUPPORTED') : 'SAFE',
      rowCount,
    })
  }

  const previousIndexes = new Map((previous?.indexes ?? []).map((index) => [index.name, index]))
  const actualIndexes = new Map((actual.indexes ?? []).map((index) => [index.name, index]))
  const desiredIndexes = new Map(desired.indexes.map((index) => [index.name, index]))
  for (const expectedIndex of previous?.indexes ?? []) {
    const found = actualIndexes.get(expectedIndex.name)
    if (!found) drift.push({ type: 'MISSING_EXPECTED_INDEX', table: desired.table, index: expectedIndex.name })
    else if (found.unique !== expectedIndex.unique || JSON.stringify(found.fields) !== JSON.stringify(expectedIndex.fields)) {
      drift.push({ type: 'INDEX_MISMATCH', table: desired.table, index: expectedIndex.name, expected: expectedIndex, actual: found })
    }
  }
  for (const found of actual.indexes ?? []) {
    if (!previousIndexes.has(found.name) && !String(found.name).endsWith('_pkey')) {
      warnings.push({ type: 'UNEXPECTED_INDEX', table: desired.table, index: found.name })
    }
  }
  for (const oldIndex of previous?.indexes ?? []) {
    if (!desiredIndexes.has(oldIndex.name)) operations.push({ type: 'DROP_INDEX', table: desired.table, index: oldIndex, safety: 'DESTRUCTIVE' })
  }
  for (const nextIndex of desired.indexes) {
    if (previousIndexes.has(nextIndex.name) || actualIndexes.has(nextIndex.name)) continue
    operations.push({
      type: 'ADD_INDEX', table: desired.table, index: nextIndex,
      safety: nextIndex.unique ? 'UNSUPPORTED' : 'SAFE',
    })
  }
  return { operations, drift, warnings }
}

function sqlLiteral(value) {
  if (value === null) return null
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  throw new ModuleEngineError('Unsupported SQL default literal', 'AME_UNSAFE_DEFAULT')
}

export function compileMigrationPlan(plan) {
  return plan.operations.filter((operation) => ['SAFE', 'CONDITIONAL'].includes(operation.safety)).map((operation) => {
    if (operation.type === 'CREATE_TABLE') return generateCreateTableSql(operation.modelDefinition)
    if (operation.type === 'ADD_COLUMN') {
      const column = operation.column
      const defaultSql = sqlLiteral(column.default)
      return `ALTER TABLE "${identifier(operation.table, 'table')}" ADD COLUMN IF NOT EXISTS "${identifier(column.name, 'column')}" ${column.sqlType}${column.nullable ? '' : ' NOT NULL'}${defaultSql === null ? '' : ` DEFAULT ${defaultSql}`};`
    }
    if (operation.type === 'ADD_INDEX') {
      const index = operation.index
      const fields = index.fields.map((field) => `"${identifier(field, 'index field')}"`).join(', ')
      return `CREATE INDEX IF NOT EXISTS "${identifier(index.name, 'index')}" ON "${identifier(operation.table, 'table')}" (${fields});`
    }
    throw new ModuleEngineError(`Unsupported migration operation ${operation.type}`, 'AME_UNSUPPORTED_MIGRATION')
  })
}
