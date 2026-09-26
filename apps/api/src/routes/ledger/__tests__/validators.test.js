// apps/api/src/routes/ledger/__tests__/validators.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { userSearchQuerySchema } from '../validators.js'

describe('userSearchQuerySchema', () => {
  it('accepts a missing "q" (default member listing)', () => {
    const parsed = userSearchQuerySchema.safeParse({})
    assert.ok(parsed.success)
    assert.equal(parsed.data.q, undefined)
    assert.equal(parsed.data.limit, 10)
  })

  it('still rejects a "q" shorter than 2 characters', () => {
    const parsed = userSearchQuerySchema.safeParse({ q: 'a' })
    assert.equal(parsed.success, false)
  })

  it('accepts a valid "q" as before', () => {
    const parsed = userSearchQuerySchema.safeParse({ q: 'an' })
    assert.ok(parsed.success)
    assert.equal(parsed.data.q, 'an')
  })
})
