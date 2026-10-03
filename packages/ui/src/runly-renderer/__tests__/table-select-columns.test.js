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

test('detail views get relation labels, status pills, typed KPIs and select fields from the form', async () => {
  const { withDetailFieldTypes } = await import('../table-select-columns.js')
  const form = { schema: { sections: [{ fields: [
    { field: 'persona', type: 'relation' },
    { field: 'estado', type: 'select', options: ['PRESTADO', 'DEVUELTO'] },
    { field: 'fecha_salida', type: 'date' },
  ] }] } }
  const detail = { schema: {
    hero: { titleField: 'articulo', subtitleFields: ['persona'], statusField: 'estado' },
    kpis: [{ field: 'fecha_salida', label: 'Salida' }, { field: 'estado', label: 'Estado', type: 'text' }],
    sections: [{ id: 's', fields: [{ field: 'estado', label: 'Estado' }, { field: 'fecha_salida', type: 'date' }] }],
  } }
  const { schema } = withDetailFieldTypes(detail, form)
  assert.deepEqual(schema.hero.subtitleFields, ['persona__label'])
  assert.deepEqual(schema.hero.statusOptions.map((o) => o.label), ['Prestado', 'Devuelto'])
  assert.ok(schema.hero.statusOptions.every((o) => /^#/.test(o.color)))
  assert.equal(schema.kpis[0].type, 'date')
  assert.equal(schema.kpis[1].type, 'text')
  assert.equal(schema.sections[0].fields[0].type, 'select')
  assert.equal(schema.sections[0].fields[1], detail.schema.sections[0].fields[1])
})
