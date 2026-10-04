// Declarative contract of the services system modules offer to RME3 modules
// (spec docs/superpowers/specs/2026-10-04-module-services-v2-design.md).
// Data only and browser-safe: the ERP gateway validates every call with it and
// the Developer Hub simulates the same services from it. Handlers stay in the
// ERP API (apps/api/src/services/module-services/service-catalog.js).
//
// args: { name: { type, required?, max?, min?, values? } }. Unknown keys are
// dropped; null clears an optional field (update services). permission null
// means any member of the active company. scope 'own': only records the
// calling module created (others answer 404). system true: also callable from
// api/events.js handlers (services.forSystem), where there is no user.
// Every mutating service also accepts IDEMPOTENCY_ARG (handled by the gateway).

const s = (max = 200, extra = {}) => ({ type: 'string', max, ...extra })
const req = (spec) => ({ ...spec, required: true })
const ID = req({ type: 'uuid' })
const LIMIT = { type: 'integer', min: 1, max: 50 }
const SEARCH = s(120)
const SOURCE = s(200)
const CONTACT_TYPES = ['customer', 'supplier', 'person', 'company']
const TASK_PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']

const NUM = (extra = {}) => ({ type: 'number', min: 0, ...extra })
const DAY = { type: 'date' }
const ACTION_RESULT = ['id', 'summary', 'link']
const VEHICLE_STATUSES = ['active', 'maintenance', 'inactive', 'retired']
const COVERAGE_TYPES = ['basic', 'comprehensive', 'third_party', 'other']
const DIRECTIONS = ['EXPENSE', 'INCOME']

export const IDEMPOTENCY_ARG = Object.freeze({ idempotencyKey: { type: 'string', max: 200 } })

const ITEM = ['id', 'name', 'assetTag', 'status', 'enabled']
const CONTACT = ['id', 'name', 'type', 'email', 'phone']
const TASK = ['id', 'projectId', 'title', 'taskNumber', 'statusId', 'dueDate', 'completedAt']
const EVENT = ['id', 'calendarId', 'title', 'description', 'startAt', 'endAt', 'allDay', 'location', 'sourceEntityId']
const FILE = ['id', 'name', 'mimeType', 'sizeBytes', 'sourceEntityId']

const EVENT_FIELDS = {
  title: s(200), description: { type: 'text', max: 5000 }, startAt: { type: 'datetime' }, endAt: { type: 'datetime' },
  allDay: { type: 'boolean' }, location: s(300),
}

export const SERVICE_CONTRACTS = Object.freeze({
  'runly.inventory:items.read': { label: 'Leer artículos de inventario', permission: 'inventory.item.read', mutates: false, system: true, args: { id: ID }, returns: ITEM },
  'runly.inventory:items.search': { label: 'Buscar artículos de inventario', permission: 'inventory.item.read', mutates: false, system: true, args: { search: SEARCH, limit: LIMIT }, returns: ['items', 'total'] },
  'runly.inventory:items.update': {
    label: 'Actualizar artículos de inventario', permission: 'inventory.item.update', mutates: true, system: true,
    args: { id: ID, name: s(200), description: { type: 'text', max: 5000 }, status: { type: 'enum', values: ['available', 'maintenance'] }, locationId: { type: 'uuid' }, notes: { type: 'text', max: 5000 } },
    returns: ITEM,
  },
  'runly.contacts:contacts.read': { label: 'Leer contactos', permission: 'contacts.contacts.read', mutates: false, system: true, args: { id: ID }, returns: CONTACT },
  'runly.contacts:contacts.search': { label: 'Buscar contactos', permission: 'contacts.contacts.read', mutates: false, system: true, args: { search: SEARCH, limit: LIMIT }, returns: ['items', 'total'] },
  'runly.contacts:contacts.create': {
    label: 'Crear contactos', permission: 'contacts.contacts.create', mutates: true, system: true,
    args: { name: req(s(200)), type: { type: 'enum', values: CONTACT_TYPES }, email: { type: 'email' }, phone: s(40) },
    returns: CONTACT,
  },
  'runly.contacts:contacts.update': {
    label: 'Actualizar contactos', permission: 'contacts.contacts.update', mutates: true, system: true,
    args: { id: ID, name: s(200), type: { type: 'enum', values: CONTACT_TYPES }, email: { type: 'email' }, phone: s(40) },
    returns: CONTACT,
  },
  'runly.projects:tasks.read': { label: 'Leer tareas de proyectos', permission: 'projects.task.read', mutates: false, args: { id: ID }, returns: TASK },
  'runly.projects:tasks.create': {
    label: 'Crear tareas en proyectos', permission: 'projects.task.create', mutates: true,
    args: { projectId: ID, title: req(s(300)), description: { type: 'text', max: 10000 }, dueDate: { type: 'date' }, assigneeId: { type: 'uuid' } },
    returns: TASK,
  },
  'runly.projects:tasks.update': {
    label: 'Actualizar tareas de proyectos', permission: 'projects.task.update', mutates: true, system: true,
    args: { id: ID, title: s(300), description: { type: 'text', max: 10000 }, statusId: { type: 'uuid' }, assigneeId: { type: 'uuid' }, dueDate: { type: 'date' }, priority: { type: 'enum', values: TASK_PRIORITIES } },
    returns: TASK,
  },
  'runly.calendar:calendars.list': { label: 'Ver calendarios donde puedo crear eventos', permission: 'calendar.events.read', mutates: false, args: {}, returns: ['id', 'name', 'isDefault'] },
  'runly.calendar:events.list': {
    label: 'Leer eventos creados por este módulo', permission: 'calendar.events.read', mutates: false, scope: 'own',
    args: { from: req({ type: 'datetime' }), to: req({ type: 'datetime' }), sourceEntityId: SOURCE },
    returns: EVENT,
  },
  'runly.calendar:events.create': {
    label: 'Crear eventos de calendario', permission: 'calendar.events.create', mutates: true,
    args: { calendarId: { type: 'uuid' }, ...EVENT_FIELDS, title: req(s(200)), startAt: req({ type: 'datetime' }), attendeeIds: { type: 'uuid[]', max: 50 }, reminderMinutes: { type: 'integer[]', max: 5, min: 0 }, sourceEntityId: SOURCE },
    returns: EVENT,
  },
  'runly.calendar:events.update': {
    label: 'Actualizar eventos creados por este módulo', permission: 'calendar.events.update', mutates: true, scope: 'own',
    args: { id: ID, ...EVENT_FIELDS },
    returns: EVENT,
  },
  'runly.calendar:events.cancel': {
    label: 'Cancelar eventos creados por este módulo', permission: 'calendar.events.update', mutates: true, scope: 'own',
    args: { id: ID }, returns: ['id', 'cancelled'],
  },
  'runly.files:files.save': {
    label: 'Guardar archivos en Archivos', permission: 'files.assets.create', mutates: true,
    args: { name: req(s(200)), mimeType: req(s(120)), contentBase64: req({ type: 'base64', max: 10 * 1024 * 1024 }), shareWithCompany: { type: 'boolean' }, sourceEntityId: SOURCE },
    returns: FILE,
  },
  'runly.files:files.signedUrl': {
    label: 'Descargar archivos guardados por este módulo', permission: 'files.assets.read', mutates: false, scope: 'own',
    args: { id: ID }, returns: ['id', 'url', 'expiresIn'],
  },
  'runly.notifications:notifications.send': {
    label: 'Enviar notificaciones', permission: null, mutates: true, system: true,
    args: { userIds: req({ type: 'uuid[]', max: 100 }), title: req(s(200)), body: { type: 'text', max: 1000 }, link: s(500), priority: { type: 'enum', values: ['low', 'medium', 'high', 'critical'] }, sourceEntityId: SOURCE },
    returns: ['sent'],
  },
  // Ledger, fleet and pfm writes run the module's own MirAI action
  // (prepare + execute), so per-account/per-wallet access checks and effects
  // stay the module's. `action` names it; arg names follow the action.
  'runly.ledger:accounts.list': { label: 'Ver cuentas del libro de cuentas', permission: 'ledger.accounts.read', mutates: false, args: {}, returns: ['id', 'name', 'bank', 'currency', 'balance'] },
  'runly.ledger:categories.list': { label: 'Ver categorías del libro de cuentas', permission: 'ledger.categories.read', mutates: false, args: {}, returns: ['id', 'name', 'kind', 'system'] },
  'runly.ledger:transactions.create': {
    label: 'Registrar movimientos en el libro de cuentas', permission: 'ledger.transactions.create', mutates: true, action: 'ledger.transaction.create',
    args: { accountId: { type: 'uuid' }, accountName: s(200), fecha: req(DAY), nombre: req(s(255)), referencia: s(255), concepto: s(512), numero: s(64), deposito: NUM(), retiro: NUM(), categoryId: { type: 'uuid' } },
    returns: ACTION_RESULT,
  },
  'runly.ledger:transactions.update': {
    label: 'Editar movimientos del libro de cuentas', permission: 'ledger.transactions.update', mutates: true, action: 'ledger.transaction.update',
    args: { transactionId: ID, fecha: DAY, nombre: s(255), referencia: s(255), concepto: s(512), numero: s(64), deposito: NUM(), retiro: NUM(), categoryId: { type: 'uuid' } },
    returns: ACTION_RESULT,
  },
  'runly.fleet:vehicles.search': {
    label: 'Buscar vehículos de la flota', permission: 'fleet.vehicles.read', mutates: false, system: true,
    args: { search: SEARCH, status: { type: 'enum', values: VEHICLE_STATUSES }, limit: LIMIT },
    returns: ['items', 'total'],
  },
  'runly.fleet:drivers.search': {
    label: 'Buscar choferes de la flota', permission: 'fleet.drivers.read', mutates: false,
    args: { search: SEARCH, status: { type: 'enum', values: ['active', 'inactive', 'suspended'] }, limit: LIMIT },
    returns: ['items', 'total'],
  },
  'runly.fleet:vehicles.create': {
    label: 'Crear vehículos en la flota', permission: 'fleet.vehicles.create', mutates: true, action: 'fleet.vehicle.create',
    args: { plate: req(s(20)), brand: s(100), model: s(100), year: { type: 'integer', min: 1900, max: 2100 }, color: s(100), status: { type: 'enum', values: VEHICLE_STATUSES }, driver: s(200), notes: { type: 'text', max: 5000 } },
    returns: ACTION_RESULT,
  },
  'runly.fleet:vehicles.update': {
    label: 'Editar vehículos de la flota', permission: 'fleet.vehicles.update', mutates: true, action: 'fleet.vehicle.update',
    args: { vehicleId: { type: 'uuid' }, plate: s(20), status: { type: 'enum', values: VEHICLE_STATUSES }, driver: s(200), color: s(100), notes: { type: 'text', max: 5000 } },
    returns: ACTION_RESULT,
  },
  'runly.fleet:insurance.create': {
    label: 'Registrar pólizas de seguro de vehículos', permission: 'fleet.insurance.create', mutates: true, action: 'fleet.insurance.create',
    args: { vehicleId: { type: 'uuid' }, plate: s(20), insurer: req(s(100)), policyNumber: req(s(50)), coverageType: { type: 'enum', values: COVERAGE_TYPES }, startDate: req(DAY), expiryDate: req(DAY), premium: NUM(), currency: s(3), notes: { type: 'text', max: 3000 } },
    returns: ACTION_RESULT,
  },
  'runly.fleet:insurance.update': {
    label: 'Editar pólizas de seguro de vehículos', permission: 'fleet.insurance.update', mutates: true, action: 'fleet.insurance.update',
    args: { policyId: ID, expiryDate: DAY, premium: NUM(), coverageType: { type: 'enum', values: COVERAGE_TYPES }, notes: { type: 'text', max: 3000 } },
    returns: ACTION_RESULT,
  },
  'runly.pfm:wallets.list': { label: 'Ver carteras de finanzas personales', permission: 'pfm.wallets.read', mutates: false, args: {}, returns: ['id', 'name', 'kind', 'currency', 'balance', 'bankLinked'] },
  'runly.pfm:categories.list': { label: 'Ver categorías de finanzas personales', permission: 'pfm.categories.read', mutates: false, args: { kind: { type: 'enum', values: DIRECTIONS } }, returns: ['id', 'name', 'kind'] },
  'runly.pfm:movements.create': {
    label: 'Registrar movimientos de finanzas personales', permission: 'pfm.movements.create', mutates: true, action: 'pfm.movement.create',
    args: { wallet: s(120), direction: req({ type: 'enum', values: DIRECTIONS }), amount: req(NUM({ min: 0.01 })), occurredOn: DAY, category: s(80), merchant: s(160), note: s(500) },
    returns: ACTION_RESULT,
  },
  'runly.pfm:movements.update': {
    label: 'Editar movimientos de finanzas personales', permission: 'pfm.movements.update', mutates: true, action: 'pfm.movement.update',
    args: { movementId: ID, direction: { type: 'enum', values: DIRECTIONS }, amount: NUM({ min: 0.01 }), occurredOn: DAY, category: s(80), merchant: s(160), note: s(500) },
    returns: ACTION_RESULT,
  },
})

export const SERVICE_KEYS = Object.freeze(Object.keys(SERVICE_CONTRACTS))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

function coerce(spec, raw) {
  switch (spec.type) {
    case 'uuid': return UUID.test(String(raw)) ? [String(raw)] : [null, 'no es un id válido']
    case 'string':
    case 'text': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return [null, 'debe ser texto']
      const value = String(raw).trim()
      const max = spec.max ?? (spec.type === 'text' ? 5000 : 500)
      if (value.length > max) return [null, `máximo ${max} caracteres`]
      return [value === '' ? null : value]
    }
    case 'email': {
      const value = String(raw).trim()
      if (value === '') return [null]
      return EMAIL.test(value) && value.length <= 254 ? [value] : [null, 'correo no válido']
    }
    case 'datetime': {
      const date = new Date(raw)
      return typeof raw !== 'boolean' && raw !== '' && !Number.isNaN(date.getTime()) ? [date.toISOString()] : [null, 'fecha y hora no válidas']
    }
    // Calendar date only (YYYY-MM-DD): no timezone guessing.
    case 'date': {
      const value = String(raw)
      return DATE.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()) ? [value] : [null, 'usa el formato AAAA-MM-DD']
    }
    case 'boolean':
      if (raw === true || raw === 'true') return [true]
      if (raw === false || raw === 'false') return [false]
      return [null, 'debe ser verdadero o falso']
    case 'number': {
      const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
      if (typeof value !== 'number' || !Number.isFinite(value)) return [null, 'debe ser un número']
      if (spec.min !== undefined && value < spec.min) return [null, `mínimo ${spec.min}`]
      if (spec.max !== undefined && value > spec.max) return [null, `máximo ${spec.max}`]
      return [value]
    }
    case 'integer': {
      const value = Number(raw)
      if (!Number.isInteger(value)) return [null, 'debe ser un número entero']
      if (spec.min !== undefined && value < spec.min) return [null, `mínimo ${spec.min}`]
      if (spec.max !== undefined && value > spec.max) return [null, `máximo ${spec.max}`]
      return [value]
    }
    case 'enum': return spec.values.includes(raw) ? [raw] : [null, `usa uno de: ${spec.values.join(', ')}`]
    case 'uuid[]':
    case 'integer[]': {
      if (!Array.isArray(raw)) return [null, 'debe ser una lista']
      const max = spec.max ?? 50
      if (raw.length > max) return [null, `máximo ${max} elementos`]
      const item = spec.type === 'uuid[]' ? { type: 'uuid' } : { type: 'integer', min: spec.min }
      const values = []
      for (const entry of raw) {
        const [value, error] = coerce(item, entry)
        if (error) return [null, `elemento: ${error}`]
        values.push(value)
      }
      return [[...new Set(values)]]
    }
    case 'base64': {
      const value = String(raw).replace(/^data:[^;,]*;base64,/, '').replace(/\s+/g, '')
      if (!value || value.length % 4 !== 0 || !BASE64.test(value)) return [null, 'contenido base64 no válido']
      const bytes = (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0)
      if (spec.max !== undefined && bytes > spec.max) return [null, `máximo ${Math.round(spec.max / 1024 / 1024)} MB`]
      return [value]
    }
    default: return [null, 'tipo no soportado']
  }
}

// -> { ok, value, errors }. `value` holds only declared args, coerced.
export function validateServiceArgs(serviceKey, args) {
  const contract = SERVICE_CONTRACTS[serviceKey]
  if (!contract) return { ok: false, value: {}, errors: { _service: 'servicio desconocido' } }
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  const value = {}
  const errors = {}
  for (const [name, spec] of Object.entries(contract.args)) {
    const raw = input[name]
    if (raw === undefined || raw === null) {
      if (spec.required) errors[name] = 'es obligatorio'
      else if (raw === null) value[name] = null
      continue
    }
    const [coerced, error] = coerce(spec, raw)
    if (error) errors[name] = error
    else if (coerced === null && spec.required) errors[name] = 'es obligatorio'
    else value[name] = coerced
  }
  return { ok: Object.keys(errors).length === 0, value, errors }
}
