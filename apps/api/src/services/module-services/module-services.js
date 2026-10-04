// Cross-module services API (spec 2026-10-03-rme3-module-platform-v2 §5 goal 10,
// plan Task 6.1). A module calls another module's service through
// `moduleContext.services.forRequest(c)`:
//
//   const inv = moduleContext.services.forRequest(c).module('runly.inventory')
//   const { items } = await inv.items.search({ search: 'taladro' })
//
// Every call checks (1) an admin granted that service to the calling module
// (ModuleServiceGrant, instance-wide or for the active company), (2) the user
// holds the service's permission, (3) it runs in the request's active company.
// Writing services are audited.
import { ModuleServiceError, SERVICE_KEYS, createServiceCatalog, splitServiceKey } from './service-catalog.js'

const can = (user, permission) => Boolean(user?.isAdmin || user?.permissionSet?.has?.(permission))

// Manifest `consumes: { 'runly.inventory': ['items.read'] }` -> service keys.
export function consumedServiceKeys(manifest) {
  const consumes = manifest?.consumes
  if (!consumes || typeof consumes !== 'object' || Array.isArray(consumes)) return []
  return Object.entries(consumes).flatMap(([moduleKey, names]) => (Array.isArray(names) ? names : []).map((name) => `${moduleKey}:${name}`))
}

export function createModuleServices({ prisma }) {
  let catalog = null
  const services = () => (catalog ??= createServiceCatalog({ prisma }))

  async function grantedKeys(moduleKey, companyId) {
    const rows = await prisma.moduleServiceGrant.findMany({
      where: { moduleKey, OR: [{ companyId: null }, ...(companyId ? [{ companyId }] : [])] },
      select: { serviceKey: true },
    })
    return new Set(rows.map((row) => row.serviceKey))
  }

  function forRequest(c, moduleKey) {
    const companyId = c.get('companyId') ?? null
    const user = c.get('userContext') ?? null
    const actorId = c.get('userId') ?? user?.profile?.id ?? null
    const actorAuthId = c.get('authUserId') ?? null

    async function call(serviceKey, args = {}) {
      const service = services()[serviceKey]
      if (!service) throw new ModuleServiceError(`Servicio desconocido: ${serviceKey}.`, 404, 'unknown_service')
      if (!companyId) throw new ModuleServiceError('No hay una empresa activa.', 400, 'company_required')
      if (!(await grantedKeys(moduleKey, companyId)).has(serviceKey)) {
        throw new ModuleServiceError(`Este módulo no tiene autorización para "${service.label}". Un administrador debe autorizarlo en Módulos.`, 403, 'service_not_granted')
      }
      if (!can(user, service.permission)) throw new ModuleServiceError(`No tienes permiso para "${service.label}".`, 403, 'permission_denied')
      const result = await service.handler({ companyId, actorId, actorAuthId }, args)
      if (service.mutates) {
        await prisma.auditLog.create({
          data: { companyId, actorId, moduleKey, entityType: 'ModuleService', entityId: result?.id ?? null, action: `module.service.${serviceKey}`, before: null, after: result ?? null, metadata: { caller: moduleKey } },
        }).catch((error) => console.error('[module-services] audit failed:', error?.message))
      }
      return result
    }

    // services.module('runly.inventory').items.read(args)
    function module(targetKey) {
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

    return { call, module }
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
    return serviceKeys.map((key) => ({ key, label: all[key]?.label ?? key, known: Boolean(all[key]), mutates: Boolean(all[key]?.mutates) }))
  }

  return { forRequest, listGrants, setGrants, revokeAll, describe }
}

export { ModuleServiceError }
