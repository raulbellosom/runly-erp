import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { svgSize } from './svg.js'

// `sanitizeSvgText` needs a DOMParser/XMLSerializer, which only exist in a
// browser; it runs in the desktop app but is not unit-tested here.
describe('SVG library import: svgSize', () => {
  it('reads width/height given in px', () => {
    assert.deepEqual(svgSize('<svg width="64px" height="32px"></svg>'), { width: 64, height: 32 })
  })

  it('reads unitless width/height, preferring them over a present viewBox', () => {
    assert.deepEqual(svgSize('<svg width="100" height="50" viewBox="0 0 10 10"></svg>'), { width: 100, height: 50 })
  })

  it('falls back to the viewBox when width/height are missing', () => {
    assert.deepEqual(svgSize('<svg viewBox="0 0 200 150"></svg>'), { width: 200, height: 150 })
  })

  it('falls back to 64x64 with neither width/height nor viewBox', () => {
    assert.deepEqual(svgSize('<svg></svg>'), { width: 64, height: 64 })
  })

  it('falls back to 64x64 for a degenerate viewBox', () => {
    assert.deepEqual(svgSize('<svg viewBox="0 0 0 0"></svg>'), { width: 64, height: 64 })
  })

  it('ignores an unsupported unit like percentages', () => {
    assert.deepEqual(svgSize('<svg width="100%" height="50%" viewBox="0 0 24 24"></svg>'), { width: 24, height: 24 })
  })

  it('accepts attributes in any order and extra whitespace', () => {
    assert.deepEqual(svgSize('<svg  height="10"   width="20" ></svg>'), { width: 20, height: 10 })
  })
})
