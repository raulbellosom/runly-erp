import fs from 'node:fs/promises'
import path from 'node:path'
import { createChecksum } from '@runly/module-engine'
import { randomUUID } from 'node:crypto'
import { computeSourceHash } from './module-bundler-service.js'
import { buildUpdateReport, invalidPackageReport } from './module-update-report.js'
import { invalidateModuleCaches } from './module-cache-service.js'
import { acquireModuleLock as acquireModuleLockWithRecovery, ModulePackageLockBusyError } from './module-package-lock-service.js'

export class ModulePackagePublishError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'ModulePackagePublishError'
    this.code = details.code ?? 'MODULE_PACKAGE_PUBLISH_FAILED'
    this.stage = details.stage ?? 'UNKNOWN'
    this.statusCode = details.statusCode ?? 500
    this.details = details
  }
}

async function exists(target) {
  return fs.access(target).then(() => true, () => false)
}

// module-bundler-service.js keeps a recursive fs.watch() open on the whole
// custom modules root for hot-reload; on Windows, ReadDirectoryChangesW
// handles from that watch can make fs.rename() on a watched subdirectory
// fail with EPERM — sometimes transiently (a short retry clears it), but
// under an active watch it can also keep failing indefinitely (a known
// Node/Windows limitation, not specific to this codebase). POSIX doesn't
// have this failure mode. After exhausting quick retries, fall back to
// copy-then-remove, which achieves the same end state without needing the
// OS-level rename at all — not perfectly atomic (both paths briefly exist),
// but every caller here already treats the swap as the recoverable step in
// a larger saga with its own backup/rollback, so this doesn't weaken that.
// Found during golden-path QA: every update of an already-installed module
// failed here on Windows.
async function renameWithRetry(from, to, { attempts = 5, delayMs = 150 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fs.rename(from, to)
    } catch (error) {
      const transient = error?.code === 'EPERM' || error?.code === 'EBUSY'
      if (!transient) throw error
      if (attempt === attempts) {
        await fs.cp(from, to, { recursive: true })
        await fs.rm(from, { recursive: true, force: true })
        return
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

// Preview bundles built by checkZip live here, one folder per previewId,
// and are served by GET /modules/:key/preview/:previewId/bundle.js.
export const PREVIEWS_DIRNAME = '.previews'
export const PREVIEW_TTL_MS = 60 * 60 * 1000

export function previewBundlePath(modulesDir, key, previewId) {
  return path.join(modulesDir, PREVIEWS_DIRNAME, key, previewId, `${key}.js`)
}

async function removeExpiredPreviews(previewsDir, now = Date.now()) {
  const entries = await fs.readdir(previewsDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(previewsDir, entry.name)
    const stat = await fs.stat(dir).catch(() => null)
    if (stat && now - stat.mtimeMs > PREVIEW_TTL_MS) await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export function createModulePackageService({
  prisma,
  stagingService,
  bundlerSvc,
  routeLoader = null,
  preflightPackage = async () => ({}),
  applySchemaMigration = async () => ({ applied: false, reason: 'not_configured' }),
  reconcilePublishedPackage = async () => ({}),
  reconcileRestoredPackage = async () => ({}),
  cacheInvalidator = invalidateModuleCaches,
}) {
  async function acquireModuleLock(modulesDir, key) {
    try {
      return await acquireModuleLockWithRecovery(modulesDir, key)
    } catch (error) {
      if (error instanceof ModulePackageLockBusyError) {
        throw new ModulePackagePublishError('MODULE_PACKAGE_BUSY', {
          code: 'MODULE_PACKAGE_BUSY', stage: 'LOCK', statusCode: 409, originalPackagePreserved: true,
          lockClassification: error.details,
        })
      }
      throw error
    }
  }

  async function writeAudit({ action, key, actorId, before, after }) {
    if (!prisma.auditLog?.create) return
    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: key,
        entityType: 'RunlyModulePackage',
        // No entityId: AuditLog.entityId is @db.Uuid, and the moduleKey
        // string ("custom.foo") isn't one — moduleKey above already
        // identifies the row. Found during Builder golden-path QA: every
        // first-time publish (Builder or plain ZIP upload) reaches
        // writeAudit and crashed here with a raw Postgres UUID-syntax
        // error, invisible to the existing unit tests because their
        // prisma.auditLog.create mock doesn't enforce column types.
        action,
        before: before ? JSON.stringify(before) : null,
        after: after ? JSON.stringify(after) : null,
        metadata: null,
      },
    })
  }

  async function publishZip({ key, fileBuffer, modulesDir, actorId = null }) {
    await stagingService.cleanupStaleStaging(modulesDir)
    const release = await acquireModuleLock(modulesDir, key)
    let staged = null
    let backupDir = null
    let currentDir = path.join(modulesDir, key)
    let bundleSnapshot = null
    let packageSwapped = false
    let runtimeWasUnloaded = false
    let activeBefore = false
    let previousPackageExisted = false
    let stage = 'UPLOAD'
    try {
      stage = 'EXTRACT'
      staged = await stagingService.stageZipPackage({ key, fileBuffer, modulesDir })

      const moduleRow = await prisma.runlyModule.findUnique({
        where: { key },
        select: { id: true, key: true, status: true, enabled: true, version: true, manifest: true },
      }).catch(() => null)
      activeBefore = moduleRow?.status === 'INSTALLED' && moduleRow?.enabled === true
      const installed = moduleRow?.status === 'INSTALLED'
      const currentExists = await exists(currentDir)
      previousPackageExisted = currentExists
      const currentHash = currentExists ? await computeSourceHash(currentDir) : null
      const noChanges = currentHash === staged.packageHash
      let schemaChangesDetected = false
      if (installed && prisma.runlyModel?.findMany) {
        const persistedModels = await prisma.runlyModel.findMany({
          where: { moduleKey: key },
          select: { schema: true },
        })
        const persistedChecksums = persistedModels
          .map((row) => row.schema)
          .filter(Boolean)
          .map(createChecksum)
          .sort()
        const stagedChecksums = staged.models.map(createChecksum).sort()
        schemaChangesDetected = JSON.stringify(persistedChecksums) !== JSON.stringify(stagedChecksums)
      }
      const publicationPlan = {
        moduleKey: key,
        action: currentExists ? 'UPDATE_PACKAGE' : 'PUBLISH_PACKAGE',
        currentVersion: moduleRow?.version ?? null,
        nextVersion: staged.manifest.version,
        packageChanged: !noChanges,
        bundleChanged: staged.inspection.hasComponents,
        schemaChangesDetected,
        requiresSchemaMigration: schemaChangesDetected,
      }
      stage = 'PREFLIGHT'
      const preflight = await preflightPackage({ key, staged, moduleRow, publicationPlan })
      if (preflight.schemaMigration) {
        publicationPlan.schemaChangesDetected = preflight.schemaMigration.required === true
        publicationPlan.requiresSchemaMigration = preflight.schemaMigration.required === true
        publicationPlan.schemaMigration = preflight.schemaMigration
        await writeAudit({
          action: 'core.module.schema.plan', key, actorId,
          before: null,
          after: {
            planHash: preflight.schemaMigration.planHash,
            safety: preflight.schemaMigration.safety,
            operations: preflight.schemaMigration.operations,
          },
        })
        if (preflight.schemaMigration.drift?.length) {
          throw Object.assign(new Error('SCHEMA_DRIFT_DETECTED'), {
            code: 'SCHEMA_DRIFT_DETECTED', statusCode: 409, details: preflight.schemaMigration,
          })
        }
        if (preflight.schemaMigration.required && !preflight.schemaMigration.canAutoApply) {
          throw Object.assign(new Error('SCHEMA_MIGRATION_UNSUPPORTED'), {
            code: 'SCHEMA_MIGRATION_UNSUPPORTED', statusCode: 409, details: preflight.schemaMigration,
          })
        }
      }

      // NO_CHANGES means "the package bytes don't need replacing" — it does
      // NOT mean every piece of state derived from the package is already
      // reconciled. A process that dies after the file swap but before
      // metadata/bundle/runtime reconcile leaves exactly that gap, and a
      // later publish of byte-identical content used to hit the early
      // return above and skip reconcile *again*, forever. This still skips
      // the file swap (BUILD_BUNDLE/PUBLISH_PACKAGE/PUBLISH_BUNDLE) — the
      // bytes really do match — but runs the same preflight-driven schema
      // migration (only if the DB doesn't already match — SAFE inspects and
      // no-ops when it does), metadata sync, bundle republish and runtime
      // reload as a real publish, all through the same idempotent
      // primitives a real publish already relies on (ModuleMigration ledger
      // dedup, upsert-based metadata sync, cache invalidation). Found
      // during Module Builder golden-path stabilization.
      if (noChanges) {
        stage = 'APPLY_SCHEMA_MIGRATION'
        const schemaMigrationResult = preflight.schemaMigration?.required
          ? await applySchemaMigration({ key, plan: preflight.schemaMigration, staged, moduleRow, actorId })
          : { applied: false, reason: 'no_changes' }

        stage = 'PUBLISH_BUNDLE'
        let bundleRepublished = false
        if (staged.inspection.hasComponents) {
          const stagedBundle = await bundlerSvc.buildBundleFromDirectory(key, staged.packageDir, {
            outputDir: path.join(staged.operationDir, 'bundle'),
          })
          await bundlerSvc.publishStagedBundle(key, stagedBundle)
          bundleRepublished = stagedBundle.built === true
          await prisma.runlyModule.update({
            where: { key },
            data: { hasBundle: stagedBundle.built === true, bundleHash: stagedBundle.built ? stagedBundle.hash : null },
          }).catch((error) => {
            if (error?.code !== 'P2025') throw error
          })
        }

        stage = 'RECONCILE_METADATA'
        const reconcileResult = await reconcilePublishedPackage({ key, staged, moduleRow, activeBefore, publicationPlan, actorId })

        stage = 'RELOAD_RUNTIME'
        let runtimeResult = null
        if (activeBefore && routeLoader) {
          routeLoader.unloadModule(key)
          runtimeResult = await routeLoader.reloadModule(key)
          if (!runtimeResult?.loaded) throw new Error(runtimeResult?.error ?? 'RUNTIME_RELOAD_FAILED')
        }

        stage = 'CLEANUP'
        await cacheInvalidator()
        await writeAudit({
          action: 'core.module.package.reconcile',
          key, actorId, before: null,
          after: {
            packageHash: staged.packageHash,
            schemaApplied: schemaMigrationResult.applied === true,
            bundleRepublished,
            metadataReconciled: true,
          },
        })

        return {
          success: true,
          outcome: 'NO_CHANGES',
          inspection: staged.inspection,
          publicationPlan,
          preflight,
          schemaMigration: schemaMigrationResult,
          reconcileResult,
          runtime: runtimeResult,
          reconciliation: {
            packageChanged: false,
            schemaApplied: schemaMigrationResult.applied === true,
            metadataReconciled: true,
            bundleRepublished,
            runtimeReloaded: Boolean(runtimeResult?.loaded),
          },
        }
      }

      stage = 'BUILD_BUNDLE'
      const stagedBundle = await bundlerSvc.buildBundleFromDirectory(key, staged.packageDir, {
        outputDir: path.join(staged.operationDir, 'bundle'),
      })
      bundleSnapshot = await bundlerSvc.snapshotPublishedBundle(key)

      stage = 'PUBLISH_PACKAGE'
      backupDir = path.join(modulesDir, '.backups', staged.operationId, key)
      await fs.mkdir(path.dirname(backupDir), { recursive: true })
      if (activeBefore && routeLoader) {
        routeLoader.unloadModule(key)
        runtimeWasUnloaded = true
      }
      if (currentExists) await renameWithRetry(currentDir, backupDir)
      await renameWithRetry(staged.packageDir, currentDir)
      packageSwapped = true

      stage = 'PUBLISH_BUNDLE'
      await bundlerSvc.publishStagedBundle(key, stagedBundle)

      stage = 'APPLY_SCHEMA_MIGRATION'
      const schemaMigrationResult = preflight.schemaMigration?.required
        ? await applySchemaMigration({
            key,
            plan: preflight.schemaMigration,
            staged,
            moduleRow,
            actorId,
          })
        : { applied: false, reason: 'no_changes' }

      stage = 'RECONCILE_METADATA'
      const reconcileResult = await reconcilePublishedPackage({
        key,
        staged,
        moduleRow,
        activeBefore,
        publicationPlan,
        actorId,
      })
      await prisma.runlyModule.update({
        where: { key },
        data: {
          hasBundle: stagedBundle.built === true,
          bundleHash: stagedBundle.built ? stagedBundle.hash : null,
        },
      }).catch((error) => {
        if (error?.code !== 'P2025') throw error
      })

      stage = 'RELOAD_RUNTIME'
      let runtimeResult = null
      if (activeBefore && routeLoader) {
        runtimeResult = await routeLoader.reloadModule(key)
        if (!runtimeResult?.loaded) throw new Error(runtimeResult?.error ?? 'RUNTIME_RELOAD_FAILED')
      }

      stage = 'CLEANUP'
      if (backupDir) await fs.rm(path.dirname(backupDir), { recursive: true, force: true })
      await cacheInvalidator()
      const result = {
        success: true,
        outcome: currentExists ? 'UPDATED' : 'PUBLISHED',
        inspection: staged.inspection,
        publicationPlan,
        preflight,
        schemaMigration: schemaMigrationResult,
        reconcileResult,
        runtime: runtimeResult,
        reconciliation: {
          packageChanged: true,
          schemaApplied: schemaMigrationResult.applied === true,
          metadataReconciled: true,
          bundleRepublished: stagedBundle.built === true,
          runtimeReloaded: Boolean(runtimeResult?.loaded),
        },
      }
      await writeAudit({
        action: 'core.module.package.upload',
        key, actorId,
        before: null,
        after: { packageHash: staged.packageHash, files: staged.inspection.files },
      })
      await writeAudit({
        action: currentExists ? 'core.module.package.update' : 'core.module.package.publish',
        key, actorId,
        before: currentExists ? { packageHash: currentHash, version: moduleRow?.version ?? null } : null,
        after: { packageHash: staged.packageHash, version: staged.manifest.version },
      })
      return result
    } catch (error) {
      const failedStage = error?.stage ?? stage
      let previousPackageRestored = !packageSwapped
      let bundleRestored = !packageSwapped
      let runtimeRestored = !runtimeWasUnloaded
      let rollbackError = null
      if (packageSwapped) {
        try {
          if (routeLoader) routeLoader.unloadModule(key)
          await fs.rm(currentDir, { recursive: true, force: true })
          if (backupDir && await exists(backupDir)) await renameWithRetry(backupDir, currentDir)
          previousPackageRestored = previousPackageExisted
            ? await exists(currentDir)
            : !(await exists(currentDir))
          await bundlerSvc.restorePublishedBundle(key, bundleSnapshot)
          bundleRestored = true
          if (previousPackageExisted) {
            await reconcileRestoredPackage({ key, packageDir: currentDir, actorId })
          }
          if (activeBefore && routeLoader) {
            const restored = await routeLoader.reloadModule(key)
            runtimeRestored = restored?.loaded === true
            if (!runtimeRestored) throw new Error(restored?.error ?? 'OLD_RUNTIME_RELOAD_FAILED')
          } else {
            runtimeRestored = true
          }
        } catch (restoreError) {
          rollbackError = restoreError?.message ?? String(restoreError)
        }
      }
      const cleanupComplete = await stagingService.cleanupStage(staged).then(() => true, () => false)
      const details = {
        code: error?.code ?? 'MODULE_PACKAGE_PUBLISH_FAILED',
        stage: rollbackError ? 'ROLLBACK' : failedStage,
        failedStage,
        statusCode: error?.statusCode ?? 500,
        originalPackagePreserved: previousPackageRestored,
        previousPackageRestored,
        bundleRestored,
        runtimeRestored,
        cleanupComplete,
        rollbackError,
        cause: error?.message ?? String(error),
        diagnostics: error?.details ?? null,
      }
      await writeAudit({ action: 'core.module.package.rollback', key, actorId, before: null, after: details }).catch(() => {})
      if (failedStage === 'APPLY_SCHEMA_MIGRATION') {
        await writeAudit({ action: 'core.module.schema.failed', key, actorId, before: null, after: details }).catch(() => {})
      }
      throw new ModulePackagePublishError(error?.message ?? 'MODULE_PACKAGE_PUBLISH_FAILED', details)
    } finally {
      await stagingService.cleanupStage(staged).catch(() => {})
      await release().catch(() => {})
    }
  }

  // Review an upload without applying it: same staging validation and
  // preflight as publishZip, plus a throwaway preview bundle of the
  // package's React components. Never touches the installed package, the
  // database schema or the published bundle.
  // `inspect(staged)` lets the caller add its own findings (the Builder
  // project impact) while the staged copy still exists.
  async function checkZip({ key, fileBuffer, modulesDir, inspect = null }) {
    await stagingService.cleanupStaleStaging(modulesDir)
    const previewsDir = path.join(modulesDir, PREVIEWS_DIRNAME, key)
    await removeExpiredPreviews(previewsDir)
    let staged = null
    try {
      try {
        staged = await stagingService.stageZipPackage({ key, fileBuffer, modulesDir })
      } catch (error) {
        return invalidPackageReport(error)
      }
      const moduleRow = await prisma.runlyModule.findUnique({
        where: { key },
        select: { id: true, key: true, status: true, enabled: true, version: true, manifest: true },
      }).catch(() => null)
      const currentDir = path.join(modulesDir, key)
      const currentHash = await exists(currentDir) ? await computeSourceHash(currentDir) : null
      const preflight = await preflightPackage({ key, staged, moduleRow, publicationPlan: {} })
      let preview = null
      if (staged.inspection.hasComponents && bundlerSvc?.buildBundleFromDirectory) {
        const previewId = randomUUID()
        try {
          const built = await bundlerSvc.buildBundleFromDirectory(key, staged.packageDir, { outputDir: path.join(previewsDir, previewId) })
          if (built.built) preview = { id: previewId }
        } catch (error) {
          preview = { error: error?.errors?.[0]?.text ?? error?.message ?? 'error de compilación' }
        }
      }
      const report = buildUpdateReport({ staged, moduleRow, preflight, noChanges: currentHash === staged.packageHash, preview })
      if (inspect) report.builder = await inspect(staged).catch(() => null)
      return report
    } finally {
      await stagingService.cleanupStage(staged).catch(() => {})
    }
  }

  return { publishZip, checkZip }
}
