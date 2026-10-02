import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '../../../lib/supabase.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { applyObjectDelta, invalidationTargets } from '../lib/realtimeCache.js'

function createCanvasRealtimeSession({ boardId, user, onChanged, onPresence }) {
  const supabase = getSupabaseClient()
  const channel = supabase.channel(`canvas:board:${boardId}`, {
    config: { private: true, broadcast: { self: false }, presence: { key: user.id } },
  })
  channel.on('broadcast', { event: 'canvas.changed' }, onChanged)
  channel.on('presence', { event: 'sync' }, () => {
    onPresence(Object.values(channel.presenceState()).flat().map((item) => item.user).filter(Boolean))
  })
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') channel.track({ user: { id: user.id, name: user.displayName ?? user.email } })
  })
  return { channel, destroy: () => supabase.removeChannel(channel) }
}

export function useCanvasRealtime(boardId) {
  const { userProfile } = useAuth(), client = useQueryClient()
  const userId = userProfile?.id, displayName = userProfile?.displayName, email = userProfile?.email
  const channelRef = useRef(null)
  const [presence, setPresence] = useState([])
  useEffect(() => {
    if (!boardId || !userId) return undefined
    const session = createCanvasRealtimeSession({
      boardId,
      user: { id: userId, displayName, email },
      onChanged: (message) => {
        const payload = message?.payload ?? {}
        if (payload.action === 'objects.changed' && !payload.refetch && (payload.upserts || payload.deletedIds)) {
          for (const [key] of client.getQueriesData({ queryKey: ['canvas', 'boards', boardId, 'objects'] })) {
            const pageId = key[4]
            client.setQueryData(key, (rows) => (rows ? applyObjectDelta(rows, pageId, payload) : rows))
          }
          return
        }
        const keys = { board: ['canvas', 'boards', boardId], objects: ['canvas', 'boards', boardId, 'objects'], links: ['canvas', 'boards', boardId, 'links'], versions: ['canvas', 'boards', boardId, 'versions'] }
        for (const target of payload.action === 'objects.changed' ? ['objects'] : invalidationTargets(payload.action)) {
          client.invalidateQueries({ queryKey: keys[target], exact: target === 'board' })
        }
      },
      onPresence: setPresence,
    })
    channelRef.current = session.channel
    return () => { channelRef.current = null; session.destroy() }
  }, [boardId, client, displayName, email, userId])
  // presenceState() includes this session and one entry per open tab, so the
  // UI receives other collaborators only, de-duplicated by user.
  const others = [...new Map(presence.filter((user) => user.id !== userId).map((user) => [user.id, user])).values()]
  return {
    presence: others,
    broadcastCursor: (payload) => channelRef.current?.send({ type: 'broadcast', event: 'cursor', payload }),
  }
}
