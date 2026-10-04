import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConnection, validateConnections, validateConnectionsAgainstModels } from '@runly/module-engine'
import { compileModule, validateModuleDefinition } from '../index.js'
import { manifestConnections } from '../connections.js'

const BASE = {
  schemaVersion: 1,
  key: 'custom.calibraciones',
  name: 'Calibraciones',
  version: '1.0.0',
  icon: 'Wrench',
  color: '#2563EB',
  pwa: { shortName: 'Calibra', startPath: '/calibraciones' },
  entities: [
    { key: 'calibracion', label: 'Calibración', pluralLabel: 'Calibraciones', fields: [
      { key: 'articulo', type: 'relation', label: 'Artículo', targetExternal: 'inventory_item', required: true },
      { key: 'certificado', type: 'text', label: 'Certificado', required: true },
      { key: 'adjunto', type: 'file', label: 'Adjunto' },
    ] },
  ],
  connections: [
    { key: 'calibracion_item', target: 'inventory_item', kind: 'fields', entity: 'calibracion', targetField: 'articulo',
      label: 'Calibración', fields: [{ field: 'certificado', form: true, detail: true, search: true }] },
  ],
}

const codes = (definition) => validateModuleDefinition(definition).errors.map((error) => error.code)

test('valid Builder connection compiles into the manifest contract', () => {
  assert.deepEqual(codes(structuredClone(BASE)), [])
  const manifest = compileModule(structuredClone(BASE)).files.find((file) => file.path === 'module.manifest.js').content
  assert.match(manifest, /connections: \[/)
  assert.match(manifest, /"targetField": "articulo"/)
  assert.match(manifest, /\{"key":"runly.inventory"\}/)
  const emitted = manifestConnections(BASE)
  const errors = []
  validateConnections({ connections: emitted }, errors)
  assert.deepEqual(errors, [])
  assert.deepEqual(emitted[0].fields[0], { field: 'certificado', form: true, detail: true, column: false, search: true })
  const model = { key: 'calibracion', fields: BASE.entities[0].fields.map((field) => ({ ...field, name: field.key })) }
  assert.deepEqual(validateConnectionsAgainstModels(emitted.map(normalizeConnection), [model]), [])
})

test('Builder connection diagnostics', () => {
  const bad = structuredClone(BASE)
  bad.connections.push({ key: 'prestamo', target: 'vehicle', kind: 'related', entity: 'calibracion', targetField: 'certificado',
    label: 'Préstamos', fields: [{ field: 'adjunto', detail: true }, { field: 'fantasma', detail: true }] })
  const found = codes(bad)
  for (const code of ['CONNECTION_TARGET_UNSUPPORTED', 'CONNECTION_TARGET_FIELD_INVALID', 'CONNECTION_FIELD_TYPE_UNSUPPORTED', 'CONNECTION_FIELD_NOT_FOUND']) {
    assert.ok(found.includes(code), `${code} expected in ${found}`)
  }
  const setNull = structuredClone(BASE)
  Object.assign(setNull.connections[0], { kind: 'related', onTargetDelete: 'setNull' })
  assert.ok(codes(setNull).includes('CONNECTION_SET_NULL_REQUIRED'))
  const shape = structuredClone(BASE)
  shape.connections[0].fields = []
  assert.ok(codes(shape).includes('CONNECTION_INVALID'))
})
