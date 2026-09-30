import test from 'node:test'
import assert from 'node:assert/strict'
import { createRelationHydrator, readCheckerFor } from '../purchase-relation-hydration.js'

const COMPANY_A = '11111111-1111-7111-8111-111111111111'
const COMPANY_B = '22222222-2222-7222-8222-222222222222'

// Minimal prisma double that honours `where.companyId` and `id.in`.
function fakePrisma(tables) {
  const seen = []
  const model = name => ({
    findMany: async ({ where }) => {
      seen.push({ model: name, where })
      return (tables[name] ?? []).filter(row => row.companyId === where.companyId && (!where.id?.in || where.id.in.includes(row.id)))
    },
  })
  return {
    seen,
    invItem: model('invItem'),
    purchaseOrder: model('purchaseOrder'),
    purchaseInvoice: model('purchaseInvoice'),
    contact: model('contact'),
  }
}

test('la hidratación nunca expone entidades de otra empresa', async () => {
  const prisma = fakePrisma({
    invItem: [
      { id: 'item-a', companyId: COMPANY_A, name: 'Laptop A', assetTag: 'INV-1', status: 'available' },
      { id: 'item-b', companyId: COMPANY_B, name: 'Laptop secreta', assetTag: 'INV-X', status: 'available' },
    ],
    purchaseOrder: [{ id: 'order-a', companyId: COMPANY_A, number: 'OC-000001', status: 'ISSUED', total: 10, currency: 'MXN', supplierId: null }],
  })
  const hydrator = createRelationHydrator({ prisma })
  const relations = [
    { id: 'r1', sourceModule: 'runly.purchases', sourceType: 'purchase_order', sourceId: 'order-a', targetModule: 'runly.inventory', targetType: 'inventory_item', targetId: 'item-a', relationType: 'PURCHASED_IN', origin: 'MANUAL' },
    { id: 'r2', sourceModule: 'runly.purchases', sourceType: 'purchase_order', sourceId: 'order-a', targetModule: 'runly.inventory', targetType: 'inventory_item', targetId: 'item-b', relationType: 'PURCHASED_IN', origin: 'MANUAL' },
  ]
  const result = await hydrator.hydrate(COMPANY_A, relations, { module: 'runly.purchases', type: 'purchase_order', id: 'order-a' })
  assert.deepEqual(result.map(r => r.id), ['r1'])
  assert.equal(result[0].other.label, 'Laptop A')
  assert.equal(result[0].other.path, '/inventory/item-a')
  assert.ok(prisma.seen.every(call => call.where.companyId === COMPANY_A))
  assert.ok(!JSON.stringify(result).includes('secreta'))
})

test('la hidratación respeta los permisos de lectura del usuario', async () => {
  const prisma = fakePrisma({
    purchaseOrder: [{ id: 'order-a', companyId: COMPANY_A, number: 'OC-000001', status: 'ISSUED', total: 10, currency: 'MXN', supplierId: null }],
  })
  const hydrator = createRelationHydrator({ prisma })
  const relations = [{ id: 'r1', sourceModule: 'runly.purchases', sourceType: 'purchase_order', sourceId: 'order-a', targetModule: 'runly.inventory', targetType: 'inventory_item', targetId: 'item-a', relationType: 'PURCHASED_IN', origin: 'MANUAL' }]
  const canRead = readCheckerFor({ isAdmin: false, permissionSet: new Set(['inventory.item.read']) })
  const result = await hydrator.hydrate(COMPANY_A, relations, { module: 'runly.inventory', type: 'inventory_item', id: 'item-a' }, canRead)
  assert.equal(result.length, 0)
})
