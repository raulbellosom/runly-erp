import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHelpRouter } from '../help-routes.js'

function createRequirePermission() {
  return (permissionKey) => async (c, next) => {
    const permissions = new Set(
      (c.req.header('X-Test-Permissions') ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    )
    if (!permissions.has(permissionKey)) {
      return c.json({ error: `missing:${permissionKey}` }, 403)
    }
    await next()
  }
}

const PRISMA_STUB = {
  runlyModule: {
    findMany: async () => [],
    findFirst: async () => null,
  },
  blueprint: {
    findMany: async () => [],
  },
}

function makeApp(overrides = {}) {
  return createHelpRouter({
    prisma: PRISMA_STUB,
    requirePermission: createRequirePermission(),
    env: { GROQ_API_KEY: '' },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }), text: async () => '' }),
    ...overrides,
  })
}

async function get(app, path, headers = {}) {
  const res = await app.request(`http://localhost${path}`, { headers })
  return { status: res.status, body: await res.json() }
}

describe('help-routes', () => {
  it('GET /help/modules without permission -> 403', async () => {
    const { status } = await get(makeApp(), '/help/modules')
    assert.equal(status, 403)
  })

  it('GET /help/modules with permission -> 200 with data []', async () => {
    const { status, body } = await get(makeApp(), '/help/modules', { 'X-Test-Permissions': 'runly.help.read' })
    assert.equal(status, 200)
    assert.deepEqual(body.data, [])
  })

  it('GET /help/modules/:moduleKey for an unknown module -> 404', async () => {
    const { status } = await get(makeApp(), '/help/modules/custom.unknown', { 'X-Test-Permissions': 'runly.help.read' })
    assert.equal(status, 404)
  })

  it('GET /help/search with a 1-char q -> 400', async () => {
    const { status } = await get(makeApp(), '/help/search?q=a', { 'X-Test-Permissions': 'runly.help.read' })
    assert.equal(status, 400)
  })

  it('GET /help/search with a valid q -> 200 with data []', async () => {
    const { status, body } = await get(makeApp(), '/help/search?q=vehiculos', { 'X-Test-Permissions': 'runly.help.read' })
    assert.equal(status, 200)
    assert.deepEqual(body.data, [])
  })

  it('GET /help/resolve without path -> 400', async () => {
    const { status } = await get(makeApp(), '/help/resolve', { 'X-Test-Permissions': 'runly.help.read' })
    assert.equal(status, 400)
  })

  it('GET /help/resolve with path -> 200', async () => {
    const { status, body } = await get(makeApp(), '/help/resolve?path=%2Ffleet%2Fvehicles', { 'X-Test-Permissions': 'runly.help.read' })
    assert.equal(status, 200)
    assert.equal(body.data.moduleKey, null)
  })

  it('GET /help/assistant/status without permission -> 403', async () => {
    const { status } = await get(makeApp(), '/help/assistant/status')
    assert.equal(status, 403)
  })

  it('GET /help/assistant/status reflects GROQ_API_KEY absence', async () => {
    const { status, body } = await get(makeApp(), '/help/assistant/status', { 'X-Test-Permissions': 'runly.help.read' })
    assert.equal(status, 200)
    assert.equal(body.data.available, false)
  })

  it('POST /help/ask without permission -> 403', async () => {
    const res = await makeApp().request('http://localhost/help/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/x', question: 'algo valido' }),
    })
    assert.equal(res.status, 403)
  })

  it('POST /help/ask with an invalid body -> 400', async () => {
    const res = await makeApp().request('http://localhost/help/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Permissions': 'runly.help.read' },
      body: JSON.stringify({ path: '/x', question: 'a' }),
    })
    assert.equal(res.status, 400)
  })

  it('POST /help/ask with a valid body and no GROQ_API_KEY -> 200 mode:fallback', async () => {
    const res = await makeApp().request('http://localhost/help/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Permissions': 'runly.help.read' },
      body: JSON.stringify({ path: '/x', question: 'algo valido' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.data.mode, 'fallback')
  })
})
