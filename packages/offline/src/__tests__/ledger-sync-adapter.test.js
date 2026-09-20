import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { RunlyOfflineDatabase } from '../db.js'
import { LedgerSyncAdapter } from '../ledger-sync-adapter.js'

let dbCounter = 0

function makeDb() {
  return new RunlyOfflineDatabase(`test-ledger-sync-${++dbCounter}`)
}

describe('LedgerSyncAdapter', () => {
  let db
  let storeCalls

  beforeEach(async () => {
    db = makeDb()
    await db.open()
    storeCalls = []
  })

  afterEach(async () => {
    await db.delete().catch(() => {})
  })

  it('pulls runly.ledger records and groups them by entity type', async () => {
    const adapter = new LedgerSyncAdapter({ companyId: 'company-a',
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      ledgerStore: {
        async upsertBatch(entityType, records) {
          storeCalls.push({ entityType, records })
        },
      },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          records: [
            {
              moduleKey: 'runly.ledger',
              entityType: 'account',
              id: 'acc-1',
              data: {
                id: 'acc-1',
                companyId: 'company-1',
                name: 'Caja',
                bank: 'Atlas',
                currency: 'MXN',
                openingBalance: 0,
                enabled: true,
                createdAt: '2026-06-07T00:00:00Z',
                updatedAt: '2026-06-07T00:00:00Z',
              },
              version: '2026-06-07T00:00:00Z',
              deleted: false,
            },
            {
              moduleKey: 'runly.ledger',
              entityType: 'transaction',
              id: 'tx-1',
              data: {
                id: 'tx-1',
                companyId: 'company-1',
                accountId: 'acc-1',
                fecha: '2026-06-07',
                nombre: 'Deposito',
                deposito: 10,
                retiro: null,
                enabled: true,
                createdAt: '2026-06-07T00:00:00Z',
                updatedAt: '2026-06-07T00:00:00Z',
              },
              version: '2026-06-07T00:00:00Z',
              deleted: false,
            },
          ],
          nextCursor: '2026-06-07T01:00:00Z',
        }),
      }),
    })

    const result = await adapter.pull()

    assert.equal(result.pulled, 2)
    assert.equal(storeCalls.length, 2)
    assert.equal(storeCalls[0].entityType, 'account')
    assert.equal(storeCalls[1].entityType, 'transaction')
  })

  it('stores nextCursor in sync_state for seen entity types', async () => {
    const adapter = new LedgerSyncAdapter({ companyId: 'company-a',
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      ledgerStore: {
        async upsertBatch(entityType, records) {
          storeCalls.push({ entityType, records })
        },
      },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          records: [
            { moduleKey: 'runly.ledger', entityType: 'account', id: 'acc-1', data: { id: 'acc-1' }, version: 'v1', deleted: false },
            { moduleKey: 'runly.ledger', entityType: 'transaction', id: 'tx-1', data: { id: 'tx-1' }, version: 'v1', deleted: false },
          ],
          nextCursor: '2026-06-07T01:00:00Z',
        }),
      }),
    })

    await adapter.pull()

    const accountState = await db.sync_state.get(['runly.ledger', 'account'])
    const txState = await db.sync_state.get(['runly.ledger', 'transaction'])

    assert.equal(accountState.serverCursor, '2026-06-07T01:00:00Z')
    assert.equal(txState.serverCursor, '2026-06-07T01:00:00Z')
  })

  it('reuses the oldest stored ledger cursor in the request URL', async () => {
    await db.sync_state.put({
      moduleKey: 'runly.ledger',
      entityType: 'account',
      lastPullAt: '2026-06-06T00:00:00Z',
      serverCursor: '2026-06-06T00:00:00Z',
      schemaVersion: null,
    })

    let capturedUrl = null
    const adapter = new LedgerSyncAdapter({ companyId: 'company-a',
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      ledgerStore: { async upsertBatch() {} },
      fetchImpl: async (url) => {
        capturedUrl = url
        return { ok: true, json: async () => ({ records: [], nextCursor: null }) }
      },
    })

    await adapter.pull()

    assert.ok(capturedUrl.includes('modules=runly.ledger'))
    assert.ok(capturedUrl.includes('cursor=2026-06-06T00%3A00%3A00Z'))
  })

  it('skips the network call when no token is available', async () => {
    let fetchCalled = false
    const adapter = new LedgerSyncAdapter({ companyId: 'company-a',
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => null,
      ledgerStore: { async upsertBatch() {} },
      fetchImpl: async () => {
        fetchCalled = true
        return { ok: true, json: async () => ({ records: [], nextCursor: null }) }
      },
    })

    const result = await adapter.pull()

    assert.deepEqual(result, { pulled: 0, nextCursor: null })
    assert.equal(fetchCalled, false)
  })

  it('passes deleted records through to the sqlite store', async () => {
    const adapter = new LedgerSyncAdapter({ companyId: 'company-a',
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      ledgerStore: {
        async upsertBatch(entityType, records) {
          storeCalls.push({ entityType, records })
        },
      },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          records: [
            {
              moduleKey: 'runly.ledger',
              entityType: 'transaction',
              id: 'tx-1',
              data: null,
              version: 'v2',
              deleted: true,
            },
          ],
          nextCursor: '2026-06-07T02:00:00Z',
        }),
      }),
    })

    await adapter.pull()

    assert.equal(storeCalls.length, 1)
    assert.equal(storeCalls[0].records[0].deleted, true)
  })
})
