import { Hono } from 'hono'
import { createTicketService } from './ticket-service.js'
import { createWeighingService } from './weighing-service.js'
import {
  createVolumeTicketSchema,
  createScaleTicketSchema,
  listTicketsQuerySchema,
  updateTicketSchema,
  cancelTicketSchema,
} from './ticket-validators.js'
import { DispatchServiceError, isDatabaseConflict } from './service-helpers.js'
import { resolveVoucherBranding, buildVoucherPdfBuffer } from './voucher-pdf.js'

function effectiveWeighings(rows = []) {
  const supersededIds = new Set(rows.filter((w) => w.supersedes_id).map((w) => w.supersedes_id))
  return rows.filter((w) => !supersededIds.has(w.id))
}

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

export function createTicketRouter({ prisma, requirePermission }) {
  const app = new Hono()
  const service = createTicketService({ prisma })
  const weighingService = createWeighingService({ prisma })

  app.onError((error, c) => {
    if (error instanceof DispatchServiceError) {
      return c.json({ error: error.message, code: error.code }, error.status)
    }
    if (isDatabaseConflict(error)) {
      return c.json({ error: 'Ya existe un registro con esos datos.', code: 'DUPLICATE_RECORD' }, 409)
    }
    console.error('[custom.dispatch] Error de vales', error)
    return c.json({ error: 'No fue posible completar la operación.' }, 500)
  })

  app.get('/dispatch/tickets', requirePermission('dispatch.ticket.read'), async (c) => {
    const { companyId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const parsed = listTicketsQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))
    if (!parsed.success) return validationResponse(c, parsed)
    const data = await service.listTickets({ companyId, filters: parsed.data })
    return c.json({ data })
  })

  app.post('/dispatch/tickets/volume', requirePermission('dispatch.ticket.create_volume'), async (c) => {
    const parsed = createVolumeTicketSchema.safeParse(await c.req.json())
    if (!parsed.success) return validationResponse(c, parsed)
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.createVolumeTicket({ companyId, actorId, data: parsed.data })
    return c.json({ data }, 201)
  })

  app.post('/dispatch/tickets/scale', requirePermission('dispatch.ticket.create_scale'), async (c) => {
    const parsed = createScaleTicketSchema.safeParse(await c.req.json())
    if (!parsed.success) return validationResponse(c, parsed)
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.createScaleTicket({ companyId, actorId, data: parsed.data })
    return c.json({ data }, 201)
  })

  app.get('/dispatch/tickets/:id', requirePermission('dispatch.ticket.read'), async (c) => {
    const { companyId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.getTicket({ companyId, id: c.req.param('id') })
    return c.json({ data })
  })

  app.patch('/dispatch/tickets/:id', requirePermission('dispatch.ticket.update'), async (c) => {
    const parsed = updateTicketSchema.safeParse(await c.req.json())
    if (!parsed.success) return validationResponse(c, parsed)
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.updateTicket({ companyId, actorId, id: c.req.param('id'), data: parsed.data })
    return c.json({ data })
  })

  app.post('/dispatch/tickets/:id/cancel', requirePermission('dispatch.ticket.cancel'), async (c) => {
    const parsed = cancelTicketSchema.safeParse(await c.req.json())
    if (!parsed.success) return validationResponse(c, parsed)
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const data = await service.cancelTicket({ companyId, actorId, id: c.req.param('id'), reason: parsed.data.reason })
    return c.json({ data })
  })

  // POST, not GET: this rotates the ticket's QR token and writes a print/reprint
  // event, so it is not a safe/idempotent read — see
  // docs/2026-09-20-custom-dispatch-phase2c-pdf.md.
  app.post('/dispatch/tickets/:id/pdf', requirePermission('dispatch.ticket.print'), async (c) => {
    const { companyId, actorId } = requestContext(c)
    if (!companyId) return c.json({ error: 'No hay una empresa activa.' }, 400)
    const ticketId = c.req.param('id')

    // preparePrint mutates (rotates the QR, writes the print/reprint event) and
    // must commit before the reads below, which pick up its result.
    const { qrValue } = await service.preparePrint({ companyId, actorId, id: ticketId })
    const [full, branding, rawWeighings] = await Promise.all([
      service.getTicket({ companyId, id: ticketId }),
      resolveVoucherBranding({ prisma, companyId }),
      weighingService.listWeighingsForTicket({ companyId, ticketId }),
    ])

    const pdfBuffer = await buildVoucherPdfBuffer({
      branding,
      ticket: full,
      weighings: effectiveWeighings(rawWeighings),
      qrValue,
    })

    c.header('Content-Type', 'application/pdf')
    c.header('Content-Disposition', `inline; filename="${full.folio}.pdf"`)
    return new Response(pdfBuffer, { status: 200, headers: c.res.headers })
  })

  return app
}
