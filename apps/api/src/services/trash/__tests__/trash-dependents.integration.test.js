// Dependents + unlink against PostgreSQL, in ONE transaction rolled back at the end.
// Run: node --env-file=.env --test apps/api/src/services/trash/__tests__/trash-dependents.integration.test.js
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import pg from 'pg'
import { findDependents, unlinkDependents } from '../trash-dependents.js'
import { purgeWithDependents } from '../trash-purge.js'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL

describe('trash dependents against PostgreSQL (rolled back)', { skip: !url && 'no DATABASE_URL' }, () => {
  let client
  const db = {
    $queryRawUnsafe: async (sql, ...params) => (await client.query(sql, params)).rows,
    $executeRawUnsafe: async (sql, ...params) => (await client.query(sql, params)).rowCount,
  }
  const PARENT = '01900000-0000-7000-8000-0000000000a1'
  const OTHER = '01900000-0000-7000-8000-0000000000a2'

  before(async () => {
    client = new pg.Client({ connectionString: url })
    await client.connect()
    await client.query('BEGIN')
    await client.query(`CREATE TABLE trtest_parent (id uuid PRIMARY KEY, name text)`)
    await client.query(`CREATE TABLE trtest_optional (id serial PRIMARY KEY, parent uuid NULL REFERENCES trtest_parent(id))`)
    await client.query(`CREATE TABLE trtest_cascade (id serial PRIMARY KEY, parent uuid NOT NULL REFERENCES trtest_parent(id) ON DELETE CASCADE)`)
    await client.query(`CREATE TABLE trtest_required (id serial PRIMARY KEY, parent uuid NOT NULL REFERENCES trtest_parent(id))`)
    await client.query(`INSERT INTO trtest_parent VALUES ($1, 'con requerido'), ($2, 'solo opcional')`, [PARENT, OTHER])
    await client.query(`INSERT INTO trtest_optional (parent) VALUES ($1), ($1), ($2)`, [PARENT, OTHER])
    await client.query(`INSERT INTO trtest_cascade (parent) VALUES ($1), ($2)`, [PARENT, OTHER])
    await client.query(`INSERT INTO trtest_required (parent) VALUES ($1)`, [PARENT])
  })

  after(async () => {
    if (!client) return
    await client.query('ROLLBACK').catch(() => {})
    await client.end()
  })

  const provider = {
    id: 'test:parent', table: 'trtest_parent', transactional: false,
    purge: async (ctx, id) => { await client.query(`DELETE FROM trtest_parent WHERE id = $1`, [id]); return { id, label: 'x' } },
  }

  it('groups references and counts them', async () => {
    const deps = await findDependents(db, { table: 'trtest_parent', id: PARENT })
    assert.deepEqual(deps.unlinkable.map((d) => [d.table, d.count]), [['trtest_optional', 2]])
    assert.deepEqual(deps.cascade.map((d) => [d.table, d.count]), [['trtest_cascade', 1]])
    assert.deepEqual(deps.blocking.map((d) => [d.table, d.count]), [['trtest_required', 1]])
  })

  it('a required reference blocks; an optional one needs unlink, then purges and keeps the child', async () => {
    await assert.rejects(purgeWithDependents({ prisma: db }, provider, PARENT, { unlink: true }), (error) => error.code === 'in_use' && /trtest_required/.test(error.message))
    await assert.rejects(purgeWithDependents({ prisma: db }, provider, OTHER), (error) => error.code === 'needs_unlink')
    const { record } = await purgeWithDependents({ prisma: db }, provider, OTHER, { unlink: true })
    assert.equal(record.unlinked, 1)
    assert.equal((await client.query(`SELECT COUNT(*)::int AS n FROM trtest_optional WHERE parent IS NULL`)).rows[0].n, 1, 'child kept, field cleared')
    assert.equal((await client.query(`SELECT COUNT(*)::int AS n FROM trtest_cascade WHERE parent = $1`, [OTHER])).rows[0].n, 0, 'cascade rows deleted')
    assert.equal(await unlinkDependents(db, { dependents: { unlinkable: [] }, id: OTHER }), 0)
  })
})
