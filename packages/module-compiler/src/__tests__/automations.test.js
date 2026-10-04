import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as acorn from 'acorn'
import { compileModule, validateModuleDefinition } from '../index.js'

const BASE = {
  schemaVersion: 1,
  key: 'custom.servicio',
  name: 'Servicio',
  version: '1.0.0',
  icon: 'Wrench',
  color: '#2563EB',
  pwa: { shortName: 'Servicio', startPath: '/ordens' },
  entities: [
    { key: 'orden', label: 'Orden', pluralLabel: 'Órdenes', fields: [
      { key: 'folio', type: 'text', label: 'Folio', required: true },
      { key: 'fecha', type: 'datetime', label: 'Fecha' },
      { key: 'estado', type: 'select', label: 'Estado', options: [{ value: 'abierta', label: 'Abierta' }, { value: 'cerrada', label: 'Cerrada' }] },
    ] },
  ],
  automations: [
    {
      key: 'agendar_visita', label: 'Agendar visita', enabled: true,
      trigger: { type: 'record', entity: 'orden', on: 'create' },
      action: { service: 'runly.calendar:events.create', args: {
        title: { from: 'template', template: 'Visita {{folio}}' },
        startAt: { from: 'field', field: 'fecha' },
        reminderMinutes: { from: 'value', value: [30] },
      } },
    },
    {
      key: 'avisar_cierre', label: 'Avisar cierre', enabled: true,
      trigger: { type: 'record', entity: 'orden', on: 'update', when: { field: 'estado', op: 'changed' } },
      action: { service: 'runly.notifications:notifications.send', args: {
        userIds: { from: 'actor' }, title: { from: 'template', template: 'Orden {{folio}}: {{estado}}' },
      } },
    },
    {
      key: 'taller', label: 'Contacto de taller', enabled: true,
      trigger: { type: 'event', event: 'fleet.vehicle.updated', when: { field: 'status', op: 'equals', value: 'maintenance' } },
      action: { service: 'runly.contacts:contacts.create', args: { name: { from: 'template', template: 'Taller {{plate}}' }, type: { from: 'value', value: 'company' } } },
    },
  ],
}

const codes = (definition) => validateModuleDefinition(definition).errors.map((error) => error.code)
const fileOf = (compiled, file) => compiled.files.find((f) => f.path === file)?.content

test('valid automations compile into manifest, runtime, events and route hooks', () => {
  assert.deepEqual(codes(structuredClone(BASE)), [])
  const compiled = compileModule(structuredClone(BASE))
  const manifest = fileOf(compiled, 'module.manifest.js')
  assert.match(manifest, /consumes: \{"runly.calendar":\["events.create"\],"runly.notifications":\["notifications.send"\],"runly.contacts":\["contacts.create"\]\}/)
  assert.match(manifest, /events: \{ subscribes: \["fleet.vehicle.updated"\] \}/)
  assert.ok(fileOf(compiled, 'api/automations.js'))
  assert.match(fileOf(compiled, 'api/events.js'), /createEventHandlers/)
  const routes = fileOf(compiled, 'api/orden-routes.js')
  assert.match(routes, /on: 'create', record: created/)
  assert.match(routes, /const previous = await service.getOrdenById/)
  for (const file of ['api/orden-routes.js', 'api/automations.js', 'api/events.js', 'module.manifest.js']) {
    assert.doesNotThrow(() => acorn.parse(fileOf(compiled, file), { ecmaVersion: 'latest', sourceType: 'module' }), file)
  }
})

test('validation rejects unsafe or impossible automations', () => {
  const broken = structuredClone(BASE)
  broken.automations[0].action.args = { title: { from: 'value', value: 'X' } } // startAt missing
  broken.automations[1].trigger.on = 'create' // "changed" on create
  broken.automations[2].action = { service: 'runly.calendar:events.create', args: { title: { from: 'actor' }, startAt: { from: 'field', field: 'nope' } } }
  const found = codes(broken)
  for (const code of ['AUTOMATION_ARG_REQUIRED', 'AUTOMATION_CONDITION_INVALID', 'AUTOMATION_SERVICE_NEEDS_USER', 'AUTOMATION_FIELD_NOT_FOUND', 'AUTOMATION_ARG_INVALID']) {
    assert.ok(found.includes(code), `${code} in ${found}`)
  }
  const readOnly = structuredClone(BASE)
  readOnly.automations = [{ ...BASE.automations[0], action: { service: 'runly.contacts:contacts.search', args: {} } }]
  assert.ok(codes(readOnly).includes('AUTOMATION_SERVICE_READONLY'))
})

test('generated runtime maps args, conditions and idempotency', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'runly-automations-'))
  const file = path.join(dir, 'automations.mjs')
  writeFileSync(file, fileOf(compileModule(structuredClone(BASE)), 'api/automations.js'))
  const runtime = await import(pathToFileURL(file).href)

  const calls = []
  const services = { call: async (service, args) => { calls.push({ service, args }); if (service.startsWith('runly.notifications')) throw Object.assign(new Error('sin permiso'), { code: 'permission_denied' }) } }
  const c = { get: (key) => (key === 'userId' ? 'user-1' : null) }
  const moduleContext = { services: { forRequest: () => services } }
  const record = { id: 'rec-1', folio: 'OS-7', fecha: '2026-10-06T16:00:00.000Z', estado: 'abierta' }

  assert.deepEqual(await runtime.runRecordAutomations({ c, moduleContext, entity: 'orden', on: 'create', record }), [{ key: 'agendar_visita', ok: true }])
  assert.deepEqual(calls[0], { service: 'runly.calendar:events.create', args: { title: 'Visita OS-7', startAt: record.fecha, reminderMinutes: [30], sourceEntityId: 'rec-1', idempotencyKey: 'agendar_visita:rec-1:create' } })

  // Update without a change in "estado": nothing runs; with a change: actor wrapped in an array, failure reported.
  assert.deepEqual(await runtime.runRecordAutomations({ c, moduleContext, entity: 'orden', on: 'update', record, previous: { ...record } }), [])
  const results = await runtime.runRecordAutomations({ c, moduleContext, entity: 'orden', on: 'update', record: { ...record, estado: 'cerrada' }, previous: record })
  assert.equal(results[0].ok, false)
  assert.equal(results[0].code, 'permission_denied')
  assert.deepEqual(calls.at(-1).args, { userIds: ['user-1'], title: 'Orden OS-7: cerrada', sourceEntityId: 'rec-1' })

  const handlers = runtime.createEventHandlers()
  await handlers['fleet.vehicle.updated']({ payload: { id: 'v1', plate: 'ABC', status: 'active' }, eventId: 'e1', services })
  assert.equal(calls.length, 2) // condition not met
  await handlers['fleet.vehicle.updated']({ payload: { id: 'v1', plate: 'ABC', status: 'maintenance' }, eventId: 'e2', services })
  assert.deepEqual(calls.at(-1), { service: 'runly.contacts:contacts.create', args: { name: 'Taller ABC', type: 'company', idempotencyKey: 'taller:e2' } })
})
