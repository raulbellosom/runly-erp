// Automatic purge of deactivated records (spec 2026-10-04-trash-retention-conflicts
// §4.3-4.4). Per company, `InstanceConfig` `trash.retentionDays.<companyId>`
// (default 90; 0 = never). The worker purges what was deactivated (last changed)
// more than N days ago, unlinking nullable references; blocked records are
// skipped and reported in one audit entry per company.
import { TrashError } from './trash-errors.js'
import { purgeWithDependents } from './trash-purge.js'

export const DEFAULT_RETENTION_DAYS = 90
export const RETENTION_OPTIONS = Object.freeze([0, 30, 60, 90, 180])
const key = (companyId) => `trash.retentionDays.${companyId}`

export async function getRetentionDays(prisma, companyId) {
  const row = await prisma.instanceConfig.findUnique({ where: { key: key(companyId) } })
  const value = Number.parseInt(row?.value ?? '', 10)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_RETENTION_DAYS
}

export async function setRetentionDays(prisma, companyId, days) {
  if (!RETENTION_OPTIONS.includes(Number(days))) throw new TrashError('Opción de días no válida.', 422)
  await prisma.instanceConfig.upsert({ where: { key: key(companyId) }, update: { value: String(days) }, create: { key: key(companyId), value: String(days) } })
  return Number(days)
}

// Grace period: the clock starts when automatic purge first runs on this
// instance, so records already deactivated before it existed get the full
// retention in Desactivados before anything is deleted.
async function retentionSince(prisma, now) {
  const row = await prisma.instanceConfig.findUnique({ where: { key: 'trash.retention.since' } })
  if (row?.value && !Number.isNaN(Date.parse(row.value))) return new Date(row.value)
  await prisma.instanceConfig.upsert({ where: { key: 'trash.retention.since' }, update: {}, create: { key: 'trash.retention.since', value: now.toISOString() } })
  return now
}

export async function runAutoPurge({ prisma, registry, now = new Date(), perProviderLimit = 200 }) {
  const since = await retentionSince(prisma, now)
  const companies = await prisma.company.findMany({ select: { id: true } })
  const summary = []
  for (const company of companies) {
    const days = await getRetentionDays(prisma, company.id)
    if (!days) continue
    const before = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    if (before <= since) continue
    const ctx = { prisma, companyId: company.id, actorId: null, user: null }
    const purged = []
    const skipped = []
    for (const provider of await registry.allProviders(company.id)) {
      if (provider.autoPurge === false || typeof provider.expired !== 'function') continue
      for (const id of await provider.expired(ctx, before, perProviderLimit)) {
        try {
          const { record } = await purgeWithDependents(ctx, provider, id, { unlink: true })
          purged.push({ provider: provider.id, id, label: record.label ?? null, unlinked: record.unlinked ?? 0 })
        } catch (error) {
          skipped.push({ provider: provider.id, id, reason: error instanceof TrashError ? error.message : String(error?.message ?? error) })
        }
      }
    }
    if (purged.length || skipped.length) {
      await prisma.auditLog.create({
        data: {
          companyId: company.id, actorId: null, moduleKey: 'runly.core', entityType: 'Desactivados', entityId: null,
          action: 'core.records.auto_purged', before: null, after: { days, purged: purged.length, skipped: skipped.length }, metadata: { purged, skipped },
        },
      }).catch((error) => console.error('[trash] auto purge audit failed:', error?.message))
    }
    summary.push({ companyId: company.id, days, purged: purged.length, skipped: skipped.length })
  }
  return summary
}
