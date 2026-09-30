import test from 'node:test'
import assert from 'node:assert/strict'
import { formatFolio, normalizeNumbering, allocateNumber } from '../purchases-shared.js'

test('formatFolio fills sequence, year and month tokens', () => {
  const date = new Date(2026, 8, 30)
  assert.equal(formatFolio('OC-{N:6}', 12, date), 'OC-000012')
  assert.equal(formatFolio('OC-{AAAA}-{N:4}', 7, date), 'OC-2026-0007')
  assert.equal(formatFolio('{AA}{MM}/{N}', 3, date), '2609/3')
})

test('normalizeNumbering requires the sequence token and falls back to defaults when empty', () => {
  assert.deepEqual(normalizeNumbering({ orders: 'OC-{AAAA}-{N:4}', invoices: '' }, { invoices: 'F-{N}' }), { orders: 'OC-{AAAA}-{N:4}' })
  assert.throws(() => normalizeNumbering({ orders: 'OC-2026' }), /\{N\}/)
})

function fakeTx({ maxSequence = 0, taken = [], template = null } = {}) {
  return {
    $queryRaw: async () => [{ locked: '' }],
    purchaseWorkflow: { findFirst: async () => ({ numbering: template ? { orders: template } : {} }) },
    purchaseOrder: {
      aggregate: async () => ({ _max: { sequence: maxSequence || null } }),
      findFirst: async ({ where }) => (taken.includes(where.number) ? { id: 'x' } : null),
    },
  }
}

test('a typed folio is kept as-is; the internal sequence still advances', async () => {
  const result = await allocateNumber(fakeTx({ maxSequence: 4 }), { companyId: 'c', kind: 'orders', number: ' OC-2019-88 ' })
  assert.deepEqual(result, { sequence: 5, number: 'OC-2019-88' })
})

test('a generated folio skips values a user already typed by hand', async () => {
  const result = await allocateNumber(fakeTx({ maxSequence: 4, taken: ['OC-000005'] }), { companyId: 'c', kind: 'orders' })
  assert.deepEqual(result, { sequence: 5, number: 'OC-000006' })
})
