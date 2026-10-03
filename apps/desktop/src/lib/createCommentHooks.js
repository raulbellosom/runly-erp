import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

// Comment threads must never show a stale cache: other users write to them
// and nothing invalidates this tab's cache except a notification (only the
// mentioned/recipient user gets one). Always refetch on open/focus, and poll
// lightly while the thread is on screen (paused in background tabs).
export const COMMENTS_LIVE_QUERY_OPTIONS = {
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: true,
  refetchInterval: 20 * 1000,
}

// Matches every comment-thread query (keys end in 'comments'), so a realtime
// notification can refresh whichever thread is open.
export const isCommentsQuery = (query) => query.queryKey?.[query.queryKey.length - 1] === 'comments'

/**
 * Factory that returns 5 TanStack Query hooks for entity comments.
 *
 * @param {Function} queryKey    - (entityId: string) => string[] — cache key prefix
 * @param {Object}   sdk         - { list, create, update, del, toggleReaction }
 * @param {Function} useAuth     - the useAuth hook (injected to keep factory portable)
 */
export function createCommentHooks({ queryKey, sdk, useAuth }) {
  function commentsKey(entityId) {
    return [...queryKey(entityId), 'comments']
  }

  function useComments(entityId) {
    const { session } = useAuth()
    return useQuery({
      queryKey: commentsKey(entityId),
      queryFn: () => sdk.list(entityId, session?.access_token),
      enabled: Boolean(session?.access_token) && Boolean(entityId),
      ...COMMENTS_LIVE_QUERY_OPTIONS,
      gcTime: 10 * 60 * 1000,
    })
  }

  function useCreateComment(entityId) {
    const { session, userProfile } = useAuth()
    const qc = useQueryClient()
    const key = commentsKey(entityId)
    return useMutation({
      mutationFn: ({ body }) => sdk.create(entityId, body, session?.access_token),
      onMutate: async ({ body }) => {
        await qc.cancelQueries({ queryKey: key })
        const prev = qc.getQueryData(key)
        const tempComment = {
          id: `_temp_${Date.now()}`,
          body,
          authorId: userProfile?.id,
          author: userProfile,
          createdAt: new Date().toISOString(),
          editedAt: null,
          reactions: [],
          _pending: true,
        }
        qc.setQueryData(key, (old) => {
          if (!old) return [tempComment]
          const list = old?.data ?? old
          if (!Array.isArray(list)) return old
          const updated = [...list, tempComment]
          return old?.data ? { ...old, data: updated } : updated
        })
        return { prev }
      },
      onError: (err, _, ctx) => {
        if (ctx?.prev !== undefined) qc.setQueryData(key, ctx.prev)
        toast.error(err?.message ?? 'Error al publicar el comentario')
      },
      onSettled: () => qc.invalidateQueries({ queryKey: key }),
    })
  }

  function useUpdateComment(entityId) {
    const { session } = useAuth()
    const qc = useQueryClient()
    const key = commentsKey(entityId)
    return useMutation({
      mutationFn: ({ commentId, body }) => sdk.update(entityId, commentId, body, session?.access_token),
      onMutate: async ({ commentId, body }) => {
        await qc.cancelQueries({ queryKey: key })
        const prev = qc.getQueryData(key)
        qc.setQueryData(key, (old) => {
          if (!old) return old
          const list = old?.data ?? old
          if (!Array.isArray(list)) return old
          const updated = list.map(c =>
            c.id === commentId ? { ...c, body, editedAt: new Date().toISOString() } : c
          )
          return old?.data ? { ...old, data: updated } : updated
        })
        return { prev }
      },
      onError: (err, _, ctx) => {
        if (ctx?.prev !== undefined) qc.setQueryData(key, ctx.prev)
        toast.error(err?.message ?? 'Error al editar el comentario')
      },
      onSettled: () => qc.invalidateQueries({ queryKey: key }),
    })
  }

  function useDeleteComment(entityId) {
    const { session } = useAuth()
    const qc = useQueryClient()
    const key = commentsKey(entityId)
    return useMutation({
      mutationFn: (commentId) => sdk.del(entityId, commentId, session?.access_token),
      onMutate: async (commentId) => {
        await qc.cancelQueries({ queryKey: key })
        const prev = qc.getQueryData(key)
        qc.setQueryData(key, (old) => {
          if (!old) return old
          const list = old?.data ?? old
          if (!Array.isArray(list)) return old
          const updated = list.filter(c => c.id !== commentId)
          return old?.data ? { ...old, data: updated } : updated
        })
        return { prev }
      },
      onError: (err, _, ctx) => {
        if (ctx?.prev !== undefined) qc.setQueryData(key, ctx.prev)
        toast.error(err?.message ?? 'Error al eliminar el comentario')
      },
      onSettled: () => qc.invalidateQueries({ queryKey: key }),
    })
  }

  function useToggleReaction(entityId) {
    const { session, userProfile } = useAuth()
    const qc = useQueryClient()
    const key = commentsKey(entityId)
    return useMutation({
      mutationFn: ({ commentId, emoji }) => sdk.toggleReaction(entityId, commentId, emoji, session?.access_token),
      onMutate: async ({ commentId, emoji }) => {
        await qc.cancelQueries({ queryKey: key })
        const prev = qc.getQueryData(key)
        qc.setQueryData(key, old => {
          if (!old) return old
          const list = old?.data ?? old
          if (!Array.isArray(list)) return old
          const updated = list.map(c => {
            if (c.id !== commentId) return c
            const mine = c.reactions?.some(r => r.userId === userProfile?.id && r.emoji === emoji)
            const reactions = mine
              ? c.reactions.filter(r => !(r.userId === userProfile?.id && r.emoji === emoji))
              : [...(c.reactions ?? []), { id: '_opt', commentId, userId: userProfile?.id, emoji, user: userProfile ?? null }]
            return { ...c, reactions }
          })
          return old?.data ? { ...old, data: updated } : updated
        })
        return { prev }
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.prev !== undefined) qc.setQueryData(key, ctx.prev)
        toast.error('No se pudo actualizar la reaccion')
      },
      onSettled: () => qc.invalidateQueries({ queryKey: key }),
    })
  }

  return { useComments, useCreateComment, useUpdateComment, useDeleteComment, useToggleReaction }
}
