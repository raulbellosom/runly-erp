import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadHelpBlueprints } from '../load-help-blueprints.js'

function makeTmpHelpDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runly-help-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf8')
  }
  return dir
}

describe('loadHelpBlueprints', () => {
  it('returns [] when the help directory does not exist', () => {
    const result = loadHelpBlueprints('custom.nothing', '/does/not/exist')
    assert.deepEqual(result, [])
  })

  it('loads overview.md into a scope:module blueprint', () => {
    const dir = makeTmpHelpDir({
      'overview.md': '---\ntitle: Flotas\nsummary: Gestiona vehiculos y mantenimientos.\n---\nContenido completo.\n',
    })
    const result = loadHelpBlueprints('custom.fleet', dir)
    assert.equal(result.length, 1)
    assert.equal(result[0].key, 'custom.fleet.help.overview')
    assert.equal(result[0].kind, 'HELP')
    assert.equal(result[0].schema.scope, 'module')
    assert.equal(result[0].schema.title, 'Flotas')
    assert.equal(result[0].schema.summary, 'Gestiona vehiculos y mantenimientos.')
    assert.equal(result[0].schema.content, 'Contenido completo.')
  })

  it('loads views/*.md into scope:view blueprints keyed by viewKey', () => {
    const dir = makeTmpHelpDir({
      'overview.md': '---\ntitle: Flotas\nsummary: resumen\n---\ncuerpo\n',
      'views/vehiculos.md': '---\nviewKey: /fleet/vehicles\ntitle: Vehiculos\nsummary: Lista de vehiculos.\n---\nDetalle de vehiculos.\n',
    })
    const result = loadHelpBlueprints('custom.fleet', dir)
    const view = result.find((bp) => bp.schema.scope === 'view')
    assert.ok(view, 'expected a view-scoped blueprint')
    assert.equal(view.key, 'custom.fleet.help.view.vehiculos')
    assert.equal(view.schema.viewKey, '/fleet/vehicles')
    assert.equal(view.schema.title, 'Vehiculos')
    assert.equal(view.schema.content, 'Detalle de vehiculos.')
  })

  it('skips a view file missing viewKey and warns instead of throwing', () => {
    const dir = makeTmpHelpDir({
      'views/broken.md': '---\ntitle: Roto\n---\ncuerpo\n',
    })
    const warn = mock.method(console, 'warn', () => {})
    const result = loadHelpBlueprints('custom.fleet', dir)
    assert.deepEqual(result, [])
    assert.equal(warn.mock.calls.length, 1)
    warn.mock.restore()
  })

  it('falls back to moduleKey/empty summary when overview frontmatter is incomplete, and warns', () => {
    const dir = makeTmpHelpDir({
      'overview.md': '---\n---\ncuerpo sin metadata\n',
    })
    const warn = mock.method(console, 'warn', () => {})
    const result = loadHelpBlueprints('custom.fleet', dir)
    assert.equal(result[0].schema.title, 'custom.fleet')
    assert.equal(result[0].schema.summary, '')
    assert.equal(warn.mock.calls.length, 1)
    warn.mock.restore()
  })
})
