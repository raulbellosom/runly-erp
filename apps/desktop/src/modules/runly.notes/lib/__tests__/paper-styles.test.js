import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NOTE_PAPER_STYLES } from '../paperStyles.js'

test('NOTE_PAPER_STYLES: has exactly the none/lined/grid options with labels', () => {
  const values = NOTE_PAPER_STYLES.map(s => s.value)
  assert.deepEqual(values, ['none', 'lined', 'grid'])
  for (const style of NOTE_PAPER_STYLES) {
    assert.equal(typeof style.label, 'string')
    assert.ok(style.label.length > 0)
  }
})
