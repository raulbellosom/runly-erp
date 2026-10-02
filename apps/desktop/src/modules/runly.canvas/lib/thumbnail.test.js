import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { THUMB_HEIGHT, THUMB_WIDTH, thumbnailViewport } from './thumbnail.js'

describe('Board thumbnail layout', () => {
  it('fits the scene inside the thumbnail with padding', () => {
    const viewport = thumbnailViewport({ x: 0, y: 0, width: 1000, height: 500 })
    assert.equal(THUMB_WIDTH, 640); assert.equal(THUMB_HEIGHT, 360)
    assert.ok(viewport.zoom > 0 && viewport.zoom <= 1)
    const right = viewport.x + 1000 * viewport.zoom, bottom = viewport.y + 500 * viewport.zoom
    assert.ok(viewport.x >= 0 && right <= THUMB_WIDTH && viewport.y >= 0 && bottom <= THUMB_HEIGHT)
  })
  it('returns null for an empty scene', () => { assert.equal(thumbnailViewport(null), null) })
})
