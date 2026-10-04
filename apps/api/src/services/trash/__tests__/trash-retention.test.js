import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyForeignKey } from '../trash-dependents.js'
import { runAutoPurge } from '../trash-retention.js'

test('foreign keys are classified by delete action, nullability and Connections locks', () => {
  assert.equal(classifyForeignKey({ name: 'x_fk', action: 'c', nullable: false }), 'cascade')
  assert.equal(classifyForeignKey({ name: 'x_fk', action: 'n', nullable: true }), 'setNull')
  assert.equal(classifyForeignKey({ name: 'x_fk', action: 'a', nullable: true }), 'unlinkable')
  assert.equal(classifyForeignKey({ name: 'x_fk', action: 'r', nullable: false }), 'blocking')
  assert.equal(classifyForeignKey({ name: 'conn_prestamos_x_fk', action: 'r', nullable: true }), 'blocking')
})

function fakePrisma(config) {
  const audits = []
  return {
    audits,
    config,
    company: { findMany: async () => [{ id: 'c1' }, { id: 'c2' }] },
    instanceConfig: {
      findUnique: async ({ where }) => (config[where.key] !== undefined ? { value: config[where.key] } : null),
      upsert: async ({ where, create }) => { config[where.key] ??= create.value },
    },
    auditLog: { create: async ({ data }) => audits.push(data) },
  }
}

function registryWith(expiredIds, purged) {
  return {
    allProviders: async () => [{
      id: 'custom.x:y', transactional: false,
      expired: async (_ctx, before) => expiredIds.filter((row) => row.at < before).map((row) => row.id),
      purge: async (_ctx, id) => { purged.push(id); return { id, label: id } },
    }],
  }
}

test('first run only sets the grace start; nothing is purged before the retention passes it', async () => {
  const now = new Date('2026-10-04T00:00:00Z')
  const prisma = fakePrisma({})
  const purged = []
  await runAutoPurge({ prisma, registry: registryWith([{ id: 'old', at: new Date('2025-01-01') }], purged), now })
  assert.deepEqual(purged, [])
  assert.equal(prisma.config['trash.retention.since'], now.toISOString())
})

test('after the grace, purges per company retention (default 90, 0 = never) and audits a summary', async () => {
  const prisma = fakePrisma({ 'trash.retention.since': '2026-01-01T00:00:00.000Z', 'trash.retentionDays.c2': '0' })
  const purged = []
  const rows = [{ id: 'old', at: new Date('2026-05-01') }, { id: 'recent', at: new Date('2026-09-20') }]
  const summary = await runAutoPurge({ prisma, registry: registryWith(rows, purged), now: new Date('2026-10-04T00:00:00Z') })
  assert.deepEqual(purged, ['old'], 'c1 (default 90 days) purges only the old one; c2 is never')
  assert.deepEqual(summary.map((row) => [row.companyId, row.days, row.purged]), [['c1', 90, 1]])
  assert.equal(prisma.audits[0].action, 'core.records.auto_purged')
})
