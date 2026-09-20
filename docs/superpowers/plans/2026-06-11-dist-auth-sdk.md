# Dist Auth SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `source_type=dist` frontends to share the Atlas ERP Supabase session and provide `window.AtlasERP` with auth + embeddable login.

**Architecture:** `dist-serve-service.js` injects `window.ATLAS_CONFIG` (supabase creds) into every dist HTML response after URL rewriting. A static `atlas-sdk.js` is served by the API and exposes `window.AtlasERP.auth` (REST-based, no lib dependency) and `window.AtlasERP.renderLogin(selector, options)`. A new integration guide section in `DistUploadPanel` shows per-framework snippets.

**Tech Stack:** Vanilla JS (IIFE, no bundler), Node.js built-in test runner, Hono, React + Lucide.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `apps/api/src/services/dist-serve-service.js` | Add `injectAtlasConfig` export + wire into `serve()` |
| Modify | `apps/api/src/services/__tests__/dist-serve-service.test.js` | Tests for `injectAtlasConfig` |
| Create | `apps/api/src/public/atlas-sdk.js` | IIFE SDK: auth + renderLogin |
| Modify | `apps/api/src/index.js` | `GET /public/site/atlas-sdk.js` route (before catch-all) |
| Modify | `apps/desktop/src/modules/atlas.website/components/DistUploadPanel.jsx` | Integration guide section |

---

## Task 1: Test + implement `injectAtlasConfig`

**Files:**
- Modify: `apps/api/src/services/__tests__/dist-serve-service.test.js`
- Modify: `apps/api/src/services/dist-serve-service.js`

- [ ] **Step 1: Add failing tests for `injectAtlasConfig`**

Open `apps/api/src/services/__tests__/dist-serve-service.test.js` and add at the top import:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isAssetPath, resolveHtmlCandidates, injectSeoTags, rewriteDistHtml, injectAtlasConfig } from '../dist-serve-service.js'
```

Then add at the end of the file:

```js
describe('injectAtlasConfig', () => {
  const cfg = {
    supabaseUrl: 'https://supabase.example.com',
    supabaseAnonKey: 'eyJtest',
    apiUrl: '/',
  }

  it('injects window.ATLAS_CONFIG script into <head>', () => {
    const html = '<html><head></head><body></body></html>'
    const result = injectAtlasConfig(html, cfg)
    assert.ok(result.includes('window.ATLAS_CONFIG='))
    assert.ok(result.includes('supabase.example.com'))
    assert.ok(result.includes('eyJtest'))
  })

  it('computes storageKey from hostname', () => {
    const html = '<html><head></head><body></body></html>'
    const result = injectAtlasConfig(html, cfg)
    assert.ok(result.includes('"storageKey":"sb-supabase-auth-token"'))
  })

  it('places script tag immediately after <head>', () => {
    const html = '<html><head><title>X</title></head><body></body></html>'
    const result = injectAtlasConfig(html, cfg)
    const headIdx   = result.indexOf('<head>')
    const scriptIdx = result.indexOf('<script>window.ATLAS_CONFIG')
    assert.ok(scriptIdx > headIdx && scriptIdx < result.indexOf('<title>'))
  })

  it('escapes </script> sequences in values', () => {
    const tricky = { ...cfg, supabaseAnonKey: 'a</script>b' }
    const html = '<html><head></head><body></body></html>'
    const result = injectAtlasConfig(html, tricky)
    assert.ok(!result.includes('</script>b'))
  })

  it('returns html unchanged when supabaseUrl is missing', () => {
    const html = '<html><head></head><body></body></html>'
    const result = injectAtlasConfig(html, { supabaseUrl: '', supabaseAnonKey: 'k', apiUrl: '/' })
    assert.equal(result, html)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test apps/api/src/services/__tests__/dist-serve-service.test.js
```

Expected: `ERR_MODULE_NOT_FOUND` or `injectAtlasConfig is not a function` (not yet exported).

- [ ] **Step 3: Implement `injectAtlasConfig` in `dist-serve-service.js`**

Add this export near the other inject functions (after `injectSeoTags`, before `injectErpBadge`):

```js
export function injectAtlasConfig(html, { supabaseUrl, supabaseAnonKey, apiUrl }) {
  if (!supabaseUrl) return html
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
  const storageKey = `sb-${projectRef}-auth-token`
  const raw = JSON.stringify({ supabaseUrl, supabaseAnonKey, apiUrl, storageKey })
  // Escape </ to prevent premature </script> tag closure
  const safe = raw.replace(/<\//g, '<\\/')
  const tag  = `<script>window.ATLAS_CONFIG=${safe};<\/script>`
  return html.replace(/(<head(?:[^>]*)>)/i, `$1\n  ${tag}`)
}
```

- [ ] **Step 4: Update `serve()` pipeline to call `injectAtlasConfig` AFTER `rewriteDistHtml`**

In `createDistServeService`, find the block (around line 268–271):

```js
const injected  = injectSeoTags(html, site.seo_defaults)
const rewritten = rewriteDistHtml(injected, storageBase, '', siteOrigin)
const final     = injectErpBadge(rewritten)
```

Replace it with:

```js
const injected    = injectSeoTags(html, site.seo_defaults)
const rewritten   = rewriteDistHtml(injected, storageBase, '', siteOrigin)
const withConfig  = injectAtlasConfig(rewritten, {
  supabaseUrl:    process.env.SUPABASE_URL   ?? '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  apiUrl: '/',
})
const final = injectErpBadge(withConfig)
```

- [ ] **Step 5: Run tests — all must pass**

```bash
node --test apps/api/src/services/__tests__/dist-serve-service.test.js
```

Expected: all tests pass including the new `injectAtlasConfig` suite.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/dist-serve-service.js apps/api/src/services/__tests__/dist-serve-service.test.js
git commit -m "feat(dist): inject window.ATLAS_CONFIG into dist HTML responses"
```

---

## Task 2: Create `atlas-sdk.js`

**Files:**
- Create: `apps/api/src/public/atlas-sdk.js`

This is a self-contained IIFE. It calls the Supabase Auth REST API directly — no library required. The file is written directly (no build step needed).

- [ ] **Step 1: Create `apps/api/src/public/` directory and write `atlas-sdk.js`**

Create `apps/api/src/public/atlas-sdk.js` with the following content:

```js
;(function (global) {
  'use strict'

  // ── Config ──────────────────────────────────────────────────────────────────
  var cfg = global.ATLAS_CONFIG || {}
  var SUPABASE_URL     = (cfg.supabaseUrl     || '').replace(/\/$/, '')
  var SUPABASE_KEY     = cfg.supabaseAnonKey  || ''
  var API_URL          = (cfg.apiUrl          || '/').replace(/\/$/, '')
  var STORAGE_KEY      = cfg.storageKey       || ''

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function readSession() {
    if (!STORAGE_KEY) return null
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : null
    } catch (e) { return null }
  }

  function writeSession(session) {
    if (!STORAGE_KEY) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)) } catch (e) {}
  }

  function deleteSession() {
    if (!STORAGE_KEY) return
    try { localStorage.removeItem(STORAGE_KEY) } catch (e) {}
  }

  function isExpired(session) {
    if (!session || !session.expires_at) return true
    return session.expires_at - 10 < Math.floor(Date.now() / 1000)
  }

  function supabaseFetch(path, options) {
    return fetch(SUPABASE_URL + path, Object.assign({
      headers: Object.assign({ 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY }, options.headers || {}),
    }, options))
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d } }) })
  }

  // ── Observers ───────────────────────────────────────────────────────────────
  var _listeners = []
  function notify(event, session) {
    _listeners.forEach(function (cb) { try { cb(event, session) } catch (e) {} })
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', function (e) {
      if (e.key === STORAGE_KEY) notify('TOKEN_REFRESHED', readSession())
    })
  }

  // ── Auth ────────────────────────────────────────────────────────────────────
  var auth = {
    getSession: function () {
      return new Promise(function (resolve) {
        var session = readSession()
        if (!session) return resolve(null)
        if (!isExpired(session)) return resolve(session)
        // Try refresh
        if (!session.refresh_token) return resolve(null)
        supabaseFetch('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          body: JSON.stringify({ refresh_token: session.refresh_token }),
        }).then(function (res) {
          if (res.ok && res.data.access_token) {
            writeSession(res.data)
            notify('TOKEN_REFRESHED', res.data)
            resolve(res.data)
          } else {
            deleteSession()
            notify('SIGNED_OUT', null)
            resolve(null)
          }
        }).catch(function () { resolve(null) })
      })
    },

    getToken: function () {
      var session = readSession()
      if (!session || isExpired(session)) return null
      return session.access_token || null
    },

    signIn: function (credentials) {
      return supabaseFetch('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email: credentials.email, password: credentials.password }),
      }).then(function (res) {
        if (res.ok && res.data.access_token) {
          writeSession(res.data)
          notify('SIGNED_IN', res.data)
          return { session: res.data, error: null }
        }
        return { session: null, error: new Error(res.data.error_description || res.data.msg || 'Login fallido') }
      }).catch(function (err) {
        return { session: null, error: err }
      })
    },

    signOut: function () {
      var token = auth.getToken()
      var headers = token ? { 'Authorization': 'Bearer ' + token } : {}
      deleteSession()
      notify('SIGNED_OUT', null)
      if (!token) return Promise.resolve()
      return supabaseFetch('/auth/v1/logout', { method: 'POST', headers: headers })
        .then(function () {}).catch(function () {})
    },

    onAuthStateChange: function (callback) {
      _listeners.push(callback)
      return function () {
        _listeners = _listeners.filter(function (c) { return c !== callback })
      }
    },
  }

  // ── renderLogin ──────────────────────────────────────────────────────────────
  function renderLogin(selector, options) {
    var opts    = options || {}
    var target  = typeof selector === 'string' ? document.querySelector(selector) : selector
    if (!target) return

    var labels = opts.labels || {}
    var title    = labels.title    || 'Iniciar sesion'
    var subtitle = labels.subtitle || 'Accede a tu cuenta para continuar.'
    var btnLabel = labels.button   || 'Entrar'
    var theme    = opts.theme || 'auto'

    // ── CSS variables ───────────────────────────────────────────────────────
    var lightVars = [
      '--ae-bg:#ffffff', '--ae-fg:#111827', '--ae-muted:#6b7280',
      '--ae-border:#e5e7eb', '--ae-input-bg:#f9fafb',
      '--ae-primary:#4f46e5', '--ae-primary-fg:#ffffff',
      '--ae-error-bg:#fef2f2', '--ae-error-border:#fecaca', '--ae-error-fg:#dc2626',
    ].join(';')
    var darkVars = [
      '--ae-bg:#111827', '--ae-fg:#f9fafb', '--ae-muted:#9ca3af',
      '--ae-border:#374151', '--ae-input-bg:#1f2937',
      '--ae-primary:#6366f1', '--ae-primary-fg:#ffffff',
      '--ae-error-bg:#1f0a0a', '--ae-error-border:#7f1d1d', '--ae-error-fg:#f87171',
    ].join(';')

    var styleId = '_ae_login_style'
    if (!document.getElementById(styleId)) {
      var styleEl = document.createElement('style')
      styleEl.id  = styleId
      styleEl.textContent = [
        '._ae-wrap{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-sizing:border-box;width:100%;max-width:360px}',
        '._ae-wrap *{box-sizing:border-box}',
        '._ae-title{font-size:1.25rem;font-weight:700;color:var(--ae-fg);margin:0 0 4px}',
        '._ae-subtitle{font-size:.875rem;color:var(--ae-muted);margin:0 0 24px}',
        '._ae-label{display:block;font-size:.875rem;font-weight:500;color:var(--ae-fg);margin-bottom:4px}',
        '._ae-input{width:100%;padding:10px 14px;border:1px solid var(--ae-border);border-radius:8px;background:var(--ae-input-bg);color:var(--ae-fg);font-size:.875rem;outline:none;transition:border-color .15s}',
        '._ae-input:focus{border-color:var(--ae-primary)}',
        '._ae-field{margin-bottom:16px}',
        '._ae-btn{width:100%;padding:10px;border:none;border-radius:8px;background:var(--ae-primary);color:var(--ae-primary-fg);font-size:.875rem;font-weight:600;cursor:pointer;opacity:1;transition:opacity .15s}',
        '._ae-btn:hover:not(:disabled){opacity:.88}',
        '._ae-btn:disabled{opacity:.5;cursor:not-allowed}',
        '._ae-error{padding:10px 14px;border-radius:8px;font-size:.875rem;background:var(--ae-error-bg);border:1px solid var(--ae-error-border);color:var(--ae-error-fg);margin-bottom:16px}',
      ].join('\n')
      document.head.appendChild(styleEl)
    }

    // ── Determine CSS vars based on theme ───────────────────────────────────
    var resolvedDark = theme === 'dark' || (theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme:dark)').matches)

    // ── Build DOM ───────────────────────────────────────────────────────────
    target.innerHTML = ''
    var wrap = document.createElement('div')
    wrap.className = '_ae-wrap'
    wrap.setAttribute('style', (resolvedDark ? darkVars : lightVars))

    var h2 = document.createElement('h2')
    h2.className   = '_ae-title'
    h2.textContent = title

    var p = document.createElement('p')
    p.className   = '_ae-subtitle'
    p.textContent = subtitle

    var form = document.createElement('form')
    form.setAttribute('autocomplete', 'on')

    function field(id, type, labelText, autoComplete) {
      var div = document.createElement('div')
      div.className = '_ae-field'
      var lbl = document.createElement('label')
      lbl.className  = '_ae-label'
      lbl.htmlFor    = id
      lbl.textContent = labelText
      var inp = document.createElement('input')
      inp.type         = type
      inp.id           = id
      inp.name         = id
      inp.className    = '_ae-input'
      inp.autocomplete = autoComplete
      inp.required     = true
      div.appendChild(lbl)
      div.appendChild(inp)
      return { div: div, input: inp }
    }

    var emailF    = field('_ae_email',    'email',    'Correo electronico', 'email')
    var passwordF = field('_ae_password', 'password', 'Contrasena',         'current-password')

    var errorDiv = document.createElement('div')
    errorDiv.className = '_ae-error'
    errorDiv.style.display = 'none'

    var btn = document.createElement('button')
    btn.type      = 'submit'
    btn.className = '_ae-btn'
    btn.textContent = btnLabel

    form.appendChild(emailF.div)
    form.appendChild(passwordF.div)
    form.appendChild(errorDiv)
    form.appendChild(btn)

    wrap.appendChild(h2)
    wrap.appendChild(p)
    wrap.appendChild(form)
    target.appendChild(wrap)

    // ── Submit handler ───────────────────────────────────────────────────────
    form.addEventListener('submit', function (e) {
      e.preventDefault()
      errorDiv.style.display = 'none'
      btn.disabled    = true
      btn.textContent = 'Ingresando...'

      auth.signIn({ email: emailF.input.value.trim(), password: passwordF.input.value })
        .then(function (result) {
          if (result.error || !result.session) {
            var msg = result.error ? result.error.message : 'Credenciales invalidas'
            if (/invalid/i.test(msg)) msg = 'Correo o contrasena incorrectos.'
            errorDiv.textContent    = msg
            errorDiv.style.display  = 'block'
            btn.disabled            = false
            btn.textContent         = btnLabel
            if (opts.onError) opts.onError(result.error || new Error(msg))
            return
          }
          if (opts.onSuccess) opts.onSuccess(result.session)
          if (opts.redirectTo) window.location.href = opts.redirectTo
        })
        .catch(function (err) {
          errorDiv.textContent   = 'Error inesperado. Intenta de nuevo.'
          errorDiv.style.display = 'block'
          btn.disabled           = false
          btn.textContent        = btnLabel
          if (opts.onError) opts.onError(err)
        })
    })
  }

  // ── Expose ───────────────────────────────────────────────────────────────────
  global.AtlasERP = {
    config: {
      supabaseUrl: SUPABASE_URL,
      apiUrl:      API_URL,
      storageKey:  STORAGE_KEY,
    },
    auth:        auth,
    renderLogin: renderLogin,
  }

})(window)
```

- [ ] **Step 2: Verify file syntax with node**

```bash
node --check apps/api/src/public/atlas-sdk.js
```

Expected: no output (no syntax errors).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/public/atlas-sdk.js
git commit -m "feat(dist): add atlas-sdk.js — window.AtlasERP auth + renderLogin"
```

---

## Task 3: Serve `/atlas-sdk.js` from the API

**Files:**
- Modify: `apps/api/src/index.js`

Nginx proxies `GET /atlas-sdk.js` → `GET /public/site/atlas-sdk.js` on the API (see `infra/nginx/spa.conf` line 83: `proxy_pass $upstream/public/site$request_uri`). We add a dedicated Hono route **before** the `app.get("/public/site/*", ...)` catch-all.

- [ ] **Step 1: Find the exact line of the catch-all in `index.js`**

```bash
grep -n 'public/site/\*\|public/site/erp-badge' apps/api/src/index.js
```

Expected output (approximate):
```
3143: app.get("/public/site/erp-badge-check", ...
3159: app.get("/public/site/*", ...
```

- [ ] **Step 2: Add the `/atlas-sdk.js` route in `index.js`**

Locate `app.get("/public/site/erp-badge-check"` in `apps/api/src/index.js`. Directly BEFORE that line, add:

```js
app.get("/public/site/atlas-sdk.js", async (c) => {
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const __dir = dirname(fileURLToPath(import.meta.url))
  const sdkPath = join(__dir, 'public', 'atlas-sdk.js')
  try {
    const code = await readFile(sdkPath, 'utf8')
    c.header('Content-Type', 'application/javascript; charset=utf-8')
    c.header('Cache-Control', 'public, max-age=3600')
    return c.text(code)
  } catch {
    return c.text('/* atlas-sdk not found */', 404)
  }
})
```

- [ ] **Step 3: Smoke test with curl (API must be running)**

Start the API if not running: `pnpm dev:api`

Then:
```bash
curl -s http://localhost:4010/public/site/atlas-sdk.js | head -5
```

Expected: starts with `;(function (global) {`

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.js
git commit -m "feat(dist): serve /atlas-sdk.js from API public route"
```

---

## Task 4: Integration guide in `DistUploadPanel`

**Files:**
- Modify: `apps/desktop/src/modules/atlas.website/components/DistUploadPanel.jsx`

Add a collapsible "Integracion de auth" section below the build history accordion. It has a tab strip (React / Astro / Next.js / SvelteKit / Vite / Manual) and a code block per tab with a copy button.

- [ ] **Step 1: Add state + constants for the guide section**

At the top of `DistUploadPanel.jsx`, add these imports (if not already present):

```js
import { useState } from "react";          // already present
import { Copy, ChevronDown, ChevronRight } from "lucide-react"; // already present
```

Inside the `DistUploadPanel` function body, after the existing state declarations, add:

```js
const [guideOpen, setGuideOpen] = useState(false)
const [guideTab, setGuideTab] = useState('react')
```

- [ ] **Step 2: Add the `GUIDE_TABS` constant and `copyCode` helper**

Add this block just before the `return (` statement of `DistUploadPanel`:

```js
const GUIDE_TABS = [
  { key: 'react',     label: 'React' },
  { key: 'astro',     label: 'Astro' },
  { key: 'nextjs',    label: 'Next.js' },
  { key: 'svelte',    label: 'SvelteKit' },
  { key: 'vite',      label: 'Vite' },
  { key: 'manual',    label: 'Manual' },
]

const GUIDE_SNIPPETS = {
  react: `// 1. Add to your index.html <head>:
// <script src="/atlas-sdk.js"></script>

// 2. Detect existing session
import { useEffect, useState } from 'react'

export function useAtlasSession() {
  const [session, setSession] = useState(undefined)
  useEffect(() => {
    window.AtlasERP.auth.getSession().then(setSession)
    return window.AtlasERP.auth.onAuthStateChange((_, s) => setSession(s))
  }, [])
  return session  // undefined=loading, null=not logged in, object=logged in
}

// 3. Render embedded login
export function Login() {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) {
      window.AtlasERP.renderLogin(ref.current, {
        onSuccess: (session) => console.log('logged in', session),
      })
    }
  }, [])
  return <div ref={ref} />
}`,

  astro: `<!-- 1. Add to src/layouts/Base.astro <head> -->
<script src="/atlas-sdk.js"></script>

<!-- 2. Render embedded login in any page -->
<div id="atlas-login"></div>
<script>
  window.AtlasERP.renderLogin('#atlas-login', {
    onSuccess: () => { window.location.href = '/dashboard' }
  })
</script>

<!-- 3. Read session in client scripts -->
<script>
  const session = await window.AtlasERP.auth.getSession()
  if (session) console.log('user:', session.user.email)
</script>`,

  nextjs: `// 1. Add to app/layout.tsx
import Script from 'next/script'
// Inside <head> or after providers:
// <Script src="/atlas-sdk.js" strategy="beforeInteractive" />

// 2. Client component for login
'use client'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const ref = useRef(null)
  const router = useRouter()
  useEffect(() => {
    if (ref.current) {
      window.AtlasERP.renderLogin(ref.current, {
        onSuccess: () => router.push('/'),
      })
    }
  }, [])
  return <div ref={ref} />
}`,

  svelte: `<!-- 1. Add to src/app.html <head> -->
<script src="/atlas-sdk.js"></script>

<!-- 2. src/routes/login/+page.svelte -->
<script>
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  let container

  onMount(() => {
    window.AtlasERP.renderLogin(container, {
      onSuccess: () => goto('/')
    })
  })
</script>

<div bind:this={container} />`,

  vite: `// 1. Add to index.html <head>:
// <script src="/atlas-sdk.js"></script>

// 2. main.js — detect session and render login if needed
window.AtlasERP.auth.getSession().then((session) => {
  if (session) {
    initApp(session)
  } else {
    window.AtlasERP.renderLogin('#login-container', {
      onSuccess: (s) => {
        document.getElementById('login-container').remove()
        initApp(s)
      },
    })
  }
})

function initApp(session) {
  console.log('App running for', session.user.email)
}`,

  manual: `// window.ATLAS_CONFIG is injected automatically by Atlas when your
// dist is served. You can use it to initialize your own Supabase client.

// Option A — Use @supabase/supabase-js directly
import { createClient } from '@supabase/supabase-js'

const { supabaseUrl, supabaseAnonKey } = window.ATLAS_CONFIG
const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Session is automatically shared with Atlas ERP (same localStorage key)
const { data: { session } } = await supabase.auth.getSession()

// Option B — Read raw token from localStorage (advanced)
const { storageKey } = window.ATLAS_CONFIG
const raw   = JSON.parse(localStorage.getItem(storageKey) || '{}')
const token = raw.access_token ?? null`,
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => toast.success('Copiado'))
}
```

- [ ] **Step 3: Add the guide section JSX to the return statement**

Inside the `return (` of `DistUploadPanel`, after the closing `</div>` of the build history section and before the first `<ConfirmDialog`, add:

```jsx
{/* Integration guide */}
<div className="rounded-2xl border border-border overflow-hidden">
  <button
    type="button"
    onClick={() => setGuideOpen((o) => !o)}
    className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors cursor-pointer"
  >
    <span className="text-foreground">Integracion de auth</span>
    {guideOpen
      ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
      : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
  </button>

  {guideOpen && (
    <div className="border-t border-border">
      <p className="px-4 pt-3 pb-2 text-xs text-muted-foreground leading-relaxed">
        Agrega <code className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono">&lt;script src="/atlas-sdk.js"&gt;&lt;/script&gt;</code> al <code className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono">&lt;head&gt;</code> de tu frontend. Atlas inyecta <code className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono">window.ATLAS_CONFIG</code> automaticamente con las credenciales de Supabase — la sesion se comparte con Atlas ERP por el mismo localStorage.
      </p>

      {/* Tab strip */}
      <div className="flex gap-1 px-4 pb-2 overflow-x-auto">
        {GUIDE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setGuideTab(tab.key)}
            className={[
              'shrink-0 px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer',
              guideTab === tab.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Code block */}
      <div className="mx-4 mb-4 relative">
        <pre className="text-[11px] font-mono bg-muted/60 border border-border rounded-xl p-4 overflow-x-auto leading-relaxed whitespace-pre-wrap break-words text-foreground">
          {GUIDE_SNIPPETS[guideTab]}
        </pre>
        <button
          type="button"
          onClick={() => copyToClipboard(GUIDE_SNIPPETS[guideTab])}
          className="absolute top-2 right-2 h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          title="Copiar"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 4: Verify the file has no import issues**

```bash
node --check apps/desktop/src/modules/atlas.website/components/DistUploadPanel.jsx
```

Expected: no output. (If it complains about JSX, that's expected — the check is for syntax only. If it errors on a missing import, add `import { getApiUrl } from '../../../lib/runtimeConfig.js'` to the imports.)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/atlas.website/components/DistUploadPanel.jsx
git commit -m "feat(dist): add auth integration guide to DistUploadPanel"
```

---

## Task 5: End-to-end smoke test

- [ ] **Step 1: Run all dist-serve-service tests**

```bash
node --test apps/api/src/services/__tests__/dist-serve-service.test.js
```

Expected: all tests pass.

- [ ] **Step 2: Verify SDK is accessible via the API**

With `pnpm dev:api` running:
```bash
curl -s http://localhost:4010/public/site/atlas-sdk.js | grep 'AtlasERP'
```

Expected: output includes `global.AtlasERP = {`

- [ ] **Step 3: Verify ATLAS_CONFIG injection logic**

Quick Node script — create and immediately delete:
```bash
node -e "
import('./apps/api/src/services/dist-serve-service.js').then(m => {
  const html = '<html><head></head><body></body></html>'
  const result = m.injectAtlasConfig(html, {
    supabaseUrl: 'https://supabase.example.com',
    supabaseAnonKey: 'testkey',
    apiUrl: '/'
  })
  console.log(result.includes('window.ATLAS_CONFIG') ? 'OK' : 'FAIL')
  console.log(result.includes('sb-supabase-auth-token') ? 'OK storageKey' : 'FAIL storageKey')
})
"
```

Expected:
```
OK
OK storageKey
```

- [ ] **Step 4: Final commit if anything was missed**

```bash
git status
```

If clean, done. If there are unstaged changes, stage and commit them with an appropriate message.
