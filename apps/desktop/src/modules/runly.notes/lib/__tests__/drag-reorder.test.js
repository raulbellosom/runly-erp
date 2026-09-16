import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeShiftMap, exceedsDragThreshold, DRAG_THRESHOLD_PX, findTableAtSelection,
  groupIntoRows, pickDropIndex,
} from '../dragReorder.js'

// 6 blocks at indices 0-5, offsets deliberately uneven (not equal to index)
// so a bug that confuses "array index" with "ProseMirror offset" would fail.
const BLOCK_RECTS = [
  { offset: 0, top: 0, height: 20 },
  { offset: 10, top: 20, height: 20 },
  { offset: 20, top: 40, height: 20 },
  { offset: 30, top: 60, height: 20 },
  { offset: 40, top: 80, height: 20 },
  { offset: 50, top: 100, height: 20 },
]

test('computeShiftMap: dragging down shifts only the blocks strictly between original and candidate', () => {
  const map = computeShiftMap({ blockRects: BLOCK_RECTS, originalIndex: 1, candidateIndex: 4, draggedHeightPx: 100 })
  assert.deepEqual([...map.entries()], [
    [0, 0], [10, 0], [20, -100], [30, -100], [40, 0], [50, 0],
  ])
})

test('computeShiftMap: dragging up shifts only the blocks strictly between candidate and original', () => {
  const map = computeShiftMap({ blockRects: BLOCK_RECTS, originalIndex: 4, candidateIndex: 1, draggedHeightPx: 50 })
  assert.deepEqual([...map.entries()], [
    [0, 0], [10, 50], [20, 50], [30, 50], [40, 0], [50, 0],
  ])
})

test('computeShiftMap: candidate equal to original is a no-op (all zero)', () => {
  const map = computeShiftMap({ blockRects: BLOCK_RECTS, originalIndex: 2, candidateIndex: 2, draggedHeightPx: 100 })
  assert.deepEqual([...map.values()], [0, 0, 0, 0, 0, 0])
})

test('computeShiftMap: candidate immediately after original is a no-op (adjacent swap-with-self)', () => {
  const map = computeShiftMap({ blockRects: BLOCK_RECTS, originalIndex: 1, candidateIndex: 2, draggedHeightPx: 100 })
  assert.deepEqual([...map.values()], [0, 0, 0, 0, 0, 0])
})

test('computeShiftMap: dropping past the last block shifts everything after the original up to the end', () => {
  const map = computeShiftMap({ blockRects: BLOCK_RECTS, originalIndex: 1, candidateIndex: BLOCK_RECTS.length, draggedHeightPx: 30 })
  assert.deepEqual([...map.entries()], [
    [0, 0], [10, 0], [20, -30], [30, -30], [40, -30], [50, -30],
  ])
})

test('exceedsDragThreshold: false at and below the threshold, true above it', () => {
  assert.equal(exceedsDragThreshold(DRAG_THRESHOLD_PX), false)
  assert.equal(exceedsDragThreshold(DRAG_THRESHOLD_PX - 1), false)
  assert.equal(exceedsDragThreshold(DRAG_THRESHOLD_PX + 1), true)
})

// Minimal fake of a ProseMirror ResolvedPos — findTableAtSelection only
// calls .depth, .node(d), and .before(d).
function fakePos(nodesAtDepth) {
  return {
    depth: nodesAtDepth.length - 1,
    node: (d) => nodesAtDepth[d],
    before: (d) => d * 100,
  }
}

test('findTableAtSelection: finds the table when the selection is nested inside it (e.g. in a cell)', () => {
  const docNode = { type: { name: 'doc' } }
  const tableNode = { type: { name: 'table' } }
  const cellNode = { type: { name: 'tableCell' } }
  const paragraphNode = { type: { name: 'paragraph' } }
  const $from = fakePos([docNode, tableNode, cellNode, paragraphNode])
  const result = findTableAtSelection({ selection: { $from } })
  assert.equal(result.pos, 100)
  assert.equal(result.node, tableNode)
})

test('findTableAtSelection: returns null when the selection is not inside a table', () => {
  const docNode = { type: { name: 'doc' } }
  const paragraphNode = { type: { name: 'paragraph' } }
  const $from = fakePos([docNode, paragraphNode])
  assert.equal(findTableAtSelection({ selection: { $from } }), null)
})

test('groupIntoRows: blocks that do not vertically overlap each stay in their own row', () => {
  const rects = [
    { offset: 0, top: 0, bottom: 20, left: 0, width: 300 },
    { offset: 10, top: 20, bottom: 40, left: 0, width: 300 },
  ]
  const rows = groupIntoRows(rects)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].length, 1)
  assert.equal(rows[1].length, 1)
})

test('groupIntoRows: two blocks with overlapping vertical ranges (floated side by side) group into one row', () => {
  const rects = [
    { offset: 0, top: 0, bottom: 100, left: 0, width: 150 },
    { offset: 10, top: 0, bottom: 100, left: 150, width: 150 },
  ]
  const rows = groupIntoRows(rects)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].length, 2)
})

test('pickDropIndex: single-column stacking still uses the top/bottom-half rule per block', () => {
  const rects = [
    { offset: 0, top: 0, bottom: 20, left: 0, width: 300 },
    { offset: 10, top: 20, bottom: 40, left: 0, width: 300 },
  ]
  assert.equal(pickDropIndex(rects, 150, 22), 1)
  assert.equal(pickDropIndex(rects, 150, 38), 2)
  assert.equal(pickDropIndex(rects, 150, 2), 0)
})

test('pickDropIndex: two floated blocks side by side use clientX to decide between/around them', () => {
  const rects = [
    { offset: 0, top: 0, bottom: 100, left: 0, width: 150 },
    { offset: 10, top: 0, bottom: 100, left: 150, width: 150 },
  ]
  assert.equal(pickDropIndex(rects, 50, 50), 0)
  assert.equal(pickDropIndex(rects, 200, 50), 1)
  assert.equal(pickDropIndex(rects, 280, 50), 2)
})

test('pickDropIndex: pointer below every row inserts at the very end', () => {
  const rects = [
    { offset: 0, top: 0, bottom: 20, left: 0, width: 300 },
  ]
  assert.equal(pickDropIndex(rects, 150, 500), 1)
})
