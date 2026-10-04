import test from 'node:test'
import assert from 'node:assert/strict'
import { recordConnectionTarget } from '../connections/recordConnectionTarget.js'

test('maps published core records to connection targets', () => {
  assert.deepEqual(
    recordConnectionTarget('runly.projects', { recordType: 'project', recordId: 'p1' }),
    { targetType: 'project', targetId: 'p1' },
  )
  assert.deepEqual(
    recordConnectionTarget('runly.hr', { recordType: 'employee', recordId: 7 }),
    { targetType: 'hr_employee', targetId: '7' },
  )
})

test('ignores unknown types, selections and other modules', () => {
  assert.equal(recordConnectionTarget('runly.projects', { recordType: 'task', recordId: 't1' }), null)
  assert.equal(recordConnectionTarget('runly.inventory', { selection: { ids: [] } }), null)
  assert.equal(recordConnectionTarget('runly.notes', { recordType: 'item', recordId: 'x' }), null)
  assert.equal(recordConnectionTarget(null, null), null)
})
