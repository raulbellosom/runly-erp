import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

function makeFetch(status = 200) {
  return mock.fn(async (url) => ({
    ok: status < 400,
    status,
    json: async () => ({ url }),
    text: async () => String(status),
  }))
}

describe('atlas SDK — fleet namespace', () => {
  it('getVehicle GETs /fleet/vehicles/:id', async () => {
    const fetchMock = makeFetch()
    const { createRunlyClient } = await import('../index.js')
    const client = createRunlyClient({ baseUrl: 'http://api' })
    globalThis.fetch = fetchMock
    await client.fleet.getVehicle('v-1', 'tok')
    const [url, opts] = fetchMock.mock.calls[0].arguments
    assert.equal(url, 'http://api/fleet/vehicles/v-1')
    assert.equal(opts.headers.Authorization, 'Bearer tok')
    fetchMock.mock.restore()
  })

  it('getVehicleDocuments GETs /fleet/vehicles/:id/documents', async () => {
    const fetchMock = makeFetch()
    const { createRunlyClient } = await import('../index.js')
    const client = createRunlyClient({ baseUrl: 'http://api' })
    globalThis.fetch = fetchMock
    await client.fleet.getVehicleDocuments('v-1', 'tok')
    const [url, opts] = fetchMock.mock.calls[0].arguments
    assert.equal(url, 'http://api/fleet/vehicles/v-1/documents')
    assert.equal(opts.headers.Authorization, 'Bearer tok')
    fetchMock.mock.restore()
  })

  it('getReport GETs /fleet/reports/:id', async () => {
    const fetchMock = makeFetch()
    const { createRunlyClient } = await import('../index.js')
    const client = createRunlyClient({ baseUrl: 'http://api' })
    globalThis.fetch = fetchMock
    await client.fleet.getReport('r-1', 'tok')
    const [url, opts] = fetchMock.mock.calls[0].arguments
    assert.equal(url, 'http://api/fleet/reports/r-1')
    assert.equal(opts.headers.Authorization, 'Bearer tok')
    fetchMock.mock.restore()
  })
})
