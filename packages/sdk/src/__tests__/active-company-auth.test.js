import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRunlyClient } from '../index.js'

test('profile permissions are requested for the selected company on every switch', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(options.headers)
    return { ok: true, json: async () => ({ companyId: options.headers['X-Runly-Company-Id'] }) }
  })
  let companyId = 'company-a'
  const client = createRunlyClient({ baseUrl: 'https://erp.example.test', getActiveCompanyId: () => companyId })
  assert.equal((await client.auth.me('token')).companyId, 'company-a')
  companyId = 'company-b'
  assert.equal((await client.auth.me('token')).companyId, 'company-b')
  assert.equal(requests[1].Authorization, 'Bearer token')
})
