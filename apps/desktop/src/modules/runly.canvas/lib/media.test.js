import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_RASTER_SIDE, PDF_DPI, pdfRenderScale } from './media.js'

describe('PDF import resolution', () => {
  it('renders ordinary pages at print-quality 300 DPI', () => {
    assert.equal(PDF_DPI, 300)
    assert.equal(pdfRenderScale(612, 792), 300 / 72)
  })

  it('caps oversized plans at a 7200 px longest side', () => {
    const width = 2384, height = 3370
    const scale = pdfRenderScale(width, height)
    assert.equal(MAX_RASTER_SIDE, 7200)
    assert.ok(Math.abs(height * scale - MAX_RASTER_SIDE) < 0.001)
  })
})
