import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')

// docs/developers/componentes.md is what module authors (and external AIs)
// build screens from: every component it documents must really be exported.
test('every component documented for module authors is exported by @runly/ui', () => {
  const index = read('../index.js')
  const exported = new Set()
  for (const match of index.matchAll(/export\s*\{([^}]+)\}\s*from/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim()
      if (name) exported.add(name)
    }
  }
  const documented = [...read('../../../../docs/developers/componentes.md').matchAll(/^###\s+(\w+)\s*$/gm)].map((m) => m[1])
  assert.ok(documented.length >= 25, `only ${documented.length} components documented`)
  assert.deepEqual(documented.filter((name) => !exported.has(name)), [])
})
