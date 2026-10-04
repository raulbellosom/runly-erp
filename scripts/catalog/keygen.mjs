#!/usr/bin/env node
// Creates the Ed25519 key pair that signs official catalog packages
// (docs/developers/catalogo.md). The private key is written OUTSIDE the repo
// with owner-only permissions and is never printed; the public key (not
// secret) is printed to pin in apps/api/src/services/catalog/catalog-public-key.js.
//
// Usage: node scripts/catalog/keygen.mjs [privateKeyPath]
//   default path: ~/.runly/catalog-signing-key.pem
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const target = path.resolve(process.argv[2] ?? path.join(os.homedir(), '.runly', 'catalog-signing-key.pem'))
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..')
if (target.startsWith(repo + path.sep)) {
  console.error('Refusing to write the private key inside the repository.')
  process.exit(1)
}
if (existsSync(target)) {
  console.error(`A key already exists at ${target}; remove it explicitly to rotate.`)
  process.exit(1)
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
mkdirSync(path.dirname(target), { recursive: true })
writeFileSync(target, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
console.log(`Private key written to ${target} (back it up; never commit it).`)
console.log(`Public key (base64 SPKI DER): ${publicKey.export({ format: 'der', type: 'spki' }).toString('base64')}`)
