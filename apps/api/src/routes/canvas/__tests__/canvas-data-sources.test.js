import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DATA_SOURCES, createCanvasDataSources, isDataSource } from '../canvas-data-sources.js'

const COMPANY = 'company-1'
const allowAll = { assertCompanyMember: async () => true }
const denyAll = { assertCompanyMember: async () => { throw new Error('no') } }
const profile = { userProfile: { findUnique: async () => ({ id: 'profile-1' }) } }

function prismaWith(extra) {
  return {
    ...profile,
    runlyModule: { findMany: async () => [{ key: 'runly.inventory' }, { key: 'runly.fleet' }] },
    ...extra,
  }
}

describe('Canvas data sources', () => {
  it('knows inventory sources plus every relation target type', () => {
    assert.ok(isDataSource('inventory_location'))
    assert.ok(isDataSource('inventory_item'))
    assert.ok(isDataSource('vehicle'))
    assert.equal(isDataSource('nope'), false)
    assert.equal(DATA_SOURCES.inventory_location.permission, 'inventory.item.read')
  })

  it('summarises a location by item status', async () => {
    const prisma = prismaWith({
      invLocation: { findMany: async ({ where }) => { assert.equal(where.companyId, COMPANY); return [{ id: 'loc-1', name: 'Rack A-3', description: null }] } },
      invItem: { groupBy: async () => [{ locationId: 'loc-1', status: 'available', _count: { _all: 2 } }, { locationId: 'loc-1', status: 'maintenance', _count: { _all: 1 } }] },
    })
    const sources = createCanvasDataSources({ prisma, access: allowAll, relationTargets: {} })
    const result = await sources.resolve({ authUserId: 'auth-1', companyId: COMPANY, refs: [{ source: 'inventory_location', id: 'loc-1' }, { source: 'inventory_location', id: 'loc-x' }] })
    assert.equal(result['inventory_location:loc-1'].summary, '3 equipos · 1 en mantenimiento')
    assert.equal(result['inventory_location:loc-1'].tone, 'warning')
    assert.equal(result['inventory_location:loc-x'].missing, true)
  })

  it('describes an item by status, assignee and location', async () => {
    const prisma = prismaWith({
      invItem: { findMany: async () => [{ id: 'it-1', name: 'Laptop 14', assetTag: 'A-001', status: 'assigned', adminStatus: 'registered', assignedTo: { firstName: 'Ana', lastName: 'Ruiz' }, location: { name: 'Oficina' }, condition: { name: 'Buena' } }] },
    })
    const sources = createCanvasDataSources({ prisma, access: allowAll, relationTargets: {} })
    const result = await sources.resolve({ authUserId: 'auth-1', companyId: COMPANY, refs: [{ source: 'inventory_item', id: 'it-1' }] })
    const item = result['inventory_item:it-1']
    assert.equal(item.tone, 'info')
    assert.equal(item.subtitle, 'A-001')
    assert.deepEqual(item.metrics.find((m) => m.label === 'Asignado a'), { label: 'Asignado a', value: 'Ana Ruiz' })
    assert.equal(item.url, '/app/m/runly.inventory/inventory/it-1')
  })

  it('marks refs restricted when the user lacks the source permission', async () => {
    const sources = createCanvasDataSources({ prisma: prismaWith({}), access: denyAll, relationTargets: {} })
    const result = await sources.resolve({ authUserId: 'auth-1', companyId: COMPANY, refs: [{ source: 'inventory_item', id: 'it-1' }] })
    assert.equal(result['inventory_item:it-1'].restricted, true)
  })

  it('delegates other types to relation targets', async () => {
    const relationTargets = { resolve: async ({ type, ids }) => new Map(ids.map((id) => [id, { title: `${type} ${id}`, subtitle: null, url: '/x' }])) }
    const sources = createCanvasDataSources({ prisma: prismaWith({}), access: allowAll, relationTargets })
    const result = await sources.resolve({ authUserId: 'auth-1', companyId: COMPANY, refs: [{ source: 'vehicle', id: 'v-1' }, { source: 'vehicle', id: 'v-2' }] })
    assert.equal(result['vehicle:v-1'].title, 'vehicle v-1')
    assert.equal(result['vehicle:v-1'].tone, 'neutral')
  })

  it('lists sources with installed/allowed flags', async () => {
    const sources = createCanvasDataSources({ prisma: prismaWith({}), access: allowAll, relationTargets: {} })
    const list = await sources.catalog({ authUserId: 'auth-1', companyId: COMPANY })
    const location = list.find((s) => s.key === 'inventory_location')
    assert.equal(location.installed, true); assert.equal(location.allowed, true)
    assert.equal(list.find((s) => s.key === 'contact').installed, false)
  })
})
