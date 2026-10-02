import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AUTO_CALIBRATION, pageGeoPatch } from '../canvas-background.js'

describe('Map page background', () => {
  it('sets metre calibration and geo coordinates for a map background', () => {
    const patch = pageGeoPatch({ type: 'map', origin: { lat: 19.43, lng: -99.13 }, label: 'Zócalo', bbox: [19.4, 19.5, -99.2, -99.1] }, null)
    assert.deepEqual(patch.calibration, AUTO_CALIBRATION)
    assert.deepEqual(patch.coordinateSystem, { unit: 'm', axis: 'geo', origin: { lat: 19.43, lng: -99.13 } })
    assert.equal(patch.background.label, 'Zócalo')
  })
  it('rejects invalid coordinates', () => {
    for (const bad of [{ type: 'map', origin: { lat: 95, lng: 0 } }, { type: 'map', origin: { lat: 0, lng: 200 } }, { type: 'map', origin: { lat: 0, lng: 0 }, bbox: [1, 2] }]) {
      assert.throws(() => pageGeoPatch(bad, null), (error) => error.status === 400)
    }
  })
  it('removing the map clears only the automatic calibration', () => {
    assert.deepEqual(pageGeoPatch(null, { calibration: AUTO_CALIBRATION, background: { type: 'map' } }), { background: null, calibration: null, coordinateSystem: { unit: 'px', origin: { x: 0, y: 0 }, axis: 'screen' } })
    const manual = { a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, distance: 2, unit: 'm' }
    assert.equal(pageGeoPatch(null, { calibration: manual, background: { type: 'map' } }).calibration, undefined)
  })
  it('passes other backgrounds through untouched', () => {
    assert.deepEqual(pageGeoPatch({ type: 'blank' }, null), { background: { type: 'blank' } })
  })
})
