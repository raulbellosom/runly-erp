export function createGuestChatDomain(request, supabaseUrl, supabaseAnonKey) {
  // Cached Supabase client for realtime — created once, reused across subscriptions.
  let _realtimeClient = null
  // The guest never has a real Supabase Auth session (see
  // apps/api/src/routes/chat/guest-service.js mintGuestRealtimeToken) — this
  // short-lived, self-signed token is what lets it join the private
  // chat:conv:<id> Realtime channel (migration
  // 20260911180000_chat_guest_realtime_authorization). Re-applied to the
  // client every time a REST call returns a fresh one (createSession,
  // getSession, resumeByCode, sendMessage) — no separate refresh loop needed,
  // it just rides along with normal guest activity.
  let _realtimeToken = null

  function _applyRealtimeToken(token) {
    if (!token) return
    _realtimeToken = token
    if (_realtimeClient) _realtimeClient.realtime.setAuth(token)
  }

  async function _getRealtimeClient() {
    if (_realtimeClient) return _realtimeClient
    let url = supabaseUrl
    let key = supabaseAnonKey
    if (!url || !key) {
      const res = await request('GET', '/public/storefront/realtime-config')
      url = res?.data?.supabaseUrl
      key = res?.data?.supabaseAnonKey
    }
    if (!url || !key) throw new Error('No realtime credentials available')
    const { createClient } = await import('@supabase/supabase-js')
    _realtimeClient = createClient(url, key, {
      auth: { storageKey: 'atlas-guest-chat', persistSession: false },
    })
    if (_realtimeToken) _realtimeClient.realtime.setAuth(_realtimeToken)
    return _realtimeClient
  }
  async function createSession(data = {}) {
    const res = await request('POST', '/public/chat/session', data)
    _applyRealtimeToken(res.data?.realtimeToken)
    return res.data
  }

  async function getSession(token) {
    const res = await request('GET', `/public/chat/session/${token}`)
    _applyRealtimeToken(res.data?.realtimeToken)
    return res.data
  }

  async function sendMessage(token, body, messageType = 'text') {
    const res = await request('POST', `/public/chat/session/${token}/messages`, { body, messageType })
    _applyRealtimeToken(res.data?.realtimeToken)
    return res.data
  }

  async function listMessages(token, { limit = 40, before = null } = {}) {
    const params = new URLSearchParams({ limit: String(limit) })
    if (before) params.set('before', before)
    const res = await request('GET', `/public/chat/session/${token}/messages?${params}`)
    const raw = res.data
    const arr = Array.isArray(raw) ? raw : []
    // Normalize to snake_case so the shape matches realtime broadcast payloads.
    const messages = arr.map((m) => ({
      id: m.id,
      body: m.body,
      sender_type: m.senderType ?? m.sender_type,
      message_type: m.messageType ?? m.message_type,
      created_at: m.createdAt ?? m.created_at,
      senderName: m.sender?.displayName ?? null,
      senderAvatarUrl: m.sender?.avatarUrl ?? null,
      metadata: m.metadata ?? null,
      attachments: m.attachments ?? null,
    }))
    return { messages, operatorLastReadAt: res.operatorLastReadAt ?? null }
  }

  async function sendTyping(token) {
    return request('POST', `/public/chat/session/${token}/typing`)
  }

  async function markRead(token) {
    return request('POST', `/public/chat/session/${token}/read`)
  }

  async function getAttachmentUrl(token, attachmentId) {
    const res = await request('GET', `/public/chat/session/${token}/attachments/${attachmentId}/url`)
    return res?.data?.url ?? null
  }

  async function closeSession(token) {
    return request('POST', `/public/chat/session/${token}/close`)
  }

  async function getAvailability() {
    const res = await request('GET', '/public/storefront/chat/availability')
    return res.data
  }

  // Accepts either an options object { onMessage, onTyping, onRead, onClose } or,
  // for back-compat, a bare onMessage function plus a legacy onClose arg.
  function subscribeToReplies(conversationId, arg2, legacyOnClose) {
    const opts = typeof arg2 === 'function' ? { onMessage: arg2, onClose: legacyOnClose } : (arg2 || {})
    const { onMessage, onTyping, onRead, onClose } = opts
    let channel = null
    let cancelled = false
    let revision = null
    let refreshing = false

    async function setup() {
      let client
      try {
        client = await _getRealtimeClient()
      } catch {
        return
      }
      if (cancelled || refreshing) return
      refreshing = true
      let next
      try { next = (await request('GET', '/realtime/revision')).revision } catch { refreshing = false; return }
      if (cancelled || next === revision) { refreshing = false; return }
      revision = next
      if (channel) await client.removeChannel(channel)
      refreshing = false
      if (cancelled) return

      // private: true — chat_conv_receive RLS policy (migration
      // 20260911180000_chat_guest_realtime_authorization) requires the
      // realtime token applied above (via _applyRealtimeToken) to actually
      // join; an unauthenticated/wrong-guest client is rejected at the
      // server, not just left to the topic string being unguessable.
      channel = client
        .channel(`chat:conv:${conversationId}@${revision}`, { config: { private: true } })
        .on('broadcast', { event: 'new_operator_message' }, ({ payload }) => {
          onMessage?.(payload)
        })
        .on('broadcast', { event: 'operator_typing' }, ({ payload }) => {
          onTyping?.(payload)
        })
        .on('broadcast', { event: 'operator_read' }, ({ payload }) => {
          onRead?.(payload)
        })
        .on('broadcast', { event: 'conversation_closed' }, () => {
          onClose?.()
        })
        .subscribe()
    }

    setup().catch(() => {})
    const refreshTimer = setInterval(() => setup().catch(() => {}), 10_000)

    return function unsubscribe() {
      cancelled = true
      clearInterval(refreshTimer)
      if (channel && _realtimeClient) {
        _realtimeClient.removeChannel(channel).catch(() => {})
      }
    }
  }

  async function presignAttachment(token, { fileName, mimeType, sizeBytes }) {
    const res = await request('POST', `/public/chat/session/${token}/attachments/presign`, { fileName, mimeType, sizeBytes })
    return res.data
  }

  async function sendFileMessage(token, { fileName, mimeType, sizeBytes, file }) {
    const { attachmentId, uploadUrl } = await presignAttachment(token, { fileName, mimeType, sizeBytes })
    const uploadRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: file })
    if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`)
    const res = await request('POST', `/public/chat/session/${token}/messages`, {
      body: fileName,
      messageType: 'file',
      metadata: { attachmentId, fileName, mimeType, sizeBytes },
    })
    // The send endpoint only returns { messageId, conversationId, createdAt,
    // realtimeToken } — the caller (useGuestChat's sendFile) needs the
    // attachment's own fields to render it immediately, so fold in what this
    // function already knows from the presign step above instead of forcing
    // a refetch just to see your own upload.
    return { ...res.data, attachmentId, fileName, mimeType, sizeBytes }
  }

  async function resumeByCode(trackingCode, email) {
    const res = await request('POST', '/public/chat/session/resume-by-code', { trackingCode, email })
    _applyRealtimeToken(res.data?.realtimeToken)
    return res.data
  }

  return {
    createSession,
    getSession,
    sendMessage,
    listMessages,
    closeSession,
    getAvailability,
    subscribeToReplies,
    presignAttachment,
    sendFileMessage,
    resumeByCode,
    sendTyping,
    markRead,
    getAttachmentUrl,
  }
}
