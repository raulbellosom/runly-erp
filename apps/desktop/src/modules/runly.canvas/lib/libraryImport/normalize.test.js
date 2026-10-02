import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeObjects, placeObjects } from './normalize.js'

function rect(x, y, width = 10, height = 10, extra = {}) {
  return {
    id: 'obj-1', pageId: 'page-1', layerId: 'layer-1', revision: 3, position: 0,
    type: 'rectangle', transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 }, geometry: { width, height },
    style: {}, properties: {}, ...extra,
  }
}

describe('Library normalize: normalizeObjects', () => {
  it('translates the bounding box to (0,0) and reports its size', () => {
    const { objects, width, height } = normalizeObjects([rect(100, 200, 40, 20)])
    assert.equal(width, 40)
    assert.equal(height, 20)
    assert.equal(objects[0].transform.x, 0)
    assert.equal(objects[0].transform.y, 0)
  })

  it('strips runtime/positional fields that only make sense on their original Board', () => {
    const [object] = normalizeObjects([rect(0, 0)]).objects
    for (const key of ['id', 'pageId', 'layerId', 'revision', 'position']) {
      assert.equal(key in object, false, `${key} should be stripped`)
    }
    assert.equal(object.type, 'rectangle')
  })

  it('keeps relative offsets between multiple objects', () => {
    const { objects } = normalizeObjects([rect(100, 100, 10, 10), rect(150, 130, 10, 10)])
    assert.deepEqual([objects[0].transform.x, objects[0].transform.y], [0, 0])
    assert.deepEqual([objects[1].transform.x, objects[1].transform.y], [50, 30])
  })

  it('returns an empty payload for no objects', () => {
    assert.deepEqual(normalizeObjects([]), { objects: [], width: 0, height: 0 })
    assert.deepEqual(normalizeObjects(undefined), { objects: [], width: 0, height: 0 })
  })

  it('accounts for a rotated box in the bounding box', () => {
    // A 10x10 square rotated 45deg around its own center has a bigger AABB.
    const rotated = rect(0, 0, 10, 10, { transform: { x: 0, y: 0, rotation: 45, scaleX: 1, scaleY: 1 } })
    const { width, height } = normalizeObjects([rotated])
    assert.ok(width > 10 && height > 10)
  })
})

describe('Library normalize: placeObjects', () => {
  it('places a normalized payload at an origin, keeping relative order and offsets', () => {
    const normalized = normalizeObjects([rect(0, 0, 10, 10), rect(50, 30, 10, 10)])
    const placed = placeObjects(normalized, { x: 200, y: 300 })
    assert.deepEqual([placed[0].transform.x, placed[0].transform.y], [200, 300])
    assert.deepEqual([placed[1].transform.x, placed[1].transform.y], [250, 330])
  })

  it('returns an empty array for an item with no objects', () => {
    assert.deepEqual(placeObjects({ objects: [] }, { x: 0, y: 0 }), [])
    assert.deepEqual(placeObjects({}, { x: 0, y: 0 }), [])
  })
})
