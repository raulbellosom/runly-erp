import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compileMigrationPlan,
  diffModelSchemas,
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

test('required column without default is conditional only for an empty table', () => {
  const previous = normalizeModelSchema(model([]))
  const desired = normalizeModelSchema(model([{ name: 'required_value', type: 'text', required: true }]))
  const empty = diffModelSchemas({ previous, desired, actual: actualFrom(previous), rowCount: 0 })
  const populated = diffModelSchemas({ previous, desired, actual: actualFrom(previous), rowCount: 5 })
  assert.equal(empty.operations[0].safety, 'CONDITIONAL')
  assert.equal(populated.operations[0].safety, 'UNSUPPORTED')
})

test('removed, renamed-looking and changed-type fields are never auto-applied', () => {
  const previous = normalizeModelSchema(model([{ name: 'mileage', type: 'number' }]))
  const desired = normalizeModelSchema(model([{ name: 'odometer', type: 'text' }]))
  const result = diffModelSchemas({ previous, desired, actual: actualFrom(previous), rowCount: 3 })
  assert.ok(result.operations.some((operation) => operation.type === 'DROP_COLUMN' && operation.safety === 'DESTRUCTIVE'))
  assert.ok(result.operations.some((operation) => operation.type === 'ADD_COLUMN'))

  const changed = normalizeModelSchema(model([{ name: 'mileage', type: 'text' }]))
  const typeResult = diffModelSchemas({ previous, desired: changed, actual: actualFrom(previous) })
  assert.ok(typeResult.operations.some((operation) => operation.type === 'ALTER_COLUMN_TYPE'))
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

test('adds non-unique indexes and blocks automatic unique index creation', () => {
  const previous = normalizeModelSchema(model([{ name: 'status', type: 'select' }]))
  const safeDesired = normalizeModelSchema(model([{ name: 'status', type: 'select' }], { indexes: [{ fields: ['status'] }] }))
  const safe = diffModelSchemas({ previous, desired: safeDesired, actual: actualFrom(previous) })
  assert.equal(safe.operations[0].safety, 'SAFE')
  assert.match(compileMigrationPlan({ operations: safe.operations })[0], /CREATE INDEX IF NOT EXISTS/)

  const uniqueDesired = normalizeModelSchema(model([{ name: 'status', type: 'select' }], { indexes: [{ fields: ['status'], unique: true }] }))
  assert.equal(diffModelSchemas({ previous, desired: uniqueDesired, actual: actualFrom(previous) }).operations[0].safety, 'UNSUPPORTED')
})
