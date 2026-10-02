import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { snapMoveDelta, snapPoint, snapSizeFor, snapValue } from './snap.js'

describe('Canvas grid snapping', () => {
  it('rounds to the nearest grid line and is a no-op without size', () => {
    assert.deepEqual(snapPoint({ x: 13, y: 27 }, 20), { x: 20, y: 20 })
    assert.equal(snapValue(9, 20), 0)
    assert.deepEqual(snapPoint({ x: 13, y: 27 }, 0), { x: 13, y: 27 })
  })

  it('moves a group so its top-left corner lands on the grid', () => {
    assert.deepEqual(snapMoveDelta({ x: 5, y: 5 }, 12, 33, 20), { dx: 15, dy: 35 })
    assert.deepEqual(snapMoveDelta({ x: 5, y: 5 }, 12, 33, 0), { dx: 12, dy: 33 })
  })

  it('snaps only with the grid visible and snapping on', () => {
    assert.equal(snapSizeFor({ grid: { enabled: true, size: 20 }, snapping: true }), 20)
    assert.equal(snapSizeFor({ grid: { enabled: false, size: 20 }, snapping: true }), 0)
    assert.equal(snapSizeFor({ grid: { enabled: true, size: 20 }, snapping: false }), 0)
    assert.equal(snapSizeFor(undefined), 0)
  })
})
