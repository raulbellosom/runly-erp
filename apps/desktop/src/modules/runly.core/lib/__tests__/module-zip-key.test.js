import assert from 'node:assert/strict'
import { test } from 'node:test'
import { guessKeyFromFilename, keyFromManifestSource } from '../module-zip-key.js'

test('file name fallback strips the version suffix the Builder adds', () => {
  assert.equal(guessKeyFromFilename('custom.prestamos-1.0.0.zip'), 'custom.prestamos')
  assert.equal(guessKeyFromFilename('custom.mi-modulo-v2.3.10.zip'), 'custom.mi-modulo')
  assert.equal(guessKeyFromFilename('custom.encuestas.zip'), 'custom.encuestas')
  assert.equal(guessKeyFromFilename('custom.dispatch-1.2.0 (1).zip'), 'custom.dispatch')
})

test('reads the module key from manifest source, skipping other key entries', () => {
  const manifest = [
    'export default defineRunlyModule({',
    "  connections: [{ key: 'prestamo_contacto', target: 'contact' }],",
    "  key: 'custom.prestamos',",
    "  permissions: [{ key: 'prestamos.prestamo.read' }],",
    '})',
  ].join('\n')
  assert.equal(keyFromManifestSource(manifest), 'custom.prestamos')
  assert.equal(keyFromManifestSource("defineRunlyModule({ key: \"community.visitas\" })"), 'community.visitas')
  assert.equal(keyFromManifestSource('no manifest here'), null)
})
