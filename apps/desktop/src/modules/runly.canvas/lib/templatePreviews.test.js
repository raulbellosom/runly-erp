import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CANVAS_TEMPLATES } from '../../../../../api/src/routes/canvas/canvas-templates.js'
import { TEMPLATE_PREVIEWS, previewFor } from './templatePreviews.js'

describe('Template previews', () => {
  it('has an illustration for every catalog template', () => {
    for (const template of CANVAS_TEMPLATES) assert.ok(TEMPLATE_PREVIEWS[template.preview]?.length, template.key)
  })
  it('falls back to blank for unknown keys', () => {
    assert.equal(previewFor('nope'), TEMPLATE_PREVIEWS.blank)
  })
})
