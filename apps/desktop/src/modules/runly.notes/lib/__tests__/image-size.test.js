import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clampImageWidthPct,
  computeInitialImageWidthPct,
  DEFAULT_IMAGE_WIDTH_PCT,
  MIN_IMAGE_WIDTH_PCT,
  MAX_IMAGE_WIDTH_PCT,
  computeCornerResize,
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

test('computeCornerResize: is a uniform scale — the aspect ratio never changes, even when deltaX/deltaY imply different ratios', () => {
  // deltaX alone would imply a 1.2x scale, deltaY alone a 1.025x scale —
  // resize must still report the ORIGINAL 300/200 = 1.5 ratio, not one
  // derived from independently moving width and height.
  const result = computeCornerResize({
    startWidthPx: 300, startHeightPx: 200, containerWidthPx: 600, deltaX: 60, deltaY: 5,
  })
  assert.equal(result.widthPct, 60) // scale 1.2 (dominant axis: deltaX) -> (300*1.2)/600 * 100
  assert.equal(result.aspectRatio, 1.5) // unchanged from startWidthPx/startHeightPx
})

test('computeCornerResize: uses whichever axis moved further to drive the (still uniform) scale', () => {
  const result = computeCornerResize({
    startWidthPx: 300, startHeightPx: 200, containerWidthPx: 600, deltaX: 5, deltaY: 100,
  })
  assert.equal(result.widthPct, 75) // scale 1.5 (dominant axis: deltaY) -> (300*1.5)/600 * 100
  assert.equal(result.aspectRatio, 1.5) // still unchanged
})

test('computeCornerResize: shrinking clamps at MIN_IMAGE_WIDTH_PCT, aspect ratio still preserved', () => {
  const result = computeCornerResize({
    startWidthPx: 300, startHeightPx: 200, containerWidthPx: 600, deltaX: -400, deltaY: 0,
  })
  assert.equal(result.widthPct, MIN_IMAGE_WIDTH_PCT)
  assert.equal(result.aspectRatio, 1.5)
})

test('computeCornerResize: growing clamps at MAX_IMAGE_WIDTH_PCT, aspect ratio still preserved', () => {
  const result = computeCornerResize({
    startWidthPx: 300, startHeightPx: 200, containerWidthPx: 600, deltaX: 900, deltaY: 0,
  })
  assert.equal(result.widthPct, MAX_IMAGE_WIDTH_PCT)
  assert.equal(result.aspectRatio, 1.5)
})
