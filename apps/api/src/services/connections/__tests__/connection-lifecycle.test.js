import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeConnection } from '@runly/module-engine'
import { ConnectionSyncError, createConnectionLifecycle, defaultFieldConfig, reconcileFieldConfig } from '../connection-lifecycle.js'

const CONNECTION = normalizeConnection({
  key: 'calib', target: 'inventory_item', kind: 'fields', entity: 'calibracion', targetField: 'articulo', label: 'Calibración',
  fields: [{ field: 'certificado', detail: true, search: true }, { field: 'fecha', form: true, detail: true, column: true }],
})
const MODELS = [{ key: 'calibracion', tableName: 'calib_calibracion', companyScoped: true, fields: [
  { name: 'articulo', type: 'relation', required: true }, { name: 'certificado', type: 'text' }, { name: 'fecha', type: 'date' },
] }]

describe('connection field config', () => {
  it('defaults to the offered surfaces in order', () => {
    assert.deepEqual(defaultFieldConfig(CONNECTION).map((f) => [f.field, f.order, f.detail]), [['certificado', 0, true], ['fecha', 1, true]])
  })

  it('keeps admin choices narrowed to what is offered, appends new fields, flags removed ones', () => {
    const current = [
      { field: 'fecha', form: false, detail: true, column: true, search: true, order: 0 }, // search not offered -> narrowed off
      { field: 'viejo', form: true, detail: true, order: 1 },                              // no longer offered -> dropped
    ]
    const { fieldConfig, needsReview } = reconcileFieldConfig(current, CONNECTION)
    assert.equal(needsReview, true)
    assert.deepEqual(fieldConfig.map((f) => f.field), ['fecha', 'certificado'])
    assert.equal(fieldConfig[0].search, false)
    assert.equal(fieldConfig[0].form, false)
    assert.equal(fieldConfig[0].column, true)
  })
})

describe('resolveDeclared', () => {
  const lifecycle = createConnectionLifecycle({ prisma: {} })

  it('resolves source/target tables and columns', () => {
    const [entry] = lifecycle.resolveDeclared('custom.calib', { connections: [CONNECTION] }, MODELS)
    assert.equal(entry.spec.sourceTable, 'calib_calibracion')
    assert.equal(entry.spec.targetTable, 'inv_item')
    assert.deepEqual(entry.spec.offeredColumns, ['certificado', 'fecha'])
    assert.deepEqual(entry.spec.searchColumns, ['certificado'])
  })

  it('collects every problem in one ConnectionSyncError', () => {
    assert.throws(
      () => lifecycle.resolveDeclared('custom.calib', { connections: [
        { ...CONNECTION, target: 'spaceship' },
        { ...CONNECTION, key: 'b', entity: 'ghost' },
      ] }, MODELS),
      (error) => error instanceof ConnectionSyncError && error.code === 'CONNECTION_INVALID' && error.details.length === 2,
    )
  })

  it('no connections declared resolves to nothing', () => {
    assert.deepEqual(lifecycle.resolveDeclared('custom.x', {}, MODELS), [])
  })
})
