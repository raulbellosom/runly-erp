import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_ATTEMPTS, backoffMs, createDomainEventDispatcher, subscribersOf } from '../dispatcher.js'
import { publishDomainEvent } from '../events.js'

const NOW = new Date('2026-10-04T00:00:00Z')
const MODULES = [
  { id: 'm1', key: 'custom.a', manifest: { events: { subscribes: ['inventory.item.updated'] } } },
  { id: 'm2', key: 'custom.b', manifest: { events: { subscribes: ['contacts.contact.created'] } } },
]

function fakePrisma(rows, disabled = []) {
  const updates = []
  return {
    updates,
    domainEventOutbox: { findMany: async () => rows, update: async ({ where, data }) => updates.push({ id: where.id, ...data }) },
    runlyModule: { findMany: async () => MODULES },
    companyModule: { findMany: async () => disabled.map((moduleId) => ({ moduleId })) },
  }
}

test('backoff grows and caps at 60 minutes; subscribers skip disabled modules', () => {
  assert.equal(backoffMs(1), 60_000)
  assert.equal(backoffMs(3), 4 * 60_000)
  assert.equal(backoffMs(20), 60 * 60_000)
  assert.deepEqual(subscribersOf(MODULES, 'inventory.item.updated').map((m) => m.key), ['custom.a'])
  assert.deepEqual(subscribersOf(MODULES, 'inventory.item.updated', new Set(['m1'])), [])
})

test('delivers to handlers, marks processed, retries failures and gives up', async () => {
  const received = []
  const rows = [
    { id: 'e1', companyId: 'c1', event: 'inventory.item.updated', payload: { id: 'i1' }, attempts: 0 },
    { id: 'e2', companyId: 'c1', event: 'projects.task.created', payload: {}, attempts: 0 },
    { id: 'e3', companyId: 'c1', event: 'contacts.contact.created', payload: {}, attempts: MAX_ATTEMPTS - 1 },
  ]
  const prisma = fakePrisma(rows)
  const dispatcher = createDomainEventDispatcher({
    prisma, now: () => NOW,
    importHandlers: async (key) => (key === 'custom.a'
      ? { 'inventory.item.updated': async (ctx) => received.push(ctx.payload.id) }
      : { 'contacts.contact.created': async () => { throw new Error('boom') } }),
  })
  const result = await dispatcher.processDue()
  assert.deepEqual(result, { delivered: 2, failed: 1 })
  assert.deepEqual(received, ['i1'])
  const byId = Object.fromEntries(prisma.updates.map((u) => [u.id, u]))
  assert.ok(byId.e1.processedAt && byId.e2.processedAt, 'delivered and no-subscriber events are processed')
  assert.equal(byId.e3.lastError, 'boom')
  assert.ok(byId.e3.processedAt, 'last attempt gives up')
})

test('publishDomainEvent rejects unknown events and never throws on write errors', async () => {
  await assert.rejects(publishDomainEvent({}, { companyId: 'c1', event: 'x.y.z' }), /desconocido/)
  const db = { domainEventOutbox: { create: async () => { throw new Error('db down') } } }
  assert.equal(await publishDomainEvent(db, { companyId: 'c1', event: 'contacts.contact.created', payload: {} }), null)
})
