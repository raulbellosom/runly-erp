import { useCallback, useEffect, useRef, useState } from 'react'

const TOKEN_KEY = 'atlas_chat_guest_token'
const SESSION_KEY = 'atlas_chat_guest_session'
const TRACKING_KEY = 'atlas_chat_tracking_code'

function loadStoredSession() {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const raw = localStorage.getItem(SESSION_KEY)
    if (!token || !raw) return null
    return { token, ...JSON.parse(raw) }
  } catch {
    return null
  }
}

function storeSession(token, sessionData) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData))
  } catch { /* storage might be disabled */ }
}

function storeTrackingCode(code) {
  try {
    if (code) localStorage.setItem(TRACKING_KEY, code)
  } catch { /* ignore */ }
}

function loadTrackingCode() {
  try {
    return localStorage.getItem(TRACKING_KEY) ?? null
  } catch { return null }
}

function clearStoredSession() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(TRACKING_KEY)
  } catch { /* ignore */ }
}

export function useGuestChat(sdk) {
  const [screen, setScreen] = useState('welcome') // 'welcome' | 'identify' | 'resume' | 'chat'
  const [availability, setAvailability] = useState(null)
  const [session, setSession] = useState(null)
  const [trackingCode, setTrackingCode] = useState(() => loadTrackingCode())
  const [messages, setMessages] = useState([])
  const [isSending, setIsSending] = useState(false)
  const [isClosed, setIsClosed] = useState(false)
  const [startError, setStartError] = useState(null)
  const [resumeError, setResumeError] = useState(null)
  const [operatorTyping, setOperatorTyping] = useState(false)
  const [operatorLastReadAt, setOperatorLastReadAt] = useState(null)
  const unsubscribeRef = useRef(null)
  const typingClearRef = useRef(null)

  // Load availability + restore session on mount
  useEffect(() => {
    sdk.guestChat.getAvailability()
      .then(setAvailability)
      .catch(() => setAvailability({ available: false, agentsOnline: 0 }))

    const stored = loadStoredSession()
    if (stored?.token && stored?.conversationId) {
      sdk.guestChat.getSession(stored.token)
        .then((data) => {
          if (data?.conversation?.status === 'closed') {
            clearStoredSession()
            setTrackingCode(null)
            return null
          }
          if (data?.trackingCode) {
            storeTrackingCode(data.trackingCode)
            setTrackingCode(data.trackingCode)
          }
          setSession({ token: stored.token, conversationId: stored.conversationId, email: data.email, name: data.name })
          setScreen('chat')
          return sdk.guestChat.listMessages(stored.token)
        })
        .then((res) => {
          if (res?.messages) setMessages(res.messages)
          if (res?.operatorLastReadAt) setOperatorLastReadAt(res.operatorLastReadAt)
        })
        .catch(() => clearStoredSession())
    }
  }, [sdk])

  // Subscribe to realtime replies when session is active
  useEffect(() => {
    if (!session?.conversationId) return

    const unsub = sdk.guestChat.subscribeToReplies(session.conversationId, {
      onMessage: (payload) => {
        if (payload?.deleted) {
          setMessages((prev) => prev.filter((m) => m.id !== payload.messageId))
          return
        }
        setMessages((prev) => {
          const isDuplicate = prev.some((m) => m.id === payload.messageId)
          if (isDuplicate) return prev
          return [...prev, {
            id: payload.messageId,
            body: payload.body,
            sender_type: payload.senderType,
            senderName: payload.senderName ?? null,
            senderAvatarUrl: payload.senderAvatarUrl ?? null,
            created_at: payload.createdAt,
          }]
        })
      },
      onTyping: () => {
        setOperatorTyping(true)
        clearTimeout(typingClearRef.current)
        typingClearRef.current = setTimeout(() => setOperatorTyping(false), 4000)
      },
      onRead: (payload) => {
        setOperatorLastReadAt(payload?.at ?? new Date().toISOString())
      },
      onClose: () => { setIsClosed(true) },
    })

    unsubscribeRef.current = unsub
    return () => {
      unsub()
      unsubscribeRef.current = null
    }
  }, [sdk, session?.conversationId])

  const startSession = useCallback(async (data = {}) => {
    setStartError(null)
    try {
      const res = await sdk.guestChat.createSession({
        ...data,
        pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        referrer: typeof document !== 'undefined' && document.referrer ? document.referrer : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      })
      storeSession(res.token, { conversationId: res.conversationId })
      storeTrackingCode(res.trackingCode)
      setTrackingCode(res.trackingCode ?? null)
      setSession({ token: res.token, conversationId: res.conversationId, email: data.email, name: data.name })
      setMessages([])
      setIsClosed(false)
      setScreen('chat')
      return res
    } catch (err) {
      setStartError(err?.message ?? 'No se pudo iniciar la sesión. Inténtalo de nuevo.')
      throw err
    }
  }, [sdk])

  const resumeByCode = useCallback(async (code, email) => {
    setResumeError(null)
    try {
      const res = await sdk.guestChat.resumeByCode(code.trim().toUpperCase(), email.trim())
      storeSession(res.token, { conversationId: res.conversationId })
      storeTrackingCode(res.trackingCode)
      setTrackingCode(res.trackingCode ?? code)
      setSession({ token: res.token, conversationId: res.conversationId, email })
      const msgRes = await sdk.guestChat.listMessages(res.token)
      if (msgRes?.messages) setMessages(msgRes.messages)
      if (msgRes?.operatorLastReadAt) setOperatorLastReadAt(msgRes.operatorLastReadAt)
      setScreen('chat')
      return res
    } catch (err) {
      const msg = err?.message ?? 'No se pudo encontrar la conversación. Verifica el número y correo.'
      setResumeError(msg)
      throw err
    }
  }, [sdk])

  // Poll for new messages as a safety net (covers cases where the realtime
  // broadcast channel drops or reconnects slowly).
  useEffect(() => {
    if (!session?.token || screen !== 'chat') return
    const id = setInterval(async () => {
      try {
        const res = await sdk.guestChat.listMessages(session.token)
        const msgs = res?.messages
        if (!Array.isArray(msgs)) return
        if (res.operatorLastReadAt) setOperatorLastReadAt(res.operatorLastReadAt)
        setMessages((prev) => {
          // Merge server truth into existing rows by id (not just append-if-
          // unknown) — a message added optimistically by sendFile/sendMessage
          // can be incomplete (e.g. missing `attachments` before the server
          // round-trip), and the old append-only version never reconciled it,
          // leaving that placeholder stuck forever.
          const incomingById = new Map(msgs.map((m) => [m.id, m]))
          const merged = prev.map((m) => incomingById.get(m.id) ?? m)
          const existingIds = new Set(prev.map((m) => m.id))
          const newOnes = msgs.filter((m) => !existingIds.has(m.id))
          return [...merged, ...newOnes]
        })
      } catch { /* non-fatal */ }
    }, 8000)
    return () => clearInterval(id)
  }, [session?.token, screen, sdk])

  const sendMessage = useCallback(async (body) => {
    if (!session?.token || !body?.trim()) return
    setIsSending(true)
    // Optimistic: add instantly so the sender sees their own message right away.
    const tempId = `temp-${Date.now()}`
    setMessages((prev) => [...prev, {
      id: tempId,
      body,
      sender_type: 'guest',
      created_at: new Date().toISOString(),
    }])
    try {
      const res = await sdk.guestChat.sendMessage(session.token, body)
      setMessages((prev) => prev.map((m) =>
        m.id === tempId ? { ...m, id: res.messageId, created_at: res.createdAt } : m
      ))
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      if (err?.status === 404 || err?.message?.includes('No hay conversacion activa')) {
        setIsClosed(true)
      }
    } finally {
      setIsSending(false)
    }
  }, [sdk, session])

  const sendFile = useCallback(async (file) => {
    if (!session?.token || !file) return
    setIsSending(true)
    try {
      const res = await sdk.guestChat.sendFileMessage(session.token, {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        file,
      })
      setMessages((prev) => [...prev, {
        id: res.messageId,
        body: file.name,
        sender_type: 'guest',
        message_type: 'file',
        created_at: res.createdAt,
        // Without this the guest's own upload rendered as bare filename text
        // (ChatWidget only shows an inline preview/attachment tile when
        // `attachments` is a non-empty array) — the attachment row is already
        // linked to this message server-side by this point, so the id
        // resolves a signed URL immediately via resolveAttUrl.
        attachments: [{ id: res.attachmentId, fileName: res.fileName, mimeType: res.mimeType, sizeBytes: res.sizeBytes }],
      }])
    } finally {
      setIsSending(false)
    }
  }, [sdk, session])

  const closeSession = useCallback(async () => {
    if (session?.token) {
      await sdk.guestChat.closeSession(session.token).catch(() => {})
    }
    clearStoredSession()
    setSession(null)
    setTrackingCode(null)
    setMessages([])
    setIsClosed(false)
    setOperatorTyping(false)
    setOperatorLastReadAt(null)
    setScreen('welcome')
  }, [sdk, session])

  const sendTyping = useCallback(() => {
    if (session?.token) sdk.guestChat.sendTyping(session.token).catch(() => {})
  }, [sdk, session])

  const markRead = useCallback(() => {
    if (session?.token) sdk.guestChat.markRead(session.token).catch(() => {})
  }, [sdk, session])

  return {
    screen,
    setScreen,
    availability,
    session,
    trackingCode,
    messages,
    isSending,
    isClosed,
    operatorTyping,
    operatorLastReadAt,
    startError,
    resumeError,
    startSession,
    resumeByCode,
    sendMessage,
    sendFile,
    sendTyping,
    markRead,
    closeSession,
  }
}
