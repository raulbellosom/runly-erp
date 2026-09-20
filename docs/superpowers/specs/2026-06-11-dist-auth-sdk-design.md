# Atlas Dist Auth SDK — Design Spec

**Date:** 2026-06-11  
**Status:** Approved  
**Scope:** Session sharing and embedded login between Atlas ERP and `source_type=dist` frontends

---

## Problem

When a website is configured as `source_type=dist`, the uploaded frontend (React, Astro, Next.js, SvelteKit, Vite) has no way to:
1. Detect whether a visitor is already logged into Atlas ERP.
2. Allow visitors to log in to Atlas ERP from within the dist frontend.

The session already lives in `localStorage` (Supabase stores it as `sb-{projectRef}-auth-token`). Since both Atlas ERP and the dist are served from the same origin, the session is physically shared — the dist just does not know the Supabase credentials to initialize its own client and read it.

---

## Why It Works Without Magic

Supabase derives the localStorage key from the project URL:  
`sb-{hostname_first_segment}-auth-token`  
e.g. for `https://supabase.example.com` → `sb-supabase-auth-token`

If the dist frontend creates a `@supabase/supabase-js` client with the same `supabaseUrl` and `supabaseAnonKey`, it automatically reads and writes the exact same localStorage entry as Atlas ERP. No custom sync required.

---

## Architecture

### 1. `window.ATLAS_CONFIG` injection (server-side)

`dist-serve-service.js` already injects the ERP beacon script into every dist HTML response (`injectErpBadge`). We add a sibling function `injectAtlasConfig` that injects into the `<head>`:

```html
<script>
window.ATLAS_CONFIG = {
  supabaseUrl:   "https://supabase.example.com",
  supabaseAnonKey: "eyJ...",
  apiUrl:        "/api",
  storageKey:    "sb-supabase-auth-token"
};
</script>
```

`storageKey` is computed at injection time from the URL:  
```js
const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
const storageKey = `sb-${projectRef}-auth-token`
```

This makes it trivial for developers who want full control to read the session directly from `localStorage[storageKey]` without using the SDK at all.

`injectAtlasConfig` runs **before** `injectErpBadge` so the config is available when the beacon script reads `localStorage`.

### 2. `/atlas-sdk.js` endpoint

The API serves `GET /atlas-sdk.js` as a static pre-built file located at  
`apps/api/src/public/atlas-sdk.js`.

Hono serves the directory as static files. The file is vanilla JS (no ESM, IIFE wrapper), with `@supabase/supabase-js` bundled inline. Target size: ~35 KB minified.

The file is built separately (e.g. `pnpm build:sdk`) and committed to the repo. It is not compiled at request time.

### 3. `window.AtlasERP` — SDK contract

```js
// Initialized synchronously from window.ATLAS_CONFIG (no async needed)
window.AtlasERP = {

  // Exposed config (read-only)
  config: {
    supabaseUrl:    string,
    apiUrl:         string,
    storageKey:     string,   // localStorage key name
  },

  // Auth
  auth: {
    getSession():          Promise<Session | null>,
    signIn({ email, password }): Promise<{ session: Session | null, error: Error | null }>,
    signOut():             Promise<void>,
    onAuthStateChange(cb): () => void,   // returns unsubscribe fn
    getToken():            string | null, // current access_token or null
  },

  // Embeddable login UI
  renderLogin(selector, options): void,
  // selector  : CSS selector string | HTMLElement
  // options   : {
  //   onSuccess?: (session: Session) => void,
  //   onError?:   (error: Error) => void,
  //   redirectTo?: string,          // URL to navigate after login (default: current page)
  //   labels?: {
  //     title?:    string,           // default: "Iniciar sesion"
  //     subtitle?: string,           // default: "Accede a tu cuenta para continuar."
  //     button?:   string,           // default: "Entrar"
  //   },
  //   theme?: 'auto' | 'light' | 'dark',  // default: 'auto'
  // }
}
```

`renderLogin` mounts a self-contained form (vanilla DOM, scoped CSS) inside the target element. It does NOT use shadow DOM — styles use a namespaced class prefix (`_ae-`) to avoid collisions. On successful `signIn`, it calls `onSuccess(session)` and optionally navigates to `redirectTo`.

### 4. Registration

The Atlas ERP auth model uses Supabase Auth. New user registration is **invite-only** via the admin panel — there is no public `signUp` in the SDK. If the dist frontend needs a public-facing "contact" or "client account" flow in the future, that is a separate feature tracked independently. For now `signUp` is intentionally absent from the SDK.

---

## Integration — Per-Framework Guide

All frameworks share the same two steps:

**Step 1:** Add to your HTML entry point (e.g. `index.html`, `app.html`, `_document.jsx`):
```html
<script src="/atlas-sdk.js"></script>
```

**Step 2:** Use the SDK.

### React (Vite SPA)
```jsx
// src/hooks/useAtlasSession.js
import { useState, useEffect } from 'react'

export function useAtlasSession() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    window.AtlasERP.auth.getSession().then(setSession)
    const unsub = window.AtlasERP.auth.onAuthStateChange((_, s) => setSession(s))
    return unsub
  }, [])

  return session  // undefined = loading, null = not logged in, Session = logged in
}

// src/components/Login.jsx
export function Login() {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current) return
    window.AtlasERP.renderLogin(ref.current, {
      onSuccess: (session) => console.log('logged in', session),
    })
  }, [])
  return <div ref={ref} />
}
```

### Astro (static export)
```astro
---
// src/pages/login.astro
---
<div id="atlas-login"></div>
<script>
  window.AtlasERP.renderLogin('#atlas-login', {
    onSuccess: () => { window.location.href = '/dashboard' }
  })
</script>
```

### Next.js (static export — `output: 'export'`)
```tsx
// app/login/page.tsx  (client component)
'use client'
import { useEffect, useRef } from 'react'

export default function LoginPage() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) {
      window.AtlasERP.renderLogin(ref.current, {
        onSuccess: () => router.push('/'),
      })
    }
  }, [])
  return <div ref={ref} />
}
```

Add to `app/layout.tsx`:
```tsx
<Script src="/atlas-sdk.js" strategy="beforeInteractive" />
```

### SvelteKit (static adapter)
```svelte
<!-- src/routes/login/+page.svelte -->
<script>
  import { onMount } from 'svelte'
  let container

  onMount(() => {
    window.AtlasERP.renderLogin(container, {
      onSuccess: () => goto('/')
    })
  })
</script>

<div bind:this={container} />
```

Add to `src/app.html`:
```html
<script src="/atlas-sdk.js"></script>
```

### Vite (vanilla / generic SPA)
```js
// main.js
window.AtlasERP.auth.getSession().then((session) => {
  if (!session) {
    window.AtlasERP.renderLogin('#login-container', {
      onSuccess: () => window.location.reload(),
    })
  } else {
    initApp(session)
  }
})
```

---

## Manual integration (no SDK — full control)

For developers who want to use their own Supabase client:

```js
// Read credentials from injected config
const { supabaseUrl, supabaseAnonKey, storageKey } = window.ATLAS_CONFIG

// Initialize your own Supabase client (same URL = same localStorage key = shared session)
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Session is automatically shared with Atlas ERP
const { data: { session } } = await supabase.auth.getSession()
```

The `storageKey` field is provided as a convenience for developers who want to read the raw token directly. Note: using the Supabase client or the SDK is preferred since they handle this key automatically:
```js
// Convenience — only if you need raw localStorage access
const raw = JSON.parse(localStorage.getItem(window.ATLAS_CONFIG.storageKey) || '{}')
const token = raw.access_token ?? null
```

---

## `dist-serve-service.js` changes

Two new exported functions alongside the existing ones:

```js
export function injectAtlasConfig(html, { supabaseUrl, supabaseAnonKey, apiUrl }) {
  const projectRef  = new URL(supabaseUrl).hostname.split('.')[0]
  const storageKey  = `sb-${projectRef}-auth-token`
  const config = JSON.stringify({ supabaseUrl, supabaseAnonKey, apiUrl, storageKey })
  const tag    = `<script>window.ATLAS_CONFIG=${config};<\/script>`
  return html.replace(/(<head(?:[^>]*)>)/i, `$1\n  ${tag}`)
}
```

Call order in `serve()`:
```
injectSeoTags → injectAtlasConfig → rewriteDistHtml → injectErpBadge
```

`injectAtlasConfig` injects into `<head>` (JSON string values, not HTML attributes), so `rewriteDistHtml`'s attribute regex does not affect the injected config. The order between `injectAtlasConfig` and `injectErpBadge` does not matter functionally — the beacon reads `localStorage` at `DOMContentLoaded`, not from `window.ATLAS_CONFIG`. Config-first is preferred for clarity.

---

## API changes

### Static file serving

`apps/api/src/public/atlas-sdk.js` is the pre-built SDK bundle.  
Hono serves it with:

```js
app.use('/atlas-sdk.js', serveStatic({ path: './src/public/atlas-sdk.js' }))
```

Headers: `Content-Type: application/javascript`, `Cache-Control: public, max-age=3600`.

### No new auth endpoints needed

The SDK uses the existing `@supabase/supabase-js` client internally. All auth calls go directly to the Supabase Auth server — no Atlas API proxy needed.

---

## SDK build

A new workspace package or build script at `apps/sdk-browser/` (or a simple esbuild script in `apps/api/scripts/build-sdk.js`):

- Entry: `apps/api/src/public/atlas-sdk.src.js`
- Bundles: `@supabase/supabase-js` inline
- Output format: IIFE, global `window.AtlasERP`
- Target: ES2018 (broad browser compat)
- Output: `apps/api/src/public/atlas-sdk.js`
- Build command: `pnpm build:sdk`

The built file is committed to the repo (no runtime build step).

---

## DistUploadPanel UI changes

The `DistUploadPanel` component gets a new collapsible section "Integracion de auth" (collapsed by default, below the build history). It contains:

- A tab strip: React / Astro / Next.js / SvelteKit / Vite / Manual
- The relevant code snippet for each (copy button included)
- A note explaining that `window.ATLAS_CONFIG` is automatically injected by Atlas when the dist is served — no configuration needed on the developer side

---

## Future pnpm package contract (`@atlas/client-sdk`)

When this SDK is eventually published as a pnpm/npm package for use in external projects, it must implement the same interface:

```ts
// @atlas/client-sdk
export interface AtlasConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  apiUrl: string
}

export interface AtlasAuth {
  getSession(): Promise<Session | null>
  signIn(credentials: { email: string; password: string }): Promise<{ session: Session | null; error: Error | null }>
  signOut(): Promise<void>
  onAuthStateChange(cb: (event: string, session: Session | null) => void): () => void
  getToken(): string | null
}

export interface RenderLoginOptions {
  onSuccess?: (session: Session) => void
  onError?: (error: Error) => void
  redirectTo?: string
  labels?: { title?: string; subtitle?: string; button?: string }
  theme?: 'auto' | 'light' | 'dark'
}

export declare function createAtlasClient(config: AtlasConfig): {
  auth: AtlasAuth
  renderLogin(target: string | HTMLElement, options?: RenderLoginOptions): void
  config: { supabaseUrl: string; apiUrl: string; storageKey: string }
}
```

The pnpm package differs from the browser bundle in one way: instead of reading `window.ATLAS_CONFIG`, it receives config explicitly via `createAtlasClient(config)`. This allows use in server-side rendering contexts and in non-Atlas-hosted deployments.

---

## Out of scope

- Public user `signUp` / registration flow (invite-only model is unchanged)
- OAuth / social login providers
- Token refresh handling (Supabase JS handles this internally)
- Server-side rendering of auth state (all auth is client-side)
