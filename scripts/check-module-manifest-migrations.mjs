import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

function usage() {
  console.log(
    [
      'Usage:',
      '  node scripts/check-module-manifest-migrations.mjs <module-dir> [--write]',
      '',
      'Examples:',
      '  node scripts/check-module-manifest-migrations.mjs modules/custom/<moduleKey>',
      '  node scripts/check-module-manifest-migrations.mjs modules/custom/<moduleKey> --write',
      '',
      'Status:',
      '  OK  — checksum matches',
      '  NEW — no checksum declared (will be added with --write)',
      '  BAD — checksum mismatch (will be fixed with --write)',
    ].join('\n')
  )
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function loadManifest(moduleDir) {
  const manifestPath = path.resolve(moduleDir, 'module.manifest.js')
  const mod = await import(pathToFileURL(manifestPath).href)
  if (!mod?.default || typeof mod.default !== 'object') {
    throw new Error(`Invalid manifest export in ${manifestPath}`)
  }
  return { manifestPath, manifest: mod.default }
}

function hashSql(sql) {
  return createHash('sha256').update(sql).digest('hex')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    usage()
    process.exit(args.length === 0 ? 1 : 0)
  }

  const shouldWrite = args.includes('--write')
  const moduleDirArg = args.find((arg) => !arg.startsWith('-'))
  if (!moduleDirArg) {
    usage()
    process.exit(1)
  }

  const moduleDir = path.resolve(moduleDirArg)
  const { manifestPath, manifest } = await loadManifest(moduleDir)
  const migrations = Array.isArray(manifest.migrations) ? manifest.migrations : []
  if (migrations.length === 0) {
    console.log(`No migrations found in ${manifestPath}`)
    return
  }

  const rows = []
  for (const entry of migrations) {
    const declaredPath = String(entry?.path ?? '').trim()
    if (!declaredPath) {
      throw new Error(`Invalid migration entry: path is required (${JSON.stringify(entry)})`)
    }
    const declaredChecksum = typeof entry?.checksum === 'string' && entry.checksum.trim()
      ? entry.checksum.trim().toLowerCase()
      : null

    const sqlPath = path.resolve(moduleDir, declaredPath)
    const sql = await fs.readFile(sqlPath, 'utf8')
    const computedChecksum = hashSql(sql)

    const status = !declaredChecksum ? 'NEW' : declaredChecksum === computedChecksum ? 'OK' : 'BAD'
    rows.push({ path: declaredPath, declaredChecksum, computedChecksum, status })
  }

  for (const row of rows) {
    console.log(`${row.status.padEnd(3)} ${row.path}`)
    if (row.status === 'BAD') {
      console.log(`  manifest: ${row.declaredChecksum}`)
      console.log(`  actual:   ${row.computedChecksum}`)
    }
    if (row.status === 'NEW') {
      console.log(`  computed: ${row.computedChecksum}`)
    }
  }

  const needsUpdate = rows.filter((row) => row.status !== 'OK')
  if (!needsUpdate.length) {
    console.log(`\nAll checksums match for ${manifest.key}.`)
    return
  }

  if (!shouldWrite) {
    console.log(`\n${needsUpdate.length} entry/entries need updating. Re-run with --write to fix.`)
    process.exit(2)
  }

  let manifestSource = await fs.readFile(manifestPath, 'utf8')

  for (const row of needsUpdate) {
    if (row.status === 'BAD') {
      // Replace existing checksum value
      const rx = new RegExp(
        `(path:\\s*["']${escapeRegExp(row.path)}["'][^}]*?checksum:\\s*["'])([a-fA-F0-9]{64})(["'])`,
        'ms'
      )
      if (!rx.test(manifestSource)) {
        throw new Error(`Could not locate checksum block for ${row.path} in ${manifestPath}`)
      }
      manifestSource = manifestSource.replace(rx, `$1${row.computedChecksum}$3`)
    } else if (row.status === 'NEW') {
      // Insert checksum after path declaration
      const rx = new RegExp(
        `(path:\\s*["']${escapeRegExp(row.path)}["'])(,?)`,
        'm'
      )
      if (!rx.test(manifestSource)) {
        throw new Error(`Could not locate path entry for ${row.path} in ${manifestPath}`)
      }
      manifestSource = manifestSource.replace(
        rx,
        `$1,\n      checksum:\n        "${row.computedChecksum}"$2`
      )
    }
  }

  await fs.writeFile(manifestPath, manifestSource, 'utf8')
  console.log(`\nUpdated ${needsUpdate.length} checksum(s) in ${manifestPath}`)
}

main().catch((error) => {
  console.error(error?.message ?? error)
  process.exit(1)
})
