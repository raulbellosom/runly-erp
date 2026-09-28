# Plan: Module public links — phase 1 (platform)

Spec: `docs/superpowers/specs/2026-09-28-module-public-links-design.md`
Date: 2026-09-28
Status: Draft (pending approval)

Tasks are grouped into three batches that can each be done by one agent.
Batch A must land before B and C; B and C are independent.

## Batch A — Contract and storage

- [ ] A1. `packages/module-engine/src/public-resources-manifest.js`: `validatePublicResources(manifest, errors)`
  per spec section 2; call it from `validateManifest` in `define-module.js`; export from `index.js`.
  Needs access to the module's views/models/permissions — if `validateManifest` only sees the
  manifest, do the view/model cross-checks at sync time in `module-lifecycle-service.js` instead
  and keep shape checks in the engine.
- [ ] A2. Test `packages/module-engine/src/__tests__/public-resources-manifest.test.js` (valid, bad mode,
  duplicate key, unknown permission, >20).
- [ ] A3. Prisma: add `ModulePublicLink` (spec section 3) with relations on `Company` and `UserProfile`;
  create a new forward migration (`pnpm db:migrate`), `pnpm db:generate`.
- [ ] A4. Zod schemas in `packages/validators`: `modulePublicLinkCreateSchema`.
- [ ] A5. Move `createTokenBucketLimiter` to `apps/api/src/lib/token-bucket-limiter.js`; storefront
  re-imports it (no behavior change; storefront tests still pass).

## Batch B — API

- [ ] B1. `apps/api/src/services/module-public-links-service.js` inside `createModulePublicLinksService({ prisma })`:
  `list`, `create` (token via `crypto.randomBytes(32).toString('base64url')`), `revoke`,
  `resolveByToken`, `reserveUse`, `releaseUse`, `recordUse`, `statusOf`.
- [ ] B2. `apps/api/src/routes/module-public-links-routes.js`: admin endpoints (spec 4.1) with dynamic
  `managePermission` check and AuditLog; mount under the authenticated `/modules` router.
- [ ] B3. Route Loader: also import optional `modules/custom/<key>/api/public.js` and keep a
  `publicRouters` map refreshed on the same lifecycle events as the normal routers.
- [ ] B4. `apps/api/src/routes/module-public-gateway.js`: pipeline of spec 4.2 (rate limit, resolve,
  method gate, 64 KB JSON + honeypot, use reservation, `_context`, delegation with `publicLink`).
  Mount in `index.js` next to the other `/public/*` routers, path-scoped only; add to the `/public`
  endpoint index.
- [ ] B5. Module lifecycle cleanup: uninstall revokes, reset deletes the module's links.
- [ ] B6. Tests `apps/api/src/routes/__tests__/module-public-gateway.test.js` and
  `module-public-links-routes.test.js` with a fake prisma/service (spec section 11 cases).

## Batch C — Frontend, SDK, docs

- [ ] C1. SDK `client.modules.publicLinks.list|create|revoke`.
- [ ] C2. `@runly/ui`: `PublicLinkFrame`, `ShareLinkDialog`, `PublicLinksPanel` (add `qrcode` dep), export
  from `index.js`, document in `docs/ai-context/rme3-runtime-capabilities.md`.
- [ ] C3. `PublicModuleOutlet`: prefix + token matching, `_context` fetch, 404/410 `EmptyState`, new props.
  Confirm custom module bundles load without a session.
- [ ] C4. `docs/ai-context/rme3-public-links.md`; sections in `AGENTS.md` and the module ZIP guide.

## Verification

- [ ] `node --test packages/module-engine/src/__tests__/` and the new API tests pass.
- [ ] `pnpm lint` and `pnpm build:web` pass.
- [ ] Real check against the running dev API (do not start/stop it): wire `custom.encuestas`
  (manifest resource + `api/public.js` + public view), create a link, answer the survey from a
  private window, verify `use_count`, revoke and get 410, exceed `max_uses` and get 410.
