import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createGeoFrame, mapCamera, worldBoundsOfBbox } from './geo.js'

describe('Canvas geo frame', () => {
  const frame = createGeoFrame({ lat: 19.4326, lng: -99.1332 })
  it('round-trips lat/lng through world metres', () => {
    const world = frame.toWorld({ lat: 19.44, lng: -99.12 })
    const back = frame.toLatLng(world)
    assert.ok(Math.abs(back.lat - 19.44) < 1e-6 && Math.abs(back.lng + 99.12) < 1e-6)
    assert.deepEqual(frame.toWorld({ lat: 19.4326, lng: -99.1332 }), { x: 0, y: 0 })
  })
  it('world units are close to ground metres near the origin', () => {
    const east = frame.toWorld({ lat: 19.4326, lng: -99.1332 + 0.001 })
    assert.ok(Math.abs(east.x - 104.9) < 0.5, String(east.x))
    assert.ok(frame.toWorld({ lat: 19.4336, lng: -99.1332 }).y < 0)
  })
  it('derives the MapLibre camera from the canvas viewport', () => {
    const equator = createGeoFrame({ lat: 0, lng: 0 })
    const cam = mapCamera({ x: 400, y: 300, zoom: 1 }, { width: 800, height: 600 }, equator)
    assert.ok(Math.abs(cam.zoom - Math.log2(40075016.686 / 512)) < 0.001)
    assert.ok(Math.abs(cam.center.lat) < 1e-9 && Math.abs(cam.center.lng) < 1e-9)
  })
  it('converts a bbox to world bounds', () => {
    const b = worldBoundsOfBbox([19.43, 19.44, -99.14, -99.13], frame)
    assert.ok(b.width > 0 && b.height > 0)
  })
})
