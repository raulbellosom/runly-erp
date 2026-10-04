import test from 'node:test'
import assert from 'node:assert/strict'
import { createRme3TrashProvider, labelColumnOf, restorePermissionOf } from '../rme3-trash-provider.js'
import { isForeignKeyViolation } from '../trash-errors.js'

const MODEL = {
  key: 'mantenimiento', label: 'Mantenimiento', pluralLabel: 'Mantenimientos', tableName: 'e2emant_mantenimiento',
  softDelete: true, companyScoped: true,
  fields: [{ name: 'equipo', type: 'relation' }, { name: 'costo', type: 'number' }, { name: 'detalle', type: 'text' }],
}
const MANIFEST = { permissions: [{ key: 'e2emant.mantenimiento.read' }, { key: 'e2emant.mantenimiento.delete' }] }
const ID = '01a104f2-2b00-7d18-9db8-f8533dee3351'

test('label column, restore permission and eligibility', () => {
  assert.equal(labelColumnOf(MODEL), 'detalle')
  assert.equal(restorePermissionOf('custom.e2emant', MANIFEST, MODEL), 'e2emant.mantenimiento.delete')
  assert.equal(createRme3TrashProvider({ moduleKey: 'custom.e2emant', manifest: MANIFEST, model: { ...MODEL, softDelete: false } }), null)
  assert.equal(createRme3TrashProvider({ moduleKey: 'custom.e2emant', manifest: { permissions: [] }, model: MODEL }), null)
})

test('generic provider scopes every query to the company and disabled rows; FK errors become in_use', async () => {
  const calls = []
  let fail = false
  const prisma = {
    $queryRawUnsafe: async (sql, ...params) => {
      calls.push({ sql, params })
      if (fail) throw Object.assign(new Error('violates foreign key constraint "x"'), { code: 'P2010' })
      if (sql.startsWith('SELECT COUNT')) return [{ count: 1 }]
      return [{ id: ID, label: 'Ajuste' }]
    },
  }
  const provider = createRme3TrashProvider({ moduleKey: 'custom.e2emant', moduleName: 'E2E', manifest: MANIFEST, model: MODEL })
  const ctx = { prisma, companyId: 'c1' }
  const listed = await provider.list(ctx, { search: 'aju' })
  assert.equal(listed.total, 1)
  assert.match(calls[0].sql, /company_id = \$1::uuid AND enabled = false AND "detalle"::text ILIKE \$2/)
  assert.deepEqual(calls[0].params, ['c1', '%aju%'])
  await provider.restore(ctx, ID)
  assert.match(calls.at(-1).sql, /^UPDATE "e2emant_mantenimiento" SET enabled = true/)
  await provider.purge(ctx, ID)
  assert.match(calls.at(-1).sql, /^DELETE FROM "e2emant_mantenimiento" WHERE id = \$1::uuid AND company_id = \$2::uuid AND enabled = false/)
  fail = true
  await assert.rejects(provider.purge(ctx, ID), (error) => error.code === 'in_use' && error.status === 409)
  await assert.rejects(provider.restore(ctx, 'not-a-uuid'), /no válido/)
})

test('foreign key detection', () => {
  assert.equal(isForeignKeyViolation({ code: 'P2003' }), true)
  assert.equal(isForeignKeyViolation({ message: 'Code: `23503`' }), true)
  assert.equal(isForeignKeyViolation({ code: 'P2025' }), false)
})
