import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileModule } from '../index.js'

const catalog = JSON.parse(readFileSync(new URL('../runtime-catalog.json', import.meta.url), 'utf8'))

test('every package ships a personalized developer guide with real library versions', () => {
  const compiled = compileModule({
    schemaVersion: 1, key: 'custom.visitas', name: 'Visitas', version: '1.0.0', icon: 'Users', color: '#2563EB',
    pwa: { shortName: 'Visitas', startPath: '/visitas' },
    entities: [{ key: 'visita', label: 'Visita', pluralLabel: 'Visitas', fields: [{ key: 'nombre', type: 'text', label: 'Nombre' }] }],
  })
  const guide = compiled.files.find((file) => file.path === 'GUIA_DESARROLLO_RUNLY.md')?.content
  assert.ok(guide)
  assert.match(guide, /custom\.visitas:VisitasPanel/)
  assert.match(guide, /path: '\/app\/m\/custom\.visitas\/visitas-panel'/)
  assert.match(guide, /`PATCH \/visitas\/visitas\/:id\/enabled`/)
  const react = catalog.libraries.find((library) => library.name === 'react')
  assert.ok(guide.includes(`| \`react\` | ${react.version} |`))
})
