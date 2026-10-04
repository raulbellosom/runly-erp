// Cross-module services API (spec 2026-10-03-rme3-module-platform-v2 §5 goal 10,
// plan Task 6.1; extended by 2026-10-04-module-services-v2-design). A module
// calls another module's service through `moduleContext.services.forRequest(c)`:
//
//   const inv = moduleContext.services.forRequest(c).module('runly.inventory')
//   const { items } = await inv.items.search({ search: 'taladro' })
//
// Every call checks (1) an admin granted that service to the calling module
// (ModuleServiceGrant, instance-wide or for the active company), (2) the user
// holds the service's permission, (3) it runs in the request's active company.
// Arguments are then validated and stripped against the shared contract
// (422 invalid_args). Writing services are audited; an `idempotencyKey`
// returns the audited result of an earlier successful call instead of writing
// again.
//
// forSystem(moduleKey, companyId) is the same API without a user, handed only
// to api/events.js handlers by the domain-event dispatcher (the company comes
// from the event row, never from module code). Only contracts with
// `system: true` run there; the admin grant is the only authorization.
import { validateServiceArgs, IDEMPOTENCY_ARG } from '@runly/module-engine/contracts'
import { tenantActiveContext } from '../../lib/active-context.js'
import { ModuleServiceError, SERVICE_KEYS, createServiceCatalog, splitServiceKey } from './service-catalog.js'

// permission null: any member of the active company (the request already
// passed the tenant middleware).
const can = (user, permission) => permission === null || Boolean(user?.isAdmin || user?.permissionSet?.has?.(permission))

// Manifest `consumes: { 'runly.inventory': ['items.read'] }` -> service keys.
export function consumedServiceKeys(manifest) {
  const consumes = manifest?.consumes
  if (!consumes || typeof consumes !== 'object' || Array.isArray(consumes)) return []
  return Object.entries(consumes).flatMap(([moduleKey, names]) => (Array.isArray(names) ? names : []).map((name) => `${moduleKey}:${name}`))
}

// services.module('runly.inventory').items.read(args)
function moduleApi(call) {
  return (targetKey) => {
    const api = {}
    for (const key of SERVICE_KEYS) {
      const { moduleKey: owner, name } = splitServiceKey(key)
      if (owner !== targetKey) continue
      const [group, method] = name.split('.')
      api[group] ??= {}
      api[group][method] = (args) => call(key, args)
    }
    return api
  }
}

function invalidArgs(label, fields) {
  const error = new ModuleServiceError(`Datos no válidos para "${label}".`, 422, 'invalid_args')
  error.fields = fields
  return error
}

export function createModuleServices({ prisma, filesService = null, broadcaster = null }) {
  let catalog = null
  const services = () => (catalog ??= createServiceCatalog({ prisma, filesService, broadcaster }))

  async function grantedKeys(moduleKey, companyId) {
    const rows = await prisma.moduleServiceGrant.findMany({
      where: { moduleKey, OR: [{ companyId: null }, ...(companyId ? [{ companyId }] : [])] },
      select: { serviceKey: true },
    })
    return new Set(rows.map((row) => row.serviceKey))
  }

  function idempotencyKeyOf(service, args) {
    const raw = args?.idempotencyKey
    if (!service.mutates || raw === undefined || raw === null) return null
    const key = String(raw).trim()
    const max = IDEMPOTENCY_ARG.idempotencyKey.max
    if (!key || key.length > max) throw invalidArgs(service.label, { idempotencyKey: `de 1 a ${max} caracteres` })
    return key
  }

  async function previousResult({ companyId, moduleKey, serviceKey, idempotencyKey }) {
    const row = await prisma.auditLog.findFirst({
      where: { companyId, moduleKey, entityType: 'ModuleService', action: `module.service.${serviceKey}`, metadata: { path: ['idempotencyKey'], equals: idempotencyKey } },
      select: { after: true },
    })
    return row ? { found: true, result: row.after ?? null } : { found: false }
  }

  // ctx: { companyId, actorId, actorAuthId, actorProfile, activeContext, request, user, system }
  async function invoke(moduleKey, ctx, serviceKey, args) {
    const service = services()[serviceKey]
    if (!service) throw new ModuleServiceError(`Servicio desconocido: ${serviceKey}.`, 404, 'unknown_service')
    if (!ctx.companyId) throw new ModuleServiceError('No hay una empresa activa.', 400, 'company_required')
    if (ctx.system && !service.system) {
      throw new ModuleServiceError(`"${service.label}" necesita un usuario: no se puede usar desde eventos.`, 403, 'system_not_supported')
    }
    if (!(await grantedKeys(moduleKey, ctx.companyId)).has(serviceKey)) {
      throw new ModuleServiceError(`Este módulo no tiene autorización para "${service.label}". Un administrador debe autorizarlo en Módulos.`, 403, 'service_not_granted')
    }
    if (!ctx.system && !can(ctx.user, service.permission)) throw new ModuleServiceError(`No tienes permiso para "${service.label}".`, 403, 'permission_denied')
    const parsed = validateServiceArgs(serviceKey, args)
    if (!parsed.ok) throw invalidArgs(service.label, parsed.errors)
    const idempotencyKey = idempotencyKeyOf(service, args)
    if (idempotencyKey) {
      const previous = await previousResult({ companyId: ctx.companyId, moduleKey, serviceKey, idempotencyKey })
      if (previous.found) return previous.result
    }
    const { user: _user, ...handlerCtx } = ctx
    const result = await service.handler({ ...handlerCtx, moduleKey }, parsed.value)
    if (service.mutates) {
      await prisma.auditLog.create({
        data: {
          companyId: ctx.companyId, actorId: ctx.actorId ?? null, moduleKey, entityType: 'ModuleService', entityId: result?.id ?? null,
          action: `module.service.${serviceKey}`, before: null, after: result ?? null,
          metadata: { caller: moduleKey, sourceEntityId: parsed.value.sourceEntityId ?? null, ...(idempotencyKey ? { idempotencyKey } : {}), ...(ctx.system ? { system: true } : {}) },
        },
      }).catch((error) => console.error('[module-services] audit failed:', error?.message))
    }
    return result
  }

  function forRequest(c, moduleKey) {
    const user = c.get('userContext') ?? null
    const ctx = {
      companyId: c.get('companyId') ?? null,
      actorId: c.get('userId') ?? user?.profile?.id ?? null,
      actorAuthId: c.get('authUserId') ?? null,
      actorProfile: user?.profile ?? null,
      activeContext: tenantActiveContext(c),
      request: c,
      user,
      system: false,
    }
    const call = (serviceKey, args = {}) => invoke(moduleKey, ctx, serviceKey, args)
    return { call, module: moduleApi(call) }
  }

  function forSystem(moduleKey, companyId) {
    const ctx = { companyId: companyId ?? null, actorId: null, actorAuthId: null, actorProfile: null, activeContext: null, request: null, user: null, system: true }
    const call = (serviceKey, args = {}) => invoke(moduleKey, ctx, serviceKey, args)
    return { call, module: moduleApi(call) }
  }

  async function listGrants(moduleKey) {
    return prisma.moduleServiceGrant.findMany({ where: { moduleKey }, orderBy: { serviceKey: 'asc' } })
  }

  // Replaces the instance-wide grants of a module (company-specific ones stay).
  async function setGrants({ moduleKey, serviceKeys, grantedBy = null }) {
    const valid = [...new Set(serviceKeys)].filter((key) => SERVICE_KEYS.includes(key))
    await prisma.$transaction(async (tx) => {
      await tx.moduleServiceGrant.deleteMany({ where: { moduleKey, companyId: null, serviceKey: { notIn: valid } } })
      const existing = new Set((await tx.moduleServiceGrant.findMany({ where: { moduleKey, companyId: null }, select: { serviceKey: true } })).map((row) => row.serviceKey))
      for (const serviceKey of valid) {
        if (!existing.has(serviceKey)) await tx.moduleServiceGrant.create({ data: { moduleKey, serviceKey, companyId: null, grantedBy } })
      }
    })
    return listGrants(moduleKey)
  }

  async function revokeAll(moduleKey) {
    await prisma.moduleServiceGrant.deleteMany({ where: { moduleKey } })
  }

  function describe(serviceKeys) {
    const all = services()
    return serviceKeys.map((key) => ({ key, label: all[key]?.label ?? key, known: Boolean(all[key]), mutates: Boolean(all[key]?.mutates), system: Boolean(all[key]?.system) }))
  }

  return { forRequest, forSystem, listGrants, setGrants, revokeAll, describe }
}

export { ModuleServiceError }
