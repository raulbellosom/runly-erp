#!/usr/bin/env node
// Regenerates packages/module-compiler/src/developer-docs.json: an offline
// copy of the public developer documentation (docs/developers/*.md, the same
// source runly-web publishes at runly.mx/documentacion/desarrolladores) that
// the Builder's "Descargar ZIP" ships under docs/. AI assistants can then read
// the full reference from the package even when they cannot browse runly.mx.
//
// Run after editing anything in docs/developers/:
//   node scripts/generate-module-developer-docs.mjs
// packages/module-compiler/src/__tests__/developer-docs.test.js fails when the
// snapshot no longer matches docs/developers/.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = path.join(repoRoot, 'docs/developers')
const OUT = path.join(repoRoot, 'packages/module-compiler/src/developer-docs.json')

// Site-relative links point at runly.mx pages; inside the ZIP they point at the sibling file.
function localizeLinks(content) {
  return content
    .replace(/\]\(\/documentacion\/desarrolladores\/?\)/g, '](index.md)')
    .replace(/\]\(\/documentacion\/desarrolladores\/([a-z0-9-]+)\/?(#[^)]*)?\)/g, (_, page, hash = '') => `](${page}.md${hash})`)
    .replace(/\]\(\/(documentacion\/[^)]*)\)/g, '](https://runly.mx/$1)')
}

export function buildDeveloperDocs() {
  const files = fs.readdirSync(SOURCE)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({ name, content: localizeLinks(fs.readFileSync(path.join(SOURCE, name), 'utf8').replace(/\r\n/g, '\n')) }))
  return { files }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(OUT, `${JSON.stringify(buildDeveloperDocs(), null, 2)}\n`)
  console.log(`developer-docs.json: ${buildDeveloperDocs().files.length} archivos`)
}
