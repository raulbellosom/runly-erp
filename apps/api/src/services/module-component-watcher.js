import fs from 'node:fs/promises'
import { watch } from 'node:fs'
import path from 'node:path'

// Node's native recursive watcher can throw an uncaught ENOENT while an upload
// review removes its temporary tree. Watch only installed component directories,
// with nonrecursive subscriptions and an explicit, race-tolerant rescan.
export function createModuleComponentWatcher({ root, onChange, onError = () => {} }) {
  const watchers = new Map()
  let closed = false, refreshTimer, refreshing = false, refreshAgain = false
  const list = async directory => {
    try { return await fs.readdir(directory, { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  const schedule = () => {
    if (closed) return
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => refresh().catch(onError), 10)
  }
  const attach = (directory, key, components) => {
    if (closed || watchers.has(directory)) return
    try {
      const watcher = watch(directory, { recursive: false }, () => {
        if (components && !closed) onChange(key)
        schedule()
      })
      watcher.on('error', error => {
        watcher.close(); watchers.delete(directory)
        if (error.code !== 'ENOENT') onError(error)
        schedule()
      })
      watchers.set(directory, watcher)
    } catch (error) { if (error.code !== 'ENOENT') onError(error) }
  }
  async function refresh() {
    if (closed) return
    if (refreshing) { refreshAgain = true; return }
    refreshing = true
    try {
      const desired = new Set([root])
      attach(root, null, false)
      const visit = async (directory, key) => {
        desired.add(directory); attach(directory, key, true)
        for (const entry of await list(directory)) if (entry.isDirectory() && !entry.name.startsWith('.')) await visit(path.join(directory, entry.name), key)
      }
      for (const entry of await list(root)) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const moduleDir = path.join(root, entry.name)
        desired.add(moduleDir); attach(moduleDir, entry.name, false)
        if ((await list(moduleDir)).some(e => e.name === 'components' && e.isDirectory())) await visit(path.join(moduleDir, 'components'), entry.name)
      }
      for (const [directory, watcher] of watchers) if (!desired.has(directory)) { watcher.close(); watchers.delete(directory) }
    } finally {
      refreshing = false
      if (refreshAgain) { refreshAgain = false; schedule() }
    }
  }
  return {
    start: refresh,
    close() { closed = true; clearTimeout(refreshTimer); for (const watcher of watchers.values()) watcher.close(); watchers.clear() },
  }
}
