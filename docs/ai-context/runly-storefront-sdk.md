# Runly Storefront SDK - AI Context Reference

Migration: `@raulbellosom/runly-sdk` is the new local package name. Publish it before switching external npm installations; existing `@raulbellosom/atlas-sdk` consumers remain compatible.


This document is the canonical integration reference for public Atlas websites:

- npm package `@raulbellosom/runly-sdk` in `packages/storefront-sdk`
- browser IIFE `/atlas-sdk.js` in `apps/api/src/public/atlas-sdk.js`
- runtime config `window.ATLAS_CONFIG`
- Website Builder and uploaded `dist` sites
- public capture API v1

## Architecture

`atlas.website` owns site publication, form definitions, and form configuration.
`atlas.growth` owns visitors, sessions, events, leads, activities, and daily metrics.

Both Builder and `dist` use the same public endpoints and capture semantics. Do not add
new public form submission paths or analytics implementations outside these clients.

## Runtime config

Atlas makes this public config available before loading the IIFE:

```js
window.ATLAS_CONFIG = {
  apiUrl: "https://erp.example.com",
  company: "my-company",
  siteId: "019...",
  siteName: "My Site",
  analyticsMode: "consent_required", // off | anonymous | consent_required
  turnstileSiteKey: "public-key",    // optional; secret is never exposed
  supabaseUrl: "https://supabase.example.com",
  supabaseAnonKey: "<anon-key>",
  storageKey: "sb-<project>-auth-token",
  stripePublishableKey: "pk_...",    // optional
  currency: "mxn"
}
```

Uploaded `dist` HTML receives both `window.ATLAS_CONFIG` and
`<script src="/atlas-sdk.js" defer></script>` automatically.

The Builder runtime receives the equivalent config from
`GET /public/website/resolve` and loads the same IIFE.

## npm SDK 0.4.7

```js
import { createStorefrontClient } from '@raulbellosom/runly-sdk'

const cfg = (typeof window !== 'undefined' && window.ATLAS_CONFIG) ? window.ATLAS_CONFIG : {}

export const sdk = createStorefrontClient({
  baseUrl: cfg.apiUrl ?? import.meta.env.VITE_ERP_URL,
  company: cfg.company ?? import.meta.env.VITE_ERP_COMPANY,
  siteId: cfg.siteId,
  supabaseUrl: cfg.supabaseUrl ?? import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey:
    cfg.supabaseAnonKey ?? import.meta.env.VITE_SUPABASE_ANON_KEY,
})
```

Create one client singleton. The returned frozen object contains:

- `auth`
- `files`
- `catalog`
- `discovery`
- `realtime`
- `analytics`
- `forms`
- `guestChat`
- `request`

React exports include:

- `StorefrontProvider`
- `useAuth`, `useSession`
- `useAnalytics`, `usePageView`
- `usePublicForm`
- `useGuestChat`, `ChatWidget`
- existing catalog, files, discovery, config, and request hooks

## Unified auth session

The npm SDK uses `@supabase/supabase-js`. The npm SDK and IIFE share the same
`sb-<project>-auth-token` localStorage session.

Use `user.hasErpAccess`, not hardcoded role names, when deciding whether a user may
navigate to `/app`.

```js
const { user } = await sdk.auth.login({ email, password })
if (user?.hasErpAccess) {
  window.location.href = window.ATLAS_CONFIG?.apiUrl ?? '/'
}
```

## Catalog (sdk.catalog)

Available whenever `runly.catalog` is installed and enabled. Read-only, no auth — backed by
`GET /public/catalog/{categories,products,products/:idOrSlug}`
(`apps/api/src/routes/public-website.js` → `catalog-public-service.js`).

```js
const { data, total } = await sdk.catalog.products({ limit: 20, offset: 0, search: 'zapato', categorySlug: 'calzado' })
const product = await sdk.catalog.getProduct(data[0].slug) // accepts slug or id
const { data: categories } = await sdk.catalog.categories() // full tree, one level of children
```

Query params are `limit`, `offset`, `search` (name `ILIKE`), `categorySlug` — there is no
`page`, `categoryId`, `sort`, or `order` on this endpoint. `categories()` takes no params and
always returns the whole enabled tree. `getProduct` resolves by `slug` first, falling back to
`id`, since product lists only expose `slug` for linking. The public projection never includes
`company_id`, `sku`, `barcode`, `meta_title`, or `meta_description`.

## Capture API v1

Public endpoints:

- `GET /public/storefront/v1/config`
- `POST /public/storefront/v1/events/batch`
- `GET /public/storefront/v1/forms/:formId`
- `POST /public/storefront/v1/forms/:formId/submissions`

Normal scope headers:

- `X-Atlas-Company`
- `X-Atlas-Site` when known

The event endpoint also accepts `company` and `siteId` query parameters for
`navigator.sendBeacon`, because beacon cannot send custom headers.

Limits:

- maximum 50 events per batch
- maximum 64 KB body
- bounded rate limits
- `Idempotency-Key` required for form submissions

The deprecated adapter `POST /public/website/forms/:formId/submit` delegates to v1.
Removal is planned for 0.4.0, not before September 30, 2026.

## Analytics contract

```js
await sdk.analytics.start()
sdk.analytics.setConsent('granted')
sdk.analytics.page()
sdk.analytics.track('pricing_cta', { placement: 'hero' })
await sdk.analytics.flush()
sdk.analytics.stop()
```

Privacy and behavior:

- DNT always prevents analytics.
- `consent_required` creates no visitor/session IDs before consent.
- `setConsent('denied')` clears queued events and local analytics IDs.
- sessions rotate after 30 minutes of inactivity.
- sessions become engaged after 10 visible seconds, two pageviews, or conversion.
- raw IP is never stored.
- event properties allow at most 20 scalar keys.
- PII, auth data, nested values, messages, and form values are rejected.
- `formId` and `submissionId` use structured event columns.
- raw events retain 90 days.
- sessions and daily metrics retain 25 months.

Automatic capture is limited to:

- `page_view`
- `visible_time`
- form lifecycle
- elements with `data-atlas-event`

```html
<button
  data-atlas-event="pricing_cta"
  data-atlas-label="Plan profesional"
  data-atlas-placement="hero"
>
  Cotizar
</button>
```

Never add automatic capture for arbitrary input values or element text.

## Public forms

```js
const form = await sdk.forms.get(formId)

const result = await sdk.forms.submit(formId, values, {
  idempotencyKey: crypto.randomUUID(),
  turnstileToken,
  honeypot: '',
})
```

Submission values go only to the form submission endpoint. Analytics events contain
form/submission identifiers but never submitted values.

The server validates enabled fields, honeypot, optional Turnstile, origin, body size,
idempotency, and company/site isolation. A lead is created or an eligible open lead is
reused when `createsLead` is enabled.

## IIFE surface

```js
window.AtlasERP = {
  config,
  auth: {
    getSession,
    getToken,
    signIn,
    signOut,
    onAuthStateChange,
  },
  analytics: {
    start,
    page,
    track,
    setConsent,
    getConsent,
    flush,
    stop,
  },
  renderLogin,
  renderForm,
}
```

Embedded form:

```js
window.AtlasERP.renderForm('#contacto', {
  formId,
  theme: 'auto',
  labels: {
    button: 'Enviar',
    success: 'Gracias',
  },
  onSuccess(result) {
    console.log(result.submissionId)
  },
  onError(error) {
    console.error(error)
  },
})
```

The widget uses `_ae-` CSS classes, accessible labels/status, honeypot, optional
Turnstile, and the v1 submission endpoint.

## Builder integration

`ContactFormBlock` must not define its own fields or submission transport. It mounts
`window.AtlasERP.renderForm` through `ContactFormRenderer.jsx`.

This ensures Builder, plain HTML, and uploaded `dist` sites share:

- public form metadata
- validation
- consent and analytics behavior
- antispam and Turnstile
- idempotency
- lifecycle event names

## Operational retention

`createGrowthRetentionWorker` runs at worker startup and hourly by default.
`ATLAS_GROWTH_RETENTION_INTERVAL_MS` overrides the interval.

It aggregates complete UTC days into `GrowthDailyMetric`, stores a global watermark,
and purges in bounded batches. It never purges leads or form submissions.

## Guest chat (sdk.guestChat)

Available when `atlas.chat` is installed. Requires `supabaseUrl` + `supabaseAnonKey` for
real-time reply subscriptions; the other methods work without them.

```js
// Check availability before showing the widget
const { available, agentsOnline } = await sdk.guestChat.getAvailability()

// Start a session (name/email optional for anonymous mode)
const { token, conversationId, trackingCode } = await sdk.guestChat.createSession({
  name: 'Ana Garcia',
  email: 'ana@ejemplo.mx',
  pageUrl: window.location.href,
})

// List history
const messages = await sdk.guestChat.listMessages(token, { limit: 40 })

// Send text
await sdk.guestChat.sendMessage(token, 'Hola, necesito ayuda')

// Send file (presign + upload + message in one call)
await sdk.guestChat.sendFileMessage(token, { fileName, mimeType, sizeBytes, file })

// Real-time operator replies (returns unsubscribe fn)
const unsub = sdk.guestChat.subscribeToReplies(conversationId, (payload) => {
  appendMessage(payload)
})

// Resume from a different device
const resumed = await sdk.guestChat.resumeByCode('CHAT-000042', 'ana@ejemplo.mx')

// Close
await sdk.guestChat.closeSession(token)
```

**guestChat methods:**

| Method | Endpoint | Description |
|---|---|---|
| `getAvailability()` | `GET /public/storefront/chat/availability` | Check if operators are online |
| `createSession(data?)` | `POST /public/chat/session` | Open a new conversation |
| `getSession(token)` | `GET /public/chat/session/:token` | Validate / restore a stored session |
| `listMessages(token, opts?)` | `GET /public/chat/session/:token/messages` | Message history (newest last) |
| `sendMessage(token, body)` | `POST /public/chat/session/:token/messages` | Send text |
| `sendFileMessage(token, opts)` | presign + PUT + `POST messages` | Upload file and send as message |
| `presignAttachment(token, opts)` | `POST /public/chat/session/:token/attachments/presign` | Low-level: get upload URL only |
| `subscribeToReplies(convId, fn)` | Supabase Realtime broadcast | Returns unsubscribe fn |
| `resumeByCode(code, email)` | `POST /public/chat/session/resume-by-code` | Resume from tracking code |
| `closeSession(token)` | `POST /public/chat/session/:token/close` | Mark conversation closed |

**React:** `useGuestChat(sdk)` manages the full lifecycle (availability, session restore, messages, realtime). Returns `{ screen, setScreen, availability, session, trackingCode, messages, isSending, startError, resumeError, startSession, resumeByCode, sendMessage, sendFile, closeSession }`.

`<ChatWidget sdk={sdk} companyName="..." accentColor="#..." />` is a drop-in fully-styled floating widget built on `useGuestChat`. Import from `@raulbellosom/runly-sdk/react`.

## Verification

Relevant commands:

```bash
node --test packages/storefront-sdk/src/__tests__/*.test.js
node --test apps/api/src/public/__tests__/atlas-sdk.test.js
node --test apps/api/src/routes/storefront/__tests__/storefront-capture-routes.test.js
node --test apps/api/src/services/__tests__/storefront-capture-service.test.js
node --test apps/api/src/services/__tests__/growth-retention-worker.test.js
pnpm --filter @runly/desktop build:web
```
