import test from 'node:test'
import assert from 'node:assert/strict'
import { createModulesRouter } from '../modules.js'

const COMPANY = '00000000-0000-4000-8000-000000000001'
const schema = { title: 'Flujo', path: '/app/m/custom.fleet/kanban', entity: 'vehicle', groupBy: 'status', apiPath: '/fleet/vehicles', card: { titleField: 'plate' } }

function fixture({ permitted = true, canUpdate = false } = {}) {
  const permissions = []
  const queries = []
  const prisma = {
    runlyView: { findFirst: async () => ({ key: 'fleet.kanban', schema }) },
    runlyModel: { findFirst: async () => ({ moduleKey: 'custom.fleet', name: 'fleet.vehicle', tableName: 'fleet_vehicle', companyScoped: true, schema: { softDelete: true }, fields: [{ name: 'plate', type: 'text', required: true }, { name: 'status', type: 'select', required: false, options: ['NEW', 'DONE'] }] }) },
    $queryRawUnsafe: async (sql, ...values) => { queries.push({ sql, values }); return [{ id: '1', plate: 'ABC', status: 'NEW' }] },
  }
  const app = createModulesRouter({
    prisma,
    authMiddleware: async (c, next) => { c.set('companyId', COMPANY); c.set('tenantContext', { isAdmin: false, permissionSet: new Set(canUpdate ? ['fleet.vehicle.update'] : []) }); return next() },
    requirePermission: (key) => async (c, next) => { permissions.push(key); return permitted ? next() : c.json({ error: 'Forbidden' }, 403) },
  })
  return { app, permissions, queries }
}

test('Kanban query derives read/update ACL and tenant scope server-side', async () => {
  const f = fixture({ canUpdate: true })
  const response = await f.app.request('/custom.fleet/kanban/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewKey: 'fleet.kanban', schema: { companyId: 'foreign' } }) })
  assert.equal(response.status, 200)
  assert.deepEqual(f.permissions, ['fleet.vehicle.read'])
  assert.match(f.queries[0].sql, /"company_id" = \$1::uuid/)
  const body = await response.json()
  assert.equal(body.data.canUpdate, true)
  assert.equal(body.data.records[0].plate, 'ABC')
})

test('Kanban query is read-only when update permission is absent', async () => {
  const response = await fixture().app.request('/custom.fleet/kanban/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewKey: 'fleet.kanban' }) })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.canUpdate, false)
})

test('Kanban query does not access records without read permission', async () => {
  const f = fixture({ permitted: false })
  const response = await f.app.request('/custom.fleet/kanban/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewKey: 'fleet.kanban' }) })
  assert.equal(response.status, 403)
  assert.equal(f.queries.length, 0)
})
