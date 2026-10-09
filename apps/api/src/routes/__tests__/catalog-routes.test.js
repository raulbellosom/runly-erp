// Marketplace authority: seeing the catalog is not installing it. Install,
// update, preflight and catalog source changes require instance authority on
// the server, whatever buttons the client renders.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCatalogRouter } from '../catalog-routes.js'

const ROLES = {
  viewer: { permissions: ['core.modules.read'], isAdmin: false, isSystemAdmin: false },
  custom: { permissions: ['core.modules.read', 'core.modules.manage'], isAdmin: false, isSystemAdmin: false },
  companyAdmin: { permissions: [], isAdmin: true, isSystemAdmin: false },
  systemAdmin: { permissions: [], isAdmin: false, isSystemAdmin: true },
}
// Mirrors index.js requirePermission: admins pass every permission check.
const requirePermission = (key) => async (c, next) => {
  const role = ROLES[c.req.header('x-role')]
  if (!role) return c.json({ error: 'unauthorized' }, 401)
  c.set('tenantContext', { isAdmin: role.isAdmin, isSystemAdmin: role.isSystemAdmin })
  c.set('userContext', { profile: { id: 'user-1' } })
  if (role.isAdmin || role.isSystemAdmin || role.permissions.includes(key)) return next()
  return c.json({ error: 'forbidden' }, 403)
}

function app() {
  const calls = []
  const record = (name) => async (args) => { calls.push([name, args]); return { ok: true } }
  const catalogV2Service = { list: record('list'), install: record('install'), update: record('update'), preflight: record('preflight'), source: record('source'), configureSource: record('configureSource') }
  return { router: createCatalogRouter({ prisma: {}, requirePermission, catalogV2Service }), calls }
}
const send = (router, role, method, path, body) => router.request(path, { method, headers: { 'x-role': role, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })

test('reading the Marketplace never grants install, update, preflight or source changes', async () => {
  const { router, calls } = app()
  assert.equal((await send(router, 'viewer', 'GET', '/module-catalog/v2')).status, 200)
  const mutations = [['POST', '/module-catalog/v2/custom.notes/install', { version: '0.1.0' }], ['POST', '/module-catalog/v2/custom.notes/update', { version: '0.2.0' }], ['POST', '/module-catalog/v2/custom.notes/preflight', { version: '0.1.0' }], ['PUT', '/module-catalog/v2/source', { communityUrl: 'https://evil.example/feed' }], ['GET', '/module-catalog/v2/source']]
  for (const [method, path, body] of mutations) {
    assert.equal((await send(router, 'viewer', method, path, body)).status, 403, `viewer ${method} ${path}`)
    const custom = await send(router, 'custom', method, path, body)
    assert.equal(custom.status, 403, `custom role ${method} ${path}`)
    if (method !== 'GET' || path.endsWith('source')) assert.equal((await custom.json()).error, 'instance_authority_required')
  }
  assert.deepEqual(calls.map(([name]) => name), ['list'], 'no mutation reached the service')
})

test('instance administrators can operate; source updates accept only known fields', async () => {
  const { router, calls } = app()
  for (const role of ['companyAdmin', 'systemAdmin']) {
    assert.equal((await send(router, role, 'POST', '/module-catalog/v2/custom.notes/install', { version: '0.1.0', acceptCommunity: true, confirmation: 'x' })).status, 200, role)
    assert.equal((await send(router, role, 'POST', '/module-catalog/v2/custom.notes/preflight', { version: '0.1.0' })).status, 200, role)
  }
  assert.equal((await send(router, 'systemAdmin', 'PUT', '/module-catalog/v2/source', { officialUrl: 'https://hub.example/official', officialKeys: ['MCow...'], community: ['x'] })).status, 200)
  const [, input] = calls.find(([name]) => name === 'configureSource')
  assert.deepEqual(input, { officialUrl: 'https://hub.example/official' }, 'official/community pins can never be set through the API')
  assert.equal((await send(router, 'systemAdmin', 'PUT', '/module-catalog/v2/source', [])).status, 422)
  assert.equal(calls.find(([name]) => name === 'install')[1].actorId, 'user-1')
})
