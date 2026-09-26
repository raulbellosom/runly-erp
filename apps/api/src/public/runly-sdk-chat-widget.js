// ── Guest live chat: DOM rendering layer ───────────────────────────────────────
// Split out of runly-sdk-chat.js (the session/REST/realtime layer, consumed
// here via the private window.__runlyChatApi bridge) to keep each source
// file under the project's 1000-line soft limit — see CLAUDE.md "Atomic file
// size limit". Served concatenated with runly-sdk.js and runly-sdk-chat.js
// as a single script (see serveRunlySdk in apps/api/src/index.js); the split
// is invisible to embedding sites, which still see one window.RunlyERP.
//
// Vanilla-JS port of packages/storefront-sdk/src/react/ChatWidget.jsx +
// useGuestChat.js, for plain-HTML sites that only get this one script (no
// npm install, no bundler — see README.md "Pattern C"). Every state change
// re-renders by tearing down and rebuilding the affected DOM subtree, the
// same reset-and-rebuild approach runly-sdk.js's renderForm already uses —
// the whole widget is a few hundred nodes at most, so this is simpler and
// safer than a hand-rolled diffing layer for a script this size. The one
// deliberate exception is the chat screen's footer (textarea, send/clip
// buttons): see the comment above ensureChatShell/updateChatDynamic below.
;(function (global) {
  'use strict'

  // Read once at load — runly-sdk-chat.js must run before this file (see
  // serveRunlySdk's concatenation order). Deleted immediately so it never
  // becomes part of the public surface an embedding site could see or rely on.
  var chatApi = global.__runlyChatApi
  delete global.__runlyChatApi

  var DEFAULT_ACCENT = '#c7f049'
  var DEFAULT_BG  = '#111118'
  var DEFAULT_BG2 = '#1a1a24'
  var DEFAULT_BG3 = '#252535'

  // ── DOM helpers ──────────────────────────────────────────────────────────────
  function el(tag, styleObj, attrs) {
    var node = global.document.createElement(tag)
    if (styleObj) Object.assign(node.style, styleObj)
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'text') node.textContent = attrs.text
        else if (key === 'on') {
          Object.keys(attrs.on).forEach(function (evt) { node.addEventListener(evt, attrs.on[evt]) })
        } else if (key === 'attr') {
          Object.keys(attrs.attr).forEach(function (name) { node.setAttribute(name, attrs.attr[name]) })
        } else {
          node[key] = attrs[key]
        }
      })
    }
    return node
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild) }
  function append(node) {
    for (var i = 1; i < arguments.length; i++) {
      if (arguments[i]) node.appendChild(arguments[i])
    }
    return node
  }

  function fmtTime(dateStr) {
    if (!dateStr) return ''
    try { return new Date(dateStr).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) }
    catch (e) { return '' }
  }
  function fmtDay(dateStr) {
    if (!dateStr) return ''
    try {
      var d = new Date(dateStr)
      var today = new Date()
      var yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      if (d.toDateString() === today.toDateString()) return 'Hoy'
      if (d.toDateString() === yesterday.toDateString()) return 'Ayer'
      return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
    } catch (e) { return '' }
  }
  function fmtSize(bytes) {
    var n = Number(bytes)
    if (!n || isNaN(n)) return ''
    if (n < 1024) return n + ' B'
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB'
    return (n / (1024 * 1024)).toFixed(1) + ' MB'
  }
  function playBeep() {
    try {
      var ctx = new (global.AudioContext || global.webkitAudioContext)()
      var osc = ctx.createOscillator()
      var gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 880
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.2)
    } catch (e) { /* non-fatal */ }
  }

  function ensureKeyframesStyle() {
    if (global.document.getElementById('_runly_chat_keyframes')) return
    var style = global.document.createElement('style')
    style.id = '_runly_chat_keyframes'
    style.textContent =
      '@keyframes runlyChatSpin { to { transform: rotate(360deg) } }' +
      '@keyframes runlyChatBlink { 0%, 100% { opacity: 1 } 50% { opacity: 0.25 } }'
    global.document.head.appendChild(style)
  }

  // Small icon set — same paths as ChatWidget.jsx's inline SVGs.
  function svgIcon(color, strokeWidth, paths, size) {
    var ns = 'http://www.w3.org/2000/svg'
    var svg = global.document.createElementNS ? global.document.createElementNS(ns, 'svg') : global.document.createElement('svg')
    svg.setAttribute('width', size || 14)
    svg.setAttribute('height', size || 14)
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', color)
    svg.setAttribute('stroke-width', strokeWidth || 2)
    svg.setAttribute('aria-hidden', 'true')
    paths.forEach(function (p) {
      var node = global.document.createElementNS
        ? global.document.createElementNS(ns, p.tag)
        : global.document.createElement(p.tag)
      Object.keys(p.attr).forEach(function (a) { node.setAttribute(a, p.attr[a]) })
      svg.appendChild(node)
    })
    return svg
  }
  function chatIcon(color) {
    return svgIcon(color, 2.5, [{ tag: 'path', attr: { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' } }])
  }
  function mailIcon(color) {
    return svgIcon(color, 2.5, [
      { tag: 'path', attr: { d: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z' } },
      { tag: 'polyline', attr: { points: '22,6 12,13 2,6' } },
    ])
  }
  function sendIcon() {
    return svgIcon('#0f0f13', 2.5, [
      { tag: 'line', attr: { x1: 22, y1: 2, x2: 11, y2: 13 } },
      { tag: 'polygon', attr: { points: '22 2 15 22 11 13 2 9 22 2' } },
    ])
  }
  function clipIcon(color) {
    return svgIcon(color || '#888', 2, [
      { tag: 'path', attr: { d: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48' } },
    ])
  }

  // ── Widget factory ───────────────────────────────────────────────────────────
  function createChatWidget(userOptions) {
    var opts         = userOptions || {}
    var companyName  = opts.companyName || 'Chat'
    var accentColor  = opts.accentColor || DEFAULT_ACCENT

    var state = {
      open: false,
      screen: 'welcome', // welcome | identify | resume | chat
      availability: null,
      session: null, // { token, conversationId, email, name }
      trackingCode: chatApi.loadTrackingCode(),
      messages: [],
      isSending: false,
      isClosed: false,
      operatorTyping: false,
      operatorLastReadAt: null,
      startError: null,
      resumeError: null,
      isResuming: false,
      unreadCount: 0,
      lightboxUrl: null,
      nameInput: '',
      emailInput: '',
      emailError: '',
      textInput: '',
      resumeCodeInput: '',
      resumeEmailInput: '',
    }

    var attUrlCache = {} // attachmentId -> url ('' = in flight)
    var lastScreen = null // tracks whether the chat shell needs (re)building
    var prevMessageCount = 0
    var typingSentAt = 0
    var pollTimer = null
    var markReadTimer = null
    var unsubscribeRealtime = null
    var destroyed = false

    function setState(patch) {
      Object.assign(state, patch)
      render()
    }

    // ── Attachment URL resolution (mirrors resolveAttUrl/dropAttUrl) ──────────
    function resolveAttUrl(attId) {
      if (!attId || !state.session) return null
      if (attUrlCache[attId] === '') return null // in flight
      if (attUrlCache[attId]) return attUrlCache[attId]
      attUrlCache[attId] = ''
      chatApi.apiGetAttachmentUrl(state.session.token, attId)
        .then(function (url) { if (url) { attUrlCache[attId] = url; render() } })
        .catch(function () { delete attUrlCache[attId] })
      return null
    }
    function dropAttUrl(attId) {
      delete attUrlCache[attId]
      render()
    }

    // ── Session lifecycle ──────────────────────────────────────────────────────
    function startSession(data) {
      state.startError = null
      return chatApi.apiCreateSession(data)
        .then(function (res) {
          chatApi.storeSession(res.token, { conversationId: res.conversationId })
          chatApi.storeTrackingCode(res.trackingCode)
          setState({
            trackingCode: res.trackingCode || null,
            session: { token: res.token, conversationId: res.conversationId, email: data && data.email, name: data && data.name },
            messages: [],
            isClosed: false,
            screen: 'chat',
          })
          startRealtimeAndPolling(res.token, res.conversationId, res.realtimeToken)
          return res
        })
        .catch(function (err) {
          setState({ startError: err && err.message ? err.message : 'No se pudo iniciar la sesion. Intentalo de nuevo.' })
          throw err
        })
    }

    function resumeByCode(code, email) {
      state.resumeError = null
      return chatApi.apiResumeByCode(String(code).trim().toUpperCase(), String(email).trim())
        .then(function (res) {
          chatApi.storeSession(res.token, { conversationId: res.conversationId })
          chatApi.storeTrackingCode(res.trackingCode)
          return chatApi.apiListMessages(res.token).then(function (msgRes) {
            setState({
              trackingCode: res.trackingCode || code,
              session: { token: res.token, conversationId: res.conversationId, email: email },
              messages: msgRes.messages || [],
              operatorLastReadAt: msgRes.operatorLastReadAt || null,
              screen: 'chat',
            })
            startRealtimeAndPolling(res.token, res.conversationId, res.realtimeToken)
            return res
          })
        })
        .catch(function (err) {
          setState({ resumeError: err && err.message ? err.message : 'No se pudo encontrar la conversacion. Verifica el numero y correo.' })
          throw err
        })
    }

    function closeSession() {
      var token = state.session && state.session.token
      var after = function () {
        chatApi.clearStoredSession()
        stopRealtimeAndPolling()
        setState({
          session: null, trackingCode: null, messages: [], isClosed: false,
          operatorTyping: false, operatorLastReadAt: null, screen: 'welcome',
        })
      }
      if (!token) { after(); return Promise.resolve() }
      return chatApi.apiCloseSession(token).catch(function () {}).then(after)
    }

    function sendMessage(body) {
      if (!state.session || !body || !String(body).trim()) return
      var tempId = 'temp-' + Date.now()
      state.messages = state.messages.concat([{ id: tempId, body: body, sender_type: 'guest', created_at: new Date().toISOString() }])
      render()
      chatApi.apiSendMessage(state.session.token, body)
        .then(function (res) {
          state.messages = state.messages.map(function (m) {
            return m.id === tempId ? Object.assign({}, m, { id: res.messageId, created_at: res.createdAt }) : m
          })
          render()
        })
        .catch(function (err) {
          state.messages = state.messages.filter(function (m) { return m.id !== tempId })
          if ((err && err.status === 404) || /No hay conversacion activa/i.test((err && err.message) || '')) {
            state.isClosed = true
          }
          render()
        })
    }

    function sendFile(file) {
      if (!state.session || !file) return
      setState({ isSending: true })
      chatApi.apiSendFileMessage(state.session.token, {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        file: file,
      }).then(function (res) {
        state.messages = state.messages.concat([{
          id: res.messageId,
          body: file.name,
          sender_type: 'guest',
          message_type: 'file',
          created_at: res.createdAt,
          attachments: [{ id: res.attachmentId, fileName: res.fileName, mimeType: res.mimeType, sizeBytes: res.sizeBytes }],
        }])
        setState({ isSending: false })
      }).catch(function () {
        setState({ isSending: false })
      })
    }

    function sendTypingThrottled() {
      if (!state.session) return
      var now = Date.now()
      if (now - typingSentAt > 3000) {
        typingSentAt = now
        chatApi.apiSendTyping(state.session.token).catch(function () {})
      }
    }

    function markReadDebounced() {
      global.clearTimeout(markReadTimer)
      markReadTimer = global.setTimeout(function () {
        if (state.session) chatApi.apiMarkRead(state.session.token).catch(function () {})
      }, 800)
    }

    // ── Polling safety net + realtime enhancement ─────────────────────────────
    function pollOnce() {
      if (!state.session) return
      chatApi.apiListMessages(state.session.token).then(function (res) {
        if (!state.session) return
        if (res.operatorLastReadAt) state.operatorLastReadAt = res.operatorLastReadAt
        var incomingById = {}
        ;(res.messages || []).forEach(function (m) { incomingById[m.id] = m })
        var seen = {}
        state.messages.forEach(function (m) { seen[m.id] = true })
        var merged = state.messages.map(function (m) { return incomingById[m.id] || m })
        var newOnes = (res.messages || []).filter(function (m) { return !seen[m.id] })
        state.messages = merged.concat(newOnes)
        render()
      }).catch(function () { /* non-fatal */ })
    }

    function startRealtimeAndPolling(token, conversationId, realtimeToken) {
      stopRealtimeAndPolling()
      pollTimer = global.setInterval(pollOnce, 8000)
      unsubscribeRealtime = chatApi.subscribeToReplies(conversationId, realtimeToken, {
        onMessage: function (payload) {
          if (!state.session || String(payload.messageId).indexOf('temp-') === 0) return
          var exists = state.messages.some(function (m) { return m.id === payload.messageId })
          if (exists) return
          state.messages = state.messages.concat([{
            id: payload.messageId,
            body: payload.body,
            sender_type: payload.senderType,
            senderName: payload.senderName || null,
            senderAvatarUrl: payload.senderAvatarUrl || null,
            created_at: payload.createdAt,
          }])
          render()
        },
        onTyping: function () {
          setState({ operatorTyping: true })
          global.clearTimeout(subscribeToReplies._typingTimer)
          subscribeToReplies._typingTimer = global.setTimeout(function () { setState({ operatorTyping: false }) }, 4000)
        },
        onRead: function (payload) {
          setState({ operatorLastReadAt: (payload && payload.at) || new Date().toISOString() })
        },
        onClose: function () { setState({ isClosed: true }) },
      })
    }
    function stopRealtimeAndPolling() {
      if (pollTimer) { global.clearInterval(pollTimer); pollTimer = null }
      if (unsubscribeRealtime) { unsubscribeRealtime(); unsubscribeRealtime = null }
    }

    // ── DOM roots (built once; content is rebuilt on every render()) ──────────
    var tabEl     = el('div', null, { className: '_ae-chat-tab', attr: { role: 'button', 'aria-label': 'Abrir chat' }, on: { click: function () { setState({ open: true }) } } })
    var panelEl   = el('div', null, { className: '_ae-chat-panel', attr: { role: 'dialog', 'aria-label': 'Chat de soporte' } })
    var headerEl  = el('div')
    var bodyEl    = el('div')
    var overlayEl = el('div', { position: 'fixed', inset: '0', zIndex: '9997' }, { on: { click: function () { setState({ open: false }) } } })
    var lightboxEl = el('div', {
      position: 'fixed', inset: '0', zIndex: '10000', background: 'rgba(0,0,0,0.85)',
      display: 'none', alignItems: 'center', justifyContent: 'center',
    }, { on: { click: function () { setState({ lightboxUrl: null }) } } })

    append(panelEl, headerEl, bodyEl)

    // ── Screen renderers ───────────────────────────────────────────────────────
    function styleTextArea(elm) {
      elm.style.height = '36px'
      elm.style.height = Math.min(elm.scrollHeight, 140) + 'px'
    }

    function renderWelcome(container) {
      var availability = state.availability
      var isAvailable = availability ? Boolean(availability.available) : false
      var agentsOnline = (availability && availability.agentsOnline) || 0

      var card = el('div', { background: DEFAULT_BG2, borderRadius: '8px', padding: '14px', marginBottom: '6px' })
      card.appendChild(el('div', { color: '#ddd', fontWeight: '700', fontSize: '14px', marginBottom: '6px' }, { text: 'Como te podemos ayudar?' }))
      var badge = el('div', { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' })
      badge.appendChild(el('span', { width: '7px', height: '7px', borderRadius: '50%', background: isAvailable ? '#22c55e' : '#666', flexShrink: '0' }))
      badge.appendChild(el('span', { color: isAvailable ? '#86efac' : '#888', fontSize: '11px' }, {
        text: isAvailable
          ? agentsOnline + ' agente' + (agentsOnline !== 1 ? 's' : '') + ' disponible' + (agentsOnline !== 1 ? 's' : '')
          : 'Sin agentes disponibles ahora',
      }))
      card.appendChild(badge)
      if (isAvailable) {
        card.appendChild(el('div', { color: '#555', fontSize: '11px', marginTop: '2px' }, { text: 'Tiempo de respuesta tipico: <5 min' }))
      }
      container.appendChild(card)

      var optionBtn = el('button', optionBtnStyle(), { className: '_ae-chat-option', on: { click: function () { setState({ screen: 'identify' }) } } })
      optionBtn.appendChild(isAvailable ? chatIcon(accentColor) : mailIcon(accentColor))
      optionBtn.appendChild(el('span', null, { text: isAvailable ? 'Hablar con un agente' : 'Dejar un mensaje' }))
      container.appendChild(optionBtn)

      var resumeBtn = el('button', ghostBtnStyle({ marginTop: '6px', fontSize: '11px', color: '#555' }), {
        text: 'Tengo un numero de seguimiento',
        on: { click: function () { setState({ screen: 'resume' }) } },
      })
      container.appendChild(resumeBtn)
    }

    function renderIdentify(container) {
      container.appendChild(backBtn(function () { setState({ screen: 'welcome' }) }))
      container.appendChild(el('div', { color: '#ddd', fontWeight: '700', fontSize: '13px', marginBottom: '4px' }, { text: 'Antes de empezar' }))
      container.appendChild(el('div', { color: '#666', fontSize: '11px', marginBottom: '14px' }, {
        text: 'Tu correo nos permite darte seguimiento si la conversacion se interrumpe.',
      }))

      var nameField = labeledInput('Nombre (opcional)', 'text', 'Tu nombre', state.nameInput, function (v) { state.nameInput = v })
      container.appendChild(nameField.wrap)

      var emailWrap = el('div', { marginBottom: '14px' })
      emailWrap.appendChild(el('div', labelStyle(), { text: 'Correo electronico *' }))
      var emailInput = el('input', inputStyle(Boolean(state.emailError)), {
        type: 'email', placeholder: 'tu@correo.com', value: state.emailInput, className: '_ae-chat-email',
        on: {
          input: function (e) { state.emailInput = e.target.value; state.emailError = '' },
          keydown: function (e) { if (e.key === 'Enter') handleStartChat() },
        },
      })
      emailWrap.appendChild(emailInput)
      if (state.emailError) emailWrap.appendChild(el('div', errorMsgStyle(), { text: state.emailError }))
      container.appendChild(emailWrap)

      function handleStartChat() {
        var email = emailInput.value.trim()
        if (!email || !/\S+@\S+\.\S+/.test(email)) {
          setState({ emailError: 'Ingresa un correo valido.' })
          return
        }
        startSession({ email: email, name: nameField.input.value.trim() || undefined }).catch(function () {})
      }

      container.appendChild(el('button', primaryBtnStyle(), { text: 'Iniciar chat', className: '_ae-chat-start', on: { click: handleStartChat } }))
      if (state.startError) container.appendChild(el('div', errorMsgStyle(), { text: state.startError }))
      container.appendChild(el('button', ghostBtnStyle(), {
        text: 'Continuar sin correo',
        on: { click: function () { startSession({}).catch(function () {}) } },
      }))
    }

    function renderResume(container) {
      container.appendChild(backBtn(function () { setState({ screen: 'welcome' }) }))
      container.appendChild(el('div', { color: '#ddd', fontWeight: '700', fontSize: '13px', marginBottom: '4px' }, { text: 'Retomar conversacion' }))
      container.appendChild(el('div', { color: '#666', fontSize: '11px', marginBottom: '14px' }, {
        text: 'Ingresa tu numero de seguimiento y el correo que usaste al iniciar el chat.',
      }))

      var codeWrap = el('div', { marginBottom: '10px' })
      codeWrap.appendChild(el('div', labelStyle(), { text: 'Numero de seguimiento' }))
      var codeInput = el('input', inputStyle(false, { textTransform: 'uppercase', letterSpacing: '0.05em' }), {
        type: 'text', placeholder: 'CHAT-000001', value: state.resumeCodeInput,
        on: {
          input: function (e) { e.target.value = e.target.value.toUpperCase(); state.resumeCodeInput = e.target.value },
          keydown: function (e) { if (e.key === 'Enter') handleResume() },
        },
      })
      codeWrap.appendChild(codeInput)
      container.appendChild(codeWrap)

      var emailWrap = el('div', { marginBottom: '14px' })
      emailWrap.appendChild(el('div', labelStyle(), { text: 'Correo electronico' }))
      var emailInput = el('input', inputStyle(false), {
        type: 'email', placeholder: 'tu@correo.com', value: state.resumeEmailInput,
        on: {
          input: function (e) { state.resumeEmailInput = e.target.value },
          keydown: function (e) { if (e.key === 'Enter') handleResume() },
        },
      })
      emailWrap.appendChild(emailInput)
      container.appendChild(emailWrap)

      var submitBtn = el('button', primaryBtnStyle(state.isResuming ? { opacity: '0.6' } : {}), {
        text: state.isResuming ? 'Buscando...' : 'Continuar conversacion',
        disabled: state.isResuming,
        on: { click: handleResume },
      })
      container.appendChild(submitBtn)
      if (state.resumeError) container.appendChild(el('div', errorMsgStyle(), { text: state.resumeError }))

      function handleResume() {
        if (!codeInput.value.trim() || !emailInput.value.trim()) return
        setState({ isResuming: true })
        resumeByCode(codeInput.value, emailInput.value)
          .catch(function () {})
          .then(function () { state.isResuming = false; render() })
      }
    }

    function renderAttachment(att, isOwn) {
      var mime = String((att && (att.mimeType || att.mime_type)) || '')
      var name = (att && (att.fileName || att.file_name)) || 'archivo'
      var isImage = mime.indexOf('image/') === 0
      var url = resolveAttUrl(att.id)

      if (isImage) {
        if (!url) {
          var placeholder = el('div', {
            width: '160px', height: '120px', background: '#2a2a38', borderRadius: '8px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          })
          placeholder.appendChild(el('span', {
            width: '16px', height: '16px', border: '2px solid #555', borderTopColor: '#aaa',
            borderRadius: '50%', display: 'inline-block', animation: 'runlyChatSpin 0.8s linear infinite',
          }))
          return placeholder
        }
        return el('img', {
          maxWidth: '180px', maxHeight: '180px', borderRadius: '8px', cursor: 'pointer',
          objectFit: 'cover', display: 'block',
        }, {
          src: url, alt: name,
          on: {
            click: function () { setState({ lightboxUrl: url }) },
            error: function () { dropAttUrl(att.id) },
          },
        })
      }

      var accent = isOwn ? '#0f0f13' : '#ddd'
      var link = el('a', {
        display: 'flex', alignItems: 'center', gap: '8px', background: '#2a2a38', borderRadius: '8px',
        padding: '8px 10px', textDecoration: 'none', color: accent, fontSize: '12px', maxWidth: '200px',
      }, { attr: { href: url || '#', target: '_blank', rel: 'noopener noreferrer' } })
      link.appendChild(clipIcon(accent))
      link.appendChild(el('span', { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, { text: name }))
      var size = fmtSize(att && (att.sizeBytes || att.size_bytes))
      if (size) link.appendChild(el('span', { color: '#666', flexShrink: '0' }, { text: size }))
      return link
    }

    // The chat screen's footer (textarea, clip/send buttons) is built ONCE per
    // entry into this screen and only ever mutated in place afterward — see
    // ensureChatShell/updateChatDynamic below. A naive full-subtree rebuild on
    // every render() (as every other screen does, and as this one first did)
    // would recreate the <textarea> every time a poll/realtime tick brought in
    // a new message, silently stealing focus and resetting the cursor out from
    // under anyone mid-sentence. The message list itself has no such problem
    // (nothing in it holds focus) and still rebuilds freely.
    var chatTrackRowEl = null
    var chatMessagesEl = null
    var chatClosedBarEl = null
    var chatTextAreaEl = null
    var chatSendBtnEl = null
    var chatClipBtnEl = null
    var chatFileInputEl = null

    function ensureChatShell(container) {
      clear(container)
      chatTrackRowEl = el('div')
      container.appendChild(chatTrackRowEl)

      chatMessagesEl = el('div', { flex: '1', overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' })
      container.appendChild(chatMessagesEl)

      chatClosedBarEl = el('div')
      container.appendChild(chatClosedBarEl)

      var footer = el('div', {
        padding: '10px 12px', borderTop: '1px solid ' + DEFAULT_BG3, display: 'flex',
        alignItems: 'flex-end', gap: '6px', flexShrink: '0',
      })

      chatFileInputEl = el('input', { display: 'none' }, {
        type: 'file', accept: 'image/*,.pdf,.doc,.docx,.txt',
        on: { change: function (e) { var f = e.target.files && e.target.files[0]; if (f) sendFile(f); e.target.value = '' } },
      })
      footer.appendChild(chatFileInputEl)

      chatClipBtnEl = el('button', clipBtnStyle(false), {
        type: 'button',
        attr: { 'aria-label': 'Adjuntar archivo', title: 'Adjuntar imagen o documento' },
        on: {
          mousedown: function (e) { e.preventDefault() },
          click: function () { if (!chatClipBtnEl.disabled) chatFileInputEl.click() },
        },
      })
      chatClipBtnEl.appendChild(clipIcon('#666'))
      footer.appendChild(chatClipBtnEl)

      function doSend() {
        if (chatSendBtnEl.disabled) return
        var body = chatTextAreaEl.value.trim()
        if (!body) return
        chatTextAreaEl.value = ''
        state.textInput = ''
        styleTextArea(chatTextAreaEl)
        sendMessage(body)
      }

      chatTextAreaEl = el('textarea', textAreaStyle(false), {
        placeholder: 'Escribe un mensaje...',
        value: state.textInput,
        className: '_ae-chat-textarea',
        rows: 1,
        on: {
          input: function (e) {
            state.textInput = e.target.value
            styleTextArea(e.target)
            sendTypingThrottled()
          },
          keydown: function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend() }
          },
        },
      })
      footer.appendChild(chatTextAreaEl)
      requestFrame(function () {
        styleTextArea(chatTextAreaEl)
        if (typeof chatTextAreaEl.focus === 'function') chatTextAreaEl.focus()
      })

      chatSendBtnEl = el('button', sendBtnStyle(false), {
        className: '_ae-chat-send',
        attr: { 'aria-label': 'Enviar mensaje' },
        on: { mousedown: function (e) { e.preventDefault() }, click: doSend },
      })
      chatSendBtnEl.appendChild(sendIcon())
      footer.appendChild(chatSendBtnEl)

      container.appendChild(footer)
    }

    function updateChatDynamic() {
      clear(chatTrackRowEl)
      if (state.trackingCode) {
        var trackRow = el('div', {
          background: DEFAULT_BG2, borderBottom: '1px solid ' + DEFAULT_BG3, padding: '5px 14px',
          display: 'flex', alignItems: 'center', gap: '6px', flexShrink: '0',
        })
        trackRow.appendChild(el('span', { fontSize: '9px', color: '#555', letterSpacing: '0.04em' }, { text: 'NUMERO DE SEGUIMIENTO' }))
        trackRow.appendChild(el('span', {
          fontSize: '10px', fontWeight: '700', color: accentColor, letterSpacing: '0.08em',
        }, { text: state.trackingCode }))
        chatTrackRowEl.appendChild(trackRow)
      }

      var messagesBody = chatMessagesEl
      clear(messagesBody)

      if (state.messages.length === 0) {
        messagesBody.appendChild(el('div', { color: '#555', fontSize: '11px', textAlign: 'center', marginTop: '20px' }, {
          text: 'Escribe tu primer mensaje para iniciar la conversacion.',
        }))
      }

      var lastGuestMsg = null
      for (var i = state.messages.length - 1; i >= 0; i--) {
        if (state.messages[i].sender_type === 'guest') { lastGuestMsg = state.messages[i]; break }
      }
      var seen = Boolean(
        lastGuestMsg && state.operatorLastReadAt &&
        new Date(state.operatorLastReadAt) >= new Date(lastGuestMsg.created_at)
      )

      var lastDay = null
      state.messages.forEach(function (msg) {
        var day = fmtDay(msg.created_at)
        if (day && day !== lastDay) {
          messagesBody.appendChild(el('div', { textAlign: 'center', fontSize: '10px', color: '#444', padding: '4px 0' }, { text: day }))
          lastDay = day
        }

        var isGuest = msg.sender_type === 'guest'
        var time = fmtTime(msg.created_at)
        var attachments = Array.isArray(msg.attachments) ? msg.attachments : []
        var hasAtt = attachments.length > 0
        var isLastGuest = lastGuestMsg && msg.id === lastGuestMsg.id
        var isTemp = String(msg.id).indexOf('temp-') === 0

        if (isGuest) {
          var row = el('div', { alignSelf: 'flex-end', maxWidth: '80%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' })
          if (hasAtt) attachments.forEach(function (att) { row.appendChild(renderAttachment(att, true)) })
          else row.appendChild(el('div', guestBubbleStyle(), { text: msg.body }))
          if (time) row.appendChild(el('div', { fontSize: '9px', color: '#666', marginTop: '2px', textAlign: 'right' }, { text: time }))
          if (isLastGuest && !isTemp) {
            row.appendChild(el('div', { fontSize: '9px', color: seen ? '#86efac' : '#666', marginTop: '2px', textAlign: 'right' }, {
              text: seen ? 'Visto' : 'Enviado',
            }))
          }
          messagesBody.appendChild(row)
          return
        }

        var senderName = msg.senderName || msg.sender_name || 'Agente'
        var avatarUrl = msg.senderAvatarUrl || msg.sender_avatar_url || null
        var initial = (senderName[0] || 'A').toUpperCase()

        var opRow = el('div', { display: 'flex', alignItems: 'flex-end', gap: '7px', alignSelf: 'flex-start', maxWidth: '80%' })
        var avatar = el('div', operatorAvatarStyle())
        if (avatarUrl) avatar.appendChild(el('img', { width: '100%', height: '100%', objectFit: 'cover' }, { src: avatarUrl, alt: senderName }))
        else avatar.textContent = initial
        opRow.appendChild(avatar)
        var opCol = el('div', { display: 'flex', flexDirection: 'column', gap: '4px' })
        opCol.appendChild(el('div', { fontSize: '9px', color: '#555', marginBottom: '2px' }, { text: senderName }))
        if (hasAtt) attachments.forEach(function (att) { opCol.appendChild(renderAttachment(att, false)) })
        else opCol.appendChild(el('div', operatorBubbleStyle(), { text: msg.body }))
        if (time) opCol.appendChild(el('div', { fontSize: '9px', color: '#444', marginTop: '2px', textAlign: 'right' }, { text: time }))
        opRow.appendChild(opCol)
        messagesBody.appendChild(opRow)
      })

      if (state.operatorTyping) {
        var typingRow = el('div', { display: 'flex', alignItems: 'flex-end', gap: '7px', alignSelf: 'flex-start', maxWidth: '80%' })
        var typingAvatar = el('div', operatorAvatarStyle(), { text: '·' })
        typingRow.appendChild(typingAvatar)
        var dots = el('div', Object.assign({}, operatorBubbleStyle(), { display: 'flex', gap: '3px', alignItems: 'center' }))
        for (var d = 0; d < 3; d++) {
          dots.appendChild(el('span', {
            width: '5px', height: '5px', borderRadius: '50%', background: '#888', display: 'inline-block',
            animation: 'runlyChatBlink 1s ' + (d * 0.15) + 's infinite',
          }))
        }
        typingRow.appendChild(dots)
        messagesBody.appendChild(typingRow)
      }

      messagesBody.scrollTop = messagesBody.scrollHeight

      clear(chatClosedBarEl)
      if (state.isClosed) {
        var closedBar = el('div', {
          padding: '8px 14px', background: '#1a1a24', borderTop: '1px solid #252535',
          color: '#888', fontSize: '11px', textAlign: 'center', flexShrink: '0',
        })
        closedBar.appendChild(el('span', null, { text: 'Esta conversacion fue cerrada. ' }))
        closedBar.appendChild(el('button', { background: 'none', border: 'none', color: accentColor, fontSize: '11px', cursor: 'pointer', padding: '0' }, {
          text: 'Iniciar nueva', on: { click: closeSession },
        }))
        chatClosedBarEl.appendChild(closedBar)
      }

      // Footer controls are persistent nodes (built once in ensureChatShell) —
      // only their disabled/visual state changes here, never their identity,
      // so the textarea never loses focus or cursor position mid-message.
      var disabled = state.isSending || state.isClosed
      chatClipBtnEl.disabled = disabled
      Object.assign(chatClipBtnEl.style, clipBtnStyle(disabled))
      chatSendBtnEl.disabled = disabled
      Object.assign(chatSendBtnEl.style, sendBtnStyle(disabled))
      chatTextAreaEl.disabled = state.isClosed
      chatTextAreaEl.placeholder = state.isClosed ? 'Esta conversacion ha sido cerrada.' : 'Escribe un mensaje...'
      Object.assign(chatTextAreaEl.style, textAreaStyle(state.isClosed))
    }

    // ── Shared style builders ─────────────────────────────────────────────────
    function optionBtnStyle() {
      return {
        width: '100%', background: DEFAULT_BG2, border: '1px solid ' + DEFAULT_BG3, borderRadius: '6px',
        padding: '10px 12px', color: '#ccc', fontSize: '12px', cursor: 'pointer', display: 'flex',
        alignItems: 'center', gap: '8px', textAlign: 'left',
      }
    }
    function ghostBtnStyle(extra) {
      return Object.assign({
        background: 'none', border: 'none', color: '#555', fontSize: '11px', cursor: 'pointer',
        padding: '6px 0', textAlign: 'center', width: '100%',
      }, extra || {})
    }
    function labelStyle() { return { color: '#888', fontSize: '11px', marginBottom: '3px' } }
    function inputStyle(hasError, extra) {
      return Object.assign({
        width: '100%', background: DEFAULT_BG2, border: '1px solid ' + (hasError ? '#ef4444' : DEFAULT_BG3),
        borderRadius: '5px', padding: '8px 10px', color: '#ddd', fontSize: '12px', outline: 'none', boxSizing: 'border-box',
      }, extra || {})
    }
    function errorMsgStyle() { return { color: '#f87171', fontSize: '10px', marginTop: '2px' } }
    function primaryBtnStyle(extra) {
      return Object.assign({
        width: '100%', background: accentColor, border: 'none', borderRadius: '5px', padding: '9px 12px',
        color: '#0f0f13', fontWeight: '700', fontSize: '12px', cursor: 'pointer', marginTop: '4px',
      }, extra || {})
    }
    function guestBubbleStyle() {
      return {
        background: accentColor, color: '#0f0f13', borderRadius: '10px 10px 2px 10px', padding: '7px 10px',
        fontSize: '13px', lineHeight: '1.45', maxWidth: '100%', minWidth: '48px', wordBreak: 'break-word',
        whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
      }
    }
    function operatorBubbleStyle() {
      return {
        background: DEFAULT_BG2, color: '#e0e0e0', borderRadius: '10px 10px 10px 2px', padding: '7px 10px',
        fontSize: '13px', lineHeight: '1.45', maxWidth: '100%', minWidth: '48px', wordBreak: 'break-word',
        whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
      }
    }
    function operatorAvatarStyle() {
      return {
        width: '26px', height: '26px', borderRadius: '50%', background: '#252535', border: '1px solid ' + DEFAULT_BG3,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700',
        color: accentColor, flexShrink: '0', overflow: 'hidden',
      }
    }
    function textAreaStyle(disabled) {
      return {
        flex: '1', background: DEFAULT_BG2, border: '1px solid ' + DEFAULT_BG3, borderRadius: '5px',
        padding: '7px 9px', color: '#ddd', fontSize: '12px', resize: 'none', outline: 'none',
        fontFamily: 'inherit', lineHeight: '1.45', minHeight: '36px', maxHeight: '140px', overflowY: 'auto',
        opacity: disabled ? '0.5' : '1',
      }
    }
    function sendBtnStyle(dim) {
      return {
        background: accentColor, border: 'none', borderRadius: '5px', width: '36px', height: '36px',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0',
        opacity: dim ? '0.5' : '1',
      }
    }
    function clipBtnStyle(dim) {
      return {
        background: 'none', border: 'none', color: '#555', width: '30px', height: '36px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0', padding: '0',
        opacity: dim ? '0.4' : '1',
      }
    }
    function backBtn(onClick) {
      return el('button', { background: 'none', border: 'none', color: '#666', fontSize: '11px', cursor: 'pointer', padding: '0 0 8px', textAlign: 'left' }, {
        text: '← Atras', on: { click: onClick },
      })
    }
    function labeledInput(labelText, type, placeholder, value, onChange) {
      var wrap = el('div', { marginBottom: '10px' })
      wrap.appendChild(el('div', labelStyle(), { text: labelText }))
      var input = el('input', inputStyle(false), {
        type: type, placeholder: placeholder, value: value,
        on: { input: function (e) { onChange(e.target.value) } },
      })
      wrap.appendChild(input)
      return { wrap: wrap, input: input }
    }
    function requestFrame(fn) {
      if (global.requestAnimationFrame) global.requestAnimationFrame(fn)
      else global.setTimeout(fn, 0)
    }

    // ── Full re-render ───────────────────────────────────────────────────────
    function render() {
      if (destroyed) return

      // Tab (closed launcher)
      Object.assign(tabEl.style, {
        position: 'fixed', right: '0', top: '50%', transform: 'translateY(-50%)', zIndex: '9999',
        background: accentColor, color: '#0f0f13', fontWeight: '700', fontSize: '11px', letterSpacing: '0.08em',
        padding: '10px 5px', borderRadius: '6px 0 0 6px', writingMode: 'vertical-rl', cursor: 'pointer',
        userSelect: 'none', boxShadow: '-2px 0 12px rgba(0,0,0,0.3)', display: state.open ? 'none' : 'block',
      })
      clear(tabEl)
      tabEl.appendChild(el('span', null, { text: 'CHAT' }))
      if (state.unreadCount > 0) {
        tabEl.appendChild(el('span', {
          position: 'absolute', top: '-6px', left: '-6px', minWidth: '18px', height: '18px', padding: '0 4px',
          borderRadius: '9px', background: '#ef4444', color: '#fff', fontSize: '10px', fontWeight: '700',
          display: 'flex', alignItems: 'center', justifyContent: 'center', writingMode: 'horizontal-tb',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
        }, { text: state.unreadCount > 9 ? '9+' : String(state.unreadCount) }))
      }

      // Panel shell
      Object.assign(panelEl.style, {
        position: 'fixed', top: '0', right: state.open ? '0' : '-340px', width: '320px', height: '100vh',
        background: DEFAULT_BG, borderLeft: '2px solid ' + accentColor, zIndex: '9998', display: 'flex',
        flexDirection: 'column', transition: 'right 0.25s ease', fontFamily: 'system-ui, -apple-system, sans-serif',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
      })

      // Header
      clear(headerEl)
      Object.assign(headerEl.style, {
        padding: '12px 16px', borderBottom: '1px solid ' + DEFAULT_BG3, display: 'flex',
        alignItems: 'center', justifyContent: 'space-between', flexShrink: '0',
      })
      var titleWrap = el('div', { display: 'flex', alignItems: 'center', gap: '7px' })
      if (state.screen === 'chat') {
        titleWrap.appendChild(el('span', { width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }))
      }
      titleWrap.appendChild(el('span', { color: accentColor, fontWeight: '700', fontSize: '13px' }, { text: companyName }))
      headerEl.appendChild(titleWrap)
      var headerActions = el('div', { display: 'flex', alignItems: 'center', gap: '8px' })
      if (state.screen === 'chat') {
        headerActions.appendChild(el('button', { background: 'none', border: 'none', color: '#555', fontSize: '11px', cursor: 'pointer', lineHeight: '1', padding: '0 2px' }, {
          text: 'Cerrar', attr: { title: 'Cerrar conversacion' }, on: { click: closeSession },
        }))
      }
      headerActions.appendChild(el('button', { background: 'none', border: 'none', color: '#666', fontSize: '18px', cursor: 'pointer', lineHeight: '1', padding: '0 2px' }, {
        text: '×', attr: { 'aria-label': 'Cerrar panel' }, on: { click: function () { setState({ open: false }) } },
      }))
      headerEl.appendChild(headerActions)

      // Body — welcome/identify/resume rebuild fully every time (nothing in
      // them needs to survive a render the way the chat textarea does, and
      // their own text inputs mutate `state.*Input` directly without calling
      // setState, so they're never rebuilt mid-keystroke either). The chat
      // screen's shell is instead built once per entry and only patched
      // in-place afterward — see ensureChatShell/updateChatDynamic above.
      if (state.screen !== 'chat') {
        lastScreen = state.screen
        clear(bodyEl)
        Object.assign(bodyEl.style, { flex: '1', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' })
        if (state.screen === 'welcome') renderWelcome(bodyEl)
        else if (state.screen === 'identify') renderIdentify(bodyEl)
        else if (state.screen === 'resume') renderResume(bodyEl)
      } else {
        Object.assign(bodyEl.style, { flex: '1', display: 'flex', flexDirection: 'column', overflow: 'hidden' })
        if (lastScreen !== 'chat') ensureChatShell(bodyEl)
        lastScreen = 'chat'
        updateChatDynamic()
      }

      overlayEl.style.display = state.open ? 'block' : 'none'
      lightboxEl.style.display = state.lightboxUrl ? 'flex' : 'none'
      clear(lightboxEl)
      if (state.lightboxUrl) {
        lightboxEl.appendChild(el('img', { maxWidth: '92%', maxHeight: '92%', borderRadius: '8px' }, { src: state.lightboxUrl, alt: '' }))
      }
    }

    // ── Sound + unread badge on new operator message while closed ─────────────
    function checkUnread() {
      var count = state.messages.length
      if (count > prevMessageCount && prevMessageCount > 0) {
        var last = state.messages[state.messages.length - 1]
        if (last && last.sender_type !== 'guest' && !state.open) {
          playBeep()
          state.unreadCount += 1
        }
      }
      prevMessageCount = count
      if (state.open) state.unreadCount = 0
    }
    // Replaces the plain setState defined above the render helpers — every
    // caller referencing `setState` by closure sees this version once it
    // runs, since none of them can fire before this synchronous setup
    // completes.
    setState = function (patch) {
      Object.assign(state, patch)
      checkUnread()
      if (state.open && state.screen === 'chat') markReadDebounced()
      render()
    }

    // ── Mount ──────────────────────────────────────────────────────────────────
    ensureKeyframesStyle()
    global.document.body.appendChild(tabEl)
    global.document.body.appendChild(overlayEl)
    global.document.body.appendChild(panelEl)
    global.document.body.appendChild(lightboxEl)

    chatApi.apiGetAvailability()
      .then(function (data) { setState({ availability: data }) })
      .catch(function () { setState({ availability: { available: false, agentsOnline: 0 } }) })

    var stored = chatApi.loadStoredSession()
    if (stored && stored.token && stored.conversationId) {
      chatApi.apiGetSession(stored.token)
        .then(function (data) {
          if (data && data.conversation && data.conversation.status === 'closed') {
            chatApi.clearStoredSession()
            setState({ trackingCode: null })
            return null
          }
          if (data && data.trackingCode) chatApi.storeTrackingCode(data.trackingCode)
          setState({
            trackingCode: (data && data.trackingCode) || state.trackingCode,
            session: { token: stored.token, conversationId: stored.conversationId, email: data && data.email, name: data && data.name },
            screen: 'chat',
          })
          startRealtimeAndPolling(stored.token, stored.conversationId, data && data.realtimeToken)
          return chatApi.apiListMessages(stored.token)
        })
        .then(function (res) {
          if (!res) return
          setState({ messages: res.messages || [], operatorLastReadAt: res.operatorLastReadAt || null })
        })
        .catch(function () { chatApi.clearStoredSession() })
    }

    render()

    return {
      open: function () { setState({ open: true }) },
      close: function () { setState({ open: false }) },
      destroy: function () {
        destroyed = true
        stopRealtimeAndPolling()
        global.clearTimeout(markReadTimer);
        [tabEl, overlayEl, panelEl, lightboxEl].forEach(function (node) {
          if (node.parentNode) node.parentNode.removeChild(node)
        })
      },
    }
  }

  var _chatInstance = null
  function renderChat(options) {
    if (_chatInstance) _chatInstance.destroy()
    _chatInstance = createChatWidget(options)
    return _chatInstance
  }

  global.RunlyERP = global.RunlyERP || {}
  global.RunlyERP.renderChat = renderChat
  global.AtlasERP = global.RunlyERP
})(window)
