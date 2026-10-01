import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyOperations, mergeBatchResults } from './optimistic.js'

describe('Canvas optimistic batch', () => {
  const rows = [{ id: 'a', revision: 3, transform: { x: 0, y: 0 }, hotspot: { id: 'h' } }, { id: 'b', revision: 1 }]

  it('applies updates with the revision the server will assign, plus creates and deletes', () => {
    const next = applyOperations(rows, [
      { op: 'update', id: 'a', data: { transform: { x: 10, y: 5 } } },
      { op: 'delete', id: 'b' },
      { op: 'create', clientId: 'tmp', data: { type: 'rectangle' } },
    ])
    assert.deepEqual(next.map((row) => row.id), ['a', 'tmp'])
    assert.equal(next[0].revision, 4)
    assert.deepEqual(next[0].transform, { x: 10, y: 5 })
  })

  it('swaps temporary rows for server rows and keeps hotspot metadata', () => {
    const optimistic = applyOperations(rows, [{ op: 'create', clientId: 'tmp', data: { type: 'rectangle' } }])
    const merged = mergeBatchResults(optimistic, [
      { op: 'create', clientId: 'tmp', object: { id: 'server-1', revision: 1 } },
      { op: 'update', object: { id: 'a', revision: 4 } },
    ])
    assert.deepEqual(merged.map((row) => row.id), ['a', 'b', 'server-1'])
    assert.deepEqual(merged[0].hotspot, { id: 'h' })
  })
})
