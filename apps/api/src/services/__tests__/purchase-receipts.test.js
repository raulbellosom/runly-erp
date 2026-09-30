import test from 'node:test'
import assert from 'node:assert/strict'
import { planReceipt } from '../purchase-receipts-service.js'

const lines = [
  { id: 'l1', description: 'Laptop', quantity: 3, receivedQuantity: 1, itemKind: 'GOODS' },
  { id: 'l2', description: 'Monitor', quantity: 2, receivedQuantity: 0, itemKind: 'GOODS' },
  { id: 'l3', description: 'Instalación', quantity: 1, receivedQuantity: 0, itemKind: 'SERVICE' },
]

test('recepción parcial acumula cantidades y deja la orden parcialmente recibida', () => {
  const plan = planReceipt(lines, [{ orderLineId: 'l1', quantity: 1 }, { orderLineId: 'l1', quantity: 0.5 }])
  assert.deepEqual(plan.lines, [{ lineId: 'l1', quantity: 1.5, receivedQuantity: 2.5 }])
  assert.equal(plan.orderStatus, 'PARTIALLY_RECEIVED')
})

test('recibir todo lo pendiente de bienes marca la orden como recibida (servicios no cuentan)', () => {
  const plan = planReceipt(lines, [{ orderLineId: 'l1', quantity: 2 }, { orderLineId: 'l2', quantity: 2 }])
  assert.equal(plan.orderStatus, 'RECEIVED')
})

test('rechaza recibir más de lo pendiente', () => {
  assert.throws(() => planReceipt(lines, [{ orderLineId: 'l1', quantity: 2.01 }]), error => error.code === 'VALIDATION' && /excede/.test(error.message))
  assert.throws(() => planReceipt(lines, [{ orderLineId: 'l2', quantity: 1 }, { orderLineId: 'l2', quantity: 1.5 }]), /excede/)
})

test('rechaza conceptos ajenos, cantidades negativas y recepciones vacías', () => {
  assert.throws(() => planReceipt(lines, [{ orderLineId: 'otro', quantity: 1 }]), /no pertenece/)
  assert.throws(() => planReceipt(lines, [{ orderLineId: 'l1', quantity: -1 }]), /no son válidas/)
  assert.throws(() => planReceipt(lines, [{ orderLineId: 'l1', quantity: 0 }]), /al menos una/)
})
