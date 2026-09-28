import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bulkUnitName, loadCapture, parseSerials, pinnedValues, saveCapture, DEFAULT_CAPTURE } from '../capture.js'

test('parseSerials splits on commas, spaces, semicolons and new lines and reports repeats', () => {
  assert.deepEqual(parseSerials('A1, A2;A3\nA4  A2,,A1'), { serials: ['A1', 'A2', 'A3', 'A4'], repeated: ['A2', 'A1'] })
  assert.deepEqual(parseSerials(''), { serials: [], repeated: [] })
})

test('pinnedValues keeps non-empty pinned fields and never serials or tags', () => {
  const values = { name: 'Laptop', modelId: 'm1', model: 'XPS', brandId: '', locationId: 'l1', serialNumber: 'S1' }
  assert.deepEqual(pinnedValues(values, ['modelId', 'model', 'brandId', 'serialNumber']), { modelId: 'm1', model: 'XPS' })
  assert.deepEqual(pinnedValues(values, []), {})
})

test('bulkUnitName appends the serial and stays within 255 chars', () => {
  assert.equal(bulkUnitName('Laptop Dell', 'ABC'), 'Laptop Dell · ABC')
  assert.equal(bulkUnitName('x'.repeat(300), 'S').length, 255)
})

test('capture settings round-trip and tolerate broken storage', () => {
  const memory = new Map()
  const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) }
  saveCapture('k', { pinned: ['locationId'], values: { locationId: 'l1' }, continuous: true, multi: false, pinMode: false }, storage)
  assert.deepEqual(loadCapture('k', storage), { pinned: ['locationId'], values: { locationId: 'l1' }, continuous: true, multi: false, pinMode: false })
  assert.deepEqual(loadCapture('k', { getItem: () => { throw new Error('blocked') } }), DEFAULT_CAPTURE)
  assert.deepEqual(loadCapture(null, storage), DEFAULT_CAPTURE)
})
