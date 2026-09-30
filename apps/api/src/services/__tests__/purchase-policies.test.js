import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStageMap, evaluatePolicies, policyBlockers, resolveTransition, contextFromBundle,
} from '../purchase-policies.js'
import { PURCHASE_PRESETS } from '../purchases-service.js'

const complete = { ...PURCHASE_PRESETS.COMPLETE }

test('REQUIRED siempre aplica, CONDITIONAL solo con política, OPTIONAL nunca bloquea', () => {
  const small = evaluatePolicies(complete, { total: 5000, hasGoods: false, quotesCount: 0 })
  assert.deepEqual(small.map(r => r.stage), ['REQUEST', 'PURCHASE_ORDER', 'INVOICE'])
  assert.ok(!small.some(r => r.stage === 'PAYMENT'))

  const big = evaluatePolicies(complete, { total: 60000, hasGoods: true, quotesCount: 1 })
  const stages = big.map(r => r.stage)
  assert.ok(stages.includes('APPROVAL'))
  assert.ok(stages.includes('RECEIPT'))
  const quotes = big.find(r => r.stage === 'QUOTES')
  assert.equal(quotes.min, 3)
  assert.equal(quotes.satisfied, false)
  assert.equal(big.find(r => r.stage === 'APPROVAL').reason, 'Montos mayores a 50,000 requieren aprobación')
})

test('etapas deshabilitadas o sin capacidad no aparecen', () => {
  const workflow = {
    capabilities: { ...complete.capabilities, approvals: false },
    stages: [{ type: 'APPROVAL', mode: 'REQUIRED' }, { type: 'PURCHASE_ORDER', mode: 'DISABLED' }, { type: 'INVOICE', mode: 'REQUIRED' }],
    policies: [],
  }
  assert.deepEqual(evaluatePolicies(workflow, { total: 1 }).map(r => r.stage), ['INVOICE'])
})

test('policyBlockers solo considera etapas anteriores a la acción', () => {
  const context = { total: 60000, hasGoods: true, quotesCount: 3, approved: false, hasRequest: true }
  const blockers = policyBlockers(complete, context, 'PURCHASE_ORDER')
  assert.deepEqual(blockers.map(b => b.stage), ['APPROVAL'])
  assert.equal(policyBlockers(complete, { ...context, approved: true }, 'PURCHASE_ORDER').length, 0)
})

test('tabla de transiciones', () => {
  assert.ok(resolveTransition('orders', 'issue', 'APPROVED'))
  assert.equal(resolveTransition('orders', 'issue', 'CLOSED'), null)
  assert.equal(resolveTransition('invoices', 'pay', 'DRAFT'), null)
  assert.equal(resolveTransition('quotes', 'select', 'RECEIVED').to, 'SELECTED')
  assert.equal(resolveTransition('orders', 'unknown', 'DRAFT'), null)
})

test('stage map marca hecho, actual y pendiente', () => {
  const bundle = {
    case: { status: 'IN_PROGRESS' },
    orders: [{ id: 'o1', number: 'OC-000001', status: 'ISSUED', total: 100 }],
    invoices: [],
    lines: [{ ownerType: 'PURCHASE_ORDER', ownerId: 'o1', itemKind: 'GOODS', quantity: 2, receivedQuantity: 0 }],
  }
  const map = buildStageMap(PURCHASE_PRESETS.INVENTORY, bundle)
  assert.deepEqual(map.map(s => [s.type, s.state]), [
    ['PURCHASE_ORDER', 'done'], ['RECEIPT', 'current'], ['INVOICE', 'pending'], ['CLOSE', 'pending'],
  ])
  assert.deepEqual(map[0].refs, [{ type: 'purchase_order', id: 'o1', number: 'OC-000001', status: 'ISSUED' }])
})

test('stage map omite etapas opcionales sin documentos y bloquea rechazos', () => {
  const bundle = {
    case: { status: 'OPEN' },
    requests: [{ id: 'r1', number: 'SOL-000001', status: 'REJECTED' }],
  }
  const map = buildStageMap(PURCHASE_PRESETS.COMPLETE, bundle)
  assert.equal(map[0].type, 'REQUEST')
  assert.equal(map[0].state, 'blocked')
  const cancelled = buildStageMap(PURCHASE_PRESETS.BASIC, { case: { status: 'CANCELLED' } })
  assert.ok(cancelled.every(s => s.state === 'skipped'))
})

test('contexto desde el expediente', () => {
  const context = contextFromBundle({
    orders: [{ id: 'o1', status: 'RECEIVED', total: 500 }, { id: 'o2', status: 'CANCELLED', total: 9000 }],
    invoices: [{ id: 'i1', status: 'PAID', total: 500 }],
    quotes: [{ status: 'RECEIVED' }, { status: 'DISCARDED' }],
    lines: [{ ownerType: 'PURCHASE_ORDER', ownerId: 'o1', itemKind: 'GOODS', quantity: 1, receivedQuantity: 1 }],
  })
  assert.equal(context.total, 500)
  assert.equal(context.quotesCount, 1)
  assert.equal(context.receivedAll, true)
  assert.equal(context.paid, true)
  assert.equal(context.hasGoods, true)
})
