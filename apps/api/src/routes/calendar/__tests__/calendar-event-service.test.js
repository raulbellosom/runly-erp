import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createCalendarEventService,
  normalizeRecurrenceRule,
} from '../calendar-event-service.js'
import { CalendarServiceError } from '../calendar-service.js'

function makePrisma(overrides = {}) {
  return {
    calendarCalendar: {
      findMany: async () => [{ id: 'cal-1' }],
      findFirst: async () => ({ id: 'cal-1', ownerId: 'user-1', companyId: 'company-1' }),
      ...(overrides.calendarCalendar ?? {}),
    },
    calendarShare: {
      findMany: async () => [],
      findFirst: async () => null,
      ...(overrides.calendarShare ?? {}),
    },
    calendarEvent: {
      findFirst: async () => ({
        id: 'evt-1',
        calendarId: 'cal-1',
        title: 'Evento importado',
        startAt: new Date('2026-06-08T10:00:00.000Z'),
        enabled: true,
        calendar: {
          id: 'cal-1',
          ownerId: 'user-1',
        },
      }),
      create: async ({ data }) => ({ id: 'evt-new', ...data }),
      update: async ({ where, data }) => ({ id: where.id, ...data }),
      ...(overrides.calendarEvent ?? {}),
    },
    googleCalendarEventLink: {
      findFirst: async () => null,
      update: async ({ where, data }) => ({ id: where.id, ...data }),
      ...(overrides.googleCalendarEventLink ?? {}),
    },
    calendarReminder: {
      updateMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
      ...(overrides.calendarReminder ?? {}),
    },
    calendarEventAttendee: {
      create: async ({ data }) => ({ id: 'att-1', ...data }),
      createMany: async () => ({ count: 0 }),
      ...(overrides.calendarEventAttendee ?? {}),
    },
    // Default: candidate users all share company-1 with the actor.
    membership: {
      findFirst: async ({ where }) => where.userId === 'outsider' ? null : { id: 'member', role: { key: 'runly.admin' } },
      findMany: async ({ where }) => {
        if (where?.userId?.in) {
          return where.userId.in.map((userId) => ({ userId, companyId: 'company-1' }))
        }
        return [{ companyId: 'company-1' }]
      },
      ...(overrides.membership ?? {}),
    },
    $transaction: async (fn, prismaRef) => fn(prismaRef ?? makePrisma(overrides)),
  }
}

describe('calendar-event-service', () => {
  it('marks an imported event as detached when the event is edited locally', async () => {
    let detachUpdate = null
    const svc = createCalendarEventService({
      prisma: makePrisma({
        googleCalendarEventLink: {
          findFirst: async () => ({
            id: 'glink-1',
            atlasEventId: 'evt-1',
            isDetached: false,
          }),
          update: async ({ data }) => {
            detachUpdate = data
            return { id: 'glink-1', ...data }
          },
        },
      }),
    })

    await svc.updateEvent('user-1', 'evt-1', { title: 'Cambio local' })

    assert.equal(detachUpdate.isDetached, true)
    assert.ok(detachUpdate.detachedAt instanceof Date)
  })

  describe('normalizeRecurrenceRule', () => {
    it('returns null for no rule', () => {
      assert.equal(normalizeRecurrenceRule(null), null)
      assert.equal(normalizeRecurrenceRule(undefined), null)
    })

    it('rejects an unknown frequency', () => {
      assert.throws(
        () => normalizeRecurrenceRule({ freq: 'HOURLY' }),
        (e) => e instanceof CalendarServiceError && e.status === 400,
      )
    })

    it('rejects a count above the cap', () => {
      assert.throws(
        () => normalizeRecurrenceRule({ freq: 'DAILY', count: 100000 }),
        (e) => e instanceof CalendarServiceError && e.status === 400,
      )
    })

    it('rejects interval < 1', () => {
      assert.throws(
        () => normalizeRecurrenceRule({ freq: 'DAILY', interval: 0 }),
        (e) => e instanceof CalendarServiceError && e.status === 400,
      )
    })

    it('normalizes a valid rule', () => {
      const r = normalizeRecurrenceRule({ freq: 'weekly', interval: 2, count: 10 })
      assert.deepEqual(r, { freq: 'WEEKLY', interval: 2, count: 10 })
    })
  })

  describe('createEvent recurrence + attendee guards', () => {
    it('throws 400 when createEvent is given an oversized recurrence count', async () => {
      const svc = createCalendarEventService({ prisma: makePrisma() })
      await assert.rejects(
        () =>
          svc.createEvent('user-1', {
            calendarId: 'cal-1',
            title: 'X',
            startAt: '2026-06-01T00:00:00Z',
            recurrenceRule: { freq: 'DAILY', count: 999999 },
          }),
        (e) => e instanceof CalendarServiceError && e.status === 400,
      )
    })

    it('rejects the whole operation when any attendee is outside the calendar company', async () => {
      let insertedAttendees = null
      const prisma = makePrisma({
        calendarEventAttendee: {
          create: async ({ data }) => ({ id: 'att-1', ...data }),
          createMany: async ({ data }) => { insertedAttendees = data; return { count: data.length } },
        },
        membership: {
          findMany: async ({ where }) => {
            if (where?.userId?.in) {
              // only 'peer' is in company-1; 'outsider' is not
              return where.userId.in
                .filter((id) => id === 'peer')
                .map((id) => ({ userId: id, companyId: 'company-1' }))
            }
            return [{ companyId: 'company-1' }]
          },
        },
      })
      const svc = createCalendarEventService({ prisma })
      await assert.rejects(svc.createEvent('user-1', {
        calendarId: 'cal-1', title: 'X', startAt: '2026-06-01T00:00:00Z', attendeeIds: ['peer', 'outsider'],
      }), { status: 404 })
      assert.equal(insertedAttendees, null)
    })
  })

  describe('addAttendee company guard', () => {
    it('throws 404 when the attendee is not a company peer', async () => {
      const prisma = makePrisma({
        membership: {
          findMany: async ({ where }) => {
            if (where?.userId?.in) return [] // no peer match
            return [{ companyId: 'company-1' }]
          },
        },
      })
      const svc = createCalendarEventService({ prisma })
      await assert.rejects(
        () => svc.addAttendee('user-1', 'evt-1', 'outsider'),
        (e) => e.status === 404,
      )
    })
  })
})
