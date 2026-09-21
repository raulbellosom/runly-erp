import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createProjectsService, ProjectServiceError, STATUS_TEMPLATES } from '../projects-service.js'

function makePrisma(overrides = {}) {
  const projects = {}
  const members = {}
  const statuses = {}
  return {
    project: {
      create: async (args) => {
        const p = { id: 'proj-1', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), ...args.data }
        projects[p.id] = p
        return p
      },
      findFirst: async ({ where }) => projects[where.id] ?? null,
      findMany: async () => Object.values(projects),
      update: async ({ where, data }) => {
        projects[where.id] = { ...projects[where.id], ...data }
        return projects[where.id]
      },
    },
    projectMember: {
      create: async (args) => ({ id: 'mem-1', ...args.data }),
      findFirst: async () => null,
      findMany: async () => [],
      deleteMany: async () => {},
    },
    taskStatus: {
      create: async (args) => ({ id: 'status-1', ...args.data }),
      createMany: async () => {},
      findFirst: async () => null,
      findMany: async () => [],
      update: async ({ where, data }) => ({ id: where.id, ...data }),
      delete: async () => {},
    },
    task: {
      updateMany: async () => {},
    },
    // addMember verifies the invitee shares the project's company.
    membership: {
      findFirst: async () => ({ id: 'membership-1', role: { key: 'runly.admin' } }),
      ...(overrides.membership ?? {}),
    },
    // createProject writes project + statuses + owner membership atomically.
    $transaction: async (fn) => fn(makePrisma(overrides)),
    ...overrides,
  }
}

describe('STATUS_TEMPLATES', () => {
  it('general template has 3 statuses with one default and one done', () => {
    const t = STATUS_TEMPLATES.general
    assert.equal(t.length, 3)
    assert.equal(t.filter((s) => s.isDefault).length, 1)
    assert.equal(t.filter((s) => s.isDone).length, 1)
  })

  it('all templates define at least one isDone status', () => {
    for (const [key, template] of Object.entries(STATUS_TEMPLATES)) {
      assert.ok(template.some((s) => s.isDone), `Template ${key} has no isDone status`)
    }
  })
})

describe('createProjectsService', () => {
  describe('createProject', () => {
    it('creates project with trimmed name and seeds statuses', async () => {
      let statusesCreated = null
      const prisma = makePrisma({
        taskStatus: {
          ...makePrisma().taskStatus,
          createMany: async (args) => { statusesCreated = args.data; return {} },
        },
      })
      const svc = createProjectsService({ prisma })
      const project = await svc.createProject('company-1', 'user-1', { name: '  Mi Proyecto  ' })
      assert.equal(project.name, 'Mi Proyecto')
      assert.ok(statusesCreated.length >= 3, 'Statuses seeded')
      assert.ok(statusesCreated.every((s) => s.projectId === project.id), 'All statuses linked to project')
    })

    it('throws 400 when name is empty', async () => {
      const svc = createProjectsService({ prisma: makePrisma() })
      await assert.rejects(
        () => svc.createProject('company-1', 'user-1', { name: '   ' }),
        (err) => { assert.ok(err instanceof ProjectServiceError); assert.equal(err.status, 400); return true }
      )
    })

    it('seeds statuses from specified template', async () => {
      let statusesCreated = null
      const prisma = makePrisma({
        taskStatus: {
          ...makePrisma().taskStatus,
          createMany: async (args) => { statusesCreated = args.data; return {} },
        },
      })
      const svc = createProjectsService({ prisma })
      await svc.createProject('company-1', 'user-1', { name: 'Ventas', template: 'ventas' })
      assert.equal(statusesCreated.length, STATUS_TEMPLATES.ventas.length)
    })

    it('falls back to general template for unknown template key', async () => {
      let statusesCreated = null
      const prisma = makePrisma({
        taskStatus: {
          ...makePrisma().taskStatus,
          createMany: async (args) => { statusesCreated = args.data; return {} },
        },
      })
      const svc = createProjectsService({ prisma })
      await svc.createProject('company-1', 'user-1', { name: 'X', template: 'unknown' })
      assert.equal(statusesCreated.length, STATUS_TEMPLATES.general.length)
    })
  })

  describe('archiveProject', () => {
    it('sets project status to ARCHIVED', async () => {
      const prisma = makePrisma()
      const proj = await prisma.project.create({ data: { id: 'proj-1', ownerId: 'user-1', name: 'P' } })
      const svc = createProjectsService({ prisma })
      const result = await svc.archiveProject('proj-1', 'user-1')
      assert.equal(result.status, 'ARCHIVED')
    })

    it('throws 403 when user is not owner', async () => {
      const prisma = makePrisma()
      await prisma.project.create({ data: { id: 'proj-1', ownerId: 'owner-id', name: 'P' } })
      const svc = createProjectsService({ prisma })
      await assert.rejects(
        () => svc.archiveProject('proj-1', 'other-user'),
        (err) => { assert.equal(err.status, 403); return true }
      )
    })
  })

  describe('addMember', () => {
    it('creates a project member with default MEMBER role', async () => {
      let created = null
      const prisma = makePrisma({
        projectMember: {
          ...makePrisma().projectMember,
          create: async (args) => { created = args.data; return { id: 'mem-1', ...args.data } },
        },
      })
      await prisma.project.create({ data: { id: 'proj-1', companyId: 'co-1', ownerId: 'owner-1', name: 'P' } })
      const svc = createProjectsService({ prisma })
      await svc.addMember('proj-1', 'owner-1', { userId: 'new-user' })
      assert.equal(created.role, 'MEMBER')
      assert.equal(created.userId, 'new-user')
    })

    it('throws 400 for invalid role', async () => {
      const prisma = makePrisma()
      await prisma.project.create({ data: { id: 'proj-1', companyId: 'co-1', ownerId: 'owner-1', name: 'P' } })
      const svc = createProjectsService({ prisma })
      await assert.rejects(
        () => svc.addMember('proj-1', 'owner-1', { userId: 'u', role: 'SUPERADMIN' }),
        (err) => { assert.equal(err.status, 400); return true }
      )
    })
  })

  describe('reorderStatuses', () => {
    function makeStatusPrisma(existingIds) {
      return {
        taskStatus: {
          findMany: async ({ where }) => existingIds
            .filter((id) => where.id.in.includes(id))
            .map((id) => ({ id })),
        },
        $transaction: async (arg) => {
          if (!Array.isArray(arg)) return arg(makeStatusPrisma(existingIds))
          return Promise.all(arg)
        },
      }
    }

    it('sets position = index for the given order', async () => {
      const applied = []
      const prisma = makeStatusPrisma(['s1', 's2', 's3'])
      prisma.taskStatus.update = async ({ where, data }) => { applied.push({ id: where.id, ...data }); return { id: where.id, ...data } }
      prisma.taskStatus.findMany = async () => [{ id: 's1' }, { id: 's2' }, { id: 's3' }]
      const svc = createProjectsService({ prisma })
      await svc.reorderStatuses('proj-1', ['s3', 's1', 's2'])
      assert.deepEqual(applied, [
        { id: 's3', position: 0 },
        { id: 's1', position: 1 },
        { id: 's2', position: 2 },
      ])
    })

    it('throws 400 when a status does not belong to the project', async () => {
      const prisma = makeStatusPrisma(['s1', 's2'])
      prisma.taskStatus.findMany = async () => [{ id: 's1' }]
      prisma.taskStatus.update = async () => { throw new Error('should not update') }
      const svc = createProjectsService({ prisma })
      await assert.rejects(
        () => svc.reorderStatuses('proj-1', ['s1', 'not-mine']),
        (err) => { assert.ok(err instanceof ProjectServiceError); assert.equal(err.status, 400); return true }
      )
    })
  })
})
