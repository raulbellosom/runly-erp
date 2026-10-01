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
})

