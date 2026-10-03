// Connection lifecycle (spec 2026-10-03-rme3-module-platform-v2 §10, §23):
// keeps the database objects (FK, 1:1 index, index trigger) and the per-company
// registry (module_connection) in step with what a custom module's manifest
// declares, across install, update, uninstall, reset, purge and company
// removal. Every SQL statement comes from @runly/module-engine connection-sql
// (identifiers validated there).
import {
  buildBackfillSql,
  buildConnectionSql,
  buildOrphanCountSql,
  connectionObjectNames,
  normalizeConnection,
  validateConnectionsAgainstModels,
} from '@runly/module-engine'
import { connectionTarget } from '@runly/module-compiler'

export class ConnectionSyncError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'ConnectionSyncError'
    this.code = code
    this.statusCode = 422
    this.details = details
  }
}

// Field config a company admin starts from: the module's offered surfaces.
export function defaultFieldConfig(connection) {
  return connection.fields.map((field, order) => ({ ...field, order }))
}

// Keeps the admin's choices for fields still offered (narrowed to what the
// module offers now), appends newly offered ones, drops removed ones.
export function reconcileFieldConfig(current, connection) {
  const offered = new Map(connection.fields.map((field) => [field.field, field]))
  const kept = (Array.isArray(current) ? current : [])
    .filter((entry) => offered.has(entry.field))
    .map((entry) => {
      const limit = offered.get(entry.field)
      const narrowed = { field: entry.field, order: entry.order ?? 0 }
      for (const surface of ['form', 'detail', 'column', 'search']) narrowed[surface] = Boolean(entry[surface] && limit[surface])
      return narrowed
    })
  const known = new Set(kept.map((entry) => entry.field))
  const added = connection.fields.filter((field) => !known.has(field.field)).map((field, i) => ({ ...field, order: kept.length + i }))
  const removed = (Array.isArray(current) ? current : []).some((entry) => !offered.has(entry.field))
  return { fieldConfig: [...kept, ...added], needsReview: removed }
}

export function createConnectionLifecycle({ prisma }) {
  async function loadModule(moduleKey, db) {
    const row = await db.runlyModule.findUnique({ where: { key: moduleKey }, select: { id: true, manifest: true, version: true } })
    if (!row) return null
    const models = (await db.runlyModel.findMany({ where: { moduleKey }, select: { schema: true } })).map((m) => m.schema)
    return { ...row, models }
  }

  async function enabledCompanyIds(moduleId, db) {
    const [companies, disabled] = await Promise.all([
      db.company.findMany({ select: { id: true } }),
      db.companyModule.findMany({ where: { moduleId, enabled: false }, select: { companyId: true } }),
    ])
    const off = new Set(disabled.map((row) => row.companyId))
    return companies.map((company) => company.id).filter((id) => !off.has(id))
  }

  function specFor(moduleKey, connection, model, target) {
    return {
      moduleKey,
      targetType: connection.target,
      sourceTable: model.tableName,
      targetTable: target.table,
      connection,
      offeredColumns: connection.fields.map((field) => field.field),
      searchColumns: connection.fields.filter((field) => field.search).map((field) => field.field),
      hasEnabled: model.softDelete !== false,
      hasUpdatedAt: true,
    }
  }

  // Validates and resolves a module's declared connections without touching
  // the database. Throws ConnectionSyncError with every problem found.
  function resolveDeclared(moduleKey, manifest, models) {
    const declared = (manifest?.connections ?? []).map(normalizeConnection)
    const errors = validateConnectionsAgainstModels(declared, models)
    const resolved = []
    for (const connection of declared) {
      const target = connectionTarget(connection.target)
      if (!target) { errors.push(`connections.${connection.key}: unknown target "${connection.target}"`); continue }
      const model = models.find((m) => m.key === connection.entity)
      if (model && model.companyScoped === false) errors.push(`connections.${connection.key}: entity "${connection.entity}" must be company scoped`)
      if (model) resolved.push({ connection, target, spec: specFor(moduleKey, connection, model, target) })
    }
    if (errors.length) throw new ConnectionSyncError('CONNECTION_INVALID', `Conexiones inválidas en ${moduleKey}.`, errors)
    return resolved
  }

  async function dropConnectionObjects(db, moduleKey, connectionKey) {
    const names = connectionObjectNames(moduleKey, connectionKey)
    // CASCADE drops the trigger with the function, even if the table is gone.
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public."${names.fn}"() CASCADE`)
    const rows = await db.moduleConnection.findMany({ where: { moduleKey, connectionKey }, select: { sourceTable: true }, take: 1 })
    const table = rows[0]?.sourceTable
    if (table && /^[a-z_][a-z0-9_]*$/.test(table)) {
      await db.$executeRawUnsafe(`DO $$ BEGIN
        IF to_regclass('public.${table}') IS NOT NULL THEN
          ALTER TABLE public."${table}" DROP CONSTRAINT IF EXISTS "${names.fk}";
        END IF;
      END $$`)
    }
    await db.$executeRawUnsafe(`DROP INDEX IF EXISTS public."${names.unique}"`)
    await db.connectionRecord.deleteMany({ where: { moduleKey, connectionKey } })
    await db.moduleConnection.deleteMany({ where: { moduleKey, connectionKey } })
  }

  // Install/update: (re)create objects, backfill the index, upsert registry
  // rows per enabled company, drop connections no longer declared. Runs in one
  // transaction (Postgres DDL is transactional).
  async function syncModuleConnections({ moduleKey }) {
    const mod = await loadModule(moduleKey, prisma)
    if (!mod) return { synced: 0 }
    const resolved = resolveDeclared(moduleKey, mod.manifest, mod.models)
    const declaredKeys = new Set(resolved.map((entry) => entry.connection.key))

    return prisma.$transaction(async (tx) => {
      const existing = await tx.moduleConnection.findMany({ where: { moduleKey }, select: { connectionKey: true }, distinct: ['connectionKey'] })
      for (const { connectionKey } of existing) {
        if (!declaredKeys.has(connectionKey)) await dropConnectionObjects(tx, moduleKey, connectionKey)
      }
      if (!resolved.length) return { synced: 0 }

      const companyIds = await enabledCompanyIds(mod.id, tx)
      for (const { connection, spec } of resolved) {
        const [{ orphans }] = await tx.$queryRawUnsafe(buildOrphanCountSql(spec))
        if (orphans > 0) {
          throw new ConnectionSyncError('CONNECTION_ORPHANS',
            `La conexión "${connection.label}" tiene ${orphans} registro(s) que apuntan a ${spec.targetType} inexistentes. Corrígelos o vacía ese campo antes de actualizar.`,
            { connection: connection.key, orphans })
        }
        for (const statement of buildConnectionSql(spec)) await tx.$executeRawUnsafe(statement)
        await tx.$executeRawUnsafe(buildBackfillSql(spec))

        const rows = await tx.moduleConnection.findMany({ where: { moduleKey, connectionKey: connection.key } })
        const byCompany = new Map(rows.map((row) => [row.companyId, row]))
        for (const companyId of companyIds) {
          const row = byCompany.get(companyId)
          const base = {
            kind: connection.kind,
            targetType: connection.target,
            sourceEntity: connection.entity,
            sourceTable: spec.sourceTable,
            offeredVersion: mod.version ?? null,
          }
          if (!row) {
            await tx.moduleConnection.create({
              data: { companyId, moduleKey, connectionKey: connection.key, status: 'pending', fieldConfig: defaultFieldConfig(connection), ...base },
            })
          } else {
            const { fieldConfig, needsReview } = reconcileFieldConfig(row.fieldConfig, connection)
            await tx.moduleConnection.update({
              where: { id: row.id },
              data: { ...base, fieldConfig, needsReview: row.needsReview || needsReview },
            })
          }
        }
      }
      return { synced: resolved.length }
    }, { timeout: 60_000 })
  }

  // Uninstall: preserve-data keeps tables, FKs and triggers (data stays
  // indexed for a reinstall) and disables the registry; purge-data also drops
  // the company's index rows (its source rows were deleted by the module's
  // purge handler); purge-owned-tables removes everything like a hard purge.
  async function onModuleUninstalled({ moduleKey, mode = 'preserve-data', companyId = null, db = prisma }) {
    if (mode === 'purge-owned-tables') return onModulePurged({ moduleKey, db })
    await db.moduleConnection.updateMany({ where: { moduleKey }, data: { status: 'disabled' } })
    if (mode === 'purge-data') await db.connectionRecord.deleteMany({ where: { moduleKey, ...(companyId ? { companyId } : {}) } })
  }

  // Hard purge: source tables are dropped with CASCADE by the purge service;
  // functions and registry/index rows are removed here (same transaction).
  async function onModulePurged({ moduleKey, db = prisma }) {
    const keys = await db.moduleConnection.findMany({ where: { moduleKey }, select: { connectionKey: true }, distinct: ['connectionKey'] })
    for (const { connectionKey } of keys) await dropConnectionObjects(db, moduleKey, connectionKey)
    await db.connectionRecord.deleteMany({ where: { moduleKey } })
  }

  // Reset: module rows are deleted by its reset handler (triggers clear the
  // index); this is the safety net for handlers that TRUNCATE.
  async function onModuleReset({ moduleKey, companyId = null, db = prisma }) {
    await db.connectionRecord.deleteMany({ where: { moduleKey, ...(companyId ? { companyId } : {}) } })
  }

  // module_connection cascades with the company FK; the index has no FK.
  async function onCompanyRemoved({ companyId, db = prisma }) {
    await db.connectionRecord.deleteMany({ where: { companyId } })
  }

  // Rebuild the index of one module (or every connection) from source tables.
  async function rebuildIndex({ moduleKey = null } = {}) {
    const modules = moduleKey
      ? [moduleKey]
      : (await prisma.moduleConnection.findMany({ select: { moduleKey: true }, distinct: ['moduleKey'] })).map((row) => row.moduleKey)
    let rebuilt = 0
    for (const key of modules) {
      const mod = await loadModule(key, prisma)
      if (!mod) continue
      for (const { spec } of resolveDeclared(key, mod.manifest, mod.models)) {
        await prisma.$transaction(async (tx) => {
          await tx.connectionRecord.deleteMany({ where: { moduleKey: key, connectionKey: spec.connection.key } })
          await tx.$executeRawUnsafe(buildBackfillSql(spec))
        })
        rebuilt += 1
      }
    }
    return { rebuilt }
  }

  return { syncModuleConnections, onModuleUninstalled, onModulePurged, onModuleReset, onCompanyRemoved, rebuildIndex, resolveDeclared }
}
