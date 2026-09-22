import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createCalendarIcsImportService } from '../calendar-ics-import-service.js'
import { CalendarServiceError } from '../calendar-service.js'

const SIMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Trabajo
BEGIN:VEVENT
UID:simple-1@acalendar
DTSTAMP:20260901T120000Z
DTSTART:20260925T150000Z
DTEND:20260925T160000Z
SUMMARY:Reunion con cliente
LOCATION:Oficina
DESCRIPTION:Revisar contrato
END:VEVENT
END:VCALENDAR
`

const RECURRING_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:weekly-1@acalendar
DTSTAMP:20260901T120000Z
DTSTART:20260901T090000Z
DTEND:20260901T093000Z
SUMMARY:Standup semanal
RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=4
EXDATE:20260908T090000Z
END:VEVENT
END:VCALENDAR
`

const MALFORMED_ICS = `not an ics file at all`

function makePrisma({ existingCalendar = { id: 'cal-1', ownerId: 'user-1', enabled: true }, existingUids = [] } = {}) {
  const createdEvents = []
  const createdSources = [...existingUids.map((externalUid) => ({ calendarId: 'cal-1', externalUid }))]
  return {
    calendarCalendar: {
      findFirst: async () => existingCalendar,
      create: async ({ data }) => ({ id: 'cal-new', ...data }),
    },
    calendarShare: {
      findFirst: async () => null,
    },
    calendarEvent: {
      create: async ({ data }) => {
        const event = { id: `event-${createdEvents.length + 1}`, ...data }
        createdEvents.push(event)
        return event
      },
    },
    calendarEventImportSource: {
      findFirst: async ({ where }) =>
        createdSources.find((s) => s.calendarId === where.calendarId && s.externalUid === where.externalUid) ?? null,
      create: async ({ data }) => {
        createdSources.push(data)
        return { id: `src-${createdSources.length}`, ...data }
      },
    },
    _createdEvents: createdEvents,
  }
}

describe('calendar-ics-import-service', () => {
  it('imports a single non-recurring event', async () => {
    const prisma = makePrisma()
    const svc = createCalendarIcsImportService({ prisma })
    const result = await svc.importIcs({
      userId: 'user-1',
      companyId: 'company-1',
      calendarId: 'cal-1',
      fileBuffer: Buffer.from(SIMPLE_ICS),
    })
    assert.equal(result.imported, 1)
    assert.equal(result.duplicates, 0)
    assert.equal(prisma._createdEvents[0].title, 'Reunion con cliente')
    assert.equal(prisma._createdEvents[0].location, 'Oficina')
    assert.equal(prisma._createdEvents[0].startAt.toISOString(), '2026-09-25T15:00:00.000Z')
  })

  it('expands a weekly recurrence into individual events, honouring EXDATE', async () => {
    const prisma = makePrisma()
    const svc = createCalendarIcsImportService({ prisma })
    const result = await svc.importIcs({
      userId: 'user-1',
      companyId: 'company-1',
      calendarId: 'cal-1',
      fileBuffer: Buffer.from(RECURRING_ICS),
    })
    // COUNT=4 minus the one EXDATE-excluded occurrence
    assert.equal(result.imported, 3)
    assert.equal(prisma._createdEvents.length, 3)
    // Each instance keeps the original 09:00 UTC time-of-day (regression
    // guard for node-ical's rrule.between() timezone-shift bug).
    for (const event of prisma._createdEvents) {
      assert.equal(event.startAt.getUTCHours(), 9)
    }
  })

  it('skips events already imported into the same calendar (dedup)', async () => {
    const prisma = makePrisma({ existingUids: ['simple-1@acalendar:2026-09-25'] })
    const svc = createCalendarIcsImportService({ prisma })
    const result = await svc.importIcs({
      userId: 'user-1',
      companyId: 'company-1',
      calendarId: 'cal-1',
      fileBuffer: Buffer.from(SIMPLE_ICS),
    })
    assert.equal(result.imported, 0)
    assert.equal(result.duplicates, 1)
  })

  it('rejects a calendarId the user cannot write to', async () => {
    const prisma = makePrisma({ existingCalendar: { id: 'cal-1', ownerId: 'someone-else', enabled: true } })
    const svc = createCalendarIcsImportService({ prisma })
    await assert.rejects(
      () => svc.importIcs({ userId: 'user-1', companyId: 'company-1', calendarId: 'cal-1', fileBuffer: Buffer.from(SIMPLE_ICS) }),
      (e) => e instanceof CalendarServiceError && e.status === 403,
    )
  })

  it('rejects a malformed file without throwing an unhandled error', async () => {
    const prisma = makePrisma()
    const svc = createCalendarIcsImportService({ prisma })
    await assert.rejects(
      () => svc.importIcs({ userId: 'user-1', companyId: 'company-1', calendarId: 'cal-1', fileBuffer: Buffer.from(MALFORMED_ICS) }),
      (e) => e instanceof CalendarServiceError && e.status === 400,
    )
  })

  it('creates a new calendar when no calendarId is given, using the .ics X-WR-CALNAME', async () => {
    const prisma = makePrisma()
    const svc = createCalendarIcsImportService({ prisma })
    const result = await svc.importIcs({
      userId: 'user-1',
      companyId: 'company-1',
      calendarId: null,
      fileBuffer: Buffer.from(SIMPLE_ICS),
    })
    assert.equal(result.calendarId, 'cal-new')
  })
})
