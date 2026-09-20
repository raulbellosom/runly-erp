import { createUserAccessService } from '../../services/user-access-service.js'
import { createProjectFilesService } from './project-files.js'
export class TaskServiceError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.name = 'TaskServiceError'
    this.status = status
  }
}

function toNoonUTC(val) {
  const str = String(val)
  const part = str.includes('T') ? str.slice(0, 10) : str
  return new Date(`${part}T12:00:00.000Z`)
}

const RRULE_PRESETS = {
  'FREQ=DAILY': (now) => new Date(now.getTime() + 24 * 60 * 60 * 1000),
  'FREQ=WEEKLY': (now) => new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
  'FREQ=WEEKLY;INTERVAL=2': (now) => new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
  'FREQ=MONTHLY': (now) => {
    const d = new Date(now)
    d.setMonth(d.getMonth() + 1)
    return d
  },
}

export function computeRruleNextAt(rrule) {
  const fn = RRULE_PRESETS[rrule]
  return fn ? fn(new Date()) : null
}

export function createTasksService({ prisma }) {
  const access = createUserAccessService({ prisma })
  const files = createProjectFilesService({ prisma })
  async function validateTargets(projectId, { assigneeId, parentTaskId, statusId }) {
    const project = await prisma.project.findFirst({ where: { id: projectId }, select: { companyId: true } })
    if (!project) throw new TaskServiceError('Recurso no encontrado.', 404)
    if (assigneeId) await access.assertCandidates({ companyId: project.companyId, userIds: [assigneeId], permission: 'projects.project.read', projectId })
    if (parentTaskId && !(await prisma.task.findFirst({ where: { id: parentTaskId, projectId }, select: { id: true } }))) throw new TaskServiceError('Recurso no encontrado.', 404)
    if (statusId && !(await prisma.taskStatus.findFirst({ where: { id: statusId, projectId }, select: { id: true } }))) throw new TaskServiceError('Recurso no encontrado.', 404)
  }

  async function listTasks(projectId, { companyId, actorId, statusId, assigneeId, priority, dueDateFrom, dueDateTo, parentTaskId, includeSubtasks } = {}) {
    const where = { projectId }
    if (statusId) where.statusId = statusId
    if (assigneeId) where.assigneeId = assigneeId
    if (priority) where.priority = priority
    if (dueDateFrom || dueDateTo) {
      where.dueDate = {}
      if (dueDateFrom) where.dueDate.gte = new Date(dueDateFrom)
      if (dueDateTo) where.dueDate.lte = new Date(dueDateTo)
    }
    if (!includeSubtasks) {
      where.parentTaskId = parentTaskId === undefined ? null : parentTaskId
    }
    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } },
        assignees: {
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } } },
          orderBy: { assignedAt: 'asc' },
        },
        status: true,
        parent: { select: { id: true, title: true } },
        _count: { select: { subtasks: true } },
      },
      orderBy: [{ statusId: 'asc' }, { position: 'asc' }],
    })

    if (tasks.length === 0) return tasks
    const taskIds = tasks.map(t => t.id)
    const attachments = await files.list({ companyId, taskIds, actorId })
    const countById = {}
    for (const file of attachments) {
      const id = file.entityId === companyId ? file.metadata?.sourceEntityId : file.entityId
      countById[id] = (countById[id] ?? 0) + 1
    }
    return tasks.map(t => ({ ...t, _count: { ...t._count, attachments: countById[t.id] ?? 0 } }))
  }

  async function getTask(taskId, { projectId, companyId, actorId }) {
    if (!projectId || !companyId) throw new TaskServiceError('Tarea no encontrada.', 404)
    const task = await prisma.task.findFirst({
      where: { id: taskId, projectId, project: { companyId } },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } },
        assignees: {
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } } },
          orderBy: { assignedAt: 'asc' },
        },
        status: true,
        subtasks: {
          include: {
            assignee: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } },
            assignees: {
              include: { user: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } } },
            },
          },
          orderBy: { position: 'asc' },
        },
        parent: { select: { id: true, title: true } },
        fieldValues: { include: { field: true }, orderBy: { field: { position: 'asc' } } },
        blockedBy: {
          where: { blocker: { projectId } },
          include: { blocker: { select: { id: true, title: true, taskNumber: true, statusId: true } } },
          orderBy: { createdAt: 'asc' },
        },
        blocking: {
          where: { blocked: { projectId } },
          include: { blocked: { select: { id: true, title: true, taskNumber: true, statusId: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    if (!task) throw new TaskServiceError('Tarea no encontrada.', 404)

    const attachments = await files.list({ companyId, taskIds: [taskId], actorId })

    return { ...task, attachments }
  }

  async function createTask(projectId, createdBy, { title, description, statusId, assigneeId, priority = 'NONE', startDate, dueDate, parentTaskId }) {
    await validateTargets(projectId, { assigneeId, parentTaskId, statusId })
    if (!title?.trim()) throw new TaskServiceError('El titulo es requerido.', 400)
    const status = await prisma.taskStatus.findFirst({ where: { id: statusId, projectId } })
    if (!status) throw new TaskServiceError('Estado no valido para este proyecto.', 400)
    const last = await prisma.task.findFirst({
      where: { projectId, statusId, parentTaskId: null },
      orderBy: { position: 'desc' },
    })
    const position = (last?.position ?? -1) + 1
    return prisma.$transaction(async (tx) => {
      let taskNumber = null
      if (!parentTaskId) {
        const updated = await tx.project.update({
          where: { id: projectId },
          data: { taskCounter: { increment: 1 } },
          select: { taskCounter: true },
        })
        taskNumber = updated.taskCounter
      }
      return tx.task.create({
        data: {
          projectId,
          statusId,
          parentTaskId: parentTaskId || null,
          title: title.trim(),
          description: description?.trim() || null,
          assigneeId: assigneeId || null,
          priority,
          startDate: startDate ? toNoonUTC(startDate) : null,
          dueDate: dueDate ? toNoonUTC(dueDate) : null,
          position,
          createdBy,
          ...(taskNumber !== null ? { taskNumber } : {}),
        },
      })
    })
  }

  async function updateTask(taskId, data) {
    const task = await prisma.task.findFirst({ where: { id: taskId } })
    if (!task) throw new TaskServiceError('Tarea no encontrada.', 404)
    await validateTargets(task.projectId, data)
    const { title, description, assigneeId, priority, startDate, dueDate, statusId, rrule } = data
    const rruleNextAt = rrule !== undefined
      ? (rrule ? computeRruleNextAt(rrule) : null)
      : undefined
    return prisma.task.update({
      where: { id: taskId },
      data: {
        ...(title?.trim() ? { title: title.trim() } : {}),
        ...(description !== undefined ? { description: description?.trim() || null } : {}),
        ...(assigneeId !== undefined ? { assigneeId: assigneeId || null } : {}),
        ...(priority ? { priority } : {}),
        ...(startDate !== undefined ? { startDate: startDate ? toNoonUTC(startDate) : null } : {}),
        ...(dueDate !== undefined ? { dueDate: dueDate ? toNoonUTC(dueDate) : null } : {}),
        ...(statusId ? { statusId } : {}),
        ...(rrule !== undefined ? { rrule: rrule || null } : {}),
        ...(rruleNextAt !== undefined ? { rruleNextAt } : {}),
      },
    })
  }

  async function moveTask(taskId, { statusId, position }) {
    const task = await prisma.task.findFirst({ where: { id: taskId } })
    if (!task) throw new TaskServiceError('Tarea no encontrada.', 404)
    await validateTargets(task.projectId, { statusId })
    await prisma.task.updateMany({
      where: { projectId: task.projectId, statusId, position: { gte: position }, id: { not: taskId } },
      data: { position: { increment: 1 } },
    })
    return prisma.task.update({ where: { id: taskId }, data: { statusId, position } })
  }

  async function deleteTask(taskId) {
    const task = await prisma.task.findFirst({ where: { id: taskId } })
    if (!task) throw new TaskServiceError('Tarea no encontrada.', 404)
    await prisma.task.deleteMany({ where: { parentTaskId: taskId } })
    await prisma.task.delete({ where: { id: taskId } })
    return task
  }

  async function addAssignee(taskId, userId) {
    const task = await prisma.task.findFirst({ where: { id: taskId } })
    if (!task) throw new TaskServiceError('Tarea no encontrada.', 404)
    await validateTargets(task.projectId, { assigneeId: userId })
    const existing = await prisma.projectTaskAssignee.findFirst({ where: { taskId, userId } })
    if (existing) throw new TaskServiceError('El usuario ya esta asignado a esta tarea.', 409)
    const row = await prisma.projectTaskAssignee.create({
      data: { taskId, userId },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } } },
    })
    if (!task.assigneeId) {
      await prisma.task.update({ where: { id: taskId }, data: { assigneeId: userId } })
    }
    return row
  }

  async function removeAssignee(taskId, userId) {
    const task = await prisma.task.findFirst({ where: { id: taskId } })
    if (!task) throw new TaskServiceError('Tarea no encontrada.', 404)
    const existing = await prisma.projectTaskAssignee.findFirst({ where: { taskId, userId } })
    if (!existing) throw new TaskServiceError('El usuario no esta asignado a esta tarea.', 404)
    await prisma.projectTaskAssignee.delete({ where: { taskId_userId: { taskId, userId } } })
    if (task.assigneeId === userId) {
      const next = await prisma.projectTaskAssignee.findFirst({
        where: { taskId },
        orderBy: { assignedAt: 'asc' },
      })
      await prisma.task.update({ where: { id: taskId }, data: { assigneeId: next?.userId ?? null } })
    }
  }

  async function listAssignees(taskId) {
    return prisma.projectTaskAssignee.findMany({
      where: { taskId },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } } },
      orderBy: { assignedAt: 'asc' },
    })
  }

  async function bulkUpdateTasks(projectId, taskIds, patch) {
    if (!taskIds?.length) throw new TaskServiceError('Se requiere al menos una tarea.', 400)
    await validateTargets(projectId, patch)
    const { statusId, assigneeId, priority } = patch
    if (!statusId && assigneeId === undefined && !priority)
      throw new TaskServiceError('Se requiere al menos un campo para actualizar.', 400)
    await prisma.task.updateMany({
      where: { id: { in: taskIds }, projectId },
      data: {
        ...(statusId ? { statusId } : {}),
        ...(assigneeId !== undefined ? { assigneeId: assigneeId || null } : {}),
        ...(priority ? { priority } : {}),
      },
    })
    return { updated: taskIds.length }
  }

  async function bulkDeleteTasks(projectId, taskIds) {
    if (!taskIds?.length) throw new TaskServiceError('Se requiere al menos una tarea.', 400)
    await prisma.task.deleteMany({ where: { parentTaskId: { in: taskIds }, projectId } })
    const result = await prisma.task.deleteMany({ where: { id: { in: taskIds }, projectId } })
    return { deleted: result.count }
  }

  return {
    listTasks, getTask, createTask, updateTask, moveTask, deleteTask,
    addAssignee, removeAssignee, listAssignees,
    bulkUpdateTasks, bulkDeleteTasks,
  }
}
