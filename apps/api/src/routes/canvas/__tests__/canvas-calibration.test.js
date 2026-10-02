import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CALIBRATION_UNITS, normalizeCalibration } from '../canvas-calibration.js'

describe('Page calibration', () => {
  const valid = { a: { x: 0, y: 0 }, b: { x: 420, y: 0 }, distance: 10, unit: 'm' }
  it('accepts null and a valid calibration', () => {
    assert.equal(normalizeCalibration(null), null)
    assert.deepEqual(normalizeCalibration(valid), valid)
    assert.deepEqual(CALIBRATION_UNITS, ['m', 'cm', 'mm', 'ft'])
  })
  it('rejects bad calibrations with status 400', () => {
    for (const bad of [{ ...valid, distance: 0 }, { ...valid, unit: 'km' }, { ...valid, b: { x: 0, y: 0 } }, { ...valid, a: { x: 'x', y: 0 } }, 'nope']) {
      assert.throws(() => normalizeCalibration(bad), (error) => error.status === 400, JSON.stringify(bad))
    }
  })
})
