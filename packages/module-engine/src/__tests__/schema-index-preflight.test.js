import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { preflightQueries } from '../schema-diff.js'

// Explicit local database opt-in. All state is connection-local and rolled back.
test('PostgreSQL unique preflight projects added/default/backfilled/converted values and excludes NULLs', { skip: !process.env.RUNLY_SCHEMA_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.RUNLY_SCHEMA_TEST_DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'synthetic local database required')
  const require = createRequire(new URL('../../../../apps/api/package.json', import.meta.url))
  const { PrismaClient } = require('@prisma/client'), { PrismaPg } = require('@prisma/adapter-pg')
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href }) }), rollback = new Error('fixture rollback')
  try {
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE s6_unique_preflight(company_id UUID, value TEXT) ON COMMIT DROP')
      await tx.$executeRawUnsafe("INSERT INTO s6_unique_preflight VALUES ('11111111-1111-4111-8111-111111111111',NULL),('11111111-1111-4111-8111-111111111111',NULL)")
      const unique = { id: 'index', table: 's6_unique_preflight', type: 'ADD_INDEX', safety: 'NEEDS_CHECK', index: { fields: ['company_id', 'marker'], unique: true } }
      const added = { id: 'added', table: unique.table, type: 'ADD_COLUMN', safety: 'SAFE', column: { name: 'marker', sqlType: 'INTEGER', nullable: true, default: null } }
      const count = async (operations, decisions) => Number((await tx.$queryRawUnsafe(preflightQueries(operations, decisions).find(q => q.kind === 'duplicateGroups').sql))[0].count)
      assert.equal(await count([added, unique]), 0, 'new nullable column does not exist yet; NULLs do not collide')
      assert.equal(await count([{ ...unique, index: { fields: ['company_id', 'value'], unique: true } }]), 0, 'existing NULLs do not collide')
      assert.equal(await count([{ ...added, column: { ...added.column, default: 2 } }, unique]), 1, 'literal default creates a duplicate group')
      assert.equal(await count([{ ...added, safety: 'NEEDS_BACKFILL' }, unique], { added: { backfill: 2 } }), 1, 'approved backfill creates a duplicate group')
      await tx.$executeRawUnsafe("UPDATE s6_unique_preflight SET value='1'; UPDATE s6_unique_preflight SET value='01' WHERE ctid=(SELECT min(ctid) FROM s6_unique_preflight)")
      assert.equal(await count([{ ...unique, index: { fields: ['company_id', 'value'], unique: true } }]), 0)
      const renamed = { table: unique.table, type: 'RENAME_COLUMN', column: 'marker', from: 'value' }
      const converted = { table: unique.table, type: 'ALTER_COLUMN_TYPE', column: 'marker', from: 'TEXT', to: 'INTEGER', safety: 'SAFE' }
      assert.equal(await count([renamed, converted, unique]), 1, 'renamed and converted values collide only after conversion')
      throw rollback
    }, { timeout: 20000 }), error => error === rollback)
  } finally { await db.$disconnect() }
})
