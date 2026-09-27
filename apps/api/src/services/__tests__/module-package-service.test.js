import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createModulePackageService } from '../module-package-service.js'
import { computeSourceHash } from '../module-bundler-service.js'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..')

// computeSourceHash() only hashes each file's path *relative to the hashed
// directory* plus its content, so the hash of a lone "version.txt" file is
// the same no matter which directory holds it — safe to precompute once
// against a throwaway directory and reuse as the "staged" packageHash a
// pre-existing `current` directory with matching content should equal.
async function hashOfSingleFile(t, filename, content) {
  const dir = await fs.mkdtemp(path.join(REPO_ROOT, '.tmp-hash-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  await fs.writeFile(path.join(dir, filename), content)
  return computeSourceHash(dir)
}

async function fixture(t, {
  status = 'INSTALLED',
  enabled = true,
  currentExists = true,
  preflight = async () => ({}),
  reconcile = async () => ({ ok: true }),
  applySchemaMigration = async () => ({ applied: false, reason: 'not_configured' }),
  packageHash = 'new-hash',
} = {}) {
  const root = await fs.mkdtemp(path.join(REPO_ROOT, '.tmp-publish-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const key = 'custom.atomic'
  const current = path.join(root, key)
  if (currentExists) {
    await fs.mkdir(current)
    await fs.writeFile(path.join(current, 'version.txt'), 'v1')
  }
  const routeCalls = []
  const state = { bundle: 'old' }
  const stagingService = {
    cleanupStaleStaging: async () => [],
    cleanupStage: async (staged) => staged?.operationDir && fs.rm(staged.operationDir, { recursive: true, force: true }),
    stageZipPackage: async () => {
      const operationId = randomUUID()
      const operationDir = path.join(root, '.staging', operationId)
      const packageDir = path.join(operationDir, 'package')
      await fs.mkdir(packageDir, { recursive: true })
      await fs.writeFile(path.join(packageDir, 'version.txt'), 'v2')
      return {
        operationId, operationDir, packageDir,
        packageHash,
        manifest: { key, version: '2.0.0', dependencies: [], models: [] },
        models: [], views: [],
        inspection: { moduleKey: key, version: '2.0.0', files: 1, hasComponents: false },
      }
    },
  }
  const bundlerSvc = {
    buildBundleFromDirectory: async () => ({ built: false, hash: null }),
    snapshotPublishedBundle: async () => ({ content: Buffer.from('old'), hasBundle: true, bundleHash: 'old-hash' }),
    publishStagedBundle: async () => { state.bundle = 'new' },
    restorePublishedBundle: async () => { state.bundle = 'old' },
  }
  const routeLoader = {
    unloadModule: (moduleKey) => routeCalls.push(['unload', moduleKey]),
    reloadModule: async (moduleKey) => { routeCalls.push(['reload', moduleKey]); return { loaded: true } },
  }
  const auditCalls = []
  const prisma = {
    runlyModule: {
      findUnique: async () => ({ key, status, enabled, version: '1.0.0', manifest: { models: [] } }),
      update: async () => ({}),
    },
    auditLog: { create: async ({ data }) => { auditCalls.push(data); return {} } },
  }
  const service = createModulePackageService({
    prisma, stagingService, bundlerSvc, routeLoader,
    preflightPackage: preflight,
    reconcilePublishedPackage: reconcile,
    reconcileRestoredPackage: async () => ({}),
    applySchemaMigration,
    cacheInvalidator: async () => [],
  })
  return { root, key, current, service, bundlerSvc, routeLoader, routeCalls, state, auditCalls }
}

test('publishes a first package without installing or activating it', async (t) => {
  const ctx = await fixture(t, { status: 'UNINSTALLED', enabled: false, currentExists: false })
  const result = await ctx.service.publishZip({ key: ctx.key, fileBuffer: Buffer.of(1), modulesDir: ctx.root })
  assert.equal(result.outcome, 'PUBLISHED')
  assert.equal(await fs.readFile(path.join(ctx.current, 'version.txt'), 'utf8'), 'v2')
  assert.deepEqual(ctx.routeCalls, [])
})

// Regression: AuditLog.entityId is @db.Uuid — passing the moduleKey string
// there (not a UUID) crashed every real-Postgres first-time publish with a
// raw "invalid input syntax for type uuid" error. The mocked prisma.auditLog
// above never enforced this, which is exactly why it went undetected until
// golden-path QA against the real database. moduleKey (a plain string
// column) already identifies the row, so entityId should simply be absent.
test('never sends a non-UUID entityId to AuditLog', async (t) => {
  const ctx = await fixture(t, { status: 'UNINSTALLED', enabled: false, currentExists: false })
  await ctx.service.publishZip({ key: ctx.key, fileBuffer: Buffer.of(1), modulesDir: ctx.root })
  assert.ok(ctx.auditCalls.length > 0)
  for (const call of ctx.auditCalls) assert.equal(call.entityId, undefined)
})

// Regression: a lock left behind by a crashed publish (module-package-lock-
// service.js) used to 409 every later publish for that key forever. Proves
// the recovery path from the caller's point of view: publishZip itself
// must succeed once the stale lock is reclaimed, not just the lock
// primitive in isolation (module-package-lock-service.test.js covers that).
test('publishZip recovers from a stale lock left by a crashed process', async (t) => {
  const ctx = await fixture(t, { status: 'UNINSTALLED', enabled: false, currentExists: false })
  const lockDir = path.join(ctx.root, '.locks', ctx.key)
  await fs.mkdir(lockDir, { recursive: true })
  await fs.writeFile(path.join(lockDir, 'owner.json'), JSON.stringify({
    pid: 4242, hostname: 'some-other-crashed-host', startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  }))
  const result = await ctx.service.publishZip({ key: ctx.key, fileBuffer: Buffer.of(1), modulesDir: ctx.root })
  assert.equal(result.outcome, 'PUBLISHED')
})

// Regression: NO_CHANGES used to mean "package bytes match -> return
// immediately", skipping preflight/reconcile/schema entirely — including
// when the skip itself was the reason state was inconsistent (a process
// that died right after the file swap but before metadata reconcile). This
// simulates exactly that end state directly (current dir already holding
// the "v2" content publishZip would stage, without ever having gone
// through reconcile) and proves a later publish of identical content still
// reconciles metadata/bundle/runtime, not just the package bytes.
test('NO_CHANGES still reconciles metadata, bundle and runtime when the DB schema already matches', async (t) => {
  const matchingHash = await hashOfSingleFile(t, 'version.txt', 'v2')
  const ctx = await fixture(t, { status: 'INSTALLED', enabled: true, currentExists: false, packageHash: matchingHash })
  await fs.mkdir(ctx.current)
  await fs.writeFile(path.join(ctx.current, 'version.txt'), 'v2') // matches stageZipPackage's staged output exactly

  const result = await ctx.service.publishZip({
    key: ctx.key, fileBuffer: Buffer.of(1), modulesDir: ctx.root, actorId: null,
  })
  assert.equal(result.outcome, 'NO_CHANGES')
  assert.deepEqual(result.reconciliation, {
    packageChanged: false, schemaApplied: false, metadataReconciled: true, bundleRepublished: false, runtimeReloaded: true,
  })
  assert.deepEqual(ctx.routeCalls, [['unload', ctx.key], ['reload', ctx.key]], 'runtime is still reloaded even though nothing changed on disk')
})

test('NO_CHANGES still applies a schema migration the DB is genuinely missing (crash before APPLY_SCHEMA_MIGRATION, retried with identical content)', async (t) => {
  const matchingHash = await hashOfSingleFile(t, 'version.txt', 'v2')
  const appliedPlans = []
  const ctx = await fixture(t, {
    status: 'INSTALLED', enabled: true, currentExists: false, packageHash: matchingHash,
    preflight: async () => ({ schemaMigration: { required: true, canAutoApply: true, safety: 'SAFE', operations: [{ type: 'ADD_COLUMN' }], drift: [], warnings: [] } }),
    applySchemaMigration: async ({ plan }) => { appliedPlans.push(plan); return { applied: true, migration: { id: 'mig-1' } } },
  })
  await fs.mkdir(ctx.current)
  await fs.writeFile(path.join(ctx.current, 'version.txt'), 'v2')

  const result = await ctx.service.publishZip({ key: ctx.key, fileBuffer: Buffer.of(1), modulesDir: ctx.root })
  assert.equal(result.outcome, 'NO_CHANGES')
  assert.equal(appliedPlans.length, 1, 'the missing migration is applied exactly once even though the package itself needed no swap')
  assert.equal(result.reconciliation.schemaApplied, true)
})

test('atomically updates a package and removes staging and backup after success', async (t) => {
  const ctx = await fixture(t)
  const result = await ctx.service.publishZip({ key: ctx.key, fileBuffer: Buffer.of(1), modulesDir: ctx.root })
  assert.equal(result.outcome, 'UPDATED')
  assert.equal(await fs.readFile(path.join(ctx.current, 'version.txt'), 'utf8'), 'v2')
  assert.deepEqual(await fs.readdir(path.join(ctx.root, '.staging')), [])
  assert.deepEqual(await fs.readdir(path.join(ctx.root, '.backups')), [])
  assert.deepEqual(ctx.routeCalls, [['unload', ctx.key], ['reload', ctx.key]])
})

test('bundle preflight failure leaves the old package and runtime untouched', async (t) => {
  const ctx = await fixture(t)
  ctx.bundlerSvc.buildBundleFromDirectory = async () => { throw new Error('bad JSX') }
  await assert.rejects(
    ctx.service.publishZip({ key: ctx.key, fileBuffer: Buffer.of(1), modulesDir: ctx.root }),
    (error) => error.details.failedStage === 'BUILD_BUNDLE' && error.details.originalPackagePreserved,
  )
  assert.equal(await fs.readFile(path.join(ctx.current, 'version.txt'), 'utf8'), 'v1')
  assert.deepEqual(ctx.routeCalls, [])
})

test('dependency preflight failure leaves the old package untouched', async (t) => {
  const ctx = await fixture(t, { preflight: async () => { throw new Error('DEPENDENCY_CYCLE_DETECTED') } })
  await assert.rejects(
    ctx.service.publishZip({ key: ctx.key, fileBuffer: Buffer.of(1), modulesDir: ctx.root }),
    (error) => error.details.failedStage === 'PREFLIGHT' && error.details.originalPackagePreserved,
  )
  assert.equal(await fs.readFile(path.join(ctx.current, 'version.txt'), 'utf8'), 'v1')
})

test('bundle or runtime publication failure restores old package, bundle and runtime', async (t) => {
  const ctx = await fixture(t)
  let reloads = 0
  ctx.routeLoader.reloadModule = async () => {
    reloads += 1
    return reloads === 1 ? { loaded: false, error: 'new route broken' } : { loaded: true }
  }
  await assert.rejects(
    ctx.service.publishZip({ key: ctx.key, fileBuffer: Buffer.of(1), modulesDir: ctx.root }),
    (error) => error.details.failedStage === 'RELOAD_RUNTIME'
      && error.details.previousPackageRestored
      && error.details.bundleRestored
      && error.details.runtimeRestored,
  )
  assert.equal(await fs.readFile(path.join(ctx.current, 'version.txt'), 'utf8'), 'v1')
  assert.equal(ctx.state.bundle, 'old')
})

test('reports rollback failure explicitly', async (t) => {
  const ctx = await fixture(t)
  ctx.bundlerSvc.publishStagedBundle = async () => { throw new Error('storage unavailable') }
  ctx.bundlerSvc.restorePublishedBundle = async () => { throw new Error('restore unavailable') }
  await assert.rejects(
    ctx.service.publishZip({ key: ctx.key, fileBuffer: Buffer.of(1), modulesDir: ctx.root }),
    (error) => error.stage === 'ROLLBACK'
      && error.details.failedStage === 'PUBLISH_BUNDLE'
      && error.details.rollbackError === 'restore unavailable',
  )
})

test('preserves disabled lifecycle and serializes publication by module key', async (t) => {
  let unblock
  const gate = new Promise((resolve) => { unblock = resolve })
  const ctx = await fixture(t, { status: 'INSTALLED', enabled: false, reconcile: () => gate })
  const first = ctx.service.publishZip({ key: ctx.key, fileBuffer: Buffer.of(1), modulesDir: ctx.root })
  await new Promise((resolve) => setTimeout(resolve, 20))
  await assert.rejects(
    ctx.service.publishZip({ key: ctx.key, fileBuffer: Buffer.of(2), modulesDir: ctx.root }),
    { code: 'MODULE_PACKAGE_BUSY' },
  )
  unblock({ ok: true })
  await first
  assert.deepEqual(ctx.routeCalls, [])
})
