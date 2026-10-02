import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createCanvasRouter } from '../canvas-routes.js'

describe('Runly Canvas routes', () => {
  it('registers granular permissions and forwards an object batch', async () => {
    const permissions = []
    let received
    const requirePermission = (key) => {
      permissions.push(key)
      return async (c, next) => {
        c.set('companyId', 'company-1')
        c.set('authUserId', 'auth-1')
        c.set('userContext', { profile: { id: 'user-1' } })
        return next()
      }
    }
    const service = {
      batchObjects: async (companyId, actorId, boardId, operations) => {
        received = { companyId, actorId, boardId, operations }
        return [{ op: 'delete', id: 'object-1' }]
      },
    }
    const app = createCanvasRouter({ requirePermission, service })
    const response = await app.request('http://localhost/canvas/boards/board-1/objects/batch', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [{ op: 'delete', id: 'object-1' }] }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(received, { companyId: 'company-1', actorId: 'user-1', boardId: 'board-1', operations: [{ op: 'delete', id: 'object-1' }] })
    for (const key of ['canvas.view', 'canvas.create', 'canvas.edit', 'canvas.delete', 'canvas.share', 'canvas.comment', 'canvas.version.view', 'canvas.version.create', 'canvas.version.restore']) {
      assert.ok(permissions.includes(key), `missing ${key}`)
    }
  })

  it('broadcasts changed rows as a delta and skips conflicts', async () => {
    const sent = []
    const broadcaster = { broadcastToChannel: async (topic, event, payload) => { sent.push({ topic, event, payload }) } }
    const requirePermission = () => async (c, next) => { c.set('companyId', 'company-1'); c.set('userContext', { profile: { id: 'user-1' } }); return next() }
    const service = { batchObjects: async () => [
      { op: 'update', object: { id: 'a', revision: 3 } },
      { op: 'delete', id: 'b' },
      { op: 'conflict', id: 'c', object: { id: 'c', revision: 9 } },
    ] }
    const app = createCanvasRouter({ requirePermission, service, broadcaster })
    await app.request('http://localhost/canvas/boards/board-1/objects/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operations: [] }) })
    assert.equal(sent[0].payload.action, 'objects.changed')
    assert.deepEqual(sent[0].payload.upserts, [{ id: 'a', revision: 3 }])
    assert.deepEqual(sent[0].payload.deletedIds, ['b'])
  })

  it('falls back to refetch for oversized deltas', async () => {
    const { objectsDelta } = await import('../canvas-routes.js')
    const big = { id: 'x', revision: 2, properties: { text: 'a'.repeat(210_000) } }
    assert.deepEqual(objectsDelta([{ op: 'update', object: big }]), { refetch: true })
  })

  it('serves the template catalog behind canvas.view', async () => {
    const permissions = []
    const requirePermission = (key) => { permissions.push(key); return async (_c, next) => next() }
    const app = createCanvasRouter({ requirePermission, service: {} })
    const response = await app.request('http://localhost/canvas/templates')
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.data.length, 7)
    assert.equal(body.data[1].key, 'plan')
    assert.ok(permissions.includes('canvas.view'))
  })

  it('resolves bindings for a board the user can view', async () => {
    let asserted, resolved
    const requirePermission = () => async (c, next) => { c.set('companyId', 'company-1'); c.set('authUserId', 'auth-1'); c.set('userContext', { profile: { id: 'user-1' } }); return next() }
    const service = { assertBoardAccess: async (...args) => { asserted = args; return {} } }
    const dataSources = { resolve: async (input) => { resolved = input; return { 'inventory_item:i': { title: 'X', tone: 'ok' } } } }
    const app = createCanvasRouter({ requirePermission, service, dataSources })
    const response = await app.request('http://localhost/canvas/boards/board-1/bindings/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refs: [{ source: 'inventory_item', id: 'i' }] }) })
    assert.equal(response.status, 200)
    assert.deepEqual(asserted.slice(0, 3), ['company-1', 'user-1', 'board-1'])
    assert.equal(resolved.authUserId, 'auth-1')
    assert.equal((await response.json()).data['inventory_item:i'].title, 'X')
  })

  it('forwards companyId, actorId and q to the search service', async () => {
    let received
    const requirePermission = () => async (c, next) => { c.set('companyId', 'company-1'); c.set('authUserId', 'auth-1'); c.set('userContext', { profile: { id: 'user-1' } }); return next() }
    const search = { search: async (companyId, actorId, q) => { received = { companyId, actorId, q }; return [{ boardId: 'b1', score: 10, matches: [] }] } }
    const app = createCanvasRouter({ requirePermission, service: {}, search })
    const response = await app.request('http://localhost/canvas/search?q=extintor')
    assert.equal(response.status, 200)
    assert.deepEqual(received, { companyId: 'company-1', actorId: 'user-1', q: 'extintor' })
    assert.deepEqual((await response.json()).data, [{ boardId: 'b1', score: 10, matches: [] }])
  })

  it('MirAI board types mirror the catalog', async () => {
    const { BOARD_TYPES } = await import('../canvas-mirai-queries.js')
    const { CANVAS_TEMPLATES } = await import('../canvas-templates.js')
    assert.deepEqual(BOARD_TYPES.map((type) => type.templateType), CANVAS_TEMPLATES.map((template) => template.key))
    assert.equal(BOARD_TYPES[1].uso, CANVAS_TEMPLATES[1].useWhen)
  })
})

