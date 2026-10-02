import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { borderPoint, connectTargetAt, resolveConnectors } from './connectors.js'

const rect = (id, x, y, w = 100, h = 50, extra = {}) => ({ id, type: 'rectangle', transform: { x, y, rotation: 0 }, geometry: { width: w, height: h }, ...extra })
const arrow = (connect, x = 0, y = 0, x2 = 10, y2 = 0) => ({ id: 'arr', type: 'arrow', transform: { x, y }, geometry: { x2, y2 }, properties: { connect } })

describe('Canvas connectors', () => {
  it('ends on the border of connected rectangles', () => {
    const objects = [rect('a', 0, 0), rect('b', 300, 0), arrow({ start: 'a', end: 'b' })]
    const resolved = resolveConnectors(objects).find((o) => o.id === 'arr')
    assert.deepEqual({ x: resolved.transform.x, y: resolved.transform.y }, { x: 100, y: 25 })
    assert.deepEqual({ x: resolved.transform.x + resolved.geometry.x2, y: resolved.transform.y + resolved.geometry.y2 }, { x: 300, y: 25 })
  })
  it('touches the ellipse outline', () => {
    const ellipse = { id: 'e', type: 'ellipse', transform: { x: 0, y: 0, rotation: 0 }, geometry: { width: 100, height: 50 } }
    const p = borderPoint(ellipse, { x: 200, y: 100 })
    const nx = (p.x - 50) / 50, ny = (p.y - 25) / 25
    assert.ok(Math.abs(nx * nx + ny * ny - 1) < 0.01)
  })
  it('keeps stored geometry when the target is missing and returns the same array without connectors', () => {
    const objects = [arrow({ start: null, end: 'gone' }, 5, 5, 20, 0)]
    assert.deepEqual(resolveConnectors(objects)[0].geometry, { x2: 20, y2: 0 })
    const plain = [rect('a', 0, 0)]
    assert.equal(resolveConnectors(plain), plain)
  })
  it('finds the topmost connectable shape under a point', () => {
    const objects = [rect('a', 0, 0), rect('b', 50, 0), { id: 'l', type: 'line', transform: { x: 0, y: 0 }, geometry: { x2: 10, y2: 10 } }]
    assert.equal(connectTargetAt({ x: 60, y: 10 }, objects, 'none')?.id, 'b')
    assert.equal(connectTargetAt({ x: 60, y: 10 }, objects, 'b')?.id, 'a')
    assert.equal(connectTargetAt({ x: 500, y: 500 }, objects, null), null)
  })
})
