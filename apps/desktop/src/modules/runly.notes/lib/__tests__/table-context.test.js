import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isInsideTableCell } from '../tableContext.js'

// Minimal fake of a ProseMirror doc.resolve() result — isInsideTableCell
// only calls .depth and .node(d).
function fakePos(nodesAtDepth) {
  return {
    depth: nodesAtDepth.length - 1,
    node: (d) => nodesAtDepth[d],
  }
}

test('isInsideTableCell: true when a tableCell ancestor exists', () => {
  const docNode = { type: { name: 'doc' } }
  const tableNode = { type: { name: 'table' } }
  const cellNode = { type: { name: 'tableCell' } }
  const paragraphNode = { type: { name: 'paragraph' } }
  const $pos = fakePos([docNode, tableNode, cellNode, paragraphNode])
  const state = { doc: { resolve: () => $pos } }
  assert.equal(isInsideTableCell(state, 0), true)
})

test('isInsideTableCell: true when the ancestor is a tableHeader instead', () => {
  const docNode = { type: { name: 'doc' } }
  const tableNode = { type: { name: 'table' } }
  const headerNode = { type: { name: 'tableHeader' } }
  const $pos = fakePos([docNode, tableNode, headerNode])
  const state = { doc: { resolve: () => $pos } }
  assert.equal(isInsideTableCell(state, 0), true)
})

test('isInsideTableCell: false when there is no table ancestor at all', () => {
  const docNode = { type: { name: 'doc' } }
  const paragraphNode = { type: { name: 'paragraph' } }
  const $pos = fakePos([docNode, paragraphNode])
  const state = { doc: { resolve: () => $pos } }
  assert.equal(isInsideTableCell(state, 0), false)
})

test('isInsideTableCell: false (not a crash) when resolve() throws for a stale/out-of-range position', () => {
  const state = {
    doc: {
      resolve: () => {
        throw new RangeError('Position 384 out of range')
      },
    },
  }
  assert.equal(isInsideTableCell(state, 384), false)
})
