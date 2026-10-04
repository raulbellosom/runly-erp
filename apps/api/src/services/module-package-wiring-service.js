// Shared ModulePackageService wiring — the preflight/reconcile glue that
// turns the generic createModulePackageService() into a working publish
// pipeline (dependency-cycle guard, additive schema-diff preflight, metadata
// sync on success, manifest-driven metadata sync on rollback). This is the
// exact sequence apps/api/src/routes/modules.js already runs for ZIP
// uploads; the Module Builder's "Descargar ZIP" / "Instalar en Runly" flow
// (module-builder-service.js) calls the same createModulePackageWiring()
// factory instead of re-deriving its own publish pipeline, per the
// no-parallel-pipelines rule in
// docs/superpowers/specs/2026-09-27-rme3-no-code-module-builder-architecture.md.
import path from 'node:path'
import { createModuleSchemaMigrationService } from './module-schema-migration-service.js'
import { loadDataMigrationFiles } from './module-data-migration-service.js'
import { createModuleMetadataService } from './module-metadata-service.js'
import { createModuleLifecycleService } from './module-lifecycle-service.js'
import { createConnectionLifecycle } from './connections/connection-lifecycle.js'
import { createModulePackageService } from './module-package-service.js'
import { createModulePackageStagingService } from './module-package-staging-service.js'
import { createModulePackagePurgeService } from './module-package-purge-service.js'
import { loadManifestDependencies } from './module-dependency-utils.js'
import { loadModuleManifest, loadModuleModels, loadModuleViews } from './module-discovery-service.js'
import { syncDiscoveredModuleDependencies } from '../routes/modules.js'

export function createModulePackageWiring({ prisma, bundlerSvc, routeLoader, cacheDel = () => {} }) {
  const schemaMigrationSvc = createModuleSchemaMigrationService({ prisma })
  const metadataSvc = createModuleMetadataService({ prisma })
  const lifecycleSvc = createModuleLifecycleService({ prisma })
  const connectionLifecycle = createConnectionLifecycle({ prisma })
  const stagingSvc = createModulePackageStagingService()
  const purgeSvc = bundlerSvc
    ? createModulePackagePurgeService({ prisma, bundlerSvc, routeLoader, cacheDel })
    : null

  const packageSvc = bundlerSvc
    ? createModulePackageService({
        prisma,
        stagingService: stagingSvc,
        bundlerSvc,
        routeLoader,
        preflightPackage: async ({ staged, moduleRow, decisions }) => {
          const dependencyResult = await loadManifestDependencies(prisma, staged.manifest.dependencies ?? [])
          const schemaMigration = moduleRow?.status === 'INSTALLED'
            ? await schemaMigrationSvc.planModuleSchemaMigration({
                moduleKey: staged.manifest.key,
                desiredModels: staged.models,
                moduleRow,
                decisions,
                dataMigrationFiles: await loadDataMigrationFiles(staged.packageDir),
                manifest: staged.manifest,
              })
            : { required: false, canAutoApply: true, safety: 'SAFE', operations: [], drift: [], warnings: [] }
          return {
            declared: dependencyResult.declared,
            missingRequired: dependencyResult.missingRequired,
            missingOptional: dependencyResult.missingOptional,
            installationDependenciesSatisfied: dependencyResult.missingRequired.length === 0,
            schemaMigration,
          }
        },
        applySchemaMigration: async ({ plan, actorId }) => schemaMigrationSvc.applyModuleSchemaMigration({ plan, actorId }),
        reconcilePublishedPackage: async ({ key, staged, moduleRow, publicationPlan, actorId }) => {
          await lifecycleSvc.syncModules({ manifests: [staged.manifest], actorId })
          // syncModuleMetadata only upserts RunlyModel/RunlyField/RunlyView/
          // Blueprint metadata rows — it never touches physical DB schema —
          // so there was no ordering reason to gate it on
          // `!publicationPlan.schemaChangesDetected` (and by this point
          // APPLY_SCHEMA_MIGRATION has already run). That guard meant any
          // update that included both a schema change (e.g. a new field)
          // and a metadata-only change (e.g. a dashboard widget's display
          // config) silently dropped the metadata-only part: the new
          // field's RunlyField row and the widget's `display` never got
          // written. Found during golden-path QA on the very first
          // additive update that also touched a widget's display config.
          if (moduleRow?.status === 'INSTALLED') {
            await metadataSvc.syncModuleMetadata({ manifest: staged.manifest, models: staged.models, views: staged.views })
            // Connections read the manifest/models just synced above.
            await connectionLifecycle.syncModuleConnections({ moduleKey: key })
          }
          const syncResult = await syncDiscoveredModuleDependencies({ prisma, moduleKey: key, dependencies: staged.manifest.dependencies ?? [] })
          if (syncResult.error?.code === 'DEPENDENCY_CYCLE_DETECTED') {
            throw Object.assign(new Error(syncResult.error.message), { code: syncResult.error.code })
          }
          return { syncResult }
        },
        reconcileRestoredPackage: async ({ key, packageDir, actorId }) => {
          const loaded = await loadModuleManifest({ manifestPath: path.join(packageDir, 'module.manifest.js'), source: 'custom' })
          if (loaded.status !== 'VALID' || loaded.manifest?.key !== key) throw new Error('RESTORED_MANIFEST_INVALID')
          const models = await loadModuleModels({ moduleDir: packageDir, manifest: loaded.manifest })
          const views = await loadModuleViews({ moduleDir: packageDir, manifest: loaded.manifest })
          await lifecycleSvc.syncModules({ manifests: [loaded.manifest], actorId })
          await metadataSvc.syncModuleMetadata({ manifest: loaded.manifest, models, views })
          await syncDiscoveredModuleDependencies({ prisma, moduleKey: key, dependencies: loaded.manifest.dependencies ?? [] })
        },
      })
    : null

  return { packageSvc, stagingSvc, purgeSvc, schemaMigrationSvc, metadataSvc, lifecycleSvc }
}
