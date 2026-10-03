import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeSelectOptions, withSelectColumnOptions } from '../table-select-columns.js'

test('select columns take type and options from the form blueprint', () => {
  const table = { key: 't', schema: { columns: [{ field: 'articulo' }, { field: 'estado', label: 'Estado' }] } }
  const form = { schema: { sections: [{ fields: [{ field: 'estado', type: 'select', options: ['PRESTADO', 'EN_REPARACION'] }] }] } }
  const result = withSelectColumnOptions(table, form)
  assert.deepEqual(result.schema.columns[1], {
    field: 'estado', label: 'Estado', type: 'select',
    options: [{ value: 'PRESTADO', label: 'Prestado' }, { value: 'EN_REPARACION', label: 'En reparacion' }],
  })
  assert.equal(result.schema.columns[0], table.schema.columns[0])
})

test('tables without select columns are returned unchanged', () => {
  const table = { schema: { columns: [{ field: 'fecha', type: 'date' }] } }
  assert.equal(withSelectColumnOptions(table, { schema: { fields: [{ field: 'fecha', type: 'select', options: ['A'] }] } }), table)
})

test('object options keep their label and color', () => {
  assert.deepEqual(normalizeSelectOptions([{ value: 'a', label: 'Abierto', color: '#10b981' }, { value: 'B' }]),
    [{ value: 'a', label: 'Abierto', color: '#10b981' }, { value: 'B', label: 'B' }])
})
