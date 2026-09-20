import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { RunlyOfflineDatabase } from '../db.js'
import { SyncEngine } from '../sync-engine.js'

const COMPANY_ID = '01900000-0000-7000-8000-000000000001'
let dbCounter = 0

function makeDb() {
  return new RunlyOfflineDatabase(`test-sync-engine-${++dbCounter}`)
}

function makeResponse(records, nextCursor = '2026-06-06T10:00:00Z') {
  return { records, nextCursor, hasMore: false }
}

function makeFetch(response) {
  return async (_url, _opts) => ({
    ok: true,
    json: async () => response,
  })
}

describe('SyncEngine', () => {
  let db

  beforeEach(async () => {
    db = makeDb()
    await db.open()
  })

  afterEach(async () => {
    await db.delete().catch(() => {})
  })

  it('stores pulled records in offline_records', async () => {
    const record = {
      moduleKey: 'runly.contacts',
      entityType: 'contact',
      id: 'c1',
      data: { id: 'c1', name: 'Ana', companyId: COMPANY_ID },
      version: '2026-06-06T10:00:00Z',
      deleted: false,
    }
    const engine = new SyncEngine({ companyId: COMPANY_ID,
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      fetchImpl: makeFetch(makeResponse([record])),
    })

    const { pulled } = await engine.pull({ modules: ['runly.contacts'] })
    assert.equal(pulled, 1)

    const stored = await db.offline_records.get(['runly.contacts', 'contact', 'c1'])
    assert.ok(stored)
    assert.equal(stored.data.name, 'Ana')
    assert.equal(stored.dirty, false)
  })

  it('updates sync_state with nextCursor after pull', async () => {
    const record = {
      moduleKey: 'runly.contacts',
      entityType: 'contact',
      id: 'c1',
      data: { id: 'c1', companyId: COMPANY_ID },
      version: '2026-06-06T10:00:00Z',
      deleted: false,
    }
    const engine = new SyncEngine({ companyId: COMPANY_ID,
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      fetchImpl: makeFetch(makeResponse([record], '2026-06-06T10:00:00Z')),
    })

    await engine.pull({ modules: ['runly.contacts'] })

    const state = await db.sync_state.get(['runly.contacts', 'contact'])
    assert.ok(state)
    assert.equal(state.serverCursor, '2026-06-06T10:00:00Z')
    assert.ok(state.lastPullAt)
  })

  it('removes deleted records from offline_records', async () => {
    await db.offline_records.put({
      moduleKey: 'runly.contacts',
      entityType: 'contact',
      id: 'c1',
      data: {},
      version: '2026-06-01T00:00:00Z',
      pulledAt: '2026-06-01T00:00:00Z',
      companyId: COMPANY_ID,
      dirty: false,
    })

    const tombstone = {
      moduleKey: 'runly.contacts',
      entityType: 'contact',
      id: 'c1',
      deleted: true,
      data: null,
      version: '2026-06-06T10:00:00Z',
    }
    const engine = new SyncEngine({ companyId: COMPANY_ID,
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      fetchImpl: makeFetch(makeResponse([tombstone])),
    })

    await engine.pull({ modules: ['runly.contacts'] })

    const stored = await db.offline_records.get(['runly.contacts', 'contact', 'c1'])
    assert.equal(stored, undefined)
  })

  it('sends stored cursor in the pull request URL', async () => {
    const cursor = '2026-06-05T00:00:00Z'
    await db.sync_state.put({
      moduleKey: 'runly.contacts',
      entityType: 'contact',
      lastPullAt: cursor,
      serverCursor: cursor,
      schemaVersion: null,
    })

    let capturedUrl = null
    const engine = new SyncEngine({ companyId: COMPANY_ID,
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      fetchImpl: async (url) => {
        capturedUrl = url
        return { ok: true, json: async () => makeResponse([]) }
      },
    })

    await engine.pull({ modules: ['runly.contacts'] })
    assert.ok(capturedUrl.includes(`cursor=${encodeURIComponent(cursor)}`))
  })

  it('skips network call when getToken returns null', async () => {
    let fetchCalled = false
    const engine = new SyncEngine({ companyId: COMPANY_ID,
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => null,
      fetchImpl: async () => { fetchCalled = true; return { ok: true, json: async () => ({}) } },
    })

    const result = await engine.pull({ modules: ['runly.contacts'] })
    assert.equal(result.pulled, 0)
    assert.equal(fetchCalled, false)
  })

  it('throws on non-ok HTTP response', async () => {
    const engine = new SyncEngine({ companyId: COMPANY_ID,
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    })

    await assert.rejects(() => engine.pull({ modules: ['runly.contacts'] }), /Pull failed/)
  })

  it('getLocalCount returns 0 on empty table', async () => {
    const engine = new SyncEngine({ companyId: COMPANY_ID,
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      fetchImpl: makeFetch(makeResponse([])),
    })
    const count = await engine.getLocalCount({ moduleKey: 'runly.contacts', entityType: 'contact' })
    assert.equal(count, 0)
  })

  it('concurrent pull calls are coalesced — second returns immediately without fetching', async () => {
    let fetchCount = 0
    let resolveFetch
    const fetchImpl = async () => {
      fetchCount++
      // Hold the first fetch until released
      await new Promise((resolve) => { resolveFetch = resolve })
      return { ok: true, json: async () => makeResponse([]) }
    }
    const engine = new SyncEngine({ companyId: COMPANY_ID, db, apiBaseUrl: 'http://localhost:4010', getToken: async () => 'tok', fetchImpl })

    // Start first pull — #pulling becomes true synchronously before any await
    const first = engine.pull({ modules: ['runly.contacts'] })
    // Second call should return immediately (guard kicks in)
    const second = await engine.pull({ modules: ['runly.contacts'] })
    assert.deepEqual(second, { pulled: 0, nextCursor: null })

    // Poll until the first pull has reached fetchImpl (resolveFetch is assigned)
    // Each tick gives the first pull a chance to advance through its awaits
    while (typeof resolveFetch !== 'function') {
      await new Promise((r) => setImmediate(r))
    }

    // Release the first fetch and let it complete
    resolveFetch()
    await first

    // Only one fetch was ever started (the second pull was coalesced)
    assert.equal(fetchCount, 1)
  })

  // ─── push() tests ───────────────────────────────────────────────────────────

  it('push returns { pushed: 0, failed: 0 } when mutation queue is empty', async () => {
    const engine = new SyncEngine({ companyId: COMPANY_ID,
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      fetchImpl: makeFetch({ results: [] }),
    })
    const result = await engine.push()
    assert.deepEqual(result, { pushed: 0, failed: 0 })
  })

  it('push returns { pushed: 0, failed: 0 } when getToken returns null', async () => {
    await db.mutation_queue.put({
      id: 'mut-1', idempotencyKey: 'ik-1', moduleKey: 'runly.contacts',
      entityType: 'contact', recordId: null, operation: 'CREATE',
      payload: { name: 'X' }, status: 'PENDING', queuedAt: '2026-06-06T10:00:00Z',
      attempts: 0, lastError: null, companyId: COMPANY_ID, userId: 'u1',
    })
    const engine = new SyncEngine({ companyId: COMPANY_ID,
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => null,
      fetchImpl: async () => { throw new Error('should not be called') },
    })
    const result = await engine.push()
    assert.deepEqual(result, { pushed: 0, failed: 0 })
  })

  it('concurrent push calls are coalesced — second returns immediately', async () => {
    await db.mutation_queue.put({
      id: 'mut-1', idempotencyKey: 'ik-1', moduleKey: 'runly.contacts',
      entityType: 'contact', recordId: null, operation: 'CREATE',
      payload: {}, status: 'PENDING', queuedAt: '2026-06-06T10:00:00Z',
      attempts: 0, lastError: null, companyId: COMPANY_ID, userId: 'u1',
    })

    let resolvePush
    const fetchImpl = async () => {
      await new Promise((resolve) => { resolvePush = resolve })
      return { ok: true, json: async () => ({ results: [{ idempotencyKey: 'ik-1', status: 'OK', record: { id: 'c1', companyId: COMPANY_ID, updatedAt: '2026-06-06T10:00:00Z' } }] }) }
    }
    const engine = new SyncEngine({ companyId: COMPANY_ID, db, apiBaseUrl: 'http://localhost:4010', getToken: async () => 'tok', fetchImpl })

    const first = engine.push()
    const second = await engine.push()
    assert.deepEqual(second, { pushed: 0, failed: 0 })

    while (typeof resolvePush !== 'function') {
      await new Promise((r) => setImmediate(r))
    }
    resolvePush()
    await first
  })

  it('successful OK result marks mutation DONE and updates offline_records', async () => {
    await db.mutation_queue.put({
      id: 'mut-1', idempotencyKey: 'ik-1', moduleKey: 'runly.contacts',
      entityType: 'contact', recordId: null, operation: 'CREATE',
      payload: { name: 'Ana' }, status: 'PENDING', queuedAt: '2026-06-06T10:00:00Z',
      attempts: 0, lastError: null, companyId: COMPANY_ID, userId: 'u1',
    })

    const serverRecord = { id: 'srv-c1', companyId: COMPANY_ID, name: 'Ana', updatedAt: '2026-06-06T10:00:00Z' }
    const engine = new SyncEngine({ companyId: COMPANY_ID,
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      fetchImpl: async (_url, opts) => {
        assert.ok(opts.method === 'POST')
        return { ok: true, json: async () => ({ results: [{ idempotencyKey: 'ik-1', status: 'OK', record: serverRecord }] }) }
      },
    })

    const result = await engine.push()
    assert.deepEqual(result, { pushed: 1, failed: 0 })

    const mut = await db.mutation_queue.get('mut-1')
    assert.equal(mut.status, 'DONE')

    const stored = await db.offline_records.get(['runly.contacts', 'contact', 'srv-c1'])
    assert.ok(stored)
    assert.equal(stored.dirty, false)
    assert.equal(stored.data.name, 'Ana')
  })

  it('CONFLICT result marks mutation CONFLICT', async () => {
    await db.mutation_queue.put({
      id: 'mut-1', idempotencyKey: 'ik-1', moduleKey: 'runly.contacts',
      entityType: 'contact', recordId: 'c1', operation: 'UPDATE',
      payload: { name: 'New' }, status: 'PENDING', queuedAt: '2026-06-06T10:00:00Z',
      attempts: 0, lastError: null, companyId: COMPANY_ID, userId: 'u1',
    })

    const engine = new SyncEngine({ companyId: COMPANY_ID,
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ results: [{ idempotencyKey: 'ik-1', status: 'CONFLICT', record: null }] }),
      }),
    })

    const result = await engine.push()
    assert.deepEqual(result, { pushed: 0, failed: 1 })

    const mut = await db.mutation_queue.get('mut-1')
    assert.equal(mut.status, 'CONFLICT')
  })

  it('non-OK HTTP response marks all pending as failed', async () => {
    await db.mutation_queue.put({
      id: 'mut-1', idempotencyKey: 'ik-1', moduleKey: 'runly.contacts',
      entityType: 'contact', recordId: null, operation: 'CREATE',
      payload: {}, status: 'PENDING', queuedAt: '2026-06-06T10:00:00Z',
      attempts: 0, lastError: null, companyId: COMPANY_ID, userId: 'u1',
    })

    const engine = new SyncEngine({ companyId: COMPANY_ID,
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    })

    await assert.rejects(() => engine.push(), /Push failed/)
    const mut = await db.mutation_queue.get('mut-1')
    assert.equal(mut.attempts, 1)
  })

  it('NOT_FOUND result increments attempts via markFailed', async () => {
    await db.mutation_queue.put({
      id: 'mut-1', idempotencyKey: 'ik-1', moduleKey: 'runly.contacts',
      entityType: 'contact', recordId: 'ghost', operation: 'UPDATE',
      payload: {}, status: 'PENDING', queuedAt: '2026-06-06T10:00:00Z',
      attempts: 0, lastError: null, companyId: COMPANY_ID, userId: 'u1',
    })

    const engine = new SyncEngine({ companyId: COMPANY_ID,
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ results: [{ idempotencyKey: 'ik-1', status: 'NOT_FOUND', record: null }] }),
      }),
    })

    const result = await engine.push()
    assert.deepEqual(result, { pushed: 0, failed: 1 })
    const mut = await db.mutation_queue.get('mut-1')
    assert.equal(mut.attempts, 1)
  })

  it('batch with OK + CONFLICT returns correct pushed/failed counts', async () => {
    await db.mutation_queue.put({
      id: 'mut-a', idempotencyKey: 'ik-a', moduleKey: 'runly.contacts',
      entityType: 'contact', recordId: null, operation: 'CREATE',
      payload: {}, status: 'PENDING', queuedAt: '2026-06-06T10:00:00Z',
      attempts: 0, lastError: null, companyId: COMPANY_ID, userId: 'u1',
    })
    await db.mutation_queue.put({
      id: 'mut-b', idempotencyKey: 'ik-b', moduleKey: 'runly.contacts',
      entityType: 'contact', recordId: 'c2', operation: 'UPDATE',
      payload: {}, status: 'PENDING', queuedAt: '2026-06-06T10:01:00Z',
      attempts: 0, lastError: null, companyId: COMPANY_ID, userId: 'u1',
    })

    const engine = new SyncEngine({ companyId: COMPANY_ID,
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          results: [
            { idempotencyKey: 'ik-a', status: 'OK', record: { id: 'srv-a', companyId: COMPANY_ID, updatedAt: '2026-06-06T10:00:00Z' } },
            { idempotencyKey: 'ik-b', status: 'CONFLICT', record: null },
          ],
        }),
      }),
    })

    const result = await engine.push()
    assert.deepEqual(result, { pushed: 1, failed: 1 })
  })

  it('CONFLICT result writes entry to conflicts table with localData and serverData', async () => {
    await db.offline_records.put({
      moduleKey: 'runly.contacts',
      entityType: 'contact',
      id: 'c1',
      data: { id: 'c1', name: 'Local Name', companyId: COMPANY_ID, updatedAt: '2026-06-06T09:00:00.000Z' },
      version: '2026-06-06T09:00:00.000Z',
      pulledAt: '2026-06-06T09:00:00.000Z',
      companyId: COMPANY_ID,
      dirty: true,
    })
    await db.mutation_queue.put({
      id: 'mut-conflict-1',
      idempotencyKey: 'ik-conflict-1',
      moduleKey: 'runly.contacts',
      entityType: 'contact',
      recordId: 'c1',
      operation: 'UPDATE',
      payload: { name: 'Local Name' },
      status: 'PENDING',
      queuedAt: '2026-06-06T10:00:00.000Z',
      attempts: 0,
      lastError: null,
      companyId: COMPANY_ID,
      userId: 'u1',
      clientUpdatedAt: '2026-06-06T09:00:00.000Z',
    })

    const serverRecord = { id: 'c1', name: 'Server Name', companyId: COMPANY_ID, updatedAt: '2026-06-06T10:30:00.000Z' }

    const engine = new SyncEngine({ companyId: COMPANY_ID,
      db,
      apiBaseUrl: 'http://localhost:4010',
      getToken: async () => 'tok',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          results: [{ idempotencyKey: 'ik-conflict-1', status: 'CONFLICT', record: serverRecord }],
        }),
      }),
    })

    const result = await engine.push()
    assert.deepEqual(result, { pushed: 0, failed: 1 })

    const mut = await db.mutation_queue.get('mut-conflict-1')
    assert.equal(mut.status, 'CONFLICT')

    const conflicts = await db.conflicts.where('status').equals('PENDING').toArray()
    assert.equal(conflicts.length, 1)
    assert.equal(conflicts[0].mutationId, 'mut-conflict-1')
    assert.equal(conflicts[0].recordId, 'c1')
    assert.equal(conflicts[0].moduleKey, 'runly.contacts')
    assert.ok(conflicts[0].localData, 'localData must be present')
    assert.equal(conflicts[0].localData.name, 'Local Name')
    assert.ok(conflicts[0].serverData, 'serverData must be present')
    assert.equal(conflicts[0].serverData.name, 'Server Name')
    assert.equal(conflicts[0].status, 'PENDING')
    assert.ok(conflicts[0].detectedAt)
  })
})
