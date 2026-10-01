import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fitBounds, screenToWorld, worldToScreen, zoomAt } from './viewport.js'

describe('Canvas viewport transforms', () => {
  it('round-trips world and screen coordinates independently of pixels stored in objects', () => {
    const viewport = { x: 120, y: -30, zoom: 2.5, rotation: 0 }
    const world = { x: 32, y: 44 }
    const screen = worldToScreen(world, viewport)
    assert.deepEqual(screenToWorld(screen, viewport), world)
  })

  it('keeps the world point under the cursor stable while zooming', () => {
    const point = { x: 400, y: 300 }
    const before = { x: 20, y: 10, zoom: 1, rotation: 0 }
    const after = zoomAt(before, point, 2)
    assert.deepEqual(screenToWorld(point, after), screenToWorld(point, before))
  })

  it('centers content when fitting and never zooms past 100%', () => {
    const size = { width: 800, height: 600 }
    const fitted = fitBounds({ x: 100, y: 100, width: 50, height: 50 }, size)
    assert.equal(fitted.zoom, 1)
    assert.deepEqual(worldToScreen({ x: 125, y: 125 }, fitted), { x: 400, y: 300 })
    assert.ok(fitBounds({ x: 0, y: 0, width: 4000, height: 100 }, size).zoom < 1)
  })
})

