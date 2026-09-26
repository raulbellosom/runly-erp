import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

function makeFetch(status = 200, body = { data: [] }) {
  return mock.fn(async (url) => ({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }))
}

describe('runly SDK — help namespace', () => {
  it('listModules GETs /help/modules', async () => {
    const fetchMock = makeFetch()
    const { createRunlyClient } = await import('../index.js')
    const client = createRunlyClient({ baseUrl: 'http://api' })
    globalThis.fetch = fetchMock
    await client.help.listModules('tok')
    const [url, opts] = fetchMock.mock.calls[0].arguments
    assert.equal(url, 'http://api/help/modules')
    assert.equal(opts.headers.Authorization, 'Bearer tok')
    fetchMock.mock.restore()
  })

  it('getModuleHelp GETs /help/modules/:moduleKey', async () => {
    const fetchMock = makeFetch()
    const { createRunlyClient } = await import('../index.js')
    const client = createRunlyClient({ baseUrl: 'http://api' })
    globalThis.fetch = fetchMock
    await client.help.getModuleHelp('runly.core', 'tok')
    const [url] = fetchMock.mock.calls[0].arguments
    assert.equal(url, 'http://api/help/modules/runly.core')
    fetchMock.mock.restore()
  })

  it('resolveHelp GETs /help/resolve with an encoded path query', async () => {
    const fetchMock = makeFetch()
    const { createRunlyClient } = await import('../index.js')
    const client = createRunlyClient({ baseUrl: 'http://api' })
    globalThis.fetch = fetchMock
    await client.help.resolveHelp('/fleet/vehicles', 'tok')
    const [url] = fetchMock.mock.calls[0].arguments
    assert.equal(url, 'http://api/help/resolve?path=%2Ffleet%2Fvehicles')
    fetchMock.mock.restore()
  })

  it('searchHelp GETs /help/search with a q query', async () => {
    const fetchMock = makeFetch()
    const { createRunlyClient } = await import('../index.js')
    const client = createRunlyClient({ baseUrl: 'http://api' })
    globalThis.fetch = fetchMock
    await client.help.searchHelp('vehiculos', 'tok')
    const [url] = fetchMock.mock.calls[0].arguments
    assert.equal(url, 'http://api/help/search?q=vehiculos')
    fetchMock.mock.restore()
  })
})
