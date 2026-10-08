import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  buildBackfillSql,
  buildConnectionSql,
  classifyOperation,
  connectionObjectNames,
  compileMigrationPlan,
  diffModelSchemas,
  hashNormalizedSchema,
  normalizeModelSchema,
  operationBlocker,
  preflightQueries,
} from '@runly/module-engine'
import { createModuleBackupService } from './module-backup-service.js'
import { createConnectionLifecycle } from './connections/connection-lifecycle.js'
import { DATA_MIGRATION_PREFIX, planDataMigrations, runDataMigrations } from './module-data-migration-service.js'

const IDENTIFIER_RE = /^[a-z][a-z0-9_]*$/
const CORE_TABLE_NAMES = new Set(
  (Prisma.dmmf?.datamodel?.models ?? []).flatMap((model) => [model.name, model.dbName].filter(Boolean)),
)

function safeIdentifier(value, label) {
  if (!IDENTIFIER_RE.test(value ?? '')) throw Object.assign(new Error(`Invalid ${label}: ${value}`), { code: 'AME_UNSAFE_IDENTIFIER' })
  return value
}

function normalizeDatabaseType(row) {
  const type = String(row.data_type ?? '').toLowerCase()
  if (type === 'character varying') return `VARCHAR(${row.character_maximum_length})`
  if (type === 'timestamp with time zone') return 'TIMESTAMPTZ'
  if (type === 'array' && row.udt_name === '_text') return 'TEXT[]'
  if (type === 'numeric') {
    return row.numeric_precision && row.numeric_scale !== null
      ? `NUMERIC(${row.numeric_precision},${row.numeric_scale})`
      : 'NUMERIC'
  }
  return ({ integer: 'INTEGER', text: 'TEXT', boolean: 'BOOLEAN', date: 'DATE', uuid: 'UUID', jsonb: 'JSONB' })[type]
    ?? String(row.udt_name ?? row.data_type).toUpperCase()
}

function defaultsMatch(expected, actual) {
  if (expected === actual) return true
  const normalize = (value) => String(value ?? '')
    .replaceAll('::character varying', '')
    .replaceAll('::text', '')
    .replace(/^'(.*)'$/, '$1')
    .toLowerCase()
  return normalize(expected) === normalize(actual)
}

export class ModuleSchemaMigrationError extends Error {
  constructor(message, { code = message, statusCode = 409, details = null } = {}) {
    super(message)
    this.name = 'ModuleSchemaMigrationError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }
}

export function createModuleSchemaMigrationService({ prisma }) {
  const backupSvc = createModuleBackupService({ prisma })
  const connectionLifecycle = createConnectionLifecycle({ prisma })
  async function inspectTableSchema(tableName, db = prisma) {
    const table = safeIdentifier(tableName, 'table name')
    // ::text — @prisma/adapter-pg (the driver adapter this service runs
    // under) can't deserialize the raw `regclass` OID type and throws P2010
    // ("Failed to deserialize column of type 'regclass'"), which made every
    // schema-diff preflight for an already-installed module fail outright.
    // Found during golden-path QA on the very first additive Builder
    // update. NULL::text (table doesn't exist) is still falsy below.
    const tableRows = await db.$queryRawUnsafe(
      `SELECT to_regclass('public.' || $1)::text AS relation`,
      table,
    )
    if (!tableRows?.[0]?.relation) return { table, exists: false, rowCount: 0, columns: [], indexes: [] }
    const columns = await db.$queryRawUnsafe(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default,
              character_maximum_length, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      table,
    )
    const indexes = await db.$queryRawUnsafe(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1
        ORDER BY indexname`,
      table,
    )
    const countRows = await db.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS count FROM "${table}"`)
    return {
      table,
      exists: true,
      rowCount: Number(countRows?.[0]?.count ?? 0),
      columns: columns.map((row) => ({
        name: row.column_name,
        sqlType: normalizeDatabaseType(row),
        nullable: row.is_nullable === 'YES',
        default: row.column_default ?? null,
      })),
      indexes: indexes.map((row) => {
        const fieldList = String(row.indexdef).match(/\(([^)]+)\)\s*$/)?.[1] ?? ''
        const fields = fieldList.split(',').map((field) => field.trim().replaceAll('"', '')).filter((field) => IDENTIFIER_RE.test(field))
        return { name: row.indexname, fields, unique: /CREATE UNIQUE INDEX/i.test(row.indexdef) }
      }),
    }
  }

  // Counts that decide whether type changes, NOT NULL and unique indexes can
  // run as is (schema-diff.js preflightQueries/classifyOperation).
  async function classifyWithPreflight(operations, db = prisma) {
    const counts = new Map()
    for (const query of preflightQueries(operations)) {
      const rows = await db.$queryRawUnsafe(query.sql)
      counts.set(query.id, { ...(counts.get(query.id) ?? {}), [query.kind]: Number(rows?.[0]?.count ?? 0) })
    }
    return operations.map((operation) => classifyOperation(operation, counts.get(operation.id)))
  }

  // decisions: { [operation.id]: { backfill?, onConversionFailure? } } chosen
  // by the admin in the update report (spec §12.3).
  async function planModuleSchemaMigration({ moduleKey, desiredModels, moduleRow = null, decisions = {}, dataMigrationFiles = [], manifest = null }) {
    const persistedRows = moduleRow?.status === 'INSTALLED'
      ? await prisma.runlyModel.findMany({
          where: { moduleKey },
          select: { name: true, tableName: true, schema: true, fields: { select: { name: true, validation: true } } },
        })
      : []
    const previousByTable = new Map(persistedRows.map((row) => [row.tableName, row]))
    const desired = desiredModels.map((model) => ({ model, schema: normalizeModelSchema(model) }))
    const operations = []
    const drift = []
    const warnings = []
    const models = []

    for (const entry of desired) {
      if (CORE_TABLE_NAMES.has(entry.schema.table)) {
        throw new ModuleSchemaMigrationError('CORE_TABLE_OWNERSHIP_FORBIDDEN', {
          details: { table: entry.schema.table },
        })
      }
      const previousRow = previousByTable.get(entry.schema.table)
      const previous = previousRow?.schema ? normalizeModelSchema(previousRow.schema) : null
      const actual = await inspectTableSchema(entry.schema.table)
      // Fields removed by an earlier update keep their column (ARCHIVE_COLUMN)
      // and their RunlyField row marked removed_from_manifest.
      const archivedColumns = (previousRow?.fields ?? [])
        .filter((field) => field.validation?.reason === 'removed_from_manifest')
        .map((field) => field.name)
      const diff = diffModelSchemas({
        previous,
        desired: entry.schema,
        actual,
        rowCount: actual.rowCount,
        modelDefinition: entry.model,
        archivedColumns,
      })
      operations.push(...await classifyWithPreflight(diff.operations))
      drift.push(...diff.drift)
      warnings.push(...diff.warnings)
      models.push({
        model: entry.schema.model,
        table: entry.schema.table,
        previousSchemaHash: previous ? hashNormalizedSchema(previous) : null,
        nextSchemaHash: hashNormalizedSchema(entry.schema),
        desiredSchema: entry.schema,
      })
      previousByTable.delete(entry.schema.table)
    }
    for (const removed of previousByTable.values()) {
      operations.push({ type: 'DROP_TABLE', table: removed.tableName, model: removed.name, safety: 'DESTRUCTIVE' })
    }
    const ledger = dataMigrationFiles.length
      ? await prisma.moduleMigration.findMany({ where: { moduleKey, filename: { startsWith: DATA_MIGRATION_PREFIX } }, select: { filename: true, checksum: true } })
      : []
    const data = planDataMigrations(dataMigrationFiles, ledger)
    const dataMigrations = { pending: data.pending.map((file) => file.name), applied: data.applied, blockers: data.blockers }
    const required = operations.length > 0 || data.pending.length > 0
    const blockers = [
      ...operations
        .map((operation) => ({ id: operation.id, reason: operationBlocker(operation, decisions[operation.id]) }))
        .filter((entry) => entry.reason),
      ...data.blockers.map((entry) => ({ id: `DATA_MIGRATION:${entry.name}`, reason: entry.reason })),
    ]
    const canAutoApply = drift.length === 0 && blockers.length === 0
    const core = { moduleKey, models, operations, drift, warnings, decisions, dataMigrations }
    const planHash = createHash('sha256').update(JSON.stringify(core)).digest('hex')
    return {
      ...core,
      required,
      canAutoApply,
      blockers,
      safety: drift.length ? 'DRIFT'
        : ['DESTRUCTIVE', 'UNSUPPORTED', 'NEEDS_CHECK', 'NEEDS_CONVERSION', 'NEEDS_BACKFILL', 'CONDITIONAL']
          .find((level) => operations.some((operation) => operation.safety === level)) ?? 'SAFE',
      planHash,
      filename: `schema__${planHash.slice(0, 24)}.sql`,
      sql: canAutoApply ? compileRuntimeSchemaPlan(operations, decisions) : [],
      baselineCreated: !required && warnings.some((warning) => warning.type === 'BASELINE_COLUMN'),
      versionFrom: moduleRow?.version ?? null,
      // Sources stay out of planHash/audit; only the apply step reads them.
      dataMigrationSources: data.pending,
      connectionSpecs: resolveConnectionSpecs(moduleKey, manifest, desiredModels),
    }
  }

  async function applyModuleSchemaMigration({ plan, actorId = null }) {
    if (plan.drift.length) throw new ModuleSchemaMigrationError('SCHEMA_DRIFT_DETECTED', { details: plan })
    if (!plan.required) return { applied: false, reason: 'no_changes', plan }
    if (!plan.canAutoApply) throw new ModuleSchemaMigrationError('SCHEMA_MIGRATION_UNSUPPORTED', { details: plan })
    // Backup, DDL, verification and data migrations commit or roll back together.
    return prisma.$transaction(async (tx) => {
      const existing = plan.operations.length
        ? await tx.moduleMigration.findUnique({
            where: { moduleKey_filename: { moduleKey: plan.moduleKey, filename: plan.filename } },
          })
        : null
      const schemaPending = plan.operations.length > 0 && !existing
      const dataPending = plan.dataMigrationSources ?? []
      if (!schemaPending && !dataPending.length) return { applied: false, reason: 'already_applied', migration: existing, plan }
      const backup = await snapshotBeforeUpdate(tx, plan, actorId)
      const droppedTriggers = await dropConnectionTriggers(tx, plan.moduleKey)
      if (schemaPending) await applySchemaStatements(tx, plan)
      const dataMigrationsRan = await runDataMigrations(tx, { moduleKey: plan.moduleKey, pending: dataPending })
      await rebuildConnections(tx, plan, droppedTriggers)
      const migration = schemaPending ? await recordSchemaMigration(tx, plan, actorId, backup) : existing
      return { applied: true, migration, backupId: backup?.id ?? null, dataMigrationsRan, plan }
    }, { maxWait: 10_000, timeout: 120_000 })
  }

  // Connection specs of the NEW version, rebuilt at the end of the apply
  // transaction. null when unknown (the post-publish sync recreates them).
  function resolveConnectionSpecs(moduleKey, manifest, desiredModels) {
    if (!manifest?.connections?.length) return null
    try {
      return connectionLifecycle.resolveDeclared(moduleKey, manifest, desiredModels).map((entry) => entry.spec)
    } catch {
      return null
    }
  }

  // Connection triggers name the module's columns in their function body: a
  // rename or a backfill UPDATE would hit the old trigger. Drop them before
  // the DDL and recreate them (with the new columns) before commit.
  async function dropConnectionTriggers(tx, moduleKey) {
    if (!tx.moduleConnection?.findMany) return []
    const rows = await tx.moduleConnection.findMany({ where: { moduleKey }, select: { connectionKey: true, sourceTable: true }, distinct: ['connectionKey'] })
    for (const row of rows) {
      const names = connectionObjectNames(moduleKey, row.connectionKey)
      await tx.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${names.trigger}" ON public."${row.sourceTable}"`)
    }
    return rows
  }

  async function rebuildConnections(tx, plan, dropped) {
    if (plan.connectionSpecs) {
      for (const spec of plan.connectionSpecs) {
        for (const statement of buildConnectionSql(spec)) await tx.$executeRawUnsafe(statement)
        await tx.$executeRawUnsafe(buildBackfillSql(spec))
      }
    } else if (dropped.length) {
      console.warn(`[module-schema] ${plan.moduleKey}: connection triggers dropped; the post-publish sync recreates them`)
    }
  }

  // Skipped (with a warning) until the module_schema_backup migration is applied.
  async function snapshotBeforeUpdate(tx, plan, actorId) {
    const [{ ready }] = await tx.$queryRawUnsafe(`SELECT to_regclass('public.module_schema_backup') IS NOT NULL AS ready`)
    if (!ready || !tx.moduleSchemaBackup) {
      console.warn('[module-schema] module_schema_backup table missing; update applied without a backup')
      return null
    }
    const renames = {}
    for (const operation of plan.operations) {
      if (operation.type === 'RENAME_COLUMN') (renames[operation.table] ??= {})[operation.column] = operation.from
    }
    return backupSvc.snapshotModuleTables(tx, {
      moduleKey: plan.moduleKey,
      tables: plan.models.map((model) => model.table),
      versionFrom: plan.versionFrom ?? null,
      versionTo: plan.versionTo ?? null,
      actorId,
      renames,
    })
  }

  // A nullable target may authorize failed values becoming NULL. The shared
  // compiler orders type conversion before nullability; execute the runtime
  // relaxation first, after renames, so the existing NOT NULL cannot reject
  // the explicitly approved conversion. All statements remain transactional.
  function compileRuntimeSchemaPlan(operations, decisions) {
    const renames = operations.filter(op => op.type === 'RENAME_COLUMN')
    const relax = operations.filter(op => op.type === 'DROP_NOT_NULL' && operations.some(change =>
      change.type === 'ALTER_COLUMN_TYPE' && change.table === op.table && change.column === op.column && change.nullable))
    const early = new Set([...renames, ...relax])
    return [renames, relax, operations.filter(op => !early.has(op))]
      .flatMap(part => compileMigrationPlan({ operations: part }, decisions))
  }

  async function applySchemaStatements(tx, plan) {
    for (const statement of plan.sql) await tx.$executeRawUnsafe(statement)
    for (const model of plan.models) {
      const expected = model.desiredSchema
      const actual = await inspectTableSchema(model.table, tx)
      if (!actual.exists) throw new ModuleSchemaMigrationError('SCHEMA_VERIFICATION_FAILED', { details: { table: model.table } })
      const actualByName = new Map(actual.columns.map((column) => [column.name, column]))
      const mismatch = expected.columns.find((column) => {
        const found = actualByName.get(column.name)
        return !found
          || found.sqlType !== column.sqlType
          || found.nullable !== column.nullable
          || !defaultsMatch(column.default, found.default)
      })
      if (mismatch) throw new ModuleSchemaMigrationError('SCHEMA_VERIFICATION_FAILED', { details: { table: model.table, column: mismatch.name } })
      const actualIndexes = new Map(actual.indexes.map((index) => [index.name, index]))
      const missingIndex = expected.indexes.find((index) => {
        const found = actualIndexes.get(index.name)
        return !found || found.unique !== index.unique || JSON.stringify(found.fields) !== JSON.stringify(index.fields)
      })
      if (missingIndex) throw new ModuleSchemaMigrationError('SCHEMA_VERIFICATION_FAILED', { details: { table: model.table, index: missingIndex.name } })
    }
  }

  async function recordSchemaMigration(tx, plan, actorId, backup) {
    const checksum = createHash('sha256').update(plan.sql.join('\n')).digest('hex')
    const migration = await tx.moduleMigration.create({
      data: { moduleKey: plan.moduleKey, filename: plan.filename, checksum },
    })
    if (tx.auditLog?.create) {
      await tx.auditLog.create({
        data: {
          actorId,
          moduleKey: plan.moduleKey,
          entityType: 'ModuleMigration',
          entityId: migration.id,
          action: 'core.module.schema.migrate',
          before: null,
          after: JSON.stringify({ planHash: plan.planHash, safety: plan.safety, operations: plan.operations, backupId: backup?.id ?? null }),
          metadata: null,
        },
      })
    }
    return migration
  }

  return {
    inspectTableSchema,
    planModuleSchemaMigration,
    applyModuleSchemaMigration,
    listBackups: backupSvc.listBackups,
    restoreBackup: backupSvc.restoreBackup,
  }
}
