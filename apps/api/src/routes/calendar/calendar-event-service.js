import { createUserAccessService } from '../../services/user-access-service.js'
import { CalendarServiceError } from './calendar-service.js'

const RECURRENCE_FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']
const MAX_RECURRENCE_COUNT = 366
const MAX_RECURRENCE_INTERVAL = 999

// Validates and clamps a client-supplied recurrence rule before it is stored.
// Returns null for "no recurrence"; throws CalendarServiceError(400) on garbage.
// Guards expandRecurrence() (run on every listEvents call) against unbounded
// instance generation.
export function normalizeRecurrenceRule(rule) {
  if (rule === null || rule === undefined) return null
  if (typeof rule !== 'object') {
    throw new CalendarServiceError('Regla de recurrencia invalida.', 400)
  }
  const freq = String(rule.freq ?? '').toUpperCase()
  if (!RECURRENCE_FREQS.includes(freq)) {
    throw new CalendarServiceError('Frecuencia de recurrencia invalida.', 400)
  }
  const normalized = { freq }

  if (rule.interval !== undefined) {
    const interval = Number(rule.interval)
    if (!Number.isInteger(interval) || interval < 1 || interval > MAX_RECURRENCE_INTERVAL) {
      throw new CalendarServiceError('El intervalo de recurrencia debe estar entre 1 y 999.', 400)
    }
    normalized.interval = interval
  }

  if (rule.count !== undefined && rule.count !== null) {
    const count = Number(rule.count)
    if (!Number.isInteger(count) || count < 1 || count > MAX_RECURRENCE_COUNT) {
      throw new CalendarServiceError(`El numero de repeticiones debe estar entre 1 y ${MAX_RECURRENCE_COUNT}.`, 400)
    }
    normalized.count = count
  }

  if (rule.until !== undefined && rule.until !== null && rule.until !== '') {
    const untilMs = new Date(rule.until).getTime()
    if (Number.isNaN(untilMs)) {
      throw new CalendarServiceError('La fecha limite de recurrencia es invalida.', 400)
    }
    normalized.until = new Date(untilMs).toISOString()
  }

  return normalized
}

function expandRecurrence(event, rangeStart, rangeEnd) {
  const rule = event.recurrenceRule
  if (!rule) return []

  const { freq, interval = 1, until, count } = rule
  if (!RECURRENCE_FREQS.includes(freq)) return []
  const safeInterval = Number.isInteger(interval) && interval >= 1 ? interval : 1

  const instances = []
  const start = new Date(event.startAt)
  const duration = event.endAt ? new Date(event.endAt) - start : 60 * 60 * 1000
  const rangeStartMs = new Date(rangeStart).getTime()
  const rangeEndMs = new Date(rangeEnd).getTime()
  const untilMs = until ? new Date(until).getTime() : Infinity
  // Hard cap regardless of what got persisted before validation existed.
  const maxInstances = Math.min(
    Number.isInteger(count) && count > 0 ? count : MAX_RECURRENCE_COUNT,
    MAX_RECURRENCE_COUNT,
  )

  let current = new Date(start)
  let generated = 0

  while (current.getTime() <= rangeEndMs && current.getTime() <= untilMs && generated < maxInstances) {
    if (current.getTime() >= rangeStartMs) {
      const instanceEnd = new Date(current.getTime() + duration)
      instances.push({
        ...event,
        // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: internal recurrence-instance id, UTC keeps it stable across zone config
        id: `${event.id}_${current.toISOString().slice(0, 10).replace(/-/g, '')}`,
        startAt: new Date(current),
        endAt: instanceEnd,
        _isRecurrenceInstance: true,
        _baseEventId: event.id,
      })
      generated++
    }

    if (freq === 'DAILY') {
      current = new Date(current.getTime() + safeInterval * 24 * 60 * 60 * 1000)
    } else if (freq === 'WEEKLY') {
      current = new Date(current.getTime() + safeInterval * 7 * 24 * 60 * 60 * 1000)
    } else if (freq === 'MONTHLY') {
      const next = new Date(current)
      next.setMonth(next.getMonth() + safeInterval)
      current = next
    } else if (freq === 'YEARLY') {
      const next = new Date(current)
      next.setFullYear(next.getFullYear() + safeInterval)
      current = next
    } else {
      break
    }
  }

  return instances
}

export function createCalendarEventService({ prisma }) {
  async function getAccessibleCalendarIds(userId, companyId) {
    const scope = { OR: [{ companyId: null }, { ...(companyId ? { companyId } : {}), company: { enabled: true, memberships: { some: { userId, enabled: true, user: { enabled: true } } } } }] }
    const owned = await prisma.calendarCalendar.findMany({
      where: { ownerId: userId, enabled: true, ...scope },
      select: { id: true },
    })
    const shared = await prisma.calendarShare.findMany({
      where: { userId, calendar: { enabled: true, ...scope } },
      select: { calendarId: true },
    })
    return [
      ...owned.map((c) => c.id),
      ...shared.map((s) => s.calendarId),
    ]
  }

  // Returns the subset of candidateIds that share a company with actingUserId
  // (plus the acting user themselves). Blocks adding out-of-company attendees.
  async function filterCompanyPeers(actingUserId, candidateIds, calendarId) {
    const ids = [...new Set((candidateIds ?? []).filter(Boolean))]
    if (!ids.length) return []
    const calendar = await prisma.calendarCalendar.findFirst({ where: { id: calendarId, enabled: true }, select: { companyId: true } })
    const access = createUserAccessService({ prisma })
    await access.assertCompanyMember(calendar?.companyId, actingUserId)
    return access.assertCandidates({ companyId: calendar.companyId, userIds: ids })
  }

  async function listEvents({ userId, companyId, start, end, calendarIds, sourceModule, sourceEntityId }) {
    if (!start || !end) throw new CalendarServiceError('start y end son requeridos.', 400)

    const accessibleIds = await getAccessibleCalendarIds(userId, companyId)
    const filterIds = calendarIds?.length
      ? calendarIds.filter((id) => accessibleIds.includes(id))
      : accessibleIds

    if (!filterIds.length) return []

    // Fetch all events that could produce instances in the range:
    // - non-recurring: startAt in [start, end] (filtered in JS below)
    // - recurring: startAt <= end (any series that could have future instances)
    // We avoid JSON-field null filtering (not supported in Prisma 7 Json columns)
    // by fetching all events with startAt <= end and filtering non-recurring ones in JS.
    const events = await prisma.calendarEvent.findMany({
      where: {
        calendarId: { in: filterIds },
        enabled: true,
        startAt: { lte: new Date(end) },
        ...(sourceModule ? { sourceModule } : {}),
        ...(sourceEntityId ? { sourceEntityId } : {}),
      },
      include: {
        calendar: { select: { id: true, name: true, color: true, ownerId: true } },
        attendees: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
        reminders: {
          where: { userId },
          select: { id: true, minutesBefore: true, sentAt: true },
          orderBy: [{ minutesBefore: 'asc' }],
        },
      },
      orderBy: { startAt: 'asc' },
    })

    const rangeStartMs = new Date(start).getTime()
    const result = []
    for (const event of events) {
      if (!event.recurrenceRule) {
        // Non-recurring: include only if startAt is within [start, end]
        if (new Date(event.startAt).getTime() >= rangeStartMs) {
          result.push(event)
        }
      } else {
        const instances = expandRecurrence(event, start, end)
        result.push(...instances)
      }
    }

    return result.sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
  }

  async function getEvent(userId, eventId) {
    const accessibleIds = await getAccessibleCalendarIds(userId)
    const event = await prisma.calendarEvent.findFirst({
      where: { id: eventId, calendarId: { in: accessibleIds }, enabled: true },
      include: {
        calendar: { select: { id: true, name: true, color: true, ownerId: true } },
        attendees: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
        reminders: {
          where: { userId },
          select: { id: true, minutesBefore: true, sentAt: true },
          orderBy: [{ minutesBefore: 'asc' }],
        },
        files: { include: { fileAsset: { select: { id: true, originalName: true, mimeType: true } } } },
      },
    })
    if (!event) throw new CalendarServiceError('Evento no encontrado.', 404)
    return event
  }

  async function createEvent(userId, data) {
    const {
      calendarId, title, description, startAt, endAt, allDay,
      location, videoUrl, color, recurrenceRule,
      sourceModule, sourceEntityId,
      attendeeIds, reminderMinutes,
    } = data

    if (!title?.trim()) throw new CalendarServiceError('El titulo es requerido.', 400)
    if (!startAt) throw new CalendarServiceError('La fecha de inicio es requerida.', 400)
    if (!calendarId) throw new CalendarServiceError('El calendario es requerido.', 400)

    const accessible = await getAccessibleCalendarIds(userId)
    if (!accessible.includes(calendarId)) throw new CalendarServiceError('No tienes acceso a ese calendario.', 403)

    const calendar = await prisma.calendarCalendar.findFirst({ where: { id: calendarId, enabled: true }, select: { ownerId: true } })
    const grant = calendar?.ownerId === userId || await prisma.calendarShare.findFirst({ where: { calendarId, userId, role: { in: ['EDITOR', 'MANAGER'] } }, select: { id: true } })
    if (!grant) throw new CalendarServiceError('Recurso no encontrado.', 404)
    const normalizedRecurrence = normalizeRecurrenceRule(recurrenceRule)
    const validAttendeeIds = await filterCompanyPeers(userId, attendeeIds, calendarId)

    // Event row + its attendees + reminders are written atomically.
    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.calendarEvent.create({
        data: {
          calendarId,
          title: title.trim(),
          description: description?.trim() ?? null,
          startAt: new Date(startAt),
          endAt: endAt ? new Date(endAt) : null,
          allDay: allDay ?? false,
          location: location?.trim() ?? null,
          videoUrl: videoUrl?.trim() ?? null,
          color: color ?? null,
          recurrenceRule: normalizedRecurrence,
          sourceModule: sourceModule ?? null,
          sourceEntityId: sourceEntityId ?? null,
        },
      })
      if (validAttendeeIds.length) {
        await tx.calendarEventAttendee.createMany({
          data: validAttendeeIds.map((uid) => ({ eventId: created.id, userId: uid })),
          skipDuplicates: true,
        })
      }
      if (reminderMinutes?.length) {
        await tx.calendarReminder.createMany({
          data: reminderMinutes
            .map((min) => Number(min))
            .filter((min) => Number.isFinite(min) && min >= 0)
            .map((min) => ({ eventId: created.id, userId, minutesBefore: min })),
          skipDuplicates: true,
        })
      }
      return created
    })

    return getEvent(userId, event.id)
  }

  async function updateEvent(userId, eventId, data) {
    const accessible = await getAccessibleCalendarIds(userId)
    const event = await prisma.calendarEvent.findFirst({
      where: { id: eventId, calendarId: { in: accessible }, enabled: true },
      include: { calendar: true },
    })
    if (!event) throw new CalendarServiceError('Evento no encontrado.', 404)

    const isOwner = event.calendar.ownerId === userId
    const share = await prisma.calendarShare.findFirst({ where: { calendarId: event.calendarId, userId } })
    const canEdit = isOwner || share?.role === 'EDITOR' || share?.role === 'MANAGER'
    if (!canEdit) throw new CalendarServiceError('No tienes permiso para editar este evento.', 403)

    const updateData = {}
    if (data.calendarId !== undefined && data.calendarId !== event.calendarId) {
      if (!accessible.includes(data.calendarId)) throw new CalendarServiceError('No tienes acceso al calendario destino.', 403)
      const destination = await prisma.calendarCalendar.findFirst({ where: { id: data.calendarId, enabled: true } })
      if (!destination || destination.companyId !== event.calendar.companyId) throw new CalendarServiceError('Calendario no disponible.', 404)
      const destinationShare = await prisma.calendarShare.findFirst({ where: { calendarId: data.calendarId, userId } })
      if (destination.ownerId !== userId && !['EDITOR', 'MANAGER'].includes(destinationShare?.role)) throw new CalendarServiceError('Calendario no disponible.', 404)
      updateData.calendarId = data.calendarId
    }
    if (data.title !== undefined) updateData.title = data.title.trim()
    if (data.description !== undefined) updateData.description = data.description?.trim() ?? null
    if (data.startAt !== undefined) updateData.startAt = new Date(data.startAt)
    if (data.endAt !== undefined) updateData.endAt = data.endAt ? new Date(data.endAt) : null
    if (data.allDay !== undefined) updateData.allDay = data.allDay
    if (data.location !== undefined) updateData.location = data.location?.trim() ?? null
    if (data.videoUrl !== undefined) updateData.videoUrl = data.videoUrl?.trim() ?? null
    if (data.color !== undefined) updateData.color = data.color ?? null
    if (data.recurrenceRule !== undefined) updateData.recurrenceRule = normalizeRecurrenceRule(data.recurrenceRule)

    const importedLink = await prisma.googleCalendarEventLink.findFirst({
      where: { atlasEventId: eventId },
    })

    await prisma.calendarEvent.update({ where: { id: eventId }, data: updateData })

    const startAtChanged =
      updateData.startAt instanceof Date &&
      Number(updateData.startAt.getTime()) !== Number(new Date(event.startAt).getTime())

    // If the schedule changed, re-arm reminders so they can fire again at the new time.
    if (startAtChanged) {
      await prisma.calendarReminder.updateMany({
        where: { eventId },
        data: { sentAt: null },
      })
    }

    if (importedLink && !importedLink.isDetached && Object.keys(updateData).length > 0) {
      await prisma.googleCalendarEventLink.update({
        where: { id: importedLink.id },
        data: {
          isDetached: true,
          detachedAt: new Date(),
        },
      })
    }

    return getEvent(userId, eventId)
  }

  async function deleteEvent(userId, eventId) {
    const accessible = await getAccessibleCalendarIds(userId)
    const event = await prisma.calendarEvent.findFirst({
      where: { id: eventId, calendarId: { in: accessible }, enabled: true },
      include: { calendar: true },
    })
    if (!event) throw new CalendarServiceError('Evento no encontrado.', 404)

    const isOwner = event.calendar.ownerId === userId
    const share = await prisma.calendarShare.findFirst({ where: { calendarId: event.calendarId, userId } })
    const canDelete = isOwner || share?.role === 'MANAGER'
    if (!canDelete) throw new CalendarServiceError('No tienes permiso para eliminar este evento.', 403)

    await prisma.calendarEvent.update({ where: { id: eventId }, data: { enabled: false } })
  }

  async function addAttendee(userId, eventId, attendeeUserId) {
    const accessible = await getAccessibleCalendarIds(userId)
    const event = await prisma.calendarEvent.findFirst({
      where: { id: eventId, calendarId: { in: accessible }, enabled: true },
      include: { calendar: true },
    })
    if (!event) throw new CalendarServiceError('Evento no encontrado.', 404)

    const isOwner = event.calendar.ownerId === userId
    const share = await prisma.calendarShare.findFirst({ where: { calendarId: event.calendarId, userId } })
    if (!isOwner && share?.role !== 'MANAGER') {
      throw new CalendarServiceError('No tienes permiso para agregar invitados.', 403)
    }

    const [peer] = await filterCompanyPeers(userId, [attendeeUserId], event.calendarId)
    if (peer !== attendeeUserId) {
      throw new CalendarServiceError('Solo puedes invitar a usuarios de tu empresa.', 403)
    }

    try {
      return await prisma.calendarEventAttendee.create({ data: { eventId, userId: attendeeUserId } })
    } catch (err) {
      if (err?.code === 'P2002') throw new CalendarServiceError('El usuario ya es invitado.', 409)
      throw err
    }
  }

  async function updateAttendeeStatus(userId, eventId, attendeeId, status) {
    const validStatuses = ['ACCEPTED', 'DECLINED', 'PENDING']
    if (!validStatuses.includes(status)) throw new CalendarServiceError('Estado invalido.', 400)

    const attendee = await prisma.calendarEventAttendee.findFirst({
      where: { id: attendeeId, eventId, userId },
    })
    if (!attendee) throw new CalendarServiceError('Invitado no encontrado.', 404)
    return prisma.calendarEventAttendee.update({ where: { id: attendeeId }, data: { status } })
  }

  async function addReminder(userId, eventId, minutesBefore) {
    if (!Number.isFinite(minutesBefore) || minutesBefore < 0) {
      throw new CalendarServiceError('minutesBefore debe ser un numero positivo.', 400)
    }
    try {
      return await prisma.calendarReminder.create({ data: { eventId, userId, minutesBefore } })
    } catch (err) {
      if (err?.code === 'P2002') throw new CalendarServiceError('Ya existe ese recordatorio.', 409)
      throw err
    }
  }

  async function deleteReminder(userId, eventId, reminderId) {
    const reminder = await prisma.calendarReminder.findFirst({ where: { id: reminderId, eventId, userId } })
    if (!reminder) throw new CalendarServiceError('Recordatorio no encontrado.', 404)
    await prisma.calendarReminder.delete({ where: { id: reminderId } })
  }

  return {
    listEvents,
    getEvent,
    createEvent,
    updateEvent,
    deleteEvent,
    addAttendee,
    updateAttendeeStatus,
    addReminder,
    deleteReminder,
  }
}
