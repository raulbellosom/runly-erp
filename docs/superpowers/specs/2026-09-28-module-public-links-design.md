# Module public links (enlaces y páginas públicas)

Date: 2026-09-28
Status: Approved design (product owner)
Plans: `docs/superpowers/plans/2026-09-28-module-public-links-phase1.md` (platform),
phase 2 plan (Builder) to be written after phase 1 ships.

## 1. Goal

Let any RME3 module expose a record or a form to people without a Runly session
(answer a survey, view an order status, submit a request) through a link the
company creates, shares, and can revoke. Runly owns the link lifecycle and all
public-access security (token, expiry, revocation, use limits, rate limit, body
size, honeypot); the module only declares what can be exposed and implements
the public handlers. No module reinvents link security.

Delivery:
- Phase 1 (platform): sections 2-6 and 8. Usable from code (e.g. `custom.encuestas`).
- Phase 2 (Builder): section 7.

## 2. Module declaration

`module.manifest.js` gains an optional `publicResources` array:

```js
publicResources: [
  {
    key: 'encuesta.responder',          // /^[a-z][a-z0-9_.-]{1,63}$/, unique per module
    entity: 'encuesta',                 // optional; model key the link may point at
    mode: 'submit',                     // 'view' | 'submit'
    view: 'encuestas.responder-publica',// key of a CUSTOM view in this module with schema.public: true
    title: 'Responder encuesta',        // Spanish, shown in the share panel
    managePermission: 'encuestas.encuesta.update', // must be declared by this module
  },
]
```

- `mode: 'view'`: read-only (record card, catalog, order status). Only `GET` reaches the module.
- `mode: 'submit'`: `GET` plus `POST`/`PUT`/`PATCH` for sending data.
- Validation lives in `packages/module-engine/src/public-resources-manifest.js`
  (same shape as `ai-manifest.js`), called from `validateManifest`. Errors: bad
  key, duplicate key, unknown mode, `view` not a public CUSTOM view of the
  module, `entity` not a model of the module, `managePermission` not declared by
  the module, more than 20 resources.

## 3. Link storage (core)

New Prisma model `ModulePublicLink` (table `module_public_link`), modeled on `CallLink`:

| Column | Notes |
|---|---|
| `id` | uuid v7 |
| `company_id` | FK Company |
| `module_key` | module that owns the resource |
| `resource_key` | `publicResources[].key` |
| `record_id` | uuid, nullable (link bound to one record, e.g. an Encuesta) |
| `token` | unique, 32 random bytes base64url (`crypto.randomBytes`); stored in clear like `CallLink.token` so the panel can re-copy the link and redraw the QR |
| `mode` | copied from the resource at creation (`view`/`submit`) |
| `label` | optional, for the admin list |
| `expires_at` | nullable |
| `max_uses` | nullable; counts successful submits (view links never consume uses) |
| `use_count` | default 0 |
| `last_used_at` | nullable |
| `revoked_at` | nullable |
| `created_by_user_id` | FK UserProfile |
| `created_at`, `updated_at` | |

Indexes: `(company_id, module_key, resource_key)`, `(company_id, module_key, record_id)`.
New forward migration only. Uninstalling a module revokes its links
(module cleanup registry); reset deletes them.

## 4. API

### 4.1 Admin (session required) — `apps/api/src/routes/module-public-links-routes.js`

Mounted under the authenticated `/modules` router. Permission check is dynamic:
the caller needs the resource's `managePermission` (the module must be
installed and enabled; unknown resource -> 404).

- `GET /modules/:key/public-links?resource=&recordId=` -> `{ data: [link] }`
  where `link = { id, resourceKey, recordId, mode, label, url, expiresAt, maxUses, useCount, lastUsedAt, revokedAt, status, createdAt }`
  and `status` is `activo | vencido | agotado | revocado`. `url` is the public
  page URL (section 5), built from the instance's public web base URL.
- `POST /modules/:key/public-links` body `{ resource, recordId?, label?, expiresAt?, maxUses? }`
  (Zod in `packages/validators`). `recordId` required when the resource declares
  `entity`. `maxUses` 1..100000, `expiresAt` in the future. Returns the link.
- `POST /modules/:key/public-links/:id/revoke` -> sets `revoked_at`. Idempotent.

All three write `AuditLog` entries (`module_public_link.create|revoke`).

### 4.2 Public (no session) — `/public/m/:moduleKey/:token/*`

A dedicated router (`apps/api/src/routes/module-public-gateway.js`), mounted
with path-scoped middleware only (never a root `use("*")`, see the load-bearing
note in `apps/api/src/index.js`). Pipeline per request:

1. Rate limit per `ip + token` with `createTokenBucketLimiter` (moved to
   `apps/api/src/lib/token-bucket-limiter.js`; storefront imports it from
   there). Default 30 requests burst, 1 per 2 s refill for `GET`; 5 burst,
   1 per 10 s for writes. Over limit -> 429.
2. Resolve the link by token. Unknown token or module not installed/enabled -> 404
   `{ error: 'Enlace no disponible' }`. Revoked, expired, or `use_count >= max_uses` -> 410
   with the same generic message plus `reason` (`revocado|vencido|agotado`).
3. Method gate: `view` links allow only `GET`/`HEAD` (else 405).
4. Writes: `Content-Length` / streamed body capped at 64 KB (413). JSON only in
   v1 (415 otherwise). The core parses the body once, rejects a non-empty
   honeypot field `_hp` by answering `200 { ok: true }` without calling the
   module, strips `_hp`, and exposes the parsed body as `c.get('publicBody')`.
5. Use reservation for writes on links with `max_uses`: atomic
   `UPDATE ... SET use_count = use_count + 1 WHERE id = ? AND use_count < max_uses AND revoked_at IS NULL RETURNING id`.
   No row -> 410 `agotado`. If the module answers non-2xx, the reservation is
   released (`use_count - 1`). Links without `max_uses` increment after a 2xx.
   `last_used_at` is set on every successful write.
6. Delegate to the module's public router with
   `c.get('publicLink') = { id, companyId, moduleKey, resource, recordId, mode }`.
   The path seen by the module is the remainder after the token.

Core-served endpoint, before delegation:
`GET /public/m/:moduleKey/:token/_context` -> `{ resource: { key, title, mode }, recordId, expiresAt, company: { name, logoUrl } }`.
`logoUrl` is a short-lived signed URL (existing signed-url helper). Never
exposes company id, user data, or use counts.

### 4.3 Module public routes — `api/public.js`

Optional file, separate from `api/index.js` so normal routes are never exposed
by accident. Loaded by the Route Loader (`route-loader-service.js`) the same
way as `api/index.js`: default export `createPublicRouter({ prisma, ... })`
returning a Hono app. A module with `publicResources` but no `api/public.js`
still works for `_context` but every other public path returns 404.

Module rules (documented, and checked in the ZIP guide):
- Scope every query by `publicLink.companyId`; when `publicLink.recordId` is set,
  only read/write data belonging to that record.
- Branch on `publicLink.resource` when a module has several resources.
- Return only explicitly chosen fields; never `SELECT *` to the client.
- Validate `c.get('publicBody')` with the module's Zod validators.

## 5. Public page (frontend)

- The resource's `view` is a CUSTOM view with `schema.public: true` and a
  `schema.path` under `/p/` (existing rule in `define-view.js`), e.g.
  `/p/encuestas/responder`. The link URL is `<view path>/<token>`.
- `PublicModuleOutlet` changes: match a public view whose path is a prefix of
  the location followed by exactly one extra segment (the token); exact matches
  keep today's behavior. When a token is present it fetches `_context`, shows
  `EmptyState` "Enlace no disponible" on 404/410, and renders the component with:
  `{ navigate, moduleKey, linkToken, apiBaseUrl, publicLink }` where
  `apiBaseUrl = <api>/public/m/<moduleKey>/<token>` and `publicLink` is the
  `_context` payload (company name/logo for branding).
- A small `PublicLinkFrame` in `@runly/ui` renders the company header (logo +
  name), content slot, and a "Con tecnología de Runly" footer; public
  components are expected to use it.
- Module component bundles must be loadable without a session (verify the
  public bundle path already used by `PublicModuleOutlet`; fix if it requires auth).

## 6. Share UI in `@runly/ui`

- `PublicLinksPanel({ moduleKey, resource, recordId, client })`: list of links
  (label, status badge, uses `3 / 50`, expiry), actions copy, QR, revoke
  (`ConfirmDialog`), and a "Crear enlace" button.
- `ShareLinkDialog`: `Dialog` with label, expiry (`DatePickerField`, optional),
  max uses (optional), then shows the URL with copy and QR. QR uses a
  lightweight dependency (`qrcode` SVG output) added to `@runly/ui`.
- SDK: `client.modules.publicLinks.list|create|revoke`.
- Both documented in `docs/ai-context/rme3-runtime-capabilities.md`.

## 7. Builder (phase 2, no code)

Per entity, "Compartir por enlace" with two modes:
- **Ficha pública** (`view`): the author picks the visible fields.
- **Formulario público** (`submit`): creates a record in a target entity, optionally
  linked to the shared record through a relation field (a Respuesta linked to its Encuesta).

Rules: an explicit field allowlist, never "all" by default. v1 excludes file
fields and internal/system fields; relations show only their display name.
The compiler generates the `publicResources` entry, `api/public.js` (select /
insert over the allowlist only), and the public CUSTOM view using the existing
renderer inside `PublicLinkFrame`. The record detail gets a "Compartir" button
opening `PublicLinksPanel`.

## 8. Documentation

- New `docs/ai-context/rme3-public-links.md` "Enlaces y páginas públicas": code
  recipe (manifest, `api/public.js`, public view), security rules from 4.3,
  status codes, common problems.
- Sections in `AGENTS.md`, the module ZIP guide, and a Builder help article (phase 2).

## 9. Security summary

Token entropy 256 bits; generic error bodies; per-IP+token rate limit; 64 KB
JSON-only bodies; honeypot; atomic use accounting; view links are read-only at
the gateway; module normal routes never mounted publicly; company scoping
enforced by passing `companyId` from the link, never from the request.
Captcha is out of scope for v1.

## 10. Out of scope

Captcha, file uploads through public links, public list/search across records,
per-link custom branding, email delivery of links, analytics beyond use count.

## 11. Tests (lean)

- module-engine: `publicResources` validation cases.
- gateway: unknown/revoked/expired/exhausted token, view-mode 405, 413, honeypot,
  use reservation release on module error, `_context` shape.
- admin routes: permission check against `managePermission`, create/revoke.
