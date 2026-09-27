// Filesystem-based publish lock for a single module key, with stale/
// abandoned-lock recovery. Shared by module-package-service.js (acquires
// the lock for the duration of a publish) and
// module-package-staging-service.js's cleanupStaleStaging (which must not
// touch .staging/.backups while any publish could still be using them, but
// previously treated *any* lock directory anywhere as reason to skip all
// cleanup — including one abandoned by a crashed process for a completely
// different module key).
//
// Recovery strategy (deliberately conservative — never reclaim a lock that
// could reasonably belong to a live publish):
//   1. Same host, live PID (process.kill(pid, 0) succeeds) -> ACTIVE.
//   2. Same host, dead PID (ESRCH) -> ABANDONED, safe to reclaim.
//   3. Different host, or PID liveness can't be checked (EPERM, or the
//      metadata just doesn't have enough to identify the owner) -> fall
//      back to a conservative age TTL. Only reclaim once the lock has
//      clearly outlived any real publish.
//   4. Missing/unparseable owner.json (mkdir succeeded but the writeFile
//      right after it hasn't landed, or a crash happened between the two)
//      -> give it a short grace window to finish being written, then treat
//      it the same as case 3.
//
// Found during Module Builder golden-path QA stabilization: a killed
// process mid-publish left `.locks/<key>/` behind with no expiry, which
// made every later publish for that key 409 forever until someone deleted
// the directory by hand.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const STALE_LOCK_TTL_MS = 10 * 60 * 1000
export const MALFORMED_LOCK_GRACE_MS = 30 * 1000

export class ModulePackageLockBusyError extends Error {
  constructor(details = {}) {
    super('MODULE_PACKAGE_BUSY')
    this.name = 'ModulePackageLockBusyError'
    this.code = 'MODULE_PACKAGE_BUSY'
    this.details = details
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // ESRCH: no such process -> definitely dead. Anything else (most
    // commonly EPERM, meaning it exists but we can't signal it) can't be
    // proven dead, so treat it as alive — the conservative choice.
    return error?.code !== 'ESRCH'
  }
}

async function readLockOwner(lockDir) {
  try {
    const raw = await fs.readFile(path.join(lockDir, 'owner.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export async function classifyLock(lockDir, { now = () => Date.now() } = {}) {
  const owner = await readLockOwner(lockDir)
  const stat = await fs.stat(lockDir).catch(() => null)
  if (!stat) return { stale: true, reason: 'missing', owner: null }
  const dirAgeMs = now() - stat.birthtimeMs

  if (!owner || typeof owner.startedAt !== 'string') {
    return dirAgeMs > MALFORMED_LOCK_GRACE_MS
      ? { stale: true, reason: 'malformed_expired', owner }
      : { stale: false, reason: 'malformed_recent', owner }
  }

  const startedAtMs = Date.parse(owner.startedAt)
  const ageMs = Number.isFinite(startedAtMs) ? now() - startedAtMs : dirAgeMs

  if (owner.hostname && owner.hostname === os.hostname() && Number.isInteger(owner.pid)) {
    return isPidAlive(owner.pid)
      ? { stale: false, reason: 'active_pid', owner }
      : { stale: true, reason: 'abandoned_pid', owner }
  }

  return ageMs > STALE_LOCK_TTL_MS
    ? { stale: true, reason: 'ttl_expired', owner }
    : { stale: false, reason: 'ttl_pending', owner }
}

// Acquires the on-disk lock for `key`, reclaiming it first if classifyLock
// finds it stale/abandoned. Returns a release() function. Throws
// ModulePackageLockBusyError (never a bare EEXIST) when the lock is held by
// what looks like a genuinely active publish.
export async function acquireModuleLock(modulesDir, key, { now } = {}) {
  const lockRoot = path.join(modulesDir, '.locks')
  const lockDir = path.join(lockRoot, key)
  await fs.mkdir(lockRoot, { recursive: true })

  async function create() {
    await fs.mkdir(lockDir)
    const owner = { pid: process.pid, hostname: os.hostname(), operationId: randomUUID(), startedAt: new Date().toISOString() }
    await fs.writeFile(path.join(lockDir, 'owner.json'), JSON.stringify(owner))
    return async () => fs.rm(lockDir, { recursive: true, force: true })
  }

  try {
    return await create()
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }

  const classification = await classifyLock(lockDir, { now })
  if (!classification.stale) {
    throw new ModulePackageLockBusyError({ key, ...classification })
  }

  // Reclaim: remove the abandoned/stale lock and try exactly once more. A
  // second EEXIST means another process reclaimed or re-acquired it in the
  // same window — back off with the same busy error rather than fighting
  // over it.
  await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {})
  try {
    return await create()
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new ModulePackageLockBusyError({ key, reason: 'race_on_reclaim' })
    }
    throw error
  }
}

// Used by cleanupStaleStaging: true only if some module key currently has a
// lock that classifyLock considers active — never true just because a
// `.locks` directory has entries in it.
export async function hasActiveLock(modulesDir, { now } = {}) {
  const lockRoot = path.join(modulesDir, '.locks')
  const entries = await fs.readdir(lockRoot, { withFileTypes: true }).catch((error) => (error?.code === 'ENOENT' ? [] : Promise.reject(error)))
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const classification = await classifyLock(path.join(lockRoot, entry.name), { now })
    if (!classification.stale) return true
  }
  return false
}
