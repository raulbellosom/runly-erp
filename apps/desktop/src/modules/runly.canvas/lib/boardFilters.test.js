import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_FILTERS, activeFilterCount, applyBoardFilters, orderBySearch } from './boardFilters.js'

const NOW = new Date(2026, 9, 2, 12, 0, 0).getTime() // local noon, Oct 2 2026
const DAY_MS = 86_400_000

const board = (overrides) => ({ id: overrides.id, name: overrides.name ?? overrides.id, templateType: 'blank', myRole: 'OWNER', updatedAt: new Date(NOW).toISOString(), createdAt: new Date(NOW).toISOString(), ...overrides })

describe('applyBoardFilters', () => {
  it('keeps every board when the template list is empty, filters to the selected ones otherwise', () => {
    const boards = [board({ id: 'a', templateType: 'plan' }), board({ id: 'b', templateType: 'map' })]
    assert.deepEqual(applyBoardFilters(boards, DEFAULT_FILTERS, NOW).map((b) => b.id), ['a', 'b'])
    const result = applyBoardFilters(boards, { ...DEFAULT_FILTERS, templates: ['map'] }, NOW)
    assert.deepEqual(result.map((b) => b.id), ['b'])
  })

  it('filters by access: mine keeps OWNER, shared keeps everything else', () => {
    const boards = [board({ id: 'owned', myRole: 'OWNER' }), board({ id: 'shared', myRole: 'EDITOR' })]
    assert.deepEqual(applyBoardFilters(boards, { ...DEFAULT_FILTERS, access: 'mine' }, NOW).map((b) => b.id), ['owned'])
    assert.deepEqual(applyBoardFilters(boards, { ...DEFAULT_FILTERS, access: 'shared' }, NOW).map((b) => b.id), ['shared'])
    assert.equal(applyBoardFilters(boards, { ...DEFAULT_FILTERS, access: 'all' }, NOW).length, 2)
  })

  it('filters by updated: today requires the same local calendar day', () => {
    const boards = [
      board({ id: 'today', updatedAt: new Date(2026, 9, 2, 1, 0, 0).toISOString() }),
      board({ id: 'yesterday', updatedAt: new Date(2026, 9, 1, 23, 59, 0).toISOString() }),
    ]
    assert.deepEqual(applyBoardFilters(boards, { ...DEFAULT_FILTERS, updated: 'today' }, NOW).map((b) => b.id), ['today'])
  })

  it('filters by updated: 7d/30d windows measure elapsed time from now', () => {
    const boards = [
      board({ id: 'within7', updatedAt: new Date(NOW - 5 * DAY_MS).toISOString() }),
      board({ id: 'within30only', updatedAt: new Date(NOW - 10 * DAY_MS).toISOString() }),
      board({ id: 'old', updatedAt: new Date(NOW - 40 * DAY_MS).toISOString() }),
    ]
    assert.deepEqual(applyBoardFilters(boards, { ...DEFAULT_FILTERS, updated: '7d' }, NOW).map((b) => b.id), ['within7'])
    assert.deepEqual(applyBoardFilters(boards, { ...DEFAULT_FILTERS, updated: '30d' }, NOW).map((b) => b.id).sort(), ['within30only', 'within7'])
  })

  it('sorts recent (updatedAt desc), name (es collation) and oldest (createdAt asc)', () => {
    const boards = [
      board({ id: 'b', name: 'Bodega', updatedAt: new Date(NOW - DAY_MS).toISOString(), createdAt: new Date(NOW - 2 * DAY_MS).toISOString() }),
      board({ id: 'a', name: 'Almacén', updatedAt: new Date(NOW).toISOString(), createdAt: new Date(NOW - DAY_MS).toISOString() }),
    ]
    assert.deepEqual(applyBoardFilters(boards, { ...DEFAULT_FILTERS, sort: 'recent' }, NOW).map((x) => x.id), ['a', 'b'])
    assert.deepEqual(applyBoardFilters(boards, { ...DEFAULT_FILTERS, sort: 'name' }, NOW).map((x) => x.id), ['a', 'b'])
    assert.deepEqual(applyBoardFilters(boards, { ...DEFAULT_FILTERS, sort: 'oldest' }, NOW).map((x) => x.id), ['b', 'a'])
  })

  it('leaves the given order untouched when sort is null', () => {
    const boards = [board({ id: 'z' }), board({ id: 'a' })]
    assert.deepEqual(applyBoardFilters(boards, { ...DEFAULT_FILTERS, sort: null }, NOW).map((x) => x.id), ['z', 'a'])
  })
})

describe('activeFilterCount', () => {
  it('is 0 for the defaults and counts templates/access/updated but not sort', () => {
    assert.equal(activeFilterCount(DEFAULT_FILTERS), 0)
    assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, sort: 'name' }), 0)
    assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, templates: ['plan'] }), 1)
    assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, templates: ['plan'], access: 'mine', updated: '7d' }), 3)
  })
})

describe('orderBySearch', () => {
  it('keeps only boards present in the results, in result order, attaching matches', () => {
    const boards = [board({ id: 'a' }), board({ id: 'b' }), board({ id: 'c' })]
    const results = [
      { boardId: 'c', score: 9, matches: [{ field: 'name', label: 'C', snippet: 'c' }] },
      { boardId: 'a', score: 3, matches: [] },
    ]
    const ordered = orderBySearch(boards, results)
    assert.deepEqual(ordered.map((b) => b.id), ['c', 'a'])
    assert.deepEqual(ordered[0].matches, results[0].matches)
  })

  it('drops results whose board is not in the given list', () => {
    const boards = [board({ id: 'a' })]
    assert.deepEqual(orderBySearch(boards, [{ boardId: 'missing', matches: [] }]), [])
  })
})
