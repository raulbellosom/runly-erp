import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '../../../lib/supabase.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { applyObjectDelta, invalidationTargets } from '../lib/realtimeCache.js'
import { CURSOR_SEND_MS, createThrottle, reduceCursor, visibleCursors } from '../lib/remoteCursors.js'

function createCanvasRealtimeSession({ boardId, user, onChanged, onCursor, onPresence }) {
  const supabase = getSupabaseClient()
  const channel = supabase.channel(`canvas:board:${boardId}`, {
    config: { private: true, broadcast: { self: false }, presence: { key: user.id } },
  })
  channel.on('broadcast', { event: 'canvas.changed' }, onChanged)
  channel.on('broadcast', { event: 'cursor' }, onCursor)
  channel.on('presence', { event: 'sync' }, () => {
    onPresence(Object.values(channel.presenceState()).flat().map((item) => item.user).filter(Boolean))
  })
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') channel.track({ user: { id: user.id, name: user.displayName ?? user.email } })
  })
  return { channel, destroy: () => supabase.removeChannel(channel) }
}

export function useCanvasRealtime(boardId, { pageId, selectedIds } = {}) {
  const { userProfile } = useAuth(), client = useQueryClient()
  const userId = userProfile?.id, displayName = userProfile?.displayName, email = userProfile?.email
  const channelRef = useRef(null)
  const [presence, setPresence] = useState([])
  const [cursors, setCursors] = useState(() => new Map())
  // Ticking "now" lets stale cursors disappear even without a new message;
  // it only runs while someone else's cursor is known, so a solo editor
  // never re-renders on a timer.
  const [now, setNow] = useState(() => Date.now())
  const hasCursors = cursors.size > 0
  useEffect(() => {
    if (!hasCursors) return undefined
    const timer = setInterval(() => setNow(Date.now()), 2000)
    return () => clearInterval(timer)
  }, [hasCursors])
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
      onCursor: (message) => setCursors((state) => reduceCursor(state, message?.payload, { selfId: userId })),
      onPresence: setPresence,
    })
    channelRef.current = session.channel
    return () => { channelRef.current = null; session.destroy() }
  }, [boardId, client, displayName, email, userId])
  // presenceState() includes this session and one entry per open tab, so the
  // UI receives other collaborators only, de-duplicated by user.
  const others = [...new Map(presence.filter((user) => user.id !== userId).map((user) => [user.id, user])).values()]

  const othersRef = useRef(0), pageRef = useRef(pageId), selectionRef = useRef(selectedIds ?? [])
  othersRef.current = others.length; pageRef.current = pageId; selectionRef.current = selectedIds ?? []
  const sendRef = useRef(null)
  if (!sendRef.current) {
    sendRef.current = createThrottle((point) => {
      if (!othersRef.current) return
      channelRef.current?.send({ type: 'broadcast', event: 'cursor', payload: { pageId: pageRef.current, x: point?.x ?? null, y: point?.y ?? null, selectedIds: selectionRef.current } })
    }, CURSOR_SEND_MS)
  }
  const lastPointRef = useRef(null)
  const broadcastPointer = useCallback((point) => { lastPointRef.current = point; sendRef.current(point) }, [])
  // Selection changes are sent even without pointer movement.
  const selectionKey = (selectedIds ?? []).join(',')
  useEffect(() => { sendRef.current?.(lastPointRef.current) }, [selectionKey, pageId])

  return {
    presence: others,
    cursors: visibleCursors(cursors, { pageId, presence: others, now }),
    broadcastPointer,
  }
}
