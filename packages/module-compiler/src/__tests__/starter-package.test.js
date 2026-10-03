import assert from 'node:assert/strict'
import { test } from 'node:test'
import JSZip from 'jszip'
import { buildStarterPackage, StarterPackageError } from '../starter-package.js'
import { reviewComponentSources } from '../design-review.js'

test('starter package: installable module + guide, AGENTS, docs and golden screens', async () => {
  const { buffer, filename, files } = await buildStarterPackage({ key: 'custom.visitas', name: 'Visitas' })
  assert.equal(filename, 'custom.visitas-paquete-base.zip')
  for (const path of ['module.manifest.js', 'models/registro.model.js', 'api/index.js', 'validators/index.js', 'components/index.js',
    'GUIA_DESARROLLO_RUNLY.md', 'AGENTS.md', 'docs/index.md', 'docs/componentes.md', 'docs/ejemplos/Listado.jsx']) {
    assert.ok(files.includes(path), `missing ${path}`)
  }
  const zip = await JSZip.loadAsync(buffer)
  const manifest = await zip.file('module.manifest.js').async('string')
  assert.match(manifest, /key: 'custom\.visitas'/)
  const components = await Promise.all(Object.keys(zip.files).filter((p) => /^components\/.+\.jsx?$/.test(p))
    .map(async (path) => ({ path, content: await zip.file(path).async('string') })))
  assert.deepEqual(reviewComponentSources(components).filter((f) => f.severity === 'error'), [])
})

test('starter package rejects keys that are not custom.<name>', async () => {
  for (const key of ['visitas', 'custom.Visitas', 'custom.mi-modulo', 'runly.visitas']) {
    await assert.rejects(buildStarterPackage({ key, name: 'X' }), StarterPackageError, key)
  }
})
