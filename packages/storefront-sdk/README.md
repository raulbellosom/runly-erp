# @raulbellosom/runly-sdk

Generic JavaScript client for Runly ERP storefront APIs. Works in any browser environment, React app, or Vite project. Handles authentication, session persistence, file uploads, product catalog, module discovery, real-time events, and guest live chat.

Migration status: `@raulbellosom/runly-sdk` is now published on npm (first published 2026-09-21, starting at the version `@raulbellosom/atlas-sdk` left off). Existing consumers of `@raulbellosom/atlas-sdk` can keep their dependency — HTTP headers and session/storage contracts are unchanged, and `atlas-sdk` is not deprecated — but new integrations should install `runly-sdk`.

```bash
# npm
npm install @raulbellosom/runly-sdk

# pnpm
pnpm add @raulbellosom/runly-sdk
```

---

## Table of contents

1. [Quick Start — Plain JS](#1-quick-start--plain-js)
2. [Quick Start — React + Vite](#2-quick-start--react--vite)
3. [Configuration reference](#3-configuration-reference)
4. [sdk.auth](#4-sdkauth)
5. [sdk.files](#5-sdkfiles)
6. [sdk.catalog](#6-sdkcatalog)
7. [sdk.discovery](#7-sdkdiscovery) — `blueprints`, `modules`, `hasModule`, `introspect`
8. [sdk.realtime](#8-sdkrealtime)
9. [sdk.request — generic escape hatch](#9-sdkrequest--generic-escape-hatch)
10. [StorefrontError — complete error reference](#10-storefront-error--complete-error-reference)
11. [React Hooks — complete reference](#11-react-hooks--complete-reference)
12. [Auth patterns](#12-auth-patterns)
13. [Common patterns for module-specific data](#13-common-patterns-for-module-specific-data)
14. [Environment variables for Vite projects](#14-environment-variables-for-vite-projects)
15. [Roles system](#15-roles-system)
16. [Deploying to Runly Website (source\_type=dist)](#16-deploying-to-runly-website-source_typedist)
17. [sdk.guestChat — guest live chat](#17-sdkguestchat--guest-live-chat)

---

## Glossary

**Company slug** — a short identifier string (e.g. `"acme"`) that tells the API which tenant you are operating on. The platform admin provides this value. Every request sends it as the `X-Runly-Company` header automatically.

**Blueprint** — a JSON schema object that describes a data entity installed in the ERP (its fields, relations, and display metadata). Blueprints are how you discover which modules and data types are available on a given ERP instance.

**Storefront role** — a role scoped to public-facing access. The two built-in roles are `storefront_client` (end customer, 5 MB file limit, images only) and `storefront_vendor` (seller/partner, 100 MB file limit, all file types). The set of registrable roles is configured by the platform admin.

**Session** — an object with shape `{ user, token, refreshToken, expiresAt }` held in memory by the SDK. Session persistence to `localStorage` is handled automatically by `@supabase/supabase-js` — no `initialSession` or manual `localStorage` code needed.

---

## 1. Quick Start — Plain JS

```js
import { createStorefrontClient } from '@raulbellosom/runly-sdk'

// Read from window.RUNLY_CONFIG (injected by Runly Website) or env vars for local dev.
const cfg = (typeof window !== 'undefined' && window.RUNLY_CONFIG) ? window.RUNLY_CONFIG : {}

const sdk = createStorefrontClient({
  baseUrl:         cfg.apiUrl         ?? 'https://erp.tudominio.mx',
  company:         cfg.company         ?? 'tu-empresa',
  supabaseUrl:     cfg.supabaseUrl     ?? 'https://supabase.tudominio.mx',
  supabaseAnonKey: cfg.supabaseAnonKey ?? '<anon-key>',
})

// Log in — Supabase stores the session in localStorage automatically.
// The same session is shared with Runly ERP.
const { user, token } = await sdk.auth.login({
  email: 'cliente@ejemplo.mx',
  password: 'contraseña123',
})
console.log('Bienvenido,', user?.displayName ?? 'usuario')

// Redirect ERP users to the ERP app
if (user?.hasErpAccess) {
  window.location.href = cfg.apiUrl ?? 'https://erp.tudominio.mx'
}

// Make an authenticated request (token is added automatically)
const { data: bookings } = await sdk.request('GET', '/public/bookings')
console.log('Reservaciones:', bookings)

// Log out
await sdk.auth.logout()
```

The returned SDK object is frozen: `{ auth, files, catalog, discovery, realtime, analytics, forms, request }`. Each namespace is documented in its own section below.

---

## 2. Quick Start — React + Vite

### `src/main.jsx`

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createStorefrontClient } from '@raulbellosom/runly-sdk'
import { StorefrontProvider } from '@raulbellosom/runly-sdk/react'
import App from './App.jsx'

const cfg = (typeof window !== 'undefined' && window.RUNLY_CONFIG) ? window.RUNLY_CONFIG : {}

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

### `src/components/LoginForm.jsx`

```jsx
import { useState } from 'react'
import { useAuth } from '@raulbellosom/runly-sdk/react'
import { StorefrontError } from '@raulbellosom/runly-sdk'

export function LoginForm({ onSuccess }) {
  const { login, isLoading, error } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    try {
      await login({ email, password })
      onSuccess()
    } catch (err) {
      // error is already set on the hook; no action needed here
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Iniciar sesion</h2>
      {error && (
        <p style={{ color: 'red' }}>
          {error instanceof StorefrontError
            ? error.message
            : 'Ocurrio un error inesperado'}
        </p>
      )}
      <label>
        Correo electronico
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label>
        Contrasena
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  )
}
```

### `src/components/ProductList.jsx`

```jsx
import { useProducts } from '@raulbellosom/runly-sdk/react'

export function ProductList() {
  const { data, isLoading, error } = useProducts({ limit: 20, page: 1 })

  if (isLoading) return <p>Cargando productos...</p>
  if (error) return <p>Error al cargar productos: {error.message}</p>
  if (!data?.data?.length) return <p>No hay productos disponibles.</p>

  return (
    <ul>
      {data.data.map((product) => (
        <li key={product.id}>
          <strong>{product.name}</strong> — ${product.price}
        </li>
      ))}
    </ul>
  )
}
```

---

## 3. Configuration reference

`createStorefrontClient(options)` accepts the following options:

| Option | Type | Required | Description | Example |
|---|---|---|---|---|
| `baseUrl` | `string` | Yes | Full URL of the ERP instance, no trailing slash | `'https://erp.tudominio.mx'` |
| `company` | `string` | Yes | Company slug assigned by the platform admin. Sent as `X-Runly-Company` on every request | `'tu-empresa'` |
| `siteId` | `string` | No | Website site UUID for analytics and forms. In Runly Website it is inferred from `window.RUNLY_CONFIG.siteId` | `'019...'` |
| `supabaseUrl` | `string` | Yes | Supabase project URL. Available in `window.RUNLY_CONFIG.supabaseUrl` for Runly Website dists | `'https://supabase.tudominio.mx'` |
| `supabaseAnonKey` | `string` | Yes | Supabase anon key. Available in `window.RUNLY_CONFIG.supabaseAnonKey` | `'eyJ...'` |
| `onSessionChange` | `function(session \| null)` | No | Called on every auth state change. Session is persisted by Supabase automatically — this is optional and mainly useful for debugging or syncing external state | `(s) => console.log('session:', s)` |

The function throws a plain `Error` (not a `StorefrontError`) synchronously if `baseUrl`, `company`, `supabaseUrl`, or `supabaseAnonKey` is missing.

---

## 4. sdk.auth

### `sdk.auth.register(params)`

**Description:** Creates a new storefront user account. Does not log the user in — call `sdk.auth.login` after registration if you want to start a session immediately.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `email` | `string` | Yes | User's email address |
| `password` | `string` | Yes | Plain-text password (transmitted over HTTPS, hashed server-side) |
| `name` | `string` | Yes | Display name for the user |
| `role` | `string` | No | Storefront role to assign. Defaults to `'storefront_client'`. The allowed values depend on which roles the platform admin has made registrable |

**Returns:** `Promise<{ id, displayName, firstName, lastName, email, phone, bio, role, hasErpAccess }>`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | UUID v7 of the new user record |
| `displayName` | `string` | Full display name |
| `firstName` | `string` | First name extracted from `name` |
| `lastName` | `string` | Last name extracted from `name` |
| `email` | `string` | Email address |
| `phone` | `string \| null` | Phone number (null until set by the user) |
| `bio` | `string \| null` | Short bio (null until set by the user) |
| `role` | `string` | Assigned storefront role |
| `hasErpAccess` | `boolean` | `true` if the user's role has the `platform.erp.access` permission (typically `false` for storefront roles) |

**Example:**

```js
import { StorefrontError } from '@raulbellosom/runly-sdk'

try {
  const user = await sdk.auth.register({
    email: 'nuevo@ejemplo.mx',
    password: 'MiContrasena456',
    name: 'Ana Garcia',
    role: 'storefront_client',
  })
  console.log('Cuenta creada:', user.displayName)
} catch (err) {
  if (err instanceof StorefrontError) {
    if (err.code === 'VALIDATION_ERROR') {
      console.error('Datos invalidos:', err.details)
    } else if (err.status === 409) {
      console.error('Este correo ya esta registrado')
    } else {
      console.error(err.message)
    }
  }
}
```

**Errors thrown:**
- `VALIDATION_ERROR` (422) — missing or invalid fields; `err.details` contains per-field messages
- `UNKNOWN` (409) — email already registered
- `NETWORK_ERROR` (0) — could not reach the server

---

### `sdk.auth.login(params)`

**Description:** Authenticates with email and password, stores the session internally, and calls `onSessionChange` if configured.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `email` | `string` | Yes | Registered email address |
| `password` | `string` | Yes | Account password |

**Returns:** `Promise<{ user, token, refreshToken, expiresAt }>`

| Field | Type | Description |
|---|---|---|
| `user` | `object` | `{ id, displayName, firstName, lastName, email, phone, bio, role, hasErpAccess }` |
| `token` | `string` | JWT access token (short-lived) |
| `refreshToken` | `string` | Opaque refresh token (long-lived) |
| `expiresAt` | `string` | ISO 8601 datetime when `token` expires |

**Example:**

```js
import { StorefrontError } from '@raulbellosom/runly-sdk'

try {
  const session = await sdk.auth.login({
    email: 'cliente@ejemplo.mx',
    password: 'MiContrasena456',
  })
  console.log('Bienvenido,', session.user.displayName)
  console.log('Token expira:', session.expiresAt)
} catch (err) {
  if (err instanceof StorefrontError) {
    if (err.code === 'UNAUTHORIZED') {
      console.error('Correo o contrasena incorrectos')
    } else {
      console.error(err.message)
    }
  }
}
```

**Errors thrown:**
- `UNAUTHORIZED` (401) — wrong email or password
- `NETWORK_ERROR` (0) — could not reach the server

---

### `sdk.auth.me()`

**Description:** Returns the profile of the currently authenticated user. Requires an active session.

**Parameters:** None

**Returns:** `Promise<{ id, displayName, firstName, lastName, email, phone, bio, role, hasErpAccess }>`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | UUID v7 of the user record |
| `displayName` | `string` | Full display name |
| `firstName` | `string` | First name |
| `lastName` | `string` | Last name |
| `email` | `string` | Email address |
| `phone` | `string \| null` | Phone number |
| `bio` | `string \| null` | Short bio |
| `role` | `string` | Assigned role key |
| `hasErpAccess` | `boolean` | `true` if the user's role has the `platform.erp.access` permission |

**Example:**

```js
const profile = await sdk.auth.me()
console.log('Perfil:', profile.email, profile.role)
if (profile.hasErpAccess) {
  window.location.href = window.RUNLY_CONFIG?.apiUrl ?? '/'
}
```

**Errors thrown:**
- `UNAUTHORIZED` (401) — no active session or expired token that could not be refreshed

---

### `sdk.auth.refresh()`

**Description:** Exchanges the stored `refreshToken` for a new `token` and `refreshToken` pair. You normally do not need to call this manually — the SDK calls it automatically when any request returns 401. Exposed for manual use if needed.

**Parameters:** None

**Returns:** `Promise<{ token, refreshToken, expiresAt }>`

**Example:**

```js
try {
  const tokens = await sdk.auth.refresh()
  console.log('Token renovado, expira:', tokens.expiresAt)
} catch (err) {
  // Refresh failed — session is cleared automatically, user must log in again
  console.error('Sesion expirada, inicia sesion de nuevo')
}
```

**Errors thrown:**
- Plain `Error` — if there is no active session with a `refreshToken`
- `UNAUTHORIZED` (401) — if the refresh token is invalid or expired (session is cleared)

---

### `sdk.auth.logout()`

**Description:** Invalidates the session server-side and clears the in-memory session, triggering `onSessionChange(null)`.

**Parameters:** None

**Returns:** `Promise<void>`

**Example:**

```js
await sdk.auth.logout()
// Session is now null. onSessionChange was called with null.
// Supabase clears its localStorage key automatically via the SIGNED_OUT event.
```

**Errors thrown:**
- `NETWORK_ERROR` (0) — if the server is unreachable (the local session is still cleared)

---

### `sdk.auth.getSession()`

**Description:** Synchronously returns the current in-memory session without making a network request.

**Parameters:** None

**Returns:** `{ user, token, refreshToken, expiresAt } | null`

**Example:**

```js
const session = sdk.auth.getSession()
if (session) {
  console.log('Sesion activa para:', session.user.email)
} else {
  console.log('Sin sesion activa')
}
```

---

### `sdk.auth.onAuthStateChange(fn)`

**Description:** Subscribes to session changes. The callback is called every time the session is set (login or token refresh) or cleared (logout or refresh failure). Returns an unsubscribe function.

**Parameters:**

| Name | Type | Description |
|---|---|---|
| `fn` | `function(session \| null)` | Called with the full session object, or `null` when the session is cleared |

**Returns:** `function` — call this to unsubscribe

**Example:**

```js
const unsubscribe = sdk.auth.onAuthStateChange((session) => {
  if (session) {
    console.log('Usuario autenticado:', session.user.email)
  } else {
    console.log('Sesion cerrada')
    window.location.href = '/login'
  }
})

// Later, when the listener is no longer needed:
unsubscribe()
```

---

## 5. sdk.files

Files uploaded via the SDK are stored in Supabase Storage. Access control and size limits depend on the authenticated user's role.

**Role-based limits:**

| Role | Max file size | Allowed types |
|---|---|---|
| `storefront_client` | 5 MB | Images only (`image/*`) |
| `storefront_vendor` | 100 MB | All file types |

---

### `sdk.files.upload(file, options?)`

**Description:** Uploads a `File` or `Blob` to Supabase Storage. Requires an authenticated session.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `file` | `File \| Blob` | Yes | The file object to upload (from `<input type="file">` or a `Blob`) |
| `options.visibility` | `'PUBLIC' \| 'PRIVATE'` | No | Whether the file is publicly accessible. Defaults to `'PUBLIC'` |
| `options.entityType` | `string` | No | Optional label identifying what kind of record this file belongs to (e.g. `'product'`, `'booking'`) |
| `options.entityId` | `string` | No | Optional UUID of the specific record this file belongs to |

**Returns:** `Promise<{ id, url, originalName, mimeType, sizeBytes }>`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | UUID v7 of the created `FileAsset` record |
| `url` | `string` | Permanent URL if `visibility` is `PUBLIC`; signed URL (1 hour) if `PRIVATE` |
| `originalName` | `string` | Original file name as uploaded |
| `mimeType` | `string` | MIME type of the file |
| `sizeBytes` | `number` | File size in bytes |

**Example:**

```js
const fileInput = document.getElementById('foto')
const file = fileInput.files[0]

try {
  const asset = await sdk.files.upload(file, {
    visibility: 'PUBLIC',
    entityType: 'product',
    entityId: '01933b7e-0000-7000-8000-000000000001',
  })
  console.log('Archivo subido:', asset.url)
} catch (err) {
  if (err.code === 'VALIDATION_ERROR') {
    console.error('Tipo de archivo no permitido o tamano excedido')
  } else if (err.code === 'UNAUTHORIZED') {
    console.error('Debes iniciar sesion para subir archivos')
  }
}
```

---

### `sdk.files.getUrl(id)`

**Description:** Returns the URL for a file asset. For `PUBLIC` files this is a permanent URL. For `PRIVATE` files this is a signed URL valid for 1 hour.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | The `FileAsset` UUID returned by `upload()` |

**Returns:** `Promise<{ url?: string, signedUrl?: string, type: 'public' | 'signed' }>`

| Field | Type | Description |
|---|---|---|
| `url` | `string` | Present when `type` is `'public'`. Permanent URL. |
| `signedUrl` | `string` | Present when `type` is `'signed'`. Expires in 1 hour. |
| `type` | `'public' \| 'signed'` | Indicates which field contains the URL |

**Example:**

```js
const result = await sdk.files.getUrl('01933b7e-0000-7000-8000-000000000001')
const displayUrl = result.type === 'public' ? result.url : result.signedUrl
document.getElementById('imagen').src = displayUrl
```

---

### `sdk.files.getSignedUrl(id)`

**Description:** Alias for `getUrl`. Returns the same response. Use when you specifically want to signal intent to get a signed (temporary) URL, though the server decides based on visibility.

**Parameters:** Same as `getUrl`.

**Returns:** Same as `getUrl`.

---

### `sdk.files.delete(id)`

**Description:** Deletes a file asset. The caller must be the user who uploaded the file.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | The `FileAsset` UUID |

**Returns:** `Promise<{ success: true }>`

**Example:**

```js
try {
  await sdk.files.delete('01933b7e-0000-7000-8000-000000000001')
  console.log('Archivo eliminado')
} catch (err) {
  if (err.code === 'FORBIDDEN') {
    console.error('No tienes permiso para eliminar este archivo')
  } else if (err.code === 'NOT_FOUND') {
    console.error('El archivo no existe')
  }
}
```

---

## 6. sdk.catalog

### `sdk.catalog.products(options?)`

**Description:** Lists products from the catalog. Returns the raw API response envelope (not just the data array) so pagination metadata is accessible.

**Parameters (all optional):**

| Name | Type | Description |
|---|---|---|
| `page` | `number` | Page number, 1-based. Defaults to 1 |
| `limit` | `number` | Items per page. Defaults to server default (typically 20) |
| `search` | `string` | Full-text search term |
| `categoryId` | `string` | Filter by category UUID |
| `sort` | `string` | Sort field, e.g. `'name'`, `'price'` |
| `order` | `'asc' \| 'desc'` | Sort direction |

**Returns:** `Promise<{ data: Array<product>, total: number, page: number, limit: number }>`

Each product object has at minimum `{ id, name, price }`. Additional fields depend on the ERP configuration and which blueprints are installed.

**Example:**

```js
const result = await sdk.catalog.products({ page: 1, limit: 10, search: 'zapato' })
console.log(`Mostrando ${result.data.length} de ${result.total} productos`)
for (const product of result.data) {
  console.log(product.name, product.price)
}
```

---

### `sdk.catalog.getProduct(id)`

**Description:** Returns a single product by its UUID.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Product UUID |

**Returns:** `Promise<product>` — a single product object

**Example:**

```js
try {
  const product = await sdk.catalog.getProduct('01933b7e-0000-7000-8000-000000000002')
  console.log(product.name, product.price)
} catch (err) {
  if (err.code === 'NOT_FOUND') {
    console.error('Producto no encontrado')
  }
}
```

---

### `sdk.catalog.categories(options?)`

**Description:** Lists product categories. Returns the raw API response envelope.

**Parameters (all optional):**

| Name | Type | Description |
|---|---|---|
| `page` | `number` | Page number, 1-based |
| `limit` | `number` | Items per page |

**Returns:** `Promise<{ data: Array<category>, total: number, page: number, limit: number }>`

Each category object has at minimum `{ id, name }`.

**Example:**

```js
const result = await sdk.catalog.categories()
for (const category of result.data) {
  console.log(category.id, category.name)
}
```

---

## 7. sdk.discovery

The discovery namespace lets you query which modules (features) are installed and enabled on the ERP instance, what data structures they expose, and how to reach their endpoints.

**Caching:** All results are cached in memory for 30 seconds. Concurrent calls while a fetch is in-flight share a single promise — the network request is made only once. The cache resets on client instantiation.

**Quick discovery via `GET /public`:** Any running Runly ERP instance exposes a meta-endpoint at `GET /public` (no auth required) that lists every available public endpoint with its method, path, auth requirement, and description. This is the fastest way for a developer, tool, or AI agent to discover what the instance supports without reading documentation:

```bash
curl https://erp.tudominio.mx/public
```

**What is a blueprint?** A blueprint is a JSON schema object describing a data view registered by an installed ERP module (e.g. a custom screen component, a public entity view). Each blueprint has at minimum: `{ key, moduleKey, kind, schema }`.

**What is a module?** A module is an installable ERP feature (e.g. `runly.catalog`, `custom.bookings`). The `modules()` method returns the list of modules currently installed and enabled on the running instance, including their navigation structure and what they expose publicly.

---

### `sdk.discovery.modules()`

**Description:** Returns all installed and enabled modules on this ERP instance. Results are cached for 30 seconds. Use this to know which features are active before building module-specific UI or making module-specific API calls.

**Parameters:** None

**Returns:** `Promise<Array<module>>`

Each module object:

| Field | Type | Description |
|---|---|---|
| `key` | `string` | Unique module identifier, e.g. `'runly.catalog'`, `'custom.bookings'` |
| `name` | `string` | Human-readable module name |
| `version` | `string` | Installed version string |
| `kind` | `string` | Module kind: `'CORE'`, `'FEATURE'`, or `'CUSTOM'` |
| `enabled` | `boolean` | Always `true` in this response (only enabled modules are returned) |
| `navigation` | `Array` | Navigation items declared by this module (label, path, icon) |
| `exposes` | `Array` | Public routes or capabilities this module exposes |

**Example:**

```js
const mods = await sdk.discovery.modules()
console.log(`Modulos activos: ${mods.length}`)

for (const mod of mods) {
  console.log(`${mod.key} v${mod.version} — ${mod.name}`)
}

// Check if a specific module is active
const hasBookings = mods.some(m => m.key === 'custom.bookings')
if (hasBookings) {
  // Show bookings UI
}
```

---

### `sdk.discovery.blueprints()`

**Description:** Returns all public custom views (blueprints) registered by enabled modules on this ERP instance. Results are cached for 30 seconds. Blueprints describe UI components that modules declare as publicly renderable.

**Parameters:** None

**Returns:** `Promise<Array<blueprint>>`

Each blueprint object includes: `{ key, moduleKey, kind, schema: { component, path, title, public } }`.

**Example:**

```js
const blueprints = await sdk.discovery.blueprints()
console.log(`Vistas publicas registradas: ${blueprints.length}`)

const bookingViews = blueprints.filter(bp => bp.moduleKey === 'custom.bookings')
console.log('Vistas de reservaciones:', bookingViews.map(bp => bp.key))
```

---

### `sdk.discovery.hasModule(moduleKey)`

**Description:** Returns `true` if the given module key is installed and enabled on this ERP instance. Uses the cached `modules()` result.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `moduleKey` | `string` | Yes | The module identifier, e.g. `'custom.bookings'`, `'runly.catalog'` |

**Returns:** `Promise<boolean>`

**Example:**

```js
const hasCatalog = await sdk.discovery.hasModule('runly.catalog')
if (!hasCatalog) {
  console.warn('El modulo de catalogo no esta disponible en este servidor')
}
```

---

### `sdk.discovery.introspect()`

**Description:** Fetches modules and blueprints in parallel and returns a unified schema object. This is the primary method for an external project or AI agent to build a complete picture of what a Runly ERP instance supports — which modules are active, what they expose, and what views they declare.

**Parameters:** None

**Returns:** `Promise<{ modules, blueprints, byModuleKey }>`

| Field | Type | Description |
|---|---|---|
| `modules` | `Array<module>` | Same as `sdk.discovery.modules()` |
| `blueprints` | `Array<blueprint>` | Same as `sdk.discovery.blueprints()` |
| `byModuleKey` | `object` | Each key is a module key; each value is the module object extended with a `blueprints` array containing that module's views |

**Example:**

```js
const { modules, blueprints, byModuleKey } = await sdk.discovery.introspect()

console.log(`Modulos activos: ${modules.length}`)
console.log(`Vistas publicas: ${blueprints.length}`)

// Access a specific module and all its views
const catalog = byModuleKey['runly.catalog']
if (catalog) {
  console.log(`Catalogo v${catalog.version}, vistas: ${catalog.blueprints.length}`)
  console.log('Navegacion:', catalog.navigation.map(n => n.label))
}

// Enumerate everything — useful for AI agents or integration tools
for (const [key, mod] of Object.entries(byModuleKey)) {
  console.log(`${key}: ${mod.blueprints.length} vistas`)
}
```

**Recommended use case — AI agent or integration bootstrap:**

```js
// Call once at startup to understand what this ERP instance supports
const schema = await sdk.discovery.introspect()

// Now you can make informed decisions:
if (schema.byModuleKey['custom.reservations']) {
  loadReservationsModule(schema.byModuleKey['custom.reservations'])
}
if (schema.byModuleKey['runly.catalog']) {
  loadCatalogModule(schema.byModuleKey['runly.catalog'])
}
```

---

## 8. sdk.realtime

The realtime namespace provides live database-change events via Supabase Realtime. It is scoped to the company that the SDK was initialized with.

**Lazy connection:** The Supabase WebSocket connection is established only on the first `on()` call. Importing the SDK or calling other namespaces does not open a WebSocket.

**Event key format:** `"<tableName>.<eventType>"` where `eventType` is one of `insert`, `update`, or `delete` (lowercase). Example: `"reservaciones.insert"`.

---

### `sdk.realtime.on(event, handler)`

**Description:** Subscribes to a real-time database event. Opens the Supabase connection if not already open.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `event` | `string` | Yes | Event key in `"table.eventtype"` format, e.g. `'reservaciones.update'` |
| `handler` | `function(row)` | Yes | Called with the new row (for insert/update) or the deleted row (for delete) when the event fires |

**Returns:** `void`

---

### `sdk.realtime.off(event, handler)`

**Description:** Removes a previously registered handler. The WebSocket connection stays open until `dispose()` is called.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `event` | `string` | Yes | Same event key passed to `on()` |
| `handler` | `function` | Yes | The exact same function reference passed to `on()` |

**Returns:** `void`

---

### `sdk.realtime.dispose()`

**Description:** Removes the Supabase channel subscription and closes the WebSocket connection. Clears all handlers. Call this when tearing down the application or when you no longer need live events.

**Parameters:** None

**Returns:** `Promise<void>`

---

**Complete example — booking status subscription:**

```js
// Subscribe to status changes on a bookings table
function handleBookingUpdate(row) {
  console.log('Reservacion actualizada:', row.id, 'Estado:', row.status)
  if (row.status === 'CONFIRMED') {
    showNotification('Tu reservacion ha sido confirmada')
  }
}

sdk.realtime.on('reservaciones.update', handleBookingUpdate)

// When navigating away or unmounting
function cleanup() {
  sdk.realtime.off('reservaciones.update', handleBookingUpdate)
}

// When the user logs out or the app is closed
async function shutdown() {
  await sdk.realtime.dispose()
}
```

---

## 9. sdk.request — generic escape hatch

`sdk.request(method, path, body?, options?)` lets you call any API endpoint that does not have a dedicated SDK namespace. This is the primary way to interact with custom ERP modules (bookings, reviews, loyalty points, etc.) before they receive a dedicated SDK namespace.

The method automatically:
- Attaches the `Authorization: Bearer <token>` header from the current session
- Attaches the `X-Runly-Company` header
- Retries once with a refreshed token on 401 responses
- Throws `StorefrontError` on non-2xx responses

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `method` | `string` | Yes | HTTP method: `'GET'`, `'POST'`, `'PUT'`, `'PATCH'`, `'DELETE'` |
| `path` | `string` | Yes | API path starting with `/`, e.g. `'/public/bookings'` |
| `body` | `object \| FormData \| null` | No | Request body. Objects are JSON-serialized. `FormData` is sent as multipart. Omit or pass `null` for GET/DELETE |
| `options` | `object` | No | Additional options. Supports `options.headers` (extra headers as a plain object) |

**Returns:** `Promise<any>` — the parsed JSON response from the API

**Example — list bookings:**

```js
const response = await sdk.request('GET', '/public/bookings')
const bookings = response.data
```

**Example — create a booking:**

```js
const response = await sdk.request('POST', '/public/bookings', {
  serviceId: '01933b7e-0000-7000-8000-000000000003',
  date: '2026-07-15',
  time: '10:00',
  notes: 'Sin gluten por favor',
})
const newBooking = response.data
console.log('Reservacion creada:', newBooking.id)
```

**Example — cancel a booking:**

```js
await sdk.request('PATCH', `/public/bookings/${bookingId}`, {
  status: 'CANCELLED',
})
```

---

## 10. StorefrontError — complete error reference

All SDK methods throw `StorefrontError` on failure (except `createStorefrontClient` which throws a plain `Error` for missing config).

```js
import { StorefrontError } from '@raulbellosom/runly-sdk'
```

**Class properties:**

| Property | Type | Description |
|---|---|---|
| `message` | `string` | Human-readable error message from the server, or a generic fallback |
| `code` | `string` | Machine-readable error code (see table below) |
| `status` | `number` | HTTP status code. `0` for network errors (server unreachable) |
| `details` | `any \| null` | Extra information, typically per-field validation errors as an object |
| `name` | `string` | Always `'StorefrontError'` |

**Error codes:**

| Code | HTTP Status | Meaning | When thrown |
|---|---|---|---|
| `UNAUTHORIZED` | 401 | Not authenticated or token expired | Calling a protected endpoint without a session, or after a failed token refresh |
| `FORBIDDEN` | 403 | Authenticated but not allowed | Trying to delete someone else's file, accessing an admin-only endpoint |
| `NOT_FOUND` | 404 | Resource does not exist | `getProduct` with a non-existent ID, `getUrl` with an unknown file ID |
| `VALIDATION_ERROR` | 422 | Request body failed server-side validation | Missing required fields, invalid email format, file type not allowed |
| `MODULE_NOT_AVAILABLE` | — | Module required for this operation is not installed | Calling catalog endpoints when `runly.catalog` is not installed |
| `NETWORK_ERROR` | 0 | Could not reach the server at all | No internet connection, DNS failure, server down |
| `UNKNOWN` | varies | Any other non-2xx response | Server errors (500), conflicts (409), rate limiting (429) |

**try/catch pattern:**

```js
import { StorefrontError } from '@raulbellosom/runly-sdk'

try {
  const session = await sdk.auth.login({ email, password })
  // success
} catch (err) {
  if (err instanceof StorefrontError) {
    switch (err.code) {
      case 'UNAUTHORIZED':
        setError('Correo o contrasena incorrectos')
        break
      case 'VALIDATION_ERROR':
        // err.details may be an object like { email: 'Formato invalido' }
        setError('Revisa los campos del formulario')
        setFieldErrors(err.details)
        break
      case 'NETWORK_ERROR':
        setError('Sin conexion. Verifica tu internet e intenta de nuevo')
        break
      default:
        setError('Ocurrio un error inesperado. Intenta de nuevo.')
    }
  } else {
    // Programming error — rethrow
    throw err
  }
}
```

---

## 11. React Hooks — complete reference

All hooks are exported from `@raulbellosom/runly-sdk/react`. They must be used inside a component tree wrapped with `<StorefrontProvider>`.

---

### `StorefrontProvider` + `useStorefront`

**Import:** `import { StorefrontProvider, useStorefront } from '@raulbellosom/runly-sdk/react'`

**`StorefrontProvider`** is a React context provider. It makes the SDK client available to all hooks in its subtree. Place it at the root of your application.

Props:
| Prop | Type | Required | Description |
|---|---|---|---|
| `client` | SDK client | Yes | The object returned by `createStorefrontClient(...)` |
| `children` | `ReactNode` | Yes | Your application tree |

**`useStorefront()`** returns the SDK client directly. Use this if you need to call SDK methods outside of the built-in hooks (e.g. `sdk.realtime.on`). Throws if called outside of `StorefrontProvider`.

**Example:**

```jsx
import { useEffect } from 'react'
import { useStorefront } from '@raulbellosom/runly-sdk/react'

function RealtimeListener() {
  const sdk = useStorefront()

  useEffect(() => {
    function handleUpdate(row) {
      console.log('Fila actualizada:', row)
    }
    sdk.realtime.on('pedidos.update', handleUpdate)
    return () => {
      sdk.realtime.off('pedidos.update', handleUpdate)
    }
  }, [sdk])

  return null
}
```

---

### `useSession()`

**Import:** `import { useSession } from '@raulbellosom/runly-sdk/react'`

**Signature:** `useSession(): { user, token, refreshToken, expiresAt } | null`

**Description:** Returns the current session and re-renders the component whenever the session changes (login, logout, token refresh). Returns `null` when no session is active.

**Return value:**
| Field | Type | Description |
|---|---|---|
| `user` | `object` | `{ id, displayName, firstName, lastName, email, phone, bio, role, hasErpAccess }` |
| `token` | `string` | Current JWT access token |
| `refreshToken` | `string` | Current refresh token |
| `expiresAt` | `string` | ISO 8601 expiry datetime of the access token |

Returns `null` when no user is logged in.

**Example:**

```jsx
import { useSession } from '@raulbellosom/runly-sdk/react'

function UserBadge() {
  const session = useSession()

  if (!session) {
    return <span>Visitante</span>
  }

  return <span>Hola, {session.user.displayName}</span>
}
```

---

### `useAuth()`

**Import:** `import { useAuth } from '@raulbellosom/runly-sdk/react'`

**Signature:** `useAuth(): { user, session, isAuthenticated, isLoading, error, login, register, logout, refresh }`

**Return value:**

| Field | Type | Description |
|---|---|---|
| `user` | `object \| null` | Current user's profile, or `null` if not logged in |
| `session` | `object \| null` | Full session object (same as `useSession()`), or `null` |
| `isAuthenticated` | `boolean` | `true` when a session is active |
| `isLoading` | `boolean` | `true` while any auth operation (login, register, logout, refresh) is in progress |
| `error` | `StorefrontError \| null` | The last error from any auth operation, or `null` |
| `login` | `async function({ email, password })` | Calls `sdk.auth.login`. Updates `isLoading` and `error` |
| `register` | `async function({ email, password, name, role? })` | Calls `sdk.auth.register`. Updates `isLoading` and `error` |
| `logout` | `async function()` | Calls `sdk.auth.logout`. Updates `isLoading` and `error` |
| `refresh` | `async function()` | Calls `sdk.auth.refresh`. Updates `isLoading` and `error` |

All four action functions set `isLoading` to `true` while running, clear `error` at the start, and set `error` if the call fails. They also re-throw the error so you can catch it in the calling component.

**Example:**

```jsx
import { useState } from 'react'
import { useAuth } from '@raulbellosom/runly-sdk/react'
import { StorefrontError } from '@raulbellosom/runly-sdk'

function LoginForm({ onSuccess }) {
  const { login, isLoading, error } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    try {
      await login({ email, password })
      onSuccess()
    } catch (err) {
      // error state is already set on the hook; display it via the `error` field
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div role="alert" style={{ color: 'red' }}>
          {error instanceof StorefrontError && error.code === 'UNAUTHORIZED'
            ? 'Correo o contrasena incorrectos'
            : 'Ocurrio un error. Intenta de nuevo.'}
        </div>
      )}
      <input
        type="email"
        placeholder="Correo electronico"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="Contrasena"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Iniciando sesion...' : 'Iniciar sesion'}
      </button>
    </form>
  )
}
```

---

### `useFileUpload()`

**Import:** `import { useFileUpload } from '@raulbellosom/runly-sdk/react'`

**Signature:** `useFileUpload(): { upload, uploading, error, result, reset }`

**Return value:**

| Field | Type | Description |
|---|---|---|
| `upload` | `async function(file, options?)` | Calls `sdk.files.upload`. Same signature and options as the plain JS method |
| `uploading` | `boolean` | `true` while an upload is in progress |
| `error` | `StorefrontError \| null` | Error from the last upload attempt, or `null` |
| `result` | `{ id, url, originalName, mimeType, sizeBytes } \| null` | Result of the last successful upload, or `null` |
| `reset` | `function()` | Clears `error` and `result` back to `null` |

**Example:**

```jsx
import { useRef } from 'react'
import { useFileUpload } from '@raulbellosom/runly-sdk/react'

function AvatarUploader({ onUploaded }) {
  const { upload, uploading, error, result, reset } = useFileUpload()
  const inputRef = useRef(null)

  async function handleChange(e) {
    const file = e.target.files[0]
    if (!file) return
    try {
      const asset = await upload(file, { visibility: 'PUBLIC', entityType: 'avatar' })
      onUploaded(asset.url)
    } catch (err) {
      // error state is set on the hook
    }
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleChange} />
      {uploading && <p>Subiendo imagen...</p>}
      {error && <p style={{ color: 'red' }}>Error: {error.message}</p>}
      {result && <img src={result.url} alt="Avatar subido" width={100} />}
      {(error || result) && (
        <button onClick={reset}>Limpiar</button>
      )}
    </div>
  )
}
```

---

### `useCompanyConfig()`

**Import:** `import { useCompanyConfig } from '@raulbellosom/runly-sdk/react'`

**Signature:** `useCompanyConfig(): { config, isLoading, error }`

**Description:** Fetches the public storefront configuration for this company. The config object typically contains branding, contact info, and feature flags set by the platform admin.

**Return value:**

| Field | Type | Description |
|---|---|---|
| `config` | `object \| null` | The company's storefront config object, or `null` while loading |
| `isLoading` | `boolean` | `true` while the config is being fetched |
| `error` | `StorefrontError \| null` | Any fetch error, or `null` |

**Example:**

```jsx
import { useCompanyConfig } from '@raulbellosom/runly-sdk/react'

function StoreHeader() {
  const { config, isLoading, error } = useCompanyConfig()

  if (isLoading) return <header><span>Cargando...</span></header>
  if (error) return <header><span>Error al cargar configuracion</span></header>

  return (
    <header>
      <h1>{config?.storeName ?? 'Tienda'}</h1>
      {config?.logoUrl && <img src={config.logoUrl} alt="Logo de la tienda" />}
    </header>
  )
}
```

---

### `useBlueprints()` + `useHasModule(moduleKey)`

**Import:** `import { useBlueprints, useHasModule } from '@raulbellosom/runly-sdk/react'`

**`useBlueprints()`**

**Signature:** `useBlueprints(): { blueprints, isLoading, error }`

| Field | Type | Description |
|---|---|---|
| `blueprints` | `Array<blueprint>` | All blueprints for installed modules. Empty array while loading |
| `isLoading` | `boolean` | `true` while fetching |
| `error` | `StorefrontError \| null` | Any fetch error, or `null` |

**Example:**

```jsx
import { useBlueprints } from '@raulbellosom/runly-sdk/react'

function InstalledModules() {
  const { blueprints, isLoading, error } = useBlueprints()

  if (isLoading) return <p>Cargando modulos...</p>
  if (error) return <p>Error al cargar modulos</p>

  const moduleKeys = [...new Set(blueprints.map(bp => bp.module?.key).filter(Boolean))]

  return (
    <ul>
      {moduleKeys.map(key => (
        <li key={key}>{key}</li>
      ))}
    </ul>
  )
}
```

---

**`useHasModule(moduleKey)`**

**Signature:** `useHasModule(moduleKey: string): { hasModule, isLoading }`

| Field | Type | Description |
|---|---|---|
| `hasModule` | `boolean` | `true` if the given module is installed and enabled |
| `isLoading` | `boolean` | `true` while checking |

**Example:**

```jsx
import { useHasModule } from '@raulbellosom/runly-sdk/react'

function BookingsSection() {
  const { hasModule, isLoading } = useHasModule('custom.bookings')

  if (isLoading) return null
  if (!hasModule) return null

  return (
    <section>
      <h2>Reservaciones</h2>
      {/* booking UI here */}
    </section>
  )
}
```

---

### `useProducts()` + `useProduct(id)` + `useCategories()`

**Import:** `import { useProducts, useProduct, useCategories } from '@raulbellosom/runly-sdk/react'`

---

**`useProducts(options?)`**

**Signature:** `useProducts(options?: object): { data, isLoading, error }`

`options` supports the same query parameters as `sdk.catalog.products`: `page`, `limit`, `search`, `categoryId`, `sort`, `order`. The options object is serialized with `JSON.stringify` and used as a `useEffect` dependency — passing an unstable object literal on every render will cause infinite fetching. Memoize with `useMemo` or `useState` if options change dynamically.

| Field | Type | Description |
|---|---|---|
| `data` | `{ data: Array<product>, total, page, limit } \| null` | API response envelope, or `null` while loading |
| `isLoading` | `boolean` | `true` while fetching |
| `error` | `StorefrontError \| null` | Any fetch error, or `null` |

**Example:**

```jsx
import { useState } from 'react'
import { useProducts } from '@raulbellosom/runly-sdk/react'

function ProductGrid() {
  const [page, setPage] = useState(1)
  const { data, isLoading, error } = useProducts({ page, limit: 12 })

  if (isLoading) return <p>Cargando productos...</p>
  if (error) return <p>Error al cargar productos: {error.message}</p>
  if (!data?.data?.length) return <p>No hay productos disponibles.</p>

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {data.data.map((product) => (
          <div key={product.id} style={{ border: '1px solid #ddd', padding: 16 }}>
            <h3>{product.name}</h3>
            <p>${product.price}</p>
          </div>
        ))}
      </div>
      <div>
        <button
          disabled={page <= 1}
          onClick={() => setPage(p => p - 1)}
        >
          Anterior
        </button>
        <span> Pagina {page} de {Math.ceil(data.total / 12)} </span>
        <button
          disabled={page >= Math.ceil(data.total / 12)}
          onClick={() => setPage(p => p + 1)}
        >
          Siguiente
        </button>
      </div>
    </div>
  )
}
```

---

**`useProduct(id)`**

**Signature:** `useProduct(id: string | null): { data, isLoading, error }`

Fetches a single product. If `id` is `null` or `undefined`, the hook does nothing (sets `isLoading` to `false`, `data` stays `null`).

| Field | Type | Description |
|---|---|---|
| `data` | `product \| null` | Product object, or `null` while loading or if `id` is null |
| `isLoading` | `boolean` | `true` while fetching |
| `error` | `StorefrontError \| null` | Any fetch error, or `null` |

**Example:**

```jsx
import { useProduct } from '@raulbellosom/runly-sdk/react'

function ProductDetail({ productId }) {
  const { data: product, isLoading, error } = useProduct(productId)

  if (isLoading) return <p>Cargando producto...</p>
  if (error?.code === 'NOT_FOUND') return <p>Producto no encontrado.</p>
  if (error) return <p>Error al cargar producto: {error.message}</p>
  if (!product) return null

  return (
    <article>
      <h1>{product.name}</h1>
      <p>${product.price}</p>
    </article>
  )
}
```

---

**`useCategories(options?)`**

**Signature:** `useCategories(options?: object): { data, isLoading, error }`

Same behavior and caveats as `useProducts` but for categories.

| Field | Type | Description |
|---|---|---|
| `data` | `{ data: Array<category>, total, page, limit } \| null` | API response envelope |
| `isLoading` | `boolean` | `true` while fetching |
| `error` | `StorefrontError \| null` | Any fetch error, or `null` |

**Example:**

```jsx
import { useCategories } from '@raulbellosom/runly-sdk/react'

function CategoryMenu() {
  const { data, isLoading } = useCategories()

  if (isLoading) return <nav><span>Cargando categorias...</span></nav>

  return (
    <nav>
      {(data?.data ?? []).map((category) => (
        <a key={category.id} href={`/categoria/${category.id}`}>
          {category.name}
        </a>
      ))}
    </nav>
  )
}
```

---

### `useRequest()`

**Import:** `import { useRequest } from '@raulbellosom/runly-sdk/react'`

**Signature:** `useRequest(): { execute, data, isLoading, error, reset }`

**Description:** A stateful wrapper around `sdk.request`. Unlike the data hooks, `useRequest` does not run automatically — you call `execute` manually (e.g. on a button click or form submit).

**Return value:**

| Field | Type | Description |
|---|---|---|
| `execute` | `async function(method, path, body?, options?)` | Calls `sdk.request` with the given arguments. Same signature as `sdk.request`. |
| `data` | `any \| null` | The last successful response, or `null` |
| `isLoading` | `boolean` | `true` while a request is in progress |
| `error` | `StorefrontError \| null` | The last error, or `null` |
| `reset` | `function()` | Clears `data` and `error` back to `null` |

**Example:**

```jsx
import { useState } from 'react'
import { useRequest } from '@raulbellosom/runly-sdk/react'

function CreateBookingForm() {
  const { execute, isLoading, error, data, reset } = useRequest()
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    try {
      await execute('POST', '/public/bookings', { date, notes })
    } catch (err) {
      // error is set on the hook
    }
  }

  if (data) {
    return (
      <div>
        <p>Reservacion creada con exito. ID: {data.data?.id}</p>
        <button onClick={reset}>Crear otra reservacion</button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p style={{ color: 'red' }}>{error.message}</p>}
      <label>
        Fecha
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </label>
      <label>
        Notas
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Creando...' : 'Crear reservacion'}
      </button>
    </form>
  )
}
```

---

## 12. Auth patterns

### a) Register flow with role selection

```jsx
import { useState } from 'react'
import { useAuth } from '@raulbellosom/runly-sdk/react'
import { StorefrontError } from '@raulbellosom/runly-sdk'

function RegisterForm({ onSuccess }) {
  const { register, isLoading, error } = useAuth()
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'storefront_client' })

  function setField(field) {
    return (e) => setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    try {
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
      })
      onSuccess()
    } catch (err) {
      // error is set on the hook
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Crear cuenta</h2>
      {error && (
        <p style={{ color: 'red' }}>
          {error instanceof StorefrontError && error.code === 'VALIDATION_ERROR'
            ? 'Revisa los campos del formulario'
            : error.message}
        </p>
      )}
      <input placeholder="Nombre completo" value={form.name} onChange={setField('name')} required />
      <input type="email" placeholder="Correo electronico" value={form.email} onChange={setField('email')} required />
      <input type="password" placeholder="Contrasena" value={form.password} onChange={setField('password')} required />
      <select value={form.role} onChange={setField('role')}>
        <option value="storefront_client">Cliente</option>
        <option value="storefront_vendor">Vendedor</option>
      </select>
      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Creando cuenta...' : 'Crear cuenta'}
      </button>
    </form>
  )
}
```

### b) Login with redirect after success

```jsx
import { useState } from 'react'
import { useAuth } from '@raulbellosom/runly-sdk/react'

function LoginPage() {
  const { login, isLoading, error } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    try {
      await login({ email, password })
      // Redirect to home after successful login
      window.location.href = '/'
    } catch (err) {
      // error is set on the hook
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p style={{ color: 'red' }}>Correo o contrasena incorrectos</p>}
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo" required />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contrasena" required />
      <button type="submit" disabled={isLoading}>{isLoading ? 'Entrando...' : 'Entrar'}</button>
    </form>
  )
}
```

### c) Protected route pattern

This pattern works with any router. The example uses plain conditional rendering; adapt to React Router, TanStack Router, etc. as needed.

```jsx
import { useSession } from '@raulbellosom/runly-sdk/react'
import { useEffect } from 'react'

function ProtectedPage({ children }) {
  const session = useSession()

  useEffect(() => {
    if (session === null) {
      window.location.href = '/login'
    }
  }, [session])

  if (session === null) {
    return <p>Redirigiendo al inicio de sesion...</p>
  }

  return <>{children}</>
}

// Usage:
function AccountPage() {
  return (
    <ProtectedPage>
      <h1>Mi cuenta</h1>
    </ProtectedPage>
  )
}
```

### d) Token auto-refresh

Token refresh is fully automatic. When any SDK method receives a 401 response, the SDK:

1. Calls `supabase.auth.refreshSession()` with the stored `refreshToken`
2. The session adapter is updated automatically via Supabase's `onAuthStateChange` event
3. Calls `onSessionChange` with the updated session (if configured)
4. Retries the original request with the new token

Concurrent 401s are deduplicated — only one refresh is made regardless of how many parallel requests fail. If the refresh itself fails (expired refresh token), `supabase.auth.signOut()` is called, the session is cleared, and `onSessionChange(null)` is triggered. No code is required in your application to handle refresh — only a redirect to login when the session becomes `null`.

### e) Logout with localStorage cleanup

```jsx
import { useAuth } from '@raulbellosom/runly-sdk/react'

function LogoutButton() {
  const { logout, isLoading } = useAuth()

  async function handleLogout() {
    await logout()
    // onSessionChange(null) was already called, which removes the key if
    // you wired it up as shown in the Quick Start. Manual cleanup:
    localStorage.removeItem('sf_session')
    window.location.href = '/login'
  }

  return (
    <button onClick={handleLogout} disabled={isLoading}>
      {isLoading ? 'Cerrando sesion...' : 'Cerrar sesion'}
    </button>
  )
}
```

---

## 13. Common patterns for module-specific data

Custom ERP modules expose their data under `/public/<moduleRoute>/...`. Use `sdk.request` (plain JS) or `useRequest` (React) to interact with them. The pattern below uses a hypothetical `custom.bookings` module — apply the same pattern to any module.

### Plain JS: read + create

```js
// List all bookings for the current user
const response = await sdk.request('GET', '/public/bookings')
const bookings = response.data
// response.total, response.page, response.limit are also available if paginated

// Create a booking
const createResponse = await sdk.request('POST', '/public/bookings', {
  serviceId: '01933b7e-0000-7000-8000-000000000003',
  date: '2026-07-15',
  time: '10:00',
})
const created = createResponse.data

// Get one booking
const booking = await sdk.request('GET', `/public/bookings/${created.id}`)

// Update a booking
await sdk.request('PATCH', `/public/bookings/${created.id}`, { status: 'CANCELLED' })
```

### React: read list with `useRequest`

```jsx
import { useState, useEffect } from 'react'
import { useStorefront } from '@raulbellosom/runly-sdk/react'

function BookingList() {
  const sdk = useStorefront()
  const [bookings, setBookings] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    sdk.request('GET', '/public/bookings')
      .then(res => { if (!cancelled) setBookings(res.data ?? []) })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [sdk])

  if (isLoading) return <p>Cargando reservaciones...</p>
  if (error) return <p>Error al cargar reservaciones: {error.message}</p>
  if (!bookings.length) return <p>No tienes reservaciones.</p>

  return (
    <ul>
      {bookings.map(b => (
        <li key={b.id}>
          {b.date} — {b.status}
        </li>
      ))}
    </ul>
  )
}
```

### React: imperative mutation with `useRequest`

```jsx
import { useRequest } from '@raulbellosom/runly-sdk/react'

function CancelBookingButton({ bookingId, onCancelled }) {
  const { execute, isLoading, error } = useRequest()

  async function handleCancel() {
    try {
      await execute('PATCH', `/public/bookings/${bookingId}`, { status: 'CANCELLED' })
      onCancelled()
    } catch (err) {
      // error is set on the hook
    }
  }

  return (
    <div>
      {error && <p style={{ color: 'red' }}>No se pudo cancelar: {error.message}</p>}
      <button onClick={handleCancel} disabled={isLoading}>
        {isLoading ? 'Cancelando...' : 'Cancelar reservacion'}
      </button>
    </div>
  )
}
```

---

## 14. Environment variables for Vite projects

There are two initialization patterns depending on how your frontend is deployed.

### Pattern A — standalone Vite project (hardcoded URL)

Create a `.env` file in the root of your Vite project:

```
VITE_ERP_URL=https://erp.tudominio.mx
VITE_ERP_COMPANY=tu-empresa
VITE_SUPABASE_URL=https://supabase.tudominio.mx
VITE_SUPABASE_ANON_KEY=<anon-key>
```

**Important:** In Vite, only variables prefixed with `VITE_` are exposed to the browser bundle. Never put secrets (service role keys, admin passwords) in `VITE_` variables.

```js
// src/sdk.js
import { createStorefrontClient } from '@raulbellosom/runly-sdk'

export const sdk = createStorefrontClient({
  baseUrl:         import.meta.env.VITE_ERP_URL,
  company:         import.meta.env.VITE_ERP_COMPANY,
  supabaseUrl:     import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
})
```

### Pattern B — deployed as Runly Website dist (runtime config)

If you upload your built dist to Runly Website (`source_type=dist`), Runly automatically injects `window.RUNLY_CONFIG` into every HTML response at serve time. No `.env` file or hardcoded URLs needed — the config adapts to whichever Runly ERP instance is serving the site.

```js
// src/sdk.js
import { createStorefrontClient } from '@raulbellosom/runly-sdk'

const cfg = (typeof window !== 'undefined' && window.RUNLY_CONFIG) ? window.RUNLY_CONFIG : {}

export const sdk = createStorefrontClient({
  baseUrl:         cfg.apiUrl         ?? import.meta.env.VITE_ERP_URL         ?? '',
  company:         cfg.company         ?? import.meta.env.VITE_ERP_COMPANY     ?? '',
  supabaseUrl:     cfg.supabaseUrl     ?? import.meta.env.VITE_SUPABASE_URL    ?? '',
  supabaseAnonKey: cfg.supabaseAnonKey ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
})
```

Fields available in `window.RUNLY_CONFIG`:

| Field | Description |
|---|---|
| `apiUrl` | Full URL of the Runly ERP server — pass as `baseUrl` |
| `company` | Company slug — pass as `company` |
| `siteName` | Display name of the site configured in Runly |
| `siteId` | Website site UUID used by analytics and forms |
| `analyticsMode` | `off`, `anonymous`, or `consent_required` |
| `turnstileSiteKey` | Public Cloudflare Turnstile site key, when configured |
| `stripePublishableKey` | Stripe publishable key, if configured on the site |
| `currency` | Site currency (`'usd'`, `'mxn'`, etc.) |
| `supabaseUrl` | Supabase URL (advanced — for ERP session detection) |
| `supabaseAnonKey` | Supabase anon key (advanced) |
| `storageKey` | localStorage key for the ERP session (advanced) |

The two-fallback pattern (`cfg.apiUrl ?? import.meta.env.VITE_ERP_URL`) lets the same `src/sdk.js` work in both local development (env vars) and in production as a Runly dist (injected config).

Then import the singleton wherever needed:

```js
// src/main.jsx
import { sdk } from './sdk.js'
import { StorefrontProvider } from '@raulbellosom/runly-sdk/react'

// ... wrap your app with <StorefrontProvider client={sdk}>
```

---

## Storefront capture v1 (SDK 0.3.0)

Public endpoints:

- `GET /public/storefront/v1/config`
- `POST /public/storefront/v1/events/batch`
- `GET /public/storefront/v1/forms/:formId`
- `POST /public/storefront/v1/forms/:formId/submissions`

Requests use `X-Runly-Company` and optional `X-Runly-Site`. Event batches accept at most 50 events and 64 KB.

### Analytics

```js
await sdk.analytics.start()
sdk.analytics.setConsent('granted')
sdk.analytics.page({ section: 'pricing' })
sdk.analytics.track('pricing_cta', { placement: 'hero' })
await sdk.analytics.flush()
```

Available methods: `start`, `page`, `track`, `setConsent`, `getConsent`, `flush`, and `stop`.

- DNT always disables analytics.
- `consent_required` stores nothing until consent is granted.
- Denying consent clears queued events and local analytics identifiers.
- Sessions rotate after 30 minutes of inactivity.
- Automatic capture is limited to pageviews, visible time, form lifecycle, and tagged elements.
- Event properties reject PII, form values, nested objects, and more than 20 scalar keys.

```html
<button
  data-runly-event="pricing_cta"
  data-runly-label="Plan profesional"
  data-runly-placement="hero"
>
  Cotizar
</button>
```

### Public forms

```js
const definition = await sdk.forms.get(formId)
const result = await sdk.forms.submit(formId, values, {
  idempotencyKey: crypto.randomUUID(),
  turnstileToken,
  honeypot: '',
})
```

`sdk.forms.get(formId)` returns the form definition with all fields:

```json
{
  "data": {
    "id": "019...",
    "name": "Formulario de contacto",
    "submitLabel": "Enviar",
    "wizardMode": false,
    "fields": [
      {
        "id": "019...", "name": "nombre", "label": "Nombre",
        "fieldType": "text", "required": true, "options": null,
        "sortOrder": 0, "stepNumber": 1, "stepTitle": null
      }
    ]
  }
}
```

**Supported field types:**

| `fieldType` | Value format | Notes |
|---|---|---|
| `text` | `"string"` | Single-line text input |
| `email` | `"string"` | Email address |
| `tel` / `phone` | `"string"` | Phone number |
| `textarea` | `"string"` | Multi-line text |
| `number` | `"string"` | Numeric value as string |
| `date` | `"YYYY-MM-DD"` | ISO date string |
| `checkbox` | `"true"` \| `"false"` | Boolean as string |
| `select` | `"option_value"` | One of the `options` array values |
| `radio` | `"option_value"` | One of the `options` array values |
| `chip_multi` | `"opt1,opt2"` | Comma-joined multi-selection; `options` is `string[]` |
| `card_select` | `"option_value"` | Single selection; `options` is `{value, label, description}[]` |

**Wizard mode:** When `wizardMode: true`, each field has `stepNumber` (integer) and `stepTitle` (string or null). Group fields by `stepNumber` and present them as steps in your UI. The submit endpoint is the same regardless of wizard mode — send all field values in a single `values` object.

Submission values are sent only to the form endpoint. Analytics receives form and submission identifiers, never field values.

React exports: `useAnalytics`, `usePageView`, and `usePublicForm`.

Plain HTML can use the automatically loaded IIFE:

```html
<div id="contact-form"></div>
<script>
  window.RunlyERP.analytics.setConsent('granted')
  window.RunlyERP.renderForm('#contact-form', {
    formId: '01900000-0000-7000-8000-000000000003',
    theme: 'auto',
    onSuccess: function (result) {
      console.log(result.submissionId)
    }
  })
</script>
```

The legacy endpoint `POST /public/website/forms/:formId/submit` is deprecated in 0.3.0. Removal is planned for 0.4.0, not before September 30, 2026.

---

## 15. Roles system

The SDK uses a two-tier storefront role system for public-facing users. These roles are separate from the internal ERP admin roles.

### Built-in storefront roles

| Role | Description | File size limit | Allowed file types |
|---|---|---|---|
| `storefront_client` | End customer. Can browse the catalog, place orders, upload profile images, and submit reviews. | 5 MB | Images only (`image/*`) |
| `storefront_vendor` | Seller or partner. Can manage their own product listings and upload product media or documents. | 100 MB | All file types |

### Registrable roles

Not all roles are available for self-registration. The platform admin configures which roles users can select when calling `sdk.auth.register`. If a role is not in the registrable list, the API returns a `VALIDATION_ERROR`.

**You cannot self-register as `admin` or any internal ERP role.** Attempting to pass an admin role to `register()` will be rejected by the server with a 422 error.

### Checking the current user's role

```js
const session = sdk.auth.getSession()
if (session?.user?.role === 'storefront_vendor') {
  // show vendor-specific features
}
```

Or in React:

```jsx
import { useSession } from '@raulbellosom/runly-sdk/react'

function VendorOnlyButton() {
  const session = useSession()
  if (session?.user?.role !== 'storefront_vendor') return null
  return <button>Panel de vendedor</button>
}
```

---

## 16. Deploying to Runly Website (source\_type=dist)

Runly Website supports uploading a compiled frontend (React, Astro, Next.js static export, SvelteKit, plain Vite) as a ZIP and serving it through the ERP instance. This section covers how the SDK integrates with that workflow.

### How it works

1. You build your frontend: `vite build`, `next build`, `astro build`, etc.
2. You ZIP the `dist/` output and upload it in Runly Website settings.
3. Runly serves the HTML through its CDN and **automatically injects `window.RUNLY_CONFIG` and `/runly-sdk.js`** into every HTML response with the runtime values for that instance.

No `.env` file is bundled into the ZIP. The config is injected at serve time, so the same dist ZIP works across multiple Runly ERP instances or environments.

### Recommended `src/sdk.js` for Runly dists

```js
import { createStorefrontClient } from '@raulbellosom/runly-sdk'

// window.RUNLY_CONFIG is injected by Runly at serve time.
// Fall back to env vars for local development.
const cfg = (typeof window !== 'undefined' && window.RUNLY_CONFIG) ? window.RUNLY_CONFIG : {}

export const sdk = createStorefrontClient({
  baseUrl:         cfg.apiUrl         ?? import.meta.env.VITE_ERP_URL         ?? '',
  company:         cfg.company         ?? import.meta.env.VITE_ERP_COMPANY     ?? '',
  supabaseUrl:     cfg.supabaseUrl     ?? import.meta.env.VITE_SUPABASE_URL    ?? '',
  supabaseAnonKey: cfg.supabaseAnonKey ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
})
```

### Stripe in Runly dists

If a Stripe publishable key is configured on the site, it is available in `window.RUNLY_CONFIG.stripePublishableKey`:

```js
// src/stripe.js
export const stripe = window.RUNLY_CONFIG?.stripePublishableKey
  ? Stripe(window.RUNLY_CONFIG.stripePublishableKey)
  : null
```

### ERP admin session detection

Runly also injects a lightweight beacon script that detects whether the current visitor has an active Runly ERP session. You can read that session via `window.RunlyERP`:

```js
// Detect a Runly ERP admin/employee visiting the public site
const erpSession = await window.RunlyERP?.auth.getSession()
if (erpSession) {
  console.log('ERP user visiting:', erpSession.user?.email)
}
```

`window.RunlyERP` (the beacon IIFE) and `sdk.auth` (the npm package) **share the same Supabase session**. Both read from and write to `sb-<project>-auth-token` in localStorage. An ERP user (admin, employee) who logs in on the storefront site is automatically recognized by the beacon and can navigate to Runly ERP without logging in again. A storefront user (client, vendor) who navigates to Runly ERP sees the login screen (they have no ERP permissions). Role determines access, not which auth system was used.

**Redirect ERP users after login:**
```js
const { user } = await sdk.auth.login({ email, password })
if (user?.hasErpAccess) {
  window.location.href = window.RUNLY_CONFIG?.apiUrl ?? '/'
}
```

### Build tips

- For Vite/React: no special config needed — root-relative asset paths are rewritten automatically by Runly.
- For Astro: set `output: 'static'` and `site: '/'` in `astro.config.mjs`. Runly corrects localhost URLs at serve time.
- For Next.js: use `output: 'export'` in `next.config.js`. Set `basePath: ''`.
- For SvelteKit: use `@sveltejs/adapter-static`. Assets are rewritten by Runly.

### Local development

Run your dev server normally with `.env` variables (`VITE_ERP_URL`, `VITE_ERP_COMPANY`). The two-fallback pattern in `src/sdk.js` ensures the SDK uses env vars when `window.RUNLY_CONFIG` is not present.

---

## 17. sdk.guestChat — guest live chat

The `guestChat` namespace lets public visitors start, continue, and close live chat conversations with your team through the `runly.chat` module. No authentication is required — sessions are identified by a short-lived signed token stored in `localStorage`.

**Requires:** `runly.chat` installed and enabled on the ERP instance. Both `supabaseUrl` and `supabaseAnonKey` must be provided to `createStorefrontClient` for real-time reply subscriptions to work (the `subscribeToReplies` method falls back to a no-op when they are absent).

---

### `sdk.guestChat.getAvailability()`

**Description:** Returns the current chat availability for the company. Use this to show or hide the chat widget before a session is started.

**Parameters:** None

**Returns:** `Promise<{ available: boolean, agentsOnline: number }>`

| Field | Type | Description |
|---|---|---|
| `available` | `boolean` | `true` if at least one operator is online and ready to accept conversations |
| `agentsOnline` | `number` | Number of operators currently online |

**Example:**

```js
const status = await sdk.guestChat.getAvailability()
if (status.available) {
  showChatButton()
} else {
  showOfflineMessage(`No hay agentes disponibles ahora mismo`)
}
```

---

### `sdk.guestChat.createSession(data?)`

**Description:** Opens a new guest chat conversation. The server returns a signed token that identifies the session. Store this token in `localStorage` to resume the conversation across page reloads.

**Parameters (all optional):**

| Name | Type | Description |
|---|---|---|
| `data.name` | `string` | Visitor's display name |
| `data.email` | `string` | Visitor's email address |
| `data.pageUrl` | `string` | URL of the page where the chat started (for operator context) |
| `data.referrer` | `string` | `document.referrer` value |
| `data.userAgent` | `string` | `navigator.userAgent` value |

**Returns:** `Promise<{ token, conversationId, trackingCode }>`

| Field | Type | Description |
|---|---|---|
| `token` | `string` | Signed session token — required for all subsequent calls |
| `conversationId` | `string` | UUID of the created conversation — required for `subscribeToReplies` |
| `trackingCode` | `string` | Short human-readable code (e.g. `"CHAT-000042"`) visitors can use to resume the conversation by email |

**Example:**

```js
const session = await sdk.guestChat.createSession({
  name: 'Ana Garcia',
  email: 'ana@ejemplo.mx',
  pageUrl: window.location.href,
  referrer: document.referrer,
  userAgent: navigator.userAgent,
})
localStorage.setItem('runly_chat_token', session.token)
console.log('Conversacion iniciada. Codigo de referencia:', session.trackingCode)
```

---

### `sdk.guestChat.getSession(token)`

**Description:** Retrieves the current state of a guest session. Use this to restore a persisted session on page reload.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `token` | `string` | Yes | Session token from `createSession` |

**Returns:** `Promise<{ email, name, conversation: { status } }>`

| Field | Type | Description |
|---|---|---|
| `email` | `string \| null` | Visitor email on the session |
| `name` | `string \| null` | Visitor name on the session |
| `conversation.status` | `string` | `'open'` or `'closed'` — when `'closed'` the token is no longer usable |

**Example:**

```js
const stored = localStorage.getItem('runly_chat_token')
if (stored) {
  const data = await sdk.guestChat.getSession(stored)
  if (data.conversation?.status === 'closed') {
    localStorage.removeItem('runly_chat_token')
    // Session expired — show welcome screen
  } else {
    // Restore the conversation UI
  }
}
```

---

### `sdk.guestChat.listMessages(token, options?)`

**Description:** Returns the message history for a session, in chronological order.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `token` | `string` | Yes | Session token |
| `options.limit` | `number` | No | Maximum messages to return (default: 40) |
| `options.before` | `string` | No | ISO datetime cursor — returns messages created before this timestamp (for pagination) |

**Returns:** `Promise<Array<message>>`

Each message object:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Message UUID |
| `body` | `string` | Message text, or file name for file messages |
| `sender_type` | `'guest' \| 'operator'` | Who sent the message |
| `message_type` | `'text' \| 'file'` | Message kind |
| `senderName` | `string \| null` | Operator display name (null for guest messages) |
| `senderAvatarUrl` | `string \| null` | Operator avatar URL (null for guest messages) |
| `metadata` | `object \| null` | For file messages: `{ attachmentId, fileName, mimeType, sizeBytes }` |
| `created_at` | `string` | ISO datetime |

**Example:**

```js
const messages = await sdk.guestChat.listMessages(token, { limit: 40 })
for (const msg of messages) {
  const side = msg.sender_type === 'guest' ? 'Tu' : (msg.senderName ?? 'Operador')
  console.log(`[${side}] ${msg.body}`)
}
```

---

### `sdk.guestChat.sendMessage(token, body, messageType?)`

**Description:** Sends a text message in the conversation.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `token` | `string` | Yes | Session token |
| `body` | `string` | Yes | Message text |
| `messageType` | `string` | No | Message type — defaults to `'text'` |

**Returns:** `Promise<{ messageId, createdAt }>`

**Example:**

```js
const result = await sdk.guestChat.sendMessage(token, 'Hola, necesito ayuda con mi pedido')
console.log('Mensaje enviado, ID:', result.messageId)
```

---

### `sdk.guestChat.sendFileMessage(token, options)`

**Description:** Presigns an upload URL, uploads the file to Supabase Storage, then sends a file message in the conversation. This is the recommended high-level method for file sharing.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `token` | `string` | Yes | Session token |
| `options.fileName` | `string` | Yes | Original file name |
| `options.mimeType` | `string` | Yes | File MIME type |
| `options.sizeBytes` | `number` | Yes | File size in bytes |
| `options.file` | `File \| Blob` | Yes | The file data to upload |

**Returns:** `Promise<{ messageId, createdAt }>`

**Example:**

```js
const fileInput = document.getElementById('adjunto')
const file = fileInput.files[0]
if (file) {
  await sdk.guestChat.sendFileMessage(token, {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    file,
  })
}
```

---

### `sdk.guestChat.presignAttachment(token, options)`

**Description:** Low-level method — requests a presigned upload URL for a file attachment. Use `sendFileMessage` instead unless you need direct control over the upload step.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `token` | `string` | Yes | Session token |
| `options.fileName` | `string` | Yes | Original file name |
| `options.mimeType` | `string` | Yes | MIME type |
| `options.sizeBytes` | `number` | Yes | File size in bytes |

**Returns:** `Promise<{ attachmentId, uploadUrl }>`

---

### `sdk.guestChat.subscribeToReplies(conversationId, onMessage)`

**Description:** Subscribes to real-time operator replies via Supabase Realtime broadcast. Opens a new Supabase client (separate from the auth client) with a non-persistent session so it does not interfere with the user's auth state.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `conversationId` | `string` | Yes | UUID returned by `createSession` |
| `onMessage` | `function(payload)` | Yes | Called for each incoming operator message |

The `payload` object:

| Field | Type | Description |
|---|---|---|
| `messageId` | `string` | UUID of the new message |
| `body` | `string` | Message text |
| `senderType` | `'operator'` | Always `'operator'` for broadcast events |
| `senderName` | `string \| null` | Operator display name |
| `senderAvatarUrl` | `string \| null` | Operator avatar URL |
| `createdAt` | `string` | ISO datetime |

**Returns:** `function` — call this to unsubscribe and close the channel

**Important:** If `supabaseUrl` and `supabaseAnonKey` were not provided to `createStorefrontClient`, this method returns a no-op unsubscribe function immediately.

**Example:**

```js
const unsubscribe = sdk.guestChat.subscribeToReplies(conversationId, (payload) => {
  console.log('Nuevo mensaje del operador:', payload.body)
  appendMessage({
    id: payload.messageId,
    body: payload.body,
    sender_type: payload.senderType,
    senderName: payload.senderName,
    created_at: payload.createdAt,
  })
})

// When navigating away or closing the chat
unsubscribe()
```

---

### `sdk.guestChat.closeSession(token)`

**Description:** Marks the conversation as closed. The token becomes invalid after this call.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `token` | `string` | Yes | Session token |

**Returns:** `Promise<void>`

**Example:**

```js
await sdk.guestChat.closeSession(token)
localStorage.removeItem('runly_chat_token')
showThankYouScreen()
```

---

### `sdk.guestChat.resumeByCode(trackingCode, email)`

**Description:** Resumes a previous conversation using the tracking code shown to the visitor (e.g. `"CHAT-000042"`) plus their email address. Use this for the "resume conversation" flow when a visitor returns from a different browser or device.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `trackingCode` | `string` | Yes | Tracking code from `createSession`. Case-insensitive — the SDK uppercases it automatically |
| `email` | `string` | Yes | Email address used when the conversation was started |

**Returns:** `Promise<{ token, conversationId, trackingCode }>`

Same shape as `createSession` — the new token replaces the old one.

**Errors thrown:**
- `NOT_FOUND` (404) — tracking code + email combination does not match any conversation
- `UNKNOWN` (409) — the conversation is already closed

**Example:**

```js
try {
  const session = await sdk.guestChat.resumeByCode('CHAT-000042', 'ana@ejemplo.mx')
  localStorage.setItem('runly_chat_token', session.token)
  const messages = await sdk.guestChat.listMessages(session.token)
  showChatScreen(messages)
} catch (err) {
  if (err.code === 'NOT_FOUND') {
    showError('No encontramos una conversacion con ese codigo y correo')
  }
}
```

---

### React: `useGuestChat(sdk)`

**Import:** `import { useGuestChat } from '@raulbellosom/runly-sdk/react'`

A stateful React hook that manages the complete guest chat lifecycle: availability check, session creation, session restore, message list, sending, real-time subscriptions, and close. Backed by `localStorage` for persistence across page reloads.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `sdk` | SDK client | Yes | The object returned by `createStorefrontClient`. Pass the singleton from your `src/sdk.js` |

**Return value:**

| Field | Type | Description |
|---|---|---|
| `screen` | `'welcome' \| 'identify' \| 'resume' \| 'chat'` | Current UI screen state |
| `setScreen` | `function(screen)` | Navigate between screens |
| `availability` | `{ available: boolean, agentsOnline: number } \| null` | Chat availability status. `null` while loading |
| `session` | `{ token, conversationId, email, name } \| null` | Active session, or `null` when no session |
| `trackingCode` | `string \| null` | Human-readable reference code for the active conversation |
| `messages` | `Array<message>` | All messages in the conversation, in chronological order |
| `isSending` | `boolean` | `true` while a send operation is in progress |
| `startError` | `string \| null` | Error message from the last `startSession` call, or `null` |
| `resumeError` | `string \| null` | Error message from the last `resumeByCode` call, or `null` |
| `startSession` | `async function(data?)` | Creates a new session. Accepts the same `data` object as `sdk.guestChat.createSession`. Sets `screen` to `'chat'` on success |
| `resumeByCode` | `async function(code, email)` | Resumes by tracking code. Sets `screen` to `'chat'` on success |
| `sendMessage` | `async function(body)` | Sends a text message. No-op if no session or empty body |
| `sendFile` | `async function(file)` | Sends a file. Accepts a `File` or `Blob` object |
| `closeSession` | `async function()` | Closes and clears the session. Resets to `screen: 'welcome'` |

**Screen flow:**

```
welcome → identify → [startSession] → chat
        → resume  → [resumeByCode] → chat
```

On mount the hook:
1. Fetches chat availability via `sdk.guestChat.getAvailability()`
2. Checks `localStorage` for a stored session token
3. If found, calls `sdk.guestChat.getSession(token)` to validate it
4. If the conversation is still open, restores messages and sets `screen: 'chat'`
5. If the conversation is closed, clears storage and starts at `screen: 'welcome'`

**Example:**

```jsx
import { useGuestChat } from '@raulbellosom/runly-sdk/react'
import { sdk } from './sdk.js'

function GuestChatPanel() {
  const {
    screen, setScreen, availability,
    session, trackingCode, messages,
    isSending, startError, resumeError,
    startSession, resumeByCode,
    sendMessage, sendFile, closeSession,
  } = useGuestChat(sdk)

  if (screen === 'welcome') {
    return (
      <div>
        {availability?.available
          ? <p>Hay {availability.agentsOnline} agente(s) disponibles</p>
          : <p>Sin agentes disponibles ahora</p>
        }
        <button onClick={() => setScreen('identify')}>Iniciar chat</button>
        <button onClick={() => setScreen('resume')}>Retomar conversacion</button>
      </div>
    )
  }

  if (screen === 'identify') {
    return (
      <IdentifyForm
        onSubmit={({ name, email }) =>
          startSession({ name, email, pageUrl: window.location.href })
        }
        error={startError}
      />
    )
  }

  if (screen === 'resume') {
    return (
      <ResumeForm
        onSubmit={({ code, email }) => resumeByCode(code, email)}
        error={resumeError}
      />
    )
  }

  // screen === 'chat'
  return (
    <div>
      <p>Referencia: {trackingCode}</p>
      <ul>
        {messages.map(msg => (
          <li key={msg.id} style={{ textAlign: msg.sender_type === 'guest' ? 'right' : 'left' }}>
            {msg.senderName && <strong>{msg.senderName}: </strong>}
            {msg.body}
          </li>
        ))}
      </ul>
      <button onClick={() => sendMessage('Hola')} disabled={isSending}>
        Enviar
      </button>
      <button onClick={closeSession}>Cerrar chat</button>
    </div>
  )
}
```

---

### React: `ChatWidget`

**Import:** `import { ChatWidget } from '@raulbellosom/runly-sdk/react'`

A fully styled, self-contained chat widget component built on top of `useGuestChat`. Renders as a floating action button in the bottom-right corner of the page. Handles all screens (welcome, identify, resume, chat) and supports text messages, file attachments, availability display, and operator reply indicators. Uses inline styles only — no external CSS required.

**Props:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `sdk` | SDK client | Yes | — | The object returned by `createStorefrontClient` |
| `companyName` | `string` | No | `'Chat'` | Company or brand name shown in the widget header |
| `accentColor` | `string` | No | `'#c7f049'` | Hex color for the primary action button and accents |

**Example:**

```jsx
import { ChatWidget } from '@raulbellosom/runly-sdk/react'
import { sdk } from './sdk.js'

export default function App() {
  return (
    <>
      {/* Your app content */}
      <ChatWidget
        sdk={sdk}
        companyName="Soporte Runly"
        accentColor="#6366f1"
      />
    </>
  )
}
```

The widget:
- Shows a floating button when `availability.available` is `true`
- Hides automatically when the chat service is offline
- Shows a session restore flow when a stored session is found
- Plays a soft audio beep when an operator reply arrives
- Renders inline file attachments for file messages
- Groups messages by date (Hoy / Ayer / day-month)
- Shows the tracking code (`CHAT-XXXXXX`) in the header for support reference

No routing, global state, or CSS imports are required. Mount it once at the root of your app.
