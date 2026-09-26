import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useGuestChat } from './useGuestChat.js'

const DEFAULT_ACCENT = '#c7f049'
const DEFAULT_BG = '#111118'
const DEFAULT_BG2 = '#1a1a24'
const DEFAULT_BG3 = '#252535'

function s(base, extra = {}) {
  return { ...base, ...extra }
}

function fmtTime(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

function fmtDay(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === today.toDateString()) return 'Hoy'
    if (d.toDateString() === yesterday.toDateString()) return 'Ayer'
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
  } catch { return '' }
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.2)
  } catch { /* non-fatal */ }
}

export function ChatWidget({ sdk, companyName = 'Chat', accentColor = DEFAULT_ACCENT }) {
  const [open, setOpen] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [emailError, setEmailError] = useState('')
  const [textInput, setTextInput] = useState('')
  const messagesEndRef = useRef(null)
  const prevMsgCountRef = useRef(0)
  const textAreaRef = useRef(null)
  const [unreadCount, setUnreadCount] = useState(0)

  const {
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
  } = useGuestChat(sdk)

  const [resumeCodeInput, setResumeCodeInput] = useState('')
  const [resumeEmailInput, setResumeEmailInput] = useState('')
  const [isResuming, setIsResuming] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const fileInputRef = useRef(null)
  const attUrlCacheRef = useRef(new Map())
  const typingSentAtRef = useRef(0)
  const [, forceRerender] = useReducer((n) => n + 1, 0)

  // Resolve (and cache) a short-lived signed URL for an attachment. Returns null
  // while in flight; re-renders when it lands. On <img> error the entry is
  // dropped so the next render retries once (signed URLs expire after 300s).
  const resolveAttUrl = useCallback((attId) => {
    if (!attId || !session?.token) return null
    const cached = attUrlCacheRef.current.get(attId)
    if (cached) return cached
    if (cached === '') return null // in flight
    attUrlCacheRef.current.set(attId, '')
    sdk.guestChat.getAttachmentUrl(session.token, attId)
      .then((url) => { if (url) { attUrlCacheRef.current.set(attId, url); forceRerender() } })
      .catch(() => { attUrlCacheRef.current.delete(attId) })
    return null
  }, [sdk, session])

  const dropAttUrl = useCallback((attId) => {
    attUrlCacheRef.current.delete(attId)
    forceRerender()
  }, [])

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0]
    if (file) { sendFile(file); e.target.value = '' }
  }, [sendFile])

  const handleResumeByCode = useCallback(async () => {
    if (!resumeCodeInput.trim() || !resumeEmailInput.trim()) return
    setIsResuming(true)
    try {
      await resumeByCode(resumeCodeInput, resumeEmailInput)
    } catch { /* error shown via resumeError */ }
    finally { setIsResuming(false) }
  }, [resumeByCode, resumeCodeInput, resumeEmailInput])

  // Scroll to bottom on new messages
  useEffect(() => {
    if (open && screen === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open, screen])

  // Mark the conversation read whenever the panel is open on the chat screen
  // (re-fires as new operator messages land while it stays open).
  useEffect(() => {
    if (open && screen === 'chat') {
      const t = setTimeout(() => markRead(), 800)
      return () => clearTimeout(t)
    }
  }, [open, screen, messages.length, markRead])

  // Sound + unread badge on new operator message when widget is not open —
  // the closed launcher (the "CHAT" side tab) previously gave no visual
  // signal at all that a reply had arrived, only this beep.
  useEffect(() => {
    const count = messages.length
    const prevCount = prevMsgCountRef.current
    if (count > prevCount && prevCount > 0) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg?.sender_type !== 'guest' && !open) {
        playBeep()
        setUnreadCount((n) => n + 1)
      }
    }
    prevMsgCountRef.current = count
  }, [messages, open])

  // Opening the panel clears the badge (markRead, above, separately tells the
  // operator side the messages were seen).
  useEffect(() => {
    if (open) setUnreadCount(0)
  }, [open])

  const handleStartChat = useCallback(async () => {
    if (!emailInput.trim() || !/\S+@\S+\.\S+/.test(emailInput)) {
      setEmailError('Ingresa un correo valido.')
      return
    }
    setEmailError('')
    await startSession({ email: emailInput.trim(), name: nameInput.trim() || undefined })
  }, [emailInput, nameInput, startSession])

  const handleSend = useCallback(() => {
    if (!textInput.trim()) return
    const body = textInput.trim()
    setTextInput('')
    sendMessage(body)
    requestAnimationFrame(() => textAreaRef.current?.focus())
  }, [textInput, sendMessage])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const agentsOnline = availability?.agentsOnline ?? 0
  const isAvailable = availability?.available ?? false

  // ── Styles ──────────────────────────────────────────────────────────────
  const styles = {
    tab: {
      position: 'fixed',
      right: 0,
      top: '50%',
      transform: 'translateY(-50%)',
      zIndex: 9999,
      background: accentColor,
      color: '#0f0f13',
      fontWeight: 700,
      fontSize: 11,
      letterSpacing: '0.08em',
      padding: '10px 5px',
      borderRadius: '6px 0 0 6px',
      writingMode: 'vertical-rl',
      cursor: 'pointer',
      userSelect: 'none',
      boxShadow: '-2px 0 12px rgba(0,0,0,0.3)',
      display: open ? 'none' : 'block',
    },
    unreadBadge: {
      position: 'absolute',
      top: -6,
      left: -6,
      minWidth: 18,
      height: 18,
      padding: '0 4px',
      borderRadius: 9,
      background: '#ef4444',
      color: '#fff',
      fontSize: 10,
      fontWeight: 700,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      writingMode: 'horizontal-tb', // undo the tab's vertical-rl for this label
      boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
    },
    panel: {
      position: 'fixed',
      top: 0,
      right: open ? 0 : -340,
      width: 320,
      height: '100vh',
      background: DEFAULT_BG,
      borderLeft: `2px solid ${accentColor}`,
      zIndex: 9998,
      display: 'flex',
      flexDirection: 'column',
      transition: 'right 0.25s ease',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
    },
    header: {
      padding: '12px 16px',
      borderBottom: `1px solid ${DEFAULT_BG3}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0,
    },
    headerTitle: {
      color: accentColor,
      fontWeight: 700,
      fontSize: 13,
    },
    closeBtn: {
      background: 'none',
      border: 'none',
      color: '#666',
      fontSize: 18,
      cursor: 'pointer',
      lineHeight: 1,
      padding: '0 2px',
    },
    body: {
      flex: 1,
      overflowY: 'auto',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    },
    welcomeCard: {
      background: DEFAULT_BG2,
      borderRadius: 8,
      padding: 14,
      marginBottom: 6,
    },
    welcomeTitle: {
      color: '#ddd',
      fontWeight: 700,
      fontSize: 14,
      marginBottom: 6,
    },
    availBadge: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      marginBottom: 4,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: isAvailable ? '#22c55e' : '#666',
      flexShrink: 0,
    },
    availText: {
      color: isAvailable ? '#86efac' : '#888',
      fontSize: 11,
    },
    responseTime: {
      color: '#555',
      fontSize: 11,
      marginTop: 2,
    },
    optionBtn: {
      width: '100%',
      background: DEFAULT_BG2,
      border: `1px solid ${DEFAULT_BG3}`,
      borderRadius: 6,
      padding: '10px 12px',
      color: '#ccc',
      fontSize: 12,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      textAlign: 'left',
    },
    label: {
      color: '#888',
      fontSize: 11,
      marginBottom: 3,
    },
    input: {
      width: '100%',
      background: DEFAULT_BG2,
      border: `1px solid ${DEFAULT_BG3}`,
      borderRadius: 5,
      padding: '8px 10px',
      color: '#ddd',
      fontSize: 12,
      outline: 'none',
      boxSizing: 'border-box',
    },
    inputError: {
      borderColor: '#ef4444',
    },
    errorMsg: {
      color: '#f87171',
      fontSize: 10,
      marginTop: 2,
    },
    primaryBtn: {
      width: '100%',
      background: accentColor,
      border: 'none',
      borderRadius: 5,
      padding: '9px 12px',
      color: '#0f0f13',
      fontWeight: 700,
      fontSize: 12,
      cursor: 'pointer',
      marginTop: 4,
    },
    ghostBtn: {
      background: 'none',
      border: 'none',
      color: '#555',
      fontSize: 11,
      cursor: 'pointer',
      padding: '6px 0',
      textAlign: 'center',
      width: '100%',
    },
    backBtn: {
      background: 'none',
      border: 'none',
      color: '#666',
      fontSize: 11,
      cursor: 'pointer',
      padding: '0 0 8px',
      textAlign: 'left',
    },
    msgBubbleGuest: {
      background: accentColor,
      color: '#0f0f13',
      borderRadius: '10px 10px 2px 10px',
      padding: '7px 10px',
      fontSize: 13,
      lineHeight: '1.45',
      maxWidth: '100%',
      minWidth: 48,
      wordBreak: 'break-word',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
    },
    msgBubbleOperator: {
      background: DEFAULT_BG2,
      color: '#e0e0e0',
      borderRadius: '10px 10px 10px 2px',
      padding: '7px 10px',
      fontSize: 13,
      lineHeight: '1.45',
      maxWidth: '100%',
      minWidth: 48,
      wordBreak: 'break-word',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
    },
    chatFooter: {
      padding: '10px 12px',
      borderTop: `1px solid ${DEFAULT_BG3}`,
      display: 'flex',
      alignItems: 'flex-end',
      gap: 6,
      flexShrink: 0,
    },
    textArea: {
      flex: 1,
      background: DEFAULT_BG2,
      border: `1px solid ${DEFAULT_BG3}`,
      borderRadius: 5,
      padding: '7px 9px',
      color: '#ddd',
      fontSize: 12,
      resize: 'none',
      outline: 'none',
      fontFamily: 'inherit',
      lineHeight: '1.45',
      minHeight: 36,
      maxHeight: 140,
      overflowY: 'auto',
    },
    sendBtn: {
      background: accentColor,
      border: 'none',
      borderRadius: 5,
      width: 36,
      height: 36,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    clipBtn: {
      background: 'none',
      border: 'none',
      color: '#555',
      width: 30,
      height: 36,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      padding: 0,
    },
    dayDivider: {
      textAlign: 'center',
      fontSize: 10,
      color: '#444',
      padding: '4px 0',
      userSelect: 'none',
    },
    msgTimestamp: {
      fontSize: 9,
      color: '#444',
      marginTop: 2,
      textAlign: 'right',
    },
    operatorRow: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 7,
      alignSelf: 'flex-start',
      maxWidth: '80%',
    },
    operatorAvatar: {
      width: 26,
      height: 26,
      borderRadius: '50%',
      background: '#252535',
      border: `1px solid ${DEFAULT_BG3}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 11,
      fontWeight: 700,
      color: accentColor,
      flexShrink: 0,
      overflow: 'hidden',
    },
    operatorMeta: {
      fontSize: 9,
      color: '#555',
      marginBottom: 2,
    },
  }

  // ── Render helpers ───────────────────────────────────────────────────────

  function renderWelcome() {
    return (
      <>
        <div style={styles.welcomeCard}>
          <div style={styles.welcomeTitle}>Como te podemos ayudar?</div>
          <div style={styles.availBadge}>
            <span style={styles.dot} />
            <span style={styles.availText}>
              {isAvailable
                ? `${agentsOnline} agente${agentsOnline !== 1 ? 's' : ''} disponible${agentsOnline !== 1 ? 's' : ''}`
                : 'Sin agentes disponibles ahora'}
            </span>
          </div>
          {isAvailable && (
            <div style={styles.responseTime}>Tiempo de respuesta tipico: &lt;5 min</div>
          )}
        </div>

        {isAvailable ? (
          <button style={styles.optionBtn} onClick={() => setScreen('identify')}>
            <ChatIcon color={accentColor} />
            Hablar con un agente
          </button>
        ) : (
          <button style={styles.optionBtn} onClick={() => setScreen('identify')}>
            <MailIcon color={accentColor} />
            Dejar un mensaje
          </button>
        )}

        <button
          style={s(styles.ghostBtn, { marginTop: 6, fontSize: 11, color: '#555' })}
          onClick={() => setScreen('resume')}
        >
          Tengo un numero de seguimiento
        </button>
      </>
    )
  }

  function renderResume() {
    return (
      <>
        <button style={styles.backBtn} onClick={() => setScreen('welcome')}>← Atras</button>
        <div style={{ color: '#ddd', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Retomar conversacion</div>
        <div style={{ color: '#666', fontSize: 11, marginBottom: 14 }}>
          Ingresa tu numero de seguimiento y el correo que usaste al iniciar el chat.
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={styles.label}>Numero de seguimiento</div>
          <input
            style={s(styles.input, { textTransform: 'uppercase', letterSpacing: '0.05em' })}
            type="text"
            placeholder="CHAT-000001"
            value={resumeCodeInput}
            onChange={(e) => setResumeCodeInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') handleResumeByCode() }}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={styles.label}>Correo electronico</div>
          <input
            style={styles.input}
            type="email"
            placeholder="tu@correo.com"
            value={resumeEmailInput}
            onChange={(e) => setResumeEmailInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleResumeByCode() }}
          />
        </div>

        <button
          style={s(styles.primaryBtn, isResuming ? { opacity: 0.6 } : {})}
          onClick={handleResumeByCode}
          disabled={isResuming}
        >
          {isResuming ? 'Buscando...' : 'Continuar conversacion'}
        </button>
        {resumeError && <div style={styles.errorMsg}>{resumeError}</div>}
      </>
    )
  }

  function renderIdentify() {
    return (
      <>
        <button style={styles.backBtn} onClick={() => setScreen('welcome')}>← Atras</button>
        <div style={{ color: '#ddd', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Antes de empezar</div>
        <div style={{ color: '#666', fontSize: 11, marginBottom: 14 }}>
          Tu correo nos permite darte seguimiento si la conversacion se interrumpe.
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={styles.label}>Nombre (opcional)</div>
          <input
            style={styles.input}
            type="text"
            placeholder="Tu nombre"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={styles.label}>Correo electronico *</div>
          <input
            style={s(styles.input, emailError ? styles.inputError : {})}
            type="email"
            placeholder="tu@correo.com"
            value={emailInput}
            onChange={(e) => { setEmailInput(e.target.value); setEmailError('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleStartChat() }}
          />
          {emailError && <div style={styles.errorMsg}>{emailError}</div>}
        </div>

        <button style={styles.primaryBtn} onClick={handleStartChat}>
          Iniciar chat
        </button>
        {startError && <div style={styles.errorMsg}>{startError}</div>}
        <button style={styles.ghostBtn} onClick={() => startSession({}).catch(() => {})}>
          Continuar sin correo
        </button>
      </>
    )
  }

  function renderChat() {
    // Group messages by day for dividers
    const items = []
    let lastDay = null
    for (const msg of messages) {
      const day = fmtDay(msg.created_at)
      if (day && day !== lastDay) {
        items.push({ type: 'divider', day, key: `div-${day}` })
        lastDay = day
      }
      items.push({ type: 'msg', msg, key: msg.id })
    }

    const lastGuestMsg = [...messages].reverse().find((m) => m.sender_type === 'guest')
    const seen = Boolean(
      lastGuestMsg && operatorLastReadAt &&
      new Date(operatorLastReadAt) >= new Date(lastGuestMsg.created_at),
    )

    return (
      <>
        {trackingCode && (
          <div style={{
            background: DEFAULT_BG2,
            borderBottom: `1px solid ${DEFAULT_BG3}`,
            padding: '5px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 9, color: '#555', letterSpacing: '0.04em' }}>NUMERO DE SEGUIMIENTO</span>
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              color: accentColor,
              letterSpacing: '0.08em',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {trackingCode}
            </span>
          </div>
        )}
        <div style={s(styles.body, { padding: '12px 14px' })}>
          {messages.length === 0 && (
            <div style={{ color: '#555', fontSize: 11, textAlign: 'center', marginTop: 20 }}>
              Escribe tu primer mensaje para iniciar la conversacion.
            </div>
          )}
          {items.map((item) => {
            if (item.type === 'divider') {
              return <div key={item.key} style={styles.dayDivider}>{item.day}</div>
            }
            const { msg } = item
            const isGuest = msg.sender_type === 'guest'
            const time = fmtTime(msg.created_at)

            const attachments = Array.isArray(msg.attachments) ? msg.attachments : []
            const hasAtt = attachments.length > 0
            const isLastGuest = msg.id === lastGuestMsg?.id
            const isTemp = String(msg.id).startsWith('temp-')

            if (isGuest) {
              return (
                <div key={msg.id} style={{ alignSelf: 'flex-end', maxWidth: '80%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  {hasAtt
                    ? attachments.map((att) => (
                        <Attachment key={att.id} att={att} url={resolveAttUrl(att.id)}
                          onImageClick={setLightboxUrl} onError={() => dropAttUrl(att.id)} accent="#0f0f13" />
                      ))
                    : (
                      <div style={styles.msgBubbleGuest}>{msg.body}</div>
                    )}
                  {time && <div style={s(styles.msgTimestamp, { color: '#666' })}>{time}</div>}
                  {isLastGuest && !isTemp && (
                    <div style={s(styles.msgTimestamp, { color: seen ? '#86efac' : '#666' })}>
                      {seen ? 'Visto' : 'Enviado'}
                    </div>
                  )}
                </div>
              )
            }

            // Operator message — show avatar + name
            const senderName = msg.senderName ?? msg.sender_name ?? 'Agente'
            const avatarUrl = msg.senderAvatarUrl ?? msg.sender_avatar_url ?? null
            const initial = senderName[0]?.toUpperCase() ?? 'A'

            return (
              <div key={msg.id} style={styles.operatorRow}>
                <div style={styles.operatorAvatar}>
                  {avatarUrl
                    ? <img src={avatarUrl} alt={senderName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : initial
                  }
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={styles.operatorMeta}>{senderName}</div>
                  {hasAtt
                    ? attachments.map((att) => (
                        <Attachment key={att.id} att={att} url={resolveAttUrl(att.id)}
                          onImageClick={setLightboxUrl} onError={() => dropAttUrl(att.id)} accent="#ddd" />
                      ))
                    : (
                      <div style={styles.msgBubbleOperator}>{msg.body}</div>
                    )}
                  {time && <div style={styles.msgTimestamp}>{time}</div>}
                </div>
              </div>
            )
          })}
          {operatorTyping && (
            <div style={styles.operatorRow}>
              <div style={styles.operatorAvatar}>·</div>
              <div style={s(styles.msgBubbleOperator, { display: 'flex', gap: 3, alignItems: 'center' })}>
                {[0, 1, 2].map((i) => (
                  <span key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#888', display: 'inline-block', animation: `atlasblink 1s ${i * 0.15}s infinite` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {isClosed && (
          <div style={{
            padding: '8px 14px',
            background: '#1a1a24',
            borderTop: `1px solid #252535`,
            color: '#888',
            fontSize: 11,
            textAlign: 'center',
            flexShrink: 0,
          }}>
            Esta conversacion fue cerrada.{' '}
            <button
              style={{ background: 'none', border: 'none', color: accentColor, fontSize: 11, cursor: 'pointer', padding: 0 }}
              onClick={closeSession}
            >
              Iniciar nueva
            </button>
          </div>
        )}
        <div style={styles.chatFooter}>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.txt"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <button
            type="button"
            style={s(styles.clipBtn, (isSending || isClosed) ? { opacity: 0.4 } : {})}
            onClick={() => fileInputRef.current?.click()}
            onMouseDown={(e) => e.preventDefault()}
            disabled={isSending || isClosed}
            aria-label="Adjuntar archivo"
            title="Adjuntar imagen o documento"
          >
            <ClipIcon color="#666" />
          </button>
          <textarea
            ref={(el) => {
              textAreaRef.current = el;
              if (!el) return;
              el.style.height = '36px';
              el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
            }}
            style={s(styles.textArea, isClosed ? { opacity: 0.5 } : {})}
            placeholder={isClosed ? 'Esta conversacion ha sido cerrada.' : 'Escribe un mensaje...'}
            value={textInput}
            disabled={isClosed}
            onChange={(e) => {
              setTextInput(e.target.value);
              const el = e.target;
              el.style.height = '36px';
              el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
              const now = Date.now();
              if (now - typingSentAtRef.current > 3000) {
                typingSentAtRef.current = now;
                sendTyping();
              }
            }}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <button
            style={s(styles.sendBtn, (isSending || isClosed) ? { opacity: 0.5 } : {})}
            onClick={handleSend}
            onMouseDown={(e) => e.preventDefault()}
            disabled={isSending || isClosed}
            aria-label="Enviar mensaje"
          >
            <SendIcon />
          </button>
        </div>
      </>
    )
  }

  // ── Main render ──────────────────────────────────────────────────────────

  return (
    <>
      <div style={styles.tab} onClick={() => setOpen(true)} role="button" aria-label="Abrir chat">
        CHAT
        {unreadCount > 0 && (
          <span style={styles.unreadBadge}>{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </div>

      <div style={styles.panel} role="dialog" aria-label="Chat de soporte">
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {screen === 'chat' && (
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            )}
            <span style={styles.headerTitle}>{companyName}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {screen === 'chat' && (
              <button
                style={s(styles.closeBtn, { fontSize: 11, color: '#555' })}
                onClick={closeSession}
                title="Cerrar conversacion"
              >
                Cerrar
              </button>
            )}
            <button style={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Cerrar panel">
              ×
            </button>
          </div>
        </div>

        {screen !== 'chat' ? (
          <div style={styles.body}>
            {screen === 'welcome' && renderWelcome()}
            {screen === 'identify' && renderIdentify()}
            {screen === 'resume' && renderResume()}
          </div>
        ) : (
          renderChat()
        )}
      </div>

      {open && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9997 }}
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <img src={lightboxUrl} alt="" style={{ maxWidth: '92%', maxHeight: '92%', borderRadius: 8 }} />
        </div>
      )}

      <style>{`@keyframes atlasspin { to { transform: rotate(360deg) } } @keyframes atlasblink { 0%, 100% { opacity: 1 } 50% { opacity: 0.25 } }`}</style>
    </>
  )
}

// ── Attachment rendering ─────────────────────────────────────────────────────

function fmtSize(bytes) {
  const n = Number(bytes)
  if (!n || Number.isNaN(n)) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function Spinner() {
  return (
    <span style={{ width: 16, height: 16, border: '2px solid #555', borderTopColor: '#aaa', borderRadius: '50%', display: 'inline-block', animation: 'atlasspin 0.8s linear infinite' }} />
  )
}

function Attachment({ att, url, onImageClick, onError, accent = '#ddd' }) {
  const mime = String(att?.mimeType ?? att?.mime_type ?? '')
  const name = att?.fileName ?? att?.file_name ?? 'archivo'
  const isImage = mime.startsWith('image/')

  if (isImage) {
    if (!url) {
      return (
        <div style={{ width: 160, height: 120, background: '#2a2a38', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spinner />
        </div>
      )
    }
    return (
      <img
        src={url}
        alt={name}
        onClick={() => onImageClick?.(url)}
        onError={onError}
        style={{ maxWidth: 180, maxHeight: 180, borderRadius: 8, cursor: 'pointer', objectFit: 'cover', display: 'block' }}
      />
    )
  }

  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#2a2a38', borderRadius: 8, padding: '8px 10px', textDecoration: 'none', color: accent, fontSize: 12, maxWidth: 200 }}
    >
      <ClipIcon color={accent} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      {fmtSize(att?.sizeBytes ?? att?.size_bytes) && (
        <span style={{ color: '#666', flexShrink: 0 }}>{fmtSize(att?.sizeBytes ?? att?.size_bytes)}</span>
      )}
    </a>
  )
}

// ── Icon helpers ─────────────────────────────────────────────────────────────

function ChatIcon({ color }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function MailIcon({ color }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0f0f13" strokeWidth="2.5" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function ClipIcon({ color = '#888' }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}
