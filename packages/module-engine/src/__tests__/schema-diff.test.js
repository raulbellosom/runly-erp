import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyOperation,
  compileMigrationPlan,
  diffModelSchemas,
  operationBlocker,
  preflightQueries,
  hashNormalizedSchema,
  normalizeModelSchema,
} from '../schema-diff.js'

function model(fields = [], extra = {}) {
  return {
    key: 'vehicle', tableName: 'fleet_vehicle', companyScoped: true,
    fields, indexes: [], ...extra,
  }
}

function actualFrom(schema, { rowCount = 0 } = {}) {
  return { exists: true, rowCount, columns: schema.columns, indexes: schema.indexes }
}

test('normalization ignores UI metadata and produces stable schema hashes', () => {
  const left = normalizeModelSchema(model([{ name: 'plate', type: 'text', label: 'Plate' }]))
  const right = normalizeModelSchema(model([{ name: 'plate', type: 'text', label: 'Matrícula', placeholder: 'ABC' }]))
  assert.deepEqual(left, right)
  assert.equal(hashNormalizedSchema(left), hashNormalizedSchema(right))
})

test('new model produces CREATE_TABLE', () => {
  const definition = model([{ name: 'plate', type: 'text' }])
  const desired = normalizeModelSchema(definition)
  const result = diffModelSchemas({ previous: null, desired, actual: { exists: false }, modelDefinition: definition })
  assert.deepEqual(result.operations.map((operation) => operation.type), ['CREATE_TABLE'])
  assert.match(compileMigrationPlan({ operations: result.operations })[0], /CREATE TABLE IF NOT EXISTS "fleet_vehicle"/)
})

for (const [type, sqlType] of [
  ['text', 'VARCHAR(255)'], ['number', 'INTEGER'], ['boolean', 'BOOLEAN'],
  ['date', 'DATE'], ['datetime', 'TIMESTAMPTZ'], ['select', 'VARCHAR(64)'],
]) {
  test(`add nullable ${type} field produces safe ADD_COLUMN`, () => {
    const previous = normalizeModelSchema(model([]))
    const desired = normalizeModelSchema(model([{ name: 'value', type }]))
    const result = diffModelSchemas({ previous, desired, actual: actualFrom(previous), rowCount: 10 })
    assert.equal(result.operations[0].type, 'ADD_COLUMN')
    assert.equal(result.operations[0].safety, 'SAFE')
    assert.match(compileMigrationPlan({ operations: result.operations })[0], new RegExp(`${sqlType.replace(/[()]/g, '\\$&')}`))
  })
}

test('required column without default is conditional on an empty table and needs a backfill otherwise', () => {
  const previous = normalizeModelSchema(model([]))
  const desired = normalizeModelSchema(model([{ name: 'required_value', type: 'text', required: true }]))
  const empty = diffModelSchemas({ previous, desired, actual: actualFrom(previous), rowCount: 0 })
  const populated = diffModelSchemas({ previous, desired, actual: actualFrom(previous), rowCount: 5 })
  assert.equal(empty.operations[0].safety, 'CONDITIONAL')
  assert.equal(populated.operations[0].safety, 'NEEDS_BACKFILL')
  assert.throws(() => compileMigrationPlan({ operations: populated.operations }), /backfill_required/)
  const sql = compileMigrationPlan({ operations: populated.operations }, { [populated.operations[0].id]: { backfill: 'N/A' } })
  assert.deepEqual(sql, [
    'ALTER TABLE "fleet_vehicle" ADD COLUMN IF NOT EXISTS "required_value" VARCHAR(255);',
    `UPDATE "fleet_vehicle" SET "required_value" = 'N/A'::VARCHAR(255) WHERE "required_value" IS NULL;`,
    'ALTER TABLE "fleet_vehicle" ALTER COLUMN "required_value" SET NOT NULL;',
  ])
})

test('removed field is archived (data kept) and a different name without ids is archive + add', () => {
  const previous = normalizeModelSchema(model([{ name: 'mileage', type: 'number', required: true }]))
  const desired = normalizeModelSchema(model([{ name: 'odometer', type: 'text' }]))
  const result = diffModelSchemas({ previous, desired, actual: actualFrom(previous), rowCount: 3 })
  assert.deepEqual(result.operations.map((op) => `${op.type}:${op.safety}`), ['ARCHIVE_COLUMN:SAFE', 'ADD_COLUMN:SAFE'])
  assert.ok(compileMigrationPlan(result).includes('ALTER TABLE "fleet_vehicle" ALTER COLUMN "mileage" DROP NOT NULL;'))
})

test('same fieldId with a new name renames the column and keeps its data', () => {
  const id = '0192f000-0000-7000-8000-0000000000a1'
  const previous = normalizeModelSchema(model([{ id, name: 'mileage', type: 'number' }]))
  const desired = normalizeModelSchema(model([{ id, name: 'odometer', type: 'number' }]))
  const result = diffModelSchemas({ previous, desired, actual: actualFrom(previous), rowCount: 3 })
  assert.deepEqual(result.operations.map((op) => op.type), ['RENAME_COLUMN'])
  assert.deepEqual(compileMigrationPlan(result), ['ALTER TABLE "fleet_vehicle" RENAME COLUMN "mileage" TO "odometer";'])
})

test('legacy schema without ids matches by name, then ids take over', () => {
  const previous = normalizeModelSchema(model([{ name: 'mileage', type: 'number' }]))
  const desired = normalizeModelSchema(model([{ id: '0192f000-0000-7000-8000-0000000000a2', name: 'mileage', type: 'number' }]))
  assert.deepEqual(diffModelSchemas({ previous, desired, actual: actualFrom(previous) }).operations, [])
})

test('type change: supported pair converts, failing rows need a decision, unsupported pair is blocked', () => {
  const previous = normalizeModelSchema(model([{ name: 'code', type: 'text' }]))
  const desired = normalizeModelSchema(model([{ name: 'code', type: 'number', default: 0 }]))
  const result = diffModelSchemas({ previous, desired, actual: actualFrom(previous), rowCount: 4 })
  const typeOp = result.operations.find((op) => op.type === 'ALTER_COLUMN_TYPE')
  assert.equal(typeOp.safety, 'SAFE')
  const [query] = preflightQueries(result.operations)
  assert.match(query.sql, /NOT \(trim\("code"\) ~/)
  const failing = classifyOperation(typeOp, { failingRows: 2 })
  assert.equal(failing.safety, 'NEEDS_CONVERSION')
  assert.equal(operationBlocker(failing, {}), 'conversion_failing_rows')
  assert.equal(operationBlocker(failing, { onConversionFailure: 'null' }), null)
  const sql = compileMigrationPlan({ operations: [failing] }, { [failing.id]: { onConversionFailure: 'null' } })
  assert.match(sql[1], /^UPDATE "fleet_vehicle" SET "code" = NULL/)
  assert.match(sql[2], /TYPE INTEGER USING trim\("code"\)::INTEGER/)
  assert.match(sql[3], /SET DEFAULT 0/)

  const json = normalizeModelSchema(model([{ name: 'code', type: 'json' }]))
  assert.equal(diffModelSchemas({ previous, desired: json, actual: actualFrom(previous) }).operations[0].safety, 'UNSUPPORTED')
})

test('making a field required counts null rows and backfills them', () => {
  const previous = normalizeModelSchema(model([{ name: 'plate', type: 'text' }]))
  const desired = normalizeModelSchema(model([{ name: 'plate', type: 'text', required: true }]))
  const [op] = diffModelSchemas({ previous, desired, actual: actualFrom(previous), rowCount: 9 }).operations
  assert.equal(op.type, 'SET_NOT_NULL')
  assert.equal(classifyOperation(op, { nullRows: 0 }).safety, 'SAFE')
  const needs = classifyOperation(op, { nullRows: 3 })
  assert.equal(needs.failingRows, 3)
  assert.match(compileMigrationPlan({ operations: [needs] }, { [needs.id]: { backfill: 'SIN-PLACA' } })[0], /SET "plate" = 'SIN-PLACA'/)
})

test('archived column added back is restored without drift', () => {
  const previous = normalizeModelSchema(model([]))
  const desired = normalizeModelSchema(model([{ name: 'mileage', type: 'number' }]))
  const actual = actualFrom(previous)
  actual.columns = [...actual.columns, { name: 'mileage', sqlType: 'INTEGER', nullable: true, default: null }]
  const result = diffModelSchemas({ previous, desired, actual, archivedColumns: ['mileage'] })
  assert.deepEqual(result.drift, [])
  assert.deepEqual(result.operations.map((op) => op.type), ['RESTORE_COLUMN'])
  assert.deepEqual(diffModelSchemas({ previous, desired: previous, actual, archivedColumns: ['mileage'] }).warnings, [])
})

test('detects missing, mismatched and unexpected actual columns as drift or warning', () => {
  const previous = normalizeModelSchema(model([{ name: 'mileage', type: 'number' }]))
  const missing = actualFrom(previous)
  missing.columns = missing.columns.filter((column) => column.name !== 'mileage')
  const missingResult = diffModelSchemas({ previous, desired: previous, actual: missing })
  assert.equal(missingResult.drift[0].type, 'MISSING_EXPECTED_COLUMN')

  const wrong = actualFrom(previous)
  wrong.columns = wrong.columns.map((column) => column.name === 'mileage' ? { ...column, sqlType: 'TEXT' } : column)
  assert.ok(diffModelSchemas({ previous, desired: previous, actual: wrong }).drift.some((item) => item.type === 'COLUMN_MISMATCH'))

  const extra = actualFrom(previous)
  extra.columns = [...extra.columns, { name: 'legacy_column', sqlType: 'TEXT', nullable: true, default: null }]
  assert.ok(diffModelSchemas({ previous, desired: previous, actual: extra }).warnings.some((item) => item.type === 'UNEXPECTED_COLUMN'))
})

test('adds non-unique indexes; unique ones are checked for duplicates first', () => {
  const previous = normalizeModelSchema(model([{ name: 'status', type: 'select' }]))
  const safeDesired = normalizeModelSchema(model([{ name: 'status', type: 'select' }], { indexes: [{ fields: ['status'] }] }))
  const safe = diffModelSchemas({ previous, desired: safeDesired, actual: actualFrom(previous) })
  assert.equal(safe.operations[0].safety, 'SAFE')
  assert.match(compileMigrationPlan({ operations: safe.operations })[0], /CREATE INDEX IF NOT EXISTS/)

  const uniqueDesired = normalizeModelSchema(model([{ name: 'status', type: 'select' }], { indexes: [{ fields: ['status'], unique: true }] }))
  assert.equal(diffModelSchemas({ previous, desired: uniqueDesired, actual: actualFrom(previous) }).operations[0].safety, 'SAFE')
  const [unique] = diffModelSchemas({ previous, desired: uniqueDesired, actual: actualFrom(previous), rowCount: 5 }).operations
  assert.equal(unique.safety, 'NEEDS_CHECK')
  assert.equal(classifyOperation(unique, { duplicateGroups: 0 }).safety, 'SAFE')
  assert.equal(operationBlocker(classifyOperation(unique, { duplicateGroups: 2 })), 'duplicate_values')
})
