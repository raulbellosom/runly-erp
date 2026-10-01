import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildOperations, createHistory } from './history.js'

const before = { id: 'a', type: 'rectangle', revision: 2, transform: { x: 0, y: 0 } }
const after = { ...before, revision: 3, transform: { x: 40, y: 10 } }

describe('Canvas history', () => {
  it('replays updates against the current revision', () => {
    const rows = [{ ...after, revision: 7 }]
    const [op] = buildOperations([{ id: 'a', before, after }], 'undo', rows)
    assert.equal(op.op, 'update')
    assert.equal(op.expectedRevision, 7)
    assert.deepEqual(op.data.transform, { x: 0, y: 0 })
  })

  it('undoes a create with delete and redoes it with restore of the same id', () => {
    const change = { id: 'a', before: null, after }
    assert.deepEqual(buildOperations([change], 'undo', [after]), [{ op: 'delete', id: 'a', expectedRevision: 3 }])
    const [redo] = buildOperations([change], 'redo', [])
    assert.equal(redo.op, 'restore')
    assert.equal(redo.id, 'a')
  })

  it('resolves temporary ids and keeps undo/redo stacks consistent', () => {
    const history = createHistory()
    history.record([{ id: 'local-1', before, after }], 'Mover')
    history.alias('local-1', 'server-1')
    assert.equal(history.resolveId('local-1'), 'server-1')
    assert.equal(history.takeUndo().label, 'Mover')
    assert.equal(history.canRedo, true)
    history.revert('undo')
    assert.equal(history.canUndo, true)
    assert.equal(history.canRedo, false)
    history.record([{ id: 'b', before: null, after: null }])
    assert.equal(history.peekUndo().label, 'Mover')
  })
})

describe('Canvas history coalescing', () => {
  it('merges quick repeated nudges into a single undo step', () => {
    const history = createHistory()
    const step = (x) => ({ ...before, transform: { x, y: 0 } })
    history.record([{ id: 'a', before: step(0), after: step(1) }], 'Desplazar', { coalesce: 'nudge', now: 1000 })
    history.record([{ id: 'a', before: step(1), after: step(2) }], 'Desplazar', { coalesce: 'nudge', now: 1500 })
    const entry = history.takeUndo()
    assert.equal(entry.changes[0].before.transform.x, 0)
    assert.equal(entry.changes[0].after.transform.x, 2)
    assert.equal(history.canUndo, false)
  })
})
