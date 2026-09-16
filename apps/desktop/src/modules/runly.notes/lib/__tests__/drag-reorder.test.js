import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeShiftMap, exceedsDragThreshold, DRAG_THRESHOLD_PX } from '../dragReorder.js'

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
