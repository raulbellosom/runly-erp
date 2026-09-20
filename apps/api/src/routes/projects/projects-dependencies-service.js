export class DependencyServiceError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.name = 'DependencyServiceError'
    this.status = status
  }
}

export function createDependenciesService({ prisma }) {
  async function listDependencies(taskId, projectId) {
    if (!projectId) throw new DependencyServiceError('Proyecto no encontrado.', 404)
    const [blockedBy, blocking] = await Promise.all([
      prisma.taskDependency.findMany({
        where: { blockedId: taskId, blocked: { projectId }, blocker: { projectId } },
        include: { blocker: { select: { id: true, title: true, taskNumber: true, statusId: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.taskDependency.findMany({
        where: { blockerId: taskId, blocked: { projectId }, blocker: { projectId } },
        include: { blocked: { select: { id: true, title: true, taskNumber: true, statusId: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    return { blockedBy, blocking }
  }

  async function addDependency(blockedTaskId, blockerId, projectId) {
    if (!projectId || !blockerId || !(await prisma.task.findFirst({ where: { id: blockerId, projectId }, select: { id: true } }))) {
      throw new DependencyServiceError('Tarea no encontrada.', 404)
    }
    if (!(await prisma.task.findFirst({ where: { id: blockedTaskId, projectId }, select: { id: true } }))) {
      throw new DependencyServiceError('Tarea no encontrada.', 404)
    }
    if (blockedTaskId === blockerId) {
      throw new DependencyServiceError('Una tarea no puede bloquearse a si misma.', 400)
    }
    const existing = await prisma.taskDependency.findFirst({
      where: { blockerId, blockedId: blockedTaskId },
    })
    if (existing) throw new DependencyServiceError('Esta dependencia ya existe.', 409)

    // Cycle guard: if blockerId is already blocked by blockedTaskId (directly or transitively)
    // we only check direct reverse to keep it simple and performant
    const reverse = await prisma.taskDependency.findFirst({
      where: { blockerId: blockedTaskId, blockedId: blockerId },
    })
    if (reverse) {
      throw new DependencyServiceError('Esta dependencia crea un ciclo.', 409)
    }

    return prisma.taskDependency.create({
      data: { blockerId, blockedId: blockedTaskId },
      include: { blocker: { select: { id: true, title: true, taskNumber: true } } },
    })
  }

  async function removeDependency(dependencyId, taskId) {
    const dep = await prisma.taskDependency.findFirst({
      where: { id: dependencyId, OR: [{ blockedId: taskId }, { blockerId: taskId }] },
    })
    if (!dep) throw new DependencyServiceError('Dependencia no encontrada.', 404)
    await prisma.taskDependency.delete({ where: { id: dependencyId } })
    return dep
  }

  return { listDependencies, addDependency, removeDependency }
}
