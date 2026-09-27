# Module Builder MVP — Release Checklist

Use this before enabling the Module Builder for real users on an instance, and again after any change to `module-builder-service.js`, `module-package-wiring-service.js`, or the Schema Diff Engine. See `docs/superpowers/specs/2026-09-27-rme3-no-code-module-builder-architecture.md` for the architecture and `docs/superpowers/plans/2026-09-27-rme3-no-code-module-builder-architecture.md` for the implementation plan.

## 1. Migrations

- [ ] `prisma/migrations/20260927000000_module_builder_projects/migration.sql` is applied (`pnpm exec prisma migrate status` reports up to date).
- [ ] `ModuleBuilderProject` and `ModuleBuilderRevision` tables exist with RLS enabled and `REVOKE ALL ... FROM PUBLIC, anon, authenticated` (they're backend-only, no PostgREST/Supabase Data API access).
- [ ] `pnpm db:generate` has been run after pulling this change (regenerates the Prisma client with the new models).

## 2. Permissions

- [ ] `core.modules.builder` exists in `Permission` (seeded from `apps/api/src/manifests/official/core-modules.js`'s `runly.core` manifest — run `pnpm db:seed` or wait for the next `POST /modules/sync` if not).
- [ ] The "Constructor de módulos" navigation item appears for a user with `core.modules.builder` and does **not** appear (and the route 403s) for one without it.
- [ ] Publishing/installing still requires `core.modules.create` in addition to `core.modules.builder` — a user with only the Builder permission can edit drafts but gets a 403 on `/publish`.

## 3. Build

- [ ] `node --test` passes for: `module-builder-service`, `module-package-service`, `module-package-staging-service`, `module-package-purge-service`, `module-resource-inventory-service`, `module-schema-migration-service`, `module-dashboard-query-service`, `module-kanban-query-service`, `module-compiler` (incl. `archive`), `module-engine`, scaffolder.
- [ ] `pnpm exec eslint` is clean on the Builder backend/frontend files.
- [ ] `pnpm --filter @runly/desktop run build:web` succeeds (`apps/desktop/dist` regenerated).
- [ ] `pnpm exec prisma validate` passes.
- [ ] `pnpm run check:privacy` — confirm no *new* findings versus the pre-change baseline (this repo currently has 2 pre-existing findings in unrelated design docs; do not let Builder changes add more).
- [ ] Tauri build (`apps/desktop && pnpm tauri build`) only if the release also ships the native desktop app — the Builder screens are plain React/Vite and don't touch native code, but a stale Tauri bundle would still serve an old web build.

## 4. Publish / install smoke test (golden path)

Run this against a real dev database with a real authenticated session — the automated suite mocks Prisma and **cannot** catch driver-level or filesystem-level bugs (see "Known driver-adapter gotcha" below). Minimum pass:

1. Create a project (`blank` template), add one entity with a `select` field and a `text` field.
2. `POST /validate` → `valid: true`.
3. `POST /compile` → file list includes `module.manifest.js`, `models/<entity>.model.js`, one view file per TABLE/FORM/DETAIL/PAGE.
4. `GET /export` → ZIP contains exactly those files; re-uploading it via `POST /modules/:key/upload` returns `NO_CHANGES` (proves the exported ZIP round-trips through the standard upload pipeline unmodified).
5. `POST /publish` → `outcome: PUBLISHED`, `installed: true`. Confirm in the DB: `RunlyModule.status = INSTALLED`, `RunlyModel`/`RunlyField`/`RunlyView` rows exist, the physical table exists with the declared columns.
6. Create a record through the module's generated REST route; confirm it's `company_id`-scoped (a session in a different company sees zero rows for the same endpoint).
7. Add a field, publish again → `ADD_COLUMN`, `safety: SAFE`, applied; existing rows keep their data with the new column `NULL`.
8. Remove a field that exists in the published definition, publish again → blocked with `SCHEMA_MIGRATION_UNSUPPORTED` / `DROP_COLUMN`, `DESTRUCTIVE`; confirm the column, the installed module and the draft are all unchanged after the block.
9. Hard-purge the test module (`DELETE /modules/:key/purge`) → `verification.clean: true`, `remaining: []`; confirm the on-disk package directory is gone.

## 5. Rollback considerations

- **Draft-only rollback**: deleting a `ModuleBuilderProject` never touches the installed `RunlyModule` — they're deliberately separate lifecycles (see the spec's "DELETE PROJECT" section). To remove an installed Builder-published module, use the normal RME3 hard-purge flow, not Builder project deletion.
- **Failed publish**: `ModulePackageService.publishZip` restores the previous package/bundle/routes on any failure before the swap completes (`originalPackagePreserved` / `previousPackageRestored` in the error response confirm this). No manual recovery should be needed for a clean failure.
- **Crash mid-publish**: if the API process dies *between* the file swap and the metadata reconcile step (rare outside of a `node --watch`-induced restart loop — see below), the next publish attempt with identical content reports `NO_CHANGES` and skips reconcile again, since the file-hash comparison happens before the metadata-sync stage. If a Builder-published module's UI/dashboard looks stale right after an interrupted publish, force a real content change (e.g. touch a label) and republish rather than relying on `NO_CHANGES` to repair it.
- **Stale lock after a crash**: a killed process during `publishZip` can leave `modules/custom/.locks/<key>/` behind, which makes every subsequent publish for that key return `409 MODULE_PACKAGE_BUSY` forever. Delete that lock directory manually to recover; there is no automatic staleness timeout today (tracked as a backlog item, not fixed in this pass — see the QA report).
- **Rolling back a schema migration**: the Schema Diff Engine is forward-only by design (MVP scope). There is no automated `DROP COLUMN` undo. Reverting a published field addition means manually dropping the column (outside Builder) or accepting it as dead data.

## 6. Known driver-adapter gotcha (fixed, but worth knowing)

`@prisma/adapter-pg` cannot deserialize PostgreSQL's `regclass` type. Any new raw SQL using `to_regclass(...)` **must** cast it, e.g. `to_regclass('public.' || $1)::text`, or every call through it will fail with a generic `P2010` error. This bit three different call sites during this stabilization pass (`module-schema-migration-service.js`, `module-resource-inventory-service.js`) before being fixed — grep for `to_regclass` without a trailing `::text` before shipping any new schema-introspection code.

## 7. Known dev-workflow gotcha (not a product bug)

Running the API under `node --watch` (the default `pnpm dev:api`) while also publishing through the Builder can trigger a restart loop: publish writes/renames files under `modules/custom/`, which `--watch`'s default project-wide file watch treats as a reason to restart, occasionally racing itself into `EADDRINUSE`. This does not happen in a normal (non-watch) process, which is how the app actually runs outside of live-reload development. If dev-server publishing feels flaky, restart with `node src/index.js` (no `--watch`) for that session.
