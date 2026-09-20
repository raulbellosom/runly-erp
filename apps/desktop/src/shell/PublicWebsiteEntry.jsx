import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams, Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider.jsx'
import { getApiUrl } from '../lib/runtimeConfig.js'
import { runly } from '../lib/runly.js'
import { companyFetch } from '../lib/companyFetch.js'
import { PublicPageLoader, storePublicSiteHint } from '../components/PublicPageLoader.jsx'
import { PublicWebsite404 } from './PublicWebsite404.jsx'
import { WebsitePageRenderer } from '../website/WebsitePageRenderer.jsx'
import { EditorContextBar } from '../website/EditorContextBar.jsx'
import WebsitePageEditorScreen from '../modules/runly.website/screens/WebsitePageEditorScreen.jsx'
import { BAR_H_PX } from '../website/EditorContextBar.jsx'
import { toast } from 'sonner'

function titleToSlug(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '') || 'pagina'
}

async function apiFetch(path, token, options = {}) {
  const res = await companyFetch(`${getApiUrl()}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

async function fetchWebsiteResolve(pathname) {
  const url = `${getApiUrl()}/public/website/resolve?path=${encodeURIComponent(pathname)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function fetchEditorCheck(token) {
  const res = await companyFetch(`${getApiUrl()}/website/site`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  return res.json()
}

// ── "En construccion" screen for anonymous visitors ───────────────────────────

const CS_CSS = `
  @keyframes _cs_up {
    from { opacity: 0; transform: translateY(22px) }
    to   { opacity: 1; transform: translateY(0) }
  }
  @keyframes _cs_lineExpand {
    from { transform: scaleX(0) }
    to   { transform: scaleX(1) }
  }
  @keyframes _cs_fadein {
    from { opacity: 0 }
    to   { opacity: 1 }
  }
  @keyframes _cs_ping {
    0%  { box-shadow: 0 0 0 0 rgba(27,101,240,.55) }
    70% { box-shadow: 0 0 0 7px rgba(27,101,240,0) }
    100%{ box-shadow: 0 0 0 0 rgba(27,101,240,0) }
  }

  ._csa { animation: _cs_up .85s cubic-bezier(.16,1,.3,1) .05s both }
  ._csb { animation: _cs_up .85s cubic-bezier(.16,1,.3,1) .17s both }
  ._csc { animation: _cs_up .85s cubic-bezier(.16,1,.3,1) .29s both }
  ._csd { animation: _cs_up .85s cubic-bezier(.16,1,.3,1) .41s both }
  ._cse { animation: _cs_up .85s cubic-bezier(.16,1,.3,1) .53s both }
  ._csf { animation: _cs_fadein .7s ease .9s both }
  ._csLine { animation: _cs_lineExpand 1.3s cubic-bezier(.16,1,.3,1) .46s both; transform-origin: left }
  ._csDot  { animation: _cs_ping 2.2s ease-in-out infinite }
`

function ComingSoonScreen({ siteName, onLoginClick, isLoggedIn, onGoToApp }) {
  const handlePrimaryAction = isLoggedIn ? onGoToApp : onLoginClick

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,600;0,700;1,300;1,400&family=Syne:wght@500;600;700;800&display=swap" rel="stylesheet" />
      <style>{CS_CSS}</style>
      <div style={{
        minHeight: '100vh',
        background: '#F5F3EF',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Syne', system-ui, sans-serif",
      }}>

        {/* Left blue accent stripe */}
        <div style={{
          position: 'fixed', top: 0, left: 0, bottom: 0, width: 3,
          background: '#1B65F0', zIndex: 100, pointerEvents: 'none',
        }} />

        {/* Dot grid background */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'radial-gradient(rgba(17,16,16,.08) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }} />

        {/* Soft blue glow top-right */}
        <div style={{
          position: 'absolute', top: '-15%', right: '-8%', pointerEvents: 'none',
          width: '55vw', height: '55vw',
          background: 'radial-gradient(circle, rgba(27,101,240,.07) 0%, transparent 60%)',
        }} />

        {/* NAVBAR */}
        <nav style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 clamp(40px, 6vw, 80px)',
          height: 64,
          background: 'rgba(245,243,239,.9)',
          backdropFilter: 'blur(18px)',
          borderBottom: '1px solid rgba(17,16,16,.07)',
        }}>
          <img
            src="/runly/runly-logo-light.png"
            alt="Runly ERP"
            style={{ height: 28, width: 'auto', display: 'block', objectFit: 'contain' }}
          />

          <button
            onClick={handlePrimaryAction}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              background: isLoggedIn ? '#1B65F0' : '#111010',
              color: '#F5F3EF',
              border: 'none', borderRadius: 8,
              padding: '8px 18px', fontSize: 12.5, fontWeight: 600,
              letterSpacing: '0.02em', cursor: 'pointer',
              transition: 'opacity 150ms, transform 150ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.82'; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)' }}
          >
            {isLoggedIn ? (
              <>
                Ir a Runly ERP
                <svg viewBox="0 0 14 14" fill="none" style={{ width: 11, height: 11 }}>
                  <path d="M2.5 7h9M8 3.5l3.5 3.5L8 10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </>
            ) : (
              <>
                <svg viewBox="0 0 14 14" fill="none" style={{ width: 11, height: 11 }}>
                  <circle cx="7" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M2.5 12c0-2 2-3.5 4.5-3.5S11.5 10 11.5 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                Iniciar sesion
              </>
            )}
          </button>
        </nav>

        {/* MAIN CONTENT */}
        <main style={{
          flex: 1,
          display: 'flex', alignItems: 'center',
          paddingTop: 'clamp(104px, 14vw, 160px)',
          paddingBottom: 'clamp(80px, 10vw, 120px)',
          paddingLeft: 'clamp(64px, 10vw, 140px)',
          paddingRight: 'clamp(44px, 6vw, 80px)',
          position: 'relative', zIndex: 5,
          minHeight: '100vh',
        }}>

          {/* Ghost "PRONTO" background text */}
          <div style={{
            position: 'absolute', right: '-3%', top: '50%',
            transform: 'translateY(-50%)',
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: 'clamp(140px, 22vw, 340px)',
            fontWeight: 700, lineHeight: 1,
            color: 'transparent',
            WebkitTextStroke: '1px rgba(17,16,16,.055)',
            userSelect: 'none', letterSpacing: '-0.05em',
            whiteSpace: 'nowrap', pointerEvents: 'none',
          }}>
            PRONTO
          </div>

          {/* Vertical label */}
          <div style={{
            position: 'absolute', left: 'clamp(14px, 2vw, 26px)', top: '50%',
            transform: 'translateY(-50%) rotate(-90deg)',
            transformOrigin: 'center center',
            color: 'rgba(17,16,16,.14)', fontSize: 9,
            fontWeight: 700, letterSpacing: '0.28em',
            textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}>
            Runly ERP · Sitio web
          </div>

          {/* Corner lines — bottom right */}
          <div style={{
            position: 'absolute', bottom: 52, right: 60,
            display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5,
            opacity: .13,
          }}>
            {[96, 64, 32].map((w, i) => (
              <div key={i} style={{ width: w, height: 1.5, background: '#1B65F0', borderRadius: 1 }} />
            ))}
          </div>

          {/* Content */}
          <div style={{ maxWidth: 740, width: '100%' }}>

            {/* Badge */}
            <div className="_csa" style={{
              display: 'inline-flex', alignItems: 'center', gap: 9,
              marginBottom: 30,
            }}>
              <div className="_csDot" style={{
                width: 8, height: 8, borderRadius: '50%',
                background: '#1B65F0', flexShrink: 0,
              }} />
              <span style={{
                color: '#111010', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.22em', textTransform: 'uppercase',
              }}>
                Proximamente
              </span>
            </div>

            {/* Site name */}
            <h1 className="_csb" style={{
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontSize: 'clamp(50px, 9.5vw, 120px)',
              fontWeight: 700, color: '#111010',
              lineHeight: .93, letterSpacing: '-0.03em',
              margin: 0, marginBottom: 6,
            }}>
              {siteName || 'Nuevo sitio web'}
            </h1>

            {/* Italic subtitle */}
            <p className="_csc" style={{
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontSize: 'clamp(17px, 2.5vw, 28px)',
              fontWeight: 300, fontStyle: 'italic',
              color: 'rgba(17,16,16,.34)',
              margin: 0, marginBottom: 34,
            }}>
              en construccion
            </p>

            {/* Rule */}
            <div className="_csLine" style={{
              width: 'min(500px, 78vw)', height: 1.5,
              background: '#111010',
              marginBottom: 34,
            }} />

            {/* Description */}
            <p className="_csd" style={{
              color: 'rgba(17,16,16,.46)',
              fontSize: 'clamp(12.5px, 1.25vw, 14.5px)',
              lineHeight: 1.9, maxWidth: 390,
              margin: 0, marginBottom: 50,
            }}>
              Estamos construyendo algo especial para ti.<br />
              Vuelve pronto para descubrir el resultado.
            </p>

            {/* Secondary CTA */}
            <button className="_cse" onClick={handlePrimaryAction} style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              color: 'rgba(17,16,16,.28)',
              fontSize: 10.5, fontWeight: 700,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              background: 'none', border: 'none', padding: 0,
              cursor: 'pointer',
              transition: 'color 200ms, gap 200ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#1B65F0'
              e.currentTarget.style.gap = '14px'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'rgba(17,16,16,.28)'
              e.currentTarget.style.gap = '10px'
            }}
            >
              {isLoggedIn ? 'Ir a Runly ERP' : 'Panel de administracion'}
              <svg viewBox="0 0 16 16" fill="none" style={{ width: 12, height: 12 }}>
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </main>

        {/* FOOTER strip */}
        <div className="_csf" style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 clamp(40px, 6vw, 80px)',
          height: 40,
          background: 'rgba(245,243,239,.9)',
          backdropFilter: 'blur(18px)',
          borderTop: '1px solid rgba(17,16,16,.06)',
        }}>
          <span style={{ color: 'rgba(17,16,16,.25)', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            Runly ERP
          </span>
          <span style={{ color: 'rgba(17,16,16,.2)', fontSize: 10, fontWeight: 500 }}>
            {new Date().getFullYear()} — Todos los derechos reservados
          </span>
        </div>
      </div>
    </>
  )
}

// ── Draft page preview for editors in view mode ──────────────────────────────

const DRAFT_CSS = `
  @keyframes _dr_fadeUp {
    from { opacity: 0; transform: translateY(22px) }
    to   { opacity: 1; transform: translateY(0) }
  }
  @keyframes _dr_pulse {
    0%, 100% { opacity: 0.35; transform: scale(1) }
    50%       { opacity: 1;    transform: scale(1.15) }
  }
  @keyframes _dr_float {
    0%, 100% { transform: translateY(0px) rotate(0deg) }
    33%       { transform: translateY(-10px) rotate(0.5deg) }
    66%       { transform: translateY(-5px) rotate(-0.5deg) }
  }
  @keyframes _dr_scanline {
    0%   { transform: translateY(-100%) }
    100% { transform: translateY(100vh) }
  }
  @keyframes _dr_drawDash {
    from { stroke-dashoffset: 800 }
    to   { stroke-dashoffset: 0 }
  }
  @keyframes _dr_glow {
    0%,100% { opacity: 0.06 }
    50%      { opacity: 0.14 }
  }
  ._dr1 { animation: _dr_fadeUp .75s cubic-bezier(.16,1,.3,1) .05s both }
  ._dr2 { animation: _dr_fadeUp .75s cubic-bezier(.16,1,.3,1) .18s both }
  ._dr3 { animation: _dr_fadeUp .75s cubic-bezier(.16,1,.3,1) .32s both }
  ._dr4 { animation: _dr_fadeUp .75s cubic-bezier(.16,1,.3,1) .46s both }
  ._dr5 { animation: _dr_fadeUp .75s cubic-bezier(.16,1,.3,1) .60s both }
  ._drPulse { animation: _dr_pulse 2.2s ease-in-out infinite }
  ._drFloat { animation: _dr_float 6s ease-in-out infinite }
  ._drGlow  { animation: _dr_glow  4s ease-in-out infinite }
  ._drDraw  {
    stroke-dasharray: 800;
    animation: _dr_drawDash 2.4s cubic-bezier(.16,1,.3,1) .3s both
  }
`

function DraftViewScreen({ onOpenEditor, topOffset = 0 }) {
  return (
    <>
      <style>{DRAFT_CSS}</style>
      <div style={{
        height: `calc(100dvh - ${topOffset}px)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#07090f',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}>

        {/* Blueprint grid */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
          backgroundImage: `
            linear-gradient(rgba(255,255,255,.022) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.022) 1px, transparent 1px)
          `,
          backgroundSize: '52px 52px',
        }} />

        {/* Ambient indigo glow */}
        <div className="_drGlow" style={{
          position: 'absolute', top: '-20%', left: '20%',
          width: '65vw', height: '65vw',
          background: 'radial-gradient(circle, rgba(99,102,241,.12) 0%, transparent 65%)',
          zIndex: 0, pointerEvents: 'none',
        }} />

        {/* Top scan line accent */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 2,
          background: 'linear-gradient(90deg, transparent 0%, rgba(99,102,241,.6) 30%, rgba(99,102,241,1) 50%, rgba(99,102,241,.6) 70%, transparent 100%)',
        }} />

        {/* Floating page wireframe — right side */}
        <div className="_drFloat" style={{
          position: 'absolute', right: '6%', top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 1, opacity: 0.22,
          filter: 'blur(0.3px)',
        }}>
          <svg width="220" height="270" viewBox="0 0 220 270" fill="none">
            <rect className="_drDraw" x="12" y="12" width="196" height="246" rx="10"
              stroke="rgba(99,102,241,.9)" strokeWidth="1.5" />
            <rect x="30" y="38" width="110" height="12" rx="3" fill="rgba(99,102,241,.35)" />
            <rect x="30" y="62" width="160" height="6" rx="2" fill="rgba(255,255,255,.14)" />
            <rect x="30" y="75" width="130" height="6" rx="2" fill="rgba(255,255,255,.1)" />
            <rect x="30" y="88" width="148" height="6" rx="2" fill="rgba(255,255,255,.07)" />
            <rect x="30" y="110" width="160" height="78" rx="6"
              fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.09)" strokeWidth="1" />
            <line x1="30" y1="110" x2="190" y2="188" stroke="rgba(255,255,255,.06)" strokeWidth="1" />
            <line x1="190" y1="110" x2="30" y2="188" stroke="rgba(255,255,255,.06)" strokeWidth="1" />
            <rect x="30" y="204" width="80" height="6" rx="2" fill="rgba(255,255,255,.09)" />
            <rect x="30" y="218" width="50" height="6" rx="2" fill="rgba(255,255,255,.06)" />
          </svg>
        </div>

        {/* Vertical label */}
        <div style={{
          position: 'absolute', left: 20, top: '50%',
          transform: 'translateY(-50%) rotate(-90deg)',
          transformOrigin: 'center center',
          color: 'rgba(255,255,255,.1)',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.22em',
          textTransform: 'uppercase', whiteSpace: 'nowrap',
          zIndex: 2,
        }}>
          Runly ERP · Editor
        </div>

        {/* Corner dots decoration */}
        <div style={{
          position: 'absolute', bottom: 40, right: 48,
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 9,
          zIndex: 2, opacity: .1,
        }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: '#6366f1' }} />
          ))}
        </div>

        {/* Main content */}
        <div style={{
          position: 'relative', zIndex: 3,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          textAlign: 'center',
          padding: 'clamp(48px, 8vw, 80px) 40px',
          maxWidth: 460,
        }}>

          {/* Animated pencil icon */}
          <div className="_dr1 _drFloat" style={{
            marginBottom: 28,
            width: 68, height: 68,
            borderRadius: 22,
            background: 'rgba(99,102,241,.1)',
            border: '1px solid rgba(99,102,241,.22)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 32px rgba(99,102,241,.12)',
          }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 30, height: 30 }}>
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
                stroke="rgba(99,102,241,.85)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                stroke="rgba(99,102,241,.85)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          {/* Borrador badge */}
          <div className="_dr2" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'rgba(234,179,8,.07)',
            border: '1px solid rgba(234,179,8,.22)',
            borderRadius: 100, padding: '5px 14px 5px 10px',
            marginBottom: 22,
          }}>
            <div className="_drPulse" style={{
              width: 7, height: 7, borderRadius: '50%',
              background: '#eab308',
              boxShadow: '0 0 8px #eab308, 0 0 16px rgba(234,179,8,.4)',
            }} />
            <span style={{
              color: '#eab308', fontSize: 10.5, fontWeight: 700,
              letterSpacing: '0.16em', textTransform: 'uppercase',
            }}>
              Borrador
            </span>
          </div>

          {/* Title */}
          <h2 className="_dr3" style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: 'clamp(24px, 3.8vw, 36px)',
            fontWeight: 700,
            color: '#ede8df',
            lineHeight: 1.18,
            letterSpacing: '-0.022em',
            margin: '0 0 14px',
          }}>
            Esta pagina esta en construccion
          </h2>

          {/* Divider */}
          <div className="_dr3" style={{
            width: 48, height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(99,102,241,.5), transparent)',
            marginBottom: 18,
          }} />

          {/* Description */}
          <p className="_dr4" style={{
            color: 'rgba(255,255,255,.32)',
            fontSize: 13.5,
            lineHeight: 1.78,
            margin: '0 0 36px',
            maxWidth: 320,
          }}>
            Aun no es visible para el publico. Abre el editor para agregar contenido y publicarla cuando este lista.
          </p>

          {/* CTA */}
          <button
            className="_dr5"
            onClick={onOpenEditor}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 9,
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              color: '#fff', border: 'none',
              borderRadius: 12, padding: '12px 26px',
              fontSize: 13.5, fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(99,102,241,.38), 0 1px 4px rgba(0,0,0,.35)',
              transition: 'transform 160ms ease, box-shadow 160ms ease',
              letterSpacing: '0.01em',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 8px 28px rgba(99,102,241,.5), 0 1px 4px rgba(0,0,0,.35)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(99,102,241,.38), 0 1px 4px rgba(0,0,0,.35)'
            }}
          >
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 15, height: 15 }}>
              <path d="M11.5 2h-7A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7A1.5 1.5 0 0 0 13 12.5v-9A1.5 1.5 0 0 0 11.5 2z"
                stroke="currentColor" strokeWidth="1.4"/>
              <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"
                stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            Abrir editor
          </button>
        </div>
      </div>
    </>
  )
}

// ── Empty state for editors when no page is published on this route ───────────

function EditorEmptyRoute({ routePath, onCreatePage, isCreating }) {
  const isRoot = routePath === '/'
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50 mx-auto">
          <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-indigo-400">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-mono text-indigo-400 bg-indigo-50 px-3 py-1 rounded-full inline-block">
            {routePath}
          </p>
          <h2 className="text-xl font-bold text-gray-900 mt-2">
            {isRoot ? 'Sin pagina de inicio publicada' : 'Esta ruta no tiene contenido'}
          </h2>
          <p className="text-gray-500 text-sm">
            {isRoot
              ? 'Crea y publica la pagina principal para que los visitantes la vean.'
              : 'No existe una pagina publicada en esta ruta.'}
          </p>
        </div>
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={onCreatePage}
            disabled={isCreating}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-white transition-all hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}
          >
            {isCreating ? 'Creando...' : `Crear pagina "${isRoot ? 'Inicio' : routePath}"`}
          </button>
          <a
            href="/app/m/runly.website/pages"
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors underline"
          >
            Ver todas las paginas
          </a>
        </div>
      </div>
    </div>
  )
}

// ── ERP beacon — floating shortcut for logged-in Atlas ERP users ──────────────

function ErpBeacon({ erpPath = '/app/' }) {
  const [expanded, setExpanded] = useState(false)
  const isTouchDevice = useRef(false)

  useEffect(() => {
    isTouchDevice.current = navigator.maxTouchPoints > 0 || ('ontouchstart' in window)
    if (isTouchDevice.current) setExpanded(true)
  }, [])

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 2147483647,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <a
        href={erpPath}
        onMouseEnter={() => { if (!isTouchDevice.current) setExpanded(true) }}
        onMouseLeave={() => { if (!isTouchDevice.current) setExpanded(false) }}
        style={{
          display: 'flex', alignItems: 'center',
          gap: expanded ? 8 : 0,
          background: 'rgba(8,8,20,0.85)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          color: '#e2e8f0',
          padding: expanded ? '9px 14px 9px 10px' : '10px',
          borderRadius: 100,
          textDecoration: 'none',
          fontSize: 12, fontWeight: 600,
          overflow: 'hidden',
          maxWidth: expanded ? 160 : 40,
          transition: 'max-width .25s, padding .25s, gap .25s',
          boxShadow: '0 4px 20px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08)',
          whiteSpace: 'nowrap',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
          <rect width="20" height="20" rx="6" fill="#6366f1" />
          <path d="M6 10h8M10 6v8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span style={{ whiteSpace: 'nowrap', transition: 'opacity .15s', opacity: expanded ? 1 : 0 }}>
          Runly ERP
        </span>
      </a>
    </div>
  )
}

// ── Main entry ─────────────────────────────────────────────────────────────────

export function PublicWebsiteEntry() {
  const location      = useLocation()
  const navigate      = useNavigate()
  const queryClient   = useQueryClient()
  const { session }   = useAuth()
  const token         = session?.access_token
  const [searchParams, setSearchParams] = useSearchParams()

  // If URL has ?edit=1, start in edit mode and remove the param from URL
  const startInEdit = searchParams.get('edit') === '1'
  const [editMode,  setEditMode]  = useState(startInEdit)
  const [barPinned, setBarPinned] = useState(() => localStorage.getItem('runly-editor-bar-pinned') === 'true')

  useEffect(() => {
    if (startInEdit) {
      // Remove ?edit=1 from URL without navigation
      const next = new URLSearchParams(searchParams)
      next.delete('edit')
      setSearchParams(next, { replace: true })
      setEditMode(true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Allow public website to scroll and expand beyond app-shell constraints
  useEffect(() => {
    document.documentElement.style.overflow = 'auto'
    document.body.style.overflow             = 'auto'
    const root = document.getElementById('root')
    if (root) root.style.height = 'auto'
    return () => {
      document.documentElement.style.overflow = ''
      document.body.style.overflow             = ''
      if (root) root.style.height = ''
    }
  }, [])

  // Check instance initialization independently — the website resolve endpoint
  // does not always return initialized:false for fresh installs.
  const instanceQuery = useQuery({
    queryKey: ['instance-status-public'],
    queryFn:  runly.instance.status,
    staleTime: 30_000,
    retry: 1,
  })

  useEffect(() => {
    if (instanceQuery.data && instanceQuery.data.initialized === false) {
      navigate('/app/setup', { replace: true })
    }
  }, [instanceQuery.data, navigate])

  const resolveQuery = useQuery({
    queryKey: ['public-website-resolve', location.pathname],
    queryFn:  () => fetchWebsiteResolve(location.pathname),
    staleTime: 60_000,
    retry: 1,
  })

  const editorCheckQuery = useQuery({
    queryKey: ['editor-check', token],
    queryFn:  () => fetchEditorCheck(token),
    enabled:  Boolean(token),
    staleTime: 60_000,
    retry: 0,
  })

  const resolveData = resolveQuery.data
  const site        = editorCheckQuery.data?.data ?? null
  const isEditor    = Boolean(token) && Boolean(site)
  const siteId      = site?.id ?? null

  const erpCheckQuery = useQuery({
    queryKey: ['erp-badge-check', token],
    queryFn: async () => {
      const res = await fetch('/erp-badge-check', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) return { show: false }
      return res.json()
    },
    enabled: Boolean(token),
    staleTime: 5 * 60_000,
    retry: 0,
  })
  const showErpBeacon = erpCheckQuery.data?.show === true

  useLayoutEffect(() => {
    const publicSite = resolveData?.site
    if (!publicSite) return
    window.RUNLY_CONFIG = {
      ...(window.RUNLY_CONFIG ?? {}),
      apiUrl: getApiUrl(),
      company: publicSite.company ?? '',
      siteId: publicSite.id ?? '',
      siteName: publicSite.name ?? '',
      analyticsMode: publicSite.analyticsMode ?? 'off',
      turnstileSiteKey: publicSite.turnstileSiteKey ?? '',
    }
    // Kept for the SDK's own fallback read path and any already-published
    // dist pages whose inline script only checks window.ATLAS_CONFIG.
    window.ATLAS_CONFIG = window.RUNLY_CONFIG
  }, [resolveData])

  useEffect(() => {
    const publicSite = resolveData?.site
    if (!publicSite || publicSite.sourceType !== 'builder') return undefined
    if (window.RunlyERP?.analytics) {
      window.RunlyERP.analytics.start().catch(() => {})
      return undefined
    }
    if (document.getElementById('runly-storefront-sdk')) return undefined
    const script = document.createElement('script')
    script.id = 'runly-storefront-sdk'
    script.src = `${getApiUrl()}/public/site/runly-sdk.js`
    script.defer = true
    document.head.appendChild(script)
    return undefined
  }, [resolveData])

  // All pages list (for the bar combobox)
  const pagesQuery = useQuery({
    queryKey: ['website-pages-bar', siteId],
    queryFn:  () => apiFetch(`/website/pages?siteId=${siteId}&pageSize=50`, token),
    enabled:  isEditor && Boolean(siteId),
    staleTime: 60_000,
  })

  // Editor-only: fetch current route page regardless of publish status (includes drafts)
  const editorPageQuery = useQuery({
    queryKey: ['website-page-by-path', siteId, location.pathname],
    queryFn:  () => apiFetch(
      `/website/pages/by-path?siteId=${siteId}&routePath=${encodeURIComponent(location.pathname)}`,
      token,
    ),
    enabled:  isEditor && Boolean(siteId),
    staleTime: 30_000,
  })

  // activePage: the page at this route (published for visitors, any status for editors)
  const publishedPage = resolveData?.page ?? null
  const editorPage    = editorPageQuery.data?.data ?? null
  const activePage    = publishedPage ?? (isEditor ? editorPage : null)

  const publishMutation = useMutation({
    mutationFn: () => apiFetch(`/website/pages/${activePage?.id}/publish`, token, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public-website-resolve', location.pathname] })
      queryClient.invalidateQueries({ queryKey: ['website-pages-bar', siteId] })
      queryClient.invalidateQueries({ queryKey: ['website-page-by-path', siteId, location.pathname] })
      toast.success('Pagina publicada')
    },
    onError: (err) => toast.error(err.message),
  })

  const unpublishMutation = useMutation({
    mutationFn: () => apiFetch(`/website/pages/${activePage?.id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'draft' }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public-website-resolve', location.pathname] })
      queryClient.invalidateQueries({ queryKey: ['website-pages-bar', siteId] })
      queryClient.invalidateQueries({ queryKey: ['website-page-by-path', siteId, location.pathname] })
      toast.success('Pagina marcada como borrador')
    },
    onError: (err) => toast.error(err.message),
  })

  const createPageMutation = useMutation({
    mutationFn: async ({ title, routePath }) => {
      const slug = titleToSlug(title)
      return apiFetch('/website/pages', token, {
        method: 'POST',
        body: JSON.stringify({ siteId, title, slug, routePath, pageType: 'page', visibility: 'public' }),
      })
    },
    onSuccess: (data) => {
      const created = data?.data ?? data
      queryClient.invalidateQueries({ queryKey: ['website-pages-bar', siteId] })
      queryClient.invalidateQueries({ queryKey: ['website-page-by-path', siteId, location.pathname] })
      toast.success('Pagina creada. Puedes editarla y publicarla desde el editor.')
      if (created?.routePath) navigate(`${created.routePath}?edit=1`)
    },
    onError: (err) => toast.error(err.message),
  })

  async function handleCreatePageFromBar(title) {
    const slug      = titleToSlug(title)
    const routePath = `/${slug}`
    try {
      await apiFetch('/website/pages', token, {
        method: 'POST',
        body: JSON.stringify({ siteId, title, slug, routePath, pageType: 'page', visibility: 'public' }),
      })
      queryClient.invalidateQueries({ queryKey: ['website-pages-bar', siteId] })
      navigate(routePath + '?edit=1')
      toast.success(`Pagina "${title}" creada`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  useEffect(() => {
    if (resolveData?.site) {
      storePublicSiteHint({
        siteName: resolveData.site.name ?? null,
        primaryColor: resolveData.theme?.tokens?.primary ?? null,
        backgroundColor: resolveData.theme?.tokens?.background ?? null,
      })
    }
  }, [resolveData])

  useEffect(() => {
    if (resolveData && resolveData.initialized === false) {
      navigate('/app/setup', { replace: true })
    }
  }, [resolveData, navigate])

  if (resolveQuery.isPending) return <PublicPageLoader />
  if (resolveQuery.isError)   return <PublicWebsite404 />
  if (resolveData?.initialized === false) return null

  const sourceType = resolveData?.site?.sourceType ?? 'builder'

  // source_type = 'none': no public site — go to login
  if (sourceType === 'none') {
    return <Navigate to="/app/login" replace />
  }

  // source_type = 'dist': nginx serves the dist HTML directly when uploaded.
  // If the React SPA is running here, nginx fell through (dist not ready yet) → coming soon.
  if (sourceType === 'dist') {
    return (
      <ComingSoonScreen
        siteName={resolveData?.site?.name}
        onLoginClick={() => navigate('/app/login')}
        isLoggedIn={Boolean(session)}
        onGoToApp={() => navigate('/app')}
      />
    )
  }

  // ── Shared values ─────────────────────────────────────────────────────────
  const pages        = pagesQuery.data?.data ?? []
  const topOffset    = isEditor && barPinned ? BAR_H_PX : 0
  const isPublishing = publishMutation.isPending || unpublishMutation.isPending

  // ── No page on this route at all ──────────────────────────────────────────
  if (!activePage) {
    if (isEditor) {
      // Still loading the editor page query
      if (editorPageQuery.isPending && siteId) return <PublicPageLoader />

      // No page exists on this route → empty state with create CTA
      const bar = (
        <EditorContextBar
          site={site}
          page={null}
          pages={pages}
          editMode={false}
          onToggleEdit={() => {}}
          onNavigate={(rp) => navigate(rp)}
          onPublishPage={() => {}}
          onUnpublishPage={() => {}}
          onCreatePage={handleCreatePageFromBar}
          onPinChange={setBarPinned}
          isPublishing={false}
        />
      )
      return (
        <>
          {bar}
          <div style={{ paddingTop: topOffset }}>
            <EditorEmptyRoute
              routePath={location.pathname}
              onCreatePage={() => {
                const rp = location.pathname
                const title = rp === '/' ? 'Inicio' : rp.replace(/^\//, '').replace(/-/g, ' ')
                createPageMutation.mutate({ title, routePath: rp })
              }}
              isCreating={createPageMutation.isPending}
            />
          </div>
        </>
      )
    }

    // Anonymous visitor: coming soon
    const csProps = {
      onLoginClick: () => navigate('/app/login'),
      isLoggedIn: Boolean(session),
      onGoToApp: () => navigate('/app'),
    }
    const csName = resolveData?.site?.name ?? null
    return (
      <>
        <ComingSoonScreen siteName={csName} {...csProps} />
        {showErpBeacon && <ErpBeacon />}
      </>
    )
  }

  // ── Page exists (published or draft for editors) ───────────────────────────
  const bar = isEditor ? (
    <EditorContextBar
      site={site}
      page={activePage}
      pages={pages}
      editMode={editMode}
      onToggleEdit={() => setEditMode((v) => !v)}
      onNavigate={(rp) => navigate(rp)}
      onPublishPage={() => publishMutation.mutate()}
      onUnpublishPage={() => unpublishMutation.mutate()}
      onCreatePage={handleCreatePageFromBar}
      onPinChange={setBarPinned}
      isPublishing={isPublishing}
    />
  ) : null

  // Edit mode
  if (editMode && activePage?.id) {
    return (
      <>
        {bar}
        <WebsitePageEditorScreen pageId={activePage.id} topOffset={topOffset} />
      </>
    )
  }

  // View mode — only show renderer if page is published (drafts show an editor-only preview msg)
  return (
    <>
      {bar}
      {showErpBeacon && <ErpBeacon />}
      <div style={{ paddingTop: topOffset }}>
        {publishedPage ? (
          <WebsitePageRenderer page={publishedPage} theme={resolveData.theme} />
        ) : (
          <DraftViewScreen onOpenEditor={() => setEditMode(true)} topOffset={topOffset} />
        )}
      </div>
    </>
  )
}
