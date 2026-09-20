import test from 'node:test'
import assert from 'node:assert/strict'
import { createLedgerDataClient } from '../ledger-data-client.js'

test('uses ledgerStore for account list before falling back to fetch', async () => {
  let fetchCalls = 0
  const client = createLedgerDataClient({
    getCompanyId: () => 'company-a',
    apiBaseUrl: 'http://localhost:4010',
    fetchImpl: async () => {
      fetchCalls += 1
      return {
        ok: true,
        json: async () => ({ data: [] }),
      }
    },
  })

  const result = await client.listAccounts({
    token: null,
    ledgerStore: {
      async getAccountList() {
        return [{ id: 'acc-1', name: 'Caja', current_balance: 10 }]
      },
    },
  })

  assert.equal(fetchCalls, 0)
  assert.equal(result.data[0].id, 'acc-1')
})

test('falls back to HTTP when ledgerStore is unavailable', async () => {
  const client = createLedgerDataClient({
    getCompanyId: () => 'company-a',
    apiBaseUrl: 'http://localhost:4010',
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => ({ url, data: [{ id: 'acc-2' }] }),
    }),
  })

  const result = await client.listAccounts({ token: 'tok', ledgerStore: null })
  assert.equal(result.data[0].id, 'acc-2')
  assert.match(result.url, /\/ledger\/accounts$/)
})
