import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { helpSearchQuerySchema, helpResolvePathQuerySchema } from '../index.js'

describe('help query schemas', () => {
  it('helpSearchQuerySchema accepts a 2-200 char query', () => {
    const result = helpSearchQuerySchema.safeParse({ q: 'vehiculos' })
    assert.equal(result.success, true)
  })

  it('helpSearchQuerySchema rejects a 1-char query', () => {
    const result = helpSearchQuerySchema.safeParse({ q: 'a' })
    assert.equal(result.success, false)
  })

  it('helpSearchQuerySchema rejects a missing query', () => {
    const result = helpSearchQuerySchema.safeParse({ q: undefined })
    assert.equal(result.success, false)
  })

  it('helpResolvePathQuerySchema accepts a route path', () => {
    const result = helpResolvePathQuerySchema.safeParse({ path: '/fleet/vehicles' })
    assert.equal(result.success, true)
  })

  it('helpResolvePathQuerySchema rejects an empty path', () => {
    const result = helpResolvePathQuerySchema.safeParse({ path: '' })
    assert.equal(result.success, false)
  })
})
