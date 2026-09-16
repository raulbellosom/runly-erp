import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getLoadedNaturalSize } from '../imageLoadState.js'

test('getLoadedNaturalSize: returns the size when the image is already complete with real dimensions', () => {
  assert.deepEqual(
    getLoadedNaturalSize({ complete: true, naturalWidth: 800, naturalHeight: 600 }),
    { w: 800, h: 600 },
  )
})

test('getLoadedNaturalSize: returns null when not yet complete', () => {
  assert.equal(getLoadedNaturalSize({ complete: false, naturalWidth: 800, naturalHeight: 600 }), null)
})

test('getLoadedNaturalSize: returns null when complete but naturalWidth is 0 (broken image)', () => {
  assert.equal(getLoadedNaturalSize({ complete: true, naturalWidth: 0, naturalHeight: 0 }), null)
})
