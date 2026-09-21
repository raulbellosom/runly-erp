import { createUserAccessService } from '../../services/user-access-service.js'
export class ProjectServiceError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.name = 'ProjectServiceError'
    this.status = status
  }
}

export const STATUS_TEMPLATES = {
  general: [
    { name: 'Por hacer', color: '#64748b', isDefault: true, isDone: false },
    { name: 'En progreso', color: '#3b82f6', isDefault: false, isDone: false },
    { name: 'Listo', color: '#22c55e', isDefault: false, isDone: true },
  ],
  desarrollo: [
    { name: 'Backlog', color: '#64748b', isDefault: false, isDone: false },
    { name: 'En desarrollo', color: '#3b82f6', isDefault: true, isDone: false },
    { name: 'En revision', color: '#f59e0b', isDefault: false, isDone: false },
    { name: 'QA', color: '#a855f7', isDefault: false, isDone: false },
    { name: 'Deploy', color: '#f97316', isDefault: false, isDone: false },
    { name: 'Listo', color: '#22c55e', isDefault: false, isDone: true },
  ],
  ventas: [
    { name: 'Lead', color: '#64748b', isDefault: true, isDone: false },
    { name: 'Propuesta', color: '#3b82f6', isDefault: false, isDone: false },
    { name: 'Negociacion', color: '#f59e0b', isDefault: false, isDone: false },
    { name: 'Ganado', color: '#22c55e', isDefault: false, isDone: true },
    { name: 'Perdido', color: '#ef4444', isDefault: false, isDone: true },
  ],
  marketing: [
    { name: 'Ideas', color: '#64748b', isDefault: true, isDone: false },
    { name: 'Planificado', color: '#3b82f6', isDefault: false, isDone: false },
    { name: 'En produccion', color: '#f59e0b', isDefault: false, isDone: false },
    { name: 'Publicado', color: '#22c55e', isDefault: false, isDone: true },
  ],
}

export function createProjectsService({ prisma }) {
  async function listProjects(companyId, userId) {
    const memberships = await prisma.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    })
    const memberProjectIds = memberships.map((m) => m.projectId)
    return prisma.project.findMany({
      where: {
        companyId,
        status: { not: 'ARCHIVED' },
        OR: [{ ownerId: userId }, { id: { in: memberProjectIds } }],
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } },
          },
        },
        _count: { select: { tasks: { where: { parentTaskId: null } } } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async function getProject(projectId, userId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId },
      include: {
        members: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } },
          },
        },
        statuses: { orderBy: { position: 'asc' } },
      },
    })
    if (!project) throw new ProjectServiceError('Proyecto no encontrado.', 404)
    const isMember =
      project.ownerId === userId || project.members.some((m) => m.userId === userId)
    if (!isMember) throw new ProjectServiceError('Proyecto no encontrado.', 404)
    let calendarLinked = false
    if (project.calendarId) {
      try {
        const cal = await prisma.calendarCalendar.findFirst({
          where: { id: project.calendarId, enabled: true },
          select: { id: true },
        })
        calendarLinked = Boolean(cal)
      } catch {
        // Calendar module may not be available
      }
    }
    return { ...project, calendarLinked }
  }

  async function createProject(companyId, ownerId, { name, description, color, icon, template = 'general' }) {
    if (!name?.trim()) throw new ProjectServiceError('El nombre es requerido.', 400)
    const templateStatuses = STATUS_TEMPLATES[template] ?? STATUS_TEMPLATES.general
    // Project + its default statuses + the owner membership are created together.
    return prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          companyId,
          ownerId,
          name: name.trim(),
          description: description?.trim() || null,
          color: color || '#6366f1',
          icon: icon || null,
        },
      })
      await tx.taskStatus.createMany({
        data: templateStatuses.map((s, i) => ({
          projectId: project.id,
          name: s.name,
          color: s.color,
          position: i,
          isDefault: s.isDefault,
          isDone: s.isDone,
        })),
      })
      await tx.projectMember.create({
        data: { projectId: project.id, userId: ownerId, role: 'OWNER' },
      })
      return project
    })
  }

  async function updateProject(projectId, userId, data) {
    const project = await prisma.project.findFirst({ where: { id: projectId } })
    if (!project) throw new ProjectServiceError('Proyecto no encontrado.', 404)
    if (project.ownerId !== userId) {
      const ownerMember = await prisma.projectMember.findFirst({
        where: { projectId, userId, role: 'OWNER' },
      })
      if (!ownerMember) throw new ProjectServiceError('Sin permiso para editar este proyecto.', 403)
    }
    const { name, description, color, icon, startDate, dueDate } = data
    return prisma.project.update({
      where: { id: projectId },
      data: {
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(description !== undefined ? { description: description?.trim() || null } : {}),
        ...(color ? { color } : {}),
        ...(icon !== undefined ? { icon: icon || null } : {}),
        ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
        ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
      },
    })
  }

  async function archiveProject(projectId, userId) {
    const project = await prisma.project.findFirst({ where: { id: projectId } })
    if (!project) throw new ProjectServiceError('Proyecto no encontrado.', 404)
    if (project.ownerId !== userId)
      throw new ProjectServiceError('Solo el owner puede archivar el proyecto.', 403)
    return prisma.project.update({ where: { id: projectId }, data: { status: 'ARCHIVED' } })
  }

  async function addMember(projectId, requesterId, { userId, role = 'MEMBER' }) {
    const project = await prisma.project.findFirst({ where: { id: projectId } })
    if (!project) throw new ProjectServiceError('Proyecto no encontrado.', 404)
    const validRoles = ['OWNER', 'MEMBER', 'VIEWER']
    if (!validRoles.includes(role)) throw new ProjectServiceError('Rol invalido.', 400)
    if (!userId) throw new ProjectServiceError('Usuario invalido.', 400)
    // The invitee must belong to the project's company.
    await createUserAccessService({ prisma }).assertCandidates({ companyId: project.companyId, userIds: [userId], permission: 'projects.project.read' })
    try {
      return await prisma.projectMember.create({ data: { projectId, userId, role } })
    } catch (err) {
      if (err?.code === 'P2002')
        throw new ProjectServiceError('El usuario ya es miembro del proyecto.', 409)
      throw err
    }
  }

  async function removeMember(projectId, requesterId, userId) {
    const project = await prisma.project.findFirst({ where: { id: projectId } })
    if (!project) throw new ProjectServiceError('Proyecto no encontrado.', 404)
    if (project.ownerId === userId)
      throw new ProjectServiceError('No puedes remover al owner del proyecto.', 400)
    await prisma.projectMember.deleteMany({ where: { projectId, userId } })
  }

  async function listStatuses(projectId) {
    return prisma.taskStatus.findMany({ where: { projectId }, orderBy: { position: 'asc' } })
  }

  async function createStatus(projectId, { name, color = '#64748b' }) {
    if (!name?.trim()) throw new ProjectServiceError('El nombre es requerido.', 400)
    const last = await prisma.taskStatus.findFirst({
      where: { projectId },
      orderBy: { position: 'desc' },
    })
    const position = (last?.position ?? -1) + 1
    return prisma.taskStatus.create({
      data: { projectId, name: name.trim(), color, position, isDefault: false, isDone: false },
    })
  }

  async function updateStatus(statusId, data) {
    const status = await prisma.taskStatus.findFirst({ where: { id: statusId } })
    if (!status) throw new ProjectServiceError('Estado no encontrado.', 404)
    const { name, color, position, isDefault, isDone } = data
    return prisma.taskStatus.update({
      where: { id: statusId },
      data: {
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(color ? { color } : {}),
        ...(position !== undefined ? { position } : {}),
        ...(isDefault !== undefined ? { isDefault } : {}),
        ...(isDone !== undefined ? { isDone } : {}),
      },
    })
  }

  async function deleteStatus(statusId) {
    const status = await prisma.taskStatus.findFirst({
      where: { id: statusId },
      include: { _count: { select: { tasks: true } } },
    })
    if (!status) throw new ProjectServiceError('Estado no encontrado.', 404)
    if (status._count.tasks > 0) {
      const defaultStatus = await prisma.taskStatus.findFirst({
        where: { projectId: status.projectId, isDefault: true, id: { not: statusId } },
      })
      if (!defaultStatus)
        throw new ProjectServiceError('No hay estado por defecto para mover las tareas.', 400)
      await prisma.task.updateMany({ where: { statusId }, data: { statusId: defaultStatus.id } })
    }
    await prisma.taskStatus.delete({ where: { id: statusId } })
  }

  async function reorderStatuses(projectId, orderedIds) {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new ProjectServiceError('Se requiere el orden de las columnas.', 400)
    }
    const existing = await prisma.taskStatus.findMany({
      where: { projectId, id: { in: orderedIds } },
      select: { id: true },
    })
    if (existing.length !== orderedIds.length) {
      throw new ProjectServiceError('Una o mas columnas no pertenecen a este proyecto.', 400)
    }
    await prisma.$transaction(
      orderedIds.map((id, position) =>
        prisma.taskStatus.update({ where: { id }, data: { position } }),
      ),
    )
    return listStatuses(projectId)
  }

  return {
    listProjects,
    getProject,
    createProject,
    updateProject,
    archiveProject,
    addMember,
    removeMember,
    listStatuses,
    createStatus,
    updateStatus,
    deleteStatus,
    reorderStatuses,
  }
}
