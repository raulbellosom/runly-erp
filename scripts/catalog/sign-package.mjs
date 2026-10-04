#!/usr/bin/env node
// Signs a module ZIP for the official catalog and prints its index entry
// (docs/developers/catalogo.md). Reads key/name/version/... from the package's
// module.manifest.js, so the entry always matches what will be installed.
//
// Usage: node scripts/catalog/sign-package.mjs <module.zip> --url <packageUrl>
//          [--key ~/.runly/catalog-signing-key.pem] [--changelog "texto"]
import { readFileSync, openSync, fstatSync, readSync, closeSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inspectModuleZip, DEFAULT_INSPECTION_LIMITS } from '@runly/module-compiler/inspection'
import { sha256Of, signEntry } from '../../apps/api/src/services/catalog/catalog-crypto.js'

const args = process.argv.slice(2)
const option = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback }
const zipPath = args.find((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'))
if (!zipPath) { console.error('Usage: sign-package.mjs <module.zip> --url <packageUrl> [--key path] [--changelog text]'); process.exit(1) }
const keyPath = path.resolve(option('key', path.join(os.homedir(), '.runly', 'catalog-signing-key.pem')))
const descriptor = openSync(zipPath, 'r')
let buffer
try {
  const stat = fstatSync(descriptor)
  if (!stat.isFile() || stat.size > DEFAULT_INSPECTION_LIMITS.zipBytes) throw new Error('ZIP must be a file of at most 25 MiB.')
  const bytes = Buffer.alloc(stat.size + 1)
  let offset = 0
  while (offset < bytes.length) {
    const count = readSync(descriptor, bytes, offset, bytes.length - offset, null)
    if (!count) break
    offset += count
  }
  if (offset !== stat.size) throw new Error('ZIP changed during reading.')
  buffer = bytes.subarray(0, offset)
} finally { closeSync(descriptor) }

// Inspect before reading the signing key. Never load JavaScript from the ZIP.
const report = inspectModuleZip(buffer)
if (!report.valid) {
  console.error(JSON.stringify(report.diagnostics, null, 2))
  process.exit(1)
}
const manifest = report.manifest

const sha256 = sha256Of(buffer)
const entry = {
  key: manifest.key,
  name: manifest.name,
  description: manifest.description ?? '',
  icon: manifest.icon ?? 'Boxes',
  color: manifest.color ?? '#2563EB',
  version: manifest.version,
  packageUrl: option('url', `${manifest.key}-${manifest.version}.zip`),
  size: buffer.length,
  sha256,
  signature: signEntry({ key: manifest.key, version: manifest.version, sha256 }, readFileSync(keyPath, 'utf8')),
  dependencies: (manifest.dependencies ?? []).map((dependency) => dependency.key ?? dependency),
  consumes: manifest.consumes ?? {},
  events: manifest.events?.subscribes ?? [],
  connections: (manifest.connections ?? []).map((connection) => ({ target: connection.target, kind: connection.kind, label: connection.label })),
  changelog: option('changelog', ''),
}
console.log(JSON.stringify(entry, null, 2))
