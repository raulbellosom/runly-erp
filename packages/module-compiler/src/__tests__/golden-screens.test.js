import assert from 'node:assert/strict'
import { test } from 'node:test'
import esbuild from 'esbuild'
import { normalizeModuleDefinition } from '../definition.js'
import { goldenScreenFiles } from '../templates/golden-screens.js'
import { reviewComponentSources } from '../design-review.js'
import { isDeveloperDocPath } from '../developer-docs.js'

const DEFINITION = normalizeModuleDefinition({
  schemaVersion: 1,
  key: 'custom.visitas',
  name: 'Visitas',
  version: '1.0.0',
  entities: [{
    key: 'visita', label: 'Visita', pluralLabel: 'Visitas',
    fields: [
      { key: 'nombre', type: 'text', label: 'Nombre "principal"', required: true },
      { key: 'estado', type: 'select', label: 'Estado', options: [{ value: 'PROGRAMADA', label: 'Programada' }, { value: 'REALIZADA', label: 'Realizada' }] },
      { key: 'fecha', type: 'date', label: 'Fecha' },
      { key: 'monto', type: 'decimal', label: 'Monto' },
      { key: 'pagada', type: 'boolean', label: 'Pagada' },
      { key: 'correo', type: 'email', label: 'Correo' },
      { key: 'notas', type: 'textarea', label: 'Notas' },
    ],
  }],
})

test('golden screens: four kit-based screens + LEEME for the first entity', () => {
  const files = goldenScreenFiles(DEFINITION)
  assert.deepEqual(files.map((f) => f.path), [
    'docs/ejemplos/LEEME.md', 'docs/ejemplos/Listado.jsx', 'docs/ejemplos/Detalle.jsx', 'docs/ejemplos/Formulario.jsx', 'docs/ejemplos/Tablero.jsx',
  ])
  for (const file of files.filter((f) => f.path.endsWith('.jsx'))) {
    assert.match(file.content, /ModulePage/, file.path)
    assert.ok(isDeveloperDocPath(file.path), `${file.path} must be ignored on upload`)
  }
  assert.match(files.find((f) => f.path.endsWith('Formulario.jsx')).content, /SelectField[\s\S]*DatePickerField|DatePickerField[\s\S]*SelectField/)
})

test('golden screens follow the design rules and compile', async () => {
  const files = goldenScreenFiles(DEFINITION).filter((f) => f.path.endsWith('.jsx'))
  const asComponents = files.map((f) => ({ ...f, path: f.path.replace('docs/ejemplos/', 'components/') }))
  assert.deepEqual(reviewComponentSources(asComponents), [])
  for (const file of files) {
    await esbuild.transform(file.content, { loader: 'jsx', jsx: 'automatic', format: 'esm' })
  }
})

test('golden screens: no entity, no files', () => {
  assert.deepEqual(goldenScreenFiles({ entities: [] }), [])
})
