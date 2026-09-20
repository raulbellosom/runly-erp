import { Hono } from 'hono'
import { createWeighingService } from './weighing-service.js'
import {
  captureTareSchema,
  captureGrossSchema,
  captureAuxiliaryExitSchema,
  correctWeighingSchema,
  weighingExceptionSchema,
} from './weighing-validators.js'
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

export function createWeighingRouter({ prisma, requirePermission }) {
  const app = new Hono()
  const service = createWeighingService({ prisma })

  app.onError((error, c) => {
    if (error instanceof DispatchServiceError) {
      return c.json({ error: error.message, code: error.code }, error.status)
    }
    if (isDatabaseConflict(error)) {
      return c.json({ error: 'Ya existe un registro con esos datos.', code: 'DUPLICATE_RECORD' }, 409)
    }
    console.error('[custom.dispatch] Error de pesajes', error)
    return c.json({ error: 'No fue posible completar la operación.' }, 500)
  })

  app.get('/dispatch/tickets/:id/weighings', requirePermission('dispatch.ticket.read'), async (c) => {
    const { companyId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.listWeighingsForTicket({ companyId, ticketId: c.req.param('id') })
    return c.json({ data })
  })

  app.post('/dispatch/tickets/:id/weighings/tare', requirePermission('dispatch.weighing.capture'), async (c) => {
    const parsed = captureTareSchema.safeParse(await c.req.json())
    if (!parsed.success) return validationResponse(c, parsed)
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.captureTare({ companyId, actorId, ticketId: c.req.param('id'), data: parsed.data })
    return c.json({ data }, 201)
  })

  app.post('/dispatch/tickets/:id/weighings/gross', requirePermission('dispatch.weighing.capture'), async (c) => {
    const parsed = captureGrossSchema.safeParse(await c.req.json())
    if (!parsed.success) return validationResponse(c, parsed)
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.captureGross({ companyId, actorId, ticketId: c.req.param('id'), data: parsed.data })
    return c.json({ data }, 201)
  })

  app.post('/dispatch/tickets/:id/weighings/auxiliary-exit', requirePermission('dispatch.weighing.capture'), async (c) => {
    const parsed = captureAuxiliaryExitSchema.safeParse(await c.req.json())
    if (!parsed.success) return validationResponse(c, parsed)
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.captureAuxiliaryExit({ companyId, actorId, ticketId: c.req.param('id'), data: parsed.data })
    return c.json({ data }, 201)
  })

  app.post('/dispatch/weighings/:id/correct', requirePermission('dispatch.weighing.override'), async (c) => {
    const parsed = correctWeighingSchema.safeParse(await c.req.json())
    if (!parsed.success) return validationResponse(c, parsed)
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.correctWeighing({ companyId, actorId, weighingId: c.req.param('id'), data: parsed.data })
    return c.json({ data }, 201)
  })

  app.post('/dispatch/tickets/:id/weighing-exception', requirePermission('dispatch.weighing.override'), async (c) => {
    const parsed = weighingExceptionSchema.safeParse(await c.req.json())
    if (!parsed.success) return validationResponse(c, parsed)
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.authorizeException({ companyId, actorId, ticketId: c.req.param('id'), reason: parsed.data.reason })
    return c.json({ data })
  })

  return app
}
