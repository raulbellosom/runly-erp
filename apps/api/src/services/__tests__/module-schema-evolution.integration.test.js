// Safe schema evolution against the real database (spec
// 2026-10-03-rme3-module-platform-v2 §25 acceptance 12-14). Everything runs in
// ONE transaction rolled back at the end, on tables the test creates itself.
//
// Run: node --env-file=.env --test apps/api/src/services/__tests__/module-schema-evolution.integration.test.js
// Skipped when no database URL is configured.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import pg from 'pg'
import {
  classifyOperation, compileMigrationPlan, diffModelSchemas, normalizeModelSchema, preflightQueries,
} from '@runly/module-engine'
import { createModuleBackupService } from '../module-backup-service.js'

const byJson = (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))
const url = process.env.DIRECT_URL || process.env.DATABASE_URL
const TABLE = 'evotest_vehiculo'
const PLATE_ID = '0192f000-0000-7000-8000-0000000000b1'
const model = (fields) => ({ key: 'vehiculo', tableName: TABLE, companyScoped: false, softDelete: false, fields, indexes: [] })
const V1 = model([
  { id: PLATE_ID, name: 'placa', type: 'text' },
  { name: 'kilometraje', type: 'text' },
])
const V2 = model([
  { id: PLATE_ID, name: 'matricula', type: 'text', required: true },
  { name: 'kilometraje', type: 'number' },
  { name: 'color', type: 'text', required: true },
])

describe('schema evolution against PostgreSQL (rolled back)', { skip: !url && 'no DATABASE_URL' }, () => {
  let client
  // Minimal Prisma-like tx over the pg client for the backup service.
  const tx = {
    $queryRawUnsafe: async (sql, ...params) => (await client.query(sql, params)).rows,
    $executeRawUnsafe: async (sql, ...params) => (await client.query(sql, params)).rowCount,
    moduleSchemaBackup: {
      create: async ({ data }) => (await client.query(
        `INSERT INTO public.module_schema_backup (module_key, version_from, version_to, tables, created_by_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, module_key AS "moduleKey", tables`,
        [data.moduleKey, data.versionFrom, data.versionTo, JSON.stringify(data.tables), data.createdById, data.expiresAt],
      )).rows[0],
      update: async ({ where }) => client.query(`UPDATE public.module_schema_backup SET restored_at = now() WHERE id = $1`, [where.id]),
    },
  }
  const rows = async () => (await client.query(`SELECT * FROM ${TABLE} ORDER BY kilometraje::text NULLS LAST, 1`)).rows
  const actual = async () => {
    const columns = (await client.query(
      `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default FROM information_schema.columns WHERE table_name = $1`, [TABLE],
    )).rows
    const type = (c) => (c.data_type === 'character varying' ? `VARCHAR(${c.character_maximum_length})` : c.data_type === 'timestamp with time zone' ? 'TIMESTAMPTZ' : c.data_type.toUpperCase())
    return { exists: true, columns: columns.map((c) => ({ name: c.column_name, sqlType: type(c), nullable: c.is_nullable === 'YES', default: c.column_default })), indexes: [] }
  }

  before(async () => {
    client = new pg.Client({ connectionString: url })
    await client.connect()
    await client.query('BEGIN')
    await client.query(`CREATE TABLE ${TABLE} (id UUID PRIMARY KEY DEFAULT uuidv7(), placa VARCHAR(255), kilometraje VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
    await client.query(`INSERT INTO ${TABLE} (placa, kilometraje) VALUES ('ABC-1', '1200'), (NULL, 'mucho'), ('XYZ-9', NULL)`)
  })

  after(async () => {
    if (!client) return
    await client.query('ROLLBACK').catch(() => {})
    await client.end()
  })

  it('backs up, renames, converts, backfills and restores', async () => {
    const backupSvc = createModuleBackupService({ prisma: null })
    const previous = normalizeModelSchema(V1)
    const diff = diffModelSchemas({ previous, desired: normalizeModelSchema(V2), actual: await actual(), rowCount: 3 })
    const counts = new Map()
    for (const query of preflightQueries(diff.operations)) {
      counts.set(query.id, { ...(counts.get(query.id) ?? {}), [query.kind]: Number((await client.query(query.sql)).rows[0].count) })
    }
    const operations = diff.operations.map((op) => classifyOperation(op, counts.get(op.id)))
    const byType = Object.fromEntries(operations.map((op) => [op.type + ':' + (op.column?.name ?? op.column), op]))
    assert.equal(byType['RENAME_COLUMN:matricula'].from, 'placa')
    assert.equal(byType['ALTER_COLUMN_TYPE:kilometraje'].failingRows, 1)
    assert.equal(byType['SET_NOT_NULL:matricula'].failingRows, 1)
    assert.equal(byType['ADD_COLUMN:color'].safety, 'NEEDS_BACKFILL')

    assert.throws(() => compileMigrationPlan({ operations }), /conversion_failing_rows/)
    const decisions = {
      [byType['ALTER_COLUMN_TYPE:kilometraje'].id]: { onConversionFailure: 'null' },
      [byType['SET_NOT_NULL:matricula'].id]: { backfill: 'SIN-PLACA' },
      [byType['ADD_COLUMN:color'].id]: { backfill: 'blanco' },
    }
    const backup = await backupSvc.snapshotModuleTables(tx, {
      moduleKey: 'custom.evotest', tables: [TABLE], renames: { [TABLE]: { matricula: 'placa' } },
    })
    assert.equal(backup.tables[0].rows, 3)
    for (const statement of compileMigrationPlan({ operations }, decisions)) await client.query(statement)

    const updated = await rows()
    assert.deepEqual(updated.map((r) => [r.matricula, r.kilometraje, r.color]).sort(byJson), [['ABC-1', 1200, 'blanco'], ['SIN-PLACA', null, 'blanco'], ['XYZ-9', null, 'blanco']].sort(byJson))

    const attempt = async () => {
      await client.query('SAVEPOINT restore_attempt')
      try {
        return await backupSvc.restoreInTx(tx, { ...backup, moduleKey: 'custom.evotest' })
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT restore_attempt')
        throw error
      }
    }
    // A required column added after the backup has no source: refused before any delete.
    await assert.rejects(attempt(), /BACKUP_RESTORE_INCOMPATIBLE/)
    assert.equal((await rows()).length, 3)

    // Old values that no longer fit the current type abort the whole restore.
    await client.query(`ALTER TABLE ${TABLE} ALTER COLUMN color SET DEFAULT 'gris', ALTER COLUMN matricula DROP NOT NULL`)
    await assert.rejects(attempt(), /invalid input syntax/)
    assert.equal((await rows()).length, 3)

    // With a compatible structure the old rows come back, "placa" mapped to "matricula".
    await client.query(`ALTER TABLE ${TABLE} ALTER COLUMN kilometraje TYPE VARCHAR(255) USING kilometraje::text`)
    const restored = await attempt()
    assert.deepEqual(restored.restored, [{ table: TABLE, rows: 3 }])
    assert.deepEqual((await rows()).map((r) => [r.matricula, r.kilometraje, r.color]).sort(byJson),
      [['ABC-1', '1200', 'gris'], [null, 'mucho', 'gris'], ['XYZ-9', null, 'gris']].sort(byJson))
  })
})
