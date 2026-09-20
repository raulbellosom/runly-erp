import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeLineUnitPx, computePaperPhase } from '../paperAlignment.js'

test('computeLineUnitPx: desktop uses 0.9375rem * 1.72', () => {
  assert.equal(computeLineUnitPx(16, false), 0.9375 * 1.72 * 16)
})

test('computeLineUnitPx: mobile follows its 0.875rem body typography', () => {
  assert.equal(computeLineUnitPx(16, true), 0.875 * 1.72 * 16)
})

test('computePaperPhase: exact multiple of the line unit needs no shift', () => {
  assert.equal(computePaperPhase(51.6, 25.8), 0)
})

test('computePaperPhase: partial distance shifts by the remainder', () => {
  assert.ok(Math.abs(computePaperPhase(60, 25.8) - (60 % 25.8)) < 1e-9)
})

test('computePaperPhase: handles a distance smaller than one unit', () => {
  assert.ok(Math.abs(computePaperPhase(10, 25.8) - 10) < 1e-9)
})

test('computePaperPhase: never negative even with an unusual input', () => {
  assert.ok(computePaperPhase(-5, 25.8) >= 0)
})

test('computePaperPhase: returns 0 for a non-positive line unit instead of dividing by zero', () => {
  assert.equal(computePaperPhase(60, 0), 0)
  assert.equal(computePaperPhase(60, -10), 0)
})
