import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BINDABLE_TYPES, bindingKey, bindingRefs, canBind, chunk, statusTintOf } from './dataBindings.js'

describe('Canvas data bindings', () => {
  const rows = [
    { id: 'a', type: 'rectangle', properties: { binding: { source: 'inventory_item', id: 'i1' } } },
    { id: 'b', type: 'ellipse', properties: { binding: { source: 'inventory_item', id: 'i1' } } },
    { id: 'c', type: 'rectangle', properties: {} },
    { id: 'd', type: 'rectangle', pending: true, properties: { binding: { source: 'vehicle', id: 'v1' } } },
  ]
  it('collects unique refs from persisted bound rows', () => {
    assert.deepEqual(bindingRefs(rows), [{ source: 'inventory_item', id: 'i1' }])
    assert.equal(bindingKey(rows[0].properties.binding), 'inventory_item:i1')
    assert.equal(bindingKey(null), null)
  })
  it('only lets shapes and text be bound', () => {
    assert.ok(canBind({ type: 'rectangle' }))
    assert.equal(canBind({ type: 'line' }), false)
    assert.equal(canBind({ type: 'image' }), false)
    assert.ok(BINDABLE_TYPES.has('polygon'))
  })
  it('splits refs into batches', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  })

  it('colours by status only for a real status the user did not opt out of', () => {
    assert.equal(statusTintOf({ source: 'pos_table', id: '1' }, { tone: 'warning' }), 'warning')
    assert.equal(statusTintOf({ source: 'task', id: '1' }, { tone: 'neutral' }), null)
    assert.equal(statusTintOf({ source: 'pos_table', id: '1', tint: false }, { tone: 'warning' }), null)
    assert.equal(statusTintOf({ source: 'pos_table', id: '1' }, undefined), null)
  })
})
