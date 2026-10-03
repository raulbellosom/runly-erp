import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { groupScale, hitGroupHandle, scaleObject } from './groupResize.js'

describe('group resize', () => {
  const bounds = { x: 0, y: 0, width: 100, height: 50 }

  it('hits the padded corners only', () => {
    assert.equal(hitGroupHandle({ x: 106, y: 56 }, bounds, 1), 'se')
    assert.equal(hitGroupHandle({ x: 50, y: 25 }, bounds, 1), null)
  })

  it('scales uniformly around the opposite corner', () => {
    const { scale, origin } = groupScale(bounds, 'se', { x: 206, y: 56 })
    assert.equal(scale, 2)
    assert.deepEqual(origin, { x: 0, y: 0 })
  })

  it('scales boxes, lines and text', () => {
    const rect = scaleObject({ type: 'rectangle', transform: { x: 10, y: 10, rotation: 0 }, geometry: { width: 20, height: 10 }, style: {} }, { x: 0, y: 0 }, 2)
    assert.deepEqual([rect.transform.x, rect.transform.y, rect.geometry.width, rect.geometry.height], [20, 20, 40, 20])
    const line = scaleObject({ type: 'line', transform: { x: 10, y: 0 }, geometry: { x2: -5, y2: 5 } }, { x: 0, y: 0 }, 2)
    assert.deepEqual([line.transform.x, line.geometry.x2, line.geometry.y2], [20, -10, 10])
    const text = scaleObject({ type: 'text', transform: { x: 0, y: 0 }, geometry: { width: 40, height: 20 }, style: { fontSize: 18 } }, { x: 0, y: 0 }, 0.5)
    assert.equal(text.style.fontSize, 9)
  })
})
