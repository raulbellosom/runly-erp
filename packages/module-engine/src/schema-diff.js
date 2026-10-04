import { createHash } from 'node:crypto'
import { SQL_TYPE_MAP } from './field-types.js'
import { generateCreateTableSql } from './sql-generator.js'
import { ModuleEngineError } from './errors.js'
import { columnConversion, conversionFailingRowsSql, conversionSql } from './schema-conversions.js'

const IDENTIFIER_RE = /^[a-z][a-z0-9_]*$/
const FIELD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Safety classes (spec 2026-10-03-rme3-module-platform-v2 §8.3, plan Task 4.2):
//   SAFE / CONDITIONAL       applied as is
//   NEEDS_BACKFILL           a required column meets existing rows: needs decisions[id].backfill
//   NEEDS_CONVERSION         type change with rows that do not convert: needs onConversionFailure 'null'
//   NEEDS_CHECK              unique index over duplicated values: the data must be fixed first
//   DESTRUCTIVE/UNSUPPORTED  never applied by an update
export const AUTO_SAFETY = Object.freeze(['SAFE', 'CONDITIONAL'])
export const DECIDABLE_SAFETY = Object.freeze(['NEEDS_BACKFILL', 'NEEDS_CONVERSION'])

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
        // Stable field id (Builder fieldId / defineModel field `id`): lets a
        // rename keep the column and its data instead of drop + add.
        ...(FIELD_ID_RE.test(field.id ?? '') ? { fieldId: String(field.id).toLowerCase() } : {}),
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

const opId = (type, table, name) => `${type}:${table}:${name}`

// Operations turning column `from` (previous, or an archived actual column)
// into `to`. Counts that need the database (null rows, failing conversions)
// are filled later by the API preflight (preflightQueries/classifyOperation).
function columnChangeOperations(table, from, to, rowCount) {
  const operations = []
  if (from.sqlType !== to.sqlType) {
    const supported = Boolean(columnConversion(from.sqlType, to.sqlType))
    operations.push({
      id: opId('ALTER_COLUMN_TYPE', table, to.name), type: 'ALTER_COLUMN_TYPE', table, column: to.name,
      from: from.sqlType, to: to.sqlType, nextDefault: to.default, nullable: to.nullable,
      safety: supported ? 'SAFE' : 'UNSUPPORTED', needs: supported ? 'conversion' : undefined,
    })
  }
  if (from.nullable && !to.nullable) {
    operations.push({
      id: opId('SET_NOT_NULL', table, to.name), type: 'SET_NOT_NULL', table, column: to.name, sqlType: to.sqlType,
      default: to.default, safety: rowCount > 0 ? 'NEEDS_BACKFILL' : 'SAFE', needs: 'backfill', rowCount,
    })
  } else if (!from.nullable && to.nullable) {
    operations.push({ id: opId('DROP_NOT_NULL', table, to.name), type: 'DROP_NOT_NULL', table, column: to.name, safety: 'SAFE' })
  }
  if (!sameDefault(from.default, to.default) && from.sqlType === to.sqlType) {
    operations.push({ id: opId('ALTER_COLUMN_DEFAULT', table, to.name), type: 'ALTER_COLUMN_DEFAULT', table, column: to.name, default: to.default, safety: 'SAFE' })
  }
  return operations
}

// archivedColumns: names of columns kept in the table after their field was
// removed (ARCHIVE_COLUMN). They are neither drift nor unexpected, and a field
// added back with that name restores the column with its data.
export function diffModelSchemas({ previous, desired, actual, rowCount = 0, modelDefinition, archivedColumns = [] }) {
  const operations = []
  const drift = []
  const warnings = []
  if (!previous && !actual?.exists) {
    operations.push({ id: opId('CREATE_TABLE', desired.table, desired.table), type: 'CREATE_TABLE', table: desired.table, model: desired.model, safety: 'SAFE', modelDefinition })
    return { operations, drift, warnings }
  }
  if (!actual?.exists) {
    drift.push({ type: 'MISSING_TABLE', table: desired.table, expected: previous })
    return { operations, drift, warnings }
  }

  const table = desired.table
  const archived = new Set(archivedColumns)
  const actualColumns = new Map(actual.columns.map((column) => [column.name, column]))
  const previousColumns = new Map((previous?.columns ?? []).map((column) => [column.name, column]))
  const previousById = new Map((previous?.columns ?? []).filter((column) => column.fieldId).map((column) => [column.fieldId, column]))
  const desiredColumns = new Map(desired.columns.map((column) => [column.name, column]))
  for (const expected of previous?.columns ?? []) {
    const found = actualColumns.get(expected.name)
    if (!found) drift.push({ type: 'MISSING_EXPECTED_COLUMN', table, column: expected.name, expected })
    else for (const mismatch of compareColumn(expected, found)) {
      drift.push({ type: 'COLUMN_MISMATCH', table, column: expected.name, ...mismatch })
    }
  }
  for (const found of actual.columns) {
    if (!previousColumns.has(found.name) && !archived.has(found.name)) warnings.push({ type: 'UNEXPECTED_COLUMN', table, column: found.name })
  }

  // Match desired columns to previous ones: same fieldId first (a rename),
  // then same name (legacy schemas without ids).
  const matched = new Map()
  for (const nextColumn of desired.columns) {
    const byId = nextColumn.fieldId ? previousById.get(nextColumn.fieldId) : null
    const byName = previousColumns.get(nextColumn.name)
    const source = byId ?? (byName && (!byName.fieldId || !nextColumn.fieldId || byName.fieldId === nextColumn.fieldId) ? byName : null)
    if (source) matched.set(nextColumn.name, source)
  }
  const consumed = new Set([...matched.values()].map((column) => column.name))

  for (const oldColumn of previous?.columns ?? []) {
    if (consumed.has(oldColumn.name)) continue
    operations.push({
      id: opId('ARCHIVE_COLUMN', table, oldColumn.name), type: 'ARCHIVE_COLUMN', table, column: oldColumn.name,
      nullable: oldColumn.nullable, safety: oldColumn.managed === false || ['id', 'company_id', 'created_at', 'updated_at'].includes(oldColumn.name) ? 'UNSUPPORTED' : 'SAFE',
    })
  }
  for (const nextColumn of desired.columns) {
    const source = matched.get(nextColumn.name)
    if (source) {
      if (source.name !== nextColumn.name) {
        const taken = actualColumns.has(nextColumn.name)
        operations.push({
          id: opId('RENAME_COLUMN', table, nextColumn.name), type: 'RENAME_COLUMN', table, from: source.name, column: nextColumn.name,
          safety: taken ? 'UNSUPPORTED' : 'SAFE', ...(taken ? { reason: 'target_column_exists' } : {}),
        })
      }
      operations.push(...columnChangeOperations(table, source, nextColumn, rowCount))
      continue
    }
    const actualColumn = actualColumns.get(nextColumn.name)
    if (actualColumn && archived.has(nextColumn.name)) {
      operations.push({ id: opId('RESTORE_COLUMN', table, nextColumn.name), type: 'RESTORE_COLUMN', table, column: nextColumn.name, safety: 'SAFE' })
      operations.push(...columnChangeOperations(table, actualColumn, nextColumn, rowCount))
      continue
    }
    if (actualColumn && previousColumns.has(nextColumn.name)) {
      // Same name as a previous column with another fieldId (being archived).
      operations.push({ id: opId('ADD_COLUMN', table, nextColumn.name), type: 'ADD_COLUMN', table, column: nextColumn, safety: 'UNSUPPORTED', reason: 'name_reused', rowCount })
      continue
    }
    if (actualColumn) {
      const mismatches = compareColumn(nextColumn, actualColumn)
      if (mismatches.length) drift.push({ type: 'COLUMN_MISMATCH', table, column: nextColumn.name, mismatches })
      else warnings.push({ type: 'BASELINE_COLUMN', table, column: nextColumn.name })
      continue
    }
    const required = nextColumn.nullable === false && nextColumn.default === null
    operations.push({
      id: opId('ADD_COLUMN', table, nextColumn.name), type: 'ADD_COLUMN', table, column: nextColumn,
      safety: required ? (rowCount === 0 ? 'CONDITIONAL' : 'NEEDS_BACKFILL') : 'SAFE',
      ...(required && rowCount > 0 ? { needs: 'backfill' } : {}),
      rowCount,
    })
  }

  const previousIndexes = new Map((previous?.indexes ?? []).map((index) => [index.name, index]))
  const actualIndexes = new Map((actual.indexes ?? []).map((index) => [index.name, index]))
  const desiredIndexes = new Map(desired.indexes.map((index) => [index.name, index]))
  for (const expectedIndex of previous?.indexes ?? []) {
    const found = actualIndexes.get(expectedIndex.name)
    if (!found) drift.push({ type: 'MISSING_EXPECTED_INDEX', table, index: expectedIndex.name })
    else if (found.unique !== expectedIndex.unique || JSON.stringify(found.fields) !== JSON.stringify(expectedIndex.fields)) {
      drift.push({ type: 'INDEX_MISMATCH', table, index: expectedIndex.name, expected: expectedIndex, actual: found })
    }
  }
  for (const found of actual.indexes ?? []) {
    if (!previousIndexes.has(found.name) && !String(found.name).endsWith('_pkey')) {
      warnings.push({ type: 'UNEXPECTED_INDEX', table, index: found.name })
    }
  }
  // Dropping an index never loses data.
  for (const oldIndex of previous?.indexes ?? []) {
    if (!desiredIndexes.has(oldIndex.name)) operations.push({ id: opId('DROP_INDEX', table, oldIndex.name), type: 'DROP_INDEX', table, index: oldIndex, safety: 'SAFE' })
  }
  for (const nextIndex of desired.indexes) {
    if (previousIndexes.has(nextIndex.name) || actualIndexes.has(nextIndex.name)) continue
    operations.push({
      id: opId('ADD_INDEX', table, nextIndex.name), type: 'ADD_INDEX', table, index: nextIndex,
      safety: nextIndex.unique && rowCount > 0 ? 'NEEDS_CHECK' : 'SAFE',
      ...(nextIndex.unique && rowCount > 0 ? { needs: 'unique' } : {}),
    })
  }
  return { operations, drift, warnings }
}

// Count queries the API runs before deciding an operation's final safety.
// Column names are the post-rename ones; renames run first, so preflight
// queries use the column name that exists *now* (`from` for renamed columns).
export function preflightQueries(operations) {
  const renamedFrom = new Map(operations.filter((op) => op.type === 'RENAME_COLUMN').map((op) => [`${op.table}.${op.column}`, op.from]))
  const current = (op) => identifier(renamedFrom.get(`${op.table}.${op.column}`) ?? op.column, 'column')
  const queries = []
  for (const op of operations) {
    const table = op.table && identifier(op.table, 'table')
    if (op.type === 'ALTER_COLUMN_TYPE' && op.safety === 'SAFE') {
      const sql = conversionFailingRowsSql(table, current(op), op.from, op.to)
      if (sql) queries.push({ id: op.id, kind: 'failingRows', sql })
    }
    if (op.type === 'SET_NOT_NULL' && op.safety === 'NEEDS_BACKFILL') {
      queries.push({ id: op.id, kind: 'nullRows', sql: `SELECT COUNT(*)::bigint AS count FROM "${table}" WHERE "${current(op)}" IS NULL` })
    }
    if (op.type === 'ADD_INDEX' && op.safety === 'NEEDS_CHECK') {
      const fields = op.index.fields.map((field) => `"${identifier(renamedFrom.get(`${op.table}.${field}`) ?? field, 'index field')}"`).join(', ')
      queries.push({ id: op.id, kind: 'duplicateGroups', sql: `SELECT COUNT(*)::bigint AS count FROM (SELECT 1 FROM "${table}" GROUP BY ${fields} HAVING COUNT(*) > 1) d` })
    }
  }
  return queries
}

// Final safety once preflight counts are known.
export function classifyOperation(op, counts = {}) {
  if (op.type === 'ALTER_COLUMN_TYPE' && op.safety === 'SAFE' && counts.failingRows > 0) {
    return { ...op, safety: 'NEEDS_CONVERSION', failingRows: counts.failingRows }
  }
  if (op.type === 'SET_NOT_NULL' && op.safety === 'NEEDS_BACKFILL') {
    return counts.nullRows > 0 ? { ...op, failingRows: counts.nullRows } : { ...op, safety: 'SAFE', failingRows: 0 }
  }
  if (op.type === 'ADD_INDEX' && op.safety === 'NEEDS_CHECK') {
    return counts.duplicateGroups > 0 ? { ...op, failingRows: counts.duplicateGroups } : { ...op, safety: 'SAFE' }
  }
  return op
}

// Whether an operation can run with the given decisions; returns the reason when not.
export function operationBlocker(op, decision = {}) {
  if (AUTO_SAFETY.includes(op.safety)) return null
  if (op.safety === 'NEEDS_BACKFILL') {
    const value = decision.backfill
    return ['string', 'number', 'boolean'].includes(typeof value) && value !== '' ? null : 'backfill_required'
  }
  if (op.safety === 'NEEDS_CONVERSION') {
    if (decision.onConversionFailure !== 'null') return 'conversion_failing_rows'
    return op.nullable ? null : 'conversion_null_not_allowed'
  }
  if (op.safety === 'NEEDS_CHECK') return 'duplicate_values'
  return op.safety === 'DESTRUCTIVE' ? 'destructive' : 'unsupported'
}

function sqlLiteral(value) {
  if (value === null) return null
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  throw new ModuleEngineError('Unsupported SQL default literal', 'AME_UNSAFE_DEFAULT')
}

function typedLiteral(value, sqlType) {
  const literal = sqlLiteral(value)
  return sqlType.endsWith('[]') ? `ARRAY[${literal}]::${sqlType}` : `${literal}::${sqlType}`
}

// Statement order: renames, type changes, new/restored columns, nullability
// and defaults, archives, then indexes (which may reference renamed columns).
const ORDER = ['CREATE_TABLE', 'RENAME_COLUMN', 'ALTER_COLUMN_TYPE', 'ADD_COLUMN', 'RESTORE_COLUMN', 'SET_NOT_NULL', 'DROP_NOT_NULL', 'ALTER_COLUMN_DEFAULT', 'ARCHIVE_COLUMN', 'DROP_INDEX', 'ADD_INDEX']

function operationSql(op, decision) {
  const table = op.table && identifier(op.table, 'table')
  const column = (name) => `"${identifier(name, 'column')}"`
  switch (op.type) {
    case 'CREATE_TABLE': return [generateCreateTableSql(op.modelDefinition)]
    case 'RENAME_COLUMN': return [`ALTER TABLE "${table}" RENAME COLUMN ${column(op.from)} TO ${column(op.column)};`]
    case 'ALTER_COLUMN_TYPE': {
      const nextDefault = sqlLiteral(op.nextDefault ?? null)
      return [
        `ALTER TABLE "${table}" ALTER COLUMN ${column(op.column)} DROP DEFAULT;`,
        ...conversionSql(table, identifier(op.column, 'column'), op.from, op.to, { nullFailing: decision.onConversionFailure === 'null' }),
        ...(nextDefault === null ? [] : [`ALTER TABLE "${table}" ALTER COLUMN ${column(op.column)} SET DEFAULT ${nextDefault};`]),
      ]
    }
    case 'ADD_COLUMN': {
      const col = op.column
      const defaultSql = sqlLiteral(col.default)
      const head = `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS ${column(col.name)} ${col.sqlType}`
      if (op.safety === 'NEEDS_BACKFILL') {
        return [
          `${head};`,
          `UPDATE "${table}" SET ${column(col.name)} = ${typedLiteral(decision.backfill, col.sqlType)} WHERE ${column(col.name)} IS NULL;`,
          `ALTER TABLE "${table}" ALTER COLUMN ${column(col.name)} SET NOT NULL;`,
        ]
      }
      return [`${head}${col.nullable ? '' : ' NOT NULL'}${defaultSql === null ? '' : ` DEFAULT ${defaultSql}`};`]
    }
    case 'RESTORE_COLUMN': return []
    case 'SET_NOT_NULL': return [
      ...(op.safety === 'NEEDS_BACKFILL' ? [`UPDATE "${table}" SET ${column(op.column)} = ${typedLiteral(decision.backfill, op.sqlType)} WHERE ${column(op.column)} IS NULL;`] : []),
      `ALTER TABLE "${table}" ALTER COLUMN ${column(op.column)} SET NOT NULL;`,
    ]
    case 'DROP_NOT_NULL': return [`ALTER TABLE "${table}" ALTER COLUMN ${column(op.column)} DROP NOT NULL;`]
    case 'ALTER_COLUMN_DEFAULT': {
      const value = sqlLiteral(op.default ?? null)
      return [`ALTER TABLE "${table}" ALTER COLUMN ${column(op.column)} ${value === null ? 'DROP DEFAULT' : `SET DEFAULT ${value}`};`]
    }
    // Archive keeps the column and its data; it only stops being required.
    case 'ARCHIVE_COLUMN': return op.nullable ? [] : [`ALTER TABLE "${table}" ALTER COLUMN ${column(op.column)} DROP NOT NULL;`]
    case 'DROP_INDEX': return [`DROP INDEX IF EXISTS "${identifier(op.index.name, 'index')}";`]
    case 'ADD_INDEX': {
      const index = op.index
      const fields = index.fields.map((field) => `"${identifier(field, 'index field')}"`).join(', ')
      return [`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS "${identifier(index.name, 'index')}" ON "${table}" (${fields});`]
    }
    default: throw new ModuleEngineError(`Unsupported migration operation ${op.type}`, 'AME_UNSUPPORTED_MIGRATION')
  }
}

// SQL for every operation, in dependency order. Throws when an operation is
// not applicable with the given decisions ({ [operation.id]: decision }).
export function compileMigrationPlan(plan, decisions = {}) {
  const blocked = plan.operations
    .map((op) => ({ op, reason: operationBlocker(op, decisions[op.id]) }))
    .filter((entry) => entry.reason)
  if (blocked.length) {
    throw new ModuleEngineError(`Migration blocked: ${blocked.map((entry) => `${entry.op.id} (${entry.reason})`).join(', ')}`, 'AME_UNSUPPORTED_MIGRATION')
  }
  return [...plan.operations]
    .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type))
    .flatMap((op) => operationSql(op, decisions[op.id] ?? {}))
}
