import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SHAPE_KINDS, convertShape, shapeKindOf } from './shapeConvert.js'

describe('shape conversion', () => {
  const rect = { id: 'r', type: 'rectangle', geometry: { width: 100, height: 60 }, properties: { binding: { source: 'x', id: '1' } }, style: { stroke: '#000' } }
  it('knows the kind of each object', () => {
    assert.equal(shapeKindOf(rect), 'rectangle')
    assert.equal(shapeKindOf({ type: 'polygon', properties: { shape: 'diamond' } }), 'diamond')
    assert.equal(shapeKindOf({ type: 'arrow' }), 'arrow')
    assert.deepEqual(SHAPE_KINDS.closed, ['rectangle', 'ellipse', 'triangle', 'diamond'])
  })
  it('converts keeping box, style and properties', () => {
    const tri = convertShape(rect, 'triangle')
    assert.equal(tri.type, 'polygon')
    assert.equal(tri.properties.shape, 'triangle')
    assert.equal(tri.properties.binding.id, '1')
    assert.equal(tri.geometry.width, 100)
    assert.equal(tri.geometry.points.length, 3)
    const ellipse = convertShape(tri, 'ellipse')
    assert.equal(ellipse.type, 'ellipse')
    assert.equal(ellipse.properties.shape, undefined)
    assert.equal(ellipse.geometry.points, undefined)
    assert.equal(convertShape({ type: 'line', geometry: { x2: 5, y2: 0 } }, 'arrow').type, 'arrow')
    assert.equal(convertShape(rect, 'rectangle'), rect)
  })
})
