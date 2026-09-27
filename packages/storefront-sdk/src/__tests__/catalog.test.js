import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createCatalogNamespace } from '../catalog.js'

function makeRequest(response) {
  const calls = []
  const fn = async (method, path) => { calls.push({ method, path }); return response }
  fn.calls = calls
  return fn
}

describe('sdk.catalog.products', () => {
  it('calls GET /public/catalog/products', async () => {
    const req = makeRequest({ data: [], total: 0 })
    const catalog = createCatalogNamespace({ request: req })
    await catalog.products()
    assert.ok(req.calls[0].path.startsWith('/public/catalog/products'))
  })

  it('appends real query params when provided', async () => {
    const req = makeRequest({ data: [], total: 0 })
    const catalog = createCatalogNamespace({ request: req })
    await catalog.products({ search: 'rock', categorySlug: 'calzado', limit: 10, offset: 20 })
    assert.ok(req.calls[0].path.includes('search=rock'))
    assert.ok(req.calls[0].path.includes('categorySlug=calzado'))
    assert.ok(req.calls[0].path.includes('limit=10'))
    assert.ok(req.calls[0].path.includes('offset=20'))
  })
})

describe('sdk.catalog.getProduct', () => {
  it('calls GET /public/catalog/products/:idOrSlug with a slug', async () => {
    const req = makeRequest({ data: { id: 'p1', slug: 'camiseta-azul', name: 'Prod' } })
    const catalog = createCatalogNamespace({ request: req })
    const result = await catalog.getProduct('camiseta-azul')
    assert.equal(result.id, 'p1')
    assert.equal(req.calls[0].path, '/public/catalog/products/camiseta-azul')
  })

  it('calls GET /public/catalog/products/:idOrSlug with a raw id', async () => {
    const req = makeRequest({ data: { id: 'p1', name: 'Prod' } })
    const catalog = createCatalogNamespace({ request: req })
    const result = await catalog.getProduct('p1')
    assert.equal(result.id, 'p1')
    assert.equal(req.calls[0].path, '/public/catalog/products/p1')
  })
})
