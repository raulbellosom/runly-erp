// Module data migrations (spec 2026-10-03-rme3-module-platform-v2 §10.6, plan
// Task 4.3): `migrations/NNN-name.js` files in a module package, run once, in
// file-name order, inside the update transaction after the schema DDL.
//
//   export async function up({ sql, query, companyIds, moduleKey }) {
//     await sql`UPDATE "taller_orden" SET estado = 'abierta' WHERE estado IS NULL`
//   }
//
// Files must be self-contained (no imports): they are loaded from their source
// text. Applied ones are recorded in the ModuleMigration ledger as
// `data__<file>` with a checksum; editing an applied file blocks the update.
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Prisma } from '@prisma/client'

const FILE_RE = /^\d{3,}-[a-z0-9-]+\.js$/
export const DATA_MIGRATION_PREFIX = 'data__'

export async function loadDataMigrationFiles(packageDir) {
  const dir = path.join(packageDir, 'migrations')
  const names = (await fs.readdir(dir).catch(() => [])).filter((name) => FILE_RE.test(name)).sort()
  return Promise.all(names.map(async (name) => {
    const source = await fs.readFile(path.join(dir, name), 'utf8')
    return { name, source, checksum: createHash('sha256').update(source).digest('hex') }
  }))
}

// { pending: [{ name, checksum, source }], applied: [name], blockers: [{ name, reason }] }
export function planDataMigrations(files, ledgerRows) {
  const ledger = new Map(ledgerRows.map((row) => [row.filename, row.checksum]))
  const pending = []
  const applied = []
  const blockers = []
  for (const file of files) {
    const recorded = ledger.get(`${DATA_MIGRATION_PREFIX}${file.name}`)
    if (!recorded) pending.push(file)
    else if (recorded !== file.checksum) blockers.push({ name: file.name, reason: 'checksum_mismatch' })
    else applied.push(file.name)
  }
  return { pending, applied, blockers }
}

async function loadUp(file) {
  const url = `data:text/javascript;base64,${Buffer.from(file.source).toString('base64')}`
  const mod = await import(url)
  const up = mod.up ?? mod.default
  if (typeof up !== 'function') throw Object.assign(new Error(`DATA_MIGRATION_INVALID: ${file.name} must export up()`), { statusCode: 422 })
  return up
}

export async function runDataMigrations(tx, { moduleKey, pending }) {
  if (!pending?.length) return []
  const companies = await tx.company.findMany({ select: { id: true } })
  const companyIds = companies.map((company) => company.id)
  const sql = (strings, ...values) => tx.$executeRaw(Prisma.sql(strings, ...values))
  const query = (strings, ...values) => tx.$queryRaw(Prisma.sql(strings, ...values))
  const ran = []
  for (const file of pending) {
    const up = await loadUp(file)
    try {
      await up({ sql, query, companyIds, moduleKey })
    } catch (error) {
      throw Object.assign(new Error(`DATA_MIGRATION_FAILED: ${file.name}: ${error?.message ?? error}`), { code: 'DATA_MIGRATION_FAILED', statusCode: 409, details: { file: file.name } })
    }
    await tx.moduleMigration.create({ data: { moduleKey, filename: `${DATA_MIGRATION_PREFIX}${file.name}`, checksum: file.checksum } })
    ran.push(file.name)
  }
  return ran
}
