import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { floorToObjects, isTableObject } from './floorObjects.js'

describe('POS floor adapter', () => {
  const floor = { canvasWidth: 1200, canvasHeight: 800 }
  const elements = [
    { id: 'z', kind: 'FLOOR_ZONE', x: '0', y: '0', width: '400', height: '300', rotation: '0', label: 'Terraza', style: { color: 'outdoor' } },
    { id: 'p', kind: 'POLYGON', x: '10', y: '10', width: '100', height: '50', rotation: '0', style: { points: [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 60, y: 60 }], color: 'vip' } },
    { id: 't', kind: 'TABLE_ROUND', tableId: 'tab-1', x: '500.50', y: '200', width: '80', height: '80', rotation: '15', label: 'M1', style: { capacity: 4 } },
    { id: 'w', kind: 'WALL', x: '0', y: '0', width: '10', height: '300', rotation: '0' },
  ]
  const tableStates = { 'tab-1': { id: 'tab-1', name: 'Mesa 1', status: 'OCCUPIED', capacity: 6, isMine: false } }
  const objects = floorToObjects({ floor, elements, tableStates })

  it('starts with the floor surface and keeps zones/polygons below tables', () => {
    assert.equal(objects[0].type, 'pos.surface')
    assert.deepEqual(objects[0].geometry, { width: 1400, height: 900 })
    const order = objects.map((o) => o.id)
    assert.ok(order.indexOf('z') < order.indexOf('t') && order.indexOf('p') < order.indexOf('t'))
  })
  it('converts decimals, rotation and polygon points', () => {
    const table = objects.find((o) => o.id === 't')
    assert.deepEqual(table.transform, { x: 500.5, y: 200, rotation: 15, scaleX: 1, scaleY: 1 })
    assert.deepEqual(table.properties, { kind: 'TABLE_ROUND', round: true, capacity: 6, chairStyle: 'auto', name: 'Mesa 1', status: 'OCCUPIED', dimmed: true, orphan: false, tableId: 'tab-1', label: 'M1' })
    assert.ok(isTableObject(table))
    const polygon = objects.find((o) => o.id === 'p')
    assert.equal(polygon.type, 'polygon')
    assert.deepEqual(polygon.geometry.points, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }])
  })
  it('falls back to the element label and AVAILABLE without a table', () => {
    assert.equal(objects.find((o) => o.id === 'w').type, 'pos.decor')
    const solo = floorToObjects({ floor, elements: [{ id: 'x', kind: 'TABLE_SQUARE', x: 0, y: 0, width: 60, height: 60, label: 'B2', style: { capacity: 2 } }], tableStates: {} }).find((o) => o.id === 'x')
    assert.equal(solo.properties.status, 'AVAILABLE')
    assert.equal(solo.properties.name, 'B2')
    assert.equal(solo.properties.dimmed, false)
    const ghost = floorToObjects({ floor, elements: [{ id: 'g', kind: 'TABLE_SQUARE', tableId: 'gone', x: 0, y: 0, width: 60, height: 60 }], tableStates: {} }).find((o) => o.id === 'g')
    assert.equal(ghost.properties.orphan, true)
  })
})
