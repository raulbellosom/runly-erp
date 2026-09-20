import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createProjectsCalendarBridge } from '../projects-calendar-bridge.js'

function makeCalendarPrisma(overrides = {}) {
  const calendars = {}
  const shares = {}
  const events = {}
  const tasks = {}
  return {
    calendarCalendar: {
      create: async (args) => {
        const c = { id: 'cal-1', ...args.data }
        calendars[c.id] = c
        return c
      },
      // grantMemberCalendarAccess looks up the owner to skip redundant self-shares.
      findFirst: async ({ where }) => calendars[where.id] ?? { id: where.id, ownerId: 'owner-user' },
      update: async ({ where, data }) => ({ id: where.id, ...data }),
    },
    calendarShare: {
      findFirst: async ({ where }) =>
        Object.values(shares).find((s) => s.calendarId === where.calendarId && s.userId === where.userId) ?? null,
      create: async (args) => {
        const s = { id: 'share-1', ...args.data }
        shares[s.id] = s
        return s
      },
      deleteMany: async () => {},
    },
    calendarEvent: {
      create: async (args) => {
        const e = { id: 'event-1', ...args.data }
        events[e.id] = e
        return e
      },
      update: async ({ where, data }) => ({ id: where.id, ...data }),
      delete: async () => {},
    },
    project: {
      update: async ({ where, data }) => ({ id: where.id, ...data }),
    },
    task: {
      update: async ({ where, data }) => {
        tasks[where.id] = { ...(tasks[where.id] ?? {}), ...data }
        return tasks[where.id]
      },
    },
    ...overrides,
  }
}

function makeNoPrisma() {
  return {}  // No calendarCalendar property — simulates atlas.calendar not installed
}

describe('createProjectsCalendarBridge', () => {
  describe('syncProjectCalendar', () => {
    it('creates a CalendarCalendar and updates project.calendarId', async () => {
      let updatedProject = null
      const prisma = {
        ...makeCalendarPrisma(),
        project: {
          update: async ({ where, data }) => { updatedProject = { id: where.id, ...data }; return updatedProject },
        },
      }
      const bridge = createProjectsCalendarBridge({ prisma })
      const calId = await bridge.syncProjectCalendar({ id: 'proj-1', ownerId: 'user-1', name: 'Mi Proyecto', color: '#6366f1' })
      assert.ok(calId, 'Returns calendar id')
      assert.equal(updatedProject?.calendarId, calId)
    })

    it('returns null silently when atlas.calendar is not installed', async () => {
      const bridge = createProjectsCalendarBridge({ prisma: makeNoPrisma() })
      const calId = await bridge.syncProjectCalendar({ id: 'proj-1', ownerId: 'user-1', name: 'P', color: null })
      assert.equal(calId, null)
    })
  })

  describe('grantMemberCalendarAccess', () => {
    it('creates a CalendarShare for the new member', async () => {
      let created = null
      const prisma = {
        ...makeCalendarPrisma(),
        calendarShare: {
          ...makeCalendarPrisma().calendarShare,
          create: async (args) => { created = args.data; return { id: 'share-1', ...args.data } },
        },
      }
      const bridge = createProjectsCalendarBridge({ prisma })
      await bridge.grantMemberCalendarAccess('cal-1', 'user-2')
      assert.equal(created?.calendarId, 'cal-1')
      assert.equal(created?.userId, 'user-2')
      assert.equal(created?.role, 'VIEWER')
    })

    it('does nothing when calendarId is null', async () => {
      let called = false
      const prisma = {
        ...makeCalendarPrisma(),
        calendarShare: { ...makeCalendarPrisma().calendarShare, create: async () => { called = true } },
      }
      const bridge = createProjectsCalendarBridge({ prisma })
      await bridge.grantMemberCalendarAccess(null, 'user-2')
      assert.equal(called, false)
    })
  })

  describe('syncTaskEvent', () => {
    it('creates a CalendarEvent with sourceModule=runly.projects when task has dueDate', async () => {
      let created = null
      const prisma = {
        ...makeCalendarPrisma(),
        calendarEvent: {
          ...makeCalendarPrisma().calendarEvent,
          create: async (args) => { created = args.data; return { id: 'event-1', ...args.data } },
        },
      }
      const bridge = createProjectsCalendarBridge({ prisma })
      const task = { id: 'task-1', title: 'Entrega', dueDate: new Date('2026-07-01'), startDate: null, calendarEventId: null }
      await bridge.syncTaskEvent(task, 'cal-1')
      assert.equal(created?.sourceModule, 'runly.projects')
      assert.equal(created?.sourceEntityId, 'task-1')
      assert.equal(created?.calendarId, 'cal-1')
    })

    it('returns null when no dueDate', async () => {
      const bridge = createProjectsCalendarBridge({ prisma: makeCalendarPrisma() })
      const result = await bridge.syncTaskEvent(
        { id: 'task-1', title: 'T', dueDate: null, startDate: null, calendarEventId: null },
        'cal-1'
      )
      assert.equal(result, null)
    })
  })
})
