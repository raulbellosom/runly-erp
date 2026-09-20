# Unified Storefront Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@raulbellosom/atlas-sdk` use `@supabase/supabase-js` directly for auth so the session lands in the same localStorage key (`sb-<project>-auth-token`) as Atlas ERP — enabling a single login for storefront users and ERP users, with role-based navigation between the two.

**Architecture:** The npm SDK currently calls `POST /public/storefront/auth/login`, which internally calls Supabase and returns the token, but the SDK stores it in its own format under `sf_session`. The fix: the SDK calls `supabase.auth.signInWithPassword()` directly so `@supabase/supabase-js` handles persistence in the standard key. After Supabase login, the SDK calls `GET /public/storefront/auth/me` for the role profile. ERP users who log in on the storefront automatically see the ERP badge (the existing `erp-badge-check` endpoint reads from the same key). On the API side, `/me` gets a lighter middleware (`anyAuthMiddleware`) so ERP-role users can also retrieve their profile and be redirected appropriately.

**Tech Stack:** `@supabase/supabase-js` v2 (already a dependency), Node.js built-in test runner, Hono.

**Breaking changes in the npm SDK (v0.x, acceptable):**
- `createStorefrontClient` now requires `supabaseUrl` and `supabaseAnonKey` options.
- `initialSession` option is removed (Supabase handles localStorage restore automatically).
- `onSessionChange` is retained but now fires from `supabase.auth.onAuthStateChange`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `apps/api/src/routes/storefront/storefront-middleware.js` | Add `anyAuthMiddleware` — validates Supabase token without role filter |
| Modify | `apps/api/src/routes/storefront/storefront-auth-routes.js` | Wire `/me` to `anyAuthMiddleware`; expose `anyAuthMiddleware` from router factory |
| Modify | `apps/api/src/services/storefront-auth-service.js` | Update `me()` to return profile for any role, not just storefront roles |
| Modify | `apps/api/src/services/__tests__/storefront-auth-service.test.js` | Add test for non-storefront role in `me()` |
| Modify | `packages/storefront-sdk/src/core/session.js` | Rewrite as Supabase session adapter (in-memory cache from `onAuthStateChange`) |
| Modify | `packages/storefront-sdk/src/__tests__/session.test.js` | Update tests for the new adapter |
| Modify | `packages/storefront-sdk/src/auth.js` | Use Supabase for login/logout/refresh; keep register and `/me` via API |
| Modify | `packages/storefront-sdk/src/__tests__/auth.test.js` | Update tests with Supabase mock |
| Modify | `packages/storefront-sdk/src/index.js` | Add `supabaseUrl`, `supabaseAnonKey`; create Supabase client; pass to auth + session |
| Modify | `packages/storefront-sdk/package.json` | Bump to 0.2.0 |
| Modify | `packages/storefront-sdk/README.md` | Update init example with new options; document role-based ERP redirect pattern |
| Modify | `docs/ai-context/atlas-storefront-sdk.md` | Reflect unified auth; remove "sessions do not overlap" note |

---

## Task 1 — API: anyAuthMiddleware + relax /me

**Files:**
- Modify: `apps/api/src/routes/storefront/storefront-middleware.js`
- Modify: `apps/api/src/routes/storefront/storefront-auth-routes.js`
- Modify: `apps/api/src/services/storefront-auth-service.js`
- Modify: `apps/api/src/services/__tests__/storefront-auth-service.test.js`

- [ ] **Step 1: Add `anyAuthMiddleware` to storefront-middleware.js**

Open `apps/api/src/routes/storefront/storefront-middleware.js`. Add a second exported middleware at the end of the factory that validates the Supabase token and finds ANY active membership (no role filter):

```js
export function createStorefrontMiddleware({ prisma, supabaseAdmin }) {
  async function getRegistrableRoles() {
    const config = await prisma.instanceConfig.findUnique({
      where: { key: 'storefront.registrable_roles' },
    })
    if (!config) return ['storefront_client', 'storefront_vendor']
    try { return JSON.parse(config.value) } catch { return [] }
  }

  async function storefrontAuthMiddleware(c, next) {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'No autorizado' }, 401)
    }
    const token = authHeader.replace('Bearer ', '')

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !user) {
      return c.json({ error: 'Token inválido o expirado' }, 401)
    }

    const companySlug = c.req.header('X-Atlas-Company')
    if (!companySlug) {
      return c.json({ error: 'Cabecera X-Atlas-Company requerida' }, 400)
    }

    const profile = await prisma.userProfile.findUnique({
      where: { authUserId: user.id },
      include: {
        memberships: {
          where: { enabled: true },
          include: { role: true, company: { select: { id: true, slug: true } } },
        },
      },
    })
    if (!profile) {
      return c.json({ error: 'Perfil no encontrado' }, 401)
    }

    const allowedRoles = await getRegistrableRoles()
    const membership = profile.memberships.find(
      m => m.role != null && m.company.slug === companySlug && allowedRoles.includes(m.role.key)
    )
    if (!membership) {
      return c.json({ error: 'Sin acceso a esta plataforma' }, 403)
    }

    c.set('storefrontUser', { profile, membership, role: membership.role, companySlug })
    await next()
  }

  // Validates Supabase token and finds ANY active membership — no role restriction.
  // Used for /me so ERP users can also retrieve their profile.
  async function anyAuthMiddleware(c, next) {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'No autorizado' }, 401)
    }
    const token = authHeader.replace('Bearer ', '')

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !user) {
      return c.json({ error: 'Token inválido o expirado' }, 401)
    }

    const companySlug = c.req.header('X-Atlas-Company')
    if (!companySlug) {
      return c.json({ error: 'Cabecera X-Atlas-Company requerida' }, 400)
    }

    const profile = await prisma.userProfile.findUnique({
      where: { authUserId: user.id },
      include: {
        memberships: {
          where: { enabled: true },
          include: { role: true, company: { select: { id: true, slug: true } } },
        },
      },
    })
    if (!profile) {
      return c.json({ error: 'Perfil no encontrado' }, 401)
    }

    const membership = profile.memberships.find(
      m => m.role != null && m.company.slug === companySlug
    )
    if (!membership) {
      return c.json({ error: 'Sin membresía activa en esta empresa' }, 403)
    }

    c.set('storefrontUser', { profile, membership, role: membership.role, companySlug })
    await next()
  }

  return { storefrontAuthMiddleware, anyAuthMiddleware }
}
```

- [ ] **Step 2: Wire `anyAuthMiddleware` into the router factory**

Open `apps/api/src/routes/storefront/storefront-router.js`. The router factory receives the middleware from `createStorefrontMiddleware`. Destructure `anyAuthMiddleware` and pass it to `createStorefrontAuthRoutes`:

```js
// Find the line that creates the auth routes, it currently looks like:
const { storefrontAuthMiddleware } = createStorefrontMiddleware({ prisma, supabaseAdmin })
// Replace with:
const { storefrontAuthMiddleware, anyAuthMiddleware } = createStorefrontMiddleware({ prisma, supabaseAdmin })
```

Then find where `createStorefrontAuthRoutes` is called and add `anyAuthMiddleware`:
```js
// Before:
const authRoutes = createStorefrontAuthRoutes({ authService, storefrontAuthMiddleware })
// After:
const authRoutes = createStorefrontAuthRoutes({ authService, storefrontAuthMiddleware, anyAuthMiddleware })
```

- [ ] **Step 3: Use `anyAuthMiddleware` for `/me` in storefront-auth-routes.js**

Open `apps/api/src/routes/storefront/storefront-auth-routes.js`. Update the factory signature and the `/me` route:

```js
export function createStorefrontAuthRoutes({ authService, storefrontAuthMiddleware, anyAuthMiddleware }) {
  const app = new Hono()

  app.post('/register', async (c) => {
    // ... unchanged ...
  })

  app.post('/login', async (c) => {
    // ... unchanged ...
  })

  app.post('/refresh', async (c) => {
    // ... unchanged ...
  })

  // Changed: anyAuthMiddleware instead of storefrontAuthMiddleware
  app.get('/me', anyAuthMiddleware, async (c) => {
    const { profile, companySlug } = c.get('storefrontUser')
    try {
      const user = await authService.me(profile.authUserId, companySlug)
      return c.json({ data: user })
    } catch (err) {
      return c.json({ error: err.message }, err.status ?? 500)
    }
  })

  app.post('/logout', storefrontAuthMiddleware, async (c) => {
    const authHeader = c.req.header('Authorization')
    const token = authHeader?.replace('Bearer ', '') ?? ''
    try {
      await authService.logout(token)
      return c.json({ data: { success: true } })
    } catch (err) {
      return c.json({ error: err.message }, err.status ?? 500)
    }
  })

  return app
}
```

- [ ] **Step 4: Update `me()` in storefront-auth-service.js to remove role filter**

Open `apps/api/src/services/storefront-auth-service.js`. Find the `me` function and remove the `allowedRoles` filter:

```js
  async function me(authUserId, companySlug) {
    const profile = await prisma.userProfile.findUnique({
      where: { authUserId },
      include: {
        memberships: {
          where: { enabled: true },
          include: { role: true, company: { select: { slug: true } } },
        },
      },
    })
    if (!profile) {
      throw Object.assign(new Error('Perfil no encontrado'), { code: 'NOT_FOUND', status: 404 })
    }
    // Find membership for this company regardless of role (ERP users are welcome)
    const membership = profile.memberships.find(
      m => m.role != null && m.company.slug === companySlug
    )
    if (!membership) {
      throw Object.assign(new Error('Sin acceso'), { code: 'FORBIDDEN', status: 403 })
    }
    return buildStorefrontUserProfile(profile, membership.role)
  }
```

- [ ] **Step 5: Add test for non-storefront role in `me()`**

Open `apps/api/src/services/__tests__/storefront-auth-service.test.js`. Add a new describe block after the existing ones:

```js
describe('buildStorefrontUserProfile with non-storefront role', () => {
  it('returns profile with ERP role when role is not storefront', () => {
    const profile = {
      id: 'erp-user-1',
      displayName: 'Admin User',
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@example.com',
      phone: null,
      bio: null,
      enabled: true,
    }
    const role = { key: 'admin', name: 'Administrador' }
    const result = buildStorefrontUserProfile(profile, role)
    assert.equal(result.role, 'admin')
    assert.equal(result.displayName, 'Admin User')
    assert.equal(result.id, 'erp-user-1')
  })
})
```

- [ ] **Step 6: Run the API tests**

```bash
node --test apps/api/src/services/__tests__/storefront-auth-service.test.js
```

Expected: all tests pass including the new `buildStorefrontUserProfile with non-storefront role` suite.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/storefront/storefront-middleware.js apps/api/src/routes/storefront/storefront-auth-routes.js apps/api/src/routes/storefront/storefront-router.js apps/api/src/services/storefront-auth-service.js apps/api/src/services/__tests__/storefront-auth-service.test.js
git commit -m "feat(storefront): add anyAuthMiddleware and relax /me to accept ERP users"
```

---

## Task 2 — SDK: Supabase session adapter

**Files:**
- Modify: `packages/storefront-sdk/src/core/session.js`
- Modify: `packages/storefront-sdk/src/__tests__/session.test.js`

- [ ] **Step 1: Write the failing tests for the new session adapter**

Replace the entire content of `packages/storefront-sdk/src/__tests__/session.test.js` with:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createSupabaseSessionAdapter } from '../core/session.js'

function makeSupabase({ initialSession = null } = {}) {
  let _session = initialSession
  const _listeners = []

  return {
    auth: {
      onAuthStateChange: (cb) => {
        _listeners.push(cb)
        // Fire INITIAL_SESSION synchronously (mirrors @supabase/supabase-js v2 behavior)
        if (_session) cb('INITIAL_SESSION', _session)
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      // Helper for tests to simulate session changes
      _fireChange(event, session) {
        _session = session
        for (const cb of _listeners) cb(event, session)
      },
    }
  }
}

describe('createSupabaseSessionAdapter', () => {
  it('starts null when Supabase has no session', () => {
    const supabase = makeSupabase()
    const adapter = createSupabaseSessionAdapter({ supabase })
    assert.equal(adapter.get(), null)
  })

  it('maps INITIAL_SESSION to SDK session format', () => {
    const supabase = makeSupabase({
      initialSession: { access_token: 'tok', refresh_token: 'ref', expires_at: 9999 }
    })
    const adapter = createSupabaseSessionAdapter({ supabase })
    const s = adapter.get()
    assert.equal(s.token, 'tok')
    assert.equal(s.refreshToken, 'ref')
    assert.equal(s.expiresAt, 9999)
    assert.equal(s.user, null)
  })

  it('updates cache on SIGNED_IN event', () => {
    const supabase = makeSupabase()
    const adapter = createSupabaseSessionAdapter({ supabase })
    supabase.auth._fireChange('SIGNED_IN', { access_token: 'new', refresh_token: 'r', expires_at: 1 })
    assert.equal(adapter.get()?.token, 'new')
  })

  it('clears cache on SIGNED_OUT event', () => {
    const supabase = makeSupabase({
      initialSession: { access_token: 'tok', refresh_token: 'ref', expires_at: 1 }
    })
    const adapter = createSupabaseSessionAdapter({ supabase })
    supabase.auth._fireChange('SIGNED_OUT', null)
    assert.equal(adapter.get(), null)
  })

  it('setUser enriches the cached session with user profile', () => {
    const supabase = makeSupabase({
      initialSession: { access_token: 'tok', refresh_token: 'ref', expires_at: 1 }
    })
    const adapter = createSupabaseSessionAdapter({ supabase })
    adapter.setUser({ id: '1', role: 'storefront_client' })
    assert.equal(adapter.get()?.user?.role, 'storefront_client')
  })

  it('setUser is a no-op when there is no session', () => {
    const supabase = makeSupabase()
    const adapter = createSupabaseSessionAdapter({ supabase })
    assert.doesNotThrow(() => adapter.setUser({ id: '1' }))
    assert.equal(adapter.get(), null)
  })

  it('fires onSessionChange when session changes', () => {
    const received = []
    const supabase = makeSupabase()
    createSupabaseSessionAdapter({ supabase, onSessionChange: (s) => received.push(s) })
    supabase.auth._fireChange('SIGNED_IN', { access_token: 'x', refresh_token: 'r', expires_at: 1 })
    assert.equal(received.length, 1)
    assert.equal(received[0]?.token, 'x')
  })

  it('subscribe and unsubscribe work correctly', () => {
    const calls = []
    const supabase = makeSupabase()
    const adapter = createSupabaseSessionAdapter({ supabase })
    const unsub = adapter.subscribe((s) => calls.push(s))
    supabase.auth._fireChange('SIGNED_IN', { access_token: 'a', refresh_token: 'r', expires_at: 1 })
    unsub()
    supabase.auth._fireChange('SIGNED_IN', { access_token: 'b', refresh_token: 'r', expires_at: 1 })
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.token, 'a')
  })

  it('clear() sets session to null and notifies', () => {
    const supabase = makeSupabase({
      initialSession: { access_token: 'tok', refresh_token: 'ref', expires_at: 1 }
    })
    const received = []
    const adapter = createSupabaseSessionAdapter({ supabase, onSessionChange: (s) => received.push(s) })
    adapter.clear()
    assert.equal(adapter.get(), null)
    assert.equal(received[received.length - 1], null)
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
node --test packages/storefront-sdk/src/__tests__/session.test.js
```

Expected: fails with `createSupabaseSessionAdapter is not a function` or similar (not yet implemented).

- [ ] **Step 3: Rewrite `core/session.js`**

Replace the entire content of `packages/storefront-sdk/src/core/session.js` with:

```js
function _mapSupabaseSession(supabaseSession) {
  if (!supabaseSession) return null
  return {
    token: supabaseSession.access_token,
    refreshToken: supabaseSession.refresh_token,
    expiresAt: supabaseSession.expires_at,
    user: null,
  }
}

export function createSupabaseSessionAdapter({ supabase, onSessionChange = null }) {
  let _cached = null
  const _listeners = new Set()

  function _notify(session) {
    if (typeof onSessionChange === 'function') onSessionChange(session)
    for (const listener of _listeners) listener(session)
  }

  // onAuthStateChange fires INITIAL_SESSION synchronously if a session exists in storage.
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, supabaseSession) => {
    _cached = _mapSupabaseSession(supabaseSession)
    _notify(_cached)
  })

  return {
    get() { return _cached },
    setUser(user) {
      if (_cached) {
        _cached = { ..._cached, user }
        _notify(_cached)
      }
    },
    clear() {
      _cached = null
      _notify(null)
    },
    subscribe(fn) {
      _listeners.add(fn)
      return () => _listeners.delete(fn)
    },
    dispose() {
      subscription.unsubscribe()
    },
  }
}
```

- [ ] **Step 4: Run the tests — all must pass**

```bash
node --test packages/storefront-sdk/src/__tests__/session.test.js
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/storefront-sdk/src/core/session.js packages/storefront-sdk/src/__tests__/session.test.js
git commit -m "refactor(sdk): rewrite session store as Supabase session adapter"
```

---

## Task 3 — SDK: Rewrite auth namespace to use Supabase

**Files:**
- Modify: `packages/storefront-sdk/src/auth.js`
- Modify: `packages/storefront-sdk/src/__tests__/auth.test.js`

- [ ] **Step 1: Write the failing tests**

Replace the entire content of `packages/storefront-sdk/src/__tests__/auth.test.js` with:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthNamespace } from '../auth.js'
import { createSupabaseSessionAdapter } from '../core/session.js'

function makeSupabase({ signInData = null, signInError = null, signOutError = null } = {}) {
  let _session = null
  const _listeners = []

  return {
    auth: {
      signInWithPassword: async () => {
        if (signInError) return { data: {}, error: signInError }
        _session = signInData?.session ?? null
        for (const cb of _listeners) cb('SIGNED_IN', _session)
        return { data: signInData ?? {}, error: null }
      },
      signOut: async () => {
        _session = null
        for (const cb of _listeners) cb('SIGNED_OUT', null)
        return { error: signOutError ?? null }
      },
      onAuthStateChange: (cb) => {
        _listeners.push(cb)
        if (_session) cb('INITIAL_SESSION', _session)
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      refreshSession: async ({ refresh_token }) => {
        if (refresh_token === 'valid-ref') {
          const sess = { access_token: 'new-tok', refresh_token: 'new-ref', expires_at: 9999 }
          _session = sess
          for (const cb of _listeners) cb('TOKEN_REFRESHED', sess)
          return { data: { session: sess }, error: null }
        }
        return { data: {}, error: new Error('refresh failed') }
      },
    }
  }
}

function makeRequest(responses = []) {
  let i = 0
  const calls = []
  const fn = async (method, path, body) => {
    calls.push({ method, path, body })
    return responses[i++]
  }
  fn.calls = calls
  return fn
}

describe('sdk.auth.login', () => {
  it('calls Supabase signInWithPassword and fetches /me for profile', async () => {
    const supabase = makeSupabase({
      signInData: { session: { access_token: 'tok', refresh_token: 'ref', expires_at: 9999 } }
    })
    const session = createSupabaseSessionAdapter({ supabase })
    const req = makeRequest([
      { data: { id: '1', email: 'a@b.com', role: 'storefront_client', displayName: 'Ana' } }
    ])
    const auth = createAuthNamespace({ supabase, request: req, session })

    const result = await auth.login({ email: 'a@b.com', password: 'pass' })

    assert.equal(result.token, 'tok')
    assert.equal(result.user?.role, 'storefront_client')
    assert.equal(req.calls[0].path, '/public/storefront/auth/me')
    assert.equal(req.calls[0].method, 'GET')
  })

  it('throws UNAUTHORIZED when Supabase rejects credentials', async () => {
    const supabase = makeSupabase({ signInError: new Error('Invalid login') })
    const session = createSupabaseSessionAdapter({ supabase })
    const req = makeRequest([])
    const auth = createAuthNamespace({ supabase, request: req, session })

    await assert.rejects(
      () => auth.login({ email: 'bad@b.com', password: 'wrong' }),
      (err) => err.code === 'UNAUTHORIZED'
    )
    assert.equal(req.calls.length, 0)
  })

  it('returns session with null user when /me returns nothing', async () => {
    const supabase = makeSupabase({
      signInData: { session: { access_token: 'tok', refresh_token: 'ref', expires_at: 9999 } }
    })
    const session = createSupabaseSessionAdapter({ supabase })
    const req = makeRequest([null])
    const auth = createAuthNamespace({ supabase, request: req, session })

    const result = await auth.login({ email: 'a@b.com', password: 'pass' })
    assert.equal(result.token, 'tok')
    assert.equal(result.user, null)
  })
})

describe('sdk.auth.logout', () => {
  it('calls supabase.auth.signOut and clears session', async () => {
    const supabase = makeSupabase({
      signInData: { session: { access_token: 'tok', refresh_token: 'ref', expires_at: 9999 } }
    })
    const session = createSupabaseSessionAdapter({ supabase })
    const req = makeRequest([
      { data: { id: '1', role: 'storefront_client' } }
    ])
    const auth = createAuthNamespace({ supabase, request: req, session })
    await auth.login({ email: 'a@b.com', password: 'pass' })
    assert.ok(session.get() !== null)

    await auth.logout()
    assert.equal(session.get(), null)
  })
})

describe('sdk.auth.refresh', () => {
  it('refreshes token via Supabase and returns new tokens', async () => {
    const supabase = makeSupabase({
      signInData: { session: { access_token: 'tok', refresh_token: 'valid-ref', expires_at: 1 } }
    })
    const session = createSupabaseSessionAdapter({ supabase })
    const req = makeRequest([{ data: { id: '1', role: 'storefront_client' } }])
    const auth = createAuthNamespace({ supabase, request: req, session })
    await auth.login({ email: 'a@b.com', password: 'pass' })

    const result = await auth.refresh()
    assert.equal(result.token, 'new-tok')
    assert.equal(result.refreshToken, 'new-ref')
  })

  it('throws and clears session when refresh token is invalid', async () => {
    const supabase = makeSupabase({
      signInData: { session: { access_token: 'tok', refresh_token: 'bad-ref', expires_at: 1 } }
    })
    const session = createSupabaseSessionAdapter({ supabase })
    const req = makeRequest([{ data: { id: '1', role: 'storefront_client' } }])
    const auth = createAuthNamespace({ supabase, request: req, session })
    await auth.login({ email: 'a@b.com', password: 'pass' })

    await assert.rejects(() => auth.refresh(), (err) => err.code === 'UNAUTHORIZED')
    assert.equal(session.get(), null)
  })
})

describe('sdk.auth.getSession', () => {
  it('returns null when not logged in', () => {
    const supabase = makeSupabase()
    const session = createSupabaseSessionAdapter({ supabase })
    const auth = createAuthNamespace({ supabase, request: async () => {}, session })
    assert.equal(auth.getSession(), null)
  })
})

describe('sdk.auth.register', () => {
  it('calls POST /public/storefront/auth/register', async () => {
    const supabase = makeSupabase()
    const session = createSupabaseSessionAdapter({ supabase })
    const req = makeRequest([{ data: { id: '2', email: 'new@b.com', role: 'storefront_client' } }])
    const auth = createAuthNamespace({ supabase, request: req, session })

    const result = await auth.register({ email: 'new@b.com', password: 'pass', name: 'Test' })
    assert.equal(result.role, 'storefront_client')
    assert.equal(req.calls[0].method, 'POST')
    assert.equal(req.calls[0].path, '/public/storefront/auth/register')
  })
})
```

- [ ] **Step 2: Run to confirm failures**

```bash
node --test packages/storefront-sdk/src/__tests__/auth.test.js
```

Expected: fails because `auth.js` still uses the old request-based auth.

- [ ] **Step 3: Rewrite `auth.js`**

Replace the entire content of `packages/storefront-sdk/src/auth.js` with:

```js
import { StorefrontError } from './storefront-error.js'

export function createAuthNamespace({ supabase, request, session }) {
  async function register({ email, password, name, role = 'storefront_client' }) {
    const res = await request('POST', '/public/storefront/auth/register', { email, password, name, role })
    return res?.data ?? res
  }

  async function login({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session) {
      throw Object.assign(
        new StorefrontError('Credenciales incorrectas', 'UNAUTHORIZED', 401),
        { code: 'UNAUTHORIZED', status: 401 }
      )
    }
    // Fetch the user profile from the API (role, displayName, etc.)
    let user = null
    try {
      const profileRes = await request('GET', '/public/storefront/auth/me')
      user = profileRes?.data ?? null
    } catch {
      // Profile fetch is best-effort; ERP users may get 403 here.
      // The Supabase session is still valid and the session is already stored.
    }
    session.setUser(user)
    return { ...session.get(), user }
  }

  async function logout() {
    await supabase.auth.signOut()
    session.clear()
  }

  async function refresh() {
    const current = session.get()
    if (!current?.refreshToken) {
      throw new Error('No hay sesión activa para refrescar')
    }
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: current.refreshToken })
    if (error || !data.session) {
      session.clear()
      throw Object.assign(
        new StorefrontError('Token expirado, inicia sesión de nuevo', 'UNAUTHORIZED', 401),
        { code: 'UNAUTHORIZED', status: 401 }
      )
    }
    return {
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
    }
  }

  async function me() {
    const res = await request('GET', '/public/storefront/auth/me')
    return res?.data ?? null
  }

  function getSession() {
    return session.get()
  }

  function onAuthStateChange(fn) {
    return session.subscribe(fn)
  }

  return { register, login, logout, refresh, me, getSession, onAuthStateChange }
}
```

- [ ] **Step 4: Run the tests — all must pass**

```bash
node --test packages/storefront-sdk/src/__tests__/auth.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/storefront-sdk/src/auth.js packages/storefront-sdk/src/__tests__/auth.test.js
git commit -m "refactor(sdk): use Supabase auth directly for login/logout/refresh"
```

---

## Task 4 — SDK: Update index.js

**Files:**
- Modify: `packages/storefront-sdk/src/index.js`

- [ ] **Step 1: Update `createStorefrontClient` to accept supabase options and create the client**

Replace the entire content of `packages/storefront-sdk/src/index.js` with:

```js
import { createClient } from '@supabase/supabase-js'
import { StorefrontError } from './storefront-error.js'
import { createRequestCore } from './core/request.js'
import { createSupabaseSessionAdapter } from './core/session.js'
import { createAuthNamespace } from './auth.js'
import { createFilesNamespace } from './files.js'
import { createCatalogNamespace } from './catalog.js'
import { createDiscoveryNamespace } from './discovery.js'
import { createRealtimeNamespace } from './realtime.js'

export { StorefrontError }

/**
 * Create a stateful storefront SDK client backed by Supabase auth.
 *
 * The Supabase client handles session persistence in localStorage automatically.
 * No `initialSession` or `onSessionChange` needed for basic use.
 *
 * @param {object} options
 * @param {string} options.baseUrl        - Atlas ERP instance URL (e.g. 'https://erp.example.com')
 * @param {string} options.company        - Company slug. Sent as X-Atlas-Company on every request.
 * @param {string} options.supabaseUrl    - Supabase project URL (available in window.ATLAS_CONFIG.supabaseUrl)
 * @param {string} options.supabaseAnonKey - Supabase anon key (available in window.ATLAS_CONFIG.supabaseAnonKey)
 * @param {function} [options.onSessionChange] - Called with session or null on every auth state change.
 * @returns {{ auth, files, catalog, discovery, realtime, request }} Frozen SDK client
 *
 * @example
 * // In a dist served by Atlas Website:
 * const cfg = window.ATLAS_CONFIG ?? {}
 * const sdk = createStorefrontClient({
 *   baseUrl:         cfg.apiUrl         ?? import.meta.env.VITE_ERP_URL,
 *   company:         cfg.company         ?? import.meta.env.VITE_ERP_COMPANY,
 *   supabaseUrl:     cfg.supabaseUrl     ?? import.meta.env.VITE_SUPABASE_URL,
 *   supabaseAnonKey: cfg.supabaseAnonKey ?? import.meta.env.VITE_SUPABASE_ANON_KEY,
 * })
 */
export function createStorefrontClient({ baseUrl, company, supabaseUrl, supabaseAnonKey, onSessionChange }) {
  if (!baseUrl)         throw new Error('createStorefrontClient: baseUrl es requerido')
  if (!company)         throw new Error('createStorefrontClient: company es requerido')
  if (!supabaseUrl)     throw new Error('createStorefrontClient: supabaseUrl es requerido')
  if (!supabaseAnonKey) throw new Error('createStorefrontClient: supabaseAnonKey es requerido')

  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  const session = createSupabaseSessionAdapter({ supabase, onSessionChange })

  const _request = createRequestCore({
    baseUrl,
    company,
    getSession: () => session.get(),
  })

  async function _requestWithRefresh(method, path, body = null, options = {}) {
    try {
      return await _request(method, path, body, options)
    } catch (err) {
      const current = session.get()
      if (
        err?.code === 'UNAUTHORIZED' &&
        current?.refreshToken &&
        !options._retry
      ) {
        try {
          const { data, error } = await supabase.auth.refreshSession({
            refresh_token: current.refreshToken,
          })
          if (error || !data.session) {
            session.clear()
            throw err
          }
          return await _request(method, path, body, { ...options, _retry: true })
        } catch {
          session.clear()
          throw err
        }
      }
      throw err
    }
  }

  const auth      = createAuthNamespace({ supabase, request: _requestWithRefresh, session })
  const files     = createFilesNamespace({ request: _requestWithRefresh })
  const catalog   = createCatalogNamespace({ request: _requestWithRefresh })
  const discovery = createDiscoveryNamespace({ request: _requestWithRefresh })
  const realtime  = createRealtimeNamespace({ request: _requestWithRefresh })

  async function request(method, path, body = null, options = {}) {
    return _requestWithRefresh(method, path, body, options)
  }

  return Object.freeze({ auth, files, catalog, discovery, realtime, request })
}
```

- [ ] **Step 2: Run the existing react-exports test to check nothing is broken**

```bash
node --test packages/storefront-sdk/src/__tests__/react-exports.test.js
```

Expected: passes (this test only checks that React exports exist, not auth internals).

- [ ] **Step 3: Run all SDK tests**

```bash
node --test packages/storefront-sdk/src/__tests__/
```

Expected: all tests pass. If `request.test.js` or `catalog.test.js` fail because they still import from old session, fix any import paths now.

- [ ] **Step 4: Commit**

```bash
git add packages/storefront-sdk/src/index.js
git commit -m "feat(sdk): createStorefrontClient now requires supabaseUrl + supabaseAnonKey; uses Supabase for auth"
```

---

## Task 5 — SDK: Bump version, update README and ai-context doc

**Files:**
- Modify: `packages/storefront-sdk/package.json`
- Modify: `packages/storefront-sdk/README.md`
- Modify: `docs/ai-context/atlas-storefront-sdk.md`

- [ ] **Step 1: Bump version to 0.2.0**

In `packages/storefront-sdk/package.json`, change:
```json
"version": "0.1.2",
```
to:
```json
"version": "0.2.0",
```

- [ ] **Step 2: Update the Quick Start sections in README.md**

Open `packages/storefront-sdk/README.md`. Replace section **1. Quick Start — Plain JS** with:

```markdown
## 1. Quick Start — Plain JS

```js
import { createStorefrontClient } from '@raulbellosom/atlas-sdk'

// Read from window.ATLAS_CONFIG (injected by Atlas Website) or env vars for local dev.
const cfg = (typeof window !== 'undefined' && window.ATLAS_CONFIG) ? window.ATLAS_CONFIG : {}

const sdk = createStorefrontClient({
  baseUrl:         cfg.apiUrl         ?? 'https://erp.tudominio.mx',
  company:         cfg.company         ?? 'tu-empresa',
  supabaseUrl:     cfg.supabaseUrl     ?? 'https://supabase.tudominio.mx',
  supabaseAnonKey: cfg.supabaseAnonKey ?? '<anon-key>',
})

// Log in — Supabase stores the session in localStorage automatically.
// The same session is shared with Atlas ERP.
const { user, token } = await sdk.auth.login({
  email: 'cliente@ejemplo.mx',
  password: 'contraseña123',
})
console.log('Bienvenido,', user?.displayName ?? 'usuario')

// Redirect ERP users to the ERP app
if (user && !['storefront_client', 'storefront_vendor'].includes(user.role)) {
  window.location.href = 'https://erp.tudominio.mx'
}
```
```

Replace section **2. Quick Start — React + Vite** `src/main.jsx` example:

```markdown
### `src/main.jsx`

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createStorefrontClient } from '@raulbellosom/atlas-sdk'
import { StorefrontProvider } from '@raulbellosom/atlas-sdk/react'
import App from './App.jsx'

// In production (dist served by Atlas Website), window.ATLAS_CONFIG is injected automatically.
// Locally, use .env variables.
const cfg = (typeof window !== 'undefined' && window.ATLAS_CONFIG) ? window.ATLAS_CONFIG : {}

const sdk = createStorefrontClient({
  baseUrl:         cfg.apiUrl         ?? import.meta.env.VITE_ERP_URL,
  company:         cfg.company         ?? import.meta.env.VITE_ERP_COMPANY,
  supabaseUrl:     cfg.supabaseUrl     ?? import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: cfg.supabaseAnonKey ?? import.meta.env.VITE_SUPABASE_ANON_KEY,
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <StorefrontProvider client={sdk}>
      <App />
    </StorefrontProvider>
  </React.StrictMode>
)
```
```

In section **3. Configuration reference**, replace the options table with:

```markdown
| Option | Type | Required | Description | Example |
|---|---|---|---|---|
| `baseUrl` | `string` | Yes | Full URL of the ERP instance | `'https://erp.tudominio.mx'` |
| `company` | `string` | Yes | Company slug. Sent as `X-Atlas-Company` on every request | `'tu-empresa'` |
| `supabaseUrl` | `string` | Yes | Supabase project URL. Available in `window.ATLAS_CONFIG.supabaseUrl` for Atlas Website dists | `'https://supabase.tudominio.mx'` |
| `supabaseAnonKey` | `string` | Yes | Supabase anon key. Available in `window.ATLAS_CONFIG.supabaseAnonKey` | `'eyJ...'` |
| `onSessionChange` | `function(session \| null)` | No | Called on every auth state change. Useful for debugging; session is persisted by Supabase automatically | `(s) => console.log('session:', s)` |
```

In section **14. Environment variables for Vite projects**, update Pattern B:

```markdown
### Pattern B — deployed as Atlas Website dist (runtime config)

When deployed to Atlas Website, `window.ATLAS_CONFIG` is injected with all required values:

```js
// src/sdk.js
import { createStorefrontClient } from '@raulbellosom/atlas-sdk'

const cfg = (typeof window !== 'undefined' && window.ATLAS_CONFIG) ? window.ATLAS_CONFIG : {}

export const sdk = createStorefrontClient({
  baseUrl:         cfg.apiUrl         ?? import.meta.env.VITE_ERP_URL         ?? '',
  company:         cfg.company         ?? import.meta.env.VITE_ERP_COMPANY     ?? '',
  supabaseUrl:     cfg.supabaseUrl     ?? import.meta.env.VITE_SUPABASE_URL    ?? '',
  supabaseAnonKey: cfg.supabaseAnonKey ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
})
```

For local dev, add to `.env`:
```
VITE_ERP_URL=http://localhost:4010
VITE_ERP_COMPANY=tu-empresa
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<local-anon-key>
```
```

At the end of section **16. Deploying to Atlas Website**, replace the note about `window.AtlasERP` with:

```markdown
### Shared session with Atlas ERP

Because the SDK now uses `@supabase/supabase-js` directly, the session is stored in the same
`localStorage` key used by Atlas ERP (`sb-<project>-auth-token`). This means:

- An ERP user (admin, employee) who logs in on the storefront site is automatically recognized
  by the injected `atlas-sdk.js` beacon and sees the "Go to Atlas ERP" badge.
- A storefront user (client, vendor) who navigates to Atlas ERP is shown the login screen
  (they have no ERP permissions).
- `window.AtlasERP` (the beacon) and `sdk.auth` share the same session — they are the same user.

**Redirect ERP users after login:**

```js
const { user } = await sdk.auth.login({ email, password })
const isStorefrontRole = ['storefront_client', 'storefront_vendor'].includes(user?.role)
if (!isStorefrontRole && user) {
  window.location.href = window.ATLAS_CONFIG?.apiUrl ?? '/'
}
```
```

- [ ] **Step 3: Update `docs/ai-context/atlas-storefront-sdk.md`**

Open `docs/ai-context/atlas-storefront-sdk.md`. Replace the **Overview** section with:

```markdown
## Overview

Atlas ERP exposes a thin browser SDK (`/atlas-sdk.js`) so any external website can detect Atlas
ERP sessions and show the ERP navigation badge. For building full storefront frontends, use the
npm package `@raulbellosom/atlas-sdk` (`packages/storefront-sdk/`).

**Both systems now use the same Supabase session** stored in `sb-<project>-auth-token` in
localStorage. A user who logs in via the npm SDK is automatically recognized by the injected
`atlas-sdk.js` beacon, and vice-versa.

The npm package exposes:
- `createStorefrontClient({ baseUrl, company, supabaseUrl, supabaseAnonKey })` — main factory
- `sdk.auth` — login, register, logout, refresh, me, getSession, onAuthStateChange (Supabase-backed)
- `sdk.files`, `sdk.catalog`, `sdk.discovery`, `sdk.realtime`, `sdk.request`
- `@raulbellosom/atlas-sdk/react` — React hooks: `StorefrontProvider`, `useAuth`, `useSession`, `useFileUpload`, `useProducts`, `useCompanyConfig`, etc.
```

Also add after the `window.ATLAS_CONFIG` section a new section called **Unified session**:

```markdown
## Unified session

The npm SDK uses `@supabase/supabase-js` internally. After login, the session is stored in
the same `sb-<project>-auth-token` localStorage key as Atlas ERP. This means:

1. A storefront user who logs in via the npm SDK is automatically seen by the `atlas-sdk.js`
   beacon script — the `erp-badge-check` endpoint is called and the ERP badge appears if the
   user has `platform.erp.access`.
2. An ERP user (admin, employee) can log in on the storefront site and be redirected to Atlas ERP
   without a second login.

The `window.AtlasERP` object (from the IIFE `atlas-sdk.js`) and `sdk.auth` (from the npm package)
share the same session. They are NOT separate auth systems.
```

Replace the final note in **Usage patterns** that said "sessions do not overlap" with:
```markdown
> Sessions are unified. `window.AtlasERP.auth.getSession()` and `sdk.auth.getSession()` return
> the same underlying Supabase session. Role determines what the user can access, not which auth system they used.
```

- [ ] **Step 4: Commit**

```bash
git add packages/storefront-sdk/package.json packages/storefront-sdk/README.md docs/ai-context/atlas-storefront-sdk.md
git commit -m "docs(sdk): update README and ai-context for unified Supabase auth (v0.2.0)"
```

- [ ] **Step 5: Publish to npm**

```bash
cd packages/storefront-sdk
npm publish
```

Expected: publishes `@raulbellosom/atlas-sdk@0.2.0`.

- [ ] **Step 6: Final smoke test**

With `pnpm dev:api` running:

```bash
# 1. Verify the API tests still pass
node --test apps/api/src/services/__tests__/storefront-auth-service.test.js

# 2. Verify all SDK tests pass
node --test packages/storefront-sdk/src/__tests__/
```

Expected: all tests pass.

- [ ] **Step 7: Final commit if anything is uncommitted**

```bash
git status
```

If clean, done. If not, stage and commit the remaining files.

---

## Self-Review

**Spec coverage:**
- ✅ One login: SDK uses Supabase auth — same session key as Atlas ERP
- ✅ Role detection: `user.role` from `/me` determines storefront vs ERP user
- ✅ ERP badge for ERP users: `erp-badge-check` reads from same localStorage key (Task 1 enables this)
- ✅ Navigate to ERP without re-login: session is shared (Tasks 2–4)
- ✅ `/me` accessible to ERP users: `anyAuthMiddleware` (Task 1)
- ✅ `register` still works: hits `/public/storefront/auth/register` (untouched)
- ✅ No breaking change on API side (kept `/login`, `/refresh`, `/logout` endpoints intact)
- ✅ Breaking change on SDK: documented as v0.2.0

**Placeholder scan:** None found — all steps include exact code.

**Type consistency:** `session.get()` returns `{ token, refreshToken, expiresAt, user }` in all tasks. `request.js` reads `session.token` which maps correctly to `access_token` from Supabase via `_mapSupabaseSession`.
