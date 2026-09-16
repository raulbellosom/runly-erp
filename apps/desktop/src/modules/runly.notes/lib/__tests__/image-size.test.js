import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clampImageWidthPct,
  computeInitialImageWidthPct,
  DEFAULT_IMAGE_WIDTH_PCT,
  MIN_IMAGE_WIDTH_PCT,
  MAX_IMAGE_WIDTH_PCT,
  computeCornerResize,
  clampImageHeightPx,
  MIN_IMAGE_HEIGHT_PX,
} from '../imageSize.js'

test('clampImageWidthPct: keeps an in-range value unchanged', () => {
  assert.equal(clampImageWidthPct(45), 45)
})

test('clampImageWidthPct: clamps below the minimum', () => {
  assert.equal(clampImageWidthPct(5), MIN_IMAGE_WIDTH_PCT)
})

test('clampImageWidthPct: clamps above the maximum', () => {
  assert.equal(clampImageWidthPct(150), MAX_IMAGE_WIDTH_PCT)
})

test('clampImageWidthPct: falls back to the default for non-finite input', () => {
  assert.equal(clampImageWidthPct(NaN), DEFAULT_IMAGE_WIDTH_PCT)
  assert.equal(clampImageWidthPct(undefined), DEFAULT_IMAGE_WIDTH_PCT)
})

test('computeInitialImageWidthPct: a normal landscape image gets the flat default', () => {
  // 2000x1000 (aspect 2) in a 700px column: height at 60% width is well
  // under the cap, so the default scale wins.
  const pct = computeInitialImageWidthPct({ naturalWidth: 2000, naturalHeight: 1000, columnWidthPx: 700 })
  assert.equal(pct, DEFAULT_IMAGE_WIDTH_PCT)
})

test('computeInitialImageWidthPct: a tall portrait screenshot is scaled down below the default', () => {
  // 1080x2340 (a typical phone screenshot, aspect ~0.46) in a 700px column:
  // 60% width would render ~1000px tall, so it must scale down.
  const pct = computeInitialImageWidthPct({ naturalWidth: 1080, naturalHeight: 2340, columnWidthPx: 700 })
  assert.ok(pct < DEFAULT_IMAGE_WIDTH_PCT, `expected ${pct} < ${DEFAULT_IMAGE_WIDTH_PCT}`)
  assert.ok(pct >= MIN_IMAGE_WIDTH_PCT)
})

test('computeInitialImageWidthPct: an extremely tall image floors at the minimum, never below it', () => {
  const pct = computeInitialImageWidthPct({ naturalWidth: 500, naturalHeight: 8000, columnWidthPx: 700 })
  assert.equal(pct, MIN_IMAGE_WIDTH_PCT)
})

test('computeInitialImageWidthPct: falls back to the default when a dimension is missing', () => {
  assert.equal(computeInitialImageWidthPct({ naturalWidth: 0, naturalHeight: 100, columnWidthPx: 700 }), DEFAULT_IMAGE_WIDTH_PCT)
  assert.equal(computeInitialImageWidthPct({ naturalWidth: 100, naturalHeight: 100, columnWidthPx: 0 }), DEFAULT_IMAGE_WIDTH_PCT)
})

test('computeCornerResize: grows width and height with the drag delta, from any corner', () => {
  const result = computeCornerResize({
    startWidthPx: 300, startHeightPx: 200, containerWidthPx: 600, deltaX: 60, deltaY: 40,
  })
  assert.equal(result.widthPct, 60) // (300+60)/600 * 100
  assert.equal(result.aspectRatio, 1.5) // 360/240
})

test('computeCornerResize: shrinking width clamps at MIN_IMAGE_WIDTH_PCT', () => {
  const result = computeCornerResize({
    startWidthPx: 300, startHeightPx: 200, containerWidthPx: 600, deltaX: -400, deltaY: 0,
  })
  assert.equal(result.widthPct, MIN_IMAGE_WIDTH_PCT)
})

test('computeCornerResize: growing width clamps at MAX_IMAGE_WIDTH_PCT', () => {
  const result = computeCornerResize({
    startWidthPx: 300, startHeightPx: 200, containerWidthPx: 600, deltaX: 900, deltaY: 0,
  })
  assert.equal(result.widthPct, MAX_IMAGE_WIDTH_PCT)
})

test('computeCornerResize: shrinking height clamps at MIN_IMAGE_HEIGHT_PX, width unaffected', () => {
  const result = computeCornerResize({
    startWidthPx: 300, startHeightPx: 50, containerWidthPx: 600, deltaX: 0, deltaY: -100,
  })
  assert.equal(result.widthPct, 50) // (300+0)/600 * 100, unchanged
  assert.equal(result.aspectRatio, 300 / MIN_IMAGE_HEIGHT_PX)
})

test('clampImageHeightPx: keeps an in-range value unchanged', () => {
  assert.equal(clampImageHeightPx(120), 120)
})

test('clampImageHeightPx: clamps below the minimum', () => {
  assert.equal(clampImageHeightPx(10), MIN_IMAGE_HEIGHT_PX)
})

test('clampImageHeightPx: falls back to the minimum for non-finite input', () => {
  assert.equal(clampImageHeightPx(NaN), MIN_IMAGE_HEIGHT_PX)
})
