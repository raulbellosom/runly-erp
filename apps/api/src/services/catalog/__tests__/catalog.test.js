import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { CatalogVerificationError, sha256Of, signEntry, verifyPackage } from '../catalog-crypto.js'
import { compareVersions, installState } from '../catalog-service.js'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUBLIC = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
const PRIVATE = privateKey.export({ format: 'pem', type: 'pkcs8' })
const OTHER = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64')

function signed(buffer, version = '1.0.0') {
  const sha256 = sha256Of(buffer)
  return { key: 'custom.horas', version, size: buffer.length, sha256, signature: signEntry({ key: 'custom.horas', version, sha256 }, PRIVATE) }
}

test('a signed package verifies with the trusted key only', () => {
  const buffer = Buffer.from('zip bytes')
  const entry = signed(buffer)
  assert.equal(verifyPackage({ buffer, entry, publicKeys: [PUBLIC] }).sha256, entry.sha256)
  assert.throws(() => verifyPackage({ buffer, entry, publicKeys: [OTHER] }), /firma no es del catálogo oficial/)
})

test('non-Ed25519 trust anchors cannot verify a v1 catalog', () => {
  const buffer=Buffer.from('zip bytes'),entry=signed(buffer)
  const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'der',type:'spki'}).toString('base64')
  assert.throws(()=>verifyPackage({buffer,entry,publicKeys:[key]}),CatalogVerificationError)
})

test('tampered bytes, size or a re-labelled version are refused', () => {
  const buffer = Buffer.from('zip bytes')
  const entry = signed(buffer)
  assert.throws(() => verifyPackage({ buffer: Buffer.from('zip bytez'), entry, publicKeys: [PUBLIC] }), CatalogVerificationError)
  assert.throws(() => verifyPackage({ buffer, entry: { ...entry, size: 3 }, publicKeys: [PUBLIC] }), /tamaño/)
  // Same bytes and hash, but claiming another version: the signature covers key@version.
  assert.throws(() => verifyPackage({ buffer, entry: { ...entry, version: '9.9.9' }, publicKeys: [PUBLIC] }), /firma/)
})

test('install state from catalog vs installed versions', () => {
  assert.ok(compareVersions('1.10.0', '1.9.3') > 0)
  assert.equal(installState({ version: '1.0.0' }, null), 'available')
  assert.equal(installState({ version: '1.0.0' }, { status: 'UNINSTALLED', version: '1.0.0' }), 'available')
  assert.equal(installState({ version: '1.1.0' }, { status: 'INSTALLED', version: '1.0.0' }), 'update')
  assert.equal(installState({ version: '1.0.0' }, { status: 'INSTALLED', version: '1.0.0' }), 'installed')
})
