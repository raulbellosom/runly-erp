import test from 'node:test'
import assert from 'node:assert/strict'
import { consumedServiceKeys, createModuleServices } from '../module-services.js'

function ctx({ companyId = 'c1', isAdmin = false, permissions = [] } = {}) {
  const values = { companyId, userId: 'u1', userContext: { isAdmin, permissionSet: new Set(permissions), profile: { id: 'u1' } } }
  return { get: (key) => values[key] }
}

function prismaWithGrants(grants) {
  const calls = []
  return {
    calls,
    moduleServiceGrant: { findMany: async ({ where }) => { calls.push(where); return grants.map((serviceKey) => ({ serviceKey })) } },
    auditLog: { create: async () => ({}) },
  }
}

test('consumes manifest maps to service keys', () => {
  assert.deepEqual(consumedServiceKeys({ consumes: { 'runly.inventory': ['items.read'], 'runly.contacts': ['contacts.create'] } }), ['runly.inventory:items.read', 'runly.contacts:contacts.create'])
  assert.deepEqual(consumedServiceKeys({}), [])
})

test('a call needs the grant, the user permission and an active company', async () => {
  const prisma = prismaWithGrants([])
  const services = createModuleServices({ prisma })
  const api = services.forRequest(ctx({ permissions: ['contacts.contacts.create'] }), 'custom.crm')
  await assert.rejects(api.call('runly.contacts:contacts.create', { name: 'Ana' }), (error) => error.status === 403 && error.code === 'service_not_granted')
  assert.deepEqual(prisma.calls[0], { moduleKey: 'custom.crm', OR: [{ companyId: null }, { companyId: 'c1' }] })

  const granted = createModuleServices({ prisma: prismaWithGrants(['runly.contacts:contacts.create']) })
  await assert.rejects(granted.forRequest(ctx(), 'custom.crm').call('runly.contacts:contacts.create', { name: 'Ana' }), (error) => error.code === 'permission_denied')
  // Grant + permission: reaches the handler, which validates its input.
  await assert.rejects(granted.forRequest(ctx({ permissions: ['contacts.contacts.create'] }), 'custom.crm').call('runly.contacts:contacts.create', { name: 'A' }), /obligatorio/)
  await assert.rejects(granted.forRequest(ctx({ companyId: null, isAdmin: true }), 'custom.crm').call('runly.contacts:contacts.create', { name: 'Ana' }), (error) => error.code === 'company_required')
  await assert.rejects(granted.forRequest(ctx({ isAdmin: true }), 'custom.crm').call('runly.nope:x.y'), (error) => error.code === 'unknown_service')
})

test('module() exposes the services of one module as methods', () => {
  const api = createModuleServices({ prisma: prismaWithGrants([]) }).forRequest(ctx(), 'custom.crm')
  const inventory = api.module('runly.inventory')
  assert.equal(typeof inventory.items.read, 'function')
  assert.equal(typeof inventory.items.search, 'function')
  assert.equal(typeof api.module('runly.projects').tasks.create, 'function')
})
