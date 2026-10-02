import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { exportSize } from './renderScene.js'

describe('Export sizing', () => {
  it('renders at 2x world size with padding, capped at 8000px', () => {
    assert.deepEqual(exportSize({ x: 0, y: 0, width: 500, height: 250 }), { width: 1096, height: 596, pixelRatio: 2 })
    const big = exportSize({ x: 0, y: 0, width: 20000, height: 1000 })
    assert.ok(big.width <= 8000 && big.height <= 8000)
  })
})
