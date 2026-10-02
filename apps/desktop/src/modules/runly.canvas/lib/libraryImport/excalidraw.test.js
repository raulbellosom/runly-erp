import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateCanvasObject } from '../../../../../../api/src/routes/canvas/canvas-service.js'
import { parseExcalidrawLibrary } from './excalidraw.js'

function assertAllValid(objects) {
  for (const object of objects) assert.doesNotThrow(() => validateCanvasObject(object), JSON.stringify(object))
}

describe('Excalidraw library import', () => {
  it('parses v2 libraryItems: rectangle + 3-point arrow -> 1 rectangle + 2 segments, last with arrowhead', () => {
    const json = {
      type: 'excalidrawlib', version: 2,
      libraryItems: [{
        status: 'published', name: 'Red básica',
        elements: [
          { type: 'rectangle', x: 10, y: 20, width: 100, height: 50, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'hachure', strokeWidth: 2, strokeStyle: 'solid', roundness: null, opacity: 100 },
          { type: 'arrow', x: 0, y: 0, width: 150, height: 40, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', opacity: 100, points: [[0, 0], [75, 40], [150, 0]], endArrowhead: 'arrow', startArrowhead: null },
        ],
      }],
    }
    const { items, skipped } = parseExcalidrawLibrary(json)
    assert.equal(skipped, 0)
    assert.equal(items.length, 1)
    assert.equal(items[0].name, 'Red básica')
    const [rect, seg1, seg2] = items[0].objects
    assert.equal(items[0].objects.length, 3)
    assert.equal(rect.type, 'rectangle')
    assert.equal(rect.style.radius, 0)
    assert.equal(seg1.type, 'line')
    assert.equal(seg2.type, 'arrow')
    assertAllValid(items[0].objects)
  })

  it('names v1 library items "Elemento N" and counts isDeleted/unsupported elements as skipped', () => {
    const json = {
      type: 'excalidrawlib', version: 1,
      library: [
        [{ type: 'rectangle', x: 0, y: 0, width: 10, height: 10, strokeColor: '#000', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, opacity: 100 }],
        [{ type: 'rectangle', x: 0, y: 0, width: 10, height: 10, isDeleted: true }, { type: 'image', x: 0, y: 0, width: 10, height: 10 }],
      ],
    }
    const { items, skipped } = parseExcalidrawLibrary(json)
    assert.deepEqual(items.map((item) => item.name), ['Elemento 1', 'Elemento 2'])
    assert.equal(items[0].objects.length, 1)
    assert.equal(items[1].objects.length, 0)
    assert.equal(skipped, 2)
    assertAllValid(items[0].objects)
  })

  it('maps a transparent stroke/fill to strokeWidth 0 and fill "none"', () => {
    const json = { version: 2, libraryItems: [{ name: 'T', elements: [
      { type: 'ellipse', x: 0, y: 0, width: 20, height: 20, strokeColor: 'transparent', backgroundColor: 'transparent', fillStyle: 'solid', opacity: 100 },
    ] }] }
    const { items } = parseExcalidrawLibrary(json)
    const [ellipse] = items[0].objects
    assert.equal(ellipse.style.strokeWidth, 0)
    assert.equal(ellipse.style.fill, 'none')
    assertAllValid(items[0].objects)
  })

  it('converts a diamond to a polygon with 4 diamond points', () => {
    const json = { version: 2, libraryItems: [{ name: 'D', elements: [
      { type: 'diamond', x: 0, y: 0, width: 40, height: 40, strokeColor: '#000', backgroundColor: '#fff', fillStyle: 'solid', opacity: 100 },
    ] }] }
    const { items } = parseExcalidrawLibrary(json)
    const [diamond] = items[0].objects
    assert.equal(diamond.type, 'polygon')
    assert.equal(diamond.properties.shape, 'diamond')
    assert.equal(diamond.geometry.points.length, 4)
    assertAllValid(items[0].objects)
  })

  it('decimates freedraw to at most 40 points and emits only line segments', () => {
    const points = Array.from({ length: 120 }, (_, i) => [i, Math.sin(i / 5) * 10])
    const json = { version: 2, libraryItems: [{ name: 'F', elements: [
      { type: 'freedraw', x: 0, y: 0, width: 119, height: 20, strokeColor: '#000', opacity: 100, points },
    ] }] }
    const { items } = parseExcalidrawLibrary(json)
    assert.ok(items[0].objects.length <= 39)
    for (const object of items[0].objects) assert.equal(object.type, 'line')
    assertAllValid(items[0].objects)
  })

  it('converts a text element (text, fontSize and textColor from strokeColor)', () => {
    const json = { version: 2, libraryItems: [{ name: 'Txt', elements: [
      { type: 'text', x: 5, y: 5, width: 80, height: 25, strokeColor: '#111111', fontSize: 22, text: 'Hola', opacity: 100 },
    ] }] }
    const { items } = parseExcalidrawLibrary(json)
    const [text] = items[0].objects
    assert.equal(text.type, 'text')
    assert.equal(text.properties.text, 'Hola')
    assert.equal(text.style.fontSize, 22)
    assert.equal(text.style.textColor, '#111111')
    assertAllValid(items[0].objects)
  })

  it('returns no items for an unrecognized document shape', () => {
    assert.deepEqual(parseExcalidrawLibrary({}), { items: [], skipped: 0 })
    assert.deepEqual(parseExcalidrawLibrary(null), { items: [], skipped: 0 })
  })
})
