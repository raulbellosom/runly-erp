import test from 'node:test'
import assert from 'node:assert/strict'
import { createModulesRouter } from '../modules.js'

const COMPANY = '00000000-0000-4000-8000-000000000001'
const schema = {
  title: 'Flota', path: '/app/m/custom.fleet/dashboard',
  widgets: [{ key: 'totalVehicles', type: 'stat', title: 'Vehículos', source: { entity: 'vehicle', aggregate: 'count' } }],
}

function fixture({ permitted = true } = {}) {
  const permissions = []
  const queries = []
  const prisma = {
    runlyView: { findFirst: async () => ({ key: 'fleet.dashboard', schema }) },
    runlyModel: { findFirst: async () => ({ moduleKey: 'custom.fleet', name: 'fleet.vehicle', tableName: 'fleet_vehicle', companyScoped: true, schema: { softDelete: true }, fields: [] }) },
    $queryRawUnsafe: async (sql, ...values) => { queries.push({ sql, values }); return [{ value: 4 }] },
  }
  const app = createModulesRouter({
    prisma,
    authMiddleware: async (_c, next) => next(),
    requirePermission: (key) => async (c, next) => {
      permissions.push(key)
      if (!permitted) return c.json({ error: 'Forbidden' }, 403)
      c.set('companyId', COMPANY)
      return next()
    },
  })
  return { app, permissions, queries }
}

test('dashboard batch endpoint derives ACL and tenant scope server-side', async () => {
  const f = fixture()
  const response = await f.app.request('/custom.fleet/dashboard/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewKey: 'fleet.dashboard', widgets: ['totalVehicles'], source: { sql: 'SELECT *' } }) })
  assert.equal(response.status, 200)
  assert.deepEqual(f.permissions, ['fleet.vehicle.read'])
  assert.match(f.queries[0].sql, /"company_id" = \$1::uuid/)
  assert.deepEqual((await response.json()).data.totalVehicles.data, { kind: 'value', value: 4 })
})

test('dashboard endpoint does not expose aggregates without entity permission', async () => {
  const f = fixture({ permitted: false })
  const response = await f.app.request('/custom.fleet/dashboard/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewKey: 'fleet.dashboard' }) })
  assert.equal(response.status, 403)
  assert.equal(f.queries.length, 0)
})
