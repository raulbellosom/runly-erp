// Pre-update backups of an RME3 module's tables (spec
// 2026-10-03-rme3-module-platform-v2 §10.6, plan Task 4.3). A snapshot is a
// plain `CREATE TABLE runly_backup."<table>__<stamp>" AS TABLE "<table>"`
// taken inside the update transaction; restore copies the rows back into the
// current tables (same-named columns, renamed ones mapped back) and keeps the
// current structure. Backups expire after BACKUP_TTL_DAYS (worker job).
const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/
export const BACKUP_SCHEMA = 'runly_backup'
export const BACKUP_TTL_DAYS = 14

// format_type() output such as "character varying(255)" or "text[]".
function safeType(type) {
  if (!/^[a-z][a-z0-9 ,()[\]]*$/.test(type ?? '')) throw Object.assign(new Error(`Invalid column type: ${type}`), { code: 'AME_UNSAFE_IDENTIFIER' })
  return type
}

function ident(value, label) {
  if (!IDENTIFIER_RE.test(value ?? '')) throw Object.assign(new Error(`Invalid ${label}: ${value}`), { code: 'AME_UNSAFE_IDENTIFIER' })
  return value
}

export function backupTableName(table, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  return `${ident(table, 'table').slice(0, 45)}__${stamp}`
}

// Tables ordered so that a table referenced by another (FK) comes first.
export function orderByForeignKeys(tables, foreignKeys) {
  const set = new Set(tables)
  const deps = new Map(tables.map((table) => [table, new Set()]))
  for (const fk of foreignKeys) {
    if (set.has(fk.table) && set.has(fk.references) && fk.table !== fk.references) deps.get(fk.table).add(fk.references)
  }
  const ordered = []
  const visiting = new Set()
  const visit = (table) => {
    if (ordered.includes(table) || visiting.has(table)) return
    visiting.add(table)
    for (const dep of deps.get(table)) visit(dep)
    visiting.delete(table)
    ordered.push(table)
  }
  tables.forEach(visit)
  return ordered
}

export function createModuleBackupService({ prisma }) {
  async function existingTables(db, tables) {
    const rows = await db.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      tables,
    )
    const found = new Set(rows.map((row) => row.table_name))
    return tables.filter((table) => found.has(table))
  }

  // renames: { [table]: { [currentColumn]: columnInBackup } } from the plan.
  async function snapshotModuleTables(tx, { moduleKey, tables, versionFrom = null, versionTo = null, actorId = null, renames = {}, now = new Date() }) {
    const present = await existingTables(tx, tables.map((table) => ident(table, 'table')))
    if (!present.length) return null
    await tx.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${BACKUP_SCHEMA}"`)
    const entries = []
    for (const table of present) {
      const backupTable = backupTableName(table, now)
      await tx.$executeRawUnsafe(`CREATE TABLE "${BACKUP_SCHEMA}"."${backupTable}" AS TABLE "${table}"`)
      const [{ count }] = await tx.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS count FROM "${BACKUP_SCHEMA}"."${backupTable}"`)
      entries.push({ table, backupTable, rows: Number(count), renames: renames[table] ?? {} })
    }
    return tx.moduleSchemaBackup.create({
      data: {
        moduleKey, versionFrom, versionTo, tables: entries, createdById: actorId,
        expiresAt: new Date(now.getTime() + BACKUP_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    })
  }

  async function listBackups(moduleKey) {
    return prisma.moduleSchemaBackup.findMany({ where: { moduleKey }, orderBy: { createdAt: 'desc' }, take: 50 })
  }

  // [{ name, type, required }]: required = NOT NULL without a default.
  async function columnsOf(db, schema, table) {
    const rows = await db.$queryRawUnsafe(
      `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null, a.atthasdef AS has_default
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      schema, table,
    )
    return rows.map((row) => ({ name: row.name, type: row.type, required: row.not_null && !row.has_default }))
  }


  // Replaces the current rows of every backed-up table with the backup's,
  // in one transaction. Row deletes fire the module's triggers, so the
  // Connections index stays consistent.
  async function restoreBackup({ moduleKey, backupId, actorId = null }) {
    const backup = await prisma.moduleSchemaBackup.findFirst({ where: { id: backupId, moduleKey } })
    if (!backup) throw Object.assign(new Error('BACKUP_NOT_FOUND'), { statusCode: 404 })
    if (backup.expiresAt < new Date()) throw Object.assign(new Error('BACKUP_EXPIRED'), { statusCode: 409 })
    return prisma.$transaction((tx) => restoreInTx(tx, backup, actorId), { maxWait: 10_000, timeout: 120_000 })
  }

  // Replaces the current rows of every backed-up table with the backup's.
  // Row deletes fire the module's triggers, so the Connections index stays
  // consistent; deletes run child-first and inserts parent-first (FKs).
  async function restoreInTx(tx, backup, actorId = null) {
    const entries = (backup.tables ?? []).map((entry) => ({ ...entry, table: ident(entry.table, 'table'), backupTable: ident(entry.backupTable, 'backup table') }))
    const tables = entries.map((entry) => entry.table)
    const fks = await tx.$queryRawUnsafe(
      `SELECT c.conrelid::regclass::text AS "table", c.confrelid::regclass::text AS "references"
         FROM pg_constraint c
        WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY($1::text[])`,
      tables,
    )
    const order = orderByForeignKeys(tables, fks.map((fk) => ({ table: String(fk.table).replaceAll('"', ''), references: String(fk.references).replaceAll('"', '') })))
    const byTable = new Map(entries.map((entry) => [entry.table, entry]))
    // Column pairs per table; a required column added after the backup (no
    // source, no default) makes the restore impossible: refuse before deleting.
    const plans = new Map()
    const missing = []
    for (const table of order) {
      const entry = byTable.get(table)
      const current = await columnsOf(tx, 'public', table)
      const backedUp = new Map((await columnsOf(tx, BACKUP_SCHEMA, entry.backupTable)).map((column) => [column.name, column]))
      // [target, source expression]: cast to the current type when it changed.
      const pairs = current
        .map((column) => [column, backedUp.get(entry.renames?.[column.name] ?? column.name)])
        .filter(([, source]) => source)
        .map(([column, source]) => [column.name, source.type === column.type ? `"${ident(source.name, 'column')}"` : `"${ident(source.name, 'column')}"::${safeType(column.type)}`])
      for (const column of current) {
        if (column.required && !pairs.some(([name]) => name === column.name)) missing.push(`${table}.${column.name}`)
      }
      plans.set(table, pairs)
    }
    if (missing.length) {
      throw Object.assign(new Error('BACKUP_RESTORE_INCOMPATIBLE'), { code: 'BACKUP_RESTORE_INCOMPATIBLE', statusCode: 409, details: { columns: missing } })
    }
    for (const table of [...order].reverse()) await tx.$executeRawUnsafe(`DELETE FROM "${table}"`)
    const restored = []
    for (const table of order) {
      const entry = byTable.get(table)
      const pairs = plans.get(table)
      if (!pairs.length) continue
      const target = pairs.map(([column]) => `"${ident(column, 'column')}"`).join(', ')
      const source = pairs.map(([, expression]) => expression).join(', ')
      const inserted = await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${target}) SELECT ${source} FROM "${BACKUP_SCHEMA}"."${entry.backupTable}"`)
      restored.push({ table, rows: Number(inserted) })
    }
    await tx.moduleSchemaBackup.update({ where: { id: backup.id }, data: { restoredAt: new Date() } })
    if (tx.auditLog?.create) {
      await tx.auditLog.create({
        data: {
          actorId, moduleKey: backup.moduleKey, entityType: 'ModuleSchemaBackup', entityId: backup.id,
          action: 'core.module.backup.restored', before: null, after: JSON.stringify({ restored }), metadata: null,
        },
      })
    }
    return { backupId: backup.id, restored }
  }

  async function dropExpiredBackups(now = new Date()) {
    const expired = await prisma.moduleSchemaBackup.findMany({ where: { expiresAt: { lt: now } }, take: 100 })
    for (const backup of expired) {
      for (const entry of backup.tables ?? []) {
        if (IDENTIFIER_RE.test(entry.backupTable ?? '')) {
          await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${BACKUP_SCHEMA}"."${entry.backupTable}"`)
        }
      }
      await prisma.moduleSchemaBackup.delete({ where: { id: backup.id } })
    }
    return { deleted: expired.length }
  }

  return { snapshotModuleTables, listBackups, restoreBackup, restoreInTx, dropExpiredBackups }
}
