import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { signImportProof, verifyImportProof } from '../ai-import-token.js'

const ENV = { GROQ_API_KEY: 'test-signing-secret' }

describe('ai-import-token', () => {
  it('round-trips a valid token', () => {
    const token = signImportProof({ companyId: 'c1', actorId: 'u1', rowsHash: 'abc123' }, ENV)
    const payload = verifyImportProof(token, ENV)
    assert.equal(payload.companyId, 'c1')
    assert.equal(payload.rowsHash, 'abc123')
  })

  it('rejects a tampered token', () => {
    const token = signImportProof({ companyId: 'c1', actorId: 'u1', rowsHash: 'abc123' }, ENV)
    const tampered = token.slice(0, -2) + 'zz'
    assert.throws(() => verifyImportProof(tampered, ENV))
  })

  it('rejects an expired token', () => {
    const token = signImportProof({ companyId: 'c1', actorId: 'u1', rowsHash: 'abc123' }, ENV, { nowMs: Date.now() - 3 * 60 * 60 * 1000 })
    assert.throws(() => verifyImportProof(token, ENV))
  })
})
