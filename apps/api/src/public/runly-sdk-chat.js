// ── Guest live chat: session/REST/realtime layer ──────────────────────────────
// Split out of runly-sdk-chat-widget.js (the DOM rendering layer that
// consumes this file via the private window.__runlyChatApi bridge below) to
// keep each source file under the project's 1000-line soft limit — see
// CLAUDE.md "Atomic file size limit". Served concatenated with runly-sdk.js
// and runly-sdk-chat-widget.js as a single script (see serveRunlySdk in
// apps/api/src/index.js), so from an embedding site's point of view this is
// still one <script src> tag — the three-file split is an implementation
// detail invisible to window.RunlyERP consumers.
//
// Endpoints, storage keys and message shapes are kept identical to the npm
// package's packages/storefront-sdk/src/guestChat.js so both surfaces stay
// interchangeable; this is a vanilla-JS port for plain-HTML sites that only
// get this one script (no npm install, no bundler — see README.md
// "Pattern C").
;(function (global) {
  'use strict'

  var cfg          = global.RUNLY_CONFIG || global.ATLAS_CONFIG || {}
  var API_URL      = (cfg.apiUrl || '/').replace(/\/$/, '')
  var COMPANY      = cfg.company || ''
  var SUPABASE_URL = (cfg.supabaseUrl || '').replace(/\/$/, '')
  var SUPABASE_KEY = cfg.supabaseAnonKey || ''

  var TOKEN_KEY    = 'runly_chat_guest_token'
  var SESSION_KEY  = 'runly_chat_guest_session'
  var TRACKING_KEY = 'runly_chat_tracking_code'

  // ── Local storage session (mirrors useGuestChat.js) ─────────────────────────
  function readLocal(key) { try { return global.localStorage.getItem(key) } catch (e) { return null } }
  function writeLocal(key, value) { try { global.localStorage.setItem(key, value) } catch (e) {} }
  function removeLocal(key) { try { global.localStorage.removeItem(key) } catch (e) {} }

  function loadStoredSession() {
    var token = readLocal(TOKEN_KEY)
    var raw   = readLocal(SESSION_KEY)
    if (!token || !raw) return null
    try {
      var parsed = JSON.parse(raw)
      parsed.token = token
      return parsed
    } catch (e) { return null }
  }
  function storeSession(token, sessionData) {
    writeLocal(TOKEN_KEY, token)
    writeLocal(SESSION_KEY, JSON.stringify(sessionData))
  }
  function storeTrackingCode(code) { if (code) writeLocal(TRACKING_KEY, code) }
  function loadTrackingCode() { return readLocal(TRACKING_KEY) }
  function clearStoredSession() {
    removeLocal(TOKEN_KEY)
    removeLocal(SESSION_KEY)
    removeLocal(TRACKING_KEY)
  }

  // ── REST (mirrors packages/storefront-sdk/src/guestChat.js endpoint-for-endpoint) ──
  function request(path, options) {
    var requestOptions = options || {}
    var reqHeaders = Object.assign(
      { 'Content-Type': 'application/json', 'X-Runly-Company': COMPANY },
      requestOptions.headers || {}
    )
    return global.fetch(API_URL + path, Object.assign({}, requestOptions, { headers: reqHeaders }))
      .then(function (response) {
        return response.text().then(function (text) {
          var data = null
          try { data = text ? JSON.parse(text) : null } catch (e) { data = text }
          if (!response.ok) {
            var error = new Error((data && data.error) || 'Error ' + response.status)
            error.status = response.status
            throw error
          }
          return data
        })
      })
  }

  function apiCreateSession(data) {
    return request('/public/chat/session', { method: 'POST', body: JSON.stringify(data || {}) })
      .then(function (res) { return res.data })
  }
  function apiGetSession(token) {
    return request('/public/chat/session/' + encodeURIComponent(token)).then(function (res) { return res.data })
  }
  function apiSendMessage(token, body, messageType) {
    return request('/public/chat/session/' + encodeURIComponent(token) + '/messages', {
      method: 'POST',
      body: JSON.stringify({ body: body, messageType: messageType || 'text' }),
    }).then(function (res) { return res.data })
  }
  function apiListMessages(token) {
    return request('/public/chat/session/' + encodeURIComponent(token) + '/messages?limit=40').then(function (res) {
      var arr = Array.isArray(res.data) ? res.data : []
      var messages = arr.map(function (m) {
        return {
          id: m.id,
          body: m.body,
          sender_type: m.senderType || m.sender_type,
          message_type: m.messageType || m.message_type,
          created_at: m.createdAt || m.created_at,
          senderName: (m.sender && m.sender.displayName) || null,
          senderAvatarUrl: (m.sender && m.sender.avatarUrl) || null,
          metadata: m.metadata || null,
          attachments: m.attachments || null,
        }
      })
      return { messages: messages, operatorLastReadAt: res.operatorLastReadAt || null }
    })
  }
  function apiSendTyping(token) {
    return request('/public/chat/session/' + encodeURIComponent(token) + '/typing', { method: 'POST' })
  }
  function apiMarkRead(token) {
    return request('/public/chat/session/' + encodeURIComponent(token) + '/read', { method: 'POST' })
  }
  function apiGetAttachmentUrl(token, attachmentId) {
    return request(
      '/public/chat/session/' + encodeURIComponent(token) + '/attachments/' + encodeURIComponent(attachmentId) + '/url'
    ).then(function (res) { return (res.data && res.data.url) || null })
  }
  function apiPresignAttachment(token, opts) {
    return request('/public/chat/session/' + encodeURIComponent(token) + '/attachments/presign', {
      method: 'POST',
      body: JSON.stringify({ fileName: opts.fileName, mimeType: opts.mimeType, sizeBytes: opts.sizeBytes }),
    }).then(function (res) { return res.data })
  }
  function apiSendFileMessage(token, opts) {
    return apiPresignAttachment(token, opts).then(function (presigned) {
      return global.fetch(presigned.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': opts.mimeType },
        body: opts.file,
      }).then(function (uploadRes) {
        if (!uploadRes.ok) throw new Error('Upload failed: ' + uploadRes.status)
        return request('/public/chat/session/' + encodeURIComponent(token) + '/messages', {
          method: 'POST',
          body: JSON.stringify({
            body: opts.fileName,
            messageType: 'file',
            metadata: {
              attachmentId: presigned.attachmentId,
              fileName: opts.fileName,
              mimeType: opts.mimeType,
              sizeBytes: opts.sizeBytes,
            },
          }),
        }).then(function (res) {
          // Same fix as useGuestChat.js's sendFile: the send endpoint itself
          // never echoes the attachment back, so fold in what presign already
          // told us — otherwise the guest's own upload has nothing to render.
          return Object.assign({}, res.data, {
            attachmentId: presigned.attachmentId,
            fileName: opts.fileName,
            mimeType: opts.mimeType,
            sizeBytes: opts.sizeBytes,
          })
        })
      })
    })
  }
  function apiCloseSession(token) {
    return request('/public/chat/session/' + encodeURIComponent(token) + '/close', { method: 'POST' })
  }
  function apiGetAvailability() {
    return request('/public/storefront/chat/availability').then(function (res) { return res.data })
  }
  function apiResumeByCode(trackingCode, email) {
    return request('/public/chat/session/resume-by-code', {
      method: 'POST',
      body: JSON.stringify({ trackingCode: trackingCode, email: email }),
    }).then(function (res) { return res.data })
  }

  // ── Realtime (best-effort instant delivery) ─────────────────────────────────
  // The 8s poll inside createChatWidget (runly-sdk-chat-widget.js) is the
  // reliable path — exactly as it is in the React ChatWidget, where this same
  // realtime subscription is also just an optimization on top of an
  // always-running poll. Any failure here (CDN blocked, offline, older
  // browser) silently falls back to that poll instead of breaking the chat.
  var _supabasePromise = null
  function loadSupabaseClient() {
    if (!SUPABASE_URL || !SUPABASE_KEY) return Promise.reject(new Error('no realtime credentials'))
    if (_supabasePromise) return _supabasePromise
    _supabasePromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
      .then(function (mod) {
        return mod.createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { storageKey: 'runly-guest-chat', persistSession: false },
        })
      })
      .catch(function (err) { _supabasePromise = null; throw err })
    return _supabasePromise
  }

  // Mirrors guestChat.js's subscribeToReplies: same channel topic, same
  // broadcast event names, same revision-refresh cadence, so it talks to
  // exactly the same server-side broadcaster the React widget and the
  // internal operator app use.
  function subscribeToReplies(conversationId, realtimeToken, handlers) {
    var cancelled = false
    var client = null
    var channel = null
    var revision = null
    var refreshTimer = null
    var refreshing = false

    function setup() {
      if (cancelled || refreshing) return
      refreshing = true
      loadSupabaseClient()
        .then(function (c) {
          client = c
          if (realtimeToken) client.realtime.setAuth(realtimeToken)
          return request('/realtime/revision')
        })
        .then(function (res) {
          refreshing = false
          if (cancelled) return
          var next = res && res.revision
          if (next === revision) return
          revision = next
          if (channel) client.removeChannel(channel)
          if (cancelled) return
          channel = client
            .channel('chat:conv:' + conversationId + '@' + revision, { config: { private: true } })
            .on('broadcast', { event: 'new_operator_message' }, function (msg) {
              if (handlers.onMessage) handlers.onMessage(msg.payload)
            })
            .on('broadcast', { event: 'operator_typing' }, function (msg) {
              if (handlers.onTyping) handlers.onTyping(msg.payload)
            })
            .on('broadcast', { event: 'operator_read' }, function (msg) {
              if (handlers.onRead) handlers.onRead(msg.payload)
            })
            .on('broadcast', { event: 'conversation_closed' }, function () {
              if (handlers.onClose) handlers.onClose()
            })
            .subscribe()
        })
        .catch(function () { refreshing = false })
    }

    setup()
    refreshTimer = global.setInterval(setup, 10000)

    return function unsubscribe() {
      cancelled = true
      global.clearInterval(refreshTimer)
      if (channel && client) client.removeChannel(channel).catch(function () {})
    }
  }

  // Private handoff to runly-sdk-chat-widget.js, which reads and immediately
  // deletes this — it never becomes part of the public window.RunlyERP
  // surface an embedding site would see or rely on.
  global.__runlyChatApi = {
    loadStoredSession: loadStoredSession,
    storeSession: storeSession,
    storeTrackingCode: storeTrackingCode,
    loadTrackingCode: loadTrackingCode,
    clearStoredSession: clearStoredSession,
    apiCreateSession: apiCreateSession,
    apiGetSession: apiGetSession,
    apiSendMessage: apiSendMessage,
    apiListMessages: apiListMessages,
    apiSendTyping: apiSendTyping,
    apiMarkRead: apiMarkRead,
    apiGetAttachmentUrl: apiGetAttachmentUrl,
    apiSendFileMessage: apiSendFileMessage,
    apiCloseSession: apiCloseSession,
    apiGetAvailability: apiGetAvailability,
    apiResumeByCode: apiResumeByCode,
    subscribeToReplies: subscribeToReplies,
  }
})(window)
