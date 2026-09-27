import test from 'node:test'
import assert from 'node:assert/strict'
import { createModuleSchemaMigrationService } from '../module-schema-migration-service.js'

const previousModel = {
  key: 'vehicle', tableName: 'diff_vehicle', companyScoped: true,
  fields: [{ name: 'plate', type: 'text' }], indexes: [],
}
const desiredModel = {
  ...previousModel,
  fields: [...previousModel.fields, { name: 'mileage', type: 'number' }],
}

function column(column_name, data_type, overrides = {}) {
  return {
    column_name, data_type, udt_name: data_type,
    is_nullable: 'NO', column_default: null,
    character_maximum_length: null, numeric_precision: null, numeric_scale: null,
    ...overrides,
  }
}

function makePrisma({ wrongMileageType = false } = {}) {
  const state = {
    migrations: [],
    columns: [
      column('id', 'uuid', { udt_name: 'uuid', column_default: 'uuidv7()' }),
      column('company_id', 'uuid', { udt_name: 'uuid' }),
      column('plate', 'character varying', { udt_name: 'varchar', is_nullable: 'YES', character_maximum_length: 255 }),
      column('created_at', 'timestamp with time zone', { udt_name: 'timestamptz', column_default: 'now()' }),
      column('updated_at', 'timestamp with time zone', { udt_name: 'timestamptz', column_default: 'now()' }),
    ],
  }
  if (wrongMileageType) state.columns.push(column('mileage', 'text', { is_nullable: 'YES' }))
  const db = {
    runlyModel: { findMany: async () => [{ name: 'vehicle', tableName: 'diff_vehicle', schema: previousModel }] },
    moduleMigration: {
      findUnique: async ({ where }) => state.migrations.find((item) => item.filename === where.moduleKey_filename.filename) ?? null,
      create: async ({ data }) => { const row = { id: 'migration-1', ...data }; state.migrations.push(row); return row },
    },
    $queryRawUnsafe: async (sql) => {
      if (sql.includes('to_regclass')) return [{ relation: 'diff_vehicle' }]
      if (sql.includes('information_schema.columns')) return state.columns
      if (sql.includes('pg_indexes')) return []
      if (sql.includes('COUNT(*)')) return [{ count: 2n }]
      throw new Error(`Unexpected query: ${sql}`)
    },
    $executeRawUnsafe: async (sql) => {
      if (sql.includes('"mileage"')) state.columns.push(column('mileage', 'integer', { is_nullable: 'YES' }))
      return 0
    },
  }
  db.$transaction = async (callback) => callback(db)
  return { prisma: db, state }
}

test('plans and transactionally applies ADD_COLUMN, verifies it and records a deterministic migration', async () => {
  const { prisma, state } = makePrisma()
  const service = createModuleSchemaMigrationService({ prisma })
  const moduleRow = { status: 'INSTALLED' }
  const plan = await service.planModuleSchemaMigration({ moduleKey: 'custom.fleet', desiredModels: [desiredModel], moduleRow })
  assert.equal(plan.required, true)
  assert.equal(plan.canAutoApply, true)
  assert.equal(plan.operations[0].type, 'ADD_COLUMN')
  assert.match(plan.filename, /^schema__[a-f0-9]{24}\.sql$/)
  const applied = await service.applyModuleSchemaMigration({ plan })
  assert.equal(applied.applied, true)
  assert.equal(state.migrations.length, 1)
  assert.ok(state.columns.some((item) => item.column_name === 'mileage'))
  const repeated = await service.applyModuleSchemaMigration({ plan })
  assert.equal(repeated.reason, 'already_applied')
})

test('detects an existing wrong column type as schema drift and blocks auto apply', async () => {
  const { prisma } = makePrisma({ wrongMileageType: true })
  const service = createModuleSchemaMigrationService({ prisma })
  const plan = await service.planModuleSchemaMigration({
    moduleKey: 'custom.fleet', desiredModels: [desiredModel], moduleRow: { status: 'INSTALLED' },
  })
  assert.equal(plan.canAutoApply, false)
  assert.ok(plan.drift.some((item) => item.type === 'COLUMN_MISMATCH' && item.column === 'mileage'))
  await assert.rejects(service.applyModuleSchemaMigration({ plan }), { code: 'SCHEMA_DRIFT_DETECTED' })
})

test('uninstalled packages do not inspect or migrate database schema', async () => {
  const { prisma } = makePrisma()
  let inspected = false
  prisma.$queryRawUnsafe = async () => { inspected = true; return [] }
  const service = createModuleSchemaMigrationService({ prisma })
  const plan = await service.planModuleSchemaMigration({
    moduleKey: 'custom.fleet', desiredModels: [], moduleRow: { status: 'UNINSTALLED' },
  })
  assert.equal(plan.required, false)
  assert.equal(inspected, false)
})
