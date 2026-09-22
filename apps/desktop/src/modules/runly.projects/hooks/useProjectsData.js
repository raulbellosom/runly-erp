import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { runly } from '../../../lib/runly'

function loadingMutation(msg) {
  return {
    onMutate: () => ({ toastId: toast.loading(msg) }),
    onSuccess: (_, __, ctx) => toast.dismiss(ctx?.toastId),
    onError:   (_, __, ctx) => toast.dismiss(ctx?.toastId),
  }
}

function useToken() {
  const { session } = useAuth()
  return session?.access_token
}

// ── Projects ──────────────────────────────────────────────────────────────────

export function useProjects() {
  const token = useToken()
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => runly.projects.listProjects(token),
    enabled: Boolean(token),
    staleTime: 2 * 60 * 1000,
  })
}

export function useProject(projectId) {
  const token = useToken()
  return useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => runly.projects.getProject(projectId, token),
    enabled: Boolean(token) && Boolean(projectId),
    staleTime: 60 * 1000,
  })
}

export function useSyncProjectCalendar(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => runly.projects.syncProjectCalendar(projectId, token),
    ...loadingMutation('Sincronizando calendario...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['projects', projectId] })
    },
  })
}

export function useCreateProject() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => runly.projects.createProject(data, token),
    ...loadingMutation('Creando proyecto...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useUpdateProject(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => runly.projects.updateProject(projectId, data, token),
    ...loadingMutation('Guardando proyecto...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['projects', projectId] })
    },
  })
}

export function useArchiveProject() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => runly.projects.archiveProject(id, token),
    ...loadingMutation('Archivando proyecto...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

// ── Members ───────────────────────────────────────────────────────────────────

export function useProjectMembers(projectId) {
  const token = useToken()
  return useQuery({
    queryKey: ['projects', projectId, 'members'],
    queryFn: () => runly.projects.listMembers(projectId, token),
    enabled: Boolean(token) && Boolean(projectId),
    staleTime: 60 * 1000,
  })
}

export function useAddMember(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => runly.projects.addMember(projectId, data, token),
    ...loadingMutation('Agregando miembro...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'members'] })
    },
  })
}

export function useRemoveMember(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId) => runly.projects.removeMember(projectId, userId, token),
    ...loadingMutation('Eliminando miembro...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'members'] })
    },
  })
}

// ── Statuses ──────────────────────────────────────────────────────────────────

export function useStatuses(projectId) {
  const token = useToken()
  return useQuery({
    queryKey: ['projects', projectId, 'statuses'],
    queryFn: () => runly.projects.listStatuses(projectId, token),
    enabled: Boolean(token) && Boolean(projectId),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useCreateStatus(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => runly.projects.createStatus(projectId, data, token),
    ...loadingMutation('Creando estado...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'statuses'] })
    },
  })
}

export function useUpdateStatus(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ statusId, ...data }) => runly.projects.updateStatus(projectId, statusId, data, token),
    ...loadingMutation('Guardando estado...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'statuses'] })
    },
  })
}

export function useReorderStatuses(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (order) => runly.projects.reorderStatuses(projectId, order, token),
    onMutate: async (order) => {
      await qc.cancelQueries({ queryKey: ['projects', projectId, 'statuses'] })
      const snapshot = qc.getQueryData(['projects', projectId, 'statuses'])
      qc.setQueryData(['projects', projectId, 'statuses'], (old) => {
        const list = old?.data ?? old
        if (!Array.isArray(list)) return old
        const byId = new Map(list.map((s) => [s.id, s]))
        const reordered = order.map((id, position) => ({ ...byId.get(id), position })).filter(Boolean)
        return Array.isArray(old) ? reordered : { ...old, data: reordered }
      })
      return { snapshot }
    },
    onError: (_, __, ctx) => {
      if (ctx?.snapshot !== undefined) qc.setQueryData(['projects', projectId, 'statuses'], ctx.snapshot)
      toast.error('No se pudo reordenar las columnas')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['projects', projectId, 'statuses'] }),
  })
}

export function useDeleteStatus(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (statusId) => runly.projects.deleteStatus(projectId, statusId, token),
    ...loadingMutation('Eliminando estado...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'statuses'] })
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] })
    },
  })
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export function useTasks(projectId, filters = {}) {
  const token = useToken()
  return useQuery({
    queryKey: ['projects', projectId, 'tasks', filters],
    queryFn: () => runly.projects.listTasks(projectId, filters, token),
    enabled: Boolean(token) && Boolean(projectId),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useTask(projectId, taskId) {
  const token = useToken()
  return useQuery({
    queryKey: ['projects', projectId, 'tasks', taskId],
    queryFn: () => runly.projects.getTask(projectId, taskId, token),
    enabled: Boolean(token) && Boolean(projectId) && Boolean(taskId),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useCreateTask(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => runly.projects.createTask(projectId, data, token),
    onMutate: async ({ title, statusId, parentTaskId }) => {
      // Subtasks skip the optimistic pre-write; their error handling
      // is handled by the call-site onError callback in TaskDetailPanel.
      if (parentTaskId) return undefined
      await qc.cancelQueries({ queryKey: ['projects', projectId, 'tasks'] })
      const tempTask = {
        id: `temp-${Date.now()}`,
        title,
        statusId,
        priority: 'NONE',
        position: 9999,
        assignees: [],
        assignee: null,
        _count: { subtasks: 0, comments: 0, attachments: 0 },
        dueDate: null,
        startDate: null,
        taskNumber: null,
        parentTaskId: null,
        blockedBy: [],
        blocking: [],
        rrule: null,
        status: null,
        createdAt: new Date().toISOString(),
      }
      const snapshots = qc.getQueriesData({ queryKey: ['projects', projectId, 'tasks'], exact: false })
      for (const [queryKey] of snapshots) {
        qc.setQueryData(queryKey, (old) => {
          if (!old) return old
          const tasks = old?.data ?? old
          if (!Array.isArray(tasks)) return old
          const filters = queryKey[3] ?? {}
          if (filters.statusId && filters.statusId !== statusId) return old
          return Array.isArray(old) ? [...tasks, tempTask] : { ...old, data: [...tasks, tempTask] }
        })
      }
      return { snapshots }
    },
    onError: (_, __, ctx) => {
      for (const [queryKey, data] of ctx?.snapshots ?? []) {
        qc.setQueryData(queryKey, data)
      }
      toast.error('No se pudo crear la tarea')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] })
    },
  })
}

export function useUpdateTask(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, ...data }) => runly.projects.updateTask(projectId, taskId, data, token),
    onMutate: async ({ taskId, ...patch }) => {
      await qc.cancelQueries({ queryKey: ['projects', projectId, 'tasks'] })
      await qc.cancelQueries({ queryKey: ['projects', projectId, 'tasks', taskId] })
      const listSnapshots = qc.getQueriesData({ queryKey: ['projects', projectId, 'tasks'], exact: false })
      const detailSnapshot = qc.getQueryData(['projects', projectId, 'tasks', taskId])
      for (const [queryKey] of listSnapshots) {
        qc.setQueryData(queryKey, (old) => {
          if (!old) return old
          const tasks = old?.data ?? old
          if (!Array.isArray(tasks)) return old
          const updated = tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
          return Array.isArray(old) ? updated : { ...old, data: updated }
        })
      }
      if (detailSnapshot) {
        qc.setQueryData(['projects', projectId, 'tasks', taskId], (old) =>
          old ? { ...old, ...patch } : old,
        )
      }
      return { listSnapshots, detailSnapshot }
    },
    onError: (_, { taskId }, ctx) => {
      for (const [queryKey, data] of ctx?.listSnapshots ?? []) {
        qc.setQueryData(queryKey, data)
      }
      if (ctx?.detailSnapshot !== undefined) {
        qc.setQueryData(['projects', projectId, 'tasks', taskId], ctx.detailSnapshot)
      }
    },
    onSettled: (_, __, { taskId }) => {
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] })
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks', taskId] })
    },
  })
}

export function useMoveTask(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, statusId, position }) =>
      runly.projects.moveTask(projectId, taskId, { statusId, position }, token),
    onMutate: async ({ taskId, statusId }) => {
      // Capture snapshot and apply optimistic update SYNCHRONOUSLY before any await,
      // so the UI reflects the new column immediately when drag ends (no snap-back flash).
      const snapshots = qc.getQueriesData({ queryKey: ['projects', projectId, 'tasks'], exact: false })
      for (const [queryKey] of snapshots) {
        qc.setQueryData(queryKey, (old) => {
          if (!old) return old
          const tasks = old?.data ?? old
          if (!Array.isArray(tasks)) return old
          const updated = tasks.map((t) => (t.id === taskId ? { ...t, statusId } : t))
          return Array.isArray(old) ? updated : { ...old, data: updated }
        })
      }
      await qc.cancelQueries({ queryKey: ['projects', projectId, 'tasks'] })
      return { snapshots }
    },
    onError: (_, __, ctx) => {
      for (const [queryKey, data] of ctx?.snapshots ?? []) {
        qc.setQueryData(queryKey, data)
      }
      toast.error('No se pudo mover la tarea')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] })
    },
  })
}

export function useDeleteTask(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId) => runly.projects.deleteTask(projectId, taskId, token),
    ...loadingMutation('Eliminando tarea...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] })
    },
  })
}

// ── Workspace users (for assignee picker) ────────────────────────────────────

export function useWorkspaceUsers(projectId = null) {
  const token = useToken()
  return useQuery({
    queryKey: ['identity', 'candidates', 'projects', projectId],
    queryFn: () => runly.identity.listCandidates(token, { action: 'projects', ...(projectId ? { projectId } : {}) }),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
  })
}

// ── Task Assignees ────────────────────────────────────────────────────────────

export function useAddAssignee(projectId, taskId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId }) => runly.projects.addTaskAssignee(projectId, taskId, { userId }, token),
    ...loadingMutation('Asignando...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] })
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks', taskId] })
    },
  })
}

export function useRemoveAssignee(projectId, taskId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId }) => runly.projects.removeTaskAssignee(projectId, taskId, userId, token),
    ...loadingMutation('Quitando asignado...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] })
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks', taskId] })
    },
  })
}

// ── Task Comments ─────────────────────────────────────────────────────────────

function commentsKey(projectId, taskId) {
  return ['projects', projectId, 'tasks', taskId, 'comments']
}

export function useTaskComments(projectId, taskId) {
  const token = useToken()
  return useQuery({
    queryKey: commentsKey(projectId, taskId),
    queryFn: () => runly.projects.listTaskComments(projectId, taskId, {}, token),
    enabled: Boolean(projectId && taskId && token),
    select: (res) => res?.data ?? res ?? [],
  })
}

export function useCreateComment(projectId, taskId) {
  const { session, userProfile } = useAuth()
  const token = session?.access_token
  const qc = useQueryClient()
  const cKey = commentsKey(projectId, taskId)
  return useMutation({
    mutationFn: ({ body }) => runly.projects.createTaskComment(projectId, taskId, { body }, token),
    onMutate: async ({ body }) => {
      await qc.cancelQueries({ queryKey: cKey })
      const snapshot = qc.getQueryData(cKey)
      const tempComment = {
        id: `_temp_${Date.now()}`,
        entityType: 'Task',
        entityId: taskId,
        authorId: userProfile?.id,
        author: userProfile,
        body,
        createdAt: new Date().toISOString(),
        editedAt: null,
        mentions: [],
        reactions: [],
        _pending: true,
      }
      qc.setQueryData(cKey, (old) => {
        const list = old?.data ?? old ?? []
        const updated = [...list, tempComment]
        return old?.data ? { ...old, data: updated } : updated
      })
      return { snapshot }
    },
    onError: (_, __, ctx) => {
      if (ctx?.snapshot !== undefined) qc.setQueryData(cKey, ctx.snapshot)
      toast.error('No se pudo enviar el comentario')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: cKey })
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useUpdateComment(projectId, taskId) {
  const token = useToken()
  const qc = useQueryClient()
  const cKey = commentsKey(projectId, taskId)
  return useMutation({
    mutationFn: ({ commentId, body }) => runly.projects.updateTaskComment(projectId, taskId, commentId, { body }, token),
    onMutate: async ({ commentId, body }) => {
      await qc.cancelQueries({ queryKey: cKey })
      const snapshot = qc.getQueryData(cKey)
      qc.setQueryData(cKey, (old) => {
        const list = old?.data ?? old ?? []
        const updated = list.map(c => c.id === commentId ? { ...c, body, editedAt: new Date().toISOString() } : c)
        return old?.data ? { ...old, data: updated } : updated
      })
      return { snapshot }
    },
    onError: (_, __, ctx) => {
      if (ctx?.snapshot !== undefined) qc.setQueryData(cKey, ctx.snapshot)
      toast.error('No se pudo editar el comentario')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: cKey }),
  })
}

export function useDeleteComment(projectId, taskId) {
  const token = useToken()
  const qc = useQueryClient()
  const cKey = commentsKey(projectId, taskId)
  return useMutation({
    mutationFn: ({ commentId }) => runly.projects.deleteTaskComment(projectId, taskId, commentId, token),
    onMutate: async ({ commentId }) => {
      await qc.cancelQueries({ queryKey: cKey })
      const snapshot = qc.getQueryData(cKey)
      qc.setQueryData(cKey, (old) => {
        const list = old?.data ?? old ?? []
        const updated = list.filter(c => c.id !== commentId)
        return old?.data ? { ...old, data: updated } : updated
      })
      return { snapshot }
    },
    onError: (_, __, ctx) => {
      if (ctx?.snapshot !== undefined) qc.setQueryData(cKey, ctx.snapshot)
      toast.error('No se pudo eliminar el comentario')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: cKey }),
  })
}

export function useToggleTaskReaction(projectId, taskId) {
  const { session, userProfile } = useAuth()
  const token = session?.access_token
  const qc = useQueryClient()
  const cKey = commentsKey(projectId, taskId)
  return useMutation({
    mutationFn: ({ commentId, emoji }) =>
      runly.projects.toggleTaskCommentReaction(projectId, taskId, commentId, emoji, token),
    onMutate: async ({ commentId, emoji }) => {
      await qc.cancelQueries({ queryKey: cKey })
      const snapshot = qc.getQueryData(cKey)
      const userId = userProfile?.id
      qc.setQueryData(cKey, (old) => {
        const list = old?.data ?? old ?? []
        const updated = list.map(c => {
          if (c.id !== commentId) return c
          const mine = c.reactions?.some(r => r.userId === userId && r.emoji === emoji)
          const reactions = mine
            ? c.reactions.filter(r => !(r.userId === userId && r.emoji === emoji))
            : [...(c.reactions ?? []), { id: '_opt', commentId, userId, emoji, user: userProfile ?? null }]
          return { ...c, reactions }
        })
        return old?.data ? { ...old, data: updated } : updated
      })
      return { snapshot }
    },
    onError: (_, __, ctx) => {
      if (ctx?.snapshot !== undefined) qc.setQueryData(cKey, ctx.snapshot)
      toast.error('No se pudo actualizar la reaccion')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: cKey }),
  })
}

// ── Task Dependencies ─────────────────────────────────────────────────────────

export function useTaskDependencies(projectId, taskId) {
  const token = useToken()
  return useQuery({
    queryKey: ['projects', projectId, 'tasks', taskId, 'dependencies'],
    queryFn: () => runly.projects.listTaskDependencies(projectId, taskId, token),
    enabled: Boolean(token) && Boolean(projectId) && Boolean(taskId),
    staleTime: 15 * 1000,
  })
}

export function useAddDependency(projectId, taskId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => runly.projects.addTaskDependency(projectId, taskId, data, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks', taskId, 'dependencies'] }),
    onError: () => toast.error('No se pudo agregar la dependencia'),
  })
}

export function useRemoveDependency(projectId, taskId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (depId) => runly.projects.removeTaskDependency(projectId, taskId, depId, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks', taskId, 'dependencies'] }),
    onError: () => toast.error('No se pudo eliminar la dependencia'),
  })
}

// ── Project Custom Fields ─────────────────────────────────────────────────────

export function useProjectFields(projectId) {
  const token = useToken()
  return useQuery({
    queryKey: ['projects', projectId, 'fields'],
    queryFn: () => runly.projects.listProjectFields(projectId, token),
    enabled: Boolean(token) && Boolean(projectId),
    staleTime: 60 * 1000,
  })
}

export function useCreateField(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data) => runly.projects.createProjectField(projectId, data, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', projectId, 'fields'] }),
    onError: () => toast.error('No se pudo crear el campo'),
  })
}

export function useUpdateField(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ fieldId, ...data }) => runly.projects.updateProjectField(projectId, fieldId, data, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', projectId, 'fields'] }),
    onError: () => toast.error('No se pudo actualizar el campo'),
  })
}

export function useDeleteField(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fieldId) => runly.projects.deleteProjectField(projectId, fieldId, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', projectId, 'fields'] }),
    onError: () => toast.error('No se pudo eliminar el campo'),
  })
}

// ── Task Field Values ─────────────────────────────────────────────────────────

export function useTaskFieldValues(projectId, taskId) {
  const token = useToken()
  return useQuery({
    queryKey: ['projects', projectId, 'tasks', taskId, 'field-values'],
    queryFn: () => runly.projects.getTaskFieldValues(projectId, taskId, token),
    enabled: Boolean(token) && Boolean(projectId) && Boolean(taskId),
    staleTime: 15 * 1000,
  })
}

export function useUpsertFieldValues(projectId, taskId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (entries) => runly.projects.upsertTaskFieldValues(projectId, taskId, entries, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks', taskId, 'field-values'] }),
    onError: () => toast.error('No se pudo guardar el valor'),
  })
}

// ── Task Activity feed ────────────────────────────────────────────────────────

export function useTaskActivity(taskId, limit = 50) {
  const token = useToken()
  return useQuery({
    queryKey: ['activity', 'Task', taskId],
    queryFn: () => runly.activity.listForEntity('Task', taskId, token, limit),
    enabled: Boolean(token) && Boolean(taskId),
    staleTime: 15 * 1000,
  })
}

// ── Bulk ──────────────────────────────────────────────────────────────────────

export function useBulkUpdateTasks(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskIds, patch }) => runly.projects.bulkUpdateTasks(projectId, { taskIds, patch }, token),
    ...loadingMutation('Actualizando tareas...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] })
    },
  })
}

export function useBulkDeleteTasks(projectId) {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskIds }) => runly.projects.bulkDeleteTasks(projectId, { taskIds }, token),
    ...loadingMutation('Eliminando tareas...'),
    onSuccess: (data, vars, ctx) => {
      toast.dismiss(ctx?.toastId)
      qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] })
    },
  })
}

export function useAllTasksForPicker(projectId, enabled = false) {
  const token = useToken()
  return useQuery({
    queryKey: ['projects', projectId, 'tasks', '__picker__'],
    queryFn: () => runly.projects.listTasks(projectId, {}, token),
    enabled: Boolean(token) && Boolean(projectId) && enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}
