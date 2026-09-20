import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CommentThread } from '@runly/ui'
import { useAuth } from '../../../auth/AuthProvider'
import { runly } from '../../../lib/runly'
import {
  useInventoryComments,
  useCreateInventoryComment,
  useUpdateInventoryComment,
  useDeleteInventoryComment,
  useToggleInventoryReaction,
} from '../hooks/useInventoryComments.js'

export function InventoryCommentThread({ itemId }) {
  const { session, userProfile } = useAuth()
  const token = session?.access_token
  const currentUserId = userProfile?.id

  const commentsQuery = useInventoryComments(itemId)
  const createComment   = useCreateInventoryComment(itemId)
  const updateComment   = useUpdateInventoryComment(itemId)
  const deleteComment   = useDeleteInventoryComment(itemId)
  const toggleReaction  = useToggleInventoryReaction(itemId)

  const membersQuery = useQuery({
    queryKey: ['identity', 'users'],
    queryFn: () => runly.identity.listCandidates(token, { action: 'inventory' }),
    enabled: Boolean(token),
    staleTime: 10 * 60 * 1000,
  })
  const members = useMemo(() => {
    const raw = membersQuery.data?.data ?? membersQuery.data ?? []
    return raw.map(u => ({
      id: u.id,
      displayName: u.displayName || u.email || u.id,
      email: u.email || '',
      avatarUrl: u.avatarUrl || null,
    }))
  }, [membersQuery.data])

  const comments = useMemo(() => {
    const raw = commentsQuery.data?.data ?? commentsQuery.data ?? []
    return Array.isArray(raw) ? raw : []
  }, [commentsQuery.data])

  return (
    <CommentThread
      comments={comments}
      members={members}
      currentUserId={currentUserId}
      loading={commentsQuery.isLoading}
      isSubmitting={createComment.isPending}
      isActing={updateComment.isPending || deleteComment.isPending || toggleReaction.isPending}
      onSubmit={(body) => createComment.mutate({ body })}
      onUpdate={({ commentId, body }) => updateComment.mutateAsync({ commentId, body })}
      onDelete={(commentId) => deleteComment.mutateAsync(commentId)}
      onToggleReaction={({ commentId, emoji }) => toggleReaction.mutate({ commentId, emoji })}
    />
  )
}
