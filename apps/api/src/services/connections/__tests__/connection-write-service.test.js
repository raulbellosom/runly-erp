// Unit tests for connection writes (validation/permissions) with a fake
// prisma, plus an integration test of applyConnectionWrites against the real
// database inside a rolled-back transaction (skipped without DATABASE_URL).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'
import { buildConnectionSql } from '@runly/module-engine'
import { createConnectionWriteService } from '../connection-write-service.js'

const COMPANY = '01900000-0000-7000-8000-000000000001'
const MODEL = { key: 'calibracion', tableName: 'conntest_w_calib', fields: [
  { name: 'articulo', type: 'relation', required: true },
  { name: 'certificado', type: 'text', required: true },
  { name: 'fecha', type: 'date' },
  { name: 'costo', type: 'decimal' },
  { name: 'notas', type: 'textarea' },
] }
const CONNECTION_ROW = {
  id: 'conn-1', companyId: COMPANY, moduleKey: 'custom.conntest', connectionKey: 'calib', kind: 'fields', targetType: 'inventory_item',
  sourceEntity: 'calibracion', sourceTable: 'conntest_w_calib', status: 'active', sortOrder: 0, createdAt: new Date(),
  fieldConfig: [
    { field: 'certificado', form: true, detail: true, order: 0 },
    { field: 'fecha', form: true, detail: true, order: 1 },
    { field: 'costo', form: true, order: 2 },
    { field: 'notas', form: false, detail: true, order: 3 },
  ],
}
const MANIFEST = { icon: 'Gauge', connections: [{ key: 'calib', kind: 'fields', label: 'Calibración', targetField: 'articulo' }] }
const SCHEMAS = {
  create: z.object({ articulo: z.string().uuid(), certificado: z.string().min(3, 'Mínimo 3 caracteres'), fecha: z.string().optional(), costo: z.coerce.number().optional(), notas: z.string().optional() }),
  update: z.object({ articulo: z.string().uuid().optional(), certificado: z.string().min(3, 'Mínimo 3 caracteres').optional(), fecha: z.string().optional(), costo: z.coerce.number().optional(), notas: z.string().optional() }),
}

function fakePrisma({ existing = null } = {}) {
  return {
    moduleConnection: { findMany: async () => [CONNECTION_ROW] },
    runlyModule: { findMany: async () => [{ id: 'm1', key: 'custom.conntest', name: 'Calibraciones', manifest: MANIFEST }] },
    companyModule: { findMany: async () => [] },
    runlyModel: { findMany: async () => [{ moduleKey: 'custom.conntest', schema: MODEL }] },
    connectionRecord: { findFirst: async () => existing },
  }
}
const admin = { isAdmin: true, permissionSet: new Set() }
const reader = { isAdmin: false, permissionSet: new Set(['conntest.calibracion.read']) }
const service = (prisma) => createConnectionWriteService({ prisma, loadValidators: async () => SCHEMAS })

describe('validateConnectionWrites', () => {
  it('keeps only form-enabled fields and parses them with the module schema', async () => {
    const { writes } = await service(fakePrisma({ existing: { sourceRecordId: 'r1' } })).validateConnectionWrites({
      companyId: COMPANY, targetType: 'inventory_item', targetId: 'b0000000-0000-7000-8000-000000000001', user: admin,
      payload: { 'conn-1': { values: { certificado: 'LAB-1', costo: '12.5', notas: 'not offered to the form' }, expectedUpdatedAt: null } },
    })
    assert.equal(writes.length, 1)
    assert.deepEqual(writes[0].values, { certificado: 'LAB-1', costo: 12.5 })
  })

  it('returns per-field errors keyed by connection', async () => {
    await assert.rejects(
      service(fakePrisma({ existing: { sourceRecordId: 'r1' } })).validateConnectionWrites({
        companyId: COMPANY, targetType: 'inventory_item', targetId: 'b0000000-0000-7000-8000-000000000001', user: admin,
        payload: { 'conn-1': { values: { certificado: 'X' } } },
      }),
      (error) => error.code === 'connection_validation' && error.status === 422 && error.fields['conn-1.certificado'] === 'Mínimo 3 caracteres',
    )
  })

  it('requires the source entity update permission', async () => {
    await assert.rejects(
      service(fakePrisma({ existing: { sourceRecordId: 'r1' } })).validateConnectionWrites({
        companyId: COMPANY, targetType: 'inventory_item', targetId: 'b0000000-0000-7000-8000-000000000001', user: reader,
        payload: { 'conn-1': { values: { certificado: 'LAB-2' } } },
      }),
      (error) => error.code === 'connection_forbidden' && error.status === 403,
    )
  })

  it('ignores unknown or inactive connections and empty sections', async () => {
    const result = await service(fakePrisma()).validateConnectionWrites({
      companyId: COMPANY, targetType: 'inventory_item', user: admin,
      payload: { 'gone': { values: { a: 1 } }, 'conn-1': { values: { notas: 'only non-form' } } },
    })
    assert.deepEqual(result, { writes: [], skipped: ['gone'] })
  })
})

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
describe('applyConnectionWrites against PostgreSQL (rolled back)', { skip: !url && 'no DATABASE_URL' }, () => {
  it('creates then updates the 1:1 row, casts types, updates the index, detects conflicts', async () => {
    const pg = (await import('pg')).default
    const { PrismaPg } = await import('@prisma/adapter-pg')
    const { PrismaClient } = await import('@prisma/client')
    const pool = new pg.Pool({ connectionString: url, max: 1 })
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
    const ROLLBACK = new Error('rollback')
    const writer = createConnectionWriteService({ prisma, loadValidators: async () => SCHEMAS })
    const connection = { id: 'conn-1', moduleKey: 'custom.conntest', connectionKey: 'calib', sourceEntity: 'calibracion', sourceTable: 'conntest_w_calib', targetField: 'articulo', targetType: 'inventory_item', label: 'Calibración', model: MODEL }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`CREATE TABLE public.conntest_w_target (id uuid PRIMARY KEY DEFAULT uuidv7())`)
        await tx.$executeRawUnsafe(`CREATE TABLE public.conntest_w_calib (id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL, enabled boolean NOT NULL DEFAULT true,
          updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), articulo uuid NOT NULL, certificado varchar(255) NOT NULL DEFAULT '', fecha date, costo numeric(18,4), notas text)`)
        for (const sql of buildConnectionSql({
          moduleKey: 'custom.conntest', targetType: 'inventory_item', sourceTable: 'conntest_w_calib', targetTable: 'conntest_w_target',
          connection: { key: 'calib', kind: 'fields', targetField: 'articulo' }, offeredColumns: ['certificado', 'fecha', 'costo'], searchColumns: ['certificado'],
        })) await tx.$executeRawUnsafe(sql)
        const [{ id: targetId }] = await tx.$queryRawUnsafe(`INSERT INTO public.conntest_w_target DEFAULT VALUES RETURNING id`)

        const created = await writer.applyConnectionWrites(tx, { companyId: COMPANY, targetId, writes: [{ connection, values: { certificado: 'LAB-9', fecha: '2026-10-03', costo: 12.5 }, expectedUpdatedAt: null }] })
        assert.equal(created[0].action, 'create')
        let [index] = await tx.$queryRawUnsafe(`SELECT data, updated_at FROM public.connection_record WHERE source_record_id = $1::uuid`, created[0].id)
        assert.deepEqual(index.data, { certificado: 'LAB-9', fecha: '2026-10-03', costo: 12.5 })

        const updated = await writer.applyConnectionWrites(tx, { companyId: COMPANY, targetId, writes: [{ connection, values: { certificado: 'LAB-10' }, expectedUpdatedAt: index.updated_at }] })
        assert.equal(updated[0].action, 'update')
        ;[index] = await tx.$queryRawUnsafe(`SELECT data FROM public.connection_record WHERE source_record_id = $1::uuid`, created[0].id)
        assert.equal(index.data.certificado, 'LAB-10')

        await assert.rejects(
          writer.applyConnectionWrites(tx, { companyId: COMPANY, targetId, writes: [{ connection, values: { certificado: 'LAB-11' }, expectedUpdatedAt: '2020-01-01T00:00:00Z' }] }),
          (error) => error.code === 'connection_conflict' && error.status === 409,
        )
        throw ROLLBACK
      }, { timeout: 30_000 })
    } catch (error) {
      if (error !== ROLLBACK) throw error
    } finally {
      await prisma.$disconnect()
      await pool.end()
    }
  })
})
