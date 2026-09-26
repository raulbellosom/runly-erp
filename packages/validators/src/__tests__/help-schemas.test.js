import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { helpSearchQuerySchema, helpResolvePathQuerySchema, helpAskBodySchema } from '../index.js'

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

  it('helpAskBodySchema accepts a minimal valid body', () => {
    const result = helpAskBodySchema.safeParse({ path: '/fleet/vehicles', question: 'como registro un vehiculo' })
    assert.equal(result.success, true)
  })

  it('helpAskBodySchema accepts history up to 6 entries', () => {
    const history = Array.from({ length: 6 }, () => ({ role: 'user', content: 'hola' }))
    const result = helpAskBodySchema.safeParse({ path: '/fleet/vehicles', question: 'algo valido', history })
    assert.equal(result.success, true)
  })

  it('helpAskBodySchema rejects more than 6 history entries', () => {
    const history = Array.from({ length: 7 }, () => ({ role: 'user', content: 'hola' }))
    const result = helpAskBodySchema.safeParse({ path: '/fleet/vehicles', question: 'algo valido', history })
    assert.equal(result.success, false)
  })

  it('helpAskBodySchema rejects a 1-char question', () => {
    const result = helpAskBodySchema.safeParse({ path: '/fleet/vehicles', question: 'a' })
    assert.equal(result.success, false)
  })
})
