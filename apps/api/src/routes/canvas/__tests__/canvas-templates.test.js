import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BOARD_TOOLS, CANVAS_TEMPLATES, effectiveBoardSettings, normalizeBoardSettings, templateFor, templateLayerRows,
} from '../canvas-templates.js'

describe('Canvas templates catalog', () => {
  it('declares seven templates with complete, self-consistent definitions', () => {
    assert.deepEqual(CANVAS_TEMPLATES.map((t) => t.key), ['blank', 'plan', 'technical-map', 'diagram', 'layout', 'pdf-review', 'site-map'])
    for (const template of CANVAS_TEMPLATES) {
      assert.ok(template.label && template.description && template.useWhen && template.namePlaceholder, template.key)
      assert.ok(template.includes.length >= 2, template.key)
      assert.ok(template.layers.some((layer) => layer.type === 'vector'), template.key)
      assert.deepEqual(normalizeBoardSettings(template.settings, template.settings), template.settings)
      assert.ok(template.emptyState.title && template.emptyState.description, template.key)
    }
  })

  it('falls back to blank for unknown template keys', () => {
    assert.equal(templateFor('nope').key, 'blank')
    assert.equal(templateFor(undefined).key, 'blank')
  })

  it('merges partial settings over the base and always stamps version 2', () => {
    const base = templateFor('plan').settings
    assert.deepEqual(normalizeBoardSettings({ grid: { size: 30 } }, base), { version: 2, grid: { enabled: true, size: 30 }, snapping: true, defaultTool: 'select' })
  })

  it('rejects invalid settings with status 400', () => {
    const base = templateFor('plan').settings
    for (const input of [{ grid: { size: 2 } }, { grid: { size: 500 } }, { grid: { size: 10.5 } }, { snapping: 'yes' }, { defaultTool: 'laser' }]) {
      assert.throws(() => normalizeBoardSettings(input, base), (error) => error.status === 400, JSON.stringify(input))
    }
    assert.ok(BOARD_TOOLS.includes('hotspot'))
  })

  it('gives legacy boards their template defaults', () => {
    const legacy = { templateType: 'blank', settings: { grid: { enabled: false, size: 10 }, snapping: true } }
    assert.deepEqual(effectiveBoardSettings(legacy), templateFor('blank').settings)
    assert.deepEqual(effectiveBoardSettings({ templateType: 'diagram', settings: null }), templateFor('diagram').settings)
    const saved = { version: 2, grid: { enabled: true, size: 50 }, snapping: false, defaultTool: 'select' }
    assert.deepEqual(effectiveBoardSettings({ templateType: 'plan', settings: saved }), saved)
  })

  it('plan, technical-map and layout end with a data layer', () => {
    for (const key of ['plan', 'technical-map', 'layout']) assert.equal(templateFor(key).layers.at(-1).type, 'data', key)
  })

  it('builds ordered layer rows with metadata', () => {
    const rows = templateLayerRows(templateFor('pdf-review'), 'page-1')
    assert.deepEqual(rows.map((row) => [row.name, row.type, row.position]), [['Documento', 'vector', 0], ['Anotaciones', 'vector', 1], ['Hotspots', 'hotspot', 2]])
    assert.deepEqual(rows[0].metadata, { mediaTarget: true, lockAfterInsert: true })
    assert.equal(rows[0].pageId, 'page-1')
  })
})
