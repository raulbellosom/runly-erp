import test from 'node:test'
import assert from 'node:assert/strict'
import { moveKanbanRecord, recordsForColumn } from '../kanban-state.js'

test('groups null distinctly and updates one record optimistically without mutation', () => {
  const board = { records: [{ id: '1', status: null }, { id: '2', status: 'NEW' }] }
  assert.deepEqual(recordsForColumn(board.records, 'status', null).map((record) => record.id), ['1'])
  const moved = moveKanbanRecord(board, '1', 'status', 'NEW')
  assert.equal(board.records[0].status, null)
  assert.equal(moved.records[0].status, 'NEW')
})
