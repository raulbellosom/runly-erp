import { DispatchServiceError } from './service-helpers.js'

const MODULE_KEY = 'custom.dispatch'
const TERMINAL_STATUSES = new Set(['USED', 'CANCELLED', 'EXPIRED'])
const EVENT_BY_READING_TYPE = {
  TARE: 'TARE_RECORDED',
  GROSS: 'GROSS_RECORDED',
  AUXILIARY_EXIT_GROSS: 'AUXILIARY_WEIGHT_RECORDED',
}

export function createWeighingService({ prisma }) {
  async function writeAudit(tx, { actorId, entityType, entityId, action, after }) {
    await tx.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: MODULE_KEY,
        entityType,
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

  async function loadTicket(tx, { companyId, id }) {
    const rows = await tx.$queryRaw`
      SELECT * FROM dispatch_ticket WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid FOR UPDATE
    `
    if (!rows[0]) throw new DispatchServiceError('Vale no encontrado.', 404, 'TICKET_NOT_FOUND')
    return rows[0]
  }

  async function loadStation(tx, { companyId, id, expectedType }) {
    const rows = await tx.$queryRaw`
      SELECT * FROM dispatch_station WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
    `
    if (!rows[0]) throw new DispatchServiceError('Estación no encontrada.', 404, 'STATION_NOT_FOUND')
    if (!rows[0].enabled) throw new DispatchServiceError('La estación seleccionada está inactiva.', 409, 'STATION_DISABLED')
    if (expectedType && rows[0].station_type !== expectedType) {
      throw new DispatchServiceError(`La estación debe ser de tipo ${expectedType}.`, 422, 'STATION_TYPE_MISMATCH')
    }
    return rows[0]
  }

  async function effectiveReading(tx, { companyId, ticketId, readingType }) {
    const rows = await tx.$queryRaw`
      SELECT w.* FROM dispatch_weighing w
      WHERE w.company_id = ${companyId}::uuid AND w.ticket_id = ${ticketId}::uuid AND w.reading_type = ${readingType}
        AND NOT EXISTS (SELECT 1 FROM dispatch_weighing w2 WHERE w2.supersedes_id = w.id)
      ORDER BY w.captured_at DESC
      LIMIT 1
    `
    return rows[0] ?? null
  }

  async function insertReading(tx, {
    companyId, ticketId, stationId, readingType, weightKg, source, actorId,
    deviceReference, supersedesId, correctionReason,
  }) {
    const rows = await tx.$queryRaw`
      INSERT INTO dispatch_weighing (
        company_id, ticket_id, station_id, reading_type, weight_kg, source,
        captured_by, captured_at, supersedes_id, correction_reason, device_reference,
        created_at, updated_at
      ) VALUES (
        ${companyId}::uuid, ${ticketId}::uuid, ${stationId}::uuid, ${readingType}, ${weightKg}, ${source},
        ${actorId}::uuid, NOW(), ${supersedesId ?? null}::uuid, ${correctionReason ?? null}, ${deviceReference ?? null},
        NOW(), NOW()
      )
      RETURNING *
    `
    return rows[0]
  }

  async function captureReading({ companyId, actorId, ticketId, readingType, expectedVoucherType, data }) {
    return prisma.$transaction(async (tx) => {
      const ticket = await loadTicket(tx, { companyId, id: ticketId })
      if (TERMINAL_STATUSES.has(ticket.status)) {
        throw new DispatchServiceError('El vale ya está en un estado final.', 409, 'TICKET_TERMINAL')
      }
      if (ticket.voucher_type !== expectedVoucherType) {
        throw new DispatchServiceError(`Este pesaje solo aplica a vales de tipo ${expectedVoucherType}.`, 422, 'VOUCHER_TYPE_MISMATCH')
      }
      if (readingType !== 'AUXILIARY_EXIT_GROSS' && ticket.status !== 'CREATED') {
        throw new DispatchServiceError('El vale ya no admite captura de tara o bruto.', 409, 'TICKET_NOT_CAPTURABLE')
      }

      const station = await loadStation(tx, { companyId, id: data.station_id, expectedType: 'SCALE' })

      let tare = null
      if (readingType === 'GROSS') {
        tare = await effectiveReading(tx, { companyId, ticketId, readingType: 'TARE' })
        if (!tare) throw new DispatchServiceError('Captura la tara antes del peso bruto.', 409, 'TARE_REQUIRED')
        if (Number(data.weight_kg) <= Number(tare.weight_kg)) {
          throw new DispatchServiceError('El peso bruto debe ser mayor que la tara.', 422, 'GROSS_NOT_GREATER_THAN_TARE')
        }
      }

      const reading = await insertReading(tx, {
        companyId, ticketId, stationId: station.id, readingType,
        weightKg: data.weight_kg, source: data.source, actorId, deviceReference: data.device_reference,
      })

      const netWeightKg = readingType === 'GROSS' ? Number(reading.weight_kg) - Number(tare.weight_kg) : null
      const metadata = readingType === 'GROSS'
        ? { weight_kg: reading.weight_kg, tare_weight_kg: tare.weight_kg, net_weight_kg: netWeightKg }
        : { weight_kg: reading.weight_kg }
      await writeEvent(tx, { companyId, ticketId, eventType: EVENT_BY_READING_TYPE[readingType], actorId, metadata })

      let updatedTicket = ticket
      if (readingType === 'GROSS') {
        const rows = await tx.$queryRaw`
          UPDATE dispatch_ticket SET status = 'READY_FOR_EXIT', updated_at = NOW()
          WHERE id = ${ticketId}::uuid AND company_id = ${companyId}::uuid
          RETURNING *
        `
        updatedTicket = rows[0]
        await writeEvent(tx, { companyId, ticketId, eventType: 'READY_FOR_EXIT', actorId, metadata: null })
      }

      await writeAudit(tx, {
        actorId,
        entityType: 'dispatch.weighing',
        entityId: reading.id,
        action: `weighing.${readingType.toLowerCase()}_captured`,
        after: reading,
      })

      return { reading, ticket: updatedTicket, net_weight_kg: netWeightKg }
    })
  }

  async function captureTare({ companyId, actorId, ticketId, data }) {
    return captureReading({ companyId, actorId, ticketId, readingType: 'TARE', expectedVoucherType: 'SCALE', data })
  }

  async function captureGross({ companyId, actorId, ticketId, data }) {
    return captureReading({ companyId, actorId, ticketId, readingType: 'GROSS', expectedVoucherType: 'SCALE', data })
  }

  async function captureAuxiliaryExit({ companyId, actorId, ticketId, data }) {
    return captureReading({ companyId, actorId, ticketId, readingType: 'AUXILIARY_EXIT_GROSS', expectedVoucherType: 'VOLUME', data })
  }

  async function correctWeighing({ companyId, actorId, weighingId, data }) {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        SELECT * FROM dispatch_weighing WHERE id = ${weighingId}::uuid AND company_id = ${companyId}::uuid
      `
      const original = rows[0]
      if (!original) throw new DispatchServiceError('Pesaje no encontrado.', 404, 'WEIGHING_NOT_FOUND')

      const ticket = await loadTicket(tx, { companyId, id: original.ticket_id })
      if (TERMINAL_STATUSES.has(ticket.status)) {
        throw new DispatchServiceError('El vale ya está en un estado final.', 409, 'TICKET_TERMINAL')
      }

      const superseded = await tx.$queryRaw`
        SELECT id FROM dispatch_weighing WHERE supersedes_id = ${weighingId}::uuid AND company_id = ${companyId}::uuid
      `
      if (superseded[0]) {
        throw new DispatchServiceError('Este pesaje ya fue corregido por otro registro.', 409, 'WEIGHING_ALREADY_SUPERSEDED')
      }

      const corrected = await insertReading(tx, {
        companyId,
        ticketId: original.ticket_id,
        stationId: original.station_id,
        readingType: original.reading_type,
        weightKg: data.weight_kg,
        source: data.source,
        actorId,
        deviceReference: data.device_reference,
        supersedesId: original.id,
        correctionReason: data.correction_reason,
      })

      await writeEvent(tx, {
        companyId,
        ticketId: original.ticket_id,
        eventType: 'WEIGHING_CORRECTED',
        actorId,
        metadata: {
          reading_type: original.reading_type,
          previous_weight_kg: original.weight_kg,
          weight_kg: corrected.weight_kg,
          reason: data.correction_reason,
        },
      })
      await writeAudit(tx, { actorId, entityType: 'dispatch.weighing', entityId: corrected.id, action: 'weighing.correct', after: corrected })

      return corrected
    })
  }

  async function authorizeException({ companyId, actorId, ticketId, reason }) {
    return prisma.$transaction(async (tx) => {
      const ticket = await loadTicket(tx, { companyId, id: ticketId })
      if (ticket.voucher_type !== 'SCALE') {
        throw new DispatchServiceError('Las excepciones de pesaje solo aplican a vales con báscula.', 422, 'VOUCHER_TYPE_MISMATCH')
      }
      if (TERMINAL_STATUSES.has(ticket.status)) {
        throw new DispatchServiceError('El vale ya está en un estado final.', 409, 'TICKET_TERMINAL')
      }

      const movesToReady = ticket.status === 'CREATED'
      const rows = await tx.$queryRaw`
        UPDATE dispatch_ticket SET
          weighing_exception = true,
          weighing_exception_reason = ${reason},
          weighing_exception_by = ${actorId}::uuid,
          weighing_exception_at = NOW(),
          status = ${movesToReady ? 'READY_FOR_EXIT' : ticket.status},
          updated_at = NOW()
        WHERE id = ${ticketId}::uuid AND company_id = ${companyId}::uuid
        RETURNING *
      `
      const updated = rows[0]

      await writeEvent(tx, { companyId, ticketId, eventType: 'WEIGHING_EXCEPTION_AUTHORIZED', actorId, metadata: { reason } })
      if (movesToReady) {
        await writeEvent(tx, { companyId, ticketId, eventType: 'READY_FOR_EXIT', actorId, metadata: null })
      }
      await writeAudit(tx, { actorId, entityType: 'dispatch.ticket', entityId: ticketId, action: 'ticket.weighing_exception', after: updated })

      return updated
    })
  }

  async function listWeighingsForTicket({ companyId, ticketId }) {
    return prisma.$queryRaw`
      SELECT id, reading_type, weight_kg, source, captured_by, captured_at, supersedes_id, correction_reason, device_reference
      FROM dispatch_weighing
      WHERE company_id = ${companyId}::uuid AND ticket_id = ${ticketId}::uuid
      ORDER BY captured_at ASC
    `
  }

  return { captureTare, captureGross, captureAuxiliaryExit, correctWeighing, authorizeException, listWeighingsForTicket }
}
