import { createFileAccess } from '../../services/files/access.js'

export function taskFileScope(companyId, taskId) {
  return { entityType: 'Task', OR: [
    { entityId: companyId, metadata: { path: ['sourceEntityId'], equals: taskId } },
    // Legacy files are anchored to the task; callers authorize its project.
    { entityId: taskId },
  ] }
}

export function createProjectFilesService({ prisma }) {
  const access = createFileAccess({ prisma })
  async function list({ companyId, taskIds, actorId }) {
    if (!companyId || !taskIds.length) return []
    return prisma.fileAsset.findMany({
      where: { enabled: true, AND: [
        { OR: taskIds.map(id => taskFileScope(companyId, id)) },
        actorId ? access.readWhere({ profileId: actorId, admin: false }) : { accessScope: 'COMPANY' },
      ] },
      orderBy: { createdAt: 'asc' },
    })
  }
  return { list }
}
