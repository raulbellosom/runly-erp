import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyObjectDelta, invalidationTargets } from './realtimeCache.js'

describe('Canvas realtime cache', () => {
  const rows = [{ id: 'a', pageId: 'p1', revision: 2, hotspot: { id: 'h' } }, { id: 'b', pageId: 'p1', revision: 1 }]
  it('applies newer rows, keeps hotspots, ignores stale echoes and other pages', () => {
    const next = applyObjectDelta(rows, 'p1', { upserts: [{ id: 'a', pageId: 'p1', revision: 3 }, { id: 'b', pageId: 'p1', revision: 1 }, { id: 'z', pageId: 'p2', revision: 1 }], deletedIds: [] })
    assert.equal(next.find((r) => r.id === 'a').revision, 3)
    assert.deepEqual(next.find((r) => r.id === 'a').hotspot, { id: 'h' })
    assert.equal(next.find((r) => r.id === 'b'), rows[1])
    assert.equal(next.some((r) => r.id === 'z'), false)
  })
  it('inserts new rows and removes deleted ones', () => {
    const next = applyObjectDelta(rows, 'p1', { upserts: [{ id: 'c', pageId: 'p1', revision: 1 }], deletedIds: ['b'] })
    assert.deepEqual(next.map((r) => r.id), ['a', 'c'])
  })
  it('returns the same array when nothing changes', () => {
    assert.equal(applyObjectDelta(rows, 'p1', { upserts: [], deletedIds: ['nope'] }), rows)
  })
  it('maps actions to the queries they invalidate', () => {
    assert.deepEqual(invalidationTargets('hotspot.updated'), ['objects'])
    assert.deepEqual(invalidationTargets('layer.updated'), ['board'])
    assert.deepEqual(invalidationTargets('version.restored'), ['board', 'objects', 'links', 'versions'])
    assert.deepEqual(invalidationTargets('entity-link.created'), ['links'])
    assert.deepEqual(invalidationTargets('something.new'), ['board', 'objects'])
  })
})
