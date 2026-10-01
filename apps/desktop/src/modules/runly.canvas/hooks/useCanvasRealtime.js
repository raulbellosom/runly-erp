import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '../../../lib/supabase.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'

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
      onChanged: () => {
        client.invalidateQueries({ queryKey: ['canvas', 'boards', boardId] })
        client.invalidateQueries({ queryKey: ['canvas', 'boards', boardId, 'objects'] })
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
