// Delivers domain_event_outbox rows to subscribed modules (plan Task 6.2).
// A module subscribes in its manifest (`events: { subscribes: [...] }`) and
// handles them in `api/events.js`:
//
//   export const handlers = {
//     'inventory.item.updated': async ({ event, payload, companyId, prisma, services }) => { ... },
//   }
//
// Each row is retried with exponential backoff (1, 2, 4... up to 60 min) and
// given up after MAX_ATTEMPTS (processed_at set, last_error kept). Events
// nobody listens to are marked processed right away. Modules disabled for the
// event's company are skipped. `services` is moduleServices.forSystem() bound
// to the subscriber and the event's company (null when the host gave none).
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const MAX_ATTEMPTS = 8
const BATCH = 50

export function backoffMs(attempts) {
  return Math.min(2 ** Math.max(0, attempts - 1), 60) * 60 * 1000
}

export function subscribersOf(modules, event, disabledModuleIds = new Set()) {
  return modules.filter((mod) => !disabledModuleIds.has(mod.id) && Array.isArray(mod.manifest?.events?.subscribes) && mod.manifest.events.subscribes.includes(event))
}

export function createDomainEventDispatcher({ prisma, resolveModulesDir, importHandlers = null, now = () => new Date(), moduleServices = null }) {
  const handlerCache = new Map()

  async function defaultImport(moduleKey) {
    const dir = await resolveModulesDir()
    const file = path.join(dir, moduleKey, 'api', 'events.js')
    const stat = await fs.stat(file).catch(() => null)
    if (!stat) return null
    const cacheKey = `${file}:${stat.mtimeMs}`
    if (!handlerCache.has(cacheKey)) {
      const mod = await import(`${pathToFileURL(file).href}?v=${stat.mtimeMs}`)
      handlerCache.set(cacheKey, mod.handlers ?? mod.default ?? null)
    }
    return handlerCache.get(cacheKey)
  }
  const loadHandlers = importHandlers ?? defaultImport

  async function deliver(row, modules) {
    const disabled = new Set((await prisma.companyModule.findMany({ where: { companyId: row.companyId, enabled: false }, select: { moduleId: true } })).map((cm) => cm.moduleId))
    for (const mod of subscribersOf(modules, row.event, disabled)) {
      const handlers = await loadHandlers(mod.key)
      const handler = typeof handlers === 'function' ? handlers : handlers?.[row.event]
      if (typeof handler !== 'function') throw new Error(`${mod.key} se suscribe a ${row.event} pero api/events.js no lo maneja`)
      const services = moduleServices ? moduleServices.forSystem(mod.key, row.companyId) : null
      await handler({ event: row.event, payload: row.payload, companyId: row.companyId, eventId: row.id, prisma, services })
    }
  }

  async function processDue() {
    const rows = await prisma.domainEventOutbox.findMany({
      where: { processedAt: null, nextAttemptAt: { lte: now() } },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    })
    if (!rows.length) return { delivered: 0, failed: 0 }
    const modules = await prisma.runlyModule.findMany({ where: { status: 'INSTALLED', enabled: true }, select: { id: true, key: true, manifest: true } })
    let delivered = 0
    let failed = 0
    for (const row of rows) {
      try {
        await deliver(row, modules)
        await prisma.domainEventOutbox.update({ where: { id: row.id }, data: { processedAt: now(), attempts: row.attempts + 1, lastError: null } })
        delivered += 1
      } catch (error) {
        const attempts = row.attempts + 1
        const giveUp = attempts >= MAX_ATTEMPTS
        await prisma.domainEventOutbox.update({
          where: { id: row.id },
          data: { attempts, lastError: String(error?.message ?? error).slice(0, 1000), nextAttemptAt: new Date(now().getTime() + backoffMs(attempts)), ...(giveUp ? { processedAt: now() } : {}) },
        })
        failed += 1
      }
    }
    return { delivered, failed }
  }

  return { processDue }
}
