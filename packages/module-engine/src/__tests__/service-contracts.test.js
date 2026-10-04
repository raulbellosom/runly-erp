import test from 'node:test'
import assert from 'node:assert/strict'
import { SERVICE_CONTRACTS, SERVICE_KEYS, validateServiceArgs } from '../contracts.js'

const ID = '0190a7b2-1c3d-7e4f-8a9b-0c1d2e3f4a5b'

test('every contract declares label, permission, mutates, args and returns', () => {
  assert.deepEqual(SERVICE_KEYS, Object.keys(SERVICE_CONTRACTS))
  for (const [key, contract] of Object.entries(SERVICE_CONTRACTS)) {
    assert.match(key, /^runly\.[a-z]+:[a-z]+\.[a-zA-Z]+$/)
    assert.equal(typeof contract.label, 'string', key)
    assert.ok(contract.permission === null || typeof contract.permission === 'string', key)
    assert.equal(typeof contract.mutates, 'boolean', key)
    assert.equal(typeof contract.args, 'object', key)
    assert.ok(Array.isArray(contract.returns), key)
  }
})

test('validation drops unknown keys, coerces and reports errors per field', () => {
  const ok = validateServiceArgs('runly.calendar:events.create', { title: '  Revisión ', startAt: '2026-10-05T10:00:00-06:00', allDay: 'false', reminderMinutes: [15, 15, 60], companyId: ID, sourceModule: 'x' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.value, { title: 'Revisión', startAt: '2026-10-05T16:00:00.000Z', allDay: false, reminderMinutes: [15, 60] })

  const bad = validateServiceArgs('runly.calendar:events.create', { title: '', startAt: 'mañana', attendeeIds: ['nope'] })
  assert.equal(bad.ok, false)
  assert.deepEqual(Object.keys(bad.errors).sort(), ['attendeeIds', 'startAt', 'title'])

  assert.deepEqual(validateServiceArgs('runly.projects:tasks.update', { id: ID, assigneeId: null, priority: 'HIGH' }).value, { id: ID, assigneeId: null, priority: 'HIGH' })
  assert.equal(validateServiceArgs('runly.projects:tasks.update', { id: ID, priority: 'high' }).ok, false)
  assert.equal(validateServiceArgs('runly.nope:x.y', {}).errors._service, 'servicio desconocido')
})

test('base64 content is checked for format and decoded size', () => {
  const base = { name: 'a.txt', mimeType: 'text/plain' }
  assert.equal(validateServiceArgs('runly.files:files.save', { ...base, contentBase64: 'data:text/plain;base64,aG9sYQ==' }).value.contentBase64, 'aG9sYQ==')
  assert.equal(validateServiceArgs('runly.files:files.save', { ...base, contentBase64: 'no base64!' }).ok, false)
  const big = 'A'.repeat(Math.ceil((10 * 1024 * 1024 + 3) / 3) * 4)
  assert.match(validateServiceArgs('runly.files:files.save', { ...base, contentBase64: big }).errors.contentBase64, /MB/)
})

test('number args accept decimals and numeric strings within bounds', () => {
  const base = { fecha: '2026-10-04', nombre: 'Pago' }
  assert.deepEqual(validateServiceArgs('runly.ledger:transactions.create', { ...base, deposito: '120.5' }).value, { ...base, deposito: 120.5 })
  assert.equal(validateServiceArgs('runly.ledger:transactions.create', { ...base, retiro: -1 }).ok, false)
  assert.equal(validateServiceArgs('runly.pfm:movements.create', { direction: 'EXPENSE', amount: 0 }).ok, false)
})
