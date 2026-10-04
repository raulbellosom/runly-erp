import test from 'node:test'
import assert from 'node:assert/strict'
import { createServiceSimulator } from '../contracts.js'

const ALL = ['runly.calendar:events.create', 'runly.calendar:events.update', 'runly.contacts:contacts.create', 'runly.contacts:contacts.search', 'runly.ledger:transactions.create']

test('simulator applies the gateway rules of the ERP', async () => {
  const sim = createServiceSimulator({ moduleKey: 'custom.demo', grants: ALL, user: { id: 'u', permissions: ['contacts.contacts.create', 'calendar.events.create', 'calendar.events.update'] } })
  const api = sim.forRequest()
  await assert.rejects(api.call('runly.contacts:contacts.update', { id: 'x' }), (e) => e.code === 'service_not_granted')
  await assert.rejects(api.call('runly.contacts:contacts.search', {}), (e) => e.code === 'permission_denied')
  await assert.rejects(api.call('runly.calendar:events.create', { title: '' }), (e) => e.status === 422 && Boolean(e.fields.title && e.fields.startAt))
  await assert.rejects(sim.forSystem().call('runly.calendar:events.create', { title: 'X', startAt: '2026-10-05T10:00:00Z' }), (e) => e.code === 'system_not_supported')
  assert.equal(sim.calls.length, 4)
})

test('simulator keeps records, own scope and idempotency', async () => {
  const foreign = { id: '00000000-0000-7000-8000-0000000000f1', title: 'Ajeno', sourceModule: 'otro' }
  const sim = createServiceSimulator({ moduleKey: 'custom.demo', grants: ALL, user: { isAdmin: true }, fixtures: { 'runly.calendar:events': [foreign] } })
  const calendar = sim.forRequest().module('runly.calendar')
  const created = await calendar.events.create({ title: 'Visita', startAt: '2026-10-05T10:00:00Z', companyId: 'ignorado' })
  assert.equal(created.title, 'Visita')
  assert.equal((await calendar.events.update({ id: created.id, title: 'Movida' })).title, 'Movida')
  await assert.rejects(calendar.events.update({ id: foreign.id, title: 'X' }), (e) => e.status === 404)

  const contacts = sim.forRequest().module('runly.contacts')
  const a = await contacts.contacts.create({ name: 'Ana', idempotencyKey: 'k1' })
  const b = await contacts.contacts.create({ name: 'Ana', idempotencyKey: 'k1' })
  assert.equal(a.id, b.id)
  assert.equal(sim.store.get('runly.contacts:contacts').length, 1)

  await sim.forRequest().call('runly.ledger:transactions.create', { fecha: '2026-10-04', nombre: 'Pago', deposito: 10 })
  assert.match(sim.diagnostics[0], /no se simulan/)
})
