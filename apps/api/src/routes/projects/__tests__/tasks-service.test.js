import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTasksService, TaskServiceError } from '../tasks-service.js'

function makePrisma(overrides = {}) {
  const tasks = {}
  return {
    task: {
      create: async (args) => {
        const t = { id: 'task-1', createdAt: new Date(), updatedAt: new Date(), ...args.data }
        tasks[t.id] = t
        return t
      },
      findFirst: async ({ where }) => tasks[where.id] ?? null,
      findMany: async () => Object.values(tasks),
      update: async ({ where, data }) => {
        tasks[where.id] = { ...tasks[where.id], ...data }
        return tasks[where.id]
      },
      updateMany: async () => {},
      delete: async ({ where }) => {
        const t = tasks[where.id]
        delete tasks[where.id]
        return t
      },
      deleteMany: async () => {},
    },
    taskStatus: {
      findFirst: async ({ where }) =>
        ['status-1', 'status-2'].includes(where?.id) ? { id: 'status-1', projectId: 'proj-1' } : null,
    },
    // createTask bumps the project's taskCounter inside a transaction.
    project: {
      findFirst: async () => ({ companyId: 'co-1' }),
      update: async () => ({ taskCounter: 1 }),
    },
    $transaction: async (fn) => fn(makePrisma(overrides)),
    ...overrides,
  }
}

describe('createTasksService', () => {
  describe('createTask', () => {
    it('creates task with trimmed title and calculated position', async () => {
      const svc = createTasksService({ prisma: makePrisma() })
      const task = await svc.createTask('proj-1', 'user-1', {
        title: '  Nueva tarea  ',
        statusId: 'status-1',
      })
      assert.equal(task.title, 'Nueva tarea')
      assert.equal(task.position, 0)
      assert.equal(task.createdBy, 'user-1')
    })

    it('throws 400 when title is empty', async () => {
      const svc = createTasksService({ prisma: makePrisma() })
      await assert.rejects(
        () => svc.createTask('proj-1', 'user-1', { title: '', statusId: 'status-1' }),
        (err) => { assert.ok(err instanceof TaskServiceError); assert.equal(err.status, 400); return true }
      )
    })

    it('throws 404 when status does not belong to project', async () => {
      const svc = createTasksService({ prisma: makePrisma() })
      await assert.rejects(
        () => svc.createTask('proj-1', 'user-1', { title: 'T', statusId: 'wrong-status' }),
        (err) => { assert.equal(err.status, 404); return true }
      )
    })

    it('assigns position 1 when a task already exists in the status', async () => {
      const prisma = makePrisma()
      // Pre-create a task at position 0
      await prisma.task.create({ data: { id: 'existing', projectId: 'proj-1', statusId: 'status-1', position: 0, title: 'Existing', createdBy: 'u', priority: 'NONE' } })
      const prismaWithLast = {
        ...prisma,
        task: {
          ...prisma.task,
          findFirst: async ({ where, orderBy }) => {
            if (orderBy?.position === 'desc') return { position: 0 }
            return prisma.task.findFirst({ where })
          },
        },
      }
      const svc = createTasksService({ prisma: prismaWithLast })
      const task = await svc.createTask('proj-1', 'user-1', { title: 'New', statusId: 'status-1' })
      assert.equal(task.position, 1)
    })
  })

  describe('deleteTask', () => {
    it('deletes subtasks before deleting the parent', async () => {
      let deletedSubtasks = false
      const prisma = makePrisma({
        task: {
          ...makePrisma().task,
          findFirst: async () => ({ id: 'task-1', projectId: 'proj-1', calendarEventId: null }),
          deleteMany: async ({ where }) => { if (where.parentTaskId === 'task-1') deletedSubtasks = true },
          delete: async () => ({ id: 'task-1' }),
        },
      })
      const svc = createTasksService({ prisma })
      await svc.deleteTask('task-1')
      assert.ok(deletedSubtasks, 'Subtasks were deleted before parent')
    })

    it('throws 404 when task not found', async () => {
      const svc = createTasksService({ prisma: makePrisma() })
      await assert.rejects(
        () => svc.deleteTask('nonexistent'),
        (err) => { assert.equal(err.status, 404); return true }
      )
    })
  })

  describe('moveTask', () => {
    it('updates statusId and position', async () => {
      const prisma = makePrisma()
      await prisma.task.create({ data: { id: 'task-1', projectId: 'proj-1', statusId: 'status-1', position: 0, title: 'T', createdBy: 'u', priority: 'NONE' } })
      const svc = createTasksService({ prisma })
      const moved = await svc.moveTask('task-1', { statusId: 'status-2', position: 0 })
      assert.equal(moved.statusId, 'status-2')
      assert.equal(moved.position, 0)
    })
  })
})
