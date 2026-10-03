// Atomic writes of connection sections from a core form (spec
// 2026-10-03-rme3-module-platform-v2 §3.4 D3, §12.2). The core service calls
// validateConnectionWrites() BEFORE writing anything, then, inside its own
// transaction, writes the core record and calls applyConnectionWrites(tx, ...)
// — so "Guardar" persists the core record and every connection section, or
// nothing. The index (connection_record) is updated by the source tables'
// triggers inside the same transaction.
import path from 'node:path'
import { Prisma } from '@prisma/client'
import { SQL_TYPE_MAP } from '@runly/module-engine'
import { importModuleFile } from '../../lib/module-import-revision.js'
import { resolveModulesDir } from '../module-upload-service.js'
import { can, createConnectionCatalog, entityPermission, surfaceFields } from './connection-catalog.js'

export class ConnectionWriteError extends Error {
  constructor(code, message, status, details = {}) {
    super(message)
    this.name = 'ConnectionWriteError'
    this.code = code
    this.status = status
    Object.assign(this, details)
  }
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/

// SQL cast for a model field type (values are sent as text and cast).
function castFor(field) {
  const sqlType = (SQL_TYPE_MAP[field.type] ?? (() => 'TEXT'))(field)
  if (/^VARCHAR|TEXT$/.test(sqlType)) return sqlType === 'TEXT[]' ? 'text[]' : 'text'
  return sqlType.toLowerCase()
}

function toSqlValue(field, value) {
  if (value === null || value === undefined) return null
  if (field.type === 'json') return JSON.stringify(value)
  if (field.type === 'multiselect') return Array.isArray(value) ? value : [value]
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

const pascal = (value) => String(value).split(/[_\-\s]+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')

export function createConnectionWriteService({ prisma, loadValidators = null }) {
  const catalog = createConnectionCatalog({ prisma })

  // The module's own generated Zod schemas (validators/index.js), so a save
  // from a core form validates exactly like the module's API.
  async function moduleSchemas(moduleKey, entity) {
    if (loadValidators) return loadValidators(moduleKey, entity)
    const modulesDir = await resolveModulesDir()
    const file = path.join(modulesDir, moduleKey, 'validators', 'index.js')
    const ns = await importModuleFile(file, path.join(modulesDir, moduleKey)).catch(() => null)
    const name = pascal(entity)
    return ns ? { create: ns[`create${name}Schema`] ?? null, update: ns[`update${name}Schema`] ?? null } : { create: null, update: null }
  }

  // payload: { [connectionId]: { values, expectedUpdatedAt } }. Returns the
  // normalized writes, or throws ConnectionWriteError (422 with per-field
  // errors keyed "<connectionId>.<field>"). Sections for connections that are
  // no longer active are ignored and reported in `skipped`.
  async function validateConnectionWrites({ companyId, targetType, targetId = null, payload, user }) {
    const entries = Object.entries(payload ?? {})
    if (!entries.length) return { writes: [], skipped: [] }
    const connections = await catalog.activeConnections({ companyId, targetType, user })
    const byId = new Map(connections.map((c) => [c.id, c]))
    const writes = []
    const skipped = []
    const fieldErrors = {}
    for (const [connectionId, section] of entries) {
      const connection = byId.get(connectionId)
      if (!connection || connection.kind !== 'fields') { skipped.push(connectionId); continue }
      const formFields = surfaceFields(connection, 'form')
      const allowedNames = new Set(formFields.map((field) => field.name))
      const values = {}
      for (const [name, value] of Object.entries(section?.values ?? {})) if (allowedNames.has(name)) values[name] = value
      if (!Object.keys(values).length) continue

      // A new core record (targetId null) has no connected row yet.
      const existing = targetId
        ? await prisma.connectionRecord.findFirst({
            where: { companyId, moduleKey: connection.moduleKey, connectionKey: connection.connectionKey, targetId },
            select: { sourceRecordId: true },
          })
        : null
      const action = existing ? 'update' : 'create'
      if (!can(user, entityPermission(connection.moduleKey, connection.sourceEntity, action))) {
        throw new ConnectionWriteError('connection_forbidden', `No tienes permiso para editar ${connection.label}.`, 403, { connectionId })
      }
      const schemas = await moduleSchemas(connection.moduleKey, connection.sourceEntity)
      const schema = action === 'update' ? schemas.update?.partial?.() ?? schemas.update : schemas.create?.partial?.()
      if (!schema) throw new ConnectionWriteError('connection_unavailable', `${connection.label} no se puede editar desde aquí (el módulo no publica sus validaciones).`, 422, { connectionId })
      if (action === 'create') {
        const missing = (connection.model.fields ?? []).filter((field) => field.required && field.name !== connection.targetField && !allowedNames.has(field.name))
        if (missing.length) {
          throw new ConnectionWriteError('connection_readonly', `Para crear ${connection.label} faltan campos obligatorios que se editan en ${connection.moduleName}.`, 422, { connectionId })
        }
      }
      const parsed = schema.safeParse(values)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) fieldErrors[`${connectionId}.${issue.path[0] ?? ''}`] = issue.message
        continue
      }
      writes.push({ connection, values: parsed.data, expectedUpdatedAt: section?.expectedUpdatedAt ?? null })
    }
    if (Object.keys(fieldErrors).length) {
      throw new ConnectionWriteError('connection_validation', 'Revisa los datos de las secciones conectadas.', 422, { fields: fieldErrors })
    }
    return { writes, skipped }
  }

  // Inside the core transaction. Inserts or updates each section's row of the
  // source table (1:1 by target), with optimistic concurrency on updated_at.
  async function applyConnectionWrites(tx, { companyId, targetId, writes, actorId = null }) {
    const results = []
    for (const { connection, values, expectedUpdatedAt } of writes) {
      const table = connection.sourceTable
      const targetField = connection.targetField
      if (!IDENT_RE.test(table) || !IDENT_RE.test(targetField)) throw new ConnectionWriteError('connection_invalid', 'Conexión inválida.', 500)
      const fields = new Map((connection.model.fields ?? []).map((field) => [field.name, field]))
      const columns = Object.keys(values).filter((name) => IDENT_RE.test(name) && fields.has(name))
      const tableSql = Prisma.raw(`public."${table}"`)
      const targetSql = Prisma.raw(`"${targetField}"`)

      const [current] = await tx.$queryRaw`
        SELECT "id", "updated_at" FROM ${tableSql}
        WHERE "company_id" = ${companyId}::uuid AND ${targetSql} = ${targetId}::uuid
        FOR UPDATE`
      if (current) {
        if (expectedUpdatedAt && new Date(current.updated_at).getTime() !== new Date(expectedUpdatedAt).getTime()) {
          throw new ConnectionWriteError('connection_conflict', `Otra persona modificó ${connection.label}. Recarga para ver sus cambios.`, 409, { connectionId: connection.id })
        }
        if (!columns.length) { results.push({ connectionId: connection.id, id: current.id, action: 'none' }); continue }
        const sets = Prisma.join(columns.map((name) => Prisma.sql`${Prisma.raw(`"${name}"`)} = ${toSqlValue(fields.get(name), values[name])}::${Prisma.raw(castFor(fields.get(name)))}`), ', ')
        await tx.$executeRaw`UPDATE ${tableSql} SET ${sets}, "updated_at" = now() WHERE "id" = ${current.id}::uuid`
        results.push({ connectionId: connection.id, id: current.id, action: 'update' })
      } else {
        const names = [targetField, ...columns]
        const cols = Prisma.raw(['"company_id"', ...names.map((name) => `"${name}"`)].join(', '))
        const vals = Prisma.join([
          Prisma.sql`${companyId}::uuid`,
          Prisma.sql`${targetId}::uuid`,
          ...columns.map((name) => Prisma.sql`${toSqlValue(fields.get(name), values[name])}::${Prisma.raw(castFor(fields.get(name)))}`),
        ], ', ')
        const [created] = await tx.$queryRaw`INSERT INTO ${tableSql} (${cols}) VALUES (${vals}) RETURNING "id"`
        results.push({ connectionId: connection.id, id: created.id, action: 'create' })
      }
      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            actorId,
            moduleKey: connection.moduleKey,
            entityType: connection.sourceEntity,
            entityId: results.at(-1).id,
            action: `${entityPermission(connection.moduleKey, connection.sourceEntity, results.at(-1).action === 'create' ? 'created' : 'updated')}`,
            before: null,
            after: { ...values, via: connection.targetType, targetId },
          },
        })
      }
    }
    return results
  }

  return { validateConnectionWrites, applyConnectionWrites }
}

// FK violation from a `restrict` related connection when a core record is
// hard-deleted -> { code: 'connection_restrict', connections: [{ label, count }] }.
// True when a write failed on a connection FK (any error shape: pg, Prisma
// P2003, driver-adapter wrapped). Our FK names are runly_conn_<...>_fk.
export function isRestrictViolation(error) {
  const parts = [error?.message, error?.code, error?.constraint, error?.cause?.message, error?.cause?.constraint]
  try { parts.push(JSON.stringify(error?.meta ?? {})) } catch { /* circular meta */ }
  return /runly_conn_[a-z0-9_]+_fk/.test(parts.filter(Boolean).join(' '))
}

export async function mapRestrictViolation(prisma, error, { companyId, targetIds }) {
  if (!isRestrictViolation(error)) return null
  const rows = await prisma.connectionRecord.groupBy({
    by: ['moduleKey', 'connectionKey'],
    where: { companyId, targetId: { in: targetIds } },
    _count: { _all: true },
  })
  const registry = await prisma.moduleConnection.findMany({
    where: { companyId, OR: rows.map((row) => ({ moduleKey: row.moduleKey, connectionKey: row.connectionKey })) },
    select: { moduleKey: true, connectionKey: true, kind: true },
  })
  const modules = await prisma.runlyModule.findMany({ where: { key: { in: registry.map((r) => r.moduleKey) } }, select: { key: true, manifest: true } })
  const connections = rows.map((row) => {
    const declaration = modules.find((m) => m.key === row.moduleKey)?.manifest?.connections?.find((c) => c.key === row.connectionKey)
    return { label: declaration?.label ?? row.connectionKey, count: row._count._all, restrict: declaration?.onTargetDelete === 'restrict' }
  }).filter((entry) => entry.restrict)
  return { code: 'connection_restrict', connections: connections.map(({ label, count }) => ({ label, count })) }
}
