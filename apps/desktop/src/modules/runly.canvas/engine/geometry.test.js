import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { absolutePoints, boxFromDrag, centerOf, boxOf, editVertex, hitObject, polygonFromAbsolute, polygonHandles, resizeObject, rotateObject, rotatePoint } from './geometry.js'

const rect = (rotation = 0) => ({ type: 'rectangle', transform: { x: 0, y: 0, rotation }, geometry: { width: 100, height: 50 } })
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)

describe('Canvas geometry', () => {
  it('resizes from a corner keeping the opposite corner fixed', () => {
    const next = resizeObject(rect(), 'se', { x: 150, y: 80 })
    assert.deepEqual(boxOf(next), { x: 0, y: 0, width: 150, height: 80, rotation: 0 })
  })

  it('keeps the anchored corner in place on rotated shapes', () => {
    const object = rect(90), b = boxOf(object), c = centerOf(b)
    const anchorBefore = rotatePoint({ x: b.x, y: b.y }, c, 90)
    const seWorld = rotatePoint({ x: 140, y: 70 }, c, 90)
    const nb = boxOf(resizeObject(object, 'se', seWorld))
    const anchorAfter = rotatePoint({ x: nb.x, y: nb.y }, centerOf(nb), 90)
    close(anchorAfter.x, anchorBefore.x); close(anchorAfter.y, anchorBefore.y)
    close(nb.width, 140); close(nb.height, 70)
  })

  it('hit-tests rotated boxes in their own frame', () => {
    const object = rect(45)
    assert.equal(hitObject({ x: 50, y: 25 }, object), true)
    assert.equal(hitObject({ x: 2, y: 2 }, object), false)
  })

  it('rotates with optional 15-degree snapping', () => {
    const c = centerOf(boxOf(rect()))
    assert.equal(rotateObject(rect(), { x: c.x + 100, y: c.y }).transform.rotation, 90)
    assert.equal(rotateObject(rect(), { x: c.x + 100, y: c.y + 8 }, { snap: true }).transform.rotation, 90)
  })

  it('normalizes dragged boxes and keeps line direction', () => {
    assert.deepEqual(boxFromDrag('rectangle', { x: 50, y: 50 }, { x: 10, y: 20 }), { x: 10, y: 20, width: 40, height: 30 })
    assert.deepEqual(boxFromDrag('line', { x: 50, y: 50 }, { x: 10, y: 20 }), { x: 50, y: 50, width: -40, height: -30 })
  })
})

describe('polygon vertices', () => {
  const poly = { id: 'p', type: 'polygon', transform: { x: 10, y: 20, rotation: 0 }, geometry: { width: 100, height: 50, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] } }
  it('converts relative points to world points and back', () => {
    assert.deepEqual(absolutePoints(poly), [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 60, y: 70 }])
    const rebuilt = polygonFromAbsolute(poly, absolutePoints(poly))
    assert.deepEqual(rebuilt.transform, { x: 10, y: 20, rotation: 0 })
    assert.deepEqual(rebuilt.geometry.points, poly.geometry.points)
  })
  it('exposes vertex and midpoint handles', () => {
    const ids = polygonHandles(poly).map((h) => h.id)
    assert.deepEqual(ids, ['v:0', 'v:1', 'v:2', 'm:0', 'm:1', 'm:2'])
  })
  it('moves a vertex and refits the box', () => {
    const next = editVertex(poly, 'v:2', { x: 60, y: 120 })
    assert.equal(next.geometry.height, 100)
    assert.deepEqual(absolutePoints(next)[2], { x: 60, y: 120 })
  })
  it('inserts a vertex from a midpoint and deletes vertices down to three', () => {
    const inserted = editVertex(poly, 'm:0', { x: 60, y: 10 })
    assert.equal(inserted.geometry.points.length, 4)
    assert.deepEqual(absolutePoints(inserted)[1], { x: 60, y: 10 })
    assert.equal(editVertex(inserted, 'delete:1').geometry.points.length, 3)
    assert.equal(editVertex(poly, 'delete:0'), poly)
  })
})
