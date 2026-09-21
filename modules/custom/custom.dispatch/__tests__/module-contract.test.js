import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { generateCreateTableSql, validateManifest, validateModel, validateView } from '@runly/module-engine'
import manifest from '../module.manifest.js'
import siteModel from '../models/site.model.js'
import stationModel from '../models/station.model.js'
import assignmentModel from '../models/station-assignment.model.js'
import materialModel from '../models/material-profile.model.js'
import seriesModel from '../models/folio-series.model.js'
import ticketModel from '../models/ticket.model.js'
import ticketEventModel from '../models/ticket-event.model.js'
import weighingModel from '../models/weighing.model.js'
import exitAttemptModel from '../models/exit-attempt.model.js'
import operationView from '../views/operation.custom.js'
import kioskView from '../views/kiosk.custom.js'
import sitesView from '../views/sites.custom.js'
import stationsView from '../views/stations.custom.js'
import materialsView from '../views/materials.custom.js'
import assignmentsView from '../views/assignments.custom.js'
import seriesView from '../views/series.custom.js'
import ticketsView from '../views/tickets.custom.js'
import ticketDetailView from '../views/ticket-detail.custom.js'
import ticketNewVolumeView from '../views/ticket-new-volume.custom.js'
import ticketNewScaleView from '../views/ticket-new-scale.custom.js'
import weighingCaptureView from '../views/weighing-capture.custom.js'
import exitQueueView from '../views/exit-queue.custom.js'
import { parseCatalogPayload } from '../api/catalog-validators.js'
import { createVolumeTicketSchema, createScaleTicketSchema, updateTicketSchema, cancelTicketSchema } from '../api/ticket-validators.js'
import { captureTareSchema, correctWeighingSchema, weighingExceptionSchema } from '../api/weighing-validators.js'
import { scanGateSchema, rejectExitSchema, guardNotifiedSchema } from '../api/exit-validators.js'
import { buildVoucherPdfBuffer } from '../api/voucher-pdf.js'
import { dispatchCleanupHandler } from '../api/dispatch-cleanup.js'
import { createInitialForm } from '../components/lib/catalog-form-state.js'

const models = [
  siteModel, stationModel, assignmentModel, materialModel, seriesModel,
  ticketModel, weighingModel, exitAttemptModel, ticketEventModel,
]

const viewComponents = new Map([
  [operationView, 'custom.dispatch:OperationDashboard'],
  [sitesView, 'custom.dispatch:SitesPage'],
  [stationsView, 'custom.dispatch:StationsPage'],
  [materialsView, 'custom.dispatch:MaterialsPage'],
  [assignmentsView, 'custom.dispatch:AssignmentsPage'],
  [seriesView, 'custom.dispatch:SeriesPage'],
  [kioskView, 'custom.dispatch:DispatchKiosk'],
  [ticketsView, 'custom.dispatch:TicketsListPage'],
  [ticketDetailView, 'custom.dispatch:TicketDetailPage'],
  [ticketNewVolumeView, 'custom.dispatch:NewVolumeTicketPage'],
  [ticketNewScaleView, 'custom.dispatch:NewScaleTicketPage'],
  [weighingCaptureView, 'custom.dispatch:WeighingCapturePage'],
  [exitQueueView, 'custom.dispatch:ExitApprovalQueuePage'],
])
const views = [...viewComponents.keys()]

test('el manifiesto y las vistas CUSTOM cumplen el contrato RME3', () => {
  assert.deepEqual(validateManifest(manifest), { valid: true, errors: [] })
  for (const view of views) {
    assert.deepEqual(validateView(view), { valid: true, errors: [] })
  }
  for (const [view, component] of viewComponents) {
    assert.equal(view.schema.component, component)
  }
  assert.equal(manifest.version, '0.8.1')
  assert.equal(manifest.pwa.startPath, '/operacion')
  assert.equal(manifest.navigation.length, 10)
})

test('cada catálogo y cada vale tienen su propia página — ninguna vista comparte componente con otra', () => {
  const componentValues = [...viewComponents.values()]
  assert.equal(new Set(componentValues).size, componentValues.length)
})

test('la interfaz de producto no expone notas de roadmap o prototipo', async () => {
  const files = [
    '../components/pages/CatalogPage.jsx',
    '../components/pages/OperationDashboard.jsx',
    '../components/setup/SetupOverview.jsx',
    '../components/setup/CatalogEditorDialog.jsx',
    '../components/lib/catalog-config.js',
    '../components/kiosk/DispatchKiosk.jsx',
    '../components/tickets/NewVolumeTicketPage.jsx',
    '../components/tickets/NewScaleTicketPage.jsx',
    '../components/tickets/TicketsListPage.jsx',
    '../components/tickets/TicketDetailPage.jsx',
    '../components/weighing/WeighingCapturePage.jsx',
    '../components/exits/ExitApprovalQueuePage.jsx',
  ]
  const copy = (await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n')

  assert.doesNotMatch(
    copy,
    /alcance de esta versión|futura validación|conexión operativa pendiente|esta etapa|se incorporará|no inventa pedidos/i,
  )
})

test('los nueve modelos son válidos y generan tablas administradas por Runly ORM', () => {
  for (const model of models) {
    assert.deepEqual(validateModel(model), { valid: true, errors: [] })
    const sql = generateCreateTableSql(model)
    assert.match(sql, /DEFAULT uuidv7\(\)/)
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${model.tableName}"`))
  }
})

test('acepta un material medible por volumen y toneladas', () => {
  const parsed = parseCatalogPayload('materials', {
    site_id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec001',
    code: 'GRAVA-34',
    name: 'Grava 3/4',
    allowed_modes: ['M3', 'TONS'],
    density_kg_m3: 1650,
  })
  assert.equal(parsed.success, true)
})

test('rechaza materiales sin forma de medición', () => {
  const parsed = parseCatalogPayload('materials', {
    site_id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec001',
    code: 'GRIMM',
    name: 'GRIMM',
    allowed_modes: [],
  })
  assert.equal(parsed.success, false)
})

test('normaliza materiales antiguos sin allowed_modes antes de renderizar el editor', () => {
  const form = createInitialForm('materials', {
    id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec001',
    code: 'GRAVA',
    name: 'Grava',
  })

  assert.deepEqual(form.allowed_modes, ['M3'])
  assert.doesNotThrow(() => form.allowed_modes.includes('M3'))
})

test('una actualización exige al menos un cambio', () => {
  const parsed = parseCatalogPayload('sites', {}, { partial: true })
  assert.equal(parsed.success, false)
})

test('la serie protege secuencia y longitud del folio', () => {
  const parsed = parseCatalogPayload('series', {
    site_id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec001',
    voucher_type: 'SCALE',
    prefix: 'BAS',
    next_number: 0,
    padding: 13,
  })
  assert.equal(parsed.success, false)
})

test('acepta un vale por volumen con los campos mínimos', () => {
  const parsed = createVolumeTicketSchema.safeParse({
    site_id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec001',
    origin_station_id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec002',
    material_profile_id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec003',
    vehicle_plate: 'abc-123',
    sold_volume_m3: 12.5,
  })
  assert.equal(parsed.success, true)
  assert.equal(parsed.data.vehicle_plate, 'ABC-123')
})

test('rechaza un vale por volumen sin volumen vendido', () => {
  const parsed = createVolumeTicketSchema.safeParse({
    site_id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec001',
    origin_station_id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec002',
    material_profile_id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec003',
    vehicle_plate: 'ABC-123',
  })
  assert.equal(parsed.success, false)
})

test('rechaza un vale con báscula sin nombre de cliente', () => {
  const parsed = createScaleTicketSchema.safeParse({
    site_id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec001',
    origin_station_id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec002',
    material_profile_id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec003',
    vehicle_plate: 'ABC-123',
    customer_name: '',
  })
  assert.equal(parsed.success, false)
})

test('acepta una captura de pesaje con estación y peso positivo', () => {
  const parsed = captureTareSchema.safeParse({
    station_id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec004',
    weight_kg: 18500,
  })
  assert.equal(parsed.success, true)
  assert.equal(parsed.data.source, 'MANUAL')
})

test('rechaza una captura de pesaje con peso negativo', () => {
  const parsed = captureTareSchema.safeParse({
    station_id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec004',
    weight_kg: -5,
  })
  assert.equal(parsed.success, false)
})

test('una corrección de pesaje exige un motivo', () => {
  const parsed = correctWeighingSchema.safeParse({ weight_kg: 18500 })
  assert.equal(parsed.success, false)
})

test('una excepción de pesaje exige un motivo', () => {
  const parsed = weighingExceptionSchema.safeParse({ reason: '' })
  assert.equal(parsed.success, false)
})

test('acepta un escaneo de pluma con estación y valor de QR', () => {
  const parsed = scanGateSchema.safeParse({
    gate_station_id: '018f4b34-89f1-7a21-9c9a-36a1fd6ec005',
    qr_value: 'RUNLY-DISPATCH:1:abcdefghijklmnopqrstuvwx',
  })
  assert.equal(parsed.success, true)
})

test('un rechazo de salida exige un motivo', () => {
  const parsed = rejectExitSchema.safeParse({ rejection_reason: '' })
  assert.equal(parsed.success, false)
})

test('la notificación al guardia exige un medio de comunicación válido', () => {
  const parsed = guardNotifiedSchema.safeParse({ communication_method: 'CARRIER_PIGEON' })
  assert.equal(parsed.success, false)
})

test('una corrección de vale exige al menos un campo', () => {
  const parsed = updateTicketSchema.safeParse({})
  assert.equal(parsed.success, false)
})

test('una corrección de vale normaliza la placa', () => {
  const parsed = updateTicketSchema.safeParse({ vehicle_plate: 'abc-123' })
  assert.equal(parsed.success, true)
  assert.equal(parsed.data.vehicle_plate, 'ABC-123')
})

test('cancelar un vale exige un motivo', () => {
  const parsed = cancelTicketSchema.safeParse({ reason: '' })
  assert.equal(parsed.success, false)
})

test('dispatch_ticket_event sincroniza después de dispatch_exit_attempt, del que depende por llave foránea', () => {
  const modelOrder = manifest.models.map((path) => path.split('/').pop())
  const exitAttemptIndex = modelOrder.indexOf('exit-attempt.model.js')
  const ticketEventIndex = modelOrder.indexOf('ticket-event.model.js')
  assert.ok(exitAttemptIndex >= 0 && ticketEventIndex >= 0)
  assert.ok(exitAttemptIndex < ticketEventIndex)
})

test('genera un PDF de vale con 3 copias y un QR real', async () => {
  const branding = { companyName: 'Grava del Norte', rfc: 'GDN010101AAA', addressLines: ['Calle 1, Monterrey'], primaryColor: '#D97706' }
  const ticket = {
    folio: 'VV-000001',
    voucher_type: 'VOLUME',
    site_name: 'Mina Norte',
    material_name: 'Grava 3/4',
    vehicle_plate: 'ABC-123',
    driver_name: 'Juan Pérez',
    sold_to_type: 'WALK_IN',
    customer_name: null,
    external_voucher_reference: null,
    sold_volume_m3: 12.5,
    payment_method: 'CASH',
    weighing_exception: false,
  }
  const pdf = await buildVoucherPdfBuffer({ branding, ticket, weighings: [], qrValue: 'RUNLY-DISPATCH:1:abcdefghijklmnopqrstuvwx' })
  assert.ok(Buffer.isBuffer(pdf))
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-')
})

test('el cleanup handler tiene la forma que exige registerModuleHandler', () => {
  assert.equal(typeof dispatchCleanupHandler.count, 'function')
  assert.equal(typeof dispatchCleanupHandler.purge, 'function')
})

test('el purge del cleanup handler borra hijos antes que padres (orden seguro para FKs)', async () => {
  const deletedTables = []
  const fakeTx = {
    $executeRaw(strings) {
      const sql = strings.join('')
      const [, table] = sql.match(/DELETE FROM (\w+)/) ?? []
      deletedTables.push(table)
      return Promise.resolve(0)
    },
  }

  await dispatchCleanupHandler.purge({ tx: fakeTx, companyId: '018f4b34-89f1-7a21-9c9a-36a1fd6ec001' })

  assert.deepEqual(deletedTables, [
    'dispatch_ticket_event',
    'dispatch_exit_attempt',
    'dispatch_weighing',
    'dispatch_ticket',
    'dispatch_folio_series',
    'dispatch_station_assignment',
    'dispatch_material_profile',
    'dispatch_station',
    'dispatch_site',
  ])

  const parentIndex = (table) => deletedTables.indexOf(table)
  // Every table must be deleted before every table it has a foreign key to.
  assert.ok(parentIndex('dispatch_ticket_event') < parentIndex('dispatch_ticket'))
  assert.ok(parentIndex('dispatch_exit_attempt') < parentIndex('dispatch_ticket'))
  assert.ok(parentIndex('dispatch_weighing') < parentIndex('dispatch_ticket'))
  assert.ok(parentIndex('dispatch_ticket') < parentIndex('dispatch_site'))
  assert.ok(parentIndex('dispatch_ticket') < parentIndex('dispatch_station'))
  assert.ok(parentIndex('dispatch_ticket') < parentIndex('dispatch_material_profile'))
  assert.ok(parentIndex('dispatch_station_assignment') < parentIndex('dispatch_station'))
  assert.ok(parentIndex('dispatch_folio_series') < parentIndex('dispatch_site'))
  assert.ok(parentIndex('dispatch_material_profile') < parentIndex('dispatch_site'))
  assert.ok(parentIndex('dispatch_station') < parentIndex('dispatch_site'))
})

test('el count del cleanup handler exige companyId', async () => {
  await assert.rejects(() => dispatchCleanupHandler.count({ prisma: {}, companyId: null }))
})
