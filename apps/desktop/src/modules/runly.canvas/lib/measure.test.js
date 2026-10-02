import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calibrationScale, formatArea, formatLength, objectMeasures } from './measure.js'

const calibration = { a: { x: 0, y: 0 }, b: { x: 420, y: 0 }, distance: 10, unit: 'm' }

describe('Canvas measures', () => {
  it('derives units per world pixel', () => {
    assert.equal(calibrationScale(calibration), 10 / 420)
    assert.equal(calibrationScale(null), null)
  })
  it('formats lengths and areas in real units or px', () => {
    const scale = 1 / 42
    assert.equal(formatLength(84, { scale, unit: 'm' }), '2 m')
    assert.equal(formatLength(100, { scale, unit: 'm' }), '2.38 m')
    assert.equal(formatLength(84.4, null), '84 px')
    assert.equal(formatArea(210 * 84, { scale, unit: 'm' }), '10 m²')
    assert.equal(formatArea(100, null), '100 px²')
  })
  it('measures rectangles, ellipses, polygons and lines in world px', () => {
    const rect = objectMeasures({ type: 'rectangle', transform: { x: 0, y: 0 }, geometry: { width: 210, height: 84 } })
    assert.deepEqual(rect, { width: 210, height: 84, area: 210 * 84, perimeter: 2 * (210 + 84) })
    const tri = objectMeasures({ type: 'polygon', transform: { x: 0, y: 0 }, geometry: { width: 10, height: 10, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } })
    assert.equal(tri.area, 50)
    const line = objectMeasures({ type: 'line', transform: { x: 0, y: 0 }, geometry: { x2: 30, y2: 40 } })
    assert.equal(line.length, 50)
    const ellipse = objectMeasures({ type: 'ellipse', transform: { x: 0, y: 0 }, geometry: { width: 20, height: 10 } })
    assert.ok(Math.abs(ellipse.area - Math.PI * 10 * 5) < 1e-9)
  })
})
