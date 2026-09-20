import { test } from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { RunlyOfflineDatabase } from '../db.js'
import { createDatabaseLifecycle } from '../database-lifecycle.js'

test('unmount during IndexedDB startup closes after opening without running sync', async () => {
  const database = new RunlyOfflineDatabase('lifecycle-startup')
  const lifecycle = createDatabaseLifecycle(database)
  let ran = false
  const task = lifecycle.run(async () => { ran = true })
  await lifecycle.dispose()
  await task
  assert.equal(ran, false)
  assert.equal(database.isOpen(), false)
  await database.delete()
})

test('unmount drains an in-flight sync and rejects new work before closing', async () => {
  const database = new RunlyOfflineDatabase('lifecycle-sync')
  const lifecycle = createDatabaseLifecycle(database)
  let release
  let entered
  const started = new Promise((resolve) => { entered = resolve })
  const network = new Promise((resolve) => { release = resolve })
  let activeAfterResponse
  const task = lifecycle.run(async (isActive) => {
    entered()
    await network
    // In-flight work may still finish its IndexedDB transaction after cleanup.
    await database.sync_state.toArray()
    activeAfterResponse = isActive()
  })
  await started
  const closing = lifecycle.dispose()
  assert.equal(database.isOpen(), true)
  await lifecycle.run(() => assert.fail('must not start another sync'))
  release()
  await Promise.all([task, closing])
  assert.equal(activeAfterResponse, false)
  assert.equal(database.isOpen(), false)
  await database.delete()
})

test('opening failure is handled and prevents sync', async () => {
  const failure = new Error('IndexedDB unavailable')
  let reported
  let closed = false
  const lifecycle = createDatabaseLifecycle({ open: async () => { throw failure }, close: () => { closed = true } }, (error) => { reported = error })
  await lifecycle.run(() => assert.fail('must not use an unopened database'))
  await lifecycle.dispose()
  assert.equal(reported, failure)
  assert.equal(closed, true)
})
