import { Hono } from 'hono'
import { createProjectsService, ProjectServiceError } from './projects-service.js'
import { createTasksService, TaskServiceError } from './tasks-service.js'
import { createDependenciesService, DependencyServiceError } from './projects-dependencies-service.js'
import { createFieldsService, FieldServiceError } from './projects-fields-service.js'
import { createProjectsCalendarBridge } from './projects-calendar-bridge.js'
import { createProjectsNotificationService } from './projects-notification-service.js'
import { publishActivityFromContext } from '../../services/activity-publisher.js'
import { parseMentionIds } from '../../lib/mention-utils.js'
import { createCommentsService, CommentsServiceError } from '../../services/comments-service.js'

function getUserId(c) {
  return c.get('userContext')?.profile?.id ?? null
}

function getCompanyId(c) {
  return c.get('companyId') ?? null
}

function getActorName(c) {
  const p = c.get('userContext')?.profile
  if (!p) return 'Sistema'
  return [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email || 'Sistema'
}


function handleError(c, err, fallback) {
  if (
    err instanceof ProjectServiceError ||
    err instanceof TaskServiceError ||
    err instanceof DependencyServiceError ||
    err instanceof FieldServiceError
  ) return c.json({ error: err.message }, err.status)
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600)
    return c.json({ error: err.message || fallback }, err.status)
  if (process.env.NODE_ENV !== 'production') console.error('[runly.projects]', err)
  return c.json({ error: fallback }, 500)
}

export function createProjectsRouter({ prisma, requirePermission, notificationService, enrichFileAssets = null, broadcaster = null }) {
  const app = new Hono()
  const projectsSvc = createProjectsService({ prisma })
  const tasksSvc = createTasksService({ prisma })
  const depsSvc = createDependenciesService({ prisma })
  const fieldsSvc = createFieldsService({ prisma })
  const bridge = createProjectsCalendarBridge({ prisma })
  const notifSvc = createProjectsNotificationService({ prisma, notificationService })
  const commentsSvc = createCommentsService({ prisma })

  async function notifyTaskChanges(c, previous, patch) {
    if (!previous) return
    const context = { companyId: getCompanyId(c), actorId: getUserId(c), taskId: previous.id }
    if (patch.statusId && patch.statusId !== previous.statusId) {
      await notifSvc.notifyTaskStatusChanged({ ...context, oldStatusId: previous.statusId, newStatusId: patch.statusId })
    }
    if (patch.assigneeId !== undefined && patch.assigneeId !== previous.assigneeId) {
      await notifSvc.notifyTaskAssigned({ ...context, assignedUserId: patch.assigneeId })
    }
  }

  // Per-project authorization. Runs AFTER requirePermission(...) (which populates
  // userContext + companyId). Verifies the caller belongs to THIS project and
  // that the project is in the caller's company — the company-wide RBAC grant is
  // not enough. minRole gates by VIEWER < MEMBER < OWNER.
  const PROJECT_ROLE_RANK = { VIEWER: 1, MEMBER: 2, OWNER: 3 }
  function requireProjectAccess(minRole = 'VIEWER') {
    return async (c, next) => {
      const projectId = c.req.param('id')
      if (!projectId) return next()
      const userId = getUserId(c) ?? c.get('userId')
      const companyId = getCompanyId(c)
      const project = await prisma.project.findFirst({
        where: { id: projectId },
        select: { id: true, companyId: true, ownerId: true },
      })
      if (!project || (!companyId || project.companyId !== companyId)) {
        return c.json({ error: 'Proyecto no encontrado.' }, 404)
      }
      let role = project.ownerId === userId ? 'OWNER' : null
      if (!role) {
        const member = await prisma.projectMember.findFirst({
          where: { projectId, userId },
          select: { role: true },
        })
        role = member?.role ?? null
      }
      if (!role) return c.json({ error: 'Proyecto no encontrado.' }, 404)
      if ((PROJECT_ROLE_RANK[role] ?? 0) < (PROJECT_ROLE_RANK[minRole] ?? 1)) {
        return c.json({ error: 'No tienes acceso suficiente en este proyecto.' }, 403)
      }
      const taskId = c.req.param('tid')
      if (taskId && !(await prisma.task.findFirst({ where: { id: taskId, projectId }, select: { id: true } }))) {
        return c.json({ error: 'Recurso no encontrado.' }, 404)
      }
      const statusId = c.req.param('sid')
      if (statusId && !(await prisma.taskStatus.findFirst({ where: { id: statusId, projectId }, select: { id: true } }))) {
        return c.json({ error: 'Recurso no encontrado.' }, 404)
      }
      c.set('projectRole', role)
      c.set('projectCompanyId', project.companyId)
      return next()
    }
  }

  async function broadcastTaskEvent(projectId, taskId, action) {
    if (!broadcaster || !projectId) return
    try {
      const members = await prisma.projectMember.findMany({
        where: { projectId },
        select: { userId: true },
      })
      const memberIds = members.map((m) => m.userId)
      await broadcaster.broadcastToUsers(memberIds, 'projects.task.updated', {
        projectId,
        taskId: taskId ?? null,
        action,
      })
    } catch {}
  }

  // --- Projects ---
  app.get('/projects', requirePermission('projects.project.read'), async (c) => {
    try {
      const projects = await projectsSvc.listProjects(getCompanyId(c), getUserId(c))
      return c.json(projects)
    } catch (err) { return handleError(c, err, 'Error al listar proyectos.') }
  })

  app.post('/projects', requirePermission('projects.project.create'), async (c) => {
    try {
      const body = await c.req.json()
      const project = await projectsSvc.createProject(getCompanyId(c), getUserId(c), body)
      await bridge.syncProjectCalendar(project)
      return c.json(project, 201)
    } catch (err) { return handleError(c, err, 'Error al crear proyecto.') }
  })

  app.get('/projects/:id', requirePermission('projects.project.read'), requireProjectAccess('VIEWER'), async (c) => {
    try {
      const project = await projectsSvc.getProject(c.req.param('id'), getUserId(c))
      return c.json(project)
    } catch (err) { return handleError(c, err, 'Error al obtener proyecto.') }
  })

  app.patch('/projects/:id', requirePermission('projects.project.update'), requireProjectAccess('OWNER'), async (c) => {
    try {
      const body = await c.req.json()
      const project = await projectsSvc.updateProject(c.req.param('id'), getUserId(c), body)
      await bridge.syncProjectCalendar(project)
      return c.json(project)
    } catch (err) { return handleError(c, err, 'Error al actualizar proyecto.') }
  })

  app.delete('/projects/:id', requirePermission('projects.project.delete'), requireProjectAccess('OWNER'), async (c) => {
    try {
      const project = await projectsSvc.archiveProject(c.req.param('id'), getUserId(c))
      return c.json(project)
    } catch (err) { return handleError(c, err, 'Error al archivar proyecto.') }
  })

  app.post('/projects/:id/calendar/sync', requirePermission('projects.project.update'), requireProjectAccess('OWNER'), async (c) => {
    try {
      const project = await projectsSvc.getProject(c.req.param('id'), getUserId(c))
      const calendarId = await bridge.syncProjectCalendar(project)
      if (calendarId) {
        for (const m of project.members ?? []) {
          await bridge.grantMemberCalendarAccess(calendarId, m.userId)
        }
      }
      return c.json({ calendarId, calendarLinked: Boolean(calendarId) })
    } catch (err) { return handleError(c, err, 'Error al sincronizar calendario del proyecto.') }
  })

  // --- Members ---
  app.get('/projects/:id/members', requirePermission('projects.project.read'), requireProjectAccess('VIEWER'), async (c) => {
    try {
      const project = await projectsSvc.getProject(c.req.param('id'), getUserId(c))
      return c.json(project.members)
    } catch (err) { return handleError(c, err, 'Error al listar miembros.') }
  })

  app.post('/projects/:id/members', requirePermission('projects.member.manage'), requireProjectAccess('OWNER'), async (c) => {
    try {
      const projectId = c.req.param('id')
      const body = await c.req.json()
      const member = await projectsSvc.addMember(projectId, getUserId(c), body)
      const project = await prisma.project.findFirst({ where: { id: projectId } })
      if (project?.calendarId) await bridge.grantMemberCalendarAccess(project.calendarId, body.userId)
      await notifSvc.notifyMemberAdded({ companyId: getCompanyId(c), actorId: getUserId(c), projectId, addedUserId: body.userId })
      return c.json(member, 201)
    } catch (err) { return handleError(c, err, 'Error al agregar miembro.') }
  })

  app.patch('/projects/:id/members/:uid', requirePermission('projects.member.manage'), requireProjectAccess('OWNER'), async (c) => {
    try {
      const projectId = c.req.param('id')
      const userId = c.req.param('uid')
      const { role } = await c.req.json()
      const member = await prisma.projectMember.update({
        where: { projectId_userId: { projectId, userId } },
        data: { role },
      })
      return c.json(member)
    } catch (err) { return handleError(c, err, 'Error al actualizar miembro.') }
  })

  app.delete('/projects/:id/members/:uid', requirePermission('projects.member.manage'), requireProjectAccess('OWNER'), async (c) => {
    try {
      const projectId = c.req.param('id')
      const userId = c.req.param('uid')
      await projectsSvc.removeMember(projectId, getUserId(c), userId)
      const project = await prisma.project.findFirst({ where: { id: projectId } })
      if (project?.calendarId) await bridge.revokeMemberCalendarAccess(project.calendarId, userId)
      return c.json({ ok: true })
    } catch (err) { return handleError(c, err, 'Error al remover miembro.') }
  })

  // --- Statuses ---
  app.get('/projects/:id/statuses', requirePermission('projects.task.read'), requireProjectAccess('VIEWER'), async (c) => {
    try {
      const statuses = await projectsSvc.listStatuses(c.req.param('id'))
      return c.json(statuses)
    } catch (err) { return handleError(c, err, 'Error al listar estados.') }
  })

  app.post('/projects/:id/statuses', requirePermission('projects.project.update'), requireProjectAccess('OWNER'), async (c) => {
    try {
      const status = await projectsSvc.createStatus(c.req.param('id'), await c.req.json())
      return c.json(status, 201)
    } catch (err) { return handleError(c, err, 'Error al crear estado.') }
  })

  app.patch('/projects/:id/statuses/:sid', requirePermission('projects.project.update'), requireProjectAccess('OWNER'), async (c) => {
    try {
      const status = await projectsSvc.updateStatus(c.req.param('sid'), await c.req.json())
      return c.json(status)
    } catch (err) { return handleError(c, err, 'Error al actualizar estado.') }
  })

  app.delete('/projects/:id/statuses/:sid', requirePermission('projects.project.update'), requireProjectAccess('OWNER'), async (c) => {
    try {
      await projectsSvc.deleteStatus(c.req.param('sid'))
      return c.json({ ok: true })
    } catch (err) { return handleError(c, err, 'Error al eliminar estado.') }
  })

  // --- Tasks ---
  app.get('/projects/:id/tasks', requirePermission('projects.task.read'), requireProjectAccess('VIEWER'), async (c) => {
    try {
      const { status_id, assignee_id, priority, due_date_from, due_date_to, parent_task_id, include_subtasks } = c.req.query()
      const tasks = await tasksSvc.listTasks(c.req.param('id'), {
        statusId: status_id,
        assigneeId: assignee_id,
        priority,
        dueDateFrom: due_date_from,
        dueDateTo: due_date_to,
        parentTaskId: parent_task_id,
        includeSubtasks: include_subtasks === 'true',
      })
      return c.json(tasks)
    } catch (err) { return handleError(c, err, 'Error al listar tareas.') }
  })

  app.post('/projects/:id/tasks', requirePermission('projects.task.create'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      const body = await c.req.json()
      const task = await tasksSvc.createTask(c.req.param('id'), getUserId(c), body)
      await notifSvc.notifyTaskAssigned({ companyId: getCompanyId(c), actorId: getUserId(c), taskId: task.id, assignedUserId: task.assigneeId })
      if (task.dueDate) {
        const project = await prisma.project.findFirst({ where: { id: task.projectId } })
        await bridge.syncTaskEvent(task, project?.calendarId)
      }
      broadcastTaskEvent(task.projectId, task.id, 'created')
      return c.json(task, 201)
    } catch (err) { return handleError(c, err, 'Error al crear tarea.') }
  })

  // --- Bulk ---
  app.patch('/projects/:id/tasks/bulk', requirePermission('projects.task.update'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      const { taskIds, patch } = await c.req.json()
      const before = await prisma.task.findMany({ where: { projectId: c.req.param('id'), id: { in: taskIds ?? [] } }, select: { id: true, statusId: true, assigneeId: true } })
      const result = await tasksSvc.bulkUpdateTasks(c.req.param('id'), taskIds, patch ?? {})
      for (const previous of before) {
        await notifyTaskChanges(c, previous, patch ?? {})
      }
      broadcastTaskEvent(c.req.param('id'), null, 'bulk_updated')
      return c.json(result)
    } catch (err) { return handleError(c, err, 'Error al actualizar tareas en masa.') }
  })

  app.delete('/projects/:id/tasks/bulk', requirePermission('projects.task.delete'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      const { taskIds } = await c.req.json()
      const result = await tasksSvc.bulkDeleteTasks(c.req.param('id'), taskIds)
      broadcastTaskEvent(c.req.param('id'), null, 'bulk_deleted')
      return c.json(result)
    } catch (err) { return handleError(c, err, 'Error al eliminar tareas en masa.') }
  })

  app.get('/projects/:id/tasks/:tid', requirePermission('projects.task.read'), requireProjectAccess('VIEWER'), async (c) => {
    try {
      const task = await tasksSvc.getTask(c.req.param('tid'))
      return c.json(task)
    } catch (err) { return handleError(c, err, 'Error al obtener tarea.') }
  })

  app.patch('/projects/:id/tasks/:tid', requirePermission('projects.task.update'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      const taskId = c.req.param('tid')
      const body = await c.req.json()
      const previous = await prisma.task.findFirst({ where: { id: taskId }, select: { id: true, statusId: true, assigneeId: true } })
      const oldStatusId = previous?.statusId ?? null
      const task = await tasksSvc.updateTask(taskId, body)
      await notifyTaskChanges(c, previous, { assigneeId: body.assigneeId })
      if (body.dueDate !== undefined) {
        const project = await prisma.project.findFirst({ where: { id: task.projectId } })
        await bridge.syncTaskEvent(task, project?.calendarId)
      }
      if (body.statusId && oldStatusId && oldStatusId !== body.statusId) {
        await notifSvc.notifyTaskStatusChanged({
          companyId: getCompanyId(c),
          actorId: getUserId(c),
          taskId,
          oldStatusId,
          newStatusId: body.statusId,
        })
        prisma.taskStatus.findMany({
          where: { id: { in: [oldStatusId, body.statusId] } },
          select: { id: true, name: true },
        }).then((statuses) => {
          const oldS = statuses.find((s) => s.id === oldStatusId)
          const newS = statuses.find((s) => s.id === body.statusId)
          publishActivityFromContext(prisma, c, {
            type: 'projects.task.status_changed',
            summary: `${getActorName(c)} cambió estado de ${oldS?.name ?? '—'} → ${newS?.name ?? '—'}`,
            entityType: 'Task',
            entityId: taskId,
          })
        }).catch(() => {})
      }
      broadcastTaskEvent(task.projectId ?? c.req.param('id'), task.id, 'updated')
      return c.json(task)
    } catch (err) { return handleError(c, err, 'Error al actualizar tarea.') }
  })

  app.delete('/projects/:id/tasks/:tid', requirePermission('projects.task.delete'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      const task = await tasksSvc.deleteTask(c.req.param('tid'))
      if (task.calendarEventId) await bridge.deleteTaskEvent(task.calendarEventId)
      broadcastTaskEvent(c.req.param('id'), c.req.param('tid'), 'deleted')
      return c.json({ ok: true })
    } catch (err) { return handleError(c, err, 'Error al eliminar tarea.') }
  })

  app.patch('/projects/:id/tasks/:tid/move', requirePermission('projects.task.update'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      const patch = await c.req.json()
      const previous = await prisma.task.findFirst({ where: { id: c.req.param('tid') }, select: { id: true, statusId: true, assigneeId: true } })
      const task = await tasksSvc.moveTask(c.req.param('tid'), patch)
      await notifyTaskChanges(c, previous, patch)
      broadcastTaskEvent(c.req.param('id'), c.req.param('tid'), 'moved')
      return c.json(task)
    } catch (err) { return handleError(c, err, 'Error al mover tarea.') }
  })

  // --- Task Assignees ---
  app.get('/projects/:id/tasks/:tid/assignees', requirePermission('projects.task.read'), requireProjectAccess('VIEWER'), async (c) => {
    try {
      const assignees = await tasksSvc.listAssignees(c.req.param('tid'))
      return c.json(assignees)
    } catch (err) { return handleError(c, err, 'Error al listar asignados.') }
  })

  app.post('/projects/:id/tasks/:tid/assignees', requirePermission('projects.task.update'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      const { userId } = await c.req.json()
      const row = await tasksSvc.addAssignee(c.req.param('tid'), userId)
      await notifSvc.notifyTaskAssigned({ companyId: getCompanyId(c), actorId: getUserId(c), taskId: c.req.param('tid'), assignedUserId: userId })
      const assigneeName = [row.user?.firstName, row.user?.lastName].filter(Boolean).join(' ') || row.user?.email || 'Usuario'
      publishActivityFromContext(prisma, c, {
        type: 'projects.task.assigned',
        summary: `${getActorName(c)} asignó a ${assigneeName}`,
        entityType: 'Task',
        entityId: c.req.param('tid'),
      })
      return c.json(row, 201)
    } catch (err) { return handleError(c, err, 'Error al asignar usuario.') }
  })

  app.delete('/projects/:id/tasks/:tid/assignees/:uid', requirePermission('projects.task.update'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      const removedUserId = c.req.param('uid')
      const removedUser = await prisma.userProfile.findFirst({
        where: { id: removedUserId },
        select: { firstName: true, lastName: true, email: true },
      })
      await tasksSvc.removeAssignee(c.req.param('tid'), removedUserId)
      await notifSvc.notifyTaskUnassigned({ companyId: getCompanyId(c), actorId: getUserId(c), taskId: c.req.param('tid'), removedUserId })
      const removedName = [removedUser?.firstName, removedUser?.lastName].filter(Boolean).join(' ') || removedUser?.email || 'Usuario'
      publishActivityFromContext(prisma, c, {
        type: 'projects.task.unassigned',
        summary: `${getActorName(c)} removió a ${removedName}`,
        entityType: 'Task',
        entityId: c.req.param('tid'),
      })
      return c.json({ ok: true })
    } catch (err) { return handleError(c, err, 'Error al quitar asignado.') }
  })

  // --- Task Comments ---
  app.get('/projects/:id/tasks/:tid/comments', requirePermission('projects.task.read'), requireProjectAccess('VIEWER'), async (c) => {
    try {
      const comments = await commentsSvc.listComments('Task', c.req.param('tid'), getCompanyId(c), getUserId(c))
      return c.json({ data: comments })
    } catch (err) { return handleError(c, err, 'Error al listar comentarios.') }
  })

  app.post('/projects/:id/tasks/:tid/comments', requirePermission('projects.task.update'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      const { body } = await c.req.json()
      const companyId = getCompanyId(c)
      const comment = await commentsSvc.createComment('Task', c.req.param('tid'), c.get('authUserId'), body, companyId)
      const rawMentionIds = comment.mentions?.map((m) => m.userId) ?? []
      // Validate mentions are project members — prevents notification spam from injected UUIDs
      let mentionedIds = []
      if (rawMentionIds.length > 0) {
        const members = await prisma.projectMember.findMany({
          where: { projectId: c.req.param('id'), userId: { in: rawMentionIds } },
          select: { userId: true },
        })
        mentionedIds = members.map((m) => m.userId)
      }
      await notifSvc.notifyTaskComment({
        companyId,
        authorId: getUserId(c),
        taskId: c.req.param('tid'),
        mentionedUserIds: mentionedIds,
        commentId: comment.id,
      })
      return c.json(comment, 201)
    } catch (err) { return handleError(c, err, 'Error al crear comentario.') }
  })

  app.patch('/projects/:id/tasks/:tid/comments/:cid', requirePermission('projects.task.update'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      const { body } = await c.req.json()
      const comment = await commentsSvc.updateComment(c.req.param('cid'), c.get('authUserId'), body, getCompanyId(c), c.req.param('tid'))
      return c.json(comment)
    } catch (err) { return handleError(c, err, 'Error al editar comentario.') }
  })

  app.delete('/projects/:id/tasks/:tid/comments/:cid', requirePermission('projects.task.update'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      await commentsSvc.deleteComment(c.req.param('cid'), c.get('authUserId'), getCompanyId(c), c.req.param('tid'))
      return c.json({ ok: true })
    } catch (err) { return handleError(c, err, 'Error al eliminar comentario.') }
  })

  app.post('/projects/:id/tasks/:tid/comments/:cid/reactions', requirePermission('projects.task.update'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      const { emoji } = await c.req.json()
      const commentId = c.req.param('cid')
      const result = await commentsSvc.toggleReaction(commentId, c.get('authUserId'), emoji, getCompanyId(c), c.req.param('tid'))
      if (!result.removed) {
        await notifSvc.notifyTaskReaction({
          companyId: getCompanyId(c),
          actorId: getUserId(c),
          commentId,
        })
      }
      return c.json(result)
    } catch (err) { return handleError(c, err, 'Error al actualizar reaccion.') }
  })

  // --- Task Attachments ---
  app.get('/projects/:id/tasks/:tid/attachments', requirePermission('projects.task.read'), requireProjectAccess('VIEWER'), async (c) => {
    try {
      const projectId = c.req.param('id')
      const taskId = c.req.param('tid')
      const task = await prisma.task.findFirst({ where: { id: taskId, projectId } })
      if (!task) return c.json({ error: 'Tarea no encontrada.' }, 404)
      let attachments = await prisma.fileAsset.findMany({
        where: { entityType: 'Task', entityId: taskId, enabled: true },
        orderBy: { createdAt: 'asc' },
      })
      if (enrichFileAssets && Array.isArray(attachments)) {
        attachments = await enrichFileAssets(attachments);
      }
      return c.json(attachments)
    } catch (err) { return handleError(c, err, 'Error al listar archivos.') }
  })

  app.post('/projects/:id/tasks/:tid/attachments', requirePermission('projects.task.update'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      const projectId = c.req.param('id')
      const taskId = c.req.param('tid')
      const { file_asset_id } = await c.req.json()
      const task = await prisma.task.findFirst({ where: { id: taskId, projectId } })
      if (!task) return c.json({ error: 'Tarea no encontrada.' }, 404)
      const asset = await prisma.fileAsset.findFirst({ where: { id: file_asset_id } })
      if (!asset) return c.json({ error: 'Archivo no encontrado.' }, 404)
      const updated = await prisma.fileAsset.update({
        where: { id: file_asset_id },
        data: { entityId: taskId, entityType: 'Task' },
      })
      return c.json(updated, 201)
    } catch (err) { return handleError(c, err, 'Error al adjuntar archivo.') }
  })

  app.delete('/projects/:id/tasks/:tid/attachments/:fid', requirePermission('projects.task.update'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      const projectId = c.req.param('id')
      const taskId = c.req.param('tid')
      const task = await prisma.task.findFirst({ where: { id: taskId, projectId } })
      if (!task) return c.json({ error: 'Tarea no encontrada.' }, 404)
      const asset = await prisma.fileAsset.findFirst({ where: { id: c.req.param('fid') } })
      if (!asset) return c.json({ error: 'Archivo no encontrado.' }, 404)
      await prisma.fileAsset.update({ where: { id: c.req.param('fid') }, data: { enabled: false } })
      return c.json({ ok: true })
    } catch (err) { return handleError(c, err, 'Error al eliminar archivo.') }
  })

  // --- Task Dependencies ---
  app.get('/projects/:id/tasks/:tid/dependencies', requirePermission('projects.task.read'), requireProjectAccess('VIEWER'), async (c) => {
    try {
      return c.json(await depsSvc.listDependencies(c.req.param('tid')))
    } catch (err) { return handleError(c, err, 'Error al listar dependencias.') }
  })

  app.post('/projects/:id/tasks/:tid/dependencies', requirePermission('projects.task.update'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      const { blockerId } = await c.req.json()
      const dep = await depsSvc.addDependency(c.req.param('tid'), blockerId)
      return c.json(dep, 201)
    } catch (err) { return handleError(c, err, 'Error al agregar dependencia.') }
  })

  app.delete('/projects/:id/tasks/:tid/dependencies/:depId', requirePermission('projects.task.update'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      await depsSvc.removeDependency(c.req.param('depId'), c.req.param('tid'))
      return c.json({ ok: true })
    } catch (err) { return handleError(c, err, 'Error al eliminar dependencia.') }
  })

  // --- Project Custom Fields ---
  app.get('/projects/:id/fields', requirePermission('projects.project.read'), requireProjectAccess('VIEWER'), async (c) => {
    try {
      return c.json(await fieldsSvc.listFields(c.req.param('id')))
    } catch (err) { return handleError(c, err, 'Error al listar campos.') }
  })

  app.post('/projects/:id/fields', requirePermission('projects.project.update'), requireProjectAccess('OWNER'), async (c) => {
    try {
      const body = await c.req.json()
      const field = await fieldsSvc.createField(c.req.param('id'), body)
      return c.json(field, 201)
    } catch (err) { return handleError(c, err, 'Error al crear campo.') }
  })

  app.patch('/projects/:id/fields/:fid', requirePermission('projects.project.update'), requireProjectAccess('OWNER'), async (c) => {
    try {
      const body = await c.req.json()
      return c.json(await fieldsSvc.updateField(c.req.param('fid'), c.req.param('id'), body))
    } catch (err) { return handleError(c, err, 'Error al actualizar campo.') }
  })

  app.delete('/projects/:id/fields/:fid', requirePermission('projects.project.update'), requireProjectAccess('OWNER'), async (c) => {
    try {
      await fieldsSvc.deleteField(c.req.param('fid'), c.req.param('id'))
      return c.json({ ok: true })
    } catch (err) { return handleError(c, err, 'Error al eliminar campo.') }
  })

  // --- Task Field Values ---
  app.get('/projects/:id/tasks/:tid/field-values', requirePermission('projects.task.read'), requireProjectAccess('VIEWER'), async (c) => {
    try {
      return c.json(await fieldsSvc.getFieldValues(c.req.param('tid'), c.req.param('id')))
    } catch (err) { return handleError(c, err, 'Error al obtener valores de campos.') }
  })

  app.put('/projects/:id/tasks/:tid/field-values', requirePermission('projects.task.update'), requireProjectAccess('MEMBER'), async (c) => {
    try {
      const entries = await c.req.json()
      return c.json(await fieldsSvc.upsertFieldValues(c.req.param('tid'), c.req.param('id'), entries))
    } catch (err) { return handleError(c, err, 'Error al guardar valores de campos.') }
  })

  // --- CSV Export ---
  app.get('/projects/:id/export', requirePermission('projects.project.read'), requireProjectAccess('VIEWER'), async (c) => {
    try {
      const projectId = c.req.param('id')
      const [tasks, fields] = await Promise.all([
        prisma.task.findMany({
          where: { projectId },
          include: {
            status: { select: { name: true } },
            assignees: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
            fieldValues: true,
          },
          orderBy: [{ taskNumber: 'asc' }, { position: 'asc' }],
        }),
        prisma.projectField.findMany({
          where: { projectId },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        }),
      ])

      const PRIORITY_LABELS = { URGENT: 'Urgente', HIGH: 'Alta', MEDIUM: 'Media', LOW: 'Baja', NONE: '' }
      const baseHeaders = ['#', 'Titulo', 'Estado', 'Prioridad', 'Asignados', 'Fecha inicio', 'Fecha vencimiento', 'Descripcion']
      const customHeaders = fields.map((f) => f.name)
      const headers = [...baseHeaders, ...customHeaders]

      function esc(v) {
        if (v === null || v === undefined) return ''
        const s = String(v)
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
      }

      const rows = tasks.map((t) => {
        const assigneeNames = (t.assignees ?? [])
          .map((a) => [a.user?.firstName, a.user?.lastName].filter(Boolean).join(' ') || a.user?.email || '')
          .filter(Boolean)
          .join('; ')
        const valueMap = new Map((t.fieldValues ?? []).map((v) => [v.fieldId, v.value]))
        const base = [
          t.taskNumber != null ? `T-${t.taskNumber}` : '',
          t.title,
          t.status?.name ?? '',
          PRIORITY_LABELS[t.priority] ?? '',
          assigneeNames,
          // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date export value
          t.startDate ? new Date(t.startDate).toISOString().slice(0, 10) : '',
          // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date export value
          t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : '',
          t.description ?? '',
        ]
        const custom = fields.map((f) => valueMap.get(f.id) ?? '')
        return [...base, ...custom].map(esc).join(',')
      })

      const csv = [headers.map(esc).join(','), ...rows].join('\n')
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="project-tasks.csv"`,
        },
      })
    } catch (err) { return handleError(c, err, 'Error al exportar proyecto.') }
  })

  return app
}
