import crypto from 'node:crypto'
import { DispatchServiceError } from './service-helpers.js'
import { QR_PREFIX } from './ticket-service.js'

const MODULE_KEY = 'custom.dispatch'
const TERMINAL_STATUSES = new Set(['USED', 'CANCELLED', 'EXPIRED'])
const SCANNABLE_STATUSES = new Set(['READY_FOR_EXIT', 'CORRECTION_REQUIRED'])
const DECIDABLE_STATUS = 'PENDING_APPROVAL'

export function createExitService({ prisma }) {
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

  async function writeEvent(tx, { companyId, ticketId, eventType, actorId, attemptId, metadata }) {
    await tx.$queryRaw`
      INSERT INTO dispatch_ticket_event
        (company_id, ticket_id, event_type, actor_id, attempt_id, metadata, occurred_at, created_at, updated_at)
      VALUES
        (${companyId}::uuid, ${ticketId}::uuid, ${eventType}, ${actorId ?? null}::uuid, ${attemptId ?? null}::uuid,
         ${metadata ? JSON.stringify(metadata) : null}::jsonb, NOW(), NOW(), NOW())
    `
  }

  async function resolveExitAlertRecipients(tx, { companyId, siteId }) {
    const rows = await tx.$queryRaw`
      SELECT DISTINCT assignment.user_id
      FROM dispatch_station_assignment assignment
      INNER JOIN dispatch_station station
        ON station.id = assignment.station_id AND station.company_id = assignment.company_id
      WHERE assignment.company_id = ${companyId}::uuid
        AND station.site_id = ${siteId}::uuid
        AND station.station_type = 'SCALE'
        AND station.enabled = true
        AND assignment.enabled = true
        AND assignment.receives_exit_alerts = true
    `
    return rows.map((r) => r.user_id)
  }

  // Guard-facing: never returns ticket/customer/material/quantity detail. The caller
  // (route) strips this down further to just { accepted } before responding over HTTP;
  // the extra fields here exist only so the route can publish the approval notification.
  async function scanGate({ companyId, actorId, gateStationId, qrValue }) {
    return prisma.$transaction(async (tx) => {
      const stationRows = await tx.$queryRaw`
        SELECT * FROM dispatch_station WHERE id = ${gateStationId}::uuid AND company_id = ${companyId}::uuid
      `
      const station = stationRows[0]
      if (!station || !station.enabled || station.station_type !== 'GATE') {
        return { accepted: false }
      }

      if (!qrValue.startsWith(QR_PREFIX)) return { accepted: false }
      const token = qrValue.slice(QR_PREFIX.length)
      if (!token) return { accepted: false }
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

      const ticketRows = await tx.$queryRaw`
        SELECT * FROM dispatch_ticket
        WHERE company_id = ${companyId}::uuid AND qr_token_hash = ${tokenHash}
        FOR UPDATE
      `
      const ticket = ticketRows[0]
      if (!ticket || !SCANNABLE_STATUSES.has(ticket.status)) {
        return { accepted: false }
      }

      const pendingRows = await tx.$queryRaw`
        SELECT * FROM dispatch_exit_attempt
        WHERE company_id = ${companyId}::uuid AND ticket_id = ${ticket.id}::uuid AND status = 'PENDING_APPROVAL'
      `
      if (pendingRows[0]) {
        return { accepted: true, ticketId: ticket.id, attemptId: pendingRows[0].id, isNewAttempt: false }
      }

      const countRows = await tx.$queryRaw`
        SELECT COUNT(*)::int AS count FROM dispatch_exit_attempt
        WHERE company_id = ${companyId}::uuid AND ticket_id = ${ticket.id}::uuid
      `
      const attemptNumber = Number(countRows[0]?.count ?? 0) + 1
      const idempotencyKey = crypto.randomUUID()

      const attemptRows = await tx.$queryRaw`
        INSERT INTO dispatch_exit_attempt (
          company_id, ticket_id, gate_station_id, attempt_number, status,
          scanned_by, scanned_at, scan_idempotency_key, created_at, updated_at
        ) VALUES (
          ${companyId}::uuid, ${ticket.id}::uuid, ${station.id}::uuid, ${attemptNumber}, 'PENDING_APPROVAL',
          ${actorId}::uuid, NOW(), ${idempotencyKey}, NOW(), NOW()
        )
        RETURNING *
      `
      const attempt = attemptRows[0]

      await tx.$queryRaw`
        UPDATE dispatch_ticket SET status = 'PENDING_APPROVAL', updated_at = NOW()
        WHERE id = ${ticket.id}::uuid AND company_id = ${companyId}::uuid
      `
      await writeEvent(tx, {
        companyId, ticketId: ticket.id, eventType: 'QR_SCANNED_EXIT_GATE', actorId, attemptId: attempt.id,
        metadata: { attempt_number: attemptNumber, gate_station_id: station.id },
      })
      await writeAudit(tx, { actorId, entityType: 'dispatch.exit_attempt', entityId: attempt.id, action: 'exit_attempt.scan', after: attempt })

      const recipientUserIds = await resolveExitAlertRecipients(tx, { companyId, siteId: ticket.site_id })

      return {
        accepted: true,
        ticketId: ticket.id,
        attemptId: attempt.id,
        isNewAttempt: true,
        folio: ticket.folio,
        recipientUserIds,
      }
    })
  }

  async function listPendingExits({ companyId }) {
    return prisma.$queryRaw`
      SELECT attempt.id, attempt.attempt_number, attempt.scanned_at, attempt.gate_station_id,
             gate.name AS gate_station_name,
             ticket.id AS ticket_id, ticket.folio, ticket.voucher_type, ticket.vehicle_plate,
             ticket.customer_name, ticket.material_name, ticket.sold_volume_m3
      FROM dispatch_exit_attempt attempt
      INNER JOIN dispatch_ticket ticket
        ON ticket.id = attempt.ticket_id AND ticket.company_id = attempt.company_id
      INNER JOIN dispatch_station gate
        ON gate.id = attempt.gate_station_id AND gate.company_id = attempt.company_id
      WHERE attempt.company_id = ${companyId}::uuid AND attempt.status = 'PENDING_APPROVAL'
      ORDER BY attempt.scanned_at ASC
    `
  }

  async function getExit({ companyId, id }) {
    const rows = await prisma.$queryRaw`
      SELECT attempt.*, gate.name AS gate_station_name,
             ticket.folio, ticket.voucher_type, ticket.vehicle_plate, ticket.customer_name,
             ticket.material_name, ticket.sold_volume_m3, ticket.site_id
      FROM dispatch_exit_attempt attempt
      INNER JOIN dispatch_ticket ticket
        ON ticket.id = attempt.ticket_id AND ticket.company_id = attempt.company_id
      INNER JOIN dispatch_station gate
        ON gate.id = attempt.gate_station_id AND gate.company_id = attempt.company_id
      WHERE attempt.id = ${id}::uuid AND attempt.company_id = ${companyId}::uuid
    `
    const attempt = rows[0]
    if (!attempt) throw new DispatchServiceError('Intento de salida no encontrado.', 404, 'EXIT_ATTEMPT_NOT_FOUND')

    const history = await prisma.$queryRaw`
      SELECT id, attempt_number, status, scanned_at, decided_at, rejection_reason
      FROM dispatch_exit_attempt
      WHERE company_id = ${companyId}::uuid AND ticket_id = ${attempt.ticket_id}::uuid
      ORDER BY attempt_number ASC
    `
    return { ...attempt, history }
  }

  async function loadAttemptForDecision(tx, { companyId, id }) {
    const rows = await tx.$queryRaw`
      SELECT * FROM dispatch_exit_attempt WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid FOR UPDATE
    `
    const attempt = rows[0]
    if (!attempt) throw new DispatchServiceError('Intento de salida no encontrado.', 404, 'EXIT_ATTEMPT_NOT_FOUND')
    return attempt
  }

  async function approveExit({ companyId, actorId, attemptId }) {
    return prisma.$transaction(async (tx) => {
      const attempt = await loadAttemptForDecision(tx, { companyId, id: attemptId })
      if (attempt.status !== DECIDABLE_STATUS) return attempt

      const ticketRows = await tx.$queryRaw`
        SELECT * FROM dispatch_ticket WHERE id = ${attempt.ticket_id}::uuid AND company_id = ${companyId}::uuid FOR UPDATE
      `
      const ticket = ticketRows[0]
      if (!ticket || TERMINAL_STATUSES.has(ticket.status)) {
        throw new DispatchServiceError('El vale ya no admite una decisión de salida.', 409, 'TICKET_NOT_DECIDABLE')
      }

      const updatedRows = await tx.$queryRaw`
        UPDATE dispatch_exit_attempt SET status = 'APPROVED', decided_by = ${actorId}::uuid, decided_at = NOW(), updated_at = NOW()
        WHERE id = ${attemptId}::uuid AND company_id = ${companyId}::uuid
        RETURNING *
      `
      const updated = updatedRows[0]

      await tx.$queryRaw`
        UPDATE dispatch_ticket SET status = 'USED', used_at = NOW(), updated_at = NOW()
        WHERE id = ${ticket.id}::uuid AND company_id = ${companyId}::uuid
      `
      await writeEvent(tx, { companyId, ticketId: ticket.id, eventType: 'EXIT_APPROVED', actorId, attemptId, metadata: null })
      await writeAudit(tx, { actorId, entityType: 'dispatch.exit_attempt', entityId: attemptId, action: 'exit_attempt.approve', after: updated })

      return updated
    })
  }

  async function rejectExit({ companyId, actorId, attemptId, reason }) {
    return prisma.$transaction(async (tx) => {
      const attempt = await loadAttemptForDecision(tx, { companyId, id: attemptId })
      if (attempt.status !== DECIDABLE_STATUS) return attempt

      const ticketRows = await tx.$queryRaw`
        SELECT * FROM dispatch_ticket WHERE id = ${attempt.ticket_id}::uuid AND company_id = ${companyId}::uuid FOR UPDATE
      `
      const ticket = ticketRows[0]
      if (!ticket || TERMINAL_STATUSES.has(ticket.status)) {
        throw new DispatchServiceError('El vale ya no admite una decisión de salida.', 409, 'TICKET_NOT_DECIDABLE')
      }

      const updatedRows = await tx.$queryRaw`
        UPDATE dispatch_exit_attempt SET
          status = 'REJECTED', decided_by = ${actorId}::uuid, decided_at = NOW(),
          rejection_reason = ${reason}, updated_at = NOW()
        WHERE id = ${attemptId}::uuid AND company_id = ${companyId}::uuid
        RETURNING *
      `
      const updated = updatedRows[0]

      await tx.$queryRaw`
        UPDATE dispatch_ticket SET status = 'CORRECTION_REQUIRED', updated_at = NOW()
        WHERE id = ${ticket.id}::uuid AND company_id = ${companyId}::uuid
      `
      await writeEvent(tx, { companyId, ticketId: ticket.id, eventType: 'EXIT_REJECTED', actorId, attemptId, metadata: { reason } })
      await writeAudit(tx, { actorId, entityType: 'dispatch.exit_attempt', entityId: attemptId, action: 'exit_attempt.reject', after: updated })

      return updated
    })
  }

  async function recordGuardNotified({ companyId, actorId, attemptId, communicationMethod, notes }) {
    const rows = await prisma.$queryRaw`
      UPDATE dispatch_exit_attempt SET
        communication_method = ${communicationMethod}, guard_notified_at = NOW(),
        notes = ${notes ?? null}, updated_at = NOW()
      WHERE id = ${attemptId}::uuid AND company_id = ${companyId}::uuid
      RETURNING *
    `
    const updated = rows[0]
    if (!updated) throw new DispatchServiceError('Intento de salida no encontrado.', 404, 'EXIT_ATTEMPT_NOT_FOUND')

    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: MODULE_KEY,
        entityType: 'dispatch.exit_attempt',
        entityId: attemptId,
        action: 'exit_attempt.guard_notified',
        before: null,
        after: JSON.stringify(updated),
        metadata: null,
      },
    })
    await writeEvent(prisma, {
      companyId, ticketId: updated.ticket_id, eventType: 'GUARD_NOTIFICATION_RECORDED', actorId, attemptId,
      metadata: { communication_method: communicationMethod },
    })

    return updated
  }

  return { scanGate, listPendingExits, getExit, approveExit, rejectExit, recordGuardNotified }
}
