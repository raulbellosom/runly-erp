import { BLUEPRINT_KINDS, FIELD_TYPES, MODULE_KINDS } from './constants.js'

export const RME3_CONTRACT_VERSION = 1
export const RME3_ENGINE_VERSION = '0.1.0'
// Shared metadata only. Handlers remain inside the ERP API.
export { SERVICE_CONTRACTS, SERVICE_KEYS, IDEMPOTENCY_ARG, validateServiceArgs } from './service-contracts.js'
export const DOMAIN_EVENTS = Object.freeze({
  'inventory.item.created': 'Se creó un artículo de inventario',
  'inventory.item.updated': 'Se actualizó un artículo de inventario',
  'contacts.contact.created': 'Se creó un contacto',
  'projects.task.created': 'Se creó una tarea de proyecto',
  'calendar.event.created': 'Se creó un evento de calendario',
  'calendar.event.updated': 'Se actualizó un evento de calendario',
  'calendar.event.cancelled': 'Se canceló un evento de calendario',
  'files.file.created': 'Se subió un archivo a Archivos',
  'fleet.vehicle.created': 'Se creó un vehículo de la flota',
  'fleet.vehicle.updated': 'Se actualizó un vehículo de la flota',
})

export const RME3_ENGINE_CONTRACT = Object.freeze({
  schemaVersion: RME3_CONTRACT_VERSION,
  engineVersion: RME3_ENGINE_VERSION,
  declarationFormat: 'rme3-js-literals-v1',
  fieldTypes: Object.freeze(Object.values(FIELD_TYPES)),
  blueprintKinds: Object.freeze(Object.values(BLUEPRINT_KINDS)),
  moduleKinds: Object.freeze(Object.values(MODULE_KINDS)),
  legacyAlias: '@atlas/module-engine',
})
