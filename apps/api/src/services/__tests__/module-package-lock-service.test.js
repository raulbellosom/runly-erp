import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { acquireModuleLock, hasActiveLock, ModulePackageLockBusyError, STALE_LOCK_TTL_MS, MALFORMED_LOCK_GRACE_MS } from '../module-package-lock-service.js'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..')

async function tempModulesDir(t) {
  const root = await fs.mkdtemp(path.join(REPO_ROOT, '.tmp-lock-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

async function writeLock(modulesDir, key, owner) {
  const lockDir = path.join(modulesDir, '.locks', key)
  await fs.mkdir(lockDir, { recursive: true })
  if (owner !== undefined) await fs.writeFile(path.join(lockDir, 'owner.json'), JSON.stringify(owner))
  return lockDir
}

test('acquireModuleLock: no existing lock succeeds and writes owner metadata', async (t) => {
  const root = await tempModulesDir(t)
  const release = await acquireModuleLock(root, 'custom.a')
  const owner = JSON.parse(await fs.readFile(path.join(root, '.locks', 'custom.a', 'owner.json'), 'utf8'))
  assert.equal(owner.pid, process.pid)
  assert.equal(owner.hostname, os.hostname())
  assert.match(owner.operationId, /^[0-9a-f-]{36}$/)
  assert.ok(typeof owner.startedAt === 'string')
  await release()
  await assert.rejects(fs.access(path.join(root, '.locks', 'custom.a')))
})

test('active lock (same host, live pid) still produces MODULE_PACKAGE_BUSY', async (t) => {
  const root = await tempModulesDir(t)
  await writeLock(root, 'custom.a', { pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString() })
  await assert.rejects(acquireModuleLock(root, 'custom.a'), (error) => {
    assert.ok(error instanceof ModulePackageLockBusyError)
    assert.equal(error.details.reason, 'active_pid')
    return true
  })
})

test('abandoned lock (same host, dead pid) is recovered and a fresh publish can proceed', async (t) => {
  const root = await tempModulesDir(t)
  // Spawn and let a real child process exit so this pid is guaranteed dead,
  // not just "probably unallocated" — avoids any PID-reuse flakiness.
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
  const deadPid = child.pid
  await new Promise((resolve) => child.once('close', resolve))

  await writeLock(root, 'custom.a', { pid: deadPid, hostname: os.hostname(), startedAt: new Date().toISOString() })
  const release = await acquireModuleLock(root, 'custom.a')
  const owner = JSON.parse(await fs.readFile(path.join(root, '.locks', 'custom.a', 'owner.json'), 'utf8'))
  assert.equal(owner.pid, process.pid, 'the reclaiming process now owns the lock')
  await release()
})

test('stale lock (different host, TTL expired) is recovered', async (t) => {
  const root = await tempModulesDir(t)
  await writeLock(root, 'custom.a', {
    pid: 4242,
    hostname: 'some-other-host',
    startedAt: new Date(Date.now() - STALE_LOCK_TTL_MS - 60_000).toISOString(),
  })
  const release = await acquireModuleLock(root, 'custom.a')
  await release()
})

test('young lock from an unverifiable host (within TTL) is NOT reclaimed', async (t) => {
  const root = await tempModulesDir(t)
  await writeLock(root, 'custom.a', { pid: 4242, hostname: 'some-other-host', startedAt: new Date().toISOString() })
  await assert.rejects(acquireModuleLock(root, 'custom.a'), (error) => {
    assert.ok(error instanceof ModulePackageLockBusyError)
    assert.equal(error.details.reason, 'ttl_pending')
    return true
  })
})

test('malformed lock (no owner.json) is conservative: kept within the grace window, reclaimed once clearly expired', async (t) => {
  const root = await tempModulesDir(t)
  await writeLock(root, 'custom.a', undefined)
  const createdAt = Date.now()

  // Still within the grace window (a healthy writer gets a moment between
  // mkdir and the owner.json write) -> conservative, treated as busy.
  await assert.rejects(acquireModuleLock(root, 'custom.a', { now: () => createdAt + 1_000 }), (error) => {
    assert.equal(error.details.reason, 'malformed_recent')
    return true
  })

  // Directory birthtime can't be rewritten from a test, so simulate time
  // passing with an injected clock instead of trying to backdate the
  // filesystem — classifyLock/acquireModuleLock both accept `now` for
  // exactly this reason.
  const release = await acquireModuleLock(root, 'custom.a', { now: () => createdAt + MALFORMED_LOCK_GRACE_MS + 1_000 })
  await release()
})

test('hasActiveLock: false when every lock present is stale, true when one is genuinely active', async (t) => {
  const root = await tempModulesDir(t)
  assert.equal(await hasActiveLock(root), false, 'no .locks directory at all')

  await writeLock(root, 'custom.stale', { pid: 4242, hostname: 'some-other-host', startedAt: new Date(Date.now() - STALE_LOCK_TTL_MS - 60_000).toISOString() })
  assert.equal(await hasActiveLock(root), false, 'only a stale lock present')

  await writeLock(root, 'custom.active', { pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString() })
  assert.equal(await hasActiveLock(root), true, 'one active lock among the entries')
})
