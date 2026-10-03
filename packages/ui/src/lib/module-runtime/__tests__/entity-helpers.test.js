import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildListUrl, entityApiPath, extractBlueprintFields, findEntityBlueprint, listModuleEntities } from '../entity-helpers.js'

const BLUEPRINTS = [
  { key: 'visitas.visita.table', kind: 'TABLE', schema: { entity: 'visita', apiPath: '/visitas/visitas/', title: 'Visitas' } },
  { key: 'visitas.visita.form', kind: 'FORM', schema: { entity: 'visita', apiPath: '/visitas/visitas', sections: [{ label: 'Visita' }] } },
  { key: 'visitas.sucursal.form', kind: 'FORM', schema: { entity: 'sucursal', apiPath: '/visitas/sucursals', sections: [{ label: 'Sucursal' }] } },
  { key: 'visitas.panel', kind: 'CUSTOM', schema: { path: '/app/m/custom.visitas/panel' } },
]

describe('module runtime entity helpers', () => {
  it('finds an entity blueprint by kind', () => {
    assert.equal(findEntityBlueprint(BLUEPRINTS, 'form', 'visita').key, 'visitas.visita.form')
    assert.equal(findEntityBlueprint(BLUEPRINTS, 'DETAIL', 'visita'), null)
  })

  it('resolves the API path without a trailing slash, from any view', () => {
    assert.equal(entityApiPath(BLUEPRINTS, 'visita'), '/visitas/visitas')
    assert.equal(entityApiPath(BLUEPRINTS, 'sucursal'), '/visitas/sucursals')
    assert.equal(entityApiPath(BLUEPRINTS, 'otra'), null)
  })

  it('lists the module entities with labels', () => {
    assert.deepEqual(listModuleEntities(BLUEPRINTS), [
      { name: 'visita', apiPath: '/visitas/visitas', label: 'Visitas' },
      { name: 'sucursal', apiPath: '/visitas/sucursals', label: 'Sucursal' },
    ])
  })

  it('builds list URLs skipping empty filters', () => {
    assert.equal(
      buildListUrl('http://api/', '/visitas/visitas', { page: 2, pageSize: 50, search: 'ana', filters: { estado: 'PROGRAMADA', sucursal: '' } }),
      'http://api/visitas/visitas?page=2&pageSize=50&search=ana&estado=PROGRAMADA',
    )
  })
})

describe('extractBlueprintFields', () => {
  it('collects section fields with FORM types winning over defaults', () => {
    const fields = extractBlueprintFields(
      { schema: { sections: [{ fields: [{ field: 'notas' }] }] } },
      { schema: { sections: [{ fields: [{ field: 'notas', label: 'Notas', type: 'markdown' }, { field: 'estado', type: 'select', options: ['A'] }] }] } },
      null,
    )
    assert.deepEqual(fields, [
      { name: 'notas', label: 'notas', type: 'markdown', options: null },
      { name: 'estado', label: 'estado', type: 'select', options: ['A'] },
    ])
  })
})
