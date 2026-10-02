import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_TTL_MS, colorFor, createThrottle, reduceCursor, visibleCursors } from './remoteCursors.js'

describe('Remote cursors', () => {
  it('assigns a stable color per user', () => {
    assert.equal(colorFor('user-1'), colorFor('user-1'))
    assert.match(colorFor('user-2'), /^#[0-9a-f]{6}$/i)
  })
  it('stores the latest cursor per actor and drops self', () => {
    let state = reduceCursor(new Map(), { actorId: 'u2', pageId: 'p1', x: 1, y: 2, selectedIds: ['a'] }, { selfId: 'u1', now: 100 })
    state = reduceCursor(state, { actorId: 'u1', pageId: 'p1', x: 9, y: 9 }, { selfId: 'u1', now: 100 })
    assert.deepEqual([...state.keys()], ['u2'])
    assert.equal(state.get('u2').at, 100)
  })
  it('shows cursors on the same page that are fresh and still present', () => {
    const state = new Map([
      ['u2', { actorId: 'u2', pageId: 'p1', x: 1, y: 1, selectedIds: [], at: 1000 }],
      ['u3', { actorId: 'u3', pageId: 'p2', x: 1, y: 1, selectedIds: [], at: 1000 }],
      ['u4', { actorId: 'u4', pageId: 'p1', x: 1, y: 1, selectedIds: [], at: 0 }],
    ])
    const presence = [{ id: 'u2', name: 'Ana' }, { id: 'u3', name: 'Luis' }, { id: 'u4', name: 'Eva' }]
    const shown = visibleCursors(state, { pageId: 'p1', presence, now: 1000 + CURSOR_TTL_MS - 1 })
    assert.deepEqual(shown.map((c) => [c.id, c.name]), [['u2', 'Ana']])
  })
  it('throttles to one call per interval and flushes the last value', async () => {
    const calls = []
    const throttled = createThrottle((value) => calls.push(value), 20)
    throttled(1); throttled(2); throttled(3)
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.deepEqual(calls, [1, 3])
  })
})
