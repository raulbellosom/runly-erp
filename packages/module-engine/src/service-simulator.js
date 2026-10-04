// In-memory simulator of the module services (spec
// docs/superpowers/specs/2026-10-04-module-services-v2-design.md §7). Browser-
// safe, data only: the Developer Hub Playground runs RME3 modules against it
// with fictitious data. It applies the same gateway rules as the ERP (unknown
// service, company, system flag, grant, user permission, contract validation,
// idempotencyKey, `own` scope) and keeps records per collection; the owning
// modules' business rules are NOT simulated and are reported in
// `diagnostics` instead of pretending they passed.
import { SERVICE_CONTRACTS, validateServiceArgs } from './service-contracts.js'

export class SimulatedServiceError extends Error {
  constructor(message, status, code, fields = null) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

const ID_KEYS = ['id', 'transactionId', 'movementId', 'policyId', 'vehicleId']

function splitKey(serviceKey) {
  const [owner, name] = serviceKey.split(':')
  const [group, method] = name.split('.')
  return { owner, group, method, collection: `${owner}:${group}` }
}

// fixtures: { 'runly.contacts:contacts': [{ id, name, ... }], ... }
export function createServiceSimulator({ moduleKey, companyId = '00000000-0000-7000-8000-00000000c0de', user = { id: '00000000-0000-7000-8000-0000000000a1', permissions: [], isAdmin: false }, grants = [], fixtures = {} } = {}) {
  const store = new Map(Object.entries(fixtures).map(([name, rows]) => [name, rows.map((row) => ({ enabled: true, ...row }))]))
  const idempotent = new Map()
  const calls = []
  const diagnostics = new Set()
  let counter = 0
  const nextId = () => `00000000-0000-7000-8000-${String(++counter).padStart(12, '0')}`
  const rowsOf = (collection) => (store.has(collection) ? store.get(collection) : store.set(collection, []).get(collection))
  const project = (contract, row) => (row ? Object.fromEntries(contract.returns.map((key) => [key, row[key] ?? null])) : null)
  const can = (permission) => permission === null || user?.isAdmin || (user?.permissions ?? []).includes(permission)

  function findRow(contract, collection, args) {
    const idKey = ID_KEYS.find((key) => args[key] !== undefined && contract.args[key])
    const row = idKey ? rowsOf(collection).find((r) => r.id === args[idKey] && r.enabled !== false) : null
    if (!row || (contract.scope === 'own' && row.sourceModule !== moduleKey)) {
      throw new SimulatedServiceError('El registro no existe o no lo creó este módulo.', 404, 'not_found')
    }
    return row
  }

  function simulate(serviceKey, contract, args) {
    const { method, collection } = splitKey(serviceKey)
    if (contract.action) diagnostics.add(`${serviceKey}: las reglas de negocio del módulo (${contract.action}) no se simulan.`)
    const visible = () => rowsOf(collection).filter((r) => r.enabled !== false && (contract.scope !== 'own' || r.sourceModule === moduleKey))
    if (method === 'read') return project(contract, visible().find((r) => r.id === args.id))
    if (method === 'list' || method === 'search') {
      const term = String(args.search ?? '').toLowerCase()
      const rows = visible().filter((r) => !term || Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(term)))
        .filter((r) => !args.sourceEntityId || r.sourceEntityId === args.sourceEntityId)
      if (method === 'list') return rows.map((r) => (contract.returns.includes('id') ? project(contract, r) : r))
      const limited = rows.slice(0, args.limit ?? 20)
      return { items: limited, total: rows.length }
    }
    if (method === 'send') return { sent: (args.userIds ?? []).length }
    if (method === 'signedUrl') { const row = findRow(contract, 'runly.files:files', args); return { id: row.id, url: `sim://files/${row.id}`, expiresIn: 3600 } }
    if (method === 'cancel') { const row = findRow(contract, collection, args); row.enabled = false; return { id: row.id, cancelled: true } }
    if (method === 'update') {
      const row = findRow(contract, collection, args)
      for (const [key, value] of Object.entries(args)) if (!ID_KEYS.includes(key)) row[key] = value
      return contract.returns.includes('summary') ? { id: row.id, summary: '(simulado) actualizado', link: null } : project(contract, row)
    }
    // create / save
    const row = { id: nextId(), companyId, enabled: true, ...args, sourceModule: moduleKey }
    if (method === 'save') { row.sizeBytes = Math.floor(String(args.contentBase64 ?? '').length * 3 / 4); delete row.contentBase64 }
    rowsOf(collection).push(row)
    return contract.returns.includes('summary') ? { id: row.id, summary: '(simulado) creado', link: null } : project(contract, row)
  }

  function invoke(ctx, serviceKey, args = {}) {
    const entry = { serviceKey, args, system: ctx.system }
    calls.push(entry)
    try {
      const contract = SERVICE_CONTRACTS[serviceKey]
      if (!contract) throw new SimulatedServiceError(`Servicio desconocido: ${serviceKey}.`, 404, 'unknown_service')
      if (!companyId) throw new SimulatedServiceError('No hay una empresa activa.', 400, 'company_required')
      if (ctx.system && !contract.system) throw new SimulatedServiceError(`"${contract.label}" necesita un usuario.`, 403, 'system_not_supported')
      if (!grants.includes(serviceKey)) throw new SimulatedServiceError(`Este módulo no tiene autorización para "${contract.label}".`, 403, 'service_not_granted')
      if (!ctx.system && !can(contract.permission)) throw new SimulatedServiceError(`No tienes permiso para "${contract.label}".`, 403, 'permission_denied')
      const parsed = validateServiceArgs(serviceKey, args)
      if (!parsed.ok) throw new SimulatedServiceError(`Datos no válidos para "${contract.label}".`, 422, 'invalid_args', parsed.errors)
      const key = contract.mutates && args?.idempotencyKey ? `${serviceKey}|${args.idempotencyKey}` : null
      if (key && idempotent.has(key)) return (entry.result = idempotent.get(key))
      const result = simulate(serviceKey, contract, parsed.value)
      if (key) idempotent.set(key, result)
      entry.result = result
      return result
    } catch (error) {
      entry.error = { status: error.status ?? 500, code: error.code ?? 'error', message: error.message }
      throw error
    }
  }

  function api(ctx) {
    const call = async (serviceKey, args) => invoke(ctx, serviceKey, args)
    const module = (targetKey) => {
      const out = {}
      for (const key of Object.keys(SERVICE_CONTRACTS)) {
        const { owner, group, method } = splitKey(key)
        if (owner !== targetKey) continue
        out[group] ??= {}
        out[group][method] = (args) => call(key, args)
      }
      return out
    }
    return { call, module }
  }

  return {
    forRequest: () => api({ system: false }),
    forSystem: () => api({ system: true }),
    store,
    calls,
    get diagnostics() { return [...diagnostics] },
  }
}
