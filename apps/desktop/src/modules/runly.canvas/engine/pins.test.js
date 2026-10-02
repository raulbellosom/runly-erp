import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PIN_SIZES, hitPin, labelsOverlap, pinOf } from './pins.js'

const hotspot = (style = {}) => ({ id: 'h', type: 'hotspot', transform: { x: 100, y: 100, rotation: 0 }, geometry: { width: 36, height: 36 }, style })

describe('hotspot pins', () => {
  it('defaults to a medium screen-fixed pin anchored at the box centre', () => {
    assert.deepEqual(pinOf(hotspot()), { size: 'md', scale: 'screen', anchor: { x: 118, y: 118 }, height: PIN_SIZES.md })
    assert.equal(pinOf(hotspot({ pin: { size: 'lg', scale: 'plan' } })).scale, 'plan')
    assert.equal(pinOf(hotspot({ pin: { size: 'xx' } })).size, 'md')
  })
  it('keeps the same screen height at any zoom', () => {
    assert.equal(PIN_SIZES.md, 32)
  })
  it('hits a screen pin by screen distance from its head', () => {
    const pin = pinOf(hotspot())
    // head centre sits above the anchor: anchor.y - 0.62 * height (in screen px, divided by zoom in world)
    const zoom = 2, headY = pin.anchor.y - (0.62 * pin.height) / zoom
    assert.equal(hitPin({ x: pin.anchor.x, y: headY + 5 / zoom }, pin, zoom), true)
    assert.equal(hitPin({ x: pin.anchor.x + 40 / zoom, y: headY }, pin, zoom), false)
  })
  it('detects overlapping label rectangles', () => {
    assert.equal(labelsOverlap({ x: 0, y: 0, width: 50, height: 20 }, [{ x: 40, y: 10, width: 50, height: 20 }]), true)
    assert.equal(labelsOverlap({ x: 0, y: 0, width: 50, height: 20 }, [{ x: 60, y: 0, width: 50, height: 20 }]), false)
  })
})
