import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createGeocoder } from '../canvas-geocoder.js'

describe('Canvas geocoder proxy', () => {
  it('maps Nominatim results, sends a User-Agent and caches repeated queries', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), ua: init.headers['User-Agent'] })
      return { ok: true, json: async () => [{ display_name: 'Zócalo, CDMX', lat: '19.4326', lon: '-99.1332', boundingbox: ['19.43', '19.44', '-99.14', '-99.13'] }] }
    }
    const geocoder = createGeocoder({ env: {}, fetchImpl, minIntervalMs: 0 })
    const first = await geocoder.search('zocalo')
    const second = await geocoder.search('  ZOCALO ')
    assert.deepEqual(first, [{ label: 'Zócalo, CDMX', lat: 19.4326, lng: -99.1332, bbox: [19.43, 19.44, -99.14, -99.13] }])
    assert.deepEqual(second, first)
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /nominatim\.openstreetmap\.org\/search\?/)
    assert.equal(calls[0].ua, 'RunlyERP/1.0')
  })
  it('validates input and can be disabled', async () => {
    const geocoder = createGeocoder({ env: { CANVAS_MAPS: 'false' }, fetchImpl: async () => ({ ok: true, json: async () => [] }) })
    await assert.rejects(() => geocoder.search('x'), (error) => error.status === 503)
    const enabled = createGeocoder({ env: {}, fetchImpl: async () => ({ ok: true, json: async () => [] }) })
    await assert.rejects(() => enabled.search('   '), (error) => error.status === 400)
    assert.deepEqual(enabled.mapConfig(), { enabled: true, styleUrl: 'https://tiles.openfreemap.org/styles/liberty', attribution: '© OpenStreetMap' })
  })
})
