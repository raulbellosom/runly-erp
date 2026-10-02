import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createRealtimeAccessService } from '../realtime-access-service.js'

describe('realtime relay', () => {
  it('stamps the authenticated actor on canvas payloads', async () => {
    const sent = []
    const prisma = {
      $queryRaw: async () => [{ allowed: true }],
      userProfile: { findFirst: async () => ({ displayName: 'Ana' }) },
    }
    const broadcaster = { broadcastToChannel: async (topic, event, payload) => { sent.push(payload) } }
    const service = createRealtimeAccessService({ prisma, broadcaster })
    const ok = await service.relay({ topic: 'canvas:board:00000000-0000-4000-8000-000000000004', event: 'cursor', payload: { x: 1, actorId: 'spoofed' }, actorId: 'user-1' })
    assert.equal(ok, true)
    assert.equal(sent[0].actorId, 'user-1')
    assert.equal(sent[0].x, 1)
  })
})
