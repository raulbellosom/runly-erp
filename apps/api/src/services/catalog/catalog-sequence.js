// Anti-rollback high-water marks per trust domain (Catalog Distribution).
// Keyed by `<signer category>:<catalog id>` — never by URL — so pointing the
// instance at a mirror cannot replay an older snapshot of the same domain.
// A legitimate Hub rollback arrives as a NEW snapshot with a higher sequence.
// Stored in InstanceConfig; the alert keeps the last accepted state untouched.
export const HIGH_WATER_KEY = 'catalog.sequence.highWater'

export const domainKey = (category, catalogId) => `${category}:${catalogId}`

// Returns null when `next` may be accepted, otherwise the rejection reason.
export function sequenceDecision(accepted, next) {
  if (!accepted) return null
  if (next.sequence < accepted.sequence) return 'rollback'
  if (next.sequence === accepted.sequence) return next.sha256 === accepted.sha256 ? null : 'equivocation'
  // Intermediate sequences may be skipped (an abandoned preparation consumes one);
  // only a direct successor can and must prove the chain.
  if (next.sequence === accepted.sequence + 1 && next.previous?.sha256 !== accepted.sha256) return 'chain_broken'
  if (Date.parse(next.generatedAt) < Date.parse(accepted.generatedAt)) return 'rollback'
  return null
}

export function createHighWaterStore({ prisma }) {
  async function read() {
    const row = await prisma.instanceConfig.findUnique({ where: { key: HIGH_WATER_KEY } })
    try { const value = JSON.parse(row?.value ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} }
  }
  return {
    read,
    async get(domain) { return (await read())[domain] ?? null },
    // Monotonic: never lowers a stored sequence, even if called out of order.
    async accept(domain, { sequence, sha256, generatedAt }) {
      const all = await read()
      if (all[domain] && all[domain].sequence > sequence) return all[domain]
      all[domain] = { sequence, sha256, generatedAt, acceptedAt: new Date().toISOString() }
      const value = JSON.stringify(all)
      await prisma.instanceConfig.upsert({ where: { key: HIGH_WATER_KEY }, update: { value }, create: { key: HIGH_WATER_KEY, value } })
      return all[domain]
    },
  }
}
