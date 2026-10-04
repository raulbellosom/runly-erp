import test from 'node:test'
import assert from 'node:assert/strict'
import { defineModel, normalizeModelSchema } from '@runly/module-engine'
import { assignFieldIds, compileModule, uuidv7 } from '../index.js'

const BASE = {
  schemaVersion: 1, key: 'custom.flota', name: 'Flota', version: '1.0.0', icon: 'Truck', color: '#2563EB',
  pwa: { shortName: 'Flota', startPath: '/flota' },
  entities: [{ key: 'vehiculo', label: 'Vehículo', fields: [{ key: 'placa', type: 'text', label: 'Placa' }] }],
}

test('uuidv7 has the v7 layout and is time ordered', () => {
  const a = uuidv7(1_700_000_000_000)
  const b = uuidv7(1_700_000_000_001)
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.ok(a < b)
})

test('assignFieldIds fills missing ids once and the model carries them', () => {
  const { definition, changed } = assignFieldIds(structuredClone(BASE))
  assert.equal(changed, true)
  const fieldId = definition.entities[0].fields[0].fieldId
  assert.equal(assignFieldIds(definition).changed, false)
  const source = compileModule(definition).files.find((file) => file.path === 'models/vehiculo.model.js').content
  assert.match(source, new RegExp(`id: '${fieldId}'`))
  assert.doesNotMatch(compileModule(structuredClone(BASE)).files.find((file) => file.path === 'models/vehiculo.model.js').content, /id: '/)
  const model = defineModel({ key: 'vehiculo', tableName: 'flota_vehiculo', fields: [{ id: fieldId, name: 'placa', type: 'text' }] })
  assert.equal(normalizeModelSchema(model).columns.find((column) => column.name === 'placa').fieldId, fieldId)
})

test('assignFieldIds reuses ids of earlier definitions by entity and field key', () => {
  const published = assignFieldIds(structuredClone(BASE)).definition
  const staleDraft = structuredClone(BASE)
  staleDraft.entities[0].fields.push({ key: 'color', type: 'text', label: 'Color' })
  const { definition } = assignFieldIds(staleDraft, [published])
  assert.equal(definition.entities[0].fields[0].fieldId, published.entities[0].fields[0].fieldId)
  assert.match(definition.entities[0].fields[1].fieldId, /^[0-9a-f-]{36}$/)
})
