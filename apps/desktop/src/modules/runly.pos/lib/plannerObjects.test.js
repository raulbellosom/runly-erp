import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { objectToPatch, plannerToObjects } from './plannerObjects.js'
import { canvasReducer, layoutPayload } from './floorPlannerState.js'

describe('POS planner adapter', () => {
  const floor = { canvasWidth: 1200, canvasHeight: 800 }
  const elements = [
    { id: 'p', kind: 'POLYGON', x: 10, y: 10, width: 100, height: 50, rotation: 0, label: 'Área', color: 'vip', points: [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 60, y: 60 }] },
    { id: 't', kind: 'TABLE_SQUARE', x: 200, y: 100, width: 80, height: 80, rotation: 30, tableName: 'Mesa 1', capacity: 4, chairStyle: 'auto' },
  ]
  it('round-trips a polygon unchanged', () => {
    const objects = plannerToObjects({ floor, elements })
    const patch = objectToPatch(objects.find((o) => o.id === 'p'))
    for (let i = 0; i < 3; i += 1) {
      assert.ok(Math.abs(patch.points[i].x - elements[0].points[i].x) < 0.01 && Math.abs(patch.points[i].y - elements[0].points[i].y) < 0.01)
    }
  })
  it('maps table props for the planner drawer and back', () => {
    const table = plannerToObjects({ floor, elements }).find((o) => o.id === 't')
    assert.equal(table.type, 'pos.table')
    assert.equal(table.properties.planner, true)
    assert.deepEqual(objectToPatch({ ...table, transform: { ...table.transform, x: -5.123 } }), { id: 't', x: -5.12, y: 100, width: 80, height: 80, rotation: 30 })
  })
  it('APPLY allows any position, keeps a minimum size, and the payload carries rotation', () => {
    const state = canvasReducer({ elements, dirty: false }, { type: 'APPLY', patches: [{ id: 't', x: -5, y: 3.456, width: 10, height: 90, rotation: 30 }] })
    const t = state.elements.find((e) => e.id === 't')
    assert.deepEqual({ x: t.x, y: t.y, width: t.width, height: t.height }, { x: -5, y: 3.46, width: 20, height: 90 })
    assert.equal(state.dirty, true)
    assert.equal(layoutPayload(state.elements).find((e) => e.id === 't').rotation, 30)
  })

  it('shifts the whole layout on save so no coordinate is negative', () => {
    const layout = [
      { id: 'a', kind: 'TABLE_SQUARE', x: -30, y: 40, width: 80, height: 80 },
      { id: 'b', kind: 'POLYGON', x: 10, y: -20, width: 100, height: 50, points: [{ x: 10, y: -20 }, { x: 110, y: -20 }, { x: 60, y: 30 }] },
    ]
    const payload = layoutPayload(layout)
    assert.deepEqual([payload[0].x, payload[0].y], [0, 60])
    assert.deepEqual([payload[1].x, payload[1].y], [40, 0])
    assert.deepEqual(payload[1].style.points, [{ x: 40, y: 0 }, { x: 140, y: 0 }, { x: 90, y: 50 }])
    const untouched = layoutPayload([{ id: 'c', kind: 'WALL', x: 5, y: 7, width: 10, height: 10 }])
    assert.deepEqual([untouched[0].x, untouched[0].y], [5, 7])
  })
})
