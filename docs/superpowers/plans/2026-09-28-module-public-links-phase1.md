# Plan: Module public links — phase 1 (platform)

Spec: `docs/superpowers/specs/2026-09-28-module-public-links-design.md`
Date: 2026-09-28
Status: Implemented 2026-09-28 (end-to-end check with custom.encuestas pending)

Tasks are grouped into three batches that can each be done by one agent.
Batch A must land before B and C; B and C are independent.

## Batch A — Contract and storage

- [x] A1. `packages/module-engine/src/public-resources-manifest.js`: `validatePublicResources(manifest, errors)`
  per spec section 2; call it from `validateManifest` in `define-module.js`; export from `index.js`.
  Needs access to the module's views/models/permissions — if `validateManifest` only sees the
  manifest, do the view/model cross-checks at sync time in `module-lifecycle-service.js` instead
  and keep shape checks in the engine.
- [x] A2. Test `packages/module-engine/src/__tests__/public-resources-manifest.test.js` (valid, bad mode,
  duplicate key, unknown permission, >20).
- [x] A3. Prisma: add `ModulePublicLink` (spec section 3) with relations on `Company` and `UserProfile`;
  create a new forward migration (`pnpm db:migrate`), `pnpm db:generate`.
- [x] A4. Zod schemas in `packages/validators`: `modulePublicLinkCreateSchema`.
- [x] A5. Move `createTokenBucketLimiter` to `apps/api/src/lib/token-bucket-limiter.js`; storefront
  re-imports it (no behavior change; storefront tests still pass).

## Batch B — API

- [x] B1. `apps/api/src/services/module-public-links-service.js` inside `createModulePublicLinksService({ prisma })`:
  `list`, `create` (token via `crypto.randomBytes(32).toString('base64url')`), `revoke`,
  `resolveByToken`, `reserveUse`, `releaseUse`, `recordUse`, `statusOf`.
- [x] B2. `apps/api/src/routes/module-public-links-routes.js`: admin endpoints (spec 4.1) with dynamic
  `managePermission` check and AuditLog; mount under the authenticated `/modules` router.
- [x] B3. Route Loader: also import optional `modules/custom/<key>/api/public.js` and keep a
  `publicRouters` map refreshed on the same lifecycle events as the normal routers.
- [x] B4. `apps/api/src/routes/module-public-gateway.js`: pipeline of spec 4.2 (rate limit, resolve,
  method gate, 64 KB JSON + honeypot, use reservation, `_context`, delegation with `publicLink`).
  Mount in `index.js` next to the other `/public/*` routers, path-scoped only; add to the `/public`
  endpoint index.
- [x] B5. Module lifecycle cleanup: uninstall revokes, reset deletes the module's links.
- [x] B6. Tests `apps/api/src/routes/__tests__/module-public-gateway.test.js` and
  `module-public-links-routes.test.js` with a fake prisma/service (spec section 11 cases).

## Batch C — Frontend, SDK, docs

- [x] C1. SDK `client.modules.publicLinks.list|create|revoke`.
- [x] C2. `@runly/ui`: `PublicLinkFrame`, `ShareLinkDialog`, `PublicLinksPanel` (add `qrcode` dep), export
  from `index.js`, document in `docs/ai-context/rme3-runtime-capabilities.md`.
- [x] C3. `PublicModuleOutlet`: prefix + token matching, `_context` fetch, 404/410 `EmptyState`, new props.
  Confirm custom module bundles load without a session.
- [x] C4. `docs/ai-context/rme3-public-links.md`; sections in `AGENTS.md` and the module ZIP guide.

## Verification

- [x] `node --test packages/module-engine/src/__tests__/` and the new API tests pass.
  Verified: 2026-09-28 (engine 124/124; gateway 6/6; admin routes 2/2; API services+routes+sdk+validators
  766 pass, 2 fail pre-existing/unrelated: support-report sendBugReport fails on a clean tree,
  inventory-chat passes in isolation)
- [x] `pnpm lint` and `pnpm build:web` pass.
  Verified: 2026-09-28 (`vite build` ok; lint reports only pre-existing errors in generated
  git-ignored bundles under modules/custom/.previews|.staging and apps/api/bundles; no errors in
  changed files). Boot smoke on a temporary port: /health 200, gateway unknown token 404,
  admin without session 401, /public/site/ unchanged 404.
- [ ] Real check against the running dev API (do not start/stop it): wire `custom.encuestas`
  (manifest resource + `api/public.js` + public view), create a link, answer the survey from a
  private window, verify `use_count`, revoke and get 410, exceed `max_uses` and get 410.
