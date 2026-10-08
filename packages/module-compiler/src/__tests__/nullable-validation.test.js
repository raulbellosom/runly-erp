import test from 'node:test'
import assert from 'node:assert/strict'
import { zodFieldSchema } from '../templates/helpers.js'

test('optional fields accept NULL on create and update; required updates cannot clear values', () => {
  for (const type of ['text', 'textarea', 'number', 'decimal', 'boolean', 'date', 'datetime', 'email', 'phone', 'color', 'markdown', 'richtext', 'json', 'multiselect', 'relation', 'file', 'select']) {
    const field = { type, required: false, options: ['ONE'] }
    assert.match(zodFieldSchema(field, true), /\.nullable\(\)\.optional\(\)$/)
    assert.match(zodFieldSchema(field, false), /\.nullable\(\)\.optional\(\)$/)
    assert.doesNotMatch(zodFieldSchema({ ...field, required: true }, false), /nullable/)
  }
})
