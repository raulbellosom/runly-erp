import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DXF_UNITS, collectSegments, drawingExtents, unitOf } from './dxf.js'

describe('DXF import helpers', () => {
  it('maps $INSUNITS to calibration units and metres', () => {
    assert.deepEqual(unitOf(4), { unit: 'mm', toUnit: 1 })
    assert.deepEqual(unitOf(6), { unit: 'm', toUnit: 1 })
    assert.deepEqual(unitOf(1), { unit: 'ft', toUnit: 1 / 12 })
    assert.equal(unitOf(0), null)
    assert.ok(DXF_UNITS[5])
  })
  it('flattens lines, polylines, circles and block inserts into segments', () => {
    const dxf = {
      entities: [
        { type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
        { type: 'LWPOLYLINE', shape: true, vertices: [{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 5, y: 5 }] },
        { type: 'CIRCLE', center: { x: 20, y: 20 }, radius: 2 },
        { type: 'INSERT', name: 'B', position: { x: 100, y: 0 }, xScale: 2, yScale: 2, rotation: 0 },
      ],
      blocks: { B: { entities: [{ type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }] } },
    }
    const { segments, circles } = collectSegments(dxf)
    assert.equal(segments.filter((s) => s.length === 2).length >= 4, true)
    assert.deepEqual(segments.at(-1), [{ x: 100, y: 0 }, { x: 102, y: 0 }])
    assert.deepEqual(circles, [{ x: 20, y: 20, r: 2 }])
    const e = drawingExtents({ segments, circles, texts: [] })
    assert.deepEqual(e, { minX: 0, minY: 0, maxX: 102, maxY: 22 })
  })
})
