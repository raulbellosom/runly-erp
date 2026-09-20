import { Hono } from 'hono'
import { createCatalogService } from './catalog-service.js'
import { catalogResources, enabledSchema, idSchema, parseCatalogPayload } from './catalog-validators.js'
import { DispatchServiceError, isDatabaseConflict } from './service-helpers.js'

function requestContext(c) {
  const context = c.get('userContext')
  return {
    companyId: context?.memberships?.[0]?.companyId,
    actorId: context?.profile?.id,
  }
}

function validationResponse(c, parsed) {
  return c.json({
    error: 'Revisa los datos capturados.',
    details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  }, 422)
}

export function createCatalogRouter({ prisma, requirePermission }) {
  const app = new Hono()
  const service = createCatalogService({ prisma })

  app.onError((error, c) => {
    if (error instanceof DispatchServiceError) {
      return c.json({ error: error.message, code: error.code }, error.status)
    }
    if (isDatabaseConflict(error)) {
      return c.json({ error: 'Ya existe un registro con esos datos.', code: 'DUPLICATE_RECORD' }, 409)
    }
    console.error('[custom.dispatch] Error de catálogo', error)
    return c.json({ error: 'No fue posible completar la operación.' }, 500)
  })

  app.get('/dispatch/catalog/setup', requirePermission('dispatch.catalog.manage'), async (c) => {
    const { companyId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.getSetup({ companyId })
    return c.json({ data })
  })

  app.post('/dispatch/catalog/:resource', requirePermission('dispatch.catalog.manage'), async (c) => {
    const resource = c.req.param('resource')
    if (!catalogResources.includes(resource)) return c.json({ error: 'Catálogo no reconocido.' }, 404)
    const parsed = parseCatalogPayload(resource, await c.req.json())
    if (!parsed.success) return validationResponse(c, parsed)
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.create({ companyId, resource, data: parsed.data, actorId })
    return c.json({ data }, 201)
  })

  app.patch('/dispatch/catalog/:resource/:id', requirePermission('dispatch.catalog.manage'), async (c) => {
    const resource = c.req.param('resource')
    if (!catalogResources.includes(resource)) return c.json({ error: 'Catálogo no reconocido.' }, 404)
    const parsed = parseCatalogPayload(resource, await c.req.json(), { partial: true })
    if (!parsed.success) return validationResponse(c, parsed)
    const id = idSchema.safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'Identificador inválido.' }, 422)
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.update({ companyId, resource, id: id.data, data: parsed.data, actorId })
    return c.json({ data })
  })

  app.patch('/dispatch/catalog/:resource/:id/enabled', requirePermission('dispatch.catalog.manage'), async (c) => {
    const resource = c.req.param('resource')
    if (!catalogResources.includes(resource)) return c.json({ error: 'Catálogo no reconocido.' }, 404)
    const parsed = enabledSchema.safeParse(await c.req.json())
    if (!parsed.success) return validationResponse(c, parsed)
    const id = idSchema.safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'Identificador inválido.' }, 422)
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.setEnabled({
      companyId,
      resource,
      id: id.data,
      enabled: parsed.data.enabled,
      actorId,
    })
    return c.json({ data })
  })

  return app
}
