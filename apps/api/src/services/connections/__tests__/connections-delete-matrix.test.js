// Integration test of the generated connection SQL against the real database
// (spec 2026-10-03-rme3-module-platform-v2 §23, edge cases 1-9). Everything
// runs inside ONE transaction that is rolled back at the end: the test creates
// its own target/source tables, so no real data is read or changed.
//
// Run: node --env-file=.env --test apps/api/src/services/connections/__tests__/connections-delete-matrix.test.js
// Skipped when no database URL is configured.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import pg from 'pg'
import {
  buildBackfillSql, buildConnectionSql, buildDropConnectionSql, buildOrphanCountSql,
} from '@runly/module-engine'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
const MODULE = 'custom.conntest'
const COMPANY = '01900000-0000-7000-8000-000000000001'

const FIELDS = {
  moduleKey: MODULE, targetType: 'inventory_item', sourceTable: 'conntest_calibracion', targetTable: 'conntest_target',
  connection: { key: 'calib', kind: 'fields', targetField: 'articulo' },
  offeredColumns: ['certificado', 'laboratorio'], searchColumns: ['certificado', 'laboratorio'],
}
const related = (key, onTargetDelete) => ({
  moduleKey: MODULE, targetType: 'contact', sourceTable: `conntest_${key}`, targetTable: 'conntest_target',
  connection: { key, kind: 'related', targetField: 'persona', onTargetDelete },
  offeredColumns: ['estado'], searchColumns: [],
})

describe('connections: generated SQL against PostgreSQL (rolled back)', { skip: !url && 'no DATABASE_URL' }, () => {
  let client
  const q = async (sql, params) => (await client.query(sql, params)).rows
  const one = async (sql, params) => (await q(sql, params))[0]
  const indexRows = (key) => q(`SELECT * FROM public.connection_record WHERE module_key = $1 AND connection_key = $2 ORDER BY updated_at`, [MODULE, key])
  const newTarget = async () => (await one(`INSERT INTO public.conntest_target DEFAULT VALUES RETURNING id`)).id

  before(async () => {
    client = new pg.Client({ connectionString: url })
    await client.connect()
    await client.query('BEGIN')
    await client.query(`CREATE TABLE public.conntest_target (id uuid PRIMARY KEY DEFAULT uuidv7())`)
    await client.query(`CREATE TABLE public.conntest_calibracion (
      id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL, enabled boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now(), articulo uuid NOT NULL, certificado text, laboratorio text)`)
    for (const key of ['prestamo_null', 'prestamo_restrict', 'prestamo_cascade']) {
      await client.query(`CREATE TABLE public.conntest_${key} (
        id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL, enabled boolean NOT NULL DEFAULT true,
        updated_at timestamptz NOT NULL DEFAULT now(), persona uuid, estado text)`)
    }
  })

  after(async () => {
    if (!client) return
    await client.query('ROLLBACK')
    await client.end()
  })

  it('backfills existing rows when the connection is created', async () => {
    const target = await newTarget()
    await q(`INSERT INTO public.conntest_calibracion (company_id, articulo, certificado) VALUES ($1, $2, 'PRE-1')`, [COMPANY, target])
    assert.equal((await one(buildOrphanCountSql(FIELDS))).orphans, 0)
    for (const sql of buildConnectionSql(FIELDS)) await client.query(sql)
    await client.query(buildBackfillSql(FIELDS))
    const rows = await indexRows('calib')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].data.certificado, 'PRE-1')
    assert.equal(rows[0].target_type, 'inventory_item')
  })

  it('insert and update keep the index in sync; search finds by offered field', async () => {
    const target = await newTarget()
    const { id } = await one(`INSERT INTO public.conntest_calibracion (company_id, articulo, certificado, laboratorio) VALUES ($1, $2, 'LAB-2026-114', 'Metrología Norte') RETURNING id`, [COMPANY, target])
    let row = (await indexRows('calib')).find((r) => r.source_record_id === id)
    assert.equal(row.target_id, target)
    assert.equal(row.company_id, COMPANY)
    await q(`UPDATE public.conntest_calibracion SET certificado = 'LAB-2026-200' WHERE id = $1`, [id])
    row = (await indexRows('calib')).find((r) => r.source_record_id === id)
    assert.equal(row.data.certificado, 'LAB-2026-200')
    const found = await q(`SELECT target_id FROM public.connection_record WHERE module_key = $1 AND search_text @@ plainto_tsquery('simple', $2)`, [MODULE, 'metrología'])
    assert.ok(found.some((r) => r.target_id === target))
  })

  it('1:1 fields connection rejects a second row for the same target', async () => {
    const target = await newTarget()
    await q(`INSERT INTO public.conntest_calibracion (company_id, articulo) VALUES ($1, $2)`, [COMPANY, target])
    await client.query('SAVEPOINT dup')
    await assert.rejects(q(`INSERT INTO public.conntest_calibracion (company_id, articulo) VALUES ($1, $2)`, [COMPANY, target]), (error) => error.code === '23505')
    await client.query('ROLLBACK TO SAVEPOINT dup')
  })

  it('source soft delete marks the index row disabled; hard delete removes it', async () => {
    const target = await newTarget()
    const { id } = await one(`INSERT INTO public.conntest_calibracion (company_id, articulo) VALUES ($1, $2) RETURNING id`, [COMPANY, target])
    await q(`UPDATE public.conntest_calibracion SET enabled = false WHERE id = $1`, [id])
    assert.equal((await indexRows('calib')).find((r) => r.source_record_id === id).enabled, false)
    await q(`DELETE FROM public.conntest_calibracion WHERE id = $1`, [id])
    assert.equal((await indexRows('calib')).find((r) => r.source_record_id === id), undefined)
  })

  it('core record hard delete cascades to fields rows and clears the index', async () => {
    const target = await newTarget()
    const { id } = await one(`INSERT INTO public.conntest_calibracion (company_id, articulo) VALUES ($1, $2) RETURNING id`, [COMPANY, target])
    await q(`DELETE FROM public.conntest_target WHERE id = $1`, [target])
    assert.equal(await one(`SELECT id FROM public.conntest_calibracion WHERE id = $1`, [id]), undefined)
    assert.equal((await indexRows('calib')).find((r) => r.source_record_id === id), undefined)
  })

  it('related setNull: core delete nulls the reference and removes the index row', async () => {
    const spec = related('prestamo_null', 'setNull')
    for (const sql of buildConnectionSql(spec)) await client.query(sql)
    const target = await newTarget()
    const { id } = await one(`INSERT INTO public.conntest_prestamo_null (company_id, persona, estado) VALUES ($1, $2, 'PRESTADO') RETURNING id`, [COMPANY, target])
    assert.equal((await indexRows('prestamo_null')).length, 1)
    await q(`DELETE FROM public.conntest_target WHERE id = $1`, [target])
    assert.equal((await one(`SELECT persona FROM public.conntest_prestamo_null WHERE id = $1`, [id])).persona, null)
    assert.equal((await indexRows('prestamo_null')).length, 0)
  })

  it('related cascade: core delete removes related rows and their index rows', async () => {
    const spec = related('prestamo_cascade', 'cascade')
    for (const sql of buildConnectionSql(spec)) await client.query(sql)
    const target = await newTarget()
    await q(`INSERT INTO public.conntest_prestamo_cascade (company_id, persona) VALUES ($1, $2), ($1, $2)`, [COMPANY, target])
    assert.equal((await indexRows('prestamo_cascade')).length, 2)
    await q(`DELETE FROM public.conntest_target WHERE id = $1`, [target])
    assert.equal((await indexRows('prestamo_cascade')).length, 0)
  })

  it('related restrict: core delete fails with 23503 on a runly_conn_ constraint (bulk included)', async () => {
    const spec = related('prestamo_restrict', 'restrict')
    for (const sql of buildConnectionSql(spec)) await client.query(sql)
    const blocked = await newTarget()
    const free = await newTarget()
    await q(`INSERT INTO public.conntest_prestamo_restrict (company_id, persona) VALUES ($1, $2)`, [COMPANY, blocked])
    await client.query('SAVEPOINT restrict')
    await assert.rejects(
      q(`DELETE FROM public.conntest_target WHERE id = ANY($1::uuid[])`, [[blocked, free]]),
      (error) => error.code === '23503' && String(error.constraint).startsWith('runly_conn_'),
    )
    await client.query('ROLLBACK TO SAVEPOINT restrict')
    assert.ok(await one(`SELECT id FROM public.conntest_target WHERE id = $1`, [free]), 'bulk delete is atomic: the free record survives')
  })

  it('dropping a connection removes its trigger and index rows but keeps data', async () => {
    const before = await one(`SELECT count(*)::int AS n FROM public.conntest_calibracion`)
    for (const sql of buildDropConnectionSql(FIELDS)) await client.query(sql)
    assert.equal((await indexRows('calib')).length, 0)
    const target = await newTarget()
    await q(`INSERT INTO public.conntest_calibracion (company_id, articulo) VALUES ($1, $2)`, [COMPANY, target])
    assert.equal((await indexRows('calib')).length, 0, 'no trigger after drop')
    assert.equal((await one(`SELECT count(*)::int AS n FROM public.conntest_calibracion`)).n, before.n + 1)
  })
})
