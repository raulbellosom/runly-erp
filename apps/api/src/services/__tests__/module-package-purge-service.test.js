import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createModulePackagePurgeService } from '../module-package-purge-service.js'

function createFixture({ core = false, dependentInstalled = false, builderProject = false } = {}) {
  const state = {
    module: {
      id: '00000000-0000-7000-8000-000000000001',
      key: 'custom.test',
      core,
      lifecycleConfig: { ownedTables: ['test_item'] },
    },
    models: [{ id: 'model-1', moduleKey: 'custom.test', tableName: 'test_item' }],
    fields: [{ id: 'field-1', modelId: 'model-1' }],
    views: [{ id: 'view-1', moduleKey: 'custom.test' }],
    blueprints: [{ id: 'blueprint-1' }],
    migrations: [{ id: 'migration-1', moduleKey: 'custom.test' }],
    permissions: [{ id: 'permission-1', moduleKey: 'custom.test' }],
    rolePermissions: [{ id: 'rp-1', permissionId: 'permission-1' }],
    grants: [{ id: 'grant-1', permissionId: 'permission-1' }],
    companyModules: [{ id: 'cm-1' }],
    dependencies: dependentInstalled ? [{
      id: 'dep-1',
      dependencyId: '00000000-0000-7000-8000-000000000001',
      module: { key: 'custom.consumer', name: 'Consumer', status: 'INSTALLED', enabled: true },
    }] : [{ id: 'dep-owned', moduleId: '00000000-0000-7000-8000-000000000001', module: null }],
    tableExists: true,
    bundleLocal: true,
    bundleStorage: true,
    packageExists: true,
    routeLoaded: true,
    audit: [],
    builderProject: builderProject ? {
      moduleKey: 'custom.test',
      status: 'PUBLISHED',
      definition: { key: 'custom.test' },
      publishedVersion: '1.0.0',
      detachedAt: new Date(),
    } : null,
  }

  const deleteMany = (name) => async () => {
    const count = state[name].length
    state[name] = []
    return { count }
  }
  const prisma = {
    runlyModule: {
      findUnique: async () => state.module,
      delete: async () => { state.module = null },
    },
    runlyModel: { findMany: async () => state.models, deleteMany: deleteMany('models') },
    runlyField: { findMany: async () => state.fields, deleteMany: deleteMany('fields') },
    runlyView: { findMany: async () => state.views, deleteMany: deleteMany('views') },
    blueprint: { findMany: async () => state.blueprints, deleteMany: deleteMany('blueprints') },
    moduleMigration: { findMany: async () => state.migrations, deleteMany: deleteMany('migrations') },
    permission: { findMany: async () => state.permissions, deleteMany: deleteMany('permissions') },
    rolePermission: { findMany: async () => state.rolePermissions, deleteMany: deleteMany('rolePermissions') },
    userPermissionGrant: { findMany: async () => state.grants, deleteMany: deleteMany('grants') },
    companyModule: { findMany: async () => state.companyModules, deleteMany: deleteMany('companyModules') },
    moduleDependency: { findMany: async () => state.dependencies, deleteMany: deleteMany('dependencies') },
    auditLog: { create: async ({ data }) => { state.audit.push(data); return data } },
    moduleBuilderProject: {
      updateMany: async ({ where, data }) => {
        if (state.builderProject?.moduleKey !== where.moduleKey) return { count: 0 }
        Object.assign(state.builderProject, data)
        return { count: 1 }
      },
    },
    $queryRawUnsafe: async (sql) => {
      if (sql.startsWith('SELECT to_regclass')) return [{ table_ref: state.tableExists ? 'test_item' : null }]
      return [{ count: 3n }]
    },
    $executeRawUnsafe: async (sql) => {
      if (sql.startsWith('DROP TABLE')) state.tableExists = false
      return 0
    },
    $transaction: async (callback) => callback(prisma),
  }
  const bundlerSvc = {
    inspectModuleBundle: async () => ({
      local: { exists: state.bundleLocal },
      storage: { exists: state.bundleStorage, inspectable: true },
    }),
    deleteModuleBundle: async () => {
      const result = { localDeleted: state.bundleLocal, storageDeleted: state.bundleStorage }
      state.bundleLocal = false
      state.bundleStorage = false
      return result
    },
  }
  const routeLoader = {
    getLoadedModules: () => state.routeLoaded ? [{ moduleKey: 'custom.test' }] : [],
    unloadModule: () => { state.routeLoaded = false; return true },
  }
  const deletedCacheKeys = []
  const service = createModulePackagePurgeService({
    prisma,
    bundlerSvc,
    routeLoader,
    cacheDel: async (key) => { deletedCacheKeys.push(key) },
    resolveModulesDirImpl: async () => 'modules-root',
    purgeModuleFilesImpl: async () => {
      const existed = state.packageExists
      state.packageExists = false
      return existed
    },
  })
  return { state, service, deletedCacheKeys, bundlerSvc }
}

describe('hard module purge', () => {
  it('removes database, table, bundle, route, package and cache resources, then verifies clean', async () => {
    const { state, service, deletedCacheKeys } = createFixture()
    const result = await service.hardPurgeModule({
      key: 'custom.test',
      actorId: '00000000-0000-7000-8000-000000000002',
      confirmation: 'ACEPTO',
    })

    assert.equal(result.deleted, true)
    assert.deepEqual(result.verification, { clean: true, remaining: [] })
    assert.equal(state.module, null)
    assert.equal(state.tableExists, false)
    assert.equal(state.views.length, 0)
    assert.equal(state.migrations.length, 0)
    assert.equal(state.permissions.length, 0)
    assert.equal(state.rolePermissions.length, 0)
    assert.equal(state.grants.length, 0)
    assert.equal(state.companyModules.length, 0)
    assert.equal(state.dependencies.length, 0)
    assert.equal(state.bundleLocal, false)
    assert.equal(state.bundleStorage, false)
    assert.equal(state.packageExists, false)
    assert.equal(state.routeLoaded, false)
    assert.deepEqual(deletedCacheKeys.sort(), [
      'blueprints:raw',
      'modules:list',
      'public:modules:raw',
      'runtime:modules:raw',
    ])
    assert.equal(state.audit.at(-1).action, 'core.module.purge')
  })

  it('resets a Builder project that published the purged module back to DRAFT', async () => {
    const { state, service } = createFixture({ builderProject: true })
    const result = await service.hardPurgeModule({ key: 'custom.test', confirmation: 'ACEPTO' })

    assert.equal(state.builderProject.status, 'DRAFT')
    assert.equal(state.builderProject.publishedVersion, null)
    assert.equal(state.builderProject.detachedAt, null)
    assert.deepEqual(state.builderProject.definition, { key: 'custom.test' })
    assert.equal(result.resourcesRemoved.find((entry) => entry.type === 'DATABASE').builderProjectsReset, 1)
  })

  it('blocks core modules before deleting resources', async () => {
    const { state, service } = createFixture({ core: true })
    await assert.rejects(
      service.hardPurgeModule({ key: 'custom.test', confirmation: 'ACEPTO' }),
      (error) => error.message === 'CORE_MODULE_CANNOT_BE_PURGED' && error.status === 409,
    )
    assert.ok(state.module)
    assert.equal(state.tableExists, true)
  })

  it('blocks modules with active installed dependents', async () => {
    const { state, service } = createFixture({ dependentInstalled: true })
    await assert.rejects(
      service.hardPurgeModule({ key: 'custom.test', confirmation: 'ACEPTO' }),
      (error) => error.message === 'MODULE_HAS_INSTALLED_DEPENDENTS' &&
        error.details.blockingDependents[0].key === 'custom.consumer',
    )
    assert.ok(state.module)
  })

  it('requires the explicit destructive confirmation', async () => {
    const { service } = createFixture()
    await assert.rejects(
      service.hardPurgeModule({ key: 'custom.test' }),
      (error) => error.message === 'PURGE_CONFIRMATION_REQUIRED' && error.status === 400,
    )
  })

  it('reports a failed stage and remaining resources instead of claiming success', async () => {
    const { state, service, bundlerSvc } = createFixture()
    bundlerSvc.deleteModuleBundle = async () => { throw new Error('storage unavailable') }
    await assert.rejects(
      service.hardPurgeModule({ key: 'custom.test', confirmation: 'ACEPTO' }),
      (error) => error.message === 'PURGE_FAILED' &&
        error.details.stage === 'bundle_cleanup' &&
        Array.isArray(error.details.resourcesRemaining) &&
        error.details.resourcesRemaining.length > 0,
    )
    assert.ok(state.module)
    assert.equal(state.tableExists, true)
  })
})
