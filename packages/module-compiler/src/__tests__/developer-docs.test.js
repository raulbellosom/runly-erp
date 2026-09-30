import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildDeveloperDocs } from '../../../../scripts/generate-module-developer-docs.mjs'
import { classifyModulePackage, compileModule, developerDocFiles } from '../index.js'

const snapshot = JSON.parse(readFileSync(new URL('../developer-docs.json', import.meta.url), 'utf8'))

test('developer docs snapshot matches docs/developers (run scripts/generate-module-developer-docs.mjs)', () => {
  assert.deepEqual(snapshot, buildDeveloperDocs())
})

test('offline docs link to sibling files, not to site-relative runly.mx paths', () => {
  for (const file of developerDocFiles()) {
    assert.doesNotMatch(file.content, /\]\(\/documentacion\//, file.path)
  }
})

test('a re-uploaded download with docs/ stays in visual mode', () => {
  const compiled = compileModule({
    schemaVersion: 1, key: 'custom.visitas', name: 'Visitas', version: '1.0.0', icon: 'Users', color: '#2563EB',
    pwa: { shortName: 'Visitas', startPath: '/visitas' },
    entities: [{ key: 'visita', label: 'Visita', pluralLabel: 'Visitas', fields: [{ key: 'nombre', type: 'text', label: 'Nombre' }] }],
  })
  const text = compiled.files.find((file) => file.path === 'module.manifest.js').content
  const list = (name) => [...text.slice(text.indexOf(`${name}: [`)).split(']')[0].matchAll(/['"](\.\/[^'"]+)['"]/g)].map((match) => match[1])
  const manifest = { views: list('views'), models: list('models'), permissions: [...text.matchAll(/\{ key: '([^']+)'/g)].map((match) => ({ key: match[1] })), navigation: [] }
  const edited = developerDocFiles().map((file) => ({ ...file, content: `${file.content}\nNota local.\n` }))
  const result = classifyModulePackage({ key: 'custom.visitas', files: [...compiled.files, ...edited], manifest })
  assert.equal(result.managed, true)
  assert.deepEqual(result.foreign.filter((item) => item.path.startsWith('docs/')), [])
})

test('AGENTS.md points assistants at the bundled docs first', () => {
  const compiled = compileModule({
    schemaVersion: 1, key: 'custom.visitas', name: 'Visitas', version: '1.0.0', icon: 'Users', color: '#2563EB',
    pwa: { shortName: 'Visitas', startPath: '/visitas' },
    entities: [{ key: 'visita', label: 'Visita', pluralLabel: 'Visitas', fields: [{ key: 'nombre', type: 'text', label: 'Nombre' }] }],
  })
  const agents = compiled.files.find((file) => file.path === 'AGENTS.md').content
  assert.match(agents, /docs\/index\.md/)
  assert.match(agents, /no necesitas internet/)
})
