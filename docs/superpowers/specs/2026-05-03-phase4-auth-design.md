# Phase 4 — Auth Integration Design

## Goal

Replace the `LoginPlaceholder` with a fully functional, company-branded login screen backed by Supabase Auth. Add session persistence, logout, a protected `/app` route, and a single protected API endpoint (`GET /user/me`).

## Architecture

```
[Supabase Auth SDK]   apps/desktop/src/lib/supabase.js
       ↓
[AuthProvider]        apps/desktop/src/auth/AuthProvider.jsx
       ↓              React Context: { session, userProfile, loading, logout }
[AuthGuard]           apps/desktop/src/auth/AuthGuard.jsx
       ↓              Reads useAuth(), redirects to /login if no session
[Dashboard /app]      Existing — now protected
```

Request flow for a protected API call (future modules):
```
React → supabase.auth.getSession() → token
      → Atlas SDK request({ headers: { Authorization: 'Bearer <token>' } })
      → Hono route → authMiddleware → supabaseAdmin.auth.getUser(token) → req.user
```

## Files

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/api/src/index.js` | Modify | Extend `/instance/status`, add `GET /user/me`, add `authMiddleware` |
| `apps/desktop/src/lib/supabase.js` | Create | Supabase browser client singleton (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) |
| `apps/desktop/src/auth/AuthProvider.jsx` | Create | Context + session restore + `onAuthStateChange` listener |
| `apps/desktop/src/auth/AuthGuard.jsx` | Create | Route guard — no session → redirect `/login` |
| `apps/desktop/src/auth/LoginScreen.jsx` | Create | Branded login form |
| `apps/desktop/src/main.jsx` | Modify | Wire `AuthProvider`, replace `LoginPlaceholder` with `LoginScreen`, wrap `/app` in `AuthGuard` |
| `apps/desktop/package.json` | Modify | Add `@supabase/supabase-js` |

## API Changes

### `GET /instance/status` — extended response

```json
{
  "initialized": true,
  "branding": {
    "primaryColor": "#6366f1",
    "logoUrl": "https://..."
  }
}
```

- `branding` is `null` when `initialized` is `false`
- `logoUrl` is a signed URL (`supabaseAdmin.storage.createSignedUrl(objectKey, 3600)`) — `null` if no logo was uploaded
- `primaryColor` comes from `BrandingConfig.primaryColor` via `instanceConfig company_id` lookup

### `GET /user/me` — new, protected

Reads `Authorization: Bearer <token>` header. Calls `supabaseAdmin.auth.getUser(token)` to verify. Returns:

```json
{
  "id": "uuid",
  "firstName": "Raul",
  "lastName": "Belloso",
  "displayName": "Raul Belloso",
  "email": "raul@example.com",
  "role": "atlas.admin"
}
```

Errors:
- `401` — missing or invalid token
- `404` — no `UserProfile` found for this auth user (should not happen post-setup)

### `authMiddleware` — Hono middleware (selective)

```js
async function authMiddleware(c, next) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user) return c.json({ error: 'Unauthorized' }, 401)
  c.set('authUserId', data.user.id)
  await next()
}
```

Applied only to `GET /user/me` in Phase 4. All other existing routes remain public.

## Frontend: Supabase Client

`apps/desktop/src/lib/supabase.js`:

```js
import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
export const supabase = createClient(url, anonKey)
```

Requires these env vars in `apps/desktop/.env` (or root `.env` picked up by Vite):
- `VITE_SUPABASE_URL` — same value as `SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` — same value as `SUPABASE_ANON_KEY`

## Frontend: AuthProvider

`apps/desktop/src/auth/AuthProvider.jsx`:

- On mount: calls `supabase.auth.getSession()` to restore session from localStorage
- Subscribes to `supabase.auth.onAuthStateChange((event, session) => ...)`:
  - `SIGNED_IN`: fetches `atlas.auth.me()` (SDK method that calls `GET /user/me` with bearer token) → sets `userProfile`
  - `SIGNED_OUT`: clears `session` and `userProfile`
  - `TOKEN_REFRESHED`: updates `session`
- Exposes via `useAuth()`:
  - `session` — Supabase session object (null if not logged in)
  - `userProfile` — `{ id, firstName, lastName, displayName, email, role }` (null if not logged in)
  - `loading` — true until initial `getSession()` resolves
  - `logout()` — calls `supabase.auth.signOut()`

## Frontend: AuthGuard

`apps/desktop/src/auth/AuthGuard.jsx`:

- Reads `{ loading, session }` from `useAuth()`
- While `loading === true`: renders centered spinner (same CSS as `InitGuard`)
- If `session === null`: `<Navigate to="/login" replace />`
- Otherwise: `<Outlet />`

## Frontend: LoginScreen

`apps/desktop/src/auth/LoginScreen.jsx`:

### Layout

Two-panel layout on desktop (≥1024px), single-panel on mobile — mirrors the setup wizard visual language.

**Left panel (desktop only):**
- Dark background (`hsl(var(--foreground) / 0.97)`)
- Company logo centered (if `branding.logoUrl` is available), else Atlas ERP wordmark
- Primary color applied as CSS custom property: `document.documentElement.style.setProperty('--brand-primary', branding.primaryColor)`
- Subtle tagline: "Tu ERP. Tu empresa."

**Right panel / full screen (mobile):**
- Surface/white background
- Atlas ERP label (small, uppercase, muted) above the heading
- Heading: "Iniciar sesión"
- Email field (`TextField`, `type="email"`, `autocomplete="username"`)
- Password field (`PasswordField` without strength meter, show/hide toggle, `autocomplete="current-password"`)
- "Iniciar sesión" primary button — disabled + spinner during request
- Error message below the form (not field-level, for security): "Correo o contraseña incorrectos"
- "¿Olvidaste tu contraseña?" link — placeholder, `href="#"`, no flow in Phase 4

### Branding loading

On mount, reads `useLocation().state?.branding`. If state is absent (direct navigation), re-fetches `atlas.instance.status()` to obtain branding. Shows a loading skeleton in the left panel while fetching.

### Auth flow

1. User submits form
2. Call `supabase.auth.signInWithPassword({ email, password })`
3. On success: `onAuthStateChange` in `AuthProvider` fires → `session` set → `AuthGuard` allows through → `navigate('/app', { replace: true })`
4. On error: show generic error message, re-enable button

### Accessibility

- `<form>` with `onSubmit`
- Email and password inputs have visible `<label>` elements
- Error message has `role="alert"` so screen readers announce it
- Button shows `aria-busy="true"` during loading

## SDK Changes

Add `auth.me()` to `packages/sdk/src/index.js`:

```js
auth: {
  me: (token) => request('/user/me', { headers: { Authorization: `Bearer ${token}` } })
}
```

`AuthProvider` calls this after `SIGNED_IN` with `session.access_token`.

## Session Persistence

Supabase SDK persists the session in `localStorage` automatically. On app restart:
1. `AuthProvider` calls `getSession()` → finds stored token
2. If token is valid (not expired): user is logged in without interaction
3. If token is expired but refresh token is valid: Supabase refreshes automatically
4. If both expired: user is redirected to `/login`

No "remember me" checkbox — desktop ERP always persists.

## Logout

- A logout button is added to the Dashboard header (top-right area)
- Calls `logout()` from `useAuth()`
- `supabase.auth.signOut()` → clears localStorage → `onAuthStateChange` fires `SIGNED_OUT` → `AuthGuard` redirects to `/login`

## Password Recovery (placeholder)

The "¿Olvidaste tu contraseña?" link renders as `<button type="button">` that shows a toast: "Recuperación de contraseña disponible próximamente." No email flow is implemented in Phase 4.

## Environment Variables

The following `VITE_` vars must be present in `apps/desktop` (Vite only exposes `VITE_` prefix to the browser). Add to root `.env` and `.env.example`:

```env
VITE_SUPABASE_URL=https://supabase.example.com
VITE_SUPABASE_ANON_KEY=<same as SUPABASE_ANON_KEY>
```

## Error States

| Scenario | Behavior |
|----------|----------|
| Wrong credentials | Generic message: "Correo o contraseña incorrectos" |
| Network error | "No se pudo conectar con el servidor. Intenta de nuevo." |
| User not confirmed | "Tu cuenta no ha sido confirmada. Contacta al administrador." |
| API `/user/me` 404 | Log to console, treat as logged-out, redirect to `/login` |
| Token expired mid-session | Supabase refreshes automatically; if refresh fails, redirect to `/login` |

## Out of Scope for Phase 4

- Password recovery email flow (Supabase `resetPasswordForEmail`)
- Multi-tenant company switching
- Role-based UI hiding (comes with Phase 5 module registry)
- API route protection beyond `GET /user/me`
- Two-factor authentication
