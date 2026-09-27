import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { compileModule, archiveModule } from '../index.js'

const DEFINITION = {
  schemaVersion: 1,
  key: 'custom.archivefixture',
  name: 'Archive Fixture',
  version: '1.0.0',
  description: 'Fixture para el ZIP writer',
  icon: 'Truck',
  color: '#2563EB',
  pwa: { shortName: 'Archive', startPath: '/archive' },
  entities: [{
    key: 'thing',
    label: 'Cosa',
    pluralLabel: 'Cosas',
    fields: [{ key: 'title', label: 'Título', type: 'text', required: true }],
  }],
}

test('archiveModule: same CompiledModule produces byte-identical ZIP bytes across runs', async () => {
  const compiled = compileModule(DEFINITION)
  const first = await archiveModule(compiled)
  const second = await archiveModule(compiled)
  assert.ok(first.equals(second))
})

test('archiveModule: ZIP contains every compiled file at its exact path with matching content, flat at the archive root', async () => {
  const compiled = compileModule(DEFINITION)
  const buffer = await archiveModule(compiled)
  const zip = await JSZip.loadAsync(buffer)
  const zipPaths = Object.keys(zip.files).sort()
  const compiledPaths = compiled.files.map((file) => file.path).sort()
  assert.deepEqual(zipPaths, compiledPaths)
  for (const file of compiled.files) {
    const content = await zip.file(file.path).async('string')
    assert.equal(content, file.content)
  }
})

test('archiveModule: recompiling the same normalized definition yields the same packageHash even though ZIP bytes are recomputed', async () => {
  const compiledA = compileModule(DEFINITION)
  const compiledB = compileModule(DEFINITION)
  assert.equal(compiledA.packageHash, compiledB.packageHash)
  const bufferA = await archiveModule(compiledA)
  const bufferB = await archiveModule(compiledB)
  assert.ok(bufferA.equals(bufferB))
})
