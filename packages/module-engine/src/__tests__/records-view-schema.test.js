import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRecordsViewSchema, defineView } from '../index.js'

const base = { title: 'Citas', path: '/app/m/custom.agenda/cita-calendar', entity: 'cita' }

test('valid schemas pass for every records view kind', () => {
  assert.equal(validateRecordsViewSchema('CARDS', { ...base, card: { titleField: 'nombre', imageField: 'foto' } }).valid, true)
  assert.equal(validateRecordsViewSchema('CALENDAR', { ...base, dateField: 'fecha', titleField: 'nombre' }).valid, true)
  assert.equal(validateRecordsViewSchema('TIMELINE', { ...base, dateField: 'fecha', titleField: 'nombre', badgeField: 'estado' }).valid, true)
  assert.equal(validateRecordsViewSchema('REPORT', { ...base, groupBy: 'estado', measures: [{ key: 'total', label: 'Total', aggregate: 'count' }, { key: 'monto', label: 'Monto', aggregate: 'sum', field: 'monto' }] }).valid, true)
})

test('rejects missing required fields, unsafe paths and data controls', () => {
  assert.equal(validateRecordsViewSchema('CALENDAR', { ...base, titleField: 'nombre' }).valid, false)
  assert.equal(validateRecordsViewSchema('CARDS', { ...base, path: '/app/m/other/../x', card: { titleField: 'a' } }).valid, false)
  assert.equal(validateRecordsViewSchema('CARDS', { ...base, card: { titleField: 'a' }, sql: 'select 1' }).valid, false)
  assert.equal(validateRecordsViewSchema('REPORT', { ...base, groupBy: 'estado', measures: [{ key: 'm', label: 'M', aggregate: 'sum' }] }).valid, false)
  assert.equal(validateRecordsViewSchema('REPORT', { ...base, groupBy: 'estado', measures: [{ key: 'm', label: 'M', aggregate: 'count' }, { key: 'm', label: 'N', aggregate: 'count' }] }).valid, false)
})

test('defineView accepts the new kinds', () => {
  assert.doesNotThrow(() => defineView({ key: 'agenda.cita.calendar', kind: 'CALENDAR', schema: { ...base, dateField: 'fecha', titleField: 'nombre' } }))
})
