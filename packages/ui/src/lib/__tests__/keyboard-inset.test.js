import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeKeyboardInset,
  isCaretHiddenByKeyboard,
  computeCaretScrollDelta,
} from '../keyboardInset.js'

test('computeKeyboardInset: returns the gap between layout and visual viewport', () => {
  assert.equal(computeKeyboardInset(800, 500, 0), 300)
})

test('computeKeyboardInset: never returns a negative inset', () => {
  assert.equal(computeKeyboardInset(800, 800, 0), 0)
  assert.equal(computeKeyboardInset(800, 850, 0), 0)
})

test('computeKeyboardInset: accounts for a non-zero visual viewport offset', () => {
  assert.equal(computeKeyboardInset(800, 500, 20), 280)
})

test('isCaretHiddenByKeyboard: true when the caret bottom is below the visible viewport', () => {
  assert.equal(isCaretHiddenByKeyboard(520, 500), true)
})

test('isCaretHiddenByKeyboard: false when the caret is within the visible viewport', () => {
  assert.equal(isCaretHiddenByKeyboard(480, 500), false)
})

test('computeCaretScrollDelta: scrolls just enough to clear the keyboard plus margin', () => {
  assert.equal(computeCaretScrollDelta(520, 500, 16), 36)
})

test('computeCaretScrollDelta: defaults the margin to 16px', () => {
  assert.equal(computeCaretScrollDelta(520, 500), 36)
})
