import { test } from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { RunlyOfflineDatabase } from '../db.js'
import { SyncEngine } from '../sync-engine.js'
import { LedgerSyncAdapter } from '../ledger-sync-adapter.js'
import { offlineDatabaseName } from '../offline-scope.js'

test('offline databases separate server, user and company; old cursors are not reused', async () => {
  const scope = { apiBaseUrl: 'https://erp.example.test', userId: 'user-a', companyId: 'company-a' }
  const names = [scope, { ...scope, userId: 'user-b' }, { ...scope, companyId: 'company-b' }, { ...scope, apiBaseUrl: 'https://other.example.test' }].map(offlineDatabaseName)
  assert.equal(new Set(names).size, 4)
  assert.equal(offlineDatabaseName({ ...scope, companyId: null }), null)
  const a = new RunlyOfflineDatabase(names[0]), b = new RunlyOfflineDatabase(names[2])
  try {
    await a.sync_state.put({ moduleKey: 'runly.contacts', entityType: 'contact', serverCursor: '2026-09-16T00:00:00Z' })
    let request
    const engine = new SyncEngine({ db: b, companyId: 'company-b', apiBaseUrl: scope.apiBaseUrl, getToken: async () => 'token', fetchImpl: async (url, options) => {
      request = { url, options }
      return { ok: true, json: async () => ({ records: [], nextCursor: null }) }
    } })
    await engine.pull({ modules: ['runly.contacts'] })
    assert.equal(new URL(request.url).searchParams.has('cursor'), false)
    assert.equal(request.options.headers['X-Runly-Company-Id'], 'company-b')
    assert.equal(request.options.headers.Authorization, 'Bearer token')
  } finally { await a.delete(); await b.delete() }
})

test('push and native ledger sync include the same explicit company context', async () => {
  const db = new RunlyOfflineDatabase('test-sync-context-headers')
  const requests = []
  try {
    await db.mutation_queue.put({ id: 'pending', idempotencyKey: 'operation', status: 'PENDING', queuedAt: new Date().toISOString(), companyId: 'company-a', moduleKey: 'runly.contacts', entityType: 'contact', operation: 'CREATE', payload: { name: 'Test' } })
    const options = { db, companyId: 'company-a', apiBaseUrl: 'https://erp.example.test', getToken: async () => 'token', fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return { ok: true, json: async () => ({ records: [], results: [{ idempotencyKey: 'operation', status: 'OK' }] }) }
    } }
    await new SyncEngine(options).push()
    await new LedgerSyncAdapter({ ...options, ledgerStore: {} }).pull()
    assert.equal(requests.length, 2)
    assert.ok(requests.every(r => r.options.headers['X-Runly-Company-Id'] === 'company-a'))
  } finally { await db.delete() }
})

test('sync waits for a selected company instead of sending an invalid request', async () => {
  const options = { db: {}, apiBaseUrl: 'https://erp.example.test', getToken: async () => 'token', fetchImpl: () => assert.fail('must not fetch without a company') }
  await new SyncEngine(options).pull({ modules: ['runly.contacts'] })
  await new SyncEngine(options).push()
  await new LedgerSyncAdapter(options).pull()
})
