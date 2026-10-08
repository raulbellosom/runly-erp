import test from 'node:test'
import assert from 'node:assert/strict'
import { zodFieldSchema } from '../templates/helpers.js'
import { z } from 'zod'

test('optional fields accept NULL on create and update; required updates cannot clear values', () => {
  for (const type of ['text', 'textarea', 'number', 'decimal', 'boolean', 'date', 'datetime', 'email', 'phone', 'color', 'markdown', 'richtext', 'json', 'multiselect', 'relation', 'file', 'select']) {
    const field = { type, required: false, options: ['ONE'] }
    assert.match(zodFieldSchema(field, true), /\.nullable\(\)\.optional\(\)$/)
    assert.match(zodFieldSchema(field, false), /\.nullable\(\)\.optional\(\)$/)
    assert.doesNotMatch(zodFieldSchema({ ...field, required: true }, false), /nullable/)
  }
})

test('generated JSON schemas construct and validate objects, optional NULL and required keys', () => {
  const schema = (required, create) => new Function('z', 'return ' + zodFieldSchema({ type: 'json', required }, create))(z)
  assert.equal(schema(false, true).safeParse(null).success, true)
  assert.equal(schema(false, false).safeParse({ fixture: true }).success, true)
  assert.equal(schema(true, true).safeParse({ fixture: true }).success, true)
  assert.equal(schema(true, true).safeParse({}).success, false)
  assert.equal(schema(true, false).safeParse(null).success, false)
})
