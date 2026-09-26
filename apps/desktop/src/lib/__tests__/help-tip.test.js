import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pickTipText } from '../help-tip.js'

describe('pickTipText', () => {
  it('prefers the view summary when a view is resolved', () => {
    const resolved = { view: { summary: 'Resumen de vista' }, overview: { summary: 'Resumen de modulo' } }
    assert.equal(pickTipText(resolved), 'Resumen de vista')
  })

  it('falls back to the overview summary when there is no view', () => {
    const resolved = { view: null, overview: { summary: 'Resumen de modulo' } }
    assert.equal(pickTipText(resolved), 'Resumen de modulo')
  })

  it('returns null when neither view nor overview exist', () => {
    const resolved = { view: null, overview: null }
    assert.equal(pickTipText(resolved), null)
  })

  it('returns null for undefined input', () => {
    assert.equal(pickTipText(undefined), null)
  })

  it('returns null for null input', () => {
    assert.equal(pickTipText(null), null)
  })
})
