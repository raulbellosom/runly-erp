import test from 'node:test'
import assert from 'node:assert/strict'
import { compileModule } from '../index.js'

const BASE = {
  schemaVersion: 1,
  key: 'custom.agenda',
  name: 'Agenda',
  version: '1.0.0',
  icon: 'Calendar',
  color: '#2563EB',
  pwa: { shortName: 'Agenda', startPath: '/citas' },
  entities: [{
    key: 'cita', label: 'Cita', pluralLabel: 'Citas',
    fields: [
      { key: 'nombre', type: 'text', label: 'Nombre', required: true },
      { key: 'fecha', type: 'date', label: 'Fecha' },
      { key: 'monto', type: 'decimal', label: 'Monto' },
      { key: 'foto', type: 'file', label: 'Foto' },
      { key: 'estado', type: 'select', label: 'Estado', options: [{ value: 'NEW', label: 'Nueva' }, { value: 'DONE', label: 'Hecha' }] },
    ],
  }],
}

test('compiles the four records view kinds into manifest-listed defineView files', () => {
  const definition = structuredClone(BASE)
  definition.views = [
    { key: 'agenda.cita.cards', kind: 'CARDS', entity: 'cita', title: 'Galería', card: { titleField: 'nombre', imageField: 'foto', badgeField: 'estado' } },
    { key: 'agenda.cita.calendar', kind: 'CALENDAR', entity: 'cita', title: 'Calendario', dateField: 'fecha', titleField: 'nombre', colorField: 'estado' },
    { key: 'agenda.cita.timeline', kind: 'TIMELINE', entity: 'cita', title: 'Historial', dateField: 'created_at', titleField: 'nombre' },
    { key: 'agenda.cita.report', kind: 'REPORT', entity: 'cita', title: 'Por estado', groupBy: 'estado', measures: [{ key: 'total', label: 'Citas', aggregate: 'count' }, { key: 'monto', label: 'Monto', aggregate: 'sum', field: 'monto' }] },
  ]
  const compiled = compileModule(definition)
  const manifest = compiled.files.find((file) => file.path === 'module.manifest.js').content
  for (const leaf of ['cards', 'calendar', 'timeline', 'report']) {
    const file = compiled.files.find((item) => item.path === `views/cita.${leaf}.js`)
    assert.ok(file, `missing views/cita.${leaf}.js`)
    assert.match(manifest, new RegExp(`\./views/cita\.${leaf}\.js`))
  }
  const calendar = compiled.definition.views.find((view) => view.kind === 'CALENDAR')
  assert.equal(calendar.schema.path, '/app/m/custom.agenda/cita-calendar')
  assert.equal(compileModule(structuredClone(definition)).packageHash, compiled.packageHash)
})

test('rejects wrong field types and unknown fields in records views', () => {
  const definition = structuredClone(BASE)
  definition.views = [
    { key: 'agenda.cita.calendar', kind: 'CALENDAR', entity: 'cita', title: 'Cal', dateField: 'nombre', titleField: 'nope' },
    { key: 'agenda.cita.report', kind: 'REPORT', entity: 'cita', title: 'R', groupBy: 'estado', measures: [{ key: 'm', label: 'M', aggregate: 'sum', field: 'nombre' }] },
    { key: 'agenda.cita.cards', kind: 'CARDS', entity: 'cita', title: 'G', card: { titleField: 'nombre', imageField: 'nombre' } },
  ]
  assert.throws(() => compileModule(definition), (error) => {
    const codes = error.diagnostics.errors.map((item) => item.code)
    return codes.filter((code) => code === 'INVALID_FIELD_TYPE').length === 3 && codes.includes('UNKNOWN_FIELD')
  })
})
