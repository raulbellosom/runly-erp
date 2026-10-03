import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeConnection, validateConnections, validateConnectionsAgainstModels } from '../manifest-connections.js'

const FIELDS_CONNECTION = {
  key: 'calibracion_item', target: 'inventory_item', kind: 'fields', entity: 'calibracion', targetField: 'articulo',
  label: 'Calibración', fields: [{ field: 'certificado', detail: true, search: true }, { field: 'fecha', form: true, detail: true }],
}
const RELATED_CONNECTION = {
  key: 'prestamo_contacto', target: 'contact', kind: 'related', entity: 'prestamo', targetField: 'persona',
  label: 'Préstamos', onTargetDelete: 'restrict', fields: [{ field: 'estado', detail: true }],
}
const MODELS = [
  { key: 'calibracion', tableName: 'calib_calibracion', fields: [{ name: 'articulo', type: 'relation', required: true }, { name: 'certificado', type: 'text' }, { name: 'fecha', type: 'date' }] },
  { key: 'prestamo', tableName: 'calib_prestamo', fields: [{ name: 'persona', type: 'relation' }, { name: 'estado', type: 'select' }] },
]

const errorsOf = (connections) => { const errors = []; validateConnections({ connections }, errors); return errors }

describe('manifest connections', () => {
  it('accepts valid fields and related declarations', () => {
    assert.deepEqual(errorsOf([FIELDS_CONNECTION, RELATED_CONNECTION]), [])
    assert.deepEqual(errorsOf(undefined), [])
  })

  it('rejects bad shapes with precise messages', () => {
    const errors = errorsOf([
      { ...FIELDS_CONNECTION, kind: 'other' },
      { ...FIELDS_CONNECTION, key: 'calibracion_item', onTargetDelete: 'restrict' },
      { ...RELATED_CONNECTION, onTargetDelete: 'drop', fields: [] },
      { ...RELATED_CONNECTION, key: 'x2', fields: [{ field: 'persona' }, { field: 'estado', form: 'yes' }] },
    ])
    assert.ok(errors.some((e) => e.includes('connections[0].kind')))
    assert.ok(errors.some((e) => e.includes('connections[1].key "calibracion_item" is duplicated')))
    assert.ok(errors.some((e) => e.includes('connections[1].onTargetDelete only applies to related')))
    assert.ok(errors.some((e) => e.includes('connections[2].onTargetDelete must be one of')))
    assert.ok(errors.some((e) => e.includes('connections[2].fields must offer at least one field')))
    assert.ok(errors.some((e) => e.includes('connections[3].fields[0].field cannot be the targetField')))
    assert.ok(errors.some((e) => e.includes('connections[3].fields[1].form must be a boolean')))
  })

  it('normalizes defaults: surfaces off, fields cascade, related setNull', () => {
    const fields = normalizeConnection(FIELDS_CONNECTION)
    assert.equal(fields.onTargetDelete, 'cascade')
    assert.deepEqual(fields.fields[0], { field: 'certificado', form: false, detail: true, column: false, search: true })
    assert.equal(normalizeConnection({ ...RELATED_CONNECTION, onTargetDelete: undefined }).onTargetDelete, 'setNull')
  })

  it('validates against the module models', () => {
    const ok = [FIELDS_CONNECTION, RELATED_CONNECTION].map(normalizeConnection)
    assert.deepEqual(validateConnectionsAgainstModels(ok, MODELS), [])
    const bad = validateConnectionsAgainstModels([
      normalizeConnection({ ...FIELDS_CONNECTION, entity: 'nope' }),
      normalizeConnection({ ...FIELDS_CONNECTION, key: 'b', targetField: 'certificado' }),
      normalizeConnection({ ...RELATED_CONNECTION, key: 'c', fields: [{ field: 'ghost' }] }),
      normalizeConnection({ ...FIELDS_CONNECTION, key: 'd', kind: 'related', onTargetDelete: 'setNull' }),
    ], MODELS)
    assert.equal(bad.length, 4)
    assert.match(bad[0], /entity "nope"/)
    assert.match(bad[1], /must be a relation field/)
    assert.match(bad[2], /offered field "ghost"/)
    assert.match(bad[3], /needs an optional targetField/)
  })
})
