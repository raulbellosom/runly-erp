import test from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest } from '../define-module.js'

const base = { key: 'custom.fleet', name: 'Flotilla', version: '0.1.0', icon: 'Truck', color: '#2563eb', pwa: { shortName: 'Flotilla', startPath: '/fleet' } }

test('ai.publicLookup accepts descriptive fields and rejects identifying ones', () => {
  assert.equal(validateManifest({ ...base, ai: { publicLookup: [{ model: 'vehicles', publicFields: ['make', 'model', 'year'], topics: ['ficha tecnica'] }] } }).valid, true)
  const { valid, errors } = validateManifest({ ...base, ai: { publicLookup: [{ model: 'vehicles', publicFields: ['make', 'plate', 'vin'] }] } })
  assert.equal(valid, false)
  assert.ok(errors.some(e => e.includes('"plate"')) && errors.some(e => e.includes('"vin"')))
  assert.equal(validateManifest({ ...base, ai: { publicLookup: [{ model: 'vehicles', publicFields: [] }] } }).valid, false)
})
