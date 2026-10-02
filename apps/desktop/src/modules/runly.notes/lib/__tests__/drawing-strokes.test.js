import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mergeDrawing, createKnownDrawing, parseStrokes } from '../drawingStrokes.js'

const stroke = (id) => ({ id, tool: 'pen', color: '#000', size: 4, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] })

describe('mergeDrawing', () => {
  it('re-adds a local stroke that a concurrent write dropped', () => {
    const a = createKnownDrawing()
    mergeDrawing(a, [stroke('a1')], [])
    // B's write (which never saw a1) replaces the attribute with only b1.
    const merged = mergeDrawing(a, [stroke('b1')], [])
    assert.deepEqual(merged.strokes.map(s => s.id), ['b1', 'a1'])
    assert.equal(merged.changed, true)
  })

  it('converges: once both sides merged, nothing more is written', () => {
    const a = createKnownDrawing()
    const b = createKnownDrawing()
    mergeDrawing(a, [stroke('a1')], [])
    mergeDrawing(b, [stroke('b1')], [])
    const fromA = mergeDrawing(a, [stroke('b1')], [])
    const fromB = mergeDrawing(b, fromA.strokes, fromA.erased)
    assert.equal(fromB.changed, false)
  })

  it('keeps erased strokes erased even if another client still has them', () => {
    const a = createKnownDrawing()
    mergeDrawing(a, [stroke('s1'), stroke('s2')], [])
    const merged = mergeDrawing(a, [stroke('s1'), stroke('s2')], ['s1'])
    assert.deepEqual(merged.strokes.map(s => s.id), ['s2'])
  })

  it('gives legacy strokes without ids a stable id', () => {
    const raw = JSON.stringify([{ tool: 'pen', color: '#000', size: 4, points: [{ x: 0, y: 0 }] }])
    assert.equal(parseStrokes(raw)[0].id, parseStrokes(raw)[0].id)
    assert.equal(mergeDrawing(createKnownDrawing(), parseStrokes(raw), []).changed, false)
  })
})
