import test from 'node:test'
import assert from 'node:assert/strict'
import { planDataMigrations, runDataMigrations } from '../module-data-migration-service.js'
import { backupTableName, orderByForeignKeys } from '../module-backup-service.js'

const file = (name, source = 'export async function up({ sql }) { await sql`SELECT 1` }') => ({ name, source, checksum: `sum-${name}` })

test('data migrations: pending, applied and edited-after-apply files', () => {
  const files = [file('001-a.js'), file('002-b.js'), file('003-c.js')]
  const ledger = [{ filename: 'data__001-a.js', checksum: 'sum-001-a.js' }, { filename: 'data__002-b.js', checksum: 'other' }]
  const plan = planDataMigrations(files, ledger)
  assert.deepEqual(plan.pending.map((f) => f.name), ['003-c.js'])
  assert.deepEqual(plan.applied, ['001-a.js'])
  assert.deepEqual(plan.blockers, [{ name: '002-b.js', reason: 'checksum_mismatch' }])
})

test('data migrations run in order with sql/companyIds and are recorded; a failure throws', async () => {
  const calls = []
  const tx = {
    company: { findMany: async () => [{ id: 'c1' }, { id: 'c2' }] },
    $executeRaw: async (query) => { calls.push(query.strings.join('?')); return 1 },
    $queryRaw: async () => [],
    moduleMigration: { create: async ({ data }) => calls.push(`ledger:${data.filename}`) },
  }
  const ran = await runDataMigrations(tx, {
    moduleKey: 'custom.taller',
    pending: [
      file('001-a.js', 'export async function up({ sql, companyIds }) { await sql`UPDATE t SET n = ${companyIds.length}` }'),
      file('002-b.js', 'export default async function ({ sql }) { await sql`DELETE FROM t` }'),
    ],
  })
  assert.deepEqual(ran, ['001-a.js', '002-b.js'])
  assert.deepEqual(calls, ['UPDATE t SET n = ?', 'ledger:data__001-a.js', 'DELETE FROM t', 'ledger:data__002-b.js'])
  await assert.rejects(
    runDataMigrations(tx, { moduleKey: 'custom.taller', pending: [file('003-x.js', 'export async function up() { throw new Error("boom") }')] }),
    /DATA_MIGRATION_FAILED: 003-x.js: boom/,
  )
})

test('backup names fit Postgres identifiers and restore order follows foreign keys', () => {
  const name = backupTableName('taller_orden_de_servicio_con_un_nombre_muy_largo_extra', new Date(Date.UTC(2026, 9, 3, 18, 5, 9)))
  assert.ok(name.length <= 63)
  assert.match(name, /__20261003180509$/)
  assert.deepEqual(
    orderByForeignKeys(['t_linea', 't_orden', 't_cliente'], [
      { table: 't_linea', references: 't_orden' },
      { table: 't_orden', references: 't_cliente' },
      { table: 't_orden', references: 'contact' },
    ]),
    ['t_cliente', 't_orden', 't_linea'],
  )
})
