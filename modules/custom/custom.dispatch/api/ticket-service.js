import crypto from 'node:crypto'
import { DispatchServiceError } from './service-helpers.js'

const MODULE_KEY = 'custom.dispatch'
export const QR_PREFIX = 'RUNLY-DISPATCH:1:'
const EDITABLE_STATUSES = new Set(['CREATED', 'READY_FOR_EXIT', 'CORRECTION_REQUIRED'])
const CANCELLABLE_STATUSES = EDITABLE_STATUSES
const PRINTABLE_STATUSES = EDITABLE_STATUSES

export function createTicketService({ prisma }) {
  function generateQrToken() {
    const rawToken = crypto.randomBytes(24).toString('base64url')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    return { qrValue: `${QR_PREFIX}${rawToken}`, tokenHash }
  }

  function formatFolio(prefix, number, padding) {
    return `${prefix}-${String(number).padStart(padding, '0')}`
  }

  async function writeAudit(tx, { actorId, entityId, action, after }) {
    await tx.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: MODULE_KEY,
        entityType: 'dispatch.ticket',
        entityId,
        action,
        before: null,
        after: after ? JSON.stringify(after) : null,
        metadata: null,
      },
    })
  }

  async function writeEvent(tx, { companyId, ticketId, eventType, actorId, metadata }) {
    await tx.$queryRaw`
      INSERT INTO dispatch_ticket_event
        (company_id, ticket_id, event_type, actor_id, metadata, occurred_at, created_at, updated_at)
      VALUES
        (${companyId}::uuid, ${ticketId}::uuid, ${eventType}, ${actorId ?? null}::uuid,
         ${metadata ? JSON.stringify(metadata) : null}::jsonb, NOW(), NOW(), NOW())
    `
  }

  async function loadSite({ tx, companyId, id }) {
    const rows = await tx.$queryRaw`
      SELECT * FROM dispatch_site WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
    `
    if (!rows[0]) throw new DispatchServiceError('Sitio no encontrado.', 404, 'SITE_NOT_FOUND')
    if (!rows[0].enabled) throw new DispatchServiceError('El sitio seleccionado está inactivo.', 409, 'SITE_DISABLED')
    return rows[0]
  }

  async function loadStation({ tx, companyId, siteId, id, expectedType }) {
    const rows = await tx.$queryRaw`
      SELECT * FROM dispatch_station
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND site_id = ${siteId}::uuid
    `
    if (!rows[0]) throw new DispatchServiceError('Estación no encontrada.', 404, 'STATION_NOT_FOUND')
    if (!rows[0].enabled) throw new DispatchServiceError('La estación seleccionada está inactiva.', 409, 'STATION_DISABLED')
    if (expectedType && rows[0].station_type !== expectedType) {
      throw new DispatchServiceError(`La estación debe ser de tipo ${expectedType}.`, 422, 'STATION_TYPE_MISMATCH')
    }
    return rows[0]
  }

  async function loadMaterial({ tx, companyId, siteId, id, requiredMode }) {
    const rows = await tx.$queryRaw`
      SELECT * FROM dispatch_material_profile
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND site_id = ${siteId}::uuid
    `
    if (!rows[0]) throw new DispatchServiceError('Material no encontrado.', 404, 'MATERIAL_NOT_FOUND')
    if (!rows[0].enabled) throw new DispatchServiceError('El material seleccionado está inactivo.', 409, 'MATERIAL_DISABLED')
    if (requiredMode && !rows[0].allowed_modes?.includes(requiredMode)) {
      throw new DispatchServiceError(`El material no admite el modo de medición ${requiredMode}.`, 422, 'MATERIAL_MODE_NOT_ALLOWED')
    }
    return rows[0]
  }

  async function assignFolio({ tx, companyId, siteId, voucherType }) {
    const rows = await tx.$queryRaw`
      UPDATE dispatch_folio_series
      SET next_number = next_number + 1, updated_at = NOW()
      WHERE company_id = ${companyId}::uuid AND site_id = ${siteId}::uuid
        AND voucher_type = ${voucherType} AND enabled = true
      RETURNING prefix, next_number - 1 AS assigned_number, padding
    `
    const series = rows[0]
    if (!series) {
      throw new DispatchServiceError(
        `No hay una serie de folios activa de tipo ${voucherType} para este sitio.`,
        409,
        'FOLIO_SERIES_NOT_FOUND',
      )
    }
    return formatFolio(series.prefix, series.assigned_number, series.padding)
  }

  async function createTicket({
    companyId,
    actorId,
    voucherType,
    measurementMode,
    initialStatus,
    originStationType,
    data,
  }) {
    return prisma.$transaction(async (tx) => {
      const site = await loadSite({ tx, companyId, id: data.site_id })
      await loadStation({ tx, companyId, siteId: site.id, id: data.origin_station_id, expectedType: originStationType })
      const material = await loadMaterial({
        tx,
        companyId,
        siteId: site.id,
        id: data.material_profile_id,
        requiredMode: measurementMode,
      })

      const folio = await assignFolio({ tx, companyId, siteId: site.id, voucherType })
      const { qrValue, tokenHash } = generateQrToken()

      const rows = await tx.$queryRaw`
        INSERT INTO dispatch_ticket (
          company_id, site_id, origin_station_id, voucher_type, folio, status,
          sold_to_type, customer_contact_id, customer_name, buyer_email,
          external_voucher_reference, vehicle_plate, driver_name,
          material_profile_id, material_code, material_name, measurement_mode,
          requested_quantity, sold_volume_m3, payment_method, payment_reference,
          qr_version, qr_token_hash, created_by, created_at, updated_at
        ) VALUES (
          ${companyId}::uuid, ${site.id}::uuid, ${data.origin_station_id}::uuid, ${voucherType}, ${folio}, ${initialStatus},
          ${data.sold_to_type}, ${data.customer_contact_id ?? null}::uuid, ${data.customer_name ?? null}, ${data.buyer_email ?? null},
          ${data.external_voucher_reference ?? null}, ${data.vehicle_plate}, ${data.driver_name ?? null},
          ${material.id}::uuid, ${material.code}, ${material.name}, ${measurementMode},
          ${data.requested_quantity ?? null}, ${data.sold_volume_m3 ?? null}, ${data.payment_method ?? null}, ${data.payment_reference ?? null},
          1, ${tokenHash}, ${actorId}::uuid, NOW(), NOW()
        )
        RETURNING *
      `
      const ticket = rows[0]

      await writeEvent(tx, { companyId, ticketId: ticket.id, eventType: 'TICKET_CREATED', actorId, metadata: { voucherType } })
      await writeEvent(tx, { companyId, ticketId: ticket.id, eventType: 'FOLIO_ASSIGNED', actorId, metadata: { folio } })
      if (initialStatus === 'READY_FOR_EXIT') {
        await writeEvent(tx, { companyId, ticketId: ticket.id, eventType: 'READY_FOR_EXIT', actorId, metadata: null })
      }
      await writeAudit(tx, { actorId, entityId: ticket.id, action: 'ticket.create', after: ticket })

      return { ...ticket, qr_value: qrValue }
    })
  }

  async function createVolumeTicket({ companyId, actorId, data }) {
    return createTicket({
      companyId,
      actorId,
      voucherType: 'VOLUME',
      measurementMode: 'M3',
      initialStatus: 'READY_FOR_EXIT',
      originStationType: 'SALES',
      data,
    })
  }

  async function createScaleTicket({ companyId, actorId, data }) {
    return createTicket({
      companyId,
      actorId,
      voucherType: 'SCALE',
      measurementMode: 'TONS',
      initialStatus: 'CREATED',
      originStationType: 'SCALE',
      data,
    })
  }

  async function listTickets({ companyId, filters }) {
    const status = filters.status ?? null
    const voucherType = filters.voucher_type ?? null
    const siteId = filters.site_id ?? null
    const search = filters.q ? `%${filters.q}%` : null

    return prisma.$queryRaw`
      SELECT ticket.id, ticket.folio, ticket.voucher_type, ticket.status, ticket.vehicle_plate,
             ticket.customer_name, ticket.material_name, ticket.sold_volume_m3, ticket.created_at,
             site.name AS site_name
      FROM dispatch_ticket ticket
      INNER JOIN dispatch_site site
        ON site.id = ticket.site_id AND site.company_id = ticket.company_id
      WHERE ticket.company_id = ${companyId}::uuid
        AND (${status}::text IS NULL OR ticket.status = ${status})
        AND (${voucherType}::text IS NULL OR ticket.voucher_type = ${voucherType})
        AND (${siteId}::uuid IS NULL OR ticket.site_id = ${siteId}::uuid)
        AND (${search}::text IS NULL OR ticket.folio ILIKE ${search} OR ticket.vehicle_plate ILIKE ${search})
      ORDER BY ticket.created_at DESC
      LIMIT 200
    `
  }

  async function getTicket({ companyId, id }) {
    const rows = await prisma.$queryRaw`
      SELECT ticket.*, site.name AS site_name, station.name AS origin_station_name
      FROM dispatch_ticket ticket
      INNER JOIN dispatch_site site
        ON site.id = ticket.site_id AND site.company_id = ticket.company_id
      INNER JOIN dispatch_station station
        ON station.id = ticket.origin_station_id AND station.company_id = ticket.company_id
      WHERE ticket.id = ${id}::uuid AND ticket.company_id = ${companyId}::uuid
    `
    const ticket = rows[0]
    if (!ticket) throw new DispatchServiceError('Vale no encontrado.', 404, 'TICKET_NOT_FOUND')

    const events = await prisma.$queryRaw`
      SELECT id, event_type, actor_id, metadata, occurred_at
      FROM dispatch_ticket_event
      WHERE ticket_id = ${id}::uuid AND company_id = ${companyId}::uuid
      ORDER BY occurred_at ASC
    `
    return { ...ticket, events }
  }

  async function loadTicketForUpdate(tx, { companyId, id }) {
    const rows = await tx.$queryRaw`
      SELECT * FROM dispatch_ticket WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid FOR UPDATE
    `
    if (!rows[0]) throw new DispatchServiceError('Vale no encontrado.', 404, 'TICKET_NOT_FOUND')
    return rows[0]
  }

  async function updateTicket({ companyId, actorId, id, data }) {
    return prisma.$transaction(async (tx) => {
      const before = await loadTicketForUpdate(tx, { companyId, id })
      if (!EDITABLE_STATUSES.has(before.status)) {
        throw new DispatchServiceError('El vale ya no admite correcciones.', 409, 'TICKET_NOT_EDITABLE')
      }

      const rows = await tx.$queryRaw`
        UPDATE dispatch_ticket SET
          customer_name = CASE WHEN ${data.customer_name !== undefined} THEN ${data.customer_name ?? null} ELSE customer_name END,
          buyer_email = CASE WHEN ${data.buyer_email !== undefined} THEN ${data.buyer_email ?? null} ELSE buyer_email END,
          external_voucher_reference = CASE WHEN ${data.external_voucher_reference !== undefined} THEN ${data.external_voucher_reference ?? null} ELSE external_voucher_reference END,
          vehicle_plate = CASE WHEN ${data.vehicle_plate !== undefined} THEN ${data.vehicle_plate ?? null} ELSE vehicle_plate END,
          driver_name = CASE WHEN ${data.driver_name !== undefined} THEN ${data.driver_name ?? null} ELSE driver_name END,
          payment_method = CASE WHEN ${data.payment_method !== undefined} THEN ${data.payment_method ?? null} ELSE payment_method END,
          payment_reference = CASE WHEN ${data.payment_reference !== undefined} THEN ${data.payment_reference ?? null} ELSE payment_reference END,
          updated_at = NOW()
        WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
        RETURNING *
      `
      const updated = rows[0]
      await writeAudit(tx, { actorId, entityId: id, action: 'ticket.update', after: updated })
      return updated
    })
  }

  async function cancelTicket({ companyId, actorId, id, reason }) {
    return prisma.$transaction(async (tx) => {
      const before = await loadTicketForUpdate(tx, { companyId, id })
      if (!CANCELLABLE_STATUSES.has(before.status)) {
        throw new DispatchServiceError('El vale ya no puede cancelarse en su estado actual.', 409, 'TICKET_NOT_CANCELLABLE')
      }

      const rows = await tx.$queryRaw`
        UPDATE dispatch_ticket SET
          status = 'CANCELLED', cancelled_at = NOW(), cancelled_by = ${actorId}::uuid,
          cancel_reason = ${reason}, updated_at = NOW()
        WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
        RETURNING *
      `
      const updated = rows[0]
      await writeEvent(tx, { companyId, ticketId: id, eventType: 'TICKET_CANCELLED', actorId, metadata: { reason } })
      await writeAudit(tx, { actorId, entityId: id, action: 'ticket.cancel', after: updated })
      return updated
    })
  }

  // Rotates the QR token and returns the fresh raw value for immediate use in a PDF.
  // Every PDF request is implicitly a (re)print — see
  // docs/2026-09-20-custom-dispatch-phase2c-pdf.md for why the raw token can't be
  // reused across prints and why this mutates instead of being a plain read.
  async function preparePrint({ companyId, actorId, id }) {
    return prisma.$transaction(async (tx) => {
      const ticket = await loadTicketForUpdate(tx, { companyId, id })
      if (!PRINTABLE_STATUSES.has(ticket.status)) {
        throw new DispatchServiceError('El vale ya no puede imprimirse en su estado actual.', 409, 'TICKET_NOT_PRINTABLE')
      }

      const priorPrints = await tx.$queryRaw`
        SELECT COUNT(*)::int AS count FROM dispatch_ticket_event
        WHERE company_id = ${companyId}::uuid AND ticket_id = ${id}::uuid
          AND event_type IN ('VOUCHER_PRINTED', 'VOUCHER_REPRINTED')
      `
      const isReprint = Number(priorPrints[0]?.count ?? 0) > 0
      const { qrValue, tokenHash } = generateQrToken()

      const rows = await tx.$queryRaw`
        UPDATE dispatch_ticket SET
          qr_version = qr_version + 1, qr_token_hash = ${tokenHash}, updated_at = NOW()
        WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
        RETURNING *
      `
      const updated = rows[0]

      const eventType = isReprint ? 'VOUCHER_REPRINTED' : 'VOUCHER_PRINTED'
      await writeEvent(tx, { companyId, ticketId: id, eventType, actorId, metadata: { copies: 3 } })
      await writeAudit(tx, { actorId, entityId: id, action: `ticket.${eventType.toLowerCase()}`, after: { qr_version: updated.qr_version } })

      return { ticket: updated, qrValue }
    })
  }

  return { createVolumeTicket, createScaleTicket, listTickets, getTicket, updateTicket, cancelTicket, preparePrint }
}
