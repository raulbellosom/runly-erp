import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateCanvasObject } from '../../../../../api/src/routes/canvas/canvas-service.js'
import { boxFromDrag, boxOf, resizeObject, rotateObject } from '../engine/geometry.js'
import { CREATION_TOOLS, buildObjectData, defaultBox } from './objectFactory.js'

// Every payload the editor sends must pass the API's own validator, in every
// drag direction and after resize/rotate edits (partial updates).
describe('Canvas object payloads vs API validation', () => {
  const corners = [[{ x: 100, y: 100 }, { x: 260, y: 220 }], [{ x: 260, y: 220 }, { x: 100, y: 100 }], [{ x: 100, y: 220 }, { x: 260, y: 100 }]]
  for (const tool of CREATION_TOOLS) {
    it(`creates a valid ${tool}`, () => {
      assert.doesNotThrow(() => validateCanvasObject(buildObjectData(tool, defaultBox(tool, { x: 10, y: 10 }))))
      for (const [a, b] of corners) {
        const kind = tool === 'line' || tool === 'arrow' ? tool : 'rectangle'
        const data = buildObjectData(tool, boxFromDrag(kind, a, b))
        assert.doesNotThrow(() => validateCanvasObject(data), `${tool} ${JSON.stringify([a, b])}`)
        const object = { id: 'x', ...data }
        const handle = tool === 'line' || tool === 'arrow' ? 'start' : 'nw'
        const resized = resizeObject(object, handle, { x: 400, y: 400 })
        assert.doesNotThrow(() => validateCanvasObject({ transform: resized.transform, geometry: resized.geometry }, { partial: true }))
        const rotated = rotateObject(object, { x: 0, y: 0 })
        assert.doesNotThrow(() => validateCanvasObject({ transform: rotated.transform, geometry: rotated.geometry }, { partial: true }))
      }
    })
  }

  it('keeps arrow direction through the stored x2/y2 offsets', () => {
    const data = buildObjectData('arrow', boxFromDrag('arrow', { x: 200, y: 200 }, { x: 50, y: 20 }))
    assert.deepEqual(data.geometry, { x2: -150, y2: -180 })
    const box = boxOf({ ...data })
    assert.equal(box.width, -150)
    assert.equal(box.height, -180)
  })
})
