import test from 'node:test'
import assert from 'node:assert/strict'
import { SERVICE_CONTRACTS } from '@runly/module-engine/contracts'
import { consumedServiceKeys, createModuleServices } from '../module-services.js'
import { createActionBackedServices } from '../action-backed-services.js'

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

const ID = '0190a7b2-1c3d-7e4f-8a9b-0c1d2e3f4a5b'

test('arguments are validated against the shared contract (422)', async () => {
  const services = createModuleServices({ prisma: prismaWithGrants(['runly.calendar:events.create']) })
  await assert.rejects(
    services.forRequest(ctx({ isAdmin: true }), 'custom.crm').call('runly.calendar:events.create', { title: '', startAt: 'x' }),
    (error) => error.status === 422 && error.code === 'invalid_args' && Boolean(error.fields.title && error.fields.startAt),
  )
})

test('sourceEntityId rejects non-UUID input before reaching calendar, files or notifications handlers', async () => {
  const inputs = {
    'runly.calendar:events.create': { title: 'Visita', startAt: '2026-10-05T10:00:00Z' },
    'runly.calendar:events.list': { from: '2026-10-05T10:00:00Z', to: '2026-10-06T10:00:00Z' },
    'runly.files:files.save': { name: 'demo.txt', mimeType: 'text/plain', contentBase64: 'YQ==' },
    'runly.notifications:notifications.send': { title: 'Aviso', userIds: [ID] },
  }
  const api = createModuleServices({ prisma: prismaWithGrants(Object.keys(inputs)) }).forRequest(ctx({ isAdmin: true }), 'custom.crm')
  for (const [key, args] of Object.entries(inputs)) {
    await assert.rejects(api.call(key, { ...args, sourceEntityId: 'custom.crm:record' }),
      (error) => error.status === 422 && Boolean(error.fields.sourceEntityId), key)
  }
})

test('scope own: a module cannot touch calendar events it did not create', async () => {
  const prisma = prismaWithGrants(['runly.calendar:events.cancel'])
  const seen = []
  prisma.calendarEvent = { findFirst: async ({ where }) => { seen.push(where); return null } }
  const api = createModuleServices({ prisma }).forRequest(ctx({ permissions: ['calendar.events.update'] }), 'custom.crm')
  await assert.rejects(api.call('runly.calendar:events.cancel', { id: ID }), (error) => error.status === 404)
  assert.deepEqual(seen[0], { id: ID, sourceModule: 'custom.crm', enabled: true })
})

test('tasks.update checks the task belongs to the active company', async () => {
  const prisma = prismaWithGrants(['runly.projects:tasks.update'])
  const seen = []
  prisma.task = { findFirst: async ({ where }) => { seen.push(where); return null } }
  const api = createModuleServices({ prisma }).forRequest(ctx({ permissions: ['projects.task.update'] }), 'custom.crm')
  await assert.rejects(api.call('runly.projects:tasks.update', { id: ID, title: 'X' }), (error) => error.status === 404)
  assert.deepEqual(seen[0], { id: ID, project: { companyId: 'c1' } })
})

test('notifications.send needs no permission, only the grant', async () => {
  const api = createModuleServices({ prisma: prismaWithGrants([]) }).forRequest(ctx(), 'custom.crm')
  await assert.rejects(api.call('runly.notifications:notifications.send', { userIds: [ID], title: 'Hola' }), (error) => error.code === 'service_not_granted')
})

test('forSystem: only system services, grant required, no user permission', async () => {
  const services = createModuleServices({ prisma: prismaWithGrants(['runly.contacts:contacts.create', 'runly.calendar:events.create']) })
  const system = services.forSystem('custom.crm', 'c1')
  await assert.rejects(system.call('runly.calendar:events.create', { title: 'X', startAt: '2026-10-05T10:00:00Z' }), (error) => error.code === 'system_not_supported')
  // No user: reaches the handler (which validates the name) without a permission check.
  await assert.rejects(system.call('runly.contacts:contacts.create', { name: 'A' }), /obligatorio/)
  await assert.rejects(services.forSystem('custom.crm', 'c1').call('runly.inventory:items.update', { id: ID }), (error) => error.code === 'service_not_granted')
})

test('idempotencyKey returns the audited result instead of writing again', async () => {
  const prisma = prismaWithGrants(['runly.contacts:contacts.create'])
  const seen = []
  prisma.auditLog.findFirst = async ({ where }) => { seen.push(where); return { after: { id: ID, name: 'Ana' } } }
  const api = createModuleServices({ prisma }).forRequest(ctx({ permissions: ['contacts.contacts.create'] }), 'custom.crm')
  assert.deepEqual(await api.call('runly.contacts:contacts.create', { name: 'Ana', idempotencyKey: 'evt-1' }), { id: ID, name: 'Ana' })
  assert.deepEqual(seen[0].metadata, { path: ['idempotencyKey'], equals: 'evt-1' })
  assert.equal(seen[0].companyId, 'c1')
})

test('action-backed contracts use the permission of the action they run', () => {
  const { actions } = createActionBackedServices({ prisma: {}, ServiceError: Error })
  for (const [key, contract] of Object.entries(SERVICE_CONTRACTS)) {
    if (!contract.action) continue
    assert.equal(actions.get(contract.action)?.permission, contract.permission, key)
  }
})

test('module() exposes the services of one module as methods', () => {
  const api = createModuleServices({ prisma: prismaWithGrants([]) }).forRequest(ctx(), 'custom.crm')
  const inventory = api.module('runly.inventory')
  assert.equal(typeof inventory.items.read, 'function')
  assert.equal(typeof inventory.items.search, 'function')
  assert.equal(typeof api.module('runly.projects').tasks.create, 'function')
})
