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
  assert.match(guide, /### Visita \(`visita`\)/)
  assert.match(guide, /\| Nombre \| `nombre` \| `text` \|/)
  assert.match(guide, /runly\.mx\/llms\.txt/)
  const agents = compiled.files.find((file) => file.path === 'AGENTS.md')?.content
  assert.match(agents, /custom\.visitas:<Componente>/)
  assert.match(agents, /runly\.mx\/documentacion\/desarrolladores/)
  assert.match(guide, /### Enlaces y páginas públicas/)
  assert.match(guide, /todavía no tiene páginas públicas/)
  assert.match(agents, /publicResources/)
})

test('the developer guide lists the public links the Builder generates', () => {
  const compiled = compileModule({
    schemaVersion: 1, key: 'custom.visitas', name: 'Visitas', version: '1.0.0', icon: 'Users', color: '#2563EB',
    pwa: { shortName: 'Visitas', startPath: '/visitas' },
    entities: [{ key: 'visita', label: 'Visita', pluralLabel: 'Visitas', fields: [{ key: 'nombre', type: 'text', label: 'Nombre' }] }],
    publicLinks: [{ key: 'ficha', entity: 'visita', mode: 'view', title: 'Ficha de visita', fields: ['nombre'] }],
  })
  const guide = compiled.files.find((file) => file.path === 'GUIA_DESARROLLO_RUNLY.md')?.content
  assert.match(guide, /\| Ficha de visita \| `ficha` \| Ficha \| `visita` \|/)
  assert.match(guide, /desarrolladores\/enlaces-publicos/)
})
