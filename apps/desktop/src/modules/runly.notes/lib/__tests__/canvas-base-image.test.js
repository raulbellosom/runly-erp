import test from 'node:test'
import assert from 'node:assert/strict'
import { dpiToScale, PDF_RENDER_DPI, computeFitDimensions } from '../canvasBaseImage.js'

test('dpiToScale: 72 DPI (PDF user space) is scale 1', () => {
  assert.equal(dpiToScale(72), 1)
})

test('dpiToScale: 450 DPI is scale 6.25', () => {
  assert.equal(dpiToScale(450), 6.25)
})

test('PDF_RENDER_DPI is print-grade (at least 400 DPI)', () => {
  assert.ok(PDF_RENDER_DPI >= 400)
})

test('computeFitDimensions: image already under the cap keeps its natural size', () => {
  const result = computeFitDimensions(800, 600, 1200)
  assert.deepEqual(result, { width: 800, height: 600 })
})

test('computeFitDimensions: oversized landscape image scales down, aspect ratio preserved', () => {
  const result = computeFitDimensions(4000, 2000, 1200)
  assert.deepEqual(result, { width: 1200, height: 600 })
})

test('computeFitDimensions: oversized portrait image scales down, aspect ratio preserved', () => {
  const result = computeFitDimensions(2000, 4000, 1200)
  assert.deepEqual(result, { width: 600, height: 1200 })
})

test('computeFitDimensions: missing natural size falls back to a maxDim square', () => {
  const result = computeFitDimensions(0, 0, 1200)
  assert.deepEqual(result, { width: 1200, height: 1200 })
})
