import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matches, buildArgs, render } from '../automation-runtime.js'

test('portable automation rules keep condition, interpolation, array and idempotency semantics', () => {
  assert.equal(matches({ field: 'name', op: 'changed' }, { name: 'B' }, { name: 'A' }), true)
  assert.equal(matches({ field: 'name', op: 'changed' }, { name: 'B' }), false)
  assert.equal(matches({ field: 'name', op: 'filled' }, { name: '' }), false)
  assert.equal(matches({ field: 'state', op: 'equals', value: '1' }, { state: 1 }), true)
  assert.equal(render('Hola {{name}} {{missing}}', { name: 'Fixture' }), 'Hola Fixture ')
  const automation = { action: { args: { userIds: { from: 'actor' }, title: { from: 'template', template: '{{name}}' }, empty: { from: 'field', field: 'missing' } } }, runtime: { arrayArgs: ['userIds'], acceptsSource: true } }
  assert.deepEqual(buildArgs(automation, { data: { name: 'Fixture' }, actorId: 'actor', recordId: 'record', idempotencyKey: 'key' }), { userIds: ['actor'], title: 'Fixture', sourceEntityId: 'record', idempotencyKey: 'key' })
})
