import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useActiveCompany } from '../company/ActiveCompanyProvider'
import { getSupabaseClient } from '../lib/supabase'
import { isTauriRuntime, showSystemNotification } from '../lib/systemNotifications'
import { toast } from 'sonner'
import { playCallSound } from '../modules/runly.chat/calls/callSounds'
import { useChatFloatStore } from '../modules/runly.chat/store/chatFloatStore'
import { useNotificationSoundStore } from '../stores/notificationSound'
import { notificationKey, claimNotification } from '../lib/notificationDedup'
import { getStoredWebPushSubscriptionId } from '../lib/webPush'
import { runly } from '../lib/runly'

const RealtimeContext = createContext(null)

export function RealtimeProvider({ children }) {
  const { userProfile, session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const listenersRef = useRef({})
  // Debounces the "clear this chat notification" call below, keyed by
  // conversation id, so a burst of messages in an open conversation only
  // fires one markReadBySource once things settle (see the chat.message.new
  // handler).
  const markConversationReadTimersRef = useRef(new Map())
  // The channel effect below deliberately excludes session?.access_token from
  // its deps (re-subscribing on every ~60min token refresh would drop
  // broadcasts), so handlers that need the CURRENT token read it from this
  // ref instead of closing over a `session` that can go stale for the life
  // of the subscription.
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [onlineUsers, setOnlineUsers] = useState({})
  const [lastSeenMap, setLastSeenMap] = useState({})

  // Stable `on` — registers a handler for a named broadcast event.
  // Returns an unsubscribe function. Safe to call before channels open.
  const on = useCallback((event, handler) => {
    if (!listenersRef.current[event]) listenersRef.current[event] = new Set()
    listenersRef.current[event].add(handler)
    return () => listenersRef.current[event]?.delete(handler)
  }, [])

  function dispatch(event, payload) {
    listenersRef.current[event]?.forEach((h) => {
      try { h(payload) } catch {}
    })
  }

  // User events channel — receives broadcasts sent by the API after writes
  useEffect(() => {
    setOnlineUsers({})
    setLastSeenMap({})
    useChatFloatStore.setState({ openChats: [], isOpen: false })
  }, [activeCompanyId, userProfile?.id])

  useEffect(() => {
    if (!userProfile?.id || !session?.access_token) return
    const client = getSupabaseClient()
    // private: true enables Realtime Authorization — the server checks the
    // user_events_receive RLS policy (migration
    // 20260911140000_chat_company_realtime_authorization), so only this
    // exact user can ever join their own events channel.
    const channel = client
      .channel(`user:${userProfile.id}:events`, { config: { private: true } })
      .on('broadcast', { event: 'notification.new' }, async ({ payload }) => {
        queryClient.invalidateQueries({ queryKey: ['notifications'] })
        dispatch('notification.new', payload)
        if (!payload?.title) return
        const isIncomingCall = payload.eventType === 'chat.call.incoming'
        // Incoming calls have their own surface (IncomingCallDialog + ringtone);
        // a toast on top of it is noise.
        if (isIncomingCall) return
        // Collapse the in-app + web-push copies of the same alert.
        const dupKey = notificationKey(payload)
        if (!claimNotification(dupKey)) return
        const handleClick = () => {
          if (!payload.link) return
          const href = payload.link.startsWith('/m/') ? `/app${payload.link}` : payload.link
          navigate(href)
        }
        // A chat message this device already knows is read — either because
        // it's the one actively showing that conversation, or because
        // another of the user's own sessions (e.g. a phone mid-conversation)
        // already marked it read and this device's chat-conversations cache
        // has caught up — shouldn't ding or raise an OS notification. Other
        // event types have no such per-conversation read state, so this only
        // applies to chat.message.new.
        let chatAlreadyRead = false
        if (payload.eventType === 'chat.message.new' && payload.sourceId) {
          const convId = payload.sourceId
          const openChats = useChatFloatStore.getState().openChats
          const isOpenAndVisible = openChats.some((c) => c.id === convId && !c.minimized)
          const isOnRoute = window.location.pathname.includes(`/runly.chat/chat/inbox/${convId}`)
          // Must be freshly refetched, not the cache as of right before this
          // message: unread_count from a moment ago reflects the state
          // BEFORE this message existed, which would read as "0 unread" for
          // every brand-new message and wrongly suppress it every time.
          await queryClient.invalidateQueries({ queryKey: ['chat-conversations'] })
          const cachedConversations = queryClient.getQueryData(['chat-conversations'])?.data ?? []
          const alreadyReadElsewhere = cachedConversations.some((c) => c.id === convId && c.unread_count === 0)
          chatAlreadyRead = alreadyReadElsewhere || ((isOpenAndVisible || isOnRoute) && !document.hidden)
        }
        if (!chatAlreadyRead && !useNotificationSoundStore.getState().muted) playCallSound('notification')
        // The service worker's `push` handler already raises the OS notification
        // whenever web-push is active on this device — firing one here too is the
        // desktop/Tauri double. Only take this path when there's no push
        // subscription to do it for us (or under Tauri, which has no SW push).
        const hasPushSub = Boolean(getStoredWebPushSubscriptionId())
        if (!chatAlreadyRead && (document.hidden || isTauriRuntime()) && (isTauriRuntime() || !hasPushSub)) {
          showSystemNotification({
            title: payload.title,
            body: payload.body ?? '',
            tag: dupKey ?? payload.eventType ?? 'runly-notification',
            data: { link: payload.link ?? null },
          }).catch(() => {})
        }
        // Regular chat messages already get a context-aware toast (mute and
        // open-conversation checks) from the chat.message.new broadcast handler
        // below — the API fires both this generic in-app notification and that
        // raw broadcast for the same message, so showing this toast too would
        // double it.
        if (payload.eventType !== 'chat.message.new') {
          toast(payload.title, {
            description: payload.body ?? undefined,
            duration: 6000,
            action: payload.link ? { label: 'Ver', onClick: handleClick } : undefined,
          })
        }
      })
      .on('broadcast', { event: 'chat.message.new' }, async ({ payload }) => {
        const isSelf = payload?.senderId && payload.senderId === userProfile?.id
        // Own message echoed back, or a malformed payload — just refresh the
        // list preview, nothing to decide about toasting/muting below.
        if (isSelf || !payload?.senderName) {
          queryClient.invalidateQueries({ queryKey: ['chat-conversations'] })
          dispatch('chat.message.new', payload)
          return
        }
        const convId = payload?.conversationId
        // Must be freshly refetched, not whatever was cached right before
        // this message: unread_count from a moment ago reflects the state
        // BEFORE this message existed, which would read as "0 unread" for
        // every brand-new message and wrongly suppress its toast every time.
        await queryClient.invalidateQueries({ queryKey: ['chat-conversations'] })
        dispatch('chat.message.new', payload)
        const openChats = useChatFloatStore.getState().openChats
        const isOpenAndVisible = convId && openChats.some((c) => c.id === convId && !c.minimized)
        const isOnRoute = convId && window.location.pathname.includes(`/runly.chat/chat/inbox/${convId}`)
        const cachedConversations = queryClient.getQueryData(['chat-conversations'])?.data ?? []
        const isMuted = convId && cachedConversations.some((c) => c.id === convId && c.is_muted)
        // unread_count is computed server-side against this user's own
        // last_read_at (one watermark per user, not per device) — once
        // another of the user's own sessions marks the conversation read
        // (below) and this device's refetch (above) picks it up, that's
        // the signal this device is already caught up too, even though it
        // never opened the conversation itself.
        const alreadyReadElsewhere = convId
          && cachedConversations.some((c) => c.id === convId && c.unread_count === 0)
        const dupKey = convId ? `c:chat.message.new|${payload.senderName}|${convId}` : null
        if (!isOpenAndVisible && !isOnRoute && !isMuted && !alreadyReadElsewhere && claimNotification(dupKey)) {
          toast(payload.senderName, {
            description: 'Nuevo mensaje',
            duration: 5000,
            action: convId ? {
              label: 'Ver',
              onClick: () => navigate(`/app/m/runly.chat/chat/inbox/${convId}`),
            } : undefined,
          })
        }
        // The recipient is actively looking at this conversation right now
        // — clear its chat.message.new notification instead of leaving an
        // unread bell entry for a message they're already reading, AND
        // bump last_read_at so any OTHER session of this same account
        // (e.g. a desktop tab left open while chatting on a phone) learns
        // — on its next chat-conversations refetch — that this
        // conversation is already read and stays quiet too (see
        // alreadyReadElsewhere above / in the notification.new handler).
        // The notification row is created asynchronously on the server
        // (fire-and-forget after sendMessage returns), so this is
        // debounced and delayed rather than raced against it.
        if ((isOpenAndVisible || isOnRoute) && !document.hidden && convId) {
          const timers = markConversationReadTimersRef.current
          clearTimeout(timers.get(convId))
          timers.set(convId, setTimeout(() => {
            timers.delete(convId)
            const currentToken = sessionRef.current?.access_token
            if (!currentToken) return
            runly.notifications
              .markReadBySource(currentToken, 'chat_conversation', convId)
              .then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))
              .catch(() => {})
            runly.chat
              .markRead(convId, currentToken)
              .then(() => queryClient.invalidateQueries({ queryKey: ['chat-conversations'] }))
              .catch(() => {})
          }, 1500))
        }
      })
      .on('broadcast', { event: 'chat.conversation.new' }, ({ payload }) => {
        queryClient.invalidateQueries({ queryKey: ['chat-conversations'] })
        dispatch('chat.conversation.new', payload)
      })
      .on('broadcast', { event: 'chat.call.incoming' }, ({ payload }) => {
        dispatch('chat.call.incoming', payload)
      })
      .on('broadcast', { event: 'chat.call.ended' }, ({ payload }) => {
        dispatch('chat.call.ended', payload)
      })
      .on('broadcast', { event: 'chat.call.guest_waiting' }, ({ payload }) => {
        dispatch('chat.call.guest_waiting', payload)
      })
      .on('broadcast', { event: 'chat.call.guest_joined' }, ({ payload }) => {
        dispatch('chat.call.guest_joined', payload)
      })
      .on('broadcast', { event: 'chat.call.guest_left' }, ({ payload }) => {
        dispatch('chat.call.guest_left', payload)
      })
      .on('broadcast', { event: 'chat.call.guest_admitted' }, ({ payload }) => {
        dispatch('chat.call.guest_admitted', payload)
      })
      .on('broadcast', { event: 'chat.call.guest_denied' }, ({ payload }) => {
        dispatch('chat.call.guest_denied', payload)
      })
      .on('broadcast', { event: 'chat.call.guest_kicked' }, ({ payload }) => {
        dispatch('chat.call.guest_kicked', payload)
      })
      .on('broadcast', { event: 'projects.task.updated' }, ({ payload }) => {
        dispatch('projects.task.updated', payload)
      })
      .on('broadcast', { event: 'projects.status.updated' }, ({ payload }) => {
        dispatch('projects.status.updated', payload)
      })
      .on('broadcast', { event: 'projects.project.updated' }, ({ payload }) => {
        dispatch('projects.project.updated', payload)
      })
      .on('broadcast', { event: 'projects.member.updated' }, ({ payload }) => {
        dispatch('projects.member.updated', payload)
      })
      .on('broadcast', { event: 'projects.fields.updated' }, ({ payload }) => {
        dispatch('projects.fields.updated', payload)
      })
      .on('broadcast', { event: 'notes.note.updated' }, ({ payload }) => {
        // Note metadata (cover, icon, background, title, folder) — the body
        // itself syncs over the note's own Y.js channel. Refetch so the open
        // note and the list reflect a collaborator's change immediately.
        queryClient.invalidateQueries({ queryKey: ['notes'] })
        if (payload?.noteId) {
          queryClient.invalidateQueries({ queryKey: ['notes', payload.noteId] })
        }
        dispatch('notes.note.updated', payload)
      })
      .subscribe()

    return () => {
      client.removeChannel(channel)
      markConversationReadTimersRef.current.forEach((timer) => clearTimeout(timer))
      markConversationReadTimersRef.current.clear()
    }
  // session?.access_token intentionally omitted: Supabase manages auth for
  // Realtime internally; including it here re-opens the channel on every
  // token refresh (~60min) and drops broadcasts during the transition window.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile?.id, queryClient])

  // Company presence channel — tracks who is online across the whole company
  useEffect(() => {
    if (!userProfile?.id || !activeCompanyId) return
    const client = getSupabaseClient()

    // private: true — company_presence_receive/send RLS policies restrict
    // this to actual enabled members of activeCompanyId.
    const channel = client
      .channel(`company:${activeCompanyId}:presence`, {
        config: { presence: { key: userProfile.id }, private: true },
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const next = {}
        Object.entries(state).forEach(([, presences]) => {
          const p = presences?.[0]
          if (p?.userId) next[p.userId] = p
        })
        setOnlineUsers(next)
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        const now = new Date()
        setLastSeenMap((prev) => {
          const next = { ...prev }
          leftPresences.forEach((p) => { if (p?.userId) next[p.userId] = now })
          return next
        })
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            userId: userProfile.id,
            displayName: userProfile.displayName ?? userProfile.email ?? userProfile.id,
            // Without this, every "online now" widget (FloatingChatHub's pill
            // strip included) falls back to initials for everyone, even users
            // who do have a real photo elsewhere in the app — the presence
            // payload is the only source those widgets read from.
            avatarUrl: userProfile.avatarUrl ?? null,
            status: 'online',
          })
        }
      })

    return () => { client.removeChannel(channel) }
  }, [userProfile?.id, activeCompanyId, userProfile?.displayName, userProfile?.email, userProfile?.avatarUrl])

  // Company events channel — receives broadcast events for POS, Calendar, and other company-wide modules
  useEffect(() => {
    if (!userProfile?.id || !activeCompanyId) return
    const client = getSupabaseClient()
    // private: true — company_events_receive RLS policy, same member check.
    const channel = client
      .channel(`company:${activeCompanyId}:events`, { config: { private: true } })
      .on('broadcast', { event: 'pos.order.updated' }, () => {
        queryClient.invalidateQueries({ queryKey: ['pos'] })
      })
      .on('broadcast', { event: 'calendar.event.updated' }, () => {
        queryClient.invalidateQueries({ queryKey: ['calendar'] })
      })
      .subscribe()
    return () => { client.removeChannel(channel) }
  }, [userProfile?.id, activeCompanyId, queryClient])

  // Postgres Changes on the notification table — fires when the API inserts a notification
  // for the current user. This is a reliable backup when the REST broadcast is unavailable.
  useEffect(() => {
    if (!userProfile?.id) return
    const client = getSupabaseClient()
    const channel = client
      .channel(`pg-notifications-${userProfile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notification', filter: `user_id=eq.${userProfile.id}` },
        () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      )
      .subscribe()
    return () => { client.removeChannel(channel) }
  }, [userProfile?.id, queryClient])

  const isUserOnline = useCallback((id) => Boolean(onlineUsers[id]), [onlineUsers])
  const getLastSeen = useCallback((id) => lastSeenMap[id] ?? null, [lastSeenMap])

  const value = useMemo(() => ({
    on,
    onlineUsers,
    lastSeenMap,
    isUserOnline,
    getLastSeen,
  }), [on, onlineUsers, lastSeenMap, isUserOnline, getLastSeen])

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export function useRealtimeContext() {
  const ctx = useContext(RealtimeContext)
  if (!ctx) throw new Error('useRealtimeContext must be used inside RealtimeProvider')
  return ctx
}

export function useGlobalPresence() {
  const { onlineUsers, lastSeenMap, isUserOnline, getLastSeen } = useRealtimeContext()
  return { onlineUsers, lastSeenMap, isUserOnline, getLastSeen }
}
