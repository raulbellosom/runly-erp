import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getDocumentActions } from '../document-actions.js'
import { resolveScreen } from '../../../../app/module-screen-resolver.js'

const all = () => true
const caps = (on) => (key) => on.includes(key)

test('issued order offers receive and invoice only when those capabilities are on', () => {
  const doc = { id: 'o1', status: 'ISSUED' }
  const keys = getDocumentActions('orders', doc, { has: caps(['receipts', 'invoices']), can: all }).map((a) => a.key)
  assert.ok(keys.includes('receive') && keys.includes('invoice'))
  const bare = getDocumentActions('orders', doc, { has: caps([]), can: all }).map((a) => a.key)
  assert.ok(!bare.includes('receive') && !bare.includes('invoice'))
})

test('pay needs the payments capability and permission', () => {
  const doc = { id: 'f1', status: 'PENDING' }
  assert.ok(getDocumentActions('invoices', doc, { has: caps(['payments']), can: all }).some((a) => a.key === 'pay'))
  assert.ok(!getDocumentActions('invoices', doc, { has: caps(['payments']), can: (k) => k !== 'purchases.payment.manage' }).some((a) => a.key === 'pay'))
})

test('resolver maps every purchases path to its screen', () => {
  const map = Object.fromEntries(['/purchases', '/purchases/list', '/purchases/new', '/purchases/:id', '/purchases/approvals', '/purchases/suppliers', '/purchases/suppliers/:id', '/purchases/settings']
    .map((k) => [`runly.purchases:${k}`, k]))
  const r = (p) => resolveScreen(map, 'runly.purchases', p, null)
  assert.equal(r('/'), '/purchases')
  assert.equal(r('/purchases/payments'), '/purchases/list')
  assert.equal(r('/purchases/orders/new'), '/purchases/new')
  assert.equal(r('/purchases/invoices/abc/edit'), '/purchases/new')
  assert.equal(r('/purchases/cases/abc'), '/purchases/:id')
  assert.equal(r('/purchases/receipts/abc'), '/purchases/:id')
  assert.equal(r('/purchases/suppliers/abc'), '/purchases/suppliers/:id')
})
