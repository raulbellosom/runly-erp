import { Prisma } from '@prisma/client'
import { createConnectionLifecycle } from './connections/connection-lifecycle.js'
import { invalidateModuleCaches } from './module-cache-service.js'
import { createModuleResourceInventoryService } from './module-resource-inventory-service.js'
import { purgeModuleFiles, resolveModulesDir } from './module-upload-service.js'

export class ModulePurgeError extends Error {
  constructor(message, status = 500, details = null) {
    super(message)
    this.name = 'ModulePurgeError'
    this.status = status
    this.statusCode = status
    this.details = details
  }
}

function summarizeInventory(inventory) {
  const db = inventory.database
  return {
    module: db.module ? 1 : 0,
    models: db.models.length,
    fields: db.fields.length,
    views: db.views.length,
    blueprints: db.blueprints.length,
    migrations: db.migrations.length,
    permissions: db.permissions.length,
    rolePermissions: db.rolePermissions.length,
    userPermissionGrants: db.userPermissionGrants.length,
    companyModules: db.companyModules.length,
    dependencies: db.dependencies.length,
    tables: db.tables.map((table) => ({ ...table })),
    routesLoaded: inventory.runtime.routesLoaded,
    localBundle: Boolean(inventory.runtime.bundle?.local?.exists),
    storageBundle: Boolean(inventory.runtime.bundle?.storage?.exists),
    packageDirectory: { ...inventory.storage.packageDirectory },
  }
}

function installedDependents(inventory) {
  const moduleId = inventory.database.module?.id
  if (!moduleId) return []
  return inventory.database.dependencies
    .filter((dependency) => dependency.dependencyId === moduleId)
    .filter((dependency) => dependency.module?.status === 'INSTALLED' && dependency.module?.enabled)
    .map((dependency) => ({ key: dependency.module.key, name: dependency.module.name }))
}

export function createModulePackagePurgeService({
  prisma,
  bundlerSvc,
  routeLoader = null,
  cacheDel,
  resolveModulesDirImpl = resolveModulesDir,
  purgeModuleFilesImpl = purgeModuleFiles,
}) {
  if (!prisma) throw new Error('createModulePackagePurgeService: prisma is required')
  if (!bundlerSvc?.deleteModuleBundle || !bundlerSvc?.inspectModuleBundle) {
    throw new Error('createModulePackagePurgeService: bundlerSvc with inspect/delete is required')
  }

  const inventorySvc = createModuleResourceInventoryService({
    prisma,
    bundlerSvc,
    routeLoader,
    resolveModulesDirImpl,
  })

  async function dryRunHardPurge({ key }) {
    const inventory = await inventorySvc.inspectModuleResources(key)
    const module = inventory.database.module
    if (module?.core || !inventory.moduleKey.startsWith('custom.')) {
      throw new ModulePurgeError('CORE_MODULE_CANNOT_BE_PURGED', 409)
    }
    const blockingDependents = installedDependents(inventory)
    return {
      moduleKey: inventory.moduleKey,
      allowed: !module?.core && blockingDependents.length === 0,
      blockingDependents,
      resources: summarizeInventory(inventory),
      confirmationRequired: 'ACEPTO',
    }
  }

  async function hardPurgeModule({ key, actorId = null, confirmation = null }) {
    let stage = 'inventory'
    const resourcesRemoved = []
    let initial
    let cacheResults = []
    let verificationOptions = null
    try {
      initial = await inventorySvc.inspectModuleResources(key)
      const module = initial.database.module
      if (module?.core || !initial.moduleKey.startsWith('custom.')) {
        throw new ModulePurgeError('CORE_MODULE_CANNOT_BE_PURGED', 409)
      }
      if (confirmation !== 'ACEPTO') {
        throw new ModulePurgeError('PURGE_CONFIRMATION_REQUIRED', 400)
      }
      const blockingDependents = installedDependents(initial)
      if (blockingDependents.length) {
        throw new ModulePurgeError('MODULE_HAS_INSTALLED_DEPENDENTS', 409, { blockingDependents })
      }

      const permissionIds = initial.database.permissions.map((permission) => permission.id)
      const ownedTables = initial.ownership.declaredOwnedTables
      const modelTableNames = initial.ownership.modelTableNames
      const modulesDir = await resolveModulesDirImpl()
      verificationOptions = {
        expectedOwnedTables: ownedTables,
        expectedModelTableNames: modelTableNames,
        expectedPermissionIds: permissionIds,
        modulesDir,
      }

      stage = 'runtime_unload'
      const routeWasLoaded = initial.runtime.routesLoaded
      routeLoader?.unloadModule?.(initial.moduleKey)
      resourcesRemoved.push({ type: 'RUNTIME_ROUTE', removed: routeWasLoaded })

      stage = 'bundle_cleanup'
      const bundleResult = await bundlerSvc.deleteModuleBundle(initial.moduleKey, {
        strict: true,
        updateMetadata: Boolean(module),
      })
      resourcesRemoved.push({ type: 'BUNDLE', ...bundleResult })

      stage = 'database_cleanup'
      const databaseResult = await prisma.$transaction(async (tx) => {
        const droppedTables = []
        let rowsDeleted = 0
        for (const table of initial.database.tables) {
          if (!table.exists) continue
          await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table.tableName}" CASCADE`)
          droppedTables.push(table.tableName)
          rowsDeleted += Number(table.rowCount ?? 0)
        }
        // Connection functions, registry and index rows (tables are gone above).
        await createConnectionLifecycle({ prisma }).onModulePurged({ moduleKey: initial.moduleKey, db: tx })

        if (permissionIds.length) {
          await tx.rolePermission.deleteMany({ where: { permissionId: { in: permissionIds } } })
          await tx.userPermissionGrant.deleteMany({ where: { permissionId: { in: permissionIds } } })
          await tx.permission.deleteMany({ where: { id: { in: permissionIds } } })
        }
        await tx.runlyView.deleteMany({ where: { moduleKey: initial.moduleKey } })
        await tx.moduleMigration.deleteMany({ where: { moduleKey: initial.moduleKey } })

        if (module) {
          await tx.companyModule.deleteMany({ where: { moduleId: module.id } })
          await tx.moduleDependency.deleteMany({
            where: { OR: [{ moduleId: module.id }, { dependencyId: module.id }] },
          })
          await tx.blueprint.deleteMany({ where: { moduleId: module.id } })
        }
        const modelIds = initial.database.models.map((model) => model.id)
        if (modelIds.length) {
          await tx.runlyField.deleteMany({ where: { modelId: { in: modelIds } } })
        }
        await tx.runlyModel.deleteMany({ where: { moduleKey: initial.moduleKey } })
        if (module) await tx.runlyModule.delete({ where: { key: initial.moduleKey } })

        // A Builder project that published this module would otherwise stay
        // PUBLISHED pointing at a module that no longer exists, blocking both
        // re-publishing as a fresh install and deleting the draft. Reset it
        // to DRAFT (keeping the definition) so the design is not lost.
        const builderProjectsReset = tx.moduleBuilderProject
          ? (await tx.moduleBuilderProject.updateMany({
              where: { moduleKey: initial.moduleKey },
              data: {
                status: 'DRAFT',
                publishedDefinition: Prisma.DbNull,
                publishedPackageHash: null,
                publishedVersion: null,
                publishedAt: null,
                detachedAt: null,
              },
            })).count
          : 0

        return { droppedTables, rowsDeleted, builderProjectsReset }
      })
      resourcesRemoved.push({ type: 'DATABASE', ...databaseResult })

      stage = 'filesystem_cleanup'
      const packageDeleted = modulesDir
        ? await purgeModuleFilesImpl(initial.moduleKey, modulesDir)
        : false
      resourcesRemoved.push({ type: 'PACKAGE_DIRECTORY', removed: packageDeleted })

      stage = 'cache_invalidation'
      cacheResults = await invalidateModuleCaches(cacheDel)
      const cacheFailures = cacheResults.filter((entry) => !entry.invalidated)
      if (cacheFailures.length) {
        const cacheError = new Error('MODULE_CACHE_INVALIDATION_FAILED')
        cacheError.details = { cacheFailures }
        throw cacheError
      }

      stage = 'verification'
      const verification = await inventorySvc.assertNoModuleResourcesRemain(
        initial.moduleKey,
        verificationOptions,
      )

      stage = 'audit'
      await prisma.auditLog.create({
        data: {
          actorId,
          moduleKey: initial.moduleKey,
          entityType: 'RunlyModule',
          entityId: module?.id ?? null,
          action: 'core.module.purge',
          before: summarizeInventory(initial),
          after: {
            operation: 'hard-purge',
            resourcesRemoved,
            cacheInvalidations: cacheResults,
            verification: { clean: verification.clean, remaining: verification.remaining },
          },
          metadata: null,
        },
      })

      return {
        moduleKey: initial.moduleKey,
        deleted: true,
        resourcesRemoved,
        cacheInvalidations: cacheResults,
        verification: { clean: true, remaining: [] },
      }
    } catch (error) {
      try {
        if (stage !== 'cache_invalidation') cacheResults = await invalidateModuleCaches(cacheDel)
      } catch {
        // The original failure remains authoritative.
      }
      if (error instanceof ModulePurgeError) throw error
      let resourcesRemaining = error?.verification?.remaining ?? error?.details?.remaining ?? null
      if (initial && verificationOptions) {
        try {
          const partialVerification = await inventorySvc.verifyNoModuleResourcesRemain(
            initial.moduleKey,
            verificationOptions,
          )
          resourcesRemaining = partialVerification.remaining
        } catch (verificationError) {
          resourcesRemaining = [{
            type: 'VERIFICATION_FAILED',
            count: 1,
            details: verificationError?.message ?? String(verificationError),
          }]
        }
      }
      throw new ModulePurgeError('PURGE_FAILED', error?.statusCode ?? 500, {
        stage,
        cause: error?.message ?? String(error),
        resourcesRemoved,
        resourcesRemaining,
        cacheInvalidations: cacheResults,
      })
    }
  }

  return { dryRunHardPurge, hardPurgeModule, ...inventorySvc }
}
