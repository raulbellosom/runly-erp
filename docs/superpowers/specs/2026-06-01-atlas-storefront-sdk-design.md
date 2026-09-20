# Atlas Storefront SDK — Design Spec

**Date:** 2026-06-01
**Status:** Approved
**Scope:** Sub-project A — SDK core + storefront auth layer

---

## 1. Context and Purpose

The AtlasERP v2 admin SDK (`packages/sdk`) is a complete API client for the ERP but is 100% admin-facing — it requires an admin JWT on every call. There is no SDK for external developers building customer-facing applications on top of the ERP.

The **Atlas Storefront SDK** (`packages/storefront-sdk`) fills this gap. It is a generic JavaScript client published to npm as `@raulbellosom/atlas-sdk` that allows any external app — React, Astro, Vue, plain HTML, or any framework — to consume the ERP's public-facing API. The SDK handles authentication of end-users (customers, vendors, or any role), file uploads to public storage, catalog discovery, real-time subscriptions, and provides a generic escape hatch for any module-specific API call.

Musicfy (a musician booking marketplace) was used as a reference use case during design to validate that the SDK is expressive enough for complex multi-role platforms. The SDK itself contains no Musicfy-specific logic.

---

## 2. Package Location and Distribution

| Property | Value |
|---|---|
| Location | `packages/storefront-sdk/` in the AtlasERP v2 monorepo |
| npm package | `@raulbellosom/atlas-sdk` |
| Entry point | `packages/storefront-sdk/src/index.js` |
| Exports | `createStorefrontClient` (named export) |
| Dependencies | `@supabase/supabase-js` (for real-time) |
| Dev dependencies | none beyond monorepo root |
| Target environments | Browser (CSR), SSR (Next.js, Astro, Nuxt), Node.js |

The package is co-located with the ERP API to keep the SDK in sync with endpoint changes. It is published to npm independently so external projects can install it without pulling the entire monorepo.

---

## 3. Initialization

```js
import { createStorefrontClient } from '@raulbellosom/atlas-sdk'

const sdk = createStorefrontClient({
  baseUrl: 'https://erp.example.com',   // required — ERP instance URL
  company: 'musicfy',                  // required — company slug in the ERP
  onSessionChange: (session) => {      // optional — fires on login/logout
    if (session) {
      localStorage.setItem('sf_session', JSON.stringify(session))
    } else {
      localStorage.removeItem('sf_session')
    }
  },
  initialSession: (() => {             // optional — restores persisted session
    try { return JSON.parse(localStorage.getItem('sf_session')) }
    catch { return null }
  })(),
})
```

### Design decisions

- **Stateful instance (not singleton):** The SDK manages auth state internally per instance. Multiple instances can coexist (useful in SSR where each request gets its own instance). There is no global state.
- **SSR compatibility:** `onSessionChange` and `initialSession` decouple session persistence from the SDK. The SDK never touches `localStorage` or `document` directly.
- **`company` slug:** Every public request includes `X-Atlas-Company: <slug>` so a single ERP instance can serve multiple storefronts. After login, the company is also derived from the JWT.
- **No framework dependencies:** The SDK is plain JavaScript. React hooks, Vue composables, etc. are left to the developer or a future companion package.

---

## 4. Auth Domain (`sdk.auth`)

Storefront users (end-users of the external app) authenticate through dedicated public endpoints that wrap Supabase Auth internally. The SDK never exposes Supabase credentials to the developer.

```js
// Register a new storefront user
await sdk.auth.register({
  email: 'user@example.com',
  password: 'secret123',
  name: 'Display Name',
  role: 'storefront_client',  // any role key pre-created in the ERP and listed in storefront.registrable_roles
})

// Login — stores session internally, fires onSessionChange
const { user, token } = await sdk.auth.login({
  email: 'user@example.com',
  password: 'secret123',
})

// Current session (null if not authenticated)
const session = sdk.auth.getSession()
// → { user: { id, email, name, role }, token: 'jwt...' } | null

// Authenticated user's profile
const me = await sdk.auth.me()

// Refresh token (called automatically before expiry)
await sdk.auth.refresh()

// Logout — clears internal session, fires onSessionChange(null)
await sdk.auth.logout()

// Subscribe to session changes
const unsub = sdk.auth.onAuthStateChange((session) => {
  // session = { user, token } | null
})
unsub() // call to unsubscribe
```

### Role system

Storefront roles (`storefront_client`, `storefront_vendor`, or any custom key) are RBAC roles pre-created in the ERP by the platform admin. The SDK passes the role key at registration; the ERP validates that it exists in the `storefront.registrable_roles` instance config before creating the user. This prevents external users from self-registering as `admin`, `owner`, or any internal role.

### Session storage

The JWT is stored in memory inside the SDK instance. Persistence (localStorage, cookies, httpOnly cookies) is the developer's responsibility via `onSessionChange` / `initialSession`. This pattern supports any persistence strategy without the SDK taking an opinion.

---

## 5. File Upload Domain (`sdk.files`)

Two Supabase Storage buckets are used:

| Bucket | Access | Purpose |
|---|---|---|
| `atlas-storefront` | **Public** | Profile photos, cover images, audio previews, public media |
| `atlas-files` | Private | Internal documents, signed uploads |

The SDK upload endpoint selects the bucket based on `visibility`.

```js
// Upload a file
const asset = await sdk.files.upload(file, {
  visibility: 'PUBLIC',         // 'PUBLIC' (default) | 'PRIVATE'
  entityType: 'vendor_profile', // optional — for grouping/querying
  entityId: 'uuid-...',         // optional
})
// → { id, url, originalName, mimeType, sizeBytes }

// Permanent public URL (PUBLIC files only)
const url = await sdk.files.getUrl(assetId)

// Signed temporary URL (PRIVATE files, expires in 1h by default)
const { signedUrl, expiresAt } = await sdk.files.getSignedUrl(assetId, {
  expiresIn: 3600,
})

// Delete (only the uploader can delete their own files)
await sdk.files.delete(assetId)
```

### File type and size limits by role

| Role | Allowed types | Max size |
|---|---|---|
| `client` | image/* | 5 MB |
| `vendor` | image/*, audio/*, video/* | 100 MB |
| Platform admin | all | configurable |

These limits are enforced server-side. The SDK passes the storefront JWT; the ERP derives the role and applies limits.

---

## 6. Catalog Domain (`sdk.catalog`)

Read-only public access to the ERP's catalog module. No auth required.

```js
// List products
const { data, total, page } = await sdk.catalog.products({
  q: 'search term',
  categorySlug: 'slug',
  limit: 20,
  page: 1,
})

// Single product with variants and options
const product = await sdk.catalog.getProduct(id)

// Categories tree
const categories = await sdk.catalog.categories()
```

If `atlas.catalog` is not installed in the tenant, these methods throw `StorefrontError` with `code: 'MODULE_NOT_AVAILABLE'`.

---

## 7. Discovery Domain (`sdk.discovery`)

Provides runtime introspection of what the tenant has installed. Enables external apps to conditionally render features based on available modules.

```js
// All blueprints (entities + views) for enabled modules
const blueprints = await sdk.discovery.blueprints()
// → [{ key, kind, schema, module: { key, name } }, ...]

// Check if a specific module is installed
const hasBookings = await sdk.discovery.hasModule('custom.reservations')
```

This is the mechanism that makes the SDK forward-compatible: if the tenant installs a new module tomorrow, the external app discovers it at runtime without an SDK update.

---

## 8. Generic Request (`sdk.request`)

The primary escape hatch. Covers all module-specific API calls that don't yet have a dedicated SDK namespace.

```js
// Authenticated GET
const bookings = await sdk.request('GET', '/public/storefront/bookings')

// Authenticated POST with body
const booking = await sdk.request('POST', '/public/storefront/bookings', {
  vendorId: 'uuid',
  date: '2026-07-15',
  hours: 3,
})

// Public GET (no auth token sent)
const config = await sdk.request('GET', '/public/storefront/config', null, {
  auth: false,
})
```

`sdk.request()` automatically:
- Injects `Authorization: Bearer <token>` when a session exists
- Injects `X-Atlas-Company: <slug>` on every request
- Throws `StorefrontError` on non-2xx responses

Every future module (reservations, reviews, payments) is immediately accessible via `sdk.request()` before gaining a dedicated SDK namespace.

---

## 9. Real-time (`sdk.realtime`)

```js
// Subscribe to an event
sdk.realtime.on('booking.created', (payload) => {
  console.log('New booking:', payload)
})

sdk.realtime.on('booking.status_changed', (payload) => {
  updateUI(payload.id, payload.status)
})

// Unsubscribe a specific handler
sdk.realtime.off('booking.status_changed', handler)

// Tear down all subscriptions (call on app unmount)
sdk.realtime.dispose()
```

### Internal implementation

1. On first `sdk.realtime.on()` call, the SDK fetches `GET /public/storefront/realtime-config`.
2. The ERP returns `{ supabaseUrl, supabaseAnonKey, companyId }` — anon key only, never the service role key.
3. The SDK creates a `@supabase/supabase-js` client internally with those credentials.
4. It opens a Postgres Changes channel scoped to `company_id=eq.<companyId>` on the relevant table.
5. Incoming changes are mapped to event names and dispatched to registered handlers.

Event names are namespaced by module (`booking.created`, `review.submitted`, etc.). Each ERP module declares the events it emits in its manifest's `exposes` field. The SDK does not hard-code event names — the developer uses whatever event keys the installed modules declare.

---

## 10. Error Handling

All SDK methods throw `StorefrontError` on failure:

```js
try {
  await sdk.auth.login({ email, password })
} catch (err) {
  if (err instanceof StorefrontError) {
    console.log(err.message)   // human-readable message
    console.log(err.code)      // machine-readable code (see below)
    console.log(err.status)    // HTTP status (401, 404, 422, 500…)
  }
}
```

| Code | Meaning |
|---|---|
| `UNAUTHORIZED` | No session or token expired |
| `FORBIDDEN` | Authenticated but insufficient permissions |
| `NOT_FOUND` | Resource does not exist |
| `VALIDATION_ERROR` | Request body failed validation (details in `err.details`) |
| `MODULE_NOT_AVAILABLE` | Requested module not installed in tenant |
| `NETWORK_ERROR` | Could not reach the ERP |
| `UNKNOWN` | Unexpected server error |

`StorefrontError` is exported from the package so developers can do `instanceof` checks.

---

## 11. New Backend Endpoints Required

All new endpoints live under `/public/storefront/` and require no admin auth — they use the storefront JWT instead.

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/public/storefront/auth/register` | Create storefront user with role |
| POST | `/public/storefront/auth/login` | Authenticate, return JWT |
| POST | `/public/storefront/auth/refresh` | Refresh expired JWT |
| GET | `/public/storefront/auth/me` | Return authenticated user profile |
| POST | `/public/storefront/auth/logout` | Invalidate session |

### Files
| Method | Path | Description |
|---|---|---|
| POST | `/public/storefront/files/upload` | Upload to atlas-storefront or atlas-files bucket |
| GET | `/public/storefront/files/:id/url` | Return public URL or signed URL |
| DELETE | `/public/storefront/files/:id` | Delete if caller is owner |

### Configuration
| Method | Path | Description |
|---|---|---|
| GET | `/public/storefront/realtime-config` | Return Supabase anon credentials for real-time |
| GET | `/public/storefront/config` | Return tenant branding and feature flags |

---

## 12. Infrastructure Changes

- **New Supabase bucket:** `atlas-storefront` — set to public, RLS policies allow read by anyone, write only via ERP API (not direct Supabase upload).
- **New RBAC roles (seeded):** `storefront_client` and `storefront_vendor` as the default storefront roles. The platform admin can rename these or add custom roles. A new `InstanceConfig` key `storefront.registrable_roles` controls which roles external users can self-register with.
- **Middleware:** A new `storefrontAuthMiddleware` validates storefront JWTs (same Supabase JWT but resolved against the storefront user's membership). Separate from the existing `authMiddleware` used for admin routes.

---

## 13. Hosted Build Support

When a developer uploads their compiled app (`dist/`) to the ERP:

1. Developer builds their app: `npm run build` → `dist/`
2. The compiled bundle already includes `@raulbellosom/atlas-sdk` — no server-side injection needed.
3. Developer uploads `dist/` via the ERP panel (feature to be specced separately).
4. The ERP serves `dist/index.html` at the tenant's root path.
5. The browser loads the app; the SDK connects to the ERP API at the configured `baseUrl`.

The SDK works identically whether the app is hosted on the ERP or on an external domain (Vercel, Netlify, etc.). CORS is configured on the ERP to allow both the ERP's own domain and any domain the tenant registers as an allowed origin.

---

## 14. Out of Scope (this spec)

The following are explicitly deferred to separate specs:

- Module-specific namespaces: `sdk.bookings`, `sdk.reviews`, `sdk.payments` (depend on those modules existing)
- React hooks companion package (`@raulbellosom/atlas-sdk/react`)
- Hosted build upload feature (ERP panel for uploading compiled apps)
- Platform owner dashboard (commissions, approval workflows)
- Payment processing integration
- Push notification support via `sdk.realtime`

---

## 15. Implementation Order

1. `packages/storefront-sdk/` scaffold — package.json, src/index.js, StorefrontError class
2. `createStorefrontClient` with request core + session management
3. `sdk.auth` namespace + 5 backend auth endpoints
4. `sdk.files` namespace + 3 backend file endpoints + `atlas-storefront` bucket
5. `sdk.catalog` namespace (wraps existing `/public/catalog/` routes)
6. `sdk.discovery` namespace (wraps existing `/public/blueprints`)
7. `sdk.realtime` namespace + `/public/storefront/realtime-config` endpoint
8. `sdk.request` generic method
9. `StorefrontError` standardization across all methods
10. npm publish setup (package.json `exports`, build script)
