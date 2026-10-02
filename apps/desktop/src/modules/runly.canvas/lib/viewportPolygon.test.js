import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { closesPolygonDraft, cursorForHandle } from './viewportPolygon.js'

describe('viewport polygon helpers', () => {
  it('maps vertex and midpoint handles to a pointer cursor, others to the static map', () => {
    assert.equal(cursorForHandle('v:0', { rotate: 'grab' }), 'pointer')
    assert.equal(cursorForHandle('m:2', { rotate: 'grab' }), 'pointer')
    assert.equal(cursorForHandle('rotate', { rotate: 'grab' }), 'grab')
    assert.equal(cursorForHandle('nw', {}), 'default')
  })

  it('closes the draft only with at least three points landing near the first one', () => {
    const viewport = { x: 0, y: 0, zoom: 1 }
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }]
    assert.equal(closesPolygonDraft(points.slice(0, 2), { x: 0, y: 0 }, viewport), false)
    assert.equal(closesPolygonDraft(points, { x: 3, y: 2 }, viewport), true)
    assert.equal(closesPolygonDraft(points, { x: 50, y: 50 }, viewport), false)
  })
})
