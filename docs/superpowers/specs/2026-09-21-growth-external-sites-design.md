# Growth external-site connections — design

Date: 2026-09-21
Status: approved (user directed rapid decide-and-build; see conversation)

## Problem

`runly.growth` (analytics + lead capture) currently requires `runly.website` to be
installed, because:

1. Its manifest lists `runly.website` as a hard (non-optional) dependency.
2. `growth-analytics-service.js` (`listSites`, `assertSite`) and
   `storefront-capture-service.js` (`resolveSite`) resolve "which site is this
   request for" by querying the `WebsiteSite` Prisma table directly.

This blocks a real use case: an ERP company that does not want to run its
marketing site through `runly.website` (e.g. it already has an external site
built elsewhere), but wants Growth's analytics, lead capture, and live chat
wired to that external site via the storefront SDK
(`@raulbellosom/runly-sdk`, npm; embeddable `runly-sdk.js`, served at
`/public/site/runly-sdk.js`).

It should also be possible to have *both* — a `runly.website`-managed site
and one or more externally-hosted sites connected via SDK — for the same
company, and switch between them when looking at Growth analytics/leads,
similar to (but independent of) the company switcher.

## Non-goals

- Renaming the SDK. `packages/storefront-sdk` is already published as
  `@raulbellosom/runly-sdk`; `atlas-sdk.js` / `window.AtlasERP` /
  `window.ATLAS_CONFIG` are intentional legacy aliases for already-published
  external sites and must keep working unchanged.
- Building a form designer for external sites. `WebsiteForm` (schema-driven,
  server-validated forms) stays a `runly.website` feature. External sites get
  raw lead-capture (a `form_submit`/`lead_created`/etc. event carrying
  name/email/phone/message directly in its payload), which already creates a
  `GrowthLead` today with no `WebsiteForm` involved.
- Changing guest chat. `guest-service.js` / `chat-external-inbox-service.js`
  are already company-scoped, not site-scoped, and already work for any SDK
  site. No changes needed.
- A DNS/meta-tag domain-ownership verification flow. Verification means "we
  received at least one real event from this property," consistent with the
  existing origin-allowlist security model (`site.domain` vs request Origin).

## Design

### 1. `GrowthProperty` — unified site identity, owned by `runly.growth`

New Prisma model, replacing `WebsiteSite` as the thing Growth's `siteId`
columns conceptually point at (those columns have no DB-level FK today, so
this is additive, not a breaking migration):

```prisma
model GrowthProperty {
  id                 String    @id @default(uuid(7)) @db.Uuid
  companyId          String    @db.Uuid @map("company_id")
  kind               String    @default("external_sdk") @map("kind") // "website_module" | "external_sdk"
  websiteSiteId      String?   @db.Uuid @map("website_site_id")
  name               String
  domain             String?
  status             String    @default("active") @map("status") // pending_verification | active | disabled
  analyticsMode      String    @default("standard") @map("analytics_mode")
  turnstileSiteKey   String?   @map("turnstile_site_key")
  turnstileSecretKey String?   @map("turnstile_secret_key")
  capabilities       Json?     @map("capabilities") // { analytics, forms, chat }
  verifiedAt         DateTime? @map("verified_at")
  enabled            Boolean   @default(true)
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")

  @@unique([companyId, websiteSiteId])
  @@index([companyId, enabled])
  @@index([companyId, domain])
  @@map("growth_property")
}
```

Owned by `runly.growth` (added to `ownedEntities`/`ownedTables` in its
manifest lifecycle block), like `GrowthLead` etc.

### 2. Lazy, self-healing mirroring for `website_module` properties

No backfill migration script, no cross-module write from `runly.website`
into `runly.growth` (keeps the modules decoupled — `website` never needs to
know `growth` exists). Instead, `growth-property-service.js` exposes
`resolveProperty({ companyId, propertyId })`:

1. Look up `GrowthProperty` by `(companyId, id: propertyId)`. Return if found.
2. Else, look up `WebsiteSite` by `(companyId, id: propertyId)`. If found,
   upsert a mirrored `GrowthProperty` (`kind: "website_module"`,
   `websiteSiteId: propertyId`, copying name/domain/analyticsMode/turnstile
   keys) and return it.
3. Else 404.

This is the same "self-healing" shape used for FCM token sync
(`fix: make FCM token sync self-healing`, 2026-09-21) — first read/write
after install (or after a new `WebsiteSite` is created) transparently
creates the mirror. `listProperties({ companyId })` unions existing
`GrowthProperty` rows with any `WebsiteSite` rows not yet mirrored (same
upsert-on-read, applied to the full list) so the property list is always
complete without a sync job.

### 3. Manifest change

`apps/api/src/manifests/official/feature-modules.js`, `runlyGrowthManifest`:

```js
dependencies: [
  { key: "runly.core" },
  { key: "runly.website", optional: true },
  { key: "runly.contacts" },
],
```

`packages/core/src/module-registry.js#assertDependencies` already honors
`optional`, no core change needed. `ownedEntities`/`ownedTables` gain
`GrowthProperty` / `growth_property`. New permission
`growth.properties.manage` added to `permission-catalog.js` and the
manifest's `permissions` block.

### 4. API surface

New `apps/api/src/routes/growth/growth-property-routes.js`, mounted in
`growth-router.js`:

- `GET /growth/properties` — list (internal + external, mirrored on read).
- `POST /growth/properties` — create an `external_sdk` property
  (`name`, `domain`) → `status: "pending_verification"`.
- `PATCH /growth/properties/:id` — rename/disable/update domain.
- `POST /growth/properties/:id/verify` — checks for at least one
  `GrowthEvent` with that `siteId` since creation; flips status to
  `"active"` and sets `verifiedAt` if found, else returns `verified: false`.

Permission gate: `growth.properties.manage` for write endpoints,
`growth.access` for read.

### 5. Repoint existing site-resolution call sites

- `growth-analytics-service.js`: `listSites` → `growthPropertyService.listProperties`;
  `assertSite` → `growthPropertyService.assertProperty` (same 404 semantics,
  new backing table). Route paths (`/growth/analytics/sites`) stay the same
  to minimize blast radius on the frontend query keys already in use.
- `storefront-capture-service.js`: `resolveSite` resolves via
  `growthPropertyService.resolveProperty` instead of
  `prisma.websiteSite.findFirst`. `getPublicConfig`/`captureEvents`/form
  endpoints keep their existing shape (they already pass through `site.id`,
  `site.domain`, `site.analyticsMode`, `site.turnstileSiteKey` — same fields
  now sourced from `GrowthProperty`). Form-submission endpoints
  (`getPublicForm`/`submitForm`) are unchanged and continue to require a
  `WebsiteForm` (i.e., the website module) — that limitation is intentional
  per Non-goals.

### 6. Frontend — connect wizard + properties screen

`GrowthAnalyticsScreen.jsx` already has a "Sitio" filter (`SelectField`,
URL-persisted via `?siteId=`) backed by `GET /growth/analytics/sites`. Once
that endpoint is repointed at `GrowthProperty` (section 5), the dropdown
transparently gains external SDK sites alongside website-module ones — no
frontend change needed there. This also means the "switch between
properties without switching company" requirement is already met by that
existing, URL-shareable filter; a second, parallel global-context switcher
(`localStorage`-backed, company-switcher-style) would duplicate that state
for no added capability, so it is deliberately not built.
`GrowthLeadsScreen.jsx` has no site filter today; adding one is out of scope
for this change (leads aren't currently filterable by site anywhere in the
product).

What *is* new:

- `ConnectExternalSiteDialog.jsx` — `@runly/ui` `Dialog`, two steps:
  1. `TextField`s for name + domain → `POST /growth/properties`.
  2. Show the embed snippet (same script tag already used by
     `runly.website` published `dist` sites, pointed at the new property's
     id as `siteId`), with a copy-to-clipboard button and a "Verificar
     conexión" button that calls the `verify` endpoint.
- New nav screen `GrowthPropertiesScreen.jsx` ("Sitios conectados") —
  `DataTable` listing all properties with status/kind badges and the
  connect wizard entry point. Added to the Growth module's `navigation`
  array.

### Error handling

- `resolveProperty`/`assertProperty` 404 with the existing
  `StorefrontCaptureError`/`GrowthAnalyticsServiceError` shapes — no new
  error types.
- Creating an `external_sdk` property with a `domain` that collides with an
  existing enabled property for the same company → 409 (reuse the pattern
  from other uniqueness checks in `growth-lead-service.js`).
- `verify` on an already-active property is idempotent (returns
  `verified: true` without re-checking).

### Testing

Per project convention (`node --test`, no framework), lean coverage only:

- `growth-property-service.test.js` — `resolveProperty` mirrors a
  `WebsiteSite` on first call and reuses it on the second; 404 when neither
  exists; `createExternalProperty` + `verifyProperty` happy path.
- Extend `growth-analytics-service.test.js` / `storefront-capture-routes.test.js`
  minimally to confirm they resolve against `GrowthProperty` now (adjust
  existing fixtures rather than adding a large new suite).
- No new frontend test suite — verified manually per the UI-first checklist
  is out of scope for a token-conscious pass; note this explicitly rather
  than skipping silently.

## Migration

One new Prisma migration adding `growth_property` (plus the two manifest
permission/dependency edits, which are data seeded via `prisma/seed.js` on
next `db:seed`/`db:fresh`, not a migration).
