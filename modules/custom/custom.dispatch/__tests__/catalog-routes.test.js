import test from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { createCatalogRouter } from '../api/catalog-routes.js'

const companyId = '018f4b34-89f1-7a21-9c9a-36a1fd6ec001'
const actorId = '018f4b34-89f1-7a21-9c9a-36a1fd6ec002'
const siteId = '018f4b34-89f1-7a21-9c9a-36a1fd6ec003'

function createApp(prisma, permissionCalls = []) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('userContext', {
      profile: { id: actorId },
      memberships: [{ companyId }],
    })
    await next()
  })
  const requirePermission = (key) => async (_c, next) => {
    permissionCalls.push(key)
    await next()
  }
  app.route('', createCatalogRouter({ prisma, requirePermission }))
  return app
}

function createPrisma({ queryRaw, users = [] } = {}) {
  return {
    $queryRaw: queryRaw ?? (async () => []),
    membership: {
      findMany: async () => users.map((user) => ({ user })),
      findFirst: async () => ({ id: 'membership-1' }),
    },
    auditLog: { create: async () => ({ id: 'audit-1' }) },
  }
}

test('GET setup devuelve todos los catálogos bajo el permiso de configuración', async () => {
  const permissionCalls = []
  const app = createApp(createPrisma(), permissionCalls)
  const response = await app.request('/dispatch/catalog/setup')
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(Object.keys(body.data).sort(), ['assignments', 'materials', 'series', 'sites', 'stations', 'users'])
  assert.deepEqual(permissionCalls, ['dispatch.catalog.manage'])
})

test('POST sites normaliza el código y registra auditoría', async () => {
  const audits = []
  let insertedCode = null
  const prisma = createPrisma({
    queryRaw: async (strings, ...values) => {
      const sql = strings.join(' ')
      if (sql.includes('INSERT INTO dispatch_site')) {
        insertedCode = values[1]
        return [{ id: siteId, company_id: companyId, code: insertedCode, name: values[2], enabled: true }]
      }
      return []
    },
  })
  prisma.auditLog.create = async ({ data }) => {
    audits.push(data)
    return { id: 'audit-1' }
  }
  const app = createApp(prisma)
  const response = await app.request('/dispatch/catalog/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'mina norte', name: 'Mina Norte', timezone: 'America/Mexico_City' }),
  })

  assert.equal(response.status, 201)
  assert.equal(insertedCode, 'MINA-NORTE')
  assert.equal(audits.length, 1)
  assert.equal(audits[0].moduleKey, 'custom.dispatch')
  assert.equal(audits[0].action, 'site.create')
})

test('POST materials rechaza un material sin modo de medición antes de consultar la base', async () => {
  let queryCount = 0
  const app = createApp(createPrisma({ queryRaw: async () => { queryCount += 1; return [] } }))
  const response = await app.request('/dispatch/catalog/materials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site_id: siteId, code: 'GRAVA', name: 'Grava', allowed_modes: [] }),
  })

  assert.equal(response.status, 422)
  assert.equal(queryCount, 0)
})

test('PATCH rechaza identificadores que no sean UUID', async () => {
  const app = createApp(createPrisma())
  const response = await app.request('/dispatch/catalog/sites/no-es-uuid', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Cambio' }),
  })

  assert.equal(response.status, 422)
  assert.deepEqual(await response.json(), { error: 'Identificador inválido.' })
})
