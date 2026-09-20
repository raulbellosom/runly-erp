import { isOfficialCoreModuleKey } from './module-manifests-service.js'
import { getPermissionPresentation } from '../permission-catalog.js'
import { getModuleHandler } from './module-cleanup-registry.js'
import { createModuleMigrationService } from './module-migration-service.js'
import { createModuleMetadataService } from './module-metadata-service.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import {
  resolveProjectRoot,
  loadModuleManifest,
  loadModuleModels,
  loadModuleViews,
} from './module-discovery-service.js'
import {
  detectRequiredDependencyCycle,
  formatDependencyCycle,
  loadManifestDependencies,
} from './module-dependency-utils.js'

const FAILED_INSTALL_CLEAR_MODES = new Set(['metadata-only', 'preserve-data', 'purge-empty-tables'])
const UNINSTALL_MODES = new Set(['preserve-data', 'purge-data', 'purge-owned-tables'])
const TABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/

export class ModuleLifecycleError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.name = 'ModuleLifecycleError'
    this.status = status
  }
}

function toPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
}

function classifyInstallFailureStage(err) {
  if (typeof err?.stage === 'string' && err.stage.trim()) return err.stage.trim()
  if (err?.code === 'MANIFEST_MIGRATION_CHECKSUM_MISMATCH') return 'manifest_migration'
  if (err?.code === 'AME_METADATA_SYNC_FAILED') return 'metadata_sync'
  if (err?.name === 'ModuleOrmMigrationError') return 'orm_migration'
  if (err?.code === 'AME_ORM_MIGRATION_FAILED') return 'orm_migration'
  if (err?.code === 'AME_SQL_MIGRATION_EXECUTION_FAILED') return 'orm_migration'
  if (err?.name === 'ZodError') return 'validation'
  if (['DEPENDENCY_NOT_FOUND', 'DEPENDENCY_ALIAS_VERSION_CONFLICT'].includes(err?.code)) return 'dependency_sync'
  if (err instanceof ModuleLifecycleError) return 'install'
  return 'unknown'
}

function isInstallFailureRetryable(stage, code) {
  if (stage === 'validation') return false
  if (['DEPENDENCY_NOT_FOUND', 'DEPENDENCY_ALIAS_VERSION_CONFLICT'].includes(code)) return false
  return true
}

function gatherInstallDiagnostics(err) {
  const affectedTables = uniqueStrings([err?.tableName, err?.cause?.tableName])
  const affectedMigrations = uniqueStrings([err?.filename, err?.cause?.filename])
  return { affectedTables, affectedMigrations }
}

function toModuleTableName(tableName) {
  if (typeof tableName !== 'string' || !tableName.trim()) return null
  const trimmed = tableName.trim()
  if (!TABLE_NAME_PATTERN.test(trimmed)) return null
  return trimmed
}

function isWithinPath(parentPath, childPath) {
  const rel = path.relative(parentPath, childPath)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function createModuleLifecycleService({ prisma }) {
  const migrationSvc = createModuleMigrationService({ prisma })
  const metadataSvc = createModuleMetadataService({ prisma })

  // ── Permission helpers ────────────────────────────────────────────────────

  async function activateModulePermissions(tx, moduleId) {
    await tx.permission.updateMany({
      where: { moduleId },
      data: { active: true },
    })
  }

  async function deactivateModulePermissions(tx, moduleId) {
    await tx.permission.updateMany({
      where: { moduleId },
      data: { active: false },
    })
  }

  // ── Dependency helpers ────────────────────────────────────────────────────

  async function getRequiredDependents(db, moduleId) {
    return db.moduleDependency.findMany({
      where: {
        dependencyId: moduleId,
        optional: false,
        module: { enabled: true, status: 'INSTALLED' },
      },
      include: { module: { select: { key: true, name: true } } },
    })
  }

  async function syncDependencies(tx, moduleId, dependencies = []) {
    const { resolved, missingRequired } = await loadManifestDependencies(tx, dependencies)
    if (missingRequired.length) {
      throw Object.assign(new ModuleLifecycleError(
        `Dependencias requeridas no encontradas: ${missingRequired.join(', ')}.`, 409
      ), { code: 'DEPENDENCY_NOT_FOUND', keys: missingRequired })
    }
    const requiredDependencyIds = resolved.filter(dep => !dep.optional).map(dep => dep.dependencyId)

    if (requiredDependencyIds.length > 0) {
      const existingRequiredEdges = await tx.moduleDependency.findMany({
        where: { optional: false },
        select: { moduleId: true, dependencyId: true },
      })
      const cycleIds = detectRequiredDependencyCycle({
        moduleId,
        requiredDependencyIds,
        existingRequiredEdges,
      })

      if (cycleIds) {
        const involvedIds = [...new Set(cycleIds)]
        const moduleRows = await tx.runlyModule.findMany({
          where: { id: { in: involvedIds } },
          select: { id: true, key: true },
        })
        const idToKey = new Map(moduleRows.map((row) => [row.id, row.key]))
        const cyclePath = formatDependencyCycle({ cycle: cycleIds, idToKey })
        const error = new ModuleLifecycleError(
          `Dependencia circular detectada: ${cyclePath}.`,
          409
        )
        error.code = 'DEPENDENCY_CYCLE_DETECTED'
        error.cyclePath = cyclePath
        throw error
      }
    }

    await tx.moduleDependency.deleteMany({ where: { moduleId } })
    if (resolved.length) {
      await tx.moduleDependency.createMany({
        data: resolved.map(({ dependencyId, versionRange, optional }) => ({ moduleId, dependencyId, versionRange, optional })),
        skipDuplicates: true,
      })
    }
  }

  async function syncAdminPermissions(db) {
    const adminRoles = await db.role.findMany({
      where: { key: { in: ['runly.admin', 'atlas.admin', 'system.admin'] } },
      select: { id: true },
    })
    if (!adminRoles.length) return

    const perms = await db.permission.findMany({ select: { id: true } })
    for (const role of adminRoles) {
      await db.rolePermission.deleteMany({ where: { roleId: role.id } })
      if (perms.length) {
        await db.rolePermission.createMany({
          data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
          skipDuplicates: true,
        })
      }
    }
  }

  // ── Audit log ─────────────────────────────────────────────────────────────

  async function writeAuditLog(db, { action, moduleKey, entityId, actorId, before, after }) {
    await db.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: 'runly.core',
        entityType: 'RunlyModule',
        entityId: entityId ?? null,
        action,
        before: before ?? null,
        after: after ?? null,
      },
    })
  }

  // ── Manifest upsert helpers ───────────────────────────────────────────────

  async function resolveRecoverableOwnedTables(moduleKey, lifecycleConfig) {
    const moduleModels = await prisma.runlyModel.findMany({
      where: { moduleKey },
      select: { tableName: true },
    })
    const modelTables = new Set(
      moduleModels
        .map((model) => toModuleTableName(model.tableName))
        .filter(Boolean)
    )
    const configuredTables = uniqueStrings(toPlainObject(lifecycleConfig).ownedTables)
      .map(toModuleTableName)
      .filter(Boolean)
    return configuredTables.filter((tableName) => modelTables.has(tableName))
  }

  async function getTableRowCount(tableName) {
    const safeTable = toModuleTableName(tableName)
    if (!safeTable) {
      throw new ModuleLifecycleError(`Nombre de tabla invalido: ${tableName ?? ''}.`, 400)
    }

    const existsRows = await prisma.$queryRaw`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${safeTable}
      LIMIT 1
    `
    const exists = existsRows.length > 0
    if (!exists) return { tableName: safeTable, exists: false, rowCount: 0, hasData: false }

    const countRows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS count FROM "${safeTable}"`)
    const rowCount = Number(countRows?.[0]?.count ?? 0)
    return { tableName: safeTable, exists: true, rowCount, hasData: rowCount > 0 }
  }

  async function dryRunFailedInstallCleanup({ key }) {
    const mod = await prisma.runlyModule.findUnique({ where: { key } })
    if (!mod) throw new ModuleLifecycleError('Modulo no encontrado.', 404)

    const ownedTables = await resolveRecoverableOwnedTables(mod.key, mod.lifecycleConfig)
    const tableChecks = []
    for (const tableName of ownedTables) {
      tableChecks.push(await getTableRowCount(tableName))
    }

    const dropCandidates = tableChecks.filter((entry) => entry.exists && !entry.hasData)
    const blockedByData = tableChecks.filter((entry) => entry.exists && entry.hasData)

    return {
      moduleKey: mod.key,
      status: mod.status,
      supported: ownedTables.length > 0,
      mode: 'purge-empty-tables',
      ownedTables,
      tableChecks,
      dropCandidates: dropCandidates.map((entry) => entry.tableName),
      blockedByData: blockedByData.map((entry) => ({ tableName: entry.tableName, rowCount: entry.rowCount })),
      requiresConfirmation: dropCandidates.length > 0,
    }
  }

  async function dryRunOwnedTablePurge({ key }) {
    const mod = await prisma.runlyModule.findUnique({ where: { key } })
    if (!mod) throw new ModuleLifecycleError('Modulo no encontrado.', 404)

    // Use ownedTables directly from the manifest lifecycle config — no RunlyModel
    // intersection required. The manifest is the authoritative declaration.
    const ownedTables = uniqueStrings(toPlainObject(mod.lifecycleConfig).ownedTables)
      .map(toModuleTableName)
      .filter(Boolean)
    const tableChecks = []
    for (const tableName of ownedTables) {
      tableChecks.push(await getTableRowCount(tableName))
    }

    const totalRows = tableChecks.reduce((sum, entry) => sum + Number(entry.rowCount ?? 0), 0)
    return {
      moduleKey: mod.key,
      status: mod.status,
      enabled: mod.enabled,
      supported: ownedTables.length > 0,
      mode: 'purge-owned-tables',
      ownedTables,
      tableChecks,
      totalRows,
      requiresConfirmation: ownedTables.length > 0,
    }
  }

  async function clearModuleInstallError({
    key,
    actorId,
    mode = 'preserve-data',
    confirmation = null,
  }) {
    if (!FAILED_INSTALL_CLEAR_MODES.has(mode)) {
      throw new ModuleLifecycleError('Modo de recuperacion invalido.', 400)
    }

    const mod = await prisma.runlyModule.findUnique({ where: { key } })
    if (!mod) throw new ModuleLifecycleError('Modulo no encontrado.', 404)
    if (mod.core) {
      throw new ModuleLifecycleError('Los modulos base no pueden limpiarse por este flujo.', 409)
    }
    if (mod.status !== 'ERROR') {
      throw new ModuleLifecycleError('Solo se puede limpiar una instalacion fallida en estado ERROR.', 409)
    }

    const lifecycleConfig = toPlainObject(mod.lifecycleConfig)
    const priorError = toPlainObject(lifecycleConfig.lastError)
    const recoveredAt = new Date().toISOString()

    let droppedTables = []
    let removedMigrations = []

    if (mode === 'purge-empty-tables') {
      const dryRun = await dryRunFailedInstallCleanup({ key })
      if (!dryRun.supported) {
        throw new ModuleLifecycleError('Este modulo no soporta limpieza fisica segura.', 409)
      }
      if (confirmation !== 'ACEPTO') {
        throw new ModuleLifecycleError('Debes escribir "ACEPTO" para confirmar la limpieza.', 400)
      }

      for (const candidate of dryRun.dropCandidates) {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${candidate}" CASCADE`)
        droppedTables.push(candidate)
      }

      if (droppedTables.length > 0) {
        const migrationRows = await prisma.moduleMigration.findMany({
          where: { moduleKey: key },
          select: { id: true, filename: true },
        })
        const toDeleteIds = migrationRows
          .filter((row) => droppedTables.some((tableName) => row.filename.startsWith(`${tableName}__`)))
          .map((row) => row.id)

        if (toDeleteIds.length > 0) {
          await prisma.moduleMigration.deleteMany({ where: { id: { in: toDeleteIds } } })
          removedMigrations = migrationRows
            .filter((row) => toDeleteIds.includes(row.id))
            .map((row) => row.filename)
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      await deactivateModulePermissions(tx, mod.id)
      const nextLifecycleConfig = {
        ...lifecycleConfig,
        lastRecovery: {
          mode,
          recoveredAt,
          actorId: actorId ?? null,
          previousStatus: mod.status,
          previousEnabled: mod.enabled,
          droppedTables,
          removedMigrations,
        },
        lastError: priorError,
      }
      const result = await tx.runlyModule.update({
        where: { key },
        data: { status: 'UNINSTALLED', enabled: false, lifecycleConfig: nextLifecycleConfig },
      })
      await writeAuditLog(tx, {
        action: mode === 'purge-empty-tables' ? 'core.module.failed_install.cleanup' : 'core.module.failed_install.clear',
        moduleKey: key,
        entityId: mod.id,
        actorId,
        before: { status: mod.status, enabled: mod.enabled },
        after: {
          status: result.status,
          enabled: result.enabled,
          mode,
          droppedTables,
          removedMigrations,
        },
      })
      return result
    })

    return {
      module: updated,
      recovery: {
        mode,
        droppedTables,
        removedMigrations,
      },
    }
  }

  async function persistInstallFailure({
    moduleKey,
    actorId,
    requestId = null,
    err,
  }) {
    if (!moduleKey) return
    const mod = await prisma.runlyModule.findUnique({ where: { key: moduleKey } })
    if (!mod) return

    const stage = classifyInstallFailureStage(err)
    const code = err?.code ?? (err instanceof ModuleLifecycleError ? 'LIFECYCLE_ERROR' : 'INTERNAL_ERROR')
    const diagnostics = gatherInstallDiagnostics(err)
    const retryable = isInstallFailureRetryable(stage, code)
    const lifecycleConfig = toPlainObject(mod.lifecycleConfig)
    const lastError = {
      code,
      stage,
      message: err?.message ?? 'No se pudo instalar el modulo.',
      cause: err?.cause?.message ?? null,
      requestId: requestId ?? null,
      failedAt: new Date().toISOString(),
      retryable,
      affectedTables: diagnostics.affectedTables,
      affectedMigrations: diagnostics.affectedMigrations,
    }

    await prisma.$transaction(async (tx) => {
      await deactivateModulePermissions(tx, mod.id)
      await tx.runlyModule.update({
        where: { key: moduleKey },
        data: {
          status: 'ERROR',
          enabled: false,
          lifecycleConfig: {
            ...lifecycleConfig,
            lastError,
          },
        },
      })
      await writeAuditLog(tx, {
        action: 'core.module.install.error',
        moduleKey,
        entityId: mod.id,
        actorId,
        before: { status: mod.status, enabled: mod.enabled },
        after: {
          status: 'ERROR',
          enabled: false,
          lastError,
        },
      })
    })
  }

  async function clearLastInstallError(moduleKey) {
    if (!moduleKey) return
    const mod = await prisma.runlyModule.findUnique({ where: { key: moduleKey } })
    if (!mod) return
    const lifecycleConfig = toPlainObject(mod.lifecycleConfig)
    if (!Object.prototype.hasOwnProperty.call(lifecycleConfig, 'lastError')) {
      return
    }
    const nextLifecycleConfig = { ...lifecycleConfig }
    delete nextLifecycleConfig.lastError
    await prisma.runlyModule.update({
      where: { key: moduleKey },
      data: { lifecycleConfig: nextLifecycleConfig },
    })
  }

  async function upsertManifestPermissions(tx, moduleId, moduleKey, permissions = [], activate) {
    if (!permissions.length) return
    const keys = permissions.map((p) => p.key)

    // Insert only new permissions in one batch; skip existing ones
    await tx.permission.createMany({
      data: permissions.map((p) => {
        const presentation = getPermissionPresentation(p.key)
        return {
          key: p.key,
          name: presentation.name,
          description: presentation.description,
          moduleId,
          moduleKey,
          active: activate ?? true,
        }
      }),
      skipDuplicates: true,
    })

    // Sync moduleId, moduleKey, and active for all permissions in one batch
    await tx.permission.updateMany({
      where: { key: { in: keys } },
      data: {
        moduleId,
        moduleKey,
        ...(activate !== undefined ? { active: activate } : {}),
      },
    })
  }

  async function upsertManifestBlueprints(tx, moduleId, blueprints = []) {
    if (!blueprints.length) return

    await tx.blueprint.createMany({
      data: blueprints.map((bp) => ({
        key: bp.key,
        moduleId,
        kind: bp.kind,
        version: bp.version,
        schema: bp.schema,
      })),
      skipDuplicates: true,
    })

    for (const bp of blueprints) {
      await tx.blueprint.update({
        where: { key: bp.key },
        data: { moduleId, kind: bp.kind, version: bp.version, schema: bp.schema, enabled: true },
      })
    }
  }

  async function resolveModuleDirectory({ moduleKey, lifecycleConfig }) {
    const projectRoot = await resolveProjectRoot()
    const modulesRoot = path.resolve(projectRoot, 'modules')
    const discovery = toPlainObject(lifecycleConfig).discovery
    const localPath = typeof discovery?.localPath === 'string' ? discovery.localPath.trim() : ''
    const candidates = []
    if (localPath) {
      candidates.push(path.resolve(projectRoot, localPath))
    }
    candidates.push(path.resolve(modulesRoot, 'custom', moduleKey))
    candidates.push(path.resolve(modulesRoot, 'official', moduleKey))

    for (const candidate of candidates) {
      if (!candidate || !isWithinPath(modulesRoot, candidate)) continue
      try {
        const stat = await fs.stat(candidate)
        if (stat.isDirectory()) return candidate
      } catch {
        continue
      }
    }
    return null
  }

  async function applyModuleManifestMigrations({ moduleKey, manifest, lifecycleConfig, actorId }) {
    const source = typeof lifecycleConfig?.discovery?.source === 'string'
      ? lifecycleConfig.discovery.source.trim()
      : null
    const isCustomModule = source === 'custom' || moduleKey.startsWith('custom.')
    if (isCustomModule) {
      return []
    }

    const migrations = Array.isArray(manifest?.migrations) ? manifest.migrations : []
    if (!migrations.length) return []

    const moduleDir = await resolveModuleDirectory({ moduleKey, lifecycleConfig })
    if (!moduleDir) {
      throw new Error(`Manifest migrations require module directory for "${moduleKey}", but none was found.`)
    }

    const results = []
    for (let i = 0; i < migrations.length; i += 1) {
      const migration = migrations[i]
      if (!migration || typeof migration !== 'object' || Array.isArray(migration)) {
        throw new Error(`manifest.migrations[${i}] must be an object`)
      }
      const declaredPath =
        typeof migration.path === 'string' && migration.path.trim() ? migration.path.trim() : null
      if (!declaredPath) {
        throw new Error(`manifest.migrations[${i}].path is required`)
      }
      const declaredChecksum =
        typeof migration.checksum === 'string' && migration.checksum.trim()
          ? migration.checksum.trim().toLowerCase()
          : null
      const allowUnsafeSql = migration.unsafe === true

      const migrationPath = path.resolve(moduleDir, declaredPath)
      if (!isWithinPath(moduleDir, migrationPath)) {
        throw new Error(`manifest.migrations[${i}] path resolves outside module directory`)
      }
      const sql = await fs.readFile(migrationPath, 'utf8')
      const computedChecksum = createHash('sha256').update(sql).digest('hex')

      if (declaredChecksum && computedChecksum !== declaredChecksum) {
        const checksumError = new Error(
          `Checksum mismatch for ${declaredPath}: expected ${declaredChecksum}, got ${computedChecksum}. ` +
          `Fix: pnpm module:checksums:write <module-dir>`
        )
        checksumError.code = 'MANIFEST_MIGRATION_CHECKSUM_MISMATCH'
        checksumError.stage = 'manifest_migration'
        checksumError.path = declaredPath
        checksumError.expectedChecksum = declaredChecksum
        checksumError.computedChecksum = computedChecksum
        throw checksumError
      }
      if (!declaredChecksum) {
        console.warn(
          `[migration] ${moduleKey}/${declaredPath}: no checksum declared. Add one for integrity protection (run: pnpm module:checksums:write <module-dir>)`
        )
      }

      const filename = `manifest__${declaredPath.replaceAll('\\', '/').replaceAll('/', '__')}`
      const applyResult = await migrationSvc.applySqlMigration({
        moduleKey,
        filename,
        sql,
        allowUnsafeSql,
      })

      if (applyResult.applied && applyResult.migration?.id) {
        await prisma.auditLog.create({
          data: {
            actorId: actorId ?? null,
            moduleKey: 'runly.core',
            entityType: 'ModuleMigration',
            entityId: applyResult.migration.id,
            action: 'atlas.orm.migrate.manifest',
            before: null,
            after: {
              moduleKey,
              filename,
              sourcePath: declaredPath,
              checksum: computedChecksum,
            },
          },
        })
      }

      results.push({
        filename,
        path: declaredPath,
        applied: applyResult.applied,
      })
    }

    return results
  }

  // ── ORM migration helpers ─────────────────────────────────────────────────

  async function applyModuleOrmMigrations({ moduleKey, actorId }) {
    // orderBy is required: modules with FK relationships between their own tables
    // (e.g. a ticket table referencing a site table) need CREATE TABLE statements
    // to run in the same order the models were declared/discovered in, or the
    // referenced table won't exist yet. createdAt (and id, which is UUIDv7 and
    // therefore time-ordered too) reflects first-discovery order because
    // syncModuleMetadata upserts models sequentially in manifest.models order.
    const models = await prisma.runlyModel.findMany({
      where: { moduleKey },
      select: { schema: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!models.length) return

    const modelSchemas = models.map((m) => m.schema)
    const plans = await migrationSvc.planModelMigrations({ moduleKey, models: modelSchemas })

    for (const plan of plans) {
      if (!plan.shouldApply) continue
      let applyResult
      try {
        applyResult = await migrationSvc.applySqlMigration({
          moduleKey: plan.moduleKey,
          filename: plan.filename,
          sql: plan.sql,
        })
      } catch (err) {
        const ormErr = new Error(
          `ORM migration failed for table '${plan.tableName}' (${plan.filename}): ${err.message}`
        )
        ormErr.name = 'ModuleOrmMigrationError'
        ormErr.code = 'AME_ORM_MIGRATION_FAILED'
        ormErr.moduleKey = moduleKey
        ormErr.tableName = plan.tableName
        ormErr.filename = plan.filename
        ormErr.stage = 'orm_migration'
        ormErr.cause = err
        throw ormErr
      }
      const { migration } = applyResult
      await prisma.auditLog.create({
        data: {
          actorId: actorId ?? null,
          moduleKey: 'runly.core',
          entityType: 'ModuleMigration',
          entityId: migration.id,
          action: 'atlas.orm.migrate',
          before: null,
          after: {
            moduleKey: plan.moduleKey,
            filename: plan.filename,
            tableName: plan.tableName,
            checksum: plan.checksum,
          },
        },
      })
    }
  }

  // ── Public operations ─────────────────────────────────────────────────────

  async function installModule({ manifest, actorId, requestId = null }) {
    const requestedManifest = toPlainObject(manifest)
    const requestedKey =
      typeof requestedManifest.key === 'string' ? requestedManifest.key.trim() : ''
    let installManifest = requestedManifest
    let lifecycleConfig = requestedManifest.lifecycle ?? null
    let moduleDir = null
    let installModels = []
    let installViews = []

    if (requestedKey) {
      const existing = await prisma.runlyModule.findUnique({
        where: { key: requestedKey },
        select: { lifecycleConfig: true },
      })
      if (existing?.lifecycleConfig) {
        lifecycleConfig = existing.lifecycleConfig
      }

      moduleDir = await resolveModuleDirectory({
        moduleKey: requestedKey,
        lifecycleConfig,
      })
      if (moduleDir) {
        const manifestPath = path.join(moduleDir, 'module.manifest.js')
        const officialDirSegment = `${path.sep}modules${path.sep}official${path.sep}`
        const source = moduleDir.includes(officialDirSegment) ? 'official' : 'custom'
        const localManifestResult = await loadModuleManifest({
          manifestPath,
          source,
        })
        if (localManifestResult?.status !== 'VALID' || !localManifestResult.manifest) {
          throw new ModuleLifecycleError(
            `No se pudo cargar el manifiesto local para "${requestedKey}".`,
            409
          )
        }
        if (localManifestResult.manifest.key !== requestedKey) {
          throw new ModuleLifecycleError(
            `El manifiesto local de "${requestedKey}" tiene una clave distinta: "${localManifestResult.manifest.key}".`,
            409
          )
        }
        installManifest = localManifestResult.manifest
        installModels = await loadModuleModels({
          moduleDir,
          manifest: installManifest,
        })
        installViews = await loadModuleViews({
          moduleDir,
          manifest: installManifest,
        })
      }
    }

    if (!moduleDir) {
      if (Array.isArray(installManifest.models)) {
        installModels = installManifest.models.filter(
          (model) => model && typeof model === 'object' && !Array.isArray(model)
        )
      }
      if (Array.isArray(installManifest.views)) {
        installViews = installManifest.views.filter(
          (view) => view && typeof view === 'object' && !Array.isArray(view)
        )
      }
    }

    const isCore = isOfficialCoreModuleKey(installManifest.key)
    lifecycleConfig = installManifest.lifecycle ?? lifecycleConfig ?? null
    let result = null

    try {
      if (installModels.length > 0 || installViews.length > 0) {
        try {
          await metadataSvc.syncModuleMetadata({
            manifest: installManifest,
            models: installModels,
            views: installViews,
          })
        } catch (err) {
          const metadataErr = new Error(
            `Metadata sync failed for module "${installManifest.key}": ${err?.message ?? 'unknown error'}`
          )
          metadataErr.code = 'AME_METADATA_SYNC_FAILED'
          metadataErr.stage = 'metadata_sync'
          metadataErr.moduleKey = installManifest.key
          metadataErr.cause = err
          throw metadataErr
        }
      }

      result = await prisma.$transaction(async (tx) => {
        const existing = await tx.runlyModule.findUnique({
          where: { key: installManifest.key },
          select: { lifecycleConfig: true },
        })
        const mergedLifecycleConfig = {
          ...toPlainObject(existing?.lifecycleConfig),
          ...toPlainObject(lifecycleConfig),
        }
        delete mergedLifecycleConfig.lastError

        const upserted = await tx.runlyModule.upsert({
          where: { key: installManifest.key },
          update: {
            name: installManifest.name,
            description: installManifest.description ?? null,
            version: installManifest.version,
            kind: installManifest.kind ?? (isCore ? 'CORE' : 'FEATURE'),
            core: isCore,
            uninstallable: isCore ? false : (installManifest.uninstallable ?? true),
            status: 'INSTALLED',
            enabled: true,
            manifest: installManifest,
            lifecycleConfig: mergedLifecycleConfig,
          },
          create: {
            key: installManifest.key,
            name: installManifest.name,
            description: installManifest.description ?? null,
            version: installManifest.version,
            kind: installManifest.kind ?? (isCore ? 'CORE' : 'FEATURE'),
            core: isCore,
            uninstallable: isCore ? false : (installManifest.uninstallable ?? true),
            status: 'INSTALLED',
            enabled: true,
            manifest: installManifest,
            lifecycleConfig: mergedLifecycleConfig,
          },
        })

        await syncDependencies(tx, upserted.id, installManifest.dependencies ?? [])
        await upsertManifestPermissions(
          tx,
          upserted.id,
          installManifest.key,
          installManifest.permissions ?? [],
          true
        )
        await upsertManifestBlueprints(tx, upserted.id, installManifest.blueprints ?? [])

        await writeAuditLog(tx, {
          action: 'core.module.install',
          moduleKey: installManifest.key,
          entityId: upserted.id,
          actorId,
          after: {
            key: installManifest.key,
            name: installManifest.name,
            version: installManifest.version,
            status: 'INSTALLED',
          },
        })

        return upserted
      })

      try {
        await syncAdminPermissions(prisma)
      } catch (err) {
        console.error('[lifecycle] syncAdminPermissions failed after install:', err)
      }

      await applyModuleOrmMigrations({ moduleKey: installManifest.key, actorId })
      await applyModuleManifestMigrations({
        moduleKey: installManifest.key,
        manifest: installManifest,
        lifecycleConfig: result?.lifecycleConfig ?? installManifest.lifecycle ?? null,
        actorId,
      })
      await clearLastInstallError(installManifest.key)
      await runModuleSeed({ moduleKey: installManifest.key, actorId })
      return result
    } catch (err) {
      await persistInstallFailure({
        moduleKey: installManifest?.key ?? requestedKey ?? null,
        actorId,
        requestId,
        err,
      })
      throw err
    }
  }

  async function getModuleInstallError({ key }) {
    const mod = await prisma.runlyModule.findUnique({ where: { key } })
    if (!mod) throw new ModuleLifecycleError('Modulo no encontrado.', 404)
    return {
      key: mod.key,
      status: mod.status,
      enabled: mod.enabled,
      lastError: toPlainObject(mod.lifecycleConfig).lastError ?? null,
      lifecycleConfig: mod.lifecycleConfig ?? null,
    }
  }

  async function repairManifestChecksums({ moduleDir, migrations }) {
    const manifestPath = path.join(moduleDir, 'module.manifest.js')
    let source
    try {
      source = await fs.readFile(manifestPath, 'utf8')
    } catch {
      return 0
    }
    let updated = 0
    for (const migration of migrations) {
      const declaredPath = typeof migration?.path === 'string' ? migration.path.trim() : null
      const declaredChecksum = typeof migration?.checksum === 'string' ? migration.checksum.trim().toLowerCase() : null
      if (!declaredPath || !declaredChecksum) continue
      const sqlPath = path.resolve(moduleDir, declaredPath)
      let sql
      try { sql = await fs.readFile(sqlPath, 'utf8') } catch { continue }
      const computedChecksum = createHash('sha256').update(sql).digest('hex')
      if (computedChecksum === declaredChecksum) continue
      const escaped = declaredPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const rx = new RegExp(
        `(path:\\s*["']${escaped}["'][\\s\\S]{0,300}?checksum:\\s*[\\r\\n\\s]*["'])${declaredChecksum}(["'])`,
        'm'
      )
      if (rx.test(source)) {
        source = source.replace(rx, `$1${computedChecksum}$2`)
        updated++
      }
    }
    if (updated > 0) {
      await fs.writeFile(manifestPath, source, 'utf8')
    }
    return updated
  }

  async function retryInstallModule({ key, actorId, requestId = null }) {
    const mod = await prisma.runlyModule.findUnique({ where: { key } })
    if (!mod) throw new ModuleLifecycleError('Modulo no encontrado.', 404)
    if (!mod.manifest || typeof mod.manifest !== 'object') {
      throw new ModuleLifecycleError('El modulo no tiene manifiesto persistido para reintentar.', 409)
    }

    let manifest = mod.manifest
    if (manifest.key !== key) {
      throw new ModuleLifecycleError('El manifiesto persistido no coincide con la clave del modulo.', 409)
    }

    const moduleDir = await resolveModuleDirectory({
      moduleKey: key,
      lifecycleConfig: mod.lifecycleConfig ?? null,
    })
    if (moduleDir) {
      const lastError = toPlainObject(mod.lifecycleConfig).lastError
      if (lastError?.code === 'MANIFEST_MIGRATION_CHECKSUM_MISMATCH') {
        const repaired = await repairManifestChecksums({
          moduleDir,
          migrations: Array.isArray(manifest.migrations) ? manifest.migrations : [],
        })
        if (repaired > 0) {
          console.log(`[migration] auto-repaired ${repaired} checksum(s) in ${key} before retry`)
        }
      }

      const manifestPath = path.join(moduleDir, 'module.manifest.js')
      const officialDirSegment = `${path.sep}modules${path.sep}official${path.sep}`
      const source = moduleDir.includes(officialDirSegment) ? 'official' : 'custom'
      const localManifestResult = await loadModuleManifest({
        manifestPath,
        source,
      })
      if (localManifestResult?.status === 'VALID' && localManifestResult.manifest) {
        if (localManifestResult.manifest.key !== key) {
          throw new ModuleLifecycleError(
            `El manifiesto local de "${key}" tiene una clave distinta: "${localManifestResult.manifest.key}".`,
            409
          )
        }
        manifest = localManifestResult.manifest
      }
    }

    return installModule({ manifest, actorId, requestId })
  }

  async function clearFailedInstall({ key, actorId, mode = 'preserve-data', confirmation = null }) {
    const normalizedMode = typeof mode === 'string' ? mode.trim() : ''
    if (normalizedMode === 'purge-empty-tables') {
      return clearModuleInstallError({ key, actorId, mode: normalizedMode, confirmation })
    }
    if (!FAILED_INSTALL_CLEAR_MODES.has(normalizedMode)) {
      throw new ModuleLifecycleError('Modo de recuperacion invalido.', 400)
    }
    return clearModuleInstallError({ key, actorId, mode: normalizedMode })
  }

  async function disableModule({ key, actorId }) {
    const mod = await prisma.runlyModule.findUnique({ where: { key } })
    if (!mod) throw new ModuleLifecycleError('Modulo no encontrado.', 404)
    if (mod.core || !mod.uninstallable) {
      throw new ModuleLifecycleError('Los modulos base no pueden deshabilitarse.', 409)
    }
    if (mod.status === 'UNINSTALLED') {
      throw new ModuleLifecycleError('No se puede deshabilitar un modulo desinstalado.', 409)
    }

    const dependents = await getRequiredDependents(prisma, mod.id)
    if (dependents.length) {
      const list = dependents.map((d) => `${d.module.name} (${d.module.key})`).join(', ')
      throw new ModuleLifecycleError(
        `No se puede deshabilitar el modulo porque es requerido por: ${list}.`,
        409
      )
    }

    if (mod.status === 'DISABLED' && !mod.enabled) {
      return mod
    }

    return prisma.$transaction(async (tx) => {
      await deactivateModulePermissions(tx, mod.id)
      const updated = await tx.runlyModule.update({
        where: { key },
        data: { status: 'DISABLED', enabled: false },
      })
      await writeAuditLog(tx, {
        action: 'core.module.disable',
        moduleKey: key,
        entityId: mod.id,
        actorId,
        before: { status: mod.status },
        after: { status: 'DISABLED' },
      })
      return updated
    })
  }

  async function enableModule({ key, actorId }) {
    const mod = await prisma.runlyModule.findUnique({ where: { key } })
    if (!mod) throw new ModuleLifecycleError('Modulo no encontrado.', 404)
    if (mod.status === 'UNINSTALLED') {
      throw new ModuleLifecycleError('No se puede habilitar un modulo desinstalado.', 409)
    }
    if (mod.status === 'INSTALLED' && mod.enabled) {
      return mod
    }

    const requiredDeps = await prisma.moduleDependency.findMany({
      where: { moduleId: mod.id, optional: false },
      include: { dependency: { select: { key: true, name: true, status: true, enabled: true } } },
    })
    const inactive = requiredDeps.filter(
      (d) => d.dependency.status !== 'INSTALLED' || !d.dependency.enabled
    )
    if (inactive.length) {
      const list = inactive.map((d) => `${d.dependency.name} (${d.dependency.key})`).join(', ')
      throw new ModuleLifecycleError(
        `No se puede habilitar el modulo. Dependencias requeridas no activas: ${list}.`,
        409
      )
    }

    return prisma.$transaction(async (tx) => {
      await activateModulePermissions(tx, mod.id)
      const updated = await tx.runlyModule.update({
        where: { key },
        data: { status: 'INSTALLED', enabled: true },
      })
      await writeAuditLog(tx, {
        action: 'core.module.enable',
        moduleKey: key,
        entityId: mod.id,
        actorId,
        before: { status: mod.status },
        after: { status: 'INSTALLED' },
      })
      return updated
    })
  }

  async function uninstallModule({ key, mode = 'preserve-data', companyId, actorId, confirmation = null }) {
    if (!UNINSTALL_MODES.has(mode)) {
      throw new ModuleLifecycleError('Modo de desinstalacion invalido.', 400)
    }

    const mod = await prisma.runlyModule.findUnique({ where: { key } })
    if (!mod) throw new ModuleLifecycleError('Modulo no encontrado.', 404)
    if (mod.core || !mod.uninstallable) {
      throw new ModuleLifecycleError('Los modulos base no pueden desinstalarse.', 409)
    }

    const dependents = await getRequiredDependents(prisma, mod.id)
    if (dependents.length) {
      const list = dependents.map((d) => `${d.module.name} (${d.module.key})`).join(', ')
      throw new ModuleLifecycleError(
        `No se puede desinstalar el modulo porque es requerido por: ${list}.`,
        409
      )
    }

    if (mode === 'purge-data') {
      const handler = getModuleHandler(key)
      if (!handler) {
        const lc = mod.lifecycleConfig ?? {}
        if (!lc.supportsDataPurge) {
          throw new ModuleLifecycleError(
            'Este modulo no soporta la purga de datos.',
            409
          )
        }
      }
    }
    if (mode === 'purge-owned-tables') {
      const dryRun = await dryRunOwnedTablePurge({ key })
      if (!dryRun.supported) {
        throw new ModuleLifecycleError(
          'Este modulo no soporta purga destructiva de tablas propias.',
          409
        )
      }
      if (confirmation !== 'ACEPTO') {
        throw new ModuleLifecycleError(
          'Debes escribir "ACEPTO" para confirmar la purga destructiva.',
          400
        )
      }
    }

    if (mod.status === 'UNINSTALLED' && !mod.enabled && mode !== 'purge-data' && mode !== 'purge-owned-tables') {
      return mod
    }

    let ownedTableDryRun = null
    if (mode === 'purge-owned-tables') {
      ownedTableDryRun = await dryRunOwnedTablePurge({ key })
    }

    if (mode === 'purge-data' || mode === 'purge-owned-tables') {
      await runModuleTeardown({ moduleKey: key, actorId })
    }

    return prisma.$transaction(async (tx) => {
      await deactivateModulePermissions(tx, mod.id)

      let rowsDeleted = 0
      let droppedTables = []
      let removedMigrations = []
      let tableRowCounts = []
      if (mode === 'purge-data') {
        const handler = getModuleHandler(key)
        if (handler) {
          rowsDeleted = await handler.purge({ tx, companyId })
        }
      }
      if (mode === 'purge-owned-tables') {
        const checks = ownedTableDryRun?.tableChecks ?? []
        tableRowCounts = checks.map((entry) => ({
          tableName: entry.tableName,
          rowCount: entry.rowCount,
        }))
        rowsDeleted = checks.reduce((sum, entry) => sum + Number(entry.rowCount ?? 0), 0)

        for (const entry of checks) {
          if (!entry.exists) continue
          await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${entry.tableName}" CASCADE`)
          droppedTables.push(entry.tableName)
        }

        if (droppedTables.length > 0) {
          const migrationRows = await tx.moduleMigration.findMany({
            where: { moduleKey: key },
            select: { filename: true },
          })
          await tx.moduleMigration.deleteMany({ where: { moduleKey: key } })
          removedMigrations = migrationRows.map((row) => row.filename)
        }
      }

      const updated = await tx.runlyModule.update({
        where: { key },
        data: { status: 'UNINSTALLED', enabled: false },
      })

      await writeAuditLog(tx, {
        action: 'core.module.uninstall',
        moduleKey: key,
        entityId: mod.id,
        actorId,
        before: { status: mod.status },
        after: {
          status: 'UNINSTALLED',
          mode,
          rowsDeleted,
          droppedTables,
          removedMigrations,
          tableRowCounts,
        },
      })

      return updated
    })
  }

  async function resetModule({ key, companyId, actorId }) {
    const mod = await prisma.runlyModule.findUnique({ where: { key } })
    if (!mod) throw new ModuleLifecycleError('Modulo no encontrado.', 404)
    if (mod.core) {
      throw new ModuleLifecycleError('Los modulos base no pueden reiniciarse.', 409)
    }
    if (mod.status !== 'INSTALLED' || !mod.enabled) {
      throw new ModuleLifecycleError('Solo se puede reiniciar un modulo instalado y activo.', 409)
    }

    const lc = mod.lifecycleConfig ?? {}
    const handler = getModuleHandler(key)
    if (!handler && !lc.resettable) {
      throw new ModuleLifecycleError('Este modulo no soporta la operacion de reinicio.', 409)
    }
    if (!handler) {
      throw new ModuleLifecycleError(
        'Este modulo declara soporte de reinicio pero no tiene un handler registrado.',
        500
      )
    }

    return prisma.$transaction(async (tx) => {
      const rowsDeleted = await handler.purge({ tx, companyId })
      await writeAuditLog(tx, {
        action: 'core.module.reset',
        moduleKey: key,
        entityId: mod.id,
        actorId,
        after: { key, companyId, rowsDeleted },
      })
      return { moduleKey: key, rowsDeleted }
    })
  }

  async function dryRunUninstall({ key, mode = 'preserve-data', companyId }) {
    const mod = await prisma.runlyModule.findUnique({ where: { key } })
    if (!mod) {
      // Module was never synced/installed — no DB row, no orphaned data possible.
      // Return a safe empty result so the install modal can render without errors.
      return {
        moduleKey: key,
        operation: 'uninstall',
        mode,
        allowed: false,
        blockingDependents: [],
        ownedEntities: [],
        ownedTablePurge: mode === 'purge-owned-tables'
          ? { supported: false, tableChecks: [], totalRows: 0 }
          : null,
        permissionsAffected: 0,
        roleAssignmentsAffected: 0,
        recommendation: 'Modulo no instalado — no hay datos residuales.',
      }
    }

    const dependents = await getRequiredDependents(prisma, mod.id)
    const allowedBase = !mod.core && !!mod.uninstallable && dependents.length === 0

    const handler = getModuleHandler(key)
    let ownedEntities = []
    if (handler) {
      if (!companyId) throw new ModuleLifecycleError('Se requiere companyId para calcular datos del modulo.', 400)
      const counts = await handler.count({ prisma, companyId })
      ownedEntities = mode === 'purge-data'
        ? counts
        : counts.map((e) => ({ ...e, note: 'datos preservados — no se eliminan' }))
    }

    let ownedTablePurge = null
    if (mode === 'purge-owned-tables') {
      ownedTablePurge = await dryRunOwnedTablePurge({ key })
    }

    const permissionsAffected = await prisma.permission.count({ where: { moduleId: mod.id } })
    const roleAssignmentsAffected = await prisma.rolePermission.count({
      where: { permission: { moduleId: mod.id } },
    })
    const blockingDependents = dependents.map((d) => ({
      key: d.module.key,
      name: d.module.name,
    }))

    const allowed =
      mode === 'purge-owned-tables'
        ? allowedBase && Boolean(ownedTablePurge?.supported)
        : allowedBase

    let recommendation = 'Proceder. No hay modulos dependientes afectados.'
    if (!allowedBase) {
      recommendation = `Bloqueado por modulos dependientes: ${blockingDependents.map((d) => d.key).join(', ')}.`
    } else if (mode === 'purge-owned-tables' && !ownedTablePurge?.supported) {
      recommendation = 'Bloqueado: el modulo no declara tablas propias aptas para purga destructiva.'
    }

    return {
      moduleKey: key,
      operation: 'uninstall',
      mode,
      allowed,
      blockingDependents,
      ownedEntities,
      ownedTablePurge,
      permissionsAffected,
      roleAssignmentsAffected,
      recommendation,
    }
  }

  async function dryRunReset({ key, companyId }) {
    const mod = await prisma.runlyModule.findUnique({ where: { key } })
    if (!mod) throw new ModuleLifecycleError('Modulo no encontrado.', 404)

    const lc = mod.lifecycleConfig ?? {}
    const handler = getModuleHandler(key)
    const allowed =
      !mod.core &&
      mod.status === 'INSTALLED' &&
      mod.enabled &&
      (!!handler || !!lc.resettable)

    let ownedEntities = []
    if (handler) {
      ownedEntities = await handler.count({ prisma, companyId })
    }

    return {
      moduleKey: key,
      operation: 'reset',
      allowed,
      ownedEntities,
      note: 'Las permisiones permanecen activas. Solo se eliminan datos operativos.',
      recommendation: allowed
        ? 'Proceder. El modulo permanecera instalado y activo.'
        : 'Reinicio no soportado o modulo no activo.',
    }
  }

  async function syncModules({ manifests, actorId }) {
    let added = 0
    let updated = 0

    // Process each module in its own short transaction to avoid timeout on large permission sets
    for (const manifest of manifests) {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.runlyModule.findUnique({ where: { key: manifest.key } })
        const isCore = isOfficialCoreModuleKey(manifest.key)
        const lifecycleConfig = manifest.lifecycle ?? null

        const data = {
          name: manifest.name,
          description: manifest.description ?? null,
          version: manifest.version,
          kind: manifest.kind ?? (isCore ? 'CORE' : 'FEATURE'),
          core: isCore,
          uninstallable: isCore ? false : (manifest.uninstallable ?? true),
          manifest,
          lifecycleConfig,
        }

        if (existing) {
          await tx.runlyModule.update({
            where: { key: manifest.key },
            data: {
              ...data,
              // Core modules must always be active regardless of their previous state
              ...(isCore ? { status: 'INSTALLED', enabled: true } : {}),
            },
          })
          updated++
        } else {
          await tx.runlyModule.create({
            data: {
              ...data,
              key: manifest.key,
              status: isCore ? 'INSTALLED' : 'UNINSTALLED',
              enabled: isCore,
            },
          })
          added++
        }

        const mod = await tx.runlyModule.findUnique({ where: { key: manifest.key } })
        const isInstalled = mod.status === 'INSTALLED' && mod.enabled
        await upsertManifestPermissions(tx, mod.id, manifest.key, manifest.permissions ?? [], isInstalled)
        await upsertManifestBlueprints(tx, mod.id, manifest.blueprints ?? [])
      })
      // Built-in manifests can declare Runly ORM models inline. Filesystem
      // modules continue through their existing discovery/install flow.
      const inlineModels = (Array.isArray(manifest.models) ? manifest.models : []).filter(model => model && typeof model === 'object')
      if (inlineModels.length && isOfficialCoreModuleKey(manifest.key)) {
        await metadataSvc.syncModuleMetadata({ manifest, models: inlineModels, views: manifest.views ?? [] })
        await applyModuleOrmMigrations({ moduleKey: manifest.key, actorId })
      }
    }

    await writeAuditLog(prisma, {
      action: 'core.module.sync',
      moduleKey: 'runly.core',
      entityId: null,
      actorId,
      after: { synced: manifests.length, added, updated },
    })

    return { synced: manifests.length, added, updated }
  }

  async function runModuleSeed({ moduleKey, actorId, _lifecycleConfig = null }) {
    const row = await prisma.runlyModule.findUnique({
      where: { key: moduleKey },
      select: { lifecycleConfig: true },
    })
    const lifecycleConfig = row?.lifecycleConfig ?? _lifecycleConfig ?? null

    const moduleDir = await resolveModuleDirectory({ moduleKey, lifecycleConfig })
    if (!moduleDir) return { ran: false, reason: 'module directory not found' }

    const seedPath = path.join(moduleDir, 'seed.js')
    try {
      await fs.access(seedPath)
    } catch {
      return { ran: false, reason: 'no seed.js found' }
    }

    const url = new URL(pathToFileURL(seedPath).href)
    url.searchParams.set('t', Date.now())
    const mod = await import(url.href)
    const seedFn = mod.default
    if (typeof seedFn !== 'function') {
      throw new ModuleLifecycleError(`seed.js de "${moduleKey}" debe exportar una función por defecto.`, 500)
    }

    const result = await seedFn({ prisma })

    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: 'runly.core',
        entityType: 'RunlyModule',
        entityId: null,
        action: 'atlas.module.seed',
        before: null,
        after: { moduleKey, result: result ?? null },
      },
    })

    return { ran: true, result: result ?? null }
  }

  async function runModuleTeardown({ moduleKey, actorId }) {
    const row = await prisma.runlyModule.findUnique({
      where: { key: moduleKey },
      select: { lifecycleConfig: true },
    })
    const lifecycleConfig = row?.lifecycleConfig ?? null

    const moduleDir = await resolveModuleDirectory({ moduleKey, lifecycleConfig })
    if (!moduleDir) return { ran: false, reason: 'module directory not found' }

    const teardownPath = path.join(moduleDir, 'teardown.js')
    try {
      await fs.access(teardownPath)
    } catch {
      return { ran: false, reason: 'no teardown.js found' }
    }

    const url = new URL(pathToFileURL(teardownPath).href)
    url.searchParams.set('t', Date.now())
    const mod = await import(url.href)
    const teardownFn = mod.default
    if (typeof teardownFn !== 'function') {
      throw new ModuleLifecycleError(`teardown.js de "${moduleKey}" debe exportar una función por defecto.`, 500)
    }

    const result = await teardownFn({ prisma })

    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: 'runly.core',
        entityType: 'RunlyModule',
        entityId: null,
        action: 'atlas.module.teardown',
        before: null,
        after: { moduleKey, result: result ?? null },
      },
    })

    return { ran: true, result: result ?? null }
  }

  return {
    installModule,
    retryInstallModule,
    getModuleInstallError,
    clearFailedInstall,
    dryRunFailedInstallCleanup,
    dryRunOwnedTablePurge,
    disableModule,
    enableModule,
    uninstallModule,
    resetModule,
    dryRunUninstall,
    dryRunReset,
    syncModules,
    runModuleSeed,
    runModuleTeardown,
  }
}
