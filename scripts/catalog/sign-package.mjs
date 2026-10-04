#!/usr/bin/env node
// Signs a module ZIP for the official catalog and prints its index entry
// (docs/developers/catalogo.md). Reads key/name/version/... from the package's
// module.manifest.js, so the entry always matches what will be installed.
//
// Usage: node scripts/catalog/sign-package.mjs <module.zip> --url <packageUrl>
//          [--key ~/.runly/catalog-signing-key.pem] [--changelog "texto"]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import { sha256Of, signEntry } from '../../apps/api/src/services/catalog/catalog-crypto.js'

const args = process.argv.slice(2)
const option = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback }
const zipPath = args.find((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'))
if (!zipPath) { console.error('Usage: sign-package.mjs <module.zip> --url <packageUrl> [--key path] [--changelog text]'); process.exit(1) }
const keyPath = path.resolve(option('key', path.join(os.homedir(), '.runly', 'catalog-signing-key.pem')))
const buffer = readFileSync(zipPath)

// Import the manifest from a temp copy inside the repo so @runly/module-engine resolves.
const zip = await JSZip.loadAsync(buffer)
const manifestFile = zip.file('module.manifest.js')
if (!manifestFile) { console.error('The ZIP has no module.manifest.js at its root.'); process.exit(1) }
const tmp = path.resolve('node_modules', '.cache', 'runly-sign', randomUUID())
mkdirSync(tmp, { recursive: true })
let manifest
try {
  writeFileSync(path.join(tmp, 'module.manifest.mjs'), await manifestFile.async('string'))
  manifest = (await import(pathToFileURL(path.join(tmp, 'module.manifest.mjs')).href)).default
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

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
