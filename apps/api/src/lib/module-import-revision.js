import fs from 'node:fs/promises'
import path from 'node:path'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

let hooksRegistered = false

function ensureHooks() {
  if (hooksRegistered) return
  register('./module-import-hooks.js', import.meta.url)
  hooksRegistered = true
}

const SKIPPED_DIRS = new Set(['node_modules', '.bundle', '.git'])

// Latest mtime of any file in the module directory: changes whenever an
// upload or Builder publish rewrites the module, and stays stable otherwise
// so unchanged modules keep hitting the import cache on every sync.
export async function moduleRevision(moduleDir) {
  let latest = 0
  async function walk(dir) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) await walk(path.join(dir, entry.name))
      } else if (entry.isFile()) {
        const stats = await fs.stat(path.join(dir, entry.name)).catch(() => null)
        if (stats && stats.mtimeMs > latest) latest = stats.mtimeMs
      }
    }
  }
  await walk(moduleDir)
  return Math.floor(latest).toString(36)
}

// Imports a module entry file so replaced code is actually re-evaluated
// (see module-import-hooks.js).
export async function importModuleFile(filePath, moduleDir) {
  ensureHooks()
  const url = new URL(pathToFileURL(filePath).href)
  url.searchParams.set('runly-rev', await moduleRevision(moduleDir))
  return import(url.href)
}
