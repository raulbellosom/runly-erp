import fs from 'node:fs/promises'
import path from 'node:path'
import { Prisma } from '@prisma/client'
import { resolveModulesDir } from './module-upload-service.js'

const MODULE_KEY_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/
const SQL_IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/
const CORE_TABLE_NAMES = new Set(
  (Prisma?.dmmf?.datamodel?.models ?? []).map((model) => model.dbName ?? model.name),
)

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function ensureModuleKey(moduleKey) {
  const key = typeof moduleKey === 'string' ? moduleKey.trim() : ''
  if (!MODULE_KEY_RE.test(key)) {
    throw Object.assign(new Error('INVALID_MODULE_KEY'), { statusCode: 400 })
  }
  return key
}

function ensureSafeTableName(tableName) {
  if (typeof tableName !== 'string' || !SQL_IDENTIFIER_RE.test(tableName)) {
    throw Object.assign(new Error(`INVALID_OWNED_TABLE: ${tableName}`), { statusCode: 409 })
  }
  if (CORE_TABLE_NAMES.has(tableName)) {
    throw Object.assign(new Error(`CORE_TABLE_CANNOT_BE_OWNED: ${tableName}`), { statusCode: 409 })
  }
  return tableName
}

async function inspectTable(prisma, tableName) {
  const safeName = ensureSafeTableName(tableName)
  // ::text — @prisma/adapter-pg can't deserialize the raw `regclass` OID
  // type and throws P2010, which made every purge dry-run/hard-purge fail
  // outright. Same root cause and fix as
  // module-schema-migration-service.js's inspectTableSchema(); found here
  // during Builder golden-path QA cleanup (purging a just-installed test
  // module).
  const regclassRows = await prisma.$queryRawUnsafe('SELECT to_regclass($1)::text AS table_ref', `public.${safeName}`)
  const exists = Boolean(regclassRows?.[0]?.table_ref)
  if (!exists) return { tableName: safeName, exists: false, rowCount: 0 }
  const countRows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS count FROM "${safeName}"`)
  return { tableName: safeName, exists: true, rowCount: Number(countRows?.[0]?.count ?? 0) }
}

async function inspectPackageDirectory(moduleKey, modulesDir) {
  if (!modulesDir) return { exists: false, fileCount: 0 }
  const root = path.resolve(modulesDir)
  const target = path.resolve(root, moduleKey)
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw Object.assign(new Error('MODULE_PATH_OUTSIDE_ROOT'), { statusCode: 400 })
  }

  let fileCount = 0
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const child = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) fileCount += 1
    }
  }

  try {
    await walk(target)
    return { exists: true, fileCount }
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, fileCount: 0 }
    throw error
  }
}

function remainingFromInventory(inventory, { expectedPermissionIds = [] } = {}) {
  const remaining = []
  const add = (type, count, details = null) => {
    if (Number(count) > 0) remaining.push({ type, count: Number(count), details })
  }

  add('RUNLY_MODULE', inventory.database.module ? 1 : 0)
  add('RUNLY_MODEL', inventory.database.models.length)
  add('RUNLY_FIELD', inventory.database.fields.length)
  add('RUNLY_VIEW', inventory.database.views.length)
  add('BLUEPRINT', inventory.database.blueprints.length)
  add('MODULE_MIGRATION', inventory.database.migrations.length)
  add('PERMISSION', inventory.database.permissions.length)
  add('ROLE_PERMISSION', inventory.database.rolePermissions.length)
  add('USER_PERMISSION_GRANT', inventory.database.userPermissionGrants.length)
  add('COMPANY_MODULE', inventory.database.companyModules.length)
  add('MODULE_DEPENDENCY', inventory.database.dependencies.length)
  add('OWNED_TABLE', inventory.database.tables.filter((entry) => entry.exists).length,
    inventory.database.tables.filter((entry) => entry.exists).map((entry) => entry.tableName))
  add('LOCAL_BUNDLE', inventory.runtime.bundle?.local?.exists ? 1 : 0)
  add('STORAGE_BUNDLE', inventory.runtime.bundle?.storage?.exists ? 1 : 0)
  add('STORAGE_BUNDLE_UNVERIFIED', inventory.runtime.bundle?.storage?.inspectable === false ? 1 : 0)
  add('PACKAGE_DIRECTORY', inventory.storage.packageDirectory.exists ? 1 : 0)
  add('RUNTIME_ROUTE', inventory.runtime.routesLoaded ? 1 : 0)
  if (expectedPermissionIds.length && inventory.database.detachedPermissionAssignments > 0) {
    add('DETACHED_PERMISSION_ASSIGNMENT', inventory.database.detachedPermissionAssignments)
  }
  return remaining
}

export function createModuleResourceInventoryService({
  prisma,
  bundlerSvc = null,
  routeLoader = null,
  resolveModulesDirImpl = resolveModulesDir,
}) {
  if (!prisma) throw new Error('createModuleResourceInventoryService: prisma is required')

  async function inspectModuleResources(moduleKey, options = {}) {
    const key = ensureModuleKey(moduleKey)
    const module = await prisma.runlyModule.findUnique({ where: { key } })
    const models = await prisma.runlyModel.findMany({ where: { moduleKey: key } })
    const modelIds = models.map((model) => model.id)
    const fields = modelIds.length
      ? await prisma.runlyField.findMany({ where: { modelId: { in: modelIds } } })
      : []
    const views = await prisma.runlyView.findMany({ where: { moduleKey: key } })
    const blueprints = module
      ? await prisma.blueprint.findMany({ where: { moduleId: module.id } })
      : []
    const migrations = await prisma.moduleMigration.findMany({ where: { moduleKey: key } })
    const expectedPermissionIds = safeArray(options.expectedPermissionIds)
    const permissionWhereParts = [
      ...(module ? [{ moduleId: module.id }] : []),
      { moduleKey: key },
      ...(expectedPermissionIds.length ? [{ id: { in: expectedPermissionIds } }] : []),
    ]
    const permissionWhere = { OR: permissionWhereParts }
    const permissions = await prisma.permission.findMany({ where: permissionWhere })
    const permissionIds = unique([
      ...permissions.map((permission) => permission.id),
      ...expectedPermissionIds,
    ])
    const rolePermissions = permissionIds.length
      ? await prisma.rolePermission.findMany({ where: { permissionId: { in: permissionIds } } })
      : []
    const userPermissionGrants = permissionIds.length
      ? await prisma.userPermissionGrant.findMany({ where: { permissionId: { in: permissionIds } } })
      : []
    const companyModules = module
      ? await prisma.companyModule.findMany({ where: { moduleId: module.id } })
      : []
    const dependencies = module
      ? await prisma.moduleDependency.findMany({
          where: { OR: [{ moduleId: module.id }, { dependencyId: module.id }] },
          include: { module: { select: { key: true, name: true, status: true, enabled: true } } },
        })
      : []

    const declaredOwnedTables = unique([
      ...safeArray(module?.lifecycleConfig?.ownedTables),
      ...safeArray(options.expectedOwnedTables),
    ]).map(ensureSafeTableName)
    const modelTableNames = new Set([
      ...models.map((model) => model.tableName),
      ...safeArray(options.expectedModelTableNames),
    ])
    const unauthorizedTables = declaredOwnedTables.filter((tableName) => !modelTableNames.has(tableName))
    if (unauthorizedTables.length) {
      throw Object.assign(new Error('OWNED_TABLE_NOT_OWNED_BY_MODULE'), {
        statusCode: 409,
        details: { tables: unauthorizedTables },
      })
    }
    const tables = []
    for (const tableName of declaredOwnedTables) tables.push(await inspectTable(prisma, tableName))

    const modulesDir = options.modulesDir ?? await resolveModulesDirImpl()
    const packageDirectory = await inspectPackageDirectory(key, modulesDir)
    const bundle = bundlerSvc?.inspectModuleBundle
      ? await bundlerSvc.inspectModuleBundle(key)
      : { local: { exists: false }, storage: { exists: false, inspectable: false } }
    const loadedModules = routeLoader?.getLoadedModules?.() ?? []
    const routesLoaded = loadedModules.some((entry) => entry?.moduleKey === key)

    return {
      moduleKey: key,
      database: {
        module,
        models,
        fields,
        views,
        blueprints,
        migrations,
        permissions,
        rolePermissions,
        userPermissionGrants,
        companyModules,
        dependencies,
        tables,
        detachedPermissionAssignments: rolePermissions.length + userPermissionGrants.length,
      },
      runtime: { routesLoaded, bundle },
      storage: { packageDirectory },
      ownership: {
        source: 'derived',
        declaredOwnedTables,
        modelTableNames: [...modelTableNames],
      },
    }
  }

  async function verifyNoModuleResourcesRemain(moduleKey, options = {}) {
    const inventory = await inspectModuleResources(moduleKey, options)
    const remaining = remainingFromInventory(inventory, options)
    return { clean: remaining.length === 0, remaining, inventory }
  }

  async function assertNoModuleResourcesRemain(moduleKey, options = {}) {
    const verification = await verifyNoModuleResourcesRemain(moduleKey, options)
    if (!verification.clean) {
      throw Object.assign(new Error('MODULE_RESOURCES_REMAIN'), {
        statusCode: 500,
        details: { remaining: verification.remaining },
        verification,
      })
    }
    return verification
  }

  return { inspectModuleResources, verifyNoModuleResourcesRemain, assertNoModuleResourcesRemain }
}

export { ensureModuleKey, ensureSafeTableName }
