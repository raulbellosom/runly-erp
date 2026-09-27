import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createModuleResourceInventoryService } from '../module-resource-inventory-service.js'

function createPrismaFixture() {
  const module = {
    id: '00000000-0000-7000-8000-000000000001',
    key: 'custom.test',
    core: false,
    lifecycleConfig: { ownedTables: ['test_item'] },
  }
  const models = [{ id: 'model-1', moduleKey: module.key, tableName: 'test_item' }]
  const permissions = [{ id: 'permission-1', moduleId: module.id, moduleKey: module.key }]
  return {
    runlyModule: { findUnique: async () => module },
    runlyModel: { findMany: async () => models },
    runlyField: { findMany: async () => [{ id: 'field-1', modelId: 'model-1' }] },
    runlyView: { findMany: async () => [{ id: 'view-1', moduleKey: module.key }] },
    blueprint: { findMany: async () => [{ id: 'blueprint-1', moduleId: module.id }] },
    moduleMigration: { findMany: async () => [{ id: 'migration-1', moduleKey: module.key }] },
    permission: { findMany: async () => permissions },
    rolePermission: { findMany: async () => [{ id: 'role-permission-1', permissionId: 'permission-1' }] },
    userPermissionGrant: { findMany: async () => [{ id: 'grant-1', permissionId: 'permission-1' }] },
    companyModule: { findMany: async () => [{ id: 'company-module-1', moduleId: module.id }] },
    moduleDependency: {
      findMany: async () => [{
        id: 'dependency-1',
        dependencyId: module.id,
        module: { key: 'custom.dependent', name: 'Dependent', status: 'INSTALLED', enabled: true },
      }],
    },
    $queryRawUnsafe: async (sql) => sql.startsWith('SELECT to_regclass')
      ? [{ table_ref: 'test_item' }]
      : [{ count: 7n }],
  }
}

describe('module resource inventory', () => {
  it('derives every known resource category without mutating it', async () => {
    const modulesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runly-inventory-'))
    const moduleDir = path.join(modulesDir, 'custom.test')
    await fs.mkdir(moduleDir)
    await fs.writeFile(path.join(moduleDir, 'module.manifest.js'), 'export default {}')
    const routeLoader = { getLoadedModules: () => [{ moduleKey: 'custom.test' }] }
    const bundlerSvc = {
      inspectModuleBundle: async () => ({
        local: { exists: true },
        storage: { exists: true, inspectable: true },
      }),
    }
    const service = createModuleResourceInventoryService({
      prisma: createPrismaFixture(),
      bundlerSvc,
      routeLoader,
      resolveModulesDirImpl: async () => modulesDir,
    })

    const inventory = await service.inspectModuleResources('custom.test')
    assert.equal(inventory.ownership.source, 'derived')
    assert.equal(inventory.database.fields.length, 1)
    assert.equal(inventory.database.views.length, 1)
    assert.equal(inventory.database.migrations.length, 1)
    assert.equal(inventory.database.permissions.length, 1)
    assert.equal(inventory.database.rolePermissions.length, 1)
    assert.equal(inventory.database.userPermissionGrants.length, 1)
    assert.equal(inventory.database.companyModules.length, 1)
    assert.equal(inventory.database.dependencies.length, 1)
    assert.deepEqual(inventory.database.tables[0], { tableName: 'test_item', exists: true, rowCount: 7 })
    assert.equal(inventory.runtime.routesLoaded, true)
    assert.equal(inventory.storage.packageDirectory.fileCount, 1)
  })

  it('rejects an owned table that is not backed by module metadata', async () => {
    const prisma = createPrismaFixture()
    prisma.runlyModule.findUnique = async () => ({
      id: 'module-1',
      key: 'custom.test',
      core: false,
      lifecycleConfig: { ownedTables: ['other_module_table'] },
    })
    const service = createModuleResourceInventoryService({
      prisma,
      resolveModulesDirImpl: async () => null,
    })
    await assert.rejects(
      service.inspectModuleResources('custom.test'),
      (error) => error.message === 'OWNED_TABLE_NOT_OWNED_BY_MODULE',
    )
  })

  it('rejects a Prisma core table even when malicious metadata claims ownership', async () => {
    const prisma = createPrismaFixture()
    prisma.runlyModule.findUnique = async () => ({
      id: 'module-1',
      key: 'custom.test',
      core: false,
      lifecycleConfig: { ownedTables: ['permission'] },
    })
    prisma.runlyModel.findMany = async () => [{ id: 'model-1', moduleKey: 'custom.test', tableName: 'permission' }]
    const service = createModuleResourceInventoryService({ prisma, resolveModulesDirImpl: async () => null })
    await assert.rejects(
      service.inspectModuleResources('custom.test'),
      (error) => error.message === 'CORE_TABLE_CANNOT_BE_OWNED: permission',
    )
  })

  it('rejects module keys that could escape the custom root', async () => {
    const service = createModuleResourceInventoryService({ prisma: createPrismaFixture() })
    await assert.rejects(
      service.inspectModuleResources('../runly.core'),
      (error) => error.message === 'INVALID_MODULE_KEY',
    )
  })
})
