import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldFocusDocumentEnd } from '../clickBelowContent.js'

test('shouldFocusDocumentEnd: true when the click target IS the container (blank background)', () => {
  const container = {}
  assert.equal(shouldFocusDocumentEnd(container, container), true)
})

test('shouldFocusDocumentEnd: false when the click target is a node rendered inside the container', () => {
  const container = {}
  const innerNode = { classList: { contains: () => false } }
  assert.equal(shouldFocusDocumentEnd(innerNode, container), false)
})

test('shouldFocusDocumentEnd: true when the click target is the NoteSheet blank background', () => {
  const container = {}
  const noteSheetNode = { classList: { contains: (cls) => cls === 'note-sheet' } }
  assert.equal(shouldFocusDocumentEnd(noteSheetNode, container), true)
})
