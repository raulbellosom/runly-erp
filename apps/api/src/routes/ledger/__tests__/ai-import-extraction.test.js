import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mergeChunkedRows } from '../ai-import-extraction.js'

describe('ai-import-extraction', () => {
  it('mergeChunkedRows concatenates rows from multiple chunks in order', () => {
    const chunkA = [{ fecha: '2026-03-25', nombre: 'A', deposito: null, retiro: 100 }]
    const chunkB = [{ fecha: '2026-03-27', nombre: 'B', deposito: 50, retiro: null }]
    const merged = mergeChunkedRows([chunkA, chunkB])
    assert.equal(merged.length, 2)
    assert.equal(merged[0].nombre, 'A')
    assert.equal(merged[1].nombre, 'B')
  })

  it('mergeChunkedRows drops rows with neither fecha nor nombre (unusable extraction noise)', () => {
    const merged = mergeChunkedRows([[{ fecha: null, nombre: null, deposito: null, retiro: null }]])
    assert.equal(merged.length, 0)
  })
})
