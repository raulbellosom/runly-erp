import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_SHARP_SIDE, neededBucket, sharpCandidates } from './sharpPdf.js'

describe('Sharp PDF buckets', () => {
  const page = { id: 'p', type: 'image', transform: { x: 0, y: 0 }, geometry: { width: 600, height: 800 }, properties: { fileId: 'png', sourceFileId: 'pdf', page: 2, naturalWidth: 1275, naturalHeight: 1700 } }
  it('needs no re-render while the raster is dense enough', () => {
    assert.equal(neededBucket(page, 1), 0)
  })
  it('asks for a power-of-two bucket when zoomed past the raster density', () => {
    assert.equal(neededBucket(page, 4), 2)
    // 1700px raster: 4x would exceed 4096px, so it stays at the 2x bucket.
    assert.equal(neededBucket(page, 8), 2)
    const small = { ...page, properties: { ...page.properties, naturalWidth: 600, naturalHeight: 800 } }
    assert.equal(neededBucket(small, 8), 4)
  })
  it('caps the bucket so the render stays under the max side', () => {
    const bucket = neededBucket(page, 64)
    assert.ok(1700 * bucket <= MAX_SHARP_SIDE * 1.0001)
  })
  it('selects only visible PDF page images', () => {
    const viewportBounds = { x: 0, y: 0, width: 100, height: 100 }
    const offscreen = { ...page, id: 'q', transform: { x: 5000, y: 5000 } }
    const photo = { ...page, id: 'r', properties: { fileId: 'jpg' } }
    assert.deepEqual(sharpCandidates([page, offscreen, photo], viewportBounds).map((o) => o.id), ['p'])
  })
})
