import { Hono } from 'hono'
import { createExitService } from './exit-service.js'
import { scanGateSchema, rejectExitSchema, guardNotifiedSchema } from './exit-validators.js'
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

export function createExitRouter({ prisma, requirePermission, moduleContext }) {
  const app = new Hono()
  const service = createExitService({ prisma })

  app.onError((error, c) => {
    if (error instanceof DispatchServiceError) {
      return c.json({ error: error.message, code: error.code }, error.status)
    }
    if (isDatabaseConflict(error)) {
      return c.json({ error: 'Ya existe un registro con esos datos.', code: 'DUPLICATE_RECORD' }, 409)
    }
    console.error('[custom.dispatch] Error de salidas', error)
    return c.json({ error: 'No fue posible completar la operación.' }, 500)
  })

  // Guard-facing. Never responds with ticket/customer/material/quantity detail —
  // only whether the scan was accepted for processing (design 6.3 / 17.3).
  app.post('/dispatch/gate/scan', requirePermission('dispatch.gate.scan'), async (c) => {
    const parsed = scanGateSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ accepted: false }, 200)
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ accepted: false }, 200)

    const result = await service.scanGate({
      companyId,
      actorId,
      gateStationId: parsed.data.gate_station_id,
      qrValue: parsed.data.qr_value,
    })

    if (result.accepted && result.isNewAttempt && result.recipientUserIds?.length) {
      await moduleContext.notifications.publishFromContext(c, {
        eventType: 'dispatch.exit.approval_required',
        title: `Vale ${result.folio} esperando aprobación`,
        body: 'Un camión fue escaneado en la pluma y espera tu decisión.',
        link: `/app/m/custom.dispatch/salidas`,
        recipients: { userIds: result.recipientUserIds },
        priority: 'high',
        channels: ['in_app'],
        sourceType: 'dispatch.exit_attempt',
        sourceId: result.attemptId,
        dedupeKey: `dispatch.exit.approval_required:${result.attemptId}`,
      }, { throwOnError: false })
    }

    return c.json({ accepted: result.accepted })
  })

  app.get('/dispatch/exits/pending', requirePermission('dispatch.exit.review'), async (c) => {
    const { companyId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.listPendingExits({ companyId })
    return c.json({ data })
  })

  app.get('/dispatch/exits/:id', requirePermission('dispatch.exit.review'), async (c) => {
    const { companyId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.getExit({ companyId, id: c.req.param('id') })
    return c.json({ data })
  })

  app.post('/dispatch/exits/:id/approve', requirePermission('dispatch.exit.decide'), async (c) => {
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.approveExit({ companyId, actorId, attemptId: c.req.param('id') })
    return c.json({ data })
  })

  app.post('/dispatch/exits/:id/reject', requirePermission('dispatch.exit.decide'), async (c) => {
    const parsed = rejectExitSchema.safeParse(await c.req.json())
    if (!parsed.success) return validationResponse(c, parsed)
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.rejectExit({ companyId, actorId, attemptId: c.req.param('id'), reason: parsed.data.rejection_reason })
    return c.json({ data })
  })

  app.post('/dispatch/exits/:id/guard-notified', requirePermission('dispatch.exit.decide'), async (c) => {
    const parsed = guardNotifiedSchema.safeParse(await c.req.json())
    if (!parsed.success) return validationResponse(c, parsed)
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.recordGuardNotified({
      companyId,
      actorId,
      attemptId: c.req.param('id'),
      communicationMethod: parsed.data.communication_method,
      notes: parsed.data.notes,
    })
    return c.json({ data })
  })

  return app
}
