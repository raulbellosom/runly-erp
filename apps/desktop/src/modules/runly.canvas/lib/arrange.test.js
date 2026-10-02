import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { alignDeltas, distributeDeltas } from './arrange.js'

const box = (id, x, y, w = 10, h = 10) => ({ id, type: 'rectangle', transform: { x, y }, geometry: { width: w, height: h } })

describe('Canvas align and distribute', () => {
  it('aligns left edges to the leftmost object', () => {
    const deltas = alignDeltas([box('a', 0, 0), box('b', 30, 5), box('c', 12, 9)], 'left')
    assert.deepEqual(deltas.get('b'), { dx: -30, dy: 0 })
    assert.deepEqual(deltas.get('a'), { dx: 0, dy: 0 })
  })
  it('centres vertically on the selection box', () => {
    const deltas = alignDeltas([box('a', 0, 0, 10, 10), box('b', 0, 30, 10, 10)], 'vcenter')
    assert.deepEqual(deltas.get('a'), { dx: 0, dy: 15 })
    assert.deepEqual(deltas.get('b'), { dx: 0, dy: -15 })
  })
  it('distributes equal horizontal gaps keeping the outer objects', () => {
    const deltas = distributeDeltas([box('a', 0, 0), box('c', 100, 0), box('b', 20, 0)], 'h')
    assert.deepEqual(deltas.get('a'), { dx: 0, dy: 0 })
    assert.deepEqual(deltas.get('c'), { dx: 0, dy: 0 })
    assert.deepEqual(deltas.get('b'), { dx: 30, dy: 0 })
  })
  it('does nothing with fewer than three objects', () => {
    assert.equal(distributeDeltas([box('a', 0, 0), box('b', 50, 0)], 'h').size, 0)
  })
})
