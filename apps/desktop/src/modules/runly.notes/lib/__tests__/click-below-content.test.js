import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldFocusDocumentEnd } from '../clickBelowContent.js'

test('shouldFocusDocumentEnd: true when the click target IS the container (blank background)', () => {
  const container = {}
  assert.equal(shouldFocusDocumentEnd(container, container), true)
})

test('shouldFocusDocumentEnd: false when the click target is a node rendered inside the container', () => {
  const container = {}
  const innerNode = {}
  assert.equal(shouldFocusDocumentEnd(innerNode, container), false)
})
