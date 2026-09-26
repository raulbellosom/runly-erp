# Runly ERP - Tasks and Roadmap

## Runly migration [IN PROGRESS]

Spec: `docs/superpowers/specs/2026-09-13-runly-distribution-design.md`.
Plan: `docs/superpowers/plans/2026-09-13-runly-distribution.md`.

- [x] Stage 1: GitHub, Docker image defaults, bootstrap sources and desktop release artifact; locally verified.
- [x] Stage 2: visible Runly product branding, emails, metadata and PWA names; locally verified, deployment and stored metadata synchronization pending.
- [x] Stage 3a: canonical @runly packages, SDK metadata and Dev Kit with legacy import/command/directory compatibility; locally verified.
- [x] Stage 3c: public storefront SDK (`atlas-sdk.js`/`window.AtlasERP`, served to every customer public website) renamed to `runly-sdk.js`/`window.RunlyERP` with full backward compatibility; locally verified.
- [x] Stage 3b: RUNLY_* / VITE_RUNLY_* environment inputs with Atlas fallback; installer preservation, Compose and web runtime configuration locally verified.
- [x] Stage 4a: explicit aliases for 21 official module keys, exact-first runtime/API lookup, permission-preserving web redirects, and read-only source/database audit; locally verified.
- [x] Stage 4b increment 1: bidirectional persisted API lookup and synthetic PostgreSQL conversion/inverse proof for six identity columns; locally verified, no installation cutover.
- [x] Stage 4b increment 2: web runtime manifest merging, built-in screen/layout aliases, nested navigation and active component namespace compatibility; locally verified.
- [x] Stage 4b increment 3: official Runly discovery/reserved namespaces, UUID dependency alias reconciliation and authoritative core protection; locally verified.
- [x] Stage 4b: canonical Runly seed (`runly.admin` system role, 21 official manifest keys) and remaining runtime data-key callers converted to accept/emit `runly.*`; locally verified. A fresh empty installation was not booted end-to-end in this environment (no live `pnpm db:seed` run).
- [x] Stage 5: Tauri `identifier`, Cargo package names, Android `namespace`/`applicationId`, the `atlas://` deep-link URL scheme and the remaining native notification channel ids (`screen`, plugin name) converted to Runly; locally verified (`cargo check`/`cargo test` green, no Android SDK available for a real Gradle build). Offline storage migration (`@runly/offline` Dexie cache, `atlas.ledger` desktop SQLite mode) not yet audited.
- [ ] Stage 6: runly.mx, external integrations, versioned image publication and deployment rehearsal.
- [x] Stage 7: new assets and base palette supplied by the user; locally verified, visual QA and native rebuild pending.

Publication/deployment remain pending; existing Atlas service, volume and application identities are preserved in stage 1.

Current direction (2026-09-13): the user will recreate the test project and wants a completely clean database with Runly images. Prioritize a clean-install cutover over migration of old records. No existing database/project/volume has been deleted. Identify the specific test installation and its database/storage resources before any destructive reset; a project reset does not imply deleting this source workspace.

**DONE — 2026-09-14 (manual action, run by the user directly, not the agent):** both steps blocked for agents by the Claude Code auto-mode safety classifier (see prior note) were completed by Raul:

1. Database reset — run inside the `runly-api-external` container on the deployment VPS: `pnpm db:reset` applied all 100 migrations (including `20260914000000_rename_atlas_core_tables_to_runly` and `20260914010000_fix_function_search_path`) against the live external Supabase instance and reseeded the catalog: "Runly modules seeded (21)". Zero companies existed yet, so the company-scoped seed steps (ledger types/categories, pfm categories, chat templates, MeridIAn bot profile) report 0 — expected for a genuinely empty database, not a failure.
2. Storage cleanup — `node _tmp-clean-storage.mjs infra/installer/.env.external --dry-run`, run from the local repo checkout (the script only needs HTTPS access to Supabase Storage + `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, not the VPS or container — the user's first two attempts failed simply because the script isn't copied into the Docker image or present on the VPS host). Confirmed all 5 target buckets (`module-bundles`, `atlas-website`, `atlas-notes`, `atlas-chat`, `atlas-files`) already at 0 objects — no destructive delete was needed. The temporary script was removed after use.

The clean-install cutover (canonical `runly.*` catalog, seed script, branding) is now verified against a genuinely empty, freshly-reset database on the real external deployment. Remaining before Stage 6: an actual application acceptance pass (create the first company via the setup wizard, confirm module install/permissions/branding work end-to-end against this fresh DB) — not yet done as of this writing.

Runly public storefront SDK verified 2026-09-14: the JavaScript SDK the website builder injects into every customer's published public site (previously `apps/api/src/public/atlas-sdk.js`, served at `/public/site/atlas-sdk.js`, exposing `window.AtlasERP`/`window.ATLAS_CONFIG`) was git-mv'd to `runly-sdk.js` and now exposes `window.RunlyERP`/`window.RUNLY_CONFIG` as canonical, with `window.AtlasERP` kept as a live alias (same object reference) and `window.ATLAS_CONFIG` read as a fallback — so any site published before this change keeps working unmodified. A new route `/public/site/runly-sdk.js` was added; the old `/public/site/atlas-sdk.js` route still serves the same file. `dist-serve-service.js`'s `injectAtlasConfig` (renamed `injectRunlyConfig`) now injects the new config global and script tag for sites published from now on. Internal-only identifiers with no external observers were renamed outright (no alias needed): the SDK's own `localStorage` key prefix, its anti-spam honeypot field name, and the `data-atlas-form-id`/`-managed` attributes it stamps on forms it renders itself at runtime. `data-atlas-event`/`-label`/`-placement` — confirmed to be attributes customers hand-author into their own custom site content, per the Growth Analytics help text — are read under both the new and old attribute names indefinitely, since existing customer content cannot be bulk-migrated. Frontend consumers (`PublicWebsiteEntry.jsx`, `ContactFormRenderer.jsx`, `DistUploadPanel.jsx`'s example snippet, `GrowthAnalyticsReports.jsx`'s help text) updated to the new names. Deliberately out of scope: `X-Atlas-Company`/`X-Atlas-Site`/`X-Atlas-Company-Id` HTTP headers — the last one especially is the tenant-scoping header used across the *entire* authenticated API, not just the storefront, and needs its own dedicated dual-accept increment if ever renamed. Verified: `node --test` on the SDK test (renamed `runly-sdk.test.js`, plus a new test asserting the `AtlasERP`/`RunlyERP` alias) and `dist-serve-service.test.js` — 36/36 passing; full `apps/api` suite — 1372/1374 passing, 2 skipped (unrelated, need a live DB); full `apps/desktop` suite — 368/368 passing; `pnpm lint` and `pnpm --filter @runly/desktop build:web` clean. No real customer site was loaded in a browser against the new SDK. Spec: `docs/superpowers/specs/2026-09-14-runly-storefront-sdk-design.md`; evidence: `docs/superpowers/plans/2026-09-14-runly-storefront-sdk.md`.

RME3 acronym rename and doc/CSS branding sweep verified 2026-09-14: renamed the module-engine acronym (AME3 → RME3) and `defineAtlasModule` → `defineRunlyModule` (compat alias kept for `@atlas/module-engine`, mirroring the existing `createAtlasClient`/`createRunlyClient` pattern), covering script/doc/fixture filenames (`export-ame3-devkit.mjs`, `lib/ame3-devkit.js`, `ame3-modules.md`, `ame3-runtime-capabilities.md`, `fixtures/ame3-devkit/`) and regenerating `infra/installer/devkit-export`. Also swept remaining stale `Atlas`-branded prose across `CLAUDE.md`/`README.md`/`AGENTS.md`/`.github/copilot-instructions.md` and roughly 20 other live docs that had not been updated after earlier renames this session: `createAtlasClient` → `createRunlyClient`, `AtlasModule`/`AtlasModel`/`AtlasField`/`AtlasView` → `Runly*`, `AtlasTable`/`AtlasForm`/`AtlasDetail`/`AtlasCrudView` → `Runly*`, `atlas.core`/`atlas.identity`/etc. module-key examples → `runly.*`, `Atlas ORM` → `Runly ORM`, and broken `VITE_ATLAS_API_URL`/`ATLAS_APP_NAME`/`ATLAS_API_PORT`/`ATLAS_TIME_ZONE` env var names in `docs/DEPLOY_VPS_DEV.md` that the app no longer reads at all (dead since the earlier same-session Atlas-fallback removal). Renamed the `--atlas-navy`/`--atlas-blue`/`--atlas-cyan`/`--atlas-gray-*` and `--atlas-color-*`/`--atlas-font-*` CSS custom properties to `--runly-*` across `apps/desktop/src/styles.css`, every `website/runlyBlocks/*.jsx` component, and `packages/ui`'s `AppShell.jsx`/`ActivityDrawer.jsx` — pure presentational identifiers, never persisted or compared against stored data, so zero behavior risk; this intentionally reverses the 2026-09-13 brand-assets entry's choice to keep the names for a minimal diff, since the user has since asked for the literal word "atlas" to be fully retired wherever there is no real technical reason to keep it. Added `runly.` to `packages/module-engine/src/constants.js`'s `RESERVED_NAMESPACES` (previously only `atlas.` was reserved there; the export was already unused dead code, since the real enforcement in `module-discovery-service.js`'s own `RESERVED_CUSTOM_PREFIXES` already reserved both spellings). Two dangling `docs/superpowers` spec/plan links broken by an earlier text replace in this same pass were caught and reverted to their real, unrenamed historical filenames. Left untouched, confirmed still deliberate: the `@atlas/*` package-scope compatibility aliases, `_atlas-devkit` legacy folder detection, the `atlas.*`/`runly.*` module-key dual-alias system, and the per-module internal `atlas.<key>` string literals (sourceModule tags, log prefixes, hardcoded nav links such as `/app/m/atlas.pfm/overview` in `apps/api/src/routes/pfm/`, `chat/`, `fleet/` route and service code) — these sit outside every Stage 4 increment's actual file list despite the Stage 4b roadmap line above implying "remaining runtime data-key callers" are converted; flagged to the user rather than touched, since some are compared with `===` against values that may already be persisted. `node --test` (module-engine 96/96, desktop 370/370, docs-contract 3/3, scripts 21/23 with 2 pre-existing unrelated skips, installer 24/24), `pnpm lint`, and `pnpm --filter @runly/desktop build:web` all pass.

Runtime data-key callers converted verified 2026-09-14: completed the "remaining runtime data-key callers" gap the previous entry flagged as still outstanding despite the Stage 4b roadmap line claiming it done. Converted ~200 production files' internal `atlas.<module>` string literals (sourceModule tags, AuditLog action names, log prefixes, hardcoded nav links, FileAsset.moduleKey upload tags, permission-catalog section comments) to `runly.<module>`, via a script that skipped any line already containing both spellings (the genuine dual-accept lists — `ADMIN_ROLE_KEYS`, workspace/HR/growth file-moduleKey filters, etc. — left untouched on purpose). Found and fixed two real regressions the sweep introduced: (1) `sync-push-service.js`/`sync-service.js` had their `PUSH_MODULE_REGISTRY`/`SYNC_MODULE_REGISTRY` object-literal keys renamed to `runly.*` by the sweep, but the alias-bridge lines a few lines down still read `REGISTRY['runly.x'] = REGISTRY['atlas.x']` — since the `atlas.x` entry no longer existed, this overwrote every renamed entry with `undefined`; fixed by flipping the bridge direction (`REGISTRY['atlas.x'] = REGISTRY['runly.x']`), which is also the semantically correct direction now that the primary definition is runly-keyed. (2) `apps/api/src/lib/tenant-context.js`'s explanatory comment ("fresh installs seed runly.admin; existing installs ... still have atlas.admin persisted") had its second half's literal renamed too, since the two atlas/runly mentions were the sweep script's line-based dual-accept check but split across two comment lines — reverted the second one. Separately, and more deliberately, converted three internal alias-storage systems that used `atlas.*` purely as their own internal representation with zero external/persisted exposure: `apps/desktop/src/app/ModuleOutlet.jsx`'s `SCREEN_MAP` (all ~90 keys) and `module-screen-resolver.js`'s matching branches now use `runly.*` as the primary key, with a new `getCurrentModuleKey` export added to `packages/core/src/module-identity.js` (the atlas→runly counterpart of the existing `getLegacyModuleKey`) so a stray `atlas.*` request still resolves; `apps/desktop/src/lib/moduleComponentRegistry.js`'s `atlas.fleet:*`/`atlas.growth:*` component-registry keys (self-contained, both registration and all blueprint `component:` references live in the same bundle, so renamed atomically); and `apps/desktop/src/shell/blueprint-layout-resolver.js`'s `DASHBOARD_SHELL_KEY`/`CRUD_LAYOUT_KEY` canonical constants (now `runly.dashboardShell`/`runly.crudLayout`, with `atlas.dashboardshell`/`atlas.crudlayout` kept as recognized input aliases). Explicitly left alone: `atlas.office_write`, a Postgres `set_config`/`current_setting` GUC name read by an already-applied, immutable migration trigger (`20260907180000_office_wopi`) — renaming the app-code side without a new forward migration to match would silently disable that trigger's guard. `node --test` full suites — API 421/421 (2 pre-existing skips), desktop 371/371, packages 356/357 (1 pre-existing unrelated `growth-domain` failure), module-engine 96/96, scripts 21/23 (2 pre-existing skips) — `pnpm lint`, `pnpm --filter @runly/desktop build:web`, and a full `pnpm build` including the native Tauri bundle all pass.

Remaining leftover-Atlas sweep verified 2026-09-14: a user-run `git grep atlas` audit after the two entries above still found ~750 tracked files, most of it `docs/superpowers/**` (historical, untouched) and `prisma/migrations/**` (immutable). Of the real remainder, fixed: ~20 more live docs (`03_core_modules.md`'s full module catalog, `03_custom_modules.md`'s tutorial including a stale `atlas_deliveries_shipment` table-name example predating the "never prefix with atlas_" rule, `DEPLOY_VPS_DEV.md`/`FIREBASE_SETUP.md`/`office-vps-example.md`/`google-calendar-setup.md` env vars and container/path names verified against the real VPS the user is running today, `ui-screen-audit-checklist.md`'s dated compliance table); `codex/00_MASTER_PROMPT.md` and six `.github/{agents,instructions,skills}` files that a past commit's checklist claimed were updated but weren't; `--atlas-*` CSS custom properties in the Android theme XML, plus a stray `apps/api/bundles/.gitkeep` that had real `package.json`-like content committed into it instead of being empty. Found and fixed four more real bugs while auditing, none introduced by this session: (1) `apps/desktop/public/sw-notifications.js` sent `postMessage({type: "atlas.notifications.push"})` while `useServiceWorkerNotifications.js`'s listener checked for `"runly.notifications.push"` — a pre-existing sender/receiver mismatch that silently broke the in-app toast-on-push handoff. (2) `apps/desktop/src/native/notification-policy.js`'s chat-notification link regex still matched only `atlas.chat`, so tapping a push notification stopped deep-linking into the conversation the moment the previous entry's sweep changed the API's generated links to `runly.chat` — a regression from *this session*, caught and fixed here. (3) `SupabaseYjsProvider.js`'s constructor destructured a parameter named `atlas` that nothing ever passed (the caller passes `runly`), so `_init` called an undefined global `runly.notes.getYDoc(...)`, silently caught by its own try/catch — persisted Y.js state was never actually loaded on note open; fixed by renaming the parameter to match what's actually passed. (4) `scripts/sync-fleet-blueprints.mjs` and `scripts/migrate-website-images-to-public.mjs` are real (non-test) utility scripts that write `atlas.fleet:*` component keys and `atlas-files`/`atlas-website` bucket names directly into the database/Storage — stale after this session's renames, which would have produced component keys the registry no longer recognizes and bucket names Storage no longer has; updated both. Left alone, confirmed deliberate: `infra/installer/lib/{env-compat,office-config,firebase-config}.mjs` and `setup-{external,local}.mjs`, which implement Stage 3b's real, tested, generic `ATLAS_*`/`RUNLY_*` bidirectional env-var compatibility for the installer specifically (verified via `env-compat.test.mjs` et al. — these are a different, more conservative system than the main app's Runly-only runtime config, deliberately kept for real external installs); `packages/storefront-sdk/**`, fully handled by its own dedicated 2026-09-14 increment recorded above; `atlas_unaccent`/`atlas_guard_office_document`, Postgres functions defined by applied migrations (renaming the call site without a matching forward migration would just break the call); `scripts/lib/runly-module-{fixture,rehearsal}.js` and `fixtures/runly-module-keys.sql`, self-contained synthetic test fixtures for the (now superseded by a plain migration) rehearsal tooling. `node --test` full suites — same pass counts as the previous entry — `pnpm lint`, and a full `pnpm build` including the native Tauri bundle all pass.

Verified: 2026-09-13 (27 node:test checks passed; local/external Compose image defaults and custom overrides verified; desktop release destination verified; JS syntax, scoped ESLint and diff checks passed; React Doctor reported no issues, 85/100). No image/native builds or production changes. Full evidence in the stage 1 plan.

Stage 2 verified: 2026-09-13 (50 targeted tests passed across PWA/ETag, email, PDF/Excel branding, manifests, notifications and invitations; Vite build and scoped ESLint passed; JSON/native/PWA identities and technical tokens preserved). React Doctor: 38 existing-component maintainability warnings, 52/100; no control-flow or layout changes were made. A broken local API dependency link was repaired with frozen-lockfile installation; dependency manifests and lockfile unchanged. Spec: `docs/superpowers/specs/2026-09-13-runly-visible-branding-design.md`; evidence: `docs/superpowers/plans/2026-09-13-runly-visible-branding.md`. Assets/palette and saved customer names preserved; no native builds, database operations or deployment.

Stage 3a verified: 2026-09-13 (focused package/importmap, bundler, installer, Dev Kit, RME3 and storefront SDK tests passed; frozen installation, Vite and SDK builds passed; ESLint zero errors). External dependency resolutions preserved. React Doctor: 58 existing-code warnings across the expanded scope, 48/100; frontend changes in this stage are import-scope replacements only. Public npm package renamed locally to `@raulbellosom/runly-sdk`, publication pending. No database, native identity, customer-folder or deployment operations. Evidence: `docs/superpowers/plans/2026-09-13-runly-packages-devkit.md`.

Stage 3b verified: 2026-09-13 (88 distinct focused tests passed, including Compose config with synthetic files, bootstrap, runtime aliases, secret/settings preservation and Vite substitutions; web build, scoped ESLint, installer syntax and Rust formatting passed). React Doctor unchanged at 58 warnings, 48/100. Runtime inputs prefer Runly with legacy fallback; installer-managed process overrides beat saved values. Native app IDs, module keys, volumes and storefront globals remain unchanged. No actual installer run, customer env changes, DB operations, native build or publication/deployment. Evidence: `docs/superpowers/plans/2026-09-13-runly-environment.md`.

Stage 4a verified: 2026-09-13 (121 distinct Node tests passed across module engine/aliases/API permissions/upload/PWA and audit; the database audit ran against an isolated PostgreSQL 18 fixture, with no skipped DB test in that run, and retained all rows). Source inventory: 21 official pairs, 436 tracked source files, 104 candidate schema columns, including nine direct identity columns. Web build, scoped ESLint, frozen installation and diff checks passed. No existing database was inspected or changed; no deployment, native build, module sync/seed or publication. React Doctor: 59 warnings, 48/100 (one additional ModuleOutlet complexity warning reviewed). Stage 4b remains necessary before renaming persisted keys. Evidence: `docs/superpowers/plans/2026-09-13-runly-module-keys.md`; cutover notes: `docs/migrations/runly-module-keys.md`.

Stage 4b increment 1 verified: 2026-09-13 (22 Node tests passed, including eight real PostgreSQL conversion/failure scenarios, API aliases and existing upload/bundle routes; zero skipped tests in the Docker-enabled run). Standalone disposable CLI converted/reversed 126 identity values across 21 pairs, preserving all other fixture values and UUID relationships across 19 synthetic tables. Scoped ESLint and diff checks passed. No existing database, frontend, customer assets, seed/sync, publication or deployment changes. Complete runtime compatibility, JSON/history/offline policy, representative installation-copy rehearsal and post-commit rollback remain pending. Evidence: `docs/superpowers/plans/2026-09-13-runly-key-rehearsal.md`.

Stage 4b increment 2 verified: 2026-09-13 (22 Node tests passed; web build and scoped ESLint passed; React Doctor unchanged at 59 warnings, 48/100). Both official key spellings resolve built-in screens and component implementations while API persisted identity and filtered navigation remain authoritative. Exact catalog collisions stay separate. No database/reset or user asset changes. User permits considering a reset of the test database if necessary; this increment did not require it. Remaining: backend seed/discovery/read-write compatibility, child-screen paths, JSON and PWA/native/offline policies. Evidence: `docs/superpowers/plans/2026-09-13-runly-web-runtime.md`.

Stage 4b increment 3 verified: 2026-09-13 (27 Node tests passed; scoped ESLint and diff checks passed). Official `runly.*` manifests load through discovery; custom modules cannot use official namespaces. Dependencies resolve exact-first to persisted IDs, merge required precedence and reject conflicting alias versions. Core protection follows all 21 official manifests. Existing upload/bundle/API permission regressions passed. No database reset, live seed/sync or publication. Evidence: `docs/superpowers/plans/2026-09-13-runly-backend-modules.md`.

Frontend module directories renamed 2026-09-13 (`apps/desktop/src/modules/atlas.*/` → `runly.*/`, 21 folders via `git mv` preserving history; purely organizational — no backend module-key/catalog change). All static and cross-module relative imports updated (folder-path references only; backend logical module keys, route paths and component-registry keys such as `"atlas.core:/modules"`, `"/app/m/atlas.fleet/..."`, `event.sourceModule === "atlas.chat"` were deliberately left untouched, out of scope). `localStorage` key `atlas-active-company` → `runly-active-company` with a one-time read-side migration in both `lib/atlas.js` and `company/ActiveCompanyProvider.jsx` so an existing browser session does not lose its selected active company. Native notification channel ids `atlas-calls-v1`/`atlas-alerts-v1` → `runly-calls-v1`/`runly-alerts-v1` (no fallback needed, just channel labels). Supabase Storage bucket `atlas-notes` intentionally left unrenamed — it is referenced from the backend (`apps/api/src/routes/notes/index.js`) and several frontend files as a long-lived, actively-used bucket (Notion-style notes redesign, canvas notes with real image uploads) on the shared self-hosted Supabase instance (`supabase.example.com`); renaming it would orphan existing objects since Supabase Storage bucket renames do not move objects, and emptiness could not be confirmed from this sandbox — tracked as debt pending a dedicated object-migration increment. Verified: 2026-09-13 (`pnpm --filter @runly/desktop build:web` passed; 368/368 `node --test` frontend tests passed including `notification-policy.test.js`; `pnpm lint` zero errors; final grep sweep of `modules/atlas\.` and cross-module `atlas.<name>` relative imports returned zero results in active source). Spec: `docs/superpowers/specs/2026-09-13-runly-module-directories-design.md`; evidence: `docs/superpowers/plans/2026-09-13-runly-module-directories.md`.

Runly brand assets/palette verified 2026-09-13, then refined across three rounds of user browser QA the same day: old `/brand/atlas-logo-*.png` references (Login, Topbar, SetupWizard, PublicWebsiteEntry, GuestCallScreen watermark, ApiErrorScreen isotype) replaced with the new `/runly/` assets per context/theme; `--atlas-navy*`/`--atlas-blue`/`--atlas-cyan` CSS variables remapped in place to the Runly hex palette (variable names kept for a minimal diff, values changed); favicons/PWA icons/Tauri icon set (including iOS/Android/Windows Square/StoreLogo) regenerated from the new source art via `pnpm exec tauri icon`. The boot/route-transition loader (`AppLoader.jsx`) went through two iterations: an initial from-scratch SVG/CSS rebuild was replaced (per user feedback — they wanted the actual designer-built animation, not an approximation) with a `fetch()` + `DOMParser` injection of the real `apps/desktop/public/runly/runly-loader{,-dark}.html` markup straight into the React tree (not an iframe — also rejected per feedback, as it reads as a separate embedded page rather than the app itself), with its animation-sync script reimplemented in a `useEffect`; a 900ms minimum display floor was added in `AppEntry.jsx` because the local API resolves fast enough that the loader was unmounting before the animation ever painted. `SetupWizard.jsx`/`StepBranding.jsx` (the first-run instance setup, i.e. "register") had the old Atlas navy/cyan palette and default company color hardcoded in inline styles, bypassing the CSS-variable remap entirely — fixed to Midnight/Navy/Orange and the 7 official brand colors. `LoginScreen.jsx`'s sidebar used a flat warm-accent fill as its background, contradicting the brand guide's own rule that the warm gradient is an accent, never a flood fill — changed to the same Midnight/Navy gradient as the setup wizard. The "Business in motion." tagline was added to both screens; all "Meridian Edition" references (an Atlas-era edition label with no remaining meaning) were removed from both. Separately, `apps/desktop/src-tauri/tauri.conf.json` window config had no explicit start `url`, so the native Tauri app opened at bare `/` (the public marketing/coming-soon page) on every cold start before redirecting into `/app/login` — added `"url": "/app/login"` (that route already handles not-initialized/authenticated/anonymous cases). `pnpm --filter @runly/desktop build:web` and `pnpm lint` passed after every round. Spec: `docs/superpowers/specs/2026-09-13-runly-brand-assets-design.md`; evidence: `docs/superpowers/plans/2026-09-13-runly-brand-assets.md`. Pending: browser/device visual QA at 390px/1440px in both themes and confirmation the public-page-flash report is fully resolved (the Tauri cold-start fix addresses one confirmed cause; a possible second scenario — reloading an already-deep `/app/...` browser URL — was investigated in the router code with no bug found, and remains unconfirmed pending the user's repro details), plus a native rebuild to pick up the new Tauri icon set and window config.

Runly native deep-link scheme and remaining native channels verified 2026-09-13 (continuation of the native-identifiers increment): the custom `atlas://` URL scheme (used to open chat/call from a tapped notification) renamed to `runly://` at its single source of truth (`apps/desktop/scripts/native-host.mjs`'s deep-link plugin config) and in both parsers (`apps/desktop/src/native/policy.js`, `apps/desktop/src-tauri/src/mobile_host.rs`) plus their tests. Found and fixed a real cross-language bug in the process: `HostNotifications.kt`'s channel allowlist still checked for `atlas-calls-v1`/`atlas-alerts-v1`, but the JS side (fixed in the module-directories increment) already emits `runly-calls-v1`/`runly-alerts-v1` — every real native notification would have been rejected as `INVALID_NOTIFICATION`. Also renamed two channels/identifiers the earlier sweep missed because they live outside `notification-policy.js`: the screen-share notification channel (`ScreenSharePlugin.kt`, `atlas-screen-v1` → `runly-screen-v1`) and the Tauri Android plugin's own internal name (`mobile_media.rs`, `Builder::new("atlas-media")` → `"runly-media"`). `AndroidManifest.xml`'s auto-generated deep-link `<data android:scheme="atlas">` was manually patched to `"runly"` as a stopgap (authoritative regeneration happens on the next real Android build). `node --test` (native-host, 9/9), `cargo test`/`cargo check`/`cargo fmt --check`, `pnpm lint`, and `pnpm --filter @runly/desktop build:web` all pass. Evidence (addendum): `docs/superpowers/plans/2026-09-13-runly-native-identifiers.md`.

Runly native identifiers verified 2026-09-13: Tauri `identifier` → `com.racoondevs.runlyerp`; Cargo packages `atlas_erp`/`atlas_erp_lib` → `runly_erp`/`runly_erp_lib` (fixed the one cross-reference in `main.rs`); Android `namespace`/`applicationId` → `com.racoondevs.runlyerp`, including `git mv` of all 3 Kotlin files under the old package folder (`MainActivity.kt`, `HostNotifications.kt`, `ScreenSharePlugin.kt` — the plan's file list only named the last one) plus their `package` declarations, ProGuard keep-rules, and the Android plugin-registration string literal in `mobile_media.rs`. `cargo check` passed (Rust toolchain was available in this environment). No Android Gradle build was run (no Android SDK available) — flagged as a real limitation, not silently skipped. Spec: `docs/superpowers/specs/2026-09-13-runly-native-identifiers-design.md`; evidence: `docs/superpowers/plans/2026-09-13-runly-native-identifiers.md`.

Runly backend catalog default verified 2026-09-13: the 21 official manifest keys, their `dependencies[]`/`consumes[]` references and internal navigation paths in `core-modules.js`/`feature-modules.js` now read `runly.*` instead of `atlas.*` (blueprint entity keys like `atlas.module.entity` were deliberately left alone — not one of the 21 official module keys); `prisma/seed.js` now seeds the system admin role as `runly.admin`. Every admin-role guard (`apps/api/src/index.js`, `tenant-context.js`, `module-lifecycle-service.js`, `notes/shares-service.js`, `office/access.js`, `files-service.js`, `files/workspace.js`, `chat-moderation-service.js`) now accepts both `runly.admin` and `atlas.admin` so existing installations keep their admins' privileges while new installations get them from `runly.admin` on first boot. Sync registries (`sync-service.js`, `sync-push-service.js`) alias `runly.*` keys to the same handler objects as their `atlas.*` counterparts (no duplication). `public-website.js` `ERP_PREFIXES` now recognizes `runly.`. ~24 files across files/hr/inventory/company/office/growth/pos/pfm/website/documents were reviewed line-by-line and updated: write sites (audit-log/file-asset creation) now emit `runly.*`; read/filter sites accept both spellings. Deliberately left as `atlas.*` (documented, low-risk): notification deep-link URLs (already normalized generically by the stage 4b web-runtime alias resolver at click time), `console.error("[atlas.x]", ...)` log-prefix labels, and the self-consistent `sourceModule` tags used only internally by the calendar/calls/projects/pfm bridges (not part of the official module-key catalog). `module-cleanup-registry.js` needed no change — its lookup already goes through the alias-aware `findModuleByKey`. Verified: `node --test "apps/api/src/**/__tests__/**/*.test.js"` — 1373 tests, 1371 passing, 0 failing, 2 skipped (unrelated, require a live DB); 10 pre-existing tests were updated because they hardcoded the old "atlas.\* is canonical" assumption, not because behavior regressed. `pnpm lint` clean. No live database seed/sync was run. Spec: `docs/superpowers/specs/2026-09-13-runly-catalog-default-design.md`; evidence: `docs/superpowers/plans/2026-09-13-runly-catalog-default.md`.

## Notifications across runtimes [WEB FIX VERIFIED; NATIVE BACKGROUND PENDING]

- [x] Preserve distinct Web Push endpoints with identical user-agents during registration and delivery.
- [x] Retry browser subscription synchronization after transient failures; isolate Web/PWA worker from native runtimes.
- [ ] Deploy web/API/worker changes and validate push on actual PWA installations.
- [ ] Configure FCM and implement native Android background delivery/call lifecycle; APNs/PushKit/CallKit remain future iOS work.

Verified: 2026-09-13 (35 backend/preparation and 18 browser/runtime/worker tests passed; Vite, ESLint, React Doctor 100/100; read-only production audit). Details: `docs/mobile/NOTIFICATIONS_AND_CALLS.md`. No production deployment or real-recipient test send.

## Atlas Native Host Android [IMPLEMENTED; ERP acceptance pending]

Spec: `docs/superpowers/specs/2026-09-11-atlas-native-host-design.md`. Evidence and operation: `docs/mobile/RUNLY_NATIVE_HOST.md`.

- [x] Remote Android host, local recovery, exact-origin IPC, centralized bridge and queued deep links.
- [x] ARM64 debug APK with production origin; x86_64 emulator verified bridge, media, notifications, deep links, external navigation and fallback.
- [x] Actual compiled SPA login/branding loaded in emulator using local nginx; no Desktop server picker.
- [x] Android Atlas launcher/splash generated from canonical vector; production CSP and login verified in emulator after branding update.
- [x] Android 1.1.0 native screen-video sharing and local call notification channels; isolated LiveKit/emulator verified reception, stop, denial and owner disconnect. Authenticated ERP acceptance remains pending.
- [ ] Validate authenticated session persistence, companies, chat/Realtime and LiveKit on physical devices.
- [ ] Release signing/distribution, iOS, FCM/APNs and native incoming-call integration (future milestones).

Verified: 2026-09-11 (9 native Node tests, 22 regression tests, 3 Rust tests, cargo check, Vite build, ESLint, React Doctor 98/100, nginx -t, Android Gradle builds and adb/CDP emulator checks). Full functional acceptance remains pending; no production deployment performed.

Verified: 2026-09-12 (70 call/native Node tests, 3 Rust tests, Vite build, ESLint, React Doctor without errors and one CallRoom complexity warning, Android ARM64/x86_64 builds, MediaProjection/LiveKit video received at 1080x2400, local notification importance/sound/vibration/dismiss and tap-to-deep-link queue). APK, web and API must all be updated; FCM is not implemented/configured.

- [x] Runtime server-connect (spec `docs/superpowers/specs/2026-09-22-android-runtime-server-connect-design.md`): `HostState.origin`, `host_connect`/`host_confirm_origin` IPC commands, `--universal` flag in `apps/desktop/scripts/native-host.mjs` — code confirmed present 2026-09-25 during a pending-work audit (this checkbox and its own `Verified:` line were never added when the feature shipped). Not independently re-verified here whether `docs/mobile/RUNLY_NATIVE_HOST.md` was updated as the spec asked, or whether its own Rust test suite was run at the time.

## Multi-tenant architecture

Spec: `docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md`. Plans: `2026-09-10-multi-tenant-plan-1-backend-foundation.md`, `...-plan-2-frontend-integration.md`, `2026-09-11-multi-tenant-plan-3-schema-identity.md`. This whole initiative had no entry in this file until this audit (2026-09-25) even though Plans 1–3 are implemented — added now for tracking, not because the work is new.

- [x] Plan 1 (backend foundation): `apps/api/src/lib/tenant-context.js` (active-company middleware) present in code — confirmed 2026-09-25
- [x] Plan 2 (frontend integration): `apps/desktop/src/components/CompanySwitcher.jsx` / `ActiveCompanyProvider` present in code — confirmed 2026-09-25
- [x] Plan 3 (schema/identity): `Role.companyId`, `CompanyModule` model in `prisma/schema.prisma` — confirmed 2026-09-25
- [x] Partial cross-tenant regression coverage: `apps/api/src/__tests__/cross-tenant/cross-tenant-security.test.js` exists, but is gated behind `RUN_CROSS_TENANT_TESTS=1` (skips against a live DB otherwise) — not the systematic suite spec §13 describes, and not run against a live DB during this audit
- [ ] **Plan 4 was never written** — the spec's own §10–14 describe it as "design only, implemented in Plan 4" (realtime isolation, storage/website/storefront scoping per tenant, worker/cache isolation, onboarding/invitations, the full cross-tenant test suite), but no `multi-tenant-plan-4-*` spec or plan exists in `docs/superpowers/`. Needs a decision: write Plan 4, or explicitly close this initiative as "3 of 4 phases shipped, single-tenant-per-install assumption accepted" and update the spec to say so.

## File-size debt cleanup (2026-09-25)

Triggered by a pending-work audit that found several CLAUDE.md "known violators" had grown instead of shrunk since first flagged. See CLAUDE.md's "Atomic file size limit" note for the authoritative current line counts — this entry is the changelog, not the source of truth for sizes.

- [x] `calendar-routes.js` (1040 → 632): Google Calendar OAuth/connect/sources/disconnect routes extracted to `calendar-google-routes.js`. Verified: 2026-09-25 (115 `node --test` pass, lint clean, boot smoke-test confirms both `/calendar/events` and `/calendar/google/*` routes respond)
- [x] `pos-routes.js` (806 → 559): floor plans/tables, kitchen stations/tickets, and reservations extracted to `pos-floor-routes.js`. Verified: 2026-09-25 (66 `node --test` pass, lint clean, boot smoke-test confirms 134 total routes mount including `/pos/floors`/`/pos/reservations`)
- [x] `ModuleCatalog.jsx` (1799 → 874): pure helpers → `lib/moduleCatalogHelpers.js`; `StatusPill`/`CardAction` → `components/ModuleCatalogCard.jsx`; the module detail Sheet + its `SheetActions` (the single largest chunk) → `components/ModuleDetailSheet.jsx`; the 3 destructive ConfirmDialogs + error Dialog → `components/ModuleCatalogDialogs.jsx`. Verified: 2026-09-25 (lint clean, `pnpm build:web` clean). No interactive browser QA performed this session — recommended before considering this screen's refactor fully closed.
- [x] `FormFields.jsx` (2633 → 35-line re-export barrel): split into `FormFieldsInput.jsx` (TextField/PasswordField/TextareaField/NumberField/CurrencyField), `FormFieldsDateSelect.jsx` (DateField/DateTimeField/YearField/SelectField/PhoneField), `FormFieldsToggleUpload.jsx` (CheckboxField/SwitchField/RadioGroupField/TagsField/DropzoneField), `FormFieldsRelation.jsx` (ComboboxField/RelationSelectField), `FormFieldsCreatable.jsx` (CreatableComboboxField/CarColorPickerField) — kept as a barrel (not deleted) because 8 other files in `packages/ui` import it by relative path, not just the public `@runly/ui` index. Verified: 2026-09-25 (lint clean; `pnpm build:web` caught one real mistake — `useIsolatedScroll` imported from the wrong module in `FormFieldsCreatable.jsx` — fixed, then clean; 35 adjacent `runly-renderer`/`components` tests still pass)
- [x] `apps/api/src/index.js` (6054 → 2306, 62% reduction): extracted `/companies`+`/company/*` → `routes/company-routes.js`; `/contacts/*` → `routes/contacts-routes.js`; `/hr/*` → `routes/hr-routes.js`; the entire `/identity/*` domain (roles, users, user-detail incl. the privilege-escalation-guarded `PATCH /identity/users/:id`, per-user permission-grants) → `routes/identity/` (`index.js` composer + `identity-shared.js` + 4 route files, each independently under 1000 lines). Shared helpers used by both an extracted route and a route still inline in `index.js` (`sendPasswordResetEmail`, `uploadIdentityAvatar`, `getSignedUrlByFileId`, `isForgotPasswordRateLimited` — the last is a stateful rate-limit Map that must stay a singleton, not a duplicated closure) moved to `lib/`, imported by both sides. `identity-permission-grants-routes.js` deliberately keeps the pre-extraction pattern of calling `getUserContext`/`resolveTenantContext` directly instead of `requirePermission()`, since `canManageUserGrants()` is a two-permission check, not a single key. Verified: 2026-09-25 (lint clean on every new file; real `node apps/api/src/index.js` boot + curl smoke tests against every extracted route including 401-gated `/identity/users/:id/permission-grants`; full suite `node --test` on `apps/api/src` — 1733/1734 pass, the one failure is `storefront-capture-foundation-contract.test.js` — pre-existing, about `runly.growth` manifest navigation, unrelated to this refactor). **Not done**: `index.js` is still over the 1000-line soft limit — `/profile/me/*`, `/auth/*`, `/setup/initialize`, `/realtime/*`, `/collaboration/invitations*` remain inline as the next extraction candidates. **Follow-up opportunity, not done this session**: now that `PATCH /identity/users/:id` lives in its own router factory (`identity-user-detail-routes.js`), an automated test for its privilege-escalation guard (membershipId-ownership + protected-role checks) is newly possible the same way `calendar-routes.js`/`pos-routes.js` are tested — still not written.

## Task completion policy

- Mark `[x]` only when the task has explicit verification evidence.
- Add a concrete verification line in the phase section using the format:
  `Verified: YYYY-MM-DD (commands/checks executed)`.
- If a task is implemented but not verified yet, keep it unchecked until validation is done.
- Prisma migration safety: never edit existing `prisma/migrations/**/migration.sql` after apply; always add a new forward migration.

## Security fix — atlas.ledger account isolation [COMPLETE]

Plan: `docs/superpowers/plans/2026-08-24-backlog-closure-and-security-hardening.md`

Found while auditing a user report that "everyone can see everyone's accounts". Confirmed real: `ledger_account.owner_id` was nullable with a documented-but-never-cleaned-up "NULL = visible to all company members" fallback (from migration `20260605000000_add_ledger_collaboration_tables`), and several route handlers never enforced per-account ownership at all.

- [x] `listAccounts`/`getAccount`/`canReadAccount`/`canWriteAccount` in `ledger-service.js`: removed the `owner_id IS NULL` public-fallback clause everywhere
- [x] `getAccount` now requires `actorId` (throws 401 instead of silently skipping the ownership filter) — this was being hit by every export/import route, which never passed `actorId` and could act on **any** company account
- [x] Added ownership/membership gates that were missing entirely: `PATCH /ledger/accounts/:id/enabled`, `PATCH .../transactions/:txId`, `PATCH .../transactions/:txId/enabled`, `GET .../transactions`, `GET .../summary`, `POST .../import/commit` — none of these checked `canReadAccount`/`canWriteAccount` before this fix
- [x] `collaboration-service.js` `listAccountMembers`: removed the same `owner_id IS NULL` fallback
- [x] Forward migration `20260824120000_ledger_account_owner_required`: backfills any remaining NULL `owner_id` to the company's earliest active `atlas.admin` member (deterministic, no per-environment hardcoding), drops the now-dead partial unique index, sets `owner_id NOT NULL`
- [x] `schema.prisma`: `LedgerAccount.ownerId` now non-nullable; added the missing `LedgerCategory.ownerId` field (schema drift vs. the real DB column added by `20260620000000_ledger_category_owner` — was never declared)
- [x] **Second, separate bug found in the same audit:** `apps/api/src/services/sync-service.js` — the offline-sync `/sync/pull` handler for `atlas.ledger` used the generic company-wide `makeHandler()` for `account`/`transaction`/`category`, which ignored ownership entirely. This is very likely the actual mechanism behind the reported symptom, since Phase 5 (offline Ledger SQLite cache) reads accounts/transactions straight from this synced cache in the desktop UI. Replaced with handlers that pre-resolve the accessible-account-id set (owner OR active account-member OR active group-member) before querying, and category sync now matches `categories-service.js`'s system-or-own rule. An existing test explicitly asserted the old (wrong) "must NOT filter by ownerId" behavior — rewritten to assert the fix instead.
- [x] Regression test added: `apps/api/src/routes/ledger/__tests__/ledger-service.test.js` (8 tests) asserts no code path re-emits an `owner_id IS NULL` bypass and that `getAccount`/`createAccount` reject missing actor/owner
- [x] `sync-service.test.js` updated: 6 `atlas.ledger module` tests now assert accessible-id scoping instead of the old company-wide behavior

Verified: 2026-08-24 (`pnpm db:generate`, `pnpm db:migrate` → migration applied clean against live dev DB, re-query confirms 0 remaining NULL-owner rows and the pre-existing orphan account correctly attributed to the company's first admin; `pnpm exec prisma validate` → schema valid; `node --test apps/api/src/routes/ledger/__tests__/*.test.js` → 18/18 pass; `node --test apps/api/src/services/__tests__/sync-service.test.js` → 23/23 pass; `node --test apps/api/src/services/__tests__/rbac-granular-contract.test.js` → 5/6 pass, the 1 failure is the pre-existing unrelated calendar/catalog/inventory/notes permission-catalog drift already documented elsewhere in this file, untouched by this change; `pnpm --filter @atlas/desktop build:web` → built clean; `node --check` on every modified file)

Checked in the same pass: the `atlas-notes` Supabase Storage bucket is **public** (confirmed via `storage.listBuckets()`). This looked like the same bug class at first, but project memory confirms it was a deliberate 2026-08-03 user decision (permanent embedded-image URLs over expiring signed URLs, same tradeoff as `atlas-files`) — not touched. `atlas-chat` bucket confirmed to already exist and already be private — no action needed, closes that pending TASKS.md item.

## atlas.pos — Restaurant POS

Specs: `docs/superpowers/specs/2026-06-21-atlas-pos-core-design.md`, `2026-06-29-pos-waiter-split-bill.md`
Plans: `docs/superpowers/plans/2026-06-21-atlas-pos-plan-a-core-backend.md`, `...-plan-b-ui.md`, `...-plan-c-floor-planner.md`, `2026-06-22-pos-reservations.md`, `2026-06-29-pos-waiter-plan-a-backend.md`, `...-plan-b-ui.md`
Stabilization: `docs/superpowers/specs/2026-07-17-post-pause-stabilization-design.md` + plan of same name

- [x] Core backend: sessions, stations, tables, orders, payments (`apps/api/src/routes/pos/`)
- [x] Screens: `PosFloorPlannerScreen`, `PosOrdersScreen`, `PosSessionsScreen`, `PosSettingsScreen`, `PosStationsScreen`, `PosTablesScreen`, `PosTerminalScreen`
- [x] Reservations (`20260622100000_pos_reservations`, `pos-reservation-service.js`, `usePosReservation`)
- [x] Waiter assignment: auto-claim on order open, auto-clear on AVAILABLE, mis-mesas filter, waiter chip (`20260629120000_pos_waiter_split_bill`)
- [x] Split bill: per-seat totals, `SplitBillDialog`, mesa-completa/dividir-cuenta toggle in `PaymentDialog`
- [x] Backend tests: waiter assignment, seat totals, mis-mesas, auto-claim, 404 unknown waiter
- [x] Manual QA: waiter chip + mis-mesas flow in browser
- [x] Manual QA: split-bill payment flow in browser (degenerate "Sin asignar" case only — see pending seat UI below)
- [x] Smoke + commit of transform-based pan/zoom refactor in `FloorOperationalCanvas.jsx` (commit `12af733`)
- [x] F1-A Money containers (rework spec `2026-07-17-pos-role-based-rework-design.md`): `PosWaiterShift` model + migration `20260717120000_pos_rework_f1_money_containers`, payment session/shift attribution in `addPayment`, outlet behavior flags, shift routes + SDK methods, 10 role-post permission keys seeded
- [x] F1-B Role-post navigation: manifest nav replaced with Caja/Comandero/Cocina/Ordenes/Administracion, `PosHomeRedirect` permission landing, wrapper screens over existing UIs, outlet flags editor in Administración. (Correction 2026-07-18: legacy URLs are BLOCKED by the navigation gate with fresh cache — the F1-B QA saw stale cached nav; accepted as end state, see decision log `2026-07-18-pos-rework-f2-decision.md`)
- [x] F2-A Modifiers engine (spec `2026-07-18-pos-rework-f2-comandero-design.md`): 3 modifier tables + migration `20260718120000_pos_rework_f2_modifiers`, `pos-modifier-service.js` with `resolveSelection` (min/max/required + price deltas), `addOrderLine` prices from `catalogPrice`+deltas in a transaction with immutable snapshots (client price ignored when groups exist), hydrated lines and kitchen tickets expose `modifiers`+`note` (kitchen `listTickets` now includes lines), 6 catalog routes + SDK methods

Verified F2-A: 2026-07-18 (migration applied → `prisma migrate status` 52 migrations up to date; `node --test "apps/api/src/routes/pos/__tests__/*.test.js"` → 51 tests / 51 pass / 11 suites; API boot → /health 200, GET /pos/modifier-groups 401 sin token (ruta registrada y protegida); commits `56951ba`,`3107f17`,`61bb418`,`5fb17ce`,`89c1a2b`,`927bb9e`)

- [x] F2-B Comandero móvil: floor en modo comandero → editor de comandas `/pos/comandero/mesa/:tableId` (chips de comensales, ModifierSheet con validación mín/máx/requerido y precio en vivo, notas por línea, líneas agrupadas por persona), tab Modificadores en Administración, cobro dividido real por asiento vía corte de mesero
- [x] F3 Caja/Mostrador (spec `2026-07-18-pos-rework-f3-caja-design.md`, zero-migration): atribución de pagos a la sesión de caja (`PaymentDialog`/`SplitBillDialog` con `sessionId` opcional; comandero intacto), `closeSession` suma por `PosPayment.sessionId` + entregas `WAITER_DELIVERY`, panel "Cortes de meseros" con recepción de cortes, historial de cajas en `/pos/caja/historial`, modo del terminal por sucursal (`PosOutlet.mode`)
- [x] Cosmetic F3: el preview "Efectivo esperado" del diálogo Cerrar caja muestra $0.00 — Verified: 2026-08-24 (nuevo endpoint `GET /pos/sessions/:id/expected-cash` reutiliza el cálculo de `closeSession`; ver `docs/superpowers/plans/2026-08-24-backlog-closure-and-security-hardening.md` §3)
- [ ] F3 not exercisable in dev: modo RETAIL/Mostrador por sucursal implementado pero sin sucursal RETAIL en datos dev para QA de navegador

Verified F3: 2026-07-18 (`node --test "apps/api/src/routes/pos/__tests__/*.test.js"` → 54/54 en 11 suites; builds limpios; Playwright QA — Caja: botones Cortes(badge)/Historial visibles, `/pos/caja/historial` renderiza sin "Acceso restringido"; cobro en caja → POST /payments body `{"paymentMethodId":...,"amount":32,"sessionId":"019f1674..."}` → 201; recepción de corte de mesero $35 → POST waiter-shifts/:id/close 200; cierre de caja → 200 con `expectedCashAmount: 2067` = 2000 fondo + 32 efectivo caja + 35 entrega mesero (matemática exacta e2e); regresión comandero móvil: pago SIN sessionId → 201 (ruta de corte intacta); commits `127b2d7`,`65388dc`,`16e4de4`,`774c35d`)
- [x] F4 Cocina (spec `2026-07-18-pos-rework-f4-cocina-design.md`, zero-migration): fallback a `defaultStationId` de la sucursal en send-to-kitchen (el 400 solo queda sin default), gestión producto↔estación (GET /pos/product-configs + PUT /pos/products/:id/config + panel "Asignación de productos" en Estaciones), KDS con nombre/cantidad/modificadores/nota por línea (la nota se leía de un campo equivocado — siempre vacía; corregido). Impresión de cocina diferida a futuro por decisión de spec F4.
- [x] **POS role-based rework F1–F4 COMPLETE** (master spec `2026-07-17-pos-role-based-rework-design.md` → Complete)
- [x] Post-F4 fix: `PosFloorPlannerScreen` quedó huérfano de navegación tras F1-B (regresión reportada por el owner) — remontado en `/pos/admin/planos` con botón "Editor de planos" en el header de Configuración POS. Verified: 2026-07-18 (Playwright: botón visible → navega → "Diseñador de planos" renderiza con selector de sucursal)
- [ ] Watch item: la navegación de atlas.pos en BD apareció revertida a la versión de 7 entradas durante el QA de F4 (2026-07-18); `pnpm db:seed` la restauró y un reinicio del API NO la revierte — causa raíz no identificada; si reaparece, auditar escritores de `AtlasModule.manifest`

Verified F4: 2026-07-18 (`node --test "apps/api/src/routes/pos/__tests__/*.test.js"` → 60/60 en 11 suites; builds limpios; Playwright QA — Estaciones: panel "Asignación de productos" visible, Gordita→TACOS PUT 200 y persiste tras recarga, limpiada a "Sin estación"; comanda móvil con "Extra queso"+nota → Enviar a cocina → 200 con ticket (fallback a TACOS; el 400 de F2 eliminado) + toast "Comanda enviada a cocina"; KDS /pos/cocina estación TACOS → ticket "1× Gordita de chicharron | · Extra queso | aparte la salsa" con columnas Pendiente/En preparación/Listo → "Iniciar" PATCH 200; orden cobrada y mesa liberada al final; commits `3549e82`,`a408c48`,`7fc8e19`,`b6239f4`)

Verified F2-B: 2026-07-18 (build limpio; Playwright QA — admin desktop: grupo "Salsa" [Requerido · mín 1/máx 2] con opciones Verde +$0 y Extra queso +$10 creado vía UI (POST 201 ×3); móvil 390×844: comandero → Mesa 1 → orden creada (POST /pos/orders 201) + 2 comensales (POST guests 201 ×2) → ModifierSheet con "Agregar" deshabilitado hasta cumplir grupo requerido → seleccionar Extra queso → "Agregar $35.00" → línea bajo PERSONA 2 con "· Extra queso · aparte la salsa" y total $35.00 (POST lines 201) → Dividir cuenta muestra "Persona 2 · 1 producto · $35.00" (sin caso degenerado) → Cobrar esta cuenta (POST payments 201) → orden cerrada y Mesa 1 → SUCIA en el plano; send-to-kitchen 400 esperado con mensaje accionable (ver decision log); cero errores de consola en todos los pasos; commits `f3f8ff8`,`ca9ca3b`,`d26a496`,`2f84118`,`12df3e5`)
- [x] Cosmetic (pre-existing, commit `a45a256`): `helperText` prop leaks to DOM in PosSettingsScreen tax field → React warning in console — Verified: 2026-08-24 (not a supported TextField prop; fixed to `hint` in both occurrences, see backlog plan §3)

Verified F1-B: 2026-07-18 (`pnpm.cmd db:seed` → nav reseeded; atlas-pos contract test 3/3; `pnpm.cmd --filter @atlas/desktop build:web` → built clean; Playwright QA: `/app/m/atlas.pos` lands on `/pos/caja`, sidebar shows exactly the 5 posts, legacy routes `/pos/terminal|tables|sessions|settings` still render, Comandero opens the floor without terminal gate, outlet "Permitir cobro en mesa" toggle → PATCH /pos/outlets 200 and persists after reload [left ON for El Pitillal to enable F2 testing]; only console warning is the pre-existing helperText issue; commits `bb81490`,`040a682`,`053528d`)
- [x] Wire guest/seat management UI in the terminal — Verified: 2026-08-24 (`SeatChips` + `LineEditSheet`'s seat selector, both already built for Comandero, wired into `PosTerminalScreen`/`OrderPanel`; per-seat split bill now reachable from the classic terminal too; see `docs/superpowers/plans/2026-08-24-backlog-closure-and-security-hardening.md` §3)
- [x] Fix silent no-op in `SplitBillDialog.handleChargeSeat` when no payment method is configured — Verified: 2026-08-24 (button disables with hint + warning banner, see backlog plan §3)
- [x] Cosmetic: in mis-mesas mode, filtered-out tables render as pale "Disponible" ghosts instead of their true status — Verified: 2026-08-24 (backend no longer filters tables out of the query; canvas + list view dim non-mine tables using their real status, see backlog plan §3)
- [x] Resuming an existing order on a table whose status had drifted back to AVAILABLE did not re-occupy it (only order *creation* set OCCUPIED + waiterId) — Verified: 2026-08-24 (new `POST /pos/orders/:id/claim`, idempotent, wired into both the desktop terminal and mobile Comandero resume paths, see backlog plan §3)
- [ ] Full restaurant-flow QA with kitchen stations configured (send-to-kitchen returned 400 in dev because products lack an assigned preparation station — error message is correct and actionable)

Verified F1-A: 2026-07-18 (migration `20260717120000_pos_rework_f1_money_containers` applied → `prisma migrate status` "Database schema is up to date!" with 51 migrations; `node --test "apps/api/src/routes/pos/__tests__/*.test.js"` → 39 tests / 39 pass across 9 suites; `pnpm.cmd db:seed` → "Atlas modules seeded (20)"; `rbac:verify-catalog` → none of the 10 new pos.* keys missing (47 pre-existing calendar/catalog/inventory/notes drift untouched); API boot → GET /health 200, GET /pos/waiter-shifts 401 without token confirming guarded route registration; commits `20422aa`,`24eb9e5`,`20643ca`,`6e7b3bb`,`b9d8f9c`,`9afa6d6`)

Verified: 2026-07-17 (`pnpm.cmd exec prisma migrate status` → "Database schema is up to date!" with all 50 migrations applied incl. `20260629120000_pos_waiter_split_bill`; `node --test "apps/api/src/routes/pos/__tests__/*.test.js"` → 31 tests / 31 pass / 0 fail; `pnpm.cmd --filter @atlas/desktop build:web` → built in 3.46s; Playwright browser QA against localhost:5173: canvas fit-to-content 80% + wheel zoom to 92% + pan + fit button OK with zero console errors; new dine-in order on available table auto-claimed table (chip "RB" with title "Raul Belloso Medina" in DOM), mis-mesas dimmed the non-assigned table, full payment via Efectivo → table SUCIA → "Marcar como lista" → AVAILABLE cleared the chip; split-bill dialog showed correct "Sin asignar" seat total $128 and POST /payments 201 closed the dialog and transitioned the table)

## atlas.chat — Realtime Chat

Specs: `docs/superpowers/specs/CHAT_SPEC.md`, `2026-06-28-chat-improvements-a-backend.md`, `...-b-frontend.md`, `2026-06-28-realtime-layer-unificado-design.md`, `2026-06-26-realtime-v2-design.md`
Plans: `docs/superpowers/plans/CHAT_IMPLEMENTATION_PLAN.md`, `2026-06-28-chat-improvements-plan-a.md`, `2026-06-28-realtime-layer-plan-a-api.md`, `...-plan-b-frontend.md`, `2026-06-26-realtime-v2-plan-a-api.md`, `...-plan-b-frontend.md`

- [x] Chat tables + evolution migrations (`20260625000000_add_chat_tables` → `20260629130000_chat_archive`: attachments, tracking code, expiry email flag, archive, available_for_chat)
- [x] Internal chat: `ChatScreen`, conversations, members, typing, presence (Supabase Realtime)
- [x] External guest chat: `ExternalInboxScreen`, storefront-sdk `ChatWidget` guest flow (v0.5.2)
- [x] External chat feature parity (spec/plan `2026-09-08-external-chat-feature-parity*`): operator `ExternalInboxScreen` now renders the full `ChatWindow` via `variant="external"` (history pagination, reply, in-conversation search, delete/forward/select, attachment viewer, files view, "el visitante está escribiendo", "Visto por el visitante"); dead in-app `ExternalChatWidget` removed; guest-attachment `message_id` link bug fixed; new endpoints — public attachment signed-URL, guest+operator typing, guest read receipt, operator message delete; migration `20260908100000_chat_guest_last_read` applied; storefront `ChatWidget` gained inline image/file previews + operator-typing + "Visto". Verified: 2026-09-08 (`node --test apps/api/src/routes/chat/__tests__/*.test.js` → 290 pass; new suites `guest-attachment-link`/`external-chat-realtime`/`guestChat`/`useExternalChatData` green; `pnpm build` full Tauri bundle clean; `pnpm lint` clean. Pre-existing unrelated failure: `packages/storefront-sdk/src/__tests__/react-exports.test.js` needs a JSX loader Node lacks — red before this work. No browser/on-device QA performed.)
- [x] Message templates: `ChatTemplatesScreen`; forward message modal
- [x] Unified realtime layer (2026-06-28 plans A/B)
- [x] Message search — `chat-search-service.js` + `apps/api/src/routes/chat/__tests__/chat-search-service.test.js` + `MessageSearchResults.jsx` (created 2026-09-14, this checkbox was never flipped at the time). Verified: 2026-09-25 (files present, re-confirmed against current code during a pending-work audit; no fresh test run recorded beyond the existing suite)
- [x] Notification integration: unread badge in topbar — `ChatBell.jsx` + `useChatUnreadCount()` (sums `unread_count` across non-muted conversations from the existing `useChatConversations` query, no new backend endpoint) wired into `Topbar.jsx` next to `NotificationBell`, gated on `chat.conversations.read`. Also added a matching unread badge on the external guest-chat widget's own closed launcher tab (`ChatWidget.jsx`), which previously only played a sound. Verified: 2026-09-25 (`pnpm lint` clean on changed files; existing `runly.chat` lib suite still green, 71 pass; no browser/on-device QA performed)
- [x] Confirm `atlas-chat` bucket exists in Supabase Storage — Verified: 2026-08-24 (`storage.listBuckets()` → `atlas-chat` present, `public=false`)

Verified: 2026-07-17 (migrations confirmed applied via `prisma migrate status`; module active in dev use since 2026-06-25; no formal browser verification run recorded)

### Channels & Roles — Phase A (foundation)

Spec: `docs/superpowers/specs/2026-08-25-chat-channels-roles-phase-a-design.md`
Plan: `docs/superpowers/plans/2026-08-25-chat-channels-roles-phase-a.md`

First of six planned phases toward a Discord/WhatsApp-style ecosystem (channels, groups, mentions, roles/permissions, rich messages, threads, cross-module references). This phase: data model + permission engine only, no UI.

- [x] `chat_channel_roles` table, `channel` conversation type, `is_public`/`slug`/`description` columns, `role_id` on members, backfill of pre-existing `group` conversations onto 4 default roles (migration `20260825000000_chat_channels_roles`)
- [x] Permission catalog + default role definitions (`chat-permissions-service.js`): `CHAT_PERMISSIONS`, `DEFAULT_CHANNEL_ROLES` (Owner/Admin/Moderator/Member), deep-frozen against accidental mutation
- [x] Role engine: `listRoles`/`createRole`/`updateRole`/`deleteRole` (transactional reassignment)/`assignMemberRole` with position-hierarchy enforcement, self-demotion allowed, Owner-role grant restricted to existing Owners, last-Owner-removal guard
- [x] `chat-service.js` wiring: `createConversation` populates `company_id` (previously always NULL) and seeds roles transactionally; `addMembers` backfills default role; `removeMember` blocks removing the last Owner
- [x] `channel-directory-service.js`: company-scoped public channel directory + join flow (cross-tenant join gap found and closed during review — see decision note below)
- [x] 8 new HTTP routes: `POST /chat/channels`, `GET /chat/channels/directory`, `POST /chat/conversations/:id/join`, `GET/POST /chat/conversations/:id/roles`, `PATCH/DELETE /chat/conversations/:id/roles/:roleId`, `PATCH /chat/conversations/:id/members/:memberId/role`
- [x] SDK methods for all 8 endpoints (`packages/sdk/src/domains/chat.js`)
- [x] `addMembers`/`removeMember`/`updateConversation` enforce `members.manage`/`channel.manage` for `channel`/`group` conversations (found missing in final whole-feature review — see below); `removeMember` adds rank-hierarchy enforcement with self-removal always exempt
- [ ] Manual live-HTTP smoke test (deferred — requires an authenticated dev session; automated + code-review verification below covers correctness, but no real end-to-end HTTP request was made against a running server)

Built via `superpowers:subagent-driven-development` — fresh implementer + spec-compliance reviewer + code-quality reviewer per task, across 10 tasks, plus a final whole-feature review pass. Review caught and fixed 8 real issues before this was called done: a non-transactional `deleteRole`, a non-transactional role-seed in `createConversation`, a `company_id = NULL` SQL comparison bug (twice — once in slug dedupe, once in `joinChannel`'s cross-tenant check), a shallow-freeze mutability hole in `DEFAULT_CHANNEL_ROLES`, a shared-cache test-isolation bug, a cross-tenant channel-join authorization gap (two rounds — the first fix was itself incomplete for companyless callers), and — found only by the final whole-feature pass, after all 10 tasks individually passed their own reviews — a missing `members.manage`/`channel.manage` enforcement gap on the pre-existing `addMembers`/`removeMember`/`updateConversation` endpoints that would have let any member, regardless of rank, add/remove members or rename a channel.

Verified: 2026-08-25 (`node --test apps/api/src/routes/chat/__tests__/chat-service.test.js apps/api/src/routes/chat/__tests__/chat-permissions-service.test.js apps/api/src/routes/chat/__tests__/channel-directory-service.test.js` → 46/46 pass; `pnpm build` → clean, full Tauri bundle produced; `pnpm db:migrate` applied; post-migration sanity queries confirm zero orphaned `role_id`s and zero conversations with a role count other than 4; final whole-feature code review signed off as ready for Phase B)

### Channels & Roles — Phase B (channel/group UX)

Spec: `docs/superpowers/specs/2026-08-25-chat-channels-ux-phase-b-design.md`
Plans: `docs/superpowers/plans/2026-08-25-chat-channels-ux-phase-b-plan-a-backend.md`, `...-plan-b-frontend.md`

Second of six planned phases. Builds the UI Phase A shipped no frontend for.

- [x] `GET /chat/conversations/:id` exposes each member's role (`roleId`/`roleName`/`roleColor`/`rolePosition`/`roleIsSystem`) via a `LEFT JOIN chat_channel_roles`
- [x] `CreateChannelModal` (title/description/public-private/slug) wired into a new sidebar "+" dropdown (Nueva conversacion / Crear canal / Explorar canales)
- [x] `ChannelDirectorySheet` — cursor-paginated public channel browser with join
- [x] `ChannelDetailsSheet` (Miembros + Roles tabs, opened from the chat window's previously-inert "Ver miembros" item) with `ChannelMembersTab` (role badges, add/remove members, assign roles) and `ChannelRolesTab` + `RoleEditorDialog` (create/edit/delete roles, permission checkboxes)
- [x] Client-side `chatPermissions.js` mirrors the backend's permission catalog for UI gating only (backend remains sole enforcement authority)
- [ ] Manual browser QA at 390px/1440px (deferred, same reason as Phase A — no authenticated dev session available in this pass; `pnpm build` + code review cover static correctness)

Built via `superpowers:subagent-driven-development`, same process as Phase A. Review caught and fixed 3 real issues: two instances of the plan's own example code gating a mutating UI action (assign-role, create/edit/delete-role) on `members.manage` instead of the backend's actual `roles.manage` requirement, and a spec requirement ("Añadir miembros" button reusing `CreateChatModal`'s user-picker) that the plan's own example code omitted entirely — closed with a follow-up `AddChannelMembersDialog` + extracted shared `UserPicker.jsx`.

Verified: 2026-08-25 (`pnpm build` → clean, full Tauri bundle produced, across every task; final code review confirmed no permission-gating drift across the whole phase and signed off as complete relative to spec)

### Channels & Roles — Phase C (mentions)

Spec: `docs/superpowers/specs/2026-08-25-chat-mentions-phase-c-design.md`
Plans: `docs/superpowers/plans/2026-08-25-chat-mentions-phase-c-plan-a-backend.md`, `...-plan-b-frontend.md`

Third of six planned phases. Reuses `@atlas/ui`'s existing `MentionTextarea`/`renderMentionText` (already used by `atlas.projects`) — no changes to that package. Roles and `@everyone`/`@here` ride the same `@[id:name]` token format via two fixed sentinel UUIDs. No new tables — mentions stored in `chat_messages.metadata.mentions`.

- [x] `chat-mentions-service.js`: parses/classifies/resolves mentions (user, role → all active holders, `@everyone`/`@here` gated on the sender's `mentions.everyone`/`mentions.here` permission), deduplicates recipients
- [x] `sendMessage` stores `metadata.mentions` and fans out a distinct `chat.mention.new` notification (high priority) separate from the generic `chat.message.new` (mentioned recipients excluded from the generic one)
- [x] `useMentionCandidates` hook builds the composer's autocomplete list (members + roles + permission-gated everyone/here), excluding guest (non-authenticated) chat participants
- [x] `MessageComposer` swapped to `MentionTextarea`; `ChatMessageBubble` and 3 preview surfaces (`FloatingChatHub`, `ExternalInboxScreen`, `ForwardMessageModal`) render mention chips instead of raw `@[uuid:name]` tokens; mentioned-viewer messages get a highlight
- [ ] Manual browser QA (deferred, same reason as Phases A/B)

Built via `superpowers:subagent-driven-development`. Review caught and fixed 6 real issues: a malformed-but-regex-matching mention token could throw an unguarded Postgres UUID-cast error and fail the entire message send (now wrapped in try/catch with a safe fallback, plus a cheap pre-check avoiding a wasted DB round-trip on every mention-free message — the common case); a test fixture that never actually exercised the real parsing regex (twice — once in the backend service's own tests, once in `chat-service.test.js`'s `sendMessage` tests); a customer-facing bug where an operator could select a guest (anonymous website visitor) from the mention picker and send garbled `@[Usuario]` literal text to that visitor; a claimed "can't be cleanly styled" that turned out false (`MentionTextarea` does forward `className`, fixed with Tailwind v4's trailing-`!` important modifier); and — the most significant — the initial mention-chip rendering fix only patched the system-message branch of `ChatMessageBubble.jsx`, missing that real user messages render through a different, always-active code path (`HighlightedText`, called unconditionally regardless of search state), so mentions would have displayed as raw literal tokens to every viewer in the actual common case.

Verified: 2026-08-26 (`node --test` across all 4 chat backend test files → 60/60 pass; `pnpm build` / `pnpm --filter @atlas/desktop exec vite build` → clean on every task; independent code review verified the critical send-failure fix, the guest-mention fix, and the mention-chip rendering fix each by tracing the actual code path, not just reading the diff)

### Channels & Roles — Phase D (pinned messages & reactions)

Spec: `docs/superpowers/specs/2026-08-26-chat-pins-reactions-phase-d-design.md`
Plans: `docs/superpowers/plans/2026-08-26-chat-pins-reactions-phase-d-plan-a-backend.md`, `...-plan-b-frontend.md`

Fourth of six planned phases. Enforces the `messages.pin` permission (defined but unused since Phase A) and adds unprivileged emoji reactions, reusing `emoji-picker-react` (already a dependency, already used by `MessageComposer`'s own emoji button).

- [x] `chat_messages.pinned_at`/`pinned_by_user_id` (nullable) and new `chat_message_reactions` table, unique on `(message_id, user_id, emoji)` for toggle semantics (migration `20260826000000_chat_pins_reactions`)
- [x] `chat-reactions-service.js`: `toggleReaction` (add/remove based on existing-row check)
- [x] `chat-service.js`: `pinMessage` (permission-gated via `messages.pin` for `channel`/`group` only; any active member may pin in `direct`/`external_support`, matching those types having no role system), `listPinnedMessages`; `listMessages`/`getMessageFull` gained `pinnedAt`/`pinnedByUserId` and a `reactions` aggregation subquery (`json_agg` grouped by emoji, validated against a real throwaway Postgres container, not just the mock test suite)
- [x] 3 new routes: `PATCH /chat/messages/:id/pin`, `GET /chat/conversations/:id/pinned-messages`, `POST /chat/messages/:id/reactions`
- [x] `usePinMessage`/`useToggleReaction`/`usePinnedMessages` hooks; `MessageReactions` (pill row, grouped, "you reacted" highlight) and `MessageReactionPicker` extracted as separate components from the start (`ChatMessageBubble.jsx` was already ~926 lines)
- [x] `MessageActions` gained "Fijar/Desfijar mensaje" (permission-gated, `channel`/`group` only) and "Reaccionar" (unprivileged, every conversation type) items; reaction pills + pinned indicator render in both own-message and other-message bubble branches
- [x] `PinnedMessagesSheet` (same `Sheet` pattern as `ChannelDetailsSheet`) reachable from a new header button with a pinned-count badge; "Ver en el chat" reuses/extends the existing search-jump-to-match scroll mechanism (a second, independent `scrollToMessage`-keyed effect in `ChatMessageList`, kept separate from search's yellow-highlight semantics)
- [ ] Manual browser QA (deferred, same reason as Phases A–C)

Built via `superpowers:subagent-driven-development`. Review caught and fixed 6 real issues, the most severe on the highest-risk task (wiring pin/react into the bubble): `canPin` was permanently `false` for every user in the actual chat window, because `ChatWindow` sourced `members` from the conversation-*list* preview query (no role/permission fields) instead of the detail query, and even the detail query's own SQL never selected `ccr.permissions` in the first place — both layers had to be fixed together. The same reaction wiring never reached `FloatingChatHub`/`ExternalInboxScreen`, which render full message threads through the identical `ChatMessageList`/`ChatMessageBubble` pipeline as the main chat window but hadn't been passed the new props — the "Reaccionar" menu item rendered anyway and silently no-op'd on pick, the exact reached-one-path-not-another failure mode Phase C's own review had already caught once. Also fixed: a hand-rolled `absolute`-positioned emoji-picker popover that would clip against `ChatMessageList`'s scroll container for messages near the top of the viewport (replaced with `@atlas/ui`'s existing Radix-based `Popover`, portaled to `<body>`); a gating inconsistency where reaction *display* was allowed on any non-deleted message but the "Reaccionar" *trigger* required message text, silently blocking reactions on attachment-only messages; and an unconditional `usePinnedMessages` fetch firing on every conversation open regardless of type, wasting a request on every `direct`/`external_support` conversation where pinning is never offered.

Verified: 2026-08-26 (`node --test apps/api/src/routes/chat/__tests__/*.test.js` → 65/65 pass, including new regression coverage for the `rolePermissions` field; `pnpm --filter @atlas/desktop exec vite build` → clean on every task and every fix; two independent review passes on the bubble-wiring task alone — first found 4 issues, second confirmed all 4 fixed with no new regressions by tracing the actual code paths, not just re-reading the diff)

### Channels & Roles — Phase E (threads)

Spec: `docs/superpowers/specs/2026-08-26-chat-threads-phase-e-design.md`
Plans: `docs/superpowers/plans/2026-08-26-chat-threads-phase-e-plan-a-backend.md`, `...-plan-b-frontend.md`

Fifth of six planned phases. Lets a member reply "in thread" to a message in a `channel`/`group` conversation — a flat, one-level-deep side-conversation anchored to that message. Replies never appear in the main timeline; the root shows a "N respuestas" pill. Only thread participants (root author + prior repliers) are notified of a new reply, not the whole channel.

- [x] `chat_messages.thread_root_id`/`thread_reply_count`/`thread_last_reply_at` (migration `20260827000000_chat_threads`), self-referencing FK with `ON DELETE CASCADE`
- [x] `sendMessage` extended with an optional `threadRootId`: auto-flattens a reply-to-a-reply onto its original ancestor (threads don't nest), rejects a `threadRootId` from a different conversation or a soft-deleted target with 404, and — added after review — rejects one from a `direct`/`external_support` conversation too (threads are `channel`/`group` only; the initial implementation only checked conversation-id match, not type, so a direct API call could otherwise create a reply that would silently vanish from a 1:1 timeline with no thread UI able to surface it)
- [x] Insert + root counter-increment wrapped in a `$transaction` for a thread reply only (the non-threaded send path is untouched); `deleteMessage` decrements the root's counter (floor-guarded at 0) when the deleted message is itself a reply
- [x] Notifications branch: a thread reply fires a new `chat.thread.reply` event to participants only, never the generic `chat.message.new` to the whole channel; `@mentions` inside a reply still fire `chat.mention.new` unconditionally on top — participant recipients are intersected against currently-active membership (added after review — the initial version derived recipients purely from thread message history, so a member who replied and later left the conversation would have kept receiving thread notifications indefinitely)
- [x] `listMessages`/`listConversations`' `unread_count`/`last_message` subqueries gained `thread_root_id IS NULL`; every other `chat_messages` call site in the file (`getMessageFull`, `editMessage`, `pinMessage`, `listPinnedMessages`, `listExternalInbox`) was individually audited and deliberately left untouched (enumerated up front in the spec, matching Phase D's own risk-mitigation approach)
- [x] `listThreadReplies` (backs `GET /chat/messages/:id/thread`, auto-flattens a reply id to its root, same non-leaking 404-for-non-members convention as `pinMessage` — folded into the lookup's own `INNER JOIN` rather than a separate `assertMember` call after a first version leaked a distinguishable 403 to non-members, found by review) reuses `getMessageFull` per row, same accepted N+1 pattern as `listPinnedMessages`
- [x] `useThreadReplies`/`useSendThreadReply` hooks — the send hook deliberately does not reuse `useSendMessage`, whose optimistic update targets the main timeline's own query cache and would have flashed a reply into the main view before the next fetch corrected it
- [x] `ThreadPanel` (`Sheet`, same pattern as `PinnedMessagesSheet`) reuses `ChatMessageBubble` for the root and each reply
- [x] `MessageActions` gained "Responder en hilo" (channel/group only, hidden on a message that's already a reply or already inside a thread panel); reply-count pill renders in both own-message and other-message branches, gated on `onOpenThreadForMessage` being supplied so it doesn't render as a dead control in `FloatingChatHub`/`ExternalInboxScreen` (neither wires thread support — a documented scope cut, not a regression)
- [x] `PinnedMessagesSheet`'s "Ver en el chat" now opens `ThreadPanel` instead of attempting a scroll when the pinned message is itself a thread reply (a reply never renders in the main timeline, so the pre-existing `scrollToMessage` DOM-query mechanism could never have found it)
- [ ] Manual browser QA (deferred, same reason as Phases A–D)

Built via `superpowers:subagent-driven-development` across 8 tasks (4 backend, 4 frontend). Review caught and fixed 5 real issues: a vacuous test whose own inline comment claimed to prove a code path was skipped, when the mock it used silently no-ops on an unaccounted-for call instead of failing (the exact "test that would pass even if the code were broken" anti-pattern this project's review process exists to catch); the thread-notification membership gap and the non-leaking-404 gap described above; and the channel/group-only enforcement gap, also described above. None were the Phase-C/D-style "reached one render branch but not the other" failure mode this phase's plan was most explicitly primed to watch for — the reply-count pill and its gating were independently re-derived from the diff and confirmed byte-for-byte identical across both bubble branches on the first pass.

Verified: 2026-08-26 (`node --test apps/api/src/routes/chat/__tests__/*.test.js` → 81/81 pass, including dedicated regression coverage for the membership-exclusion fix, the channel/group-only rejection, and the non-leaking-404 fix; `pnpm build` / `pnpm --filter @atlas/desktop exec vite build` → clean on every task and every fix; every task independently reviewed for spec compliance and code quality before being marked done)

### Channels & Roles — Phase F (cross-module entity references) — final phase of the 6-phase roadmap

Spec: `docs/superpowers/specs/2026-08-27-chat-entity-references-phase-f-design.md`
Plans: `docs/superpowers/plans/2026-08-27-chat-entity-references-phase-f-plan-a-backend.md`, `...-plan-b-frontend.md`

Preliminary fix, required first: `docs/superpowers/specs/2026-08-27-contacts-detail-route-design.md` / `...-plan.md` — `atlas.contacts` had no `GET /:id` endpoint and no single-record URL (row clicks opened a modal with no URL change at all), the one gap blocking this phase's original "any installed module's entity" framing. Added `GET /contacts/:id` and `/app/m/atlas.contacts/contacts/:id` (reusing the existing edit sheet, URL-aware open/close); review found the mutation-success close paths bypassed the URL-clearing logic (fixed by routing every close through one shared `closeSheet()` helper).

This phase itself was rescoped mid-design: research found the roadmap's original "any blueprint ENTITY, automatically" framing doesn't hold against the current codebase — `ENTITY` blueprints carry no title field or API path, and (before the Contact fix above) most modules lacked even a single-record route. Put to the user directly (the one AskUserQuestion of this whole 6-phase effort, since it changes what "generic" means for the phase): ship a real, working feature for the entity types that already have a working `GET /:id` + detail route, or spend more time building routes for others first. User chose the latter for Contact; the result is a small, explicit, config-driven registry of 4 types (`Contact`, `FileAsset`, `LedgerAccount`/`FinanceAccount`, `HrEmployee`) rather than true blueprint-driven automatic discovery — documented as a deliberate scope boundary (Section 3 of the spec), not silently downgraded.

- [x] A member can attach up to 5 entity references to a message in a `direct`/`group`/`channel` conversation via a composer picker (type select → searchable combobox); each renders as a small clickable card under the message body, linking to that entity's real detail page
- [x] `chat-entity-references-service.js`: resolves each reference by calling the TARGET module's own existing permission-aware service function (`contactsService.getById`, `filesService.getById`, `hrService.getEmployee`, `ledgerService.getAccount` — the last needs `companyId`/`actorId` derived from `authUserId`, a different signature than the other three) rather than a raw, unchecked Prisma query — a reference to a record the sender can't read is silently dropped, never surfaced as a distinguishable error (same non-leaking convention as every other phase)
- [x] Resolution snapshots `{entityType, recordId, title, subtitle, url}` into `metadata.entityRefs` at send time (not re-resolved live on every read — a deliberate, documented tradeoff, same as Slack/Discord link previews); `sendMessage` rejects the whole send with 400 if `entityRefs` is sent on an `external_support` conversation, enforced server-side as defense in depth on top of the composer button being hidden there
- [x] `EntityReferenceCard` renders in both own-message and other-message branches of `ChatMessageBubble`, and — the one thing this exact multi-phase effort got wrong twice before (Phase D reactions, Phase E's reply pill both shipped with `FloatingChatHub` left unwired on the first pass) — the composer's reference button was threaded through all 4 real `MessageComposer` call sites (`ChatWindow`, `FloatingChatHub`, `ThreadPanel`, `ExternalInboxScreen`) in one pass, with `ExternalInboxScreen` hardcoded to `"external_support"` rather than derived, so it can never accidentally under-restrict
- [ ] Manual browser QA (deferred, same reason as Phases A–E)

Built via `superpowers:subagent-driven-development` across 7 tasks (3 backend, 4 frontend) plus the 2-task Contact-route preliminary fix. References carry no notification of their own, so this phase avoided the thread-notification-style membership gap Phase E hit — the actual findings were smaller: a React key collision against the spec's own permitted "reference the same record twice" case (fixed with an index tiebreaker), a doubled CSS margin from both a wrapper and its child carrying the same spacing class, a misleading code comment describing a risk that traced back to never actually being reachable (the fix itself was still correct, just for a different reason than stated), and — on the Contact-route preliminary work — mutation-success handlers bypassing the one place that carried the URL-clearing-on-close logic. No "reached one render branch, not the other" bug this phase — the entity-ref-card render diff was independently re-derived from the raw diff (not the implementer's line-number claims) and confirmed byte-identical across both bubble branches.

Verified: 2026-08-27 (`node --test apps/api/src/routes/chat/__tests__/*.test.js` → 91/91 pass; `node --test apps/api/src/services/__tests__/contacts-service.test.js` → 3/3 pass; `pnpm build` / `pnpm --filter @atlas/desktop exec vite build` → clean on every task and every fix; every task independently reviewed for spec compliance and code quality before being marked done)

**This closes the 6-phase Discord/WhatsApp-style chat ecosystem roadmap** (Phases A–F: foundation/permissions, channel & group UX, mentions, pinning & reactions, threads, cross-module references) — see each phase's entry above for what shipped and what review caught.

### Chat UI polish — Sub-project 1: Conversation identity & member accessibility

Spec: `docs/superpowers/specs/2026-08-27-chat-conversation-identity-design.md`
Plans: `docs/superpowers/plans/2026-08-27-chat-conversation-identity-plan-a-backend.md`, `...-plan-b-frontend.md`

First of three sub-projects from user-provided screenshot feedback on the chat UI (2026-08-27), post-roadmap: no visual signal distinguished a channel from a group from a direct chat, every channel/group looked identical (initial-letter avatar only), and member access was a plain "N miembro(s)" text buried in the header.

- [x] `chat_conversations.avatar_file_id`/`avatar_emoji` (nullable, mutually exclusive — setting one server-side clears the other, even if the caller only mentioned one; explicitly clearing just one via `null` does NOT touch the other, matching the spec's "remove-both must send both nulls" contract); `updateConversation` rewritten to build its SQL from conditionally-included `Prisma.sql` fragments instead of the old hardcoded `COALESCE`, since COALESCE can't express "explicitly clear to null" vs. "leave untouched"
- [x] `getConversation`/`listConversations` resolve `avatar_file_id` to a live signed URL via the SAME batch-signing pass already used for member avatars (no second signing call, no id-mixup risk), exposed as computed `avatarUrl` (camelCase) — the old, permanently-dead `avatar_url` (snake_case) column is explicitly overwritten to `undefined` in every response so no consumer can read the wrong field; the validator's equally-dead `avatarUrl` field was removed and replaced with real `avatarFileId`/`avatarEmoji`
- [x] `ConversationTypeBadge` (a `#`/people-icon corner badge) and emoji-avatar rendering reach all 3 real conversation-avatar surfaces (`ChatConversationItem`, `ChatWindow`'s header, `FloatingChatHub`'s mini-window) plus a 4th found and fixed along the way (`ForwardMessageModal`, deliberately given emoji support but not the badge itself — its corner is already occupied by a selection checkmark)
- [x] `ChannelGeneralTab` (new first tab in `ChannelDetailsSheet`) lets an admin upload an image or pick an emoji as the channel/group's avatar, gated (disabled, not hidden) by the existing `channel.manage` permission — same gate `title`/`status` edits already used
- [x] `MemberAvatarStack` (up to 4 overlapping avatars + a "+N" bubble) replaces the header's member-count text, wired to the SAME existing "Ver miembros" handler rather than a new one; shown unconditionally for channel/group (not only when nobody's online — the first version made the stack and the "N en línea" text mutually exclusive, silently hiding the feature's own headline element for the common case of an active conversation with anyone online, found by review)
- [ ] Manual browser QA (deferred, same reason as the chat roadmap phases)

Built via `superpowers:subagent-driven-development` across 8 tasks (4 backend, 4 frontend). Review caught and fixed 5 real issues: the stack/online-count mutual exclusivity described above (the most significant — it silently defeated the feature for its most common real-world case); two disabled-state races in `ChannelGeneralTab` (only the upload mutation, not the follow-up update mutation, blocked the buttons — a fast double-click could fire a redundant request); a `toast` import the plan itself got wrong (`@atlas/ui` only exports a `Toaster` container, not a `toast()` function — every real caller in this codebase imports it from `sonner` directly, caught before it shipped rather than after); and the `ForwardMessageModal` gap above. The central historical risk for this exact kind of change — a live camelCase computed field vs. a dead snake_case raw column, which shipped for real twice in the chat roadmap above — did not recur: a repo-wide grep after the frontend casing-fix task found zero remaining instances.

Verified: 2026-08-27 (`node --test apps/api/src/routes/chat/__tests__/*.test.js` → 98/98 pass; `pnpm build` / `pnpm --filter @atlas/desktop exec vite build` → clean on every task and every fix; every task independently reviewed for spec compliance and code quality before being marked done)

### Chat UI polish — Sub-project 2: Member management as an in-place panel

Spec: `docs/superpowers/specs/2026-08-27-chat-member-panel-design.md`
Plan: `docs/superpowers/plans/2026-08-27-chat-member-panel-plan.md`

Second of three sub-projects. The user explicitly disliked member management opening as a modal (`ChannelDetailsSheet`, a `Sheet` overlay from Sub-project 1) and wanted it to behave like the existing "Fotos y videos" view — a header toggle swapping the main chat content area in place, header/composer staying put.

- [x] `ChannelDetailsSheet.jsx` deleted; its `General`/`Miembros`/`Roles` tab content (unchanged internally) moved into a new `ChatMembersPanel.jsx`, rendered directly in `ChatWindow`'s content slot instead of inside a `Sheet` — a fixed `TabsList` header with each `TabsContent` independently scrollable, mirroring the "fixed header + scrollable body" idiom already used elsewhere in this file
- [x] `filesView`/`membersView` are mutually exclusive (opening one closes the other) via a shared invariant enforced at every state-changing path — proven correct by induction across all reachable click orderings, not just spot-checked; both reset to closed on conversation switch (also fixing a pre-existing latent bug: the old sheet's open state was never reset there before, so switching conversations with it open used to leave stale state behind)
- [x] A new header toggle button (people icon) joins the existing files-toggle button, explicitly scoped to `channel`/`group` only — matching the pre-existing "Ver miembros" dropdown item's exact condition; `MemberAvatarStack`'s own implicit "not direct" gate (broader than the other two, only safe in practice because the backend already filters `external_support` conversations out of the list a user can select from) was tightened to the same explicit condition so the three don't rely on an unrelated dependency to stay in sync
- [ ] Manual browser QA (deferred, same reason as the chat roadmap phases and Sub-project 1)

Built via `superpowers:subagent-driven-development` across 3 tasks. Review caught 1 real issue: the new header button's condition ("Important" in review) matched one sibling gate literally but not `MemberAvatarStack`'s actual gate, which was structurally different (a binary ternary's else-branch, not an explicit type check) even though all three produced the same visible result today — fixed by making all three identical and explicit rather than leaving the invariant dependent on `listConversations`' own filtering never changing. A second gap — the new button rendering for `direct` conversations at all, where there's no roles/permissions concept to manage — was caught and fixed by the implementer's own self-review before the review pass even started.

Verified: 2026-08-27 (`pnpm build` / `pnpm --filter @atlas/desktop exec vite build` → clean on every task and every fix; repo-wide grep confirmed zero remaining `ChannelDetailsSheet` imports after deletion)

### Chat UI polish — Sub-project 3: Reply-to-message + mobile gesture layer

Spec: `docs/superpowers/specs/2026-08-28-chat-reply-to-message-and-mobile-gestures-design.md`
Plans: `docs/superpowers/plans/2026-08-28-chat-reply-to-message-plan-a-api.md`, `...-plan-b-ui.md`

User feedback (2026-08-28): on touch devices the per-message hover affordances (quick-react face, "..." menu) are unreachable, so reactions and the message menu can't be used at all; and there was no lightweight "reply to a message" (only Phase E threads, channel/group-only, opened from that same hover-gated menu).

- [x] `chat_messages.reply_to_message_id` (migration `20260828030000_chat_reply_to`), self-referencing FK `ON DELETE SET NULL` — deleting a quoted original leaves the reply intact, its quote resolves to "Mensaje eliminado" on read
- [x] `sendMessage` gains optional `replyToMessageId`: validates the target exists, isn't soft-deleted, and shares the conversation (400 `reply_target_invalid` otherwise); independent of `threadRootId` (a thread reply may also quote). Broadcast payload carries `replyToMessageId`
- [x] `listMessages` / `getMessageFull` / `listThreadReplies` attach a resolved `reply_to` preview `{ id, senderUserId, senderName, bodyPreview, kind, isDeleted }` — one extra batched query per page (`buildReplyPreview` is a pure, separately-unit-tested helper); `kind` ∈ text/image/video/audio/file/entity/deleted
- [x] `around` list-window param deferred (spec §6.4 permits it) — the frontend's load-older-until-found is the shipped jump mechanism
- [x] To stay under the 1500-line hard ceiling, the self-contained external-inbox operator functions were first extracted from `chat-service.js` into `chat-external-inbox-service.js` (pure move, existing tests green)
- [x] `@atlas/ui` gains `useLongPress` + `useSwipeToReply` (generic, injectable pure controllers with unit tests) and now exports `useIsMobile`
- [x] `ChatMessageBubble.jsx` first slimmed by extracting all attachment rendering into `MessageAttachments.jsx` (mandated by CLAUDE.md — the file was 1367 lines); then wired with long-press → `MessageActionSheet` (bottom `Sheet` on mobile / cursor-anchored `DropdownMenu` on desktop right-click), horizontal swipe → reply, double-tap → ❤️ toggle. Desktop hover menu unchanged except it now lists "Responder" (both menus render from one shared `buildMessageActions` descriptor)
- [x] `MessageQuote.jsx` renders the quote inline (inside the bubble, tap → jump-to-original with a flash highlight) and in compose (above the composer, with cancel); `replyingTo` state owned per view in `ChatWindow`, `MiniChatWindow`, `ThreadPanel`; optimistic `reply_to` built client-side on send. A message quoting one of your own gets the mention-style left border
- [x] `ChatMessageList.scrollToMessage` upgraded: flash keyframe + load-older-up-to-5×-then-toast when the quoted original isn't loaded
- [ ] Manual browser QA at 390px + 1440px (deferred, same as prior chat sub-projects) — long-press / swipe / double-tap / right-click / jump-to-quote / vertical-scroll-not-captured

Verified: 2026-08-28 (`node --test packages/ui/src/hooks/__tests__/*.test.js` + `apps/api/src/routes/chat/__tests__/*.test.js` → 190/190 pass; `pnpm --filter @atlas/desktop build` full Tauri build + `build:web` → clean). PinnedMessagesSheet renders its own summary card (not `ChatMessageBubble`) so it needed no gesture wiring; `ExternalInboxScreen` deliberately out of scope.

## atlas.notes — Collaborative Notes

Plans: `docs/superpowers/plans/2026-06-27-atlas-notes-A-backend.md`, `2026-06-27-atlas-notes-B-frontend.md`

- [x] Backend: migrations `20260627120000_atlas_notes_tables` + `20260627130000_atlas_notes_fixes`; services (notes/folders/tags/shares/ydoc); 26-endpoint router; SDK domain; 17 permissions in core manifest
- [x] Frontend: `NotesScreen`, `PublicNoteScreen`, `NoteEditor` (TipTap + Yjs via `SupabaseYjsProvider`), `DrawingCanvas`, `ImageAnnotationOverlay`, `NoteShareModal`, folders/tags sidebar
- [x] `atlas-notes` bucket — confirmed exists 2026-08-24 (`storage.listBuckets()`). It's `public: true` by deliberate 2026-08-03 user choice (permanent embedded-image URLs), not an oversight — no action needed.
- [ ] Live QA: collaborative editing between two sessions; public route `/p/notes/:slug`
- [x] Tables/images/mobile design (`docs/superpowers/specs/2026-09-16-notes-tables-images-mobile-design.md`, Plan A + Plan B): image + drawing insertable in table cells (`SlashCommand.jsx` guard narrowed), 4 free corner resize handles + `aspectRatio` node attribute, `ImageSourceSheet` (camera vs. gallery) wired into toolbar/slash-command/cover picker, touch-visible column-resize handle, `TableFloatingMenu` bottom-sheet table options on coarse pointer. Code complete, `node --test` (102/102) + `pnpm lint` + full `vite build` all clean.
  Verified: 2026-09-16 (automated only — `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/*.test.js` 102/102 pass, `pnpm lint` clean, `vite build` clean). Manual QA at 390px/1440px, both themes (per `docs/ai-context/ui-screen-audit-checklist.md`) still pending — needs a live browser pass.
- [x] Mobile image-editing friction fixes (`docs/superpowers/specs/2026-09-16-notes-mobile-image-editing-fixes-design.md`): compact single-row image edit toolbar (was wrapping onto 2-3 rows), `preventDefault` on image controls so ordinary interaction no longer opens the mobile keyboard, tap-below-content focuses the document end (`clickBelowContent.js`), crop modal detects an already-cached image on open instead of only relying on `onLoad` (`imageLoadState.js`), slash-command menu switched from a bare `bg-popover` to the shared `.glass-strong` background, and blur-up image loading (`lqip` variant preset + stored `aspectRatio` at insert time) to eliminate layout shift.
  Verified: 2026-09-16 (automated only — `node --test` 107/107 notes + 9/9 imageVariants pass, `pnpm lint` clean, `vite build` clean). Manual QA at 390px/1440px, both themes, still pending — needs a live browser pass.
- [x] Image drag-reorder UX (`docs/superpowers/specs/2026-09-16-notes-image-drag-reorder-design.md`): replaced the cramped move-handle button (overlapping the top-right corner resize handle's hit area) with press-and-hold-anywhere dragging (long-press on touch, instant on mouse), a floating clone that follows the pointer, and continuous sibling reflow (`hooks/useBlockDragReorder.js` — generalized from `useImageDragReorder.js` when table drag-reorder was added, see below — `dragReorder.js`'s `computeShiftMap`/`exceedsDragThreshold`).
- [x] Table drag-reorder (`docs/superpowers/specs/2026-09-16-notes-table-drag-reorder-design.md`): tables can now be reordered on both platforms via a floating overlay handle (not a custom NodeView — TipTap's table extension already claims its own view for column resizing) — mobile reuses the existing "Opciones de tabla" button (press-and-hold now also drags, tap still opens the sheet), desktop gets a new small grip handle at the table's top-left corner. `useImageDragReorder` generalized to `useBlockDragReorder` (`getBoxEl`/`getFrameEl` functions instead of refs) so both images and tables share the same drag mechanics; new `findTableAtSelection` helper in `dragReorder.js`.
- [x] ~~Automatic side-by-side content flow~~ — **REVERTED a second time, 2026-09-17**, this time for an architectural reason rather than a fixable bug: CSS floats only respond to document order + width, not to where a drag is actually released. Dropping an image "below" another narrow image still rendered it beside that image whenever both were narrow enough to float — there is no way for float layout to express "insert here but don't pair with this neighbor" from drag position alone (confirmed via `docs/superpowers/specs/2026-09-16-notes-side-by-side-layout-design.md` Revision 2's own drop-position math, which was already precisely correct — the mismatch was between logical insertion order and rendered float pairing, not a calculation bug). If revisited, needs either an explicit per-image "keep on its own line" toggle or a deliberate Notion-style columns structure — user chose to defer rather than build either now. The two genuinely float-independent wins from this work stayed: the visible drop-zone indicator and orphaned-clone hardening in `useBlockDragReorder.js`, which also fixed a real `pickDropIndex`-adjacent drop-position bug (`|| isLastRow` forcing a drop beside a row's last item even when the pointer was far below it) for plain single-column image/table dragging.
- [x] Modal editing for table-cell images (`docs/superpowers/specs/2026-09-17-notes-table-cell-image-modal-design.md`): the inline "Editar imagen" pill/toolbar don't fit a narrow table cell (text wrapped vertically, toolbar overflowed) — a table-cell image now shows an icon-only trigger that opens `ImageEditModal` (full annotation/crop/color/line-width toolset, properly sized) instead of inline edit mode. Annotation drawing logic extracted into `useImageAnnotationDrawing` so inline and modal editing share it; new `isInsideTableCell` helper (hardened against a `RangeError` when `getPos()` briefly returns a stale position right after a drag's `moveNode`).
  Verified: 2026-09-17 (automated only — `node --test` 122/122 notes pass, `pnpm lint` clean, `vite build` clean). Manual QA at 390px/1440px, both themes, still pending — needs a live browser pass.

Verified: 2026-07-17 (implementation confirmed by file inventory and applied migrations via `prisma migrate status`; no live QA recorded)

## June 2026 UX/platform small plans

Plans: `docs/superpowers/plans/2026-06-20-ledger-categories-user-scope-a-api.md` + `-b-ui.md`, `2026-06-21-sortable-lists-plan.md`, `2026-06-21-notification-bell-ux-fix.md`, `2026-06-22-calendar-deeplink-loading-state.md`, `2026-06-26-file-viewer-mobile-responsive.md`

- [x] Ledger categories user scope (A: API, B: UI)
- [x] Sortable lists
- [x] Notification bell UX fix
- [x] Calendar deeplink loading state
- [x] File viewer mobile responsive

Verified: 2026-06-29 (implemented per plan execution in June sessions and included in commits up to `323e6d9`; re-verify opportunistically when touching these areas)

## Atlas Growth - Storefront Capture Foundation

Spec: `docs/superpowers/specs/2026-06-14-storefront-capture-foundation-design.md`
Plan: `docs/superpowers/plans/2026-06-14-storefront-capture-foundation.md`

- [x] Apply and verify the forward Prisma migration in the target environment.
- [ ] Verify public capture v1 on Builder and uploaded `dist` domains.
- [x] Publish `@raulbellosom/atlas-sdk` 0.3.0 (bumped to 0.3.1 with patch fix).
- [ ] Observe event ingestion, daily aggregation, and retention under production load.
- [x] Start `growth-lead-inbox` — spec approved and fully implemented.

Verified: 2026-06-14 (automated implementation scope: `pnpm.cmd exec prisma validate`, `pnpm.cmd db:generate`, and `pnpm.cmd check:uuid-policy` passed; API/IIFE/worker suites: 58 passed; npm SDK suites: 65 passed; `pnpm.cmd --filter @atlas/desktop build:web` passed; `pnpm.cmd build` produced the web build and Windows MSI/NSIS bundles; React Doctor diagnostics were empty. Target migration, live Builder/`dist`, npm publication, and production-load observation remain pending. See `docs/superpowers/verifications/2026-06-14-storefront-capture-foundation.md`.)

## Atlas Growth - Lead Inbox

Spec: `docs/superpowers/specs/2026-06-14-growth-lead-inbox-design.md`
Plan: `docs/superpowers/plans/2026-06-14-growth-lead-inbox.md`

- [x] Add the protected Growth lead service, state machine, notes, ownership, notifications, and optimistic conflict checks.
- [x] Convert leads transactionally to existing or new Contacts with cross-company and permission checks.
- [x] Add the internal Growth SDK domain and preserve the extracted Website domain contract.
- [x] Add responsive lead inbox/detail screens, manual creation, filters, timeline, conversion, and attachments.
- [x] Add Growth navigation, ACL, file allowlist, and company-scoped assignee/file routes.
- [x] Apply the forward migration in the target environment.
- [ ] Verify authenticated RBAC, notifications, attachments, and both conversion modes against a live installation.

Verified: 2026-06-14 (automated scope: Growth/API/SDK/UI suites 42 passed; Prisma validation and UUID policy passed; `pnpm.cmd build` produced the web build, Windows executable, MSI, and NSIS installer; React Doctor scanned 7 changed files with no diagnostics. Live migration and authenticated browser workflows remain pending. See `docs/superpowers/verifications/2026-06-14-growth-lead-inbox.md`.)

## Atlas Growth - Analytics

Spec: `docs/superpowers/specs/2026-06-14-growth-analytics-design.md`
Plan: `docs/superpowers/plans/2026-06-14-growth-analytics.md`

- [x] Aggregate daily site, acquisition, landing, content, CTA, form, funnel,
  and retention dimensions with watermark, late-event reprocessing, and purge.
- [x] Add protected overview, acquisition, content, conversion, retention,
  site-filter, and audited CSV endpoints.
- [x] Add internal SDK methods and the `/app/m/atlas.growth` dashboard with
  shared URL filters and five analytic tabs.
- [x] Verify the initial one-million-event target in disposable PostgreSQL 17
  with recorded `EXPLAIN (ANALYZE, BUFFERS)` plans.
- [x] Apply and verify migrations and worker scheduling in the target environment.
- [ ] Complete authenticated browser and mobile QA against live storefront data.

Verified: 2026-06-14 (49 Growth/API/worker/validator/SDK/UI tests passed; all 19 internal SDK tests passed; Prisma and UUID checks passed; Vite and full monorepo/Tauri builds passed; disposable scale benchmark measured aggregate read 7.245 ms, one-day tails 23.490-58.293 ms, and 44-day retention 272.868 ms with current indexes. React Doctor reported no correctness errors. Live deployment/browser QA remains pending. See `docs/superpowers/verifications/2026-06-14-growth-analytics.md`.)

## Atlas Documents - Template Engine

Spec: `docs/superpowers/specs/2026-06-14-atlas-documents-template-engine-design.md`
Plan: `docs/superpowers/plans/2026-06-14-atlas-documents-template-engine.md`

- [x] Add official `atlas.documents` schema, forward migration, manifest, PWA identity, navigation, and granular permissions.
- [x] Add controlled block validators, safe provider registry, and the company-scoped `growth.lead` provider.
- [x] Add template/version lifecycle, immutable publication, optimistic conflicts, audit entries, preview, generation, and generated-document history.
- [x] Render branded multipage PDFs and persist private outputs as `FileAsset` records using PostgreSQL-generated IDs.
- [x] Add the extracted internal SDK Documents domain and lazy-loaded template editor/history screens.
- [x] Generate Documents from Growth leads and expose generated PDFs in the lead attachment area without granting Growth removal rights.
- [x] Apply and verify the forward migration in the target installation.
- [ ] Complete authenticated browser QA for template lifecycle, every block type, provider RBAC, storage/download, history, and Growth generation.

Verified: 2026-06-15 (Prisma validate/generate and UUID policy passed; 84 Documents/Growth/SDK tests plus 3 manifest/schema contract tests passed; Vite and full monorepo/Tauri builds passed and produced the native executable, MSI, and NSIS bundles; React Doctor reported no correctness errors, with heuristic warnings documented. `rbac:verify-catalog` still reports only the known unrelated Calendar/Catalog/Inventory and platform catalog drift. Live migration and authenticated browser/storage QA remain pending. See `docs/superpowers/verifications/2026-06-15-atlas-documents-template-engine.md`.)

## atlas.inventory — Asset Management [COMPLETE]

Plan: `docs/superpowers/plans/2026-06-12-atlas-inventory.md`

- [x] Prisma models: `InventoryCategory`, `InventoryItem`, `InventoryAssignment`, `InventoryCustomField`, `InventoryCustomFieldValue` + migration
- [x] Category management with icon + color picker, custom field schema per category
- [x] Item CRUD with custom field values; grouped-tree main view by category
- [x] Assignment flow: assign items to HR employees, return flow, history tracking
- [x] API: `inventory-service.js`, `inventory-notification-service.js`, routes
- [x] SDK `atlas.inventory.*` domain; screens `InventoryScreen`, `InventoryCatalogsScreen`, `InventoryAssignmentsScreen`, `InventoryItemDetail`, `InventoryItemForm`
- [x] HR employee integration: assigned items panel in employee detail

Verified: 2026-06-20 (all 5 screens present in `apps/desktop/src/modules/atlas.inventory/screens/`; `inventory-service.js`, `inventory-notification-service.js` present in `apps/api/src/services/`; DB migration up to date per `prisma migrate status`)

Note: Activity feed bridge deferred — no `activityBridge` pattern for inventory events yet.

## Atlas Comments System [COMPLETE]

Plans: `docs/superpowers/plans/2026-06-14-generic-comments-api.md`, `2026-06-14-generic-comments-ui.md`, `2026-06-14-growth-comments-api.md`, `2026-06-14-growth-comments-ui.md`

- [x] `comments-service.js`: generic comments engine with @mentions, emoji reactions, and soft-delete
- [x] Growth lead comments integration
- [x] Comments UI components in `@atlas/ui`

Verified: 2026-06-20 (`comments-service.js` present in `apps/api/src/services/`)

## Atlas Projects [COMPLETE — v1 through v2.3]

Specs: `docs/superpowers/specs/2026-06-08-atlas-projects-design.md`, `2026-06-08-atlas-projects-v2.1-design.md`, `2026-06-08-atlas-projects-v2.3-design.md`  
Plans: `docs/superpowers/plans/2026-06-08-atlas-projects-plan-a-api.md`, `...-plan-b-ui.md`, plus v2.1 and v2.3 variants; `2026-06-10-atlas-projects-perf-A.md`, `...-perf-B.md`, `2026-06-10-atlas-projects-mobile-mentions.md`

- [x] Project + task management: `projects-service.js`, `tasks-service.js`
- [x] Custom fields: `projects-fields-service.js`
- [x] Task dependencies: `projects-dependencies-service.js`
- [x] Recurring tasks: `projects-recurring-service.js`
- [x] Notifications: `projects-notification-service.js`
- [x] Calendar bridge: `projects-calendar-bridge.js`
- [x] Desktop: `ProjectsScreen.jsx` with full task/project management UI
- [x] Performance optimization (v2.3) and mobile @mentions improvements

Verified: 2026-06-20 (`ProjectsScreen.jsx` present in `apps/desktop/src/modules/atlas.projects/screens/`; 7 API service files confirmed in `apps/api/src/routes/projects/`)

## Atlas Calendar + Google Calendar Sync [COMPLETE]

Spec: `docs/superpowers/specs/2026-06-07-google-calendar-sync-design.md`  
Plans: `docs/superpowers/plans/2026-06-07-google-calendar-phase-1-2-implementation.md`, `2026-06-08-google-calendar-phase-3a-implementation.md`, `2026-06-08-google-calendar-phase-3b-implementation.md`, `2026-06-08-google-calendar-sidebar-modal-implementation.md`, `2026-06-08-google-calendar-persistent-icon-implementation.md`

- [x] Calendar event CRUD: `calendar-service.js`, `calendar-event-service.js`
- [x] Notification layer: `calendar-notification-service.js`
- [x] Google OAuth + token management: `google-oauth-service.js`, `google-token-crypto.js`
- [x] Google Calendar discovery, connection, event linking, initial import (9 Google service files)
- [x] Desktop: `CalendarScreen.jsx` with sidebar modal, persistent Google Calendar icon
- [x] Projects calendar bridge integration

Verified: 2026-06-20 (`CalendarScreen.jsx` present in `apps/desktop/src/modules/atlas.calendar/`; `apps/api/src/routes/calendar/google/` contains 9 Google integration service files)

## Offline Sync Architecture [COMPLETE — Phases 1–5]

Spec: `docs/superpowers/specs/2026-06-06-offline-architecture-design.md`  
Plans: `docs/superpowers/plans/2026-06-06-offline-phase-1a-package.md` through `2026-06-07-offline-phase5c-ledger-hooks.md`

- [x] `packages/offline/` — sync engine, Dexie IndexedDB persister, mutation queue, session vault, online detector
- [x] Conflict detection + resolution (backend + frontend phases)
- [x] Backend pull/push: `sync-service.js`, `sync-push-service.js`, `sync-cleanup-worker.js`
- [x] Navigation guard for offline state; offline provider for React tree
- [x] Calendar offline support (tier 2); Atlas Ledger SQLite cache (Phase 5 — also tracked above)

Verified: 2026-06-20 (`packages/offline/src/` contains 15 files including `sync-engine.js`, `dexie-persister.js`, `mutation-queue.js`, `offline-provider.jsx`; `sync-service.js`, `sync-push-service.js`, `sync-cleanup-worker.js` in API services; `sync.js` route present)

## Storefront SDK + Hosted Build [COMPLETE]

Specs: `docs/superpowers/specs/2026-06-01-atlas-storefront-sdk-design.md`, `2026-06-01-hosted-build-design.md`, `2026-06-11-dist-auth-sdk-design.md`, `2026-06-14-pwa-module-icon-consistency-design.md`  
Plans: `docs/superpowers/plans/2026-06-01-atlas-storefront-sdk-plan-a-api.md`, `...-plan-b-sdk.md`, `2026-06-01-hosted-build-plan-a-backend.md`, `...-plan-b-frontend.md`, `2026-06-11-dist-auth-sdk.md`, `2026-06-14-pwa-module-icon-consistency.md`, `2026-06-14-unified-storefront-auth.md`

- [x] Storefront capture + config API: `storefront-capture-service.js`, `storefront-capture-routes.js`, `storefront-config-routes.js`
- [x] Storefront auth API: `storefront-auth-service.js`, `storefront-auth-routes.js`
- [x] Storefront files pipeline: `storefront-files-service.js`, `storefront-files-routes.js`
- [x] Hosted dist upload + serve: `dist-upload-service.js`, `dist-serve-service.js`
- [x] `@raulbellosom/atlas-sdk` npm package published (0.3.1)
- [x] Unified storefront auth flow; PWA module icon consistency
- [x] Embeddable guest chat widget for the vanilla `runly-sdk.js` public script (README.md "Pattern C" plain-HTML sites) — previously the file's `window.RunlyERP` only had `renderForm`/`analytics`, despite the README documenting guest chat as part of that surface; only the npm-package React `ChatWidget` existed, unusable without a bundler. Added `window.RunlyERP.renderChat(options)`: a vanilla-JS port of `packages/storefront-sdk/src/react/ChatWidget.jsx` + `useGuestChat.js` (same REST endpoints/storage keys/message shapes, so both stay interchangeable), with an added best-effort Supabase Realtime layer (dynamic `import()` from jsdelivr, mirroring `guestChat.js`'s `subscribeToReplies`) on top of an always-on 8s poll safety net. Split across `runly-sdk.js` (unchanged) + new `runly-sdk-chat.js` (session/REST/realtime) + `runly-sdk-chat-widget.js` (DOM rendering) to stay under the project's file-size limit; `serveRunlySdk` in `apps/api/src/index.js` concatenates all three into the one script the embed snippet expects. Also fixed two related bugs found in the same pass: guests couldn't see their own just-sent attachments (`useGuestChat.js`'s `sendFile` never attached the `attachments` array, and the 8s poll only appended unknown-id messages, never reconciling existing ones — both fixed, mirrored into the vanilla port) — and the guest widget's closed launcher tab had no visual unread indicator (sound only), now has a badge. Verified: 2026-09-25 (`node --test apps/api/src/public/__tests__/runly-sdk.test.js` → 5 pass, including a test asserting the chat footer's `<textarea>` DOM node identity survives a post-send re-render; `node --test packages/storefront-sdk/src/__tests__/guestChat.test.js` → 10 pass; `pnpm lint` clean on all changed files. No real-browser QA of the Supabase Realtime path — untestable without a live network/CDN in this environment; the polling path is what's verified.)

Verified: 2026-06-20 (`apps/api/src/routes/storefront/` contains `storefront-router.js` + 5 route files; `dist-serve-service.js`, `dist-upload-service.js`, `storefront-auth-service.js`, `storefront-capture-service.js`, `storefront-files-service.js` in `apps/api/src/services/`)

## Atlas Notifications Core [COMPLETE]

Spec: `docs/superpowers/specs/2026-06-01-atlas-notifications-core-design.md`  
Plans: `docs/superpowers/plans/2026-06-01-atlas-notifications-core-part-a-foundation.md` through `...-part-d-web-push.md`; `2026-06-14-notifications-comments-reactions.md`, `2026-06-10-notifications-deep-link-audit.md`

- [x] Notification service + publisher: `notification-service.js`, `notification-publisher.js`
- [x] Delivery worker: `notification-delivery-worker.js`
- [x] Web push: `web-push-service.js`
- [x] Email delivery via `smtp-service.js`
- [x] Deep link routing audit and fix
- [x] Comments/reactions notification integration
- [x] Desktop: `NotificationsInboxScreen.jsx`, `NotificationSettingsScreen.jsx`

Verified: 2026-06-20 (`notification-service.js`, `notification-publisher.js`, `notification-delivery-worker.js`, `web-push-service.js` in `apps/api/src/services/`; notification screens present in `apps/desktop/src/modules/atlas.notifications/`)

## Atlas Website v2 [COMPLETE]

Specs: `docs/superpowers/specs/2026-05-30-atlas-website-v2-redesign.md`, `2026-06-05-atlas-website-admin-refactor-design.md`, `2026-06-01-morada-premium-template-design.md`  
Plans: `docs/superpowers/plans/2026-05-30-atlas-website-v2-plan-A.md`, `...-plan-B.md`, `2026-06-05-atlas-website-wizard-nav-refactor.md`, `...-screens-refactor.md`, `2026-06-01-morada-premium-template.md`, `2026-05-30-website-overview-delete-status-editor-bar.md`, `2026-05-31-multi-page-site-templates.md`

- [x] Full CMS: pages, blog, forms, menus, templates, theme, payments, settings
- [x] Page editor with blocks + live preview (`WebsitePageEditorScreen`)
- [x] Blog post editor (`WebsiteBlogPostEditorScreen`)
- [x] Forms builder with submission tracking (`WebsiteFormsScreen`)
- [x] Website wizard + multi-page site templates; Morada premium template
- [x] API routes in `apps/api/src/routes/website/` + `apps/api/src/routes/public-website.js`

Verified: 2026-06-20 (15+ screens present in `apps/desktop/src/modules/atlas.website/screens/` including `WebsiteOverviewScreen`, `WebsitePagesScreen`, `WebsitePageEditorScreen`, `WebsiteBlogScreen`, `WebsiteFormsScreen`, `WebsiteMenusScreen`, `WebsiteThemeScreen`, `WebsiteTemplatesScreen`, `WebsiteWizard`)

## Atlas Catalog v2 [COMPLETE]

Spec: `docs/superpowers/specs/2026-05-31-atlas-catalog-v2-design.md`  
Plans: `docs/superpowers/plans/2026-05-30-atlas-catalog-plan-A.md`, `...-plan-B.md`, `2026-05-31-atlas-catalog-v2-plan-a-backend.md`, `...-plan-b-frontend.md`, `2026-06-01-atlas-catalog-core-migration.md`

- [x] Product catalog with categories, items, and inventory count
- [x] Screens: `CatalogCategoriesScreen`, `CatalogProductsScreen`, `CatalogProductDetailScreen`, `CatalogInventoryScreen`
- [x] API routes in `apps/api/src/routes/catalog/`

Verified: 2026-06-20 (4 screens present in `apps/desktop/src/modules/atlas.catalog/screens/`; `catalog/` route folder confirmed in `apps/api/src/routes/`)

## Fleet: RME3 → Desktop Module Migration [COMPLETE]

Plans: `docs/superpowers/plans/2026-06-06-fleet-screens-migration.md`, `2026-06-06-sdk-migration-calendar-fleet.md`, `2026-06-06-ledger-cleanup-modules-official.md`

- [x] Migrated from RME3 (`modules/custom/custom.fleet/`) to core desktop module (`atlas.fleet`)
- [x] Fleet API moved to `apps/api/src/routes/fleet/` (full service layer retained)
- [x] Desktop screens: `VehiclesScreen`, `DriversScreen`, `ReportsScreen`, `ReportFormPage`, `ReportDetailScreen`, `InsuranceScreen`, `CatalogsScreen`
- [x] SDK migration for fleet + calendar domains; `modules/custom/` is now empty

Verified: 2026-06-20 (`apps/desktop/src/modules/atlas.fleet/screens/` contains 7 screens; `apps/api/src/routes/fleet/` present with full service layer; `modules/custom/` empty confirmed)

## Dynamic Module Bundler + Custom Module ZIP Upload [COMPLETE]

Specs: `docs/superpowers/specs/2026-05-28-dynamic-module-bundler-design.md`, `2026-06-10-custom-module-zip-upload-design.md`  
Plans: `docs/superpowers/plans/2026-05-28-dynamic-module-bundler.md`, `2026-06-10-custom-module-zip-upload-api.md`, `2026-06-10-custom-module-zip-upload-ui.md`

- [x] `module-bundler-service.js` — builds and bundles custom module components at install time
- [x] `module-upload-service.js` — handles ZIP upload + extraction for custom modules
- [x] `dist-upload-service.js` / `dist-serve-service.js` — serves bundled dist assets
- [x] UI in Module Catalog for uploading custom modules via ZIP

Verified: 2026-06-20 (`module-bundler-service.js`, `module-upload-service.js`, `dist-upload-service.js`, `dist-serve-service.js` present in `apps/api/src/services/`)

## Platform Settings + SMTP [COMPLETE]

Plan: `docs/superpowers/plans/2026-05-30-platform-settings-smtp-plan.md`

- [x] `smtp-service.js` — SMTP configuration and transactional email delivery
- [x] `settings-routes.js` — platform settings API endpoints
- [x] `SmtpSettingsScreen.jsx` — SMTP configuration UI in `platform-settings` module

Verified: 2026-06-20 (`smtp-service.js` in `apps/api/src/services/`; `settings-routes.js` in `apps/api/src/routes/`; `SmtpSettingsScreen.jsx` in `apps/desktop/src/modules/platform-settings/screens/`)

## HR v2 — Org Chart [COMPLETE]

Spec: `docs/superpowers/specs/2026-05-05-phase9-hr-v2-orgchart-design.md`  
Plan: `docs/superpowers/plans/2026-05-05-phase9-hr-v2-orgchart.md`

- [x] `GET /hr/org-chart` endpoint with recursive supervisor chain (CTE)
- [x] SDK `atlas.hr.getOrgChart(token, { rootEmployeeId })` method
- [x] `HrOrgChartScreen.jsx` — interactive tree with root employee selector, supervisor hierarchy rendering, and empty-state guidance
- [x] HR navigation entry for org chart route

Verified: 2026-06-20 (`HrOrgChartScreen.jsx` present in `apps/desktop/src/modules/atlas.hr/screens/`; queries `atlas.hr.getOrgChart` with `rootEmployeeId` parameter confirmed at line 429)

## atlas.activity (CORE Activity Feed)

- [x] Spec: `docs/superpowers/specs/2026-05-31-atlas-activity-design.md` (28 sections, status Approved).
- [x] Plan: `docs/superpowers/plans/2026-05-31-atlas-activity.md` (14 tasks).
- [x] Prisma `Activity` model + manual migration `20260531000000_add_activity_table` with `DEFAULT uuidv7()`, 4 indexes (company+createdAt desc, entity, type, actor), FK SET NULL.
- [x] Core manifest `activityMap` registered (12 modules seeded), 4 permissions (`activity.access/read/publish/manage`) in catalog with Spanish labels.
- [x] Validators: `activityPublishSchema` (4KB payload limit via `superRefine`), `activityListQuerySchema` (z.coerce), `ACTIVITY_CONSTANTS`.
- [x] Service `apps/api/src/services/activity-service.js`: `publish`, `publishFromContext` (resolves company via membership), `list`, `recent`, `listForEntity`, 2s dedupe window, actor join.
- [x] Bridge `apps/api/src/services/activity-bridge.js`: translator registry (HR, contacts, files, company, core), `logAndPublish` writes AuditLog first then never throws on activity errors.
- [x] Routes `apps/api/src/routes/activity.js`: GET list/recent/entity, POST publish, POST subscribe-token; mounted with `requirePermission` guards.
- [x] HR adoption: `hr-service.js` uses `bridge.logAndPublish` for create/update/setEnabled with severity hints.
- [x] SDK `packages/sdk/src/index.js`: `atlas.activity.{list,recent,listForEntity,publish,subscribeToken,getRealtimeChannel}`.
- [x] UI `packages/ui`: `ActivityTimeline`, `ActivityDrawer`, `ActivityBellTrigger` (poll 15s + optional Supabase Realtime, localStorage lastSeen).
- [x] Desktop integration: `<ActivityBellTrigger />` in `Topbar` (permission-gated), `/app/activity` route + `ActivityFeedScreen`, embedded `HrEmployeeActivityPanel` in employee detail.
- [x] Tests: `apps/api/src/services/__tests__/activity-service.test.js` (6) + `activity-bridge.test.js` (6) → 12/12 passing.

Verified: 2026-05-31 (`pnpm prisma migrate deploy` → applied `20260531000000_add_activity_table`; `pnpm db:seed` → "Atlas modules seeded (12)"; `node --test apps/api/src/services/__tests__/activity-service.test.js apps/api/src/services/__tests__/activity-bridge.test.js` → tests 12 / pass 12 / fail 0; `node --check` on `apps/api/src/{index,routes/activity,services/activity-service,services/activity-bridge,services/hr-service}.js`, `packages/{sdk,validators}/src/index.js` → OK; `pnpm --filter ./apps/desktop build` → `✓ built in 4.86s` + Tauri release bundles produced)

## UUID v7 Global Cutover (Reset Total)

- [x] Replace Prisma ID defaults from `cuid()` to UUID v7 (`@default(uuid(7)) @db.Uuid`) across domain models.
- [x] Align shared validators and module validators to UUID-based ID contracts.
- [x] Remove `custom.fleet` company hash bridge and require real UUID company scope.
- [x] Normalize RME3 SQL generation and fleet dynamic DDL to UUID v7 defaults (`uuidv7()`).
- [x] Add destructive baseline migration for full reset strategy (`20260524000000_uuid_v7_global_cutover`).
- [x] Add forward fleet migration to normalize legacy text reference columns to UUID (`V009_uuid_reference_columns.sql`).
- [x] Add CI guardrail to block `cuid(` and `.cuid(` reintroduction in source code.
- [x] Document global UUID v7 policy in team-facing architecture and agent docs.

Verified: 2026-05-24 (`pnpm.cmd exec prisma validate`, `pnpm.cmd db:generate`, `pnpm.cmd check:uuid-policy`, `node --test packages/module-engine/src/__tests__/sql-generator.test.js`, `node --test modules/custom/custom.fleet/api/__tests__/fleet-services.test.js modules/custom/custom.fleet/api/__tests__/fleet-routes-auth.test.js`)

## Snake_case Global Rebaseline + Module Lifecycle Hardening

- [x] Add destructive forward migration baseline for full `snake_case` rebuild (`20260525000000_snake_case_global_rebaseline`).
- [x] Harden `public.uuidv7(...)` definition with explicit `SET search_path = public, pg_catalog`.
- [x] Keep Prisma client API readable while mapping SQL objects to `snake_case` via `@@map/@map`.
- [x] Promote `atlas.contacts` and `atlas.hr` to core policy (`core=true`, `uninstallable=false`) and include both in seeded core module list.
- [x] Keep `DELETE /modules/:key` as non-destructive shorthand (`preserve-data`).
- [x] Set explicit uninstall flow default to destructive table purge only for `custom.*` modules (`POST /modules/:key/uninstall` and dry-run).
- [x] Remove `custom.fleet` dependency on `manifest.migrations` SQL chain and switch to declarative model lifecycle defaults.
- [x] Ignore legacy `manifest.migrations` SQL execution for discovered custom modules to avoid checksum drift failures.
- [x] Extend module-engine declarative DDL support with table-level `foreignKeys` and `checks`, including checksum coverage.
- [x] Execute destructive migration and reseed in live environment (`db:reset`, `db:migrate`, `db:seed`).
- [x] Validate Supabase Advisor warnings are fully cleared after reset/reseed.

Verified: 2026-05-25 (`pnpm.cmd prisma validate`, `pnpm.cmd prisma generate`, `node --test packages/module-engine/src/__tests__/define-model.test.js packages/module-engine/src/__tests__/sql-generator.test.js`, `node --test apps/api/src/services/__tests__/module-discovery-service.test.js`, `node --test apps/api/src/services/__tests__/rbac-granular-contract.test.js`)
Note: destructive reset + reseed executed on live DB (`pnpm.cmd db:reset`, `pnpm.cmd db:migrate`, `pnpm.cmd db:seed`) with resulting baseline migration `20260525193000_core_only_baseline`. In this self-hosted environment the Supabase CLI `db advisors` path fails on direct-port TLS negotiation, so validation is executed with the official Splinter SQL lint set through Prisma (`pnpm.cmd db:advisor-equivalent` -> `SPLINTER_COUNTS { INFO: 33 }`, `SPLINTER_STATUS PASS_NO_WARN_OR_ERROR`).

## Reset 0 + Core-only Baseline + Finance/Ledger Externalization

- [x] Applied destructive reset in active DB (`public` objects dropped, including legacy migration footprint).
- [x] Replaced migration history with a single baseline (`20260525193000_core_only_baseline`).
- [x] Removed finance/ledger models from Prisma baseline schema (no `finance_%`/`ledger_%` at boot).
- [x] Removed finance/ledger from internal feature seed list (`packages/maps` feature bootstrap now excludes them).
- [x] Added placeholder externalized custom manifests `custom.finance` and `custom.ledger` (temporarily non-installable during cutover).
- [x] Confirmed clean bootstrap excludes `fleet_%` tables (fleet stays custom and not auto-installed).

Verified: 2026-05-25 (`pnpm.cmd db:migrate`, `pnpm.cmd db:seed`, DB query on `information_schema.tables` returns no `finance_%`/`ledger_%`/`fleet_%`, `pnpm.cmd prisma validate`, `node --check apps/api/src/index.js`, `pnpm.cmd --filter ./apps/desktop build:web`)

## Documentation Alignment (Module Status Reality Check)

- [x] Align canonical docs with internal core baseline of 6 modules (`atlas.core`, `atlas.identity`, `atlas.files`, `atlas.company`, `atlas.contacts`, `atlas.hr`).
- [x] Remove active-transition wording that still treated `packages/maps` as present.
- [x] Align docs with direct PostgreSQL connectivity on Supabase port `5433` (no SSH tunnel as default path).
- [x] Align docs with Prisma workspace baseline `^7`.
- [x] Add explicit guidance that historical specs/plans may contain obsolete transitional references.

Verified: 2026-05-25 (`rg -n "packages/maps|SSH tunnel|Prisma is pinned to \\`\\^6\\`|Four core modules|4 core modules seeded" AGENTS.md README.md CLAUDE.md docs/00_project_status.md docs/02_module_system.md docs/03_core_modules.md docs/TASKS.md`)

## Offline Phase 5 - Ledger SQLite Read Cache

Spec: `docs/superpowers/specs/2026-06-07-offline-phase5-tauri-sqlite.md`  
Phase 5C Spec: `docs/superpowers/specs/2026-06-07-offline-phase5c-ledger-hooks.md`  
Plan: `docs/superpowers/plans/2026-06-07-offline-phase5c-ledger-hooks.md`

- [x] Phase 5A - `/sync/pull` supports `atlas.ledger` records (`account`, `transaction`, `category`, `transaction_type`)
- [x] Phase 5B - Tauri SQLite cache, `LedgerSQLiteStore`, `LedgerSyncAdapter`, and guarded dual-pull orchestration
- [x] Phase 5C - Desktop ledger reads use SQLite offline for accounts, account detail, transaction history, and summary charts
- [x] Ledger write actions stay online-only and the desktop UI explains read-only offline behavior
- [x] Offline documentation and status tracking updated to reflect final Phase 5 behavior

Verified: 2026-06-07 (`node --test packages/offline/src/__tests__/ledger-sqlite.test.js apps/desktop/src/modules/atlas.ledger/lib/__tests__/ledger-data-client.test.js`, `pnpm.cmd --filter @atlas/desktop build:web`, `npx.cmd -y react-doctor@latest . --verbose --diff` in `apps/desktop`)

## Phase 0 - Repository and environment cleanup

- [x] Remove docker-compose.local-lite.yml
- [x] Remove obsolete docs (ARCHITECTURE.md, MODULE_SYSTEM.md, DOCKER.md, SUPABASE_SELF_HOSTED_SCENARIO.md, CODE_STYLE.md)
- [x] Rewrite .env.example for Supabase-first with dotenv substitution pattern
- [x] Create numbered docs suite (docs/00-09)
- [x] Update README.md, CLAUDE.md, codex/00_MASTER_PROMPT.md
- [x] Add atlas.company manifest to core-modules.js
- [x] Add InstanceConfig model to prisma/schema.prisma
- [x] Update docs/TASKS.md (this file) and docs/BLUEPRINTS.md

Verified: 2026-05-02

## Phase 1 - Supabase + Prisma connection

- [x] Fill .env: copy keys from VPS /path/to/supabase/docker/.env
- [x] Open SSH tunnel: ssh -L 54322:db.internal.example:5432 deploy@192.0.2.10
      Note: PostgreSQL is not on host port 5432 - must tunnel to container IP db.internal.example:5432
- [x] Run pnpm db:generate - Prisma client against Supabase PostgreSQL (tunnel required)
- [x] Run pnpm db:migrate - applied initial_migration + add_instance_config (tunnel required)
- [x] Run pnpm db:seed - 4 core modules, admin role, permissions (tunnel required)
- [x] Verify GET /health returns 200
- [x] Verify GET /modules returns 4 core modules from live Supabase

Verified: 2026-05-03

## Phase 2 - ERP initialization state

Plan: `docs/superpowers/plans/2026-05-03-phase2-initialization-state.md`

- [x] Add `GET /instance/status` endpoint - reads `InstanceConfig` key `initialized` from DB
- [x] Add `instance.status()` to SDK
- [x] Install `react-router-dom` in `apps/desktop`
- [x] Add `InitGuard` component - fetches status, redirects to `/setup` or `/login`
- [x] Add `SetupPlaceholder` stub screen at `/setup`
- [x] Add `LoginPlaceholder` stub screen at `/login`
- [x] Move `Dashboard` to `/app` route

Verified: 2026-05-03

## Phase 3 - Onboarding setup wizard

Spec: `docs/superpowers/specs/2026-05-03-phase3-setup-wizard-design.md`
Plan: `docs/superpowers/plans/2026-05-03-phase3-setup-wizard.md`

- [x] Add BrandingConfig Prisma model and migration
- [x] Add setupInitializeSchema to @atlas/validators
- [x] Add FormData support + setup.initialize() to @atlas/sdk
- [x] Install @supabase/supabase-js in API
- [x] Build POST /setup/initialize endpoint (transaction-safe, logo upload, adminRole guard)
- [x] Build 4-step wizard UI - SetupWizard shell with motion/react slide transitions
- [x] Step 1: Admin account (TextField + PasswordField with strength meter)
- [x] Step 2: Company info (name + slug preview)
- [x] Step 3: Branding (drag-drop logo, dominant color extraction, color swatches)
- [x] Step 4: Review + submit
- [x] Create Supabase Auth user via Admin SDK
- [x] Create UserProfile, Company, BrandingConfig via Prisma transaction
- [x] Upload logo to Supabase Storage (atlas-files canonical bucket)
- [x] Write InstanceConfig records (initialized, company_id, completed_at)
- [x] Add FormFields component library to @atlas/ui
- [x] Split admin name -> firstName + lastName
- [x] Expand Company model - legalName, RFC, companyType, companyTypeName, companySize, full address (country/state/city/street/extNumber/intNumber/postalCode)
- [x] Add optional company industry (giro) with suggested catalog + custom entry
- [x] Add ComboboxField to @atlas/ui with cascading country -> state -> city (country-state-city library)
- [x] Update setupInitializeSchema and API handler for all new fields
- [x] Apply primaryColor as global brand accents (buttons, links, active nav, ring)
- [x] Migration applied for Company + UserProfile + industry fields

Verified: 2026-05-03 (complete)

## Phase 4 - Auth integration

- [x] Login screen (company-branded, loads logo + colors from API)
- [x] Supabase Auth signInWithPassword flow
- [x] Session persistence and logout
- [x] JWT verification middleware in Atlas API
- [x] UserProfile + role + permission loading on each authenticated request
- [x] Password recovery placeholder

## Phase 5 - Atlas shell and module registry UI

- [x] Module launcher (app home screen / module grid)
- [x] Module-specific layouts and sidebars
- [x] Module catalog: install, disable, view status
- [x] Core module protection in UI and API
- [x] Phase 5.2 (partial): Identity UX refresh (Users/Roles), skeletons, atomic form controls, and permission catalog in Spanish grouped by module
- [x] Phase 5.5 stabilization: lifecycle authorization/guards validated and unavailable-module redirect to catalog

## Phase 6 - Contacts module

- [x] Contacts list page with DynamicTable
- [x] Contact form page/modal with DynamicForm
- [x] Full CRUD API with service layer
- [x] Contact picker component exposed to other modules

## Phase 7 - Files module

- [x] Supabase Storage pipeline aligned for files flows (`atlas-files`) and branding integration path
- [x] Files API service layer (`upload`, `list`, `getById`, `getSignedUrl`, `setEnabled`)
- [x] Authenticated files endpoints (`POST /files/upload`, `GET /files`, `GET /files/:id`, `GET /files/:id/signed-url`, `PATCH /files/:id/enabled`)
- [x] Company-scoped metadata policy on `FileAsset` (`moduleKey`, `entityType`, `entityId`, `metadata.companyId`)
- [x] SDK files domain (`atlas.files.upload/list/get/getSignedUrl/setEnabled`)
- [x] Reusable `FileUploader` and `FileViewer` exports in `@atlas/ui`
- [x] Full Atlas Files module screen (upload, list/search/filter, preview, download, copy-link, enable/disable)
- [x] Module routing integration for `atlas.files` in `ModuleOutlet` and manifest navigation
- [x] Branding logo workflow migrated to shared files APIs/components with `logoFileId`
- [x] Signed URL delivery used for preview/download in Files and Branding flows

Verified: 2026-05-04 (build + runtime compile checks)

## Phase 7.1 - Files module advanced UX

- [x] Multi-view explorer (`Tabla`, `Cards`, `Cuadricula`)
- [x] Thumbnail/image previews + file-type visual icons
- [x] Advanced viewer modal (image rotate/invert/reset visual-only, PDF preview, prev/next)
- [x] File detail panel with origin metadata and `Ir al origen` when route exists
- [x] Rename endpoint + UI flow
- [x] Multi-select and bulk download (`direct` signed URLs and `zip`)
- [x] Module route support for file detail path (`/app/m/atlas.files/files/:id`)

Verified: 2026-05-04 (API syntax checks + desktop production build)

## Phase 7.1.1 - Files storage unification

- [x] Single canonical storage bucket policy: `atlas-files`
- [x] Setup logo upload aligned to `atlas-files` with `company/branding/<companyId>/...` object keys
- [x] New `FileAsset` rows forced to `bucket=atlas-files` in setup/files/avatar flows
- [x] Standardized object keys for module uploads (`modules/<moduleKey>/<entityType>/<entityId>/...`)
- [x] Standardized object keys for bulk ZIP artifacts (`system/bulk-downloads/<companyId>/...`)
- [x] Runtime cleanup: removed active API references to `atlas-company` and `atlas-branding`
- [x] Documentation baseline reconciled for canonical bucket policy
- [x] Legacy bucket removal policy documented as manual infra action (no destructive auto-delete in API)

Verified: 2026-05-04 (API runtime search + compile checks)

## Phase 8 - Finance module

Spec: `docs/superpowers/specs/2026-05-04-phase8-finance-design.md`  
Plan: `docs/superpowers/plans/2026-05-04-phase8-finance.md`

- [x] Phase 8.1 - Accounting core (double-entry)
- [x] Company-scoped chart of accounts CRUD
- [x] Journal entry CRUD with balanced debit/credit lines
- [x] Base balance calculation per account and consolidated totals
- [x] Guided capture flow (income/expense/transfer) plus advanced entry editor
- [x] Phase 8.2 - Full multi-currency
- [x] Manual historical FX table by date/currency pair
- [x] Transaction conversion using historical rate traceability
- [x] Ledger and balance views with original and converted amounts
- [x] Phase 8.3 - Analytics and dashboard
- [x] Financial widgets (operational + analytical) over active company data
- [x] Period trend and variance cards
- [x] Optional contact relation in transactions (only when contacts module is available)

Verified: 2026-05-25 (`node --check apps/api/src/services/finance-service.js`; `pnpm.cmd --filter @atlas/desktop build:web`; finance entry UI now supports optional per-line contact selection in `EntrySheet`; backend validates contact ownership only when `atlas.contacts` is enabled+installed)

### Phase 8.4-A - AR/AP Core Expansion

Spec: `docs/superpowers/specs/2026-05-04-phase8-4-finance-expansion-design.md`  
Plan: `docs/superpowers/plans/2026-05-04-phase8-4-finance-expansion.md`

- [x] Unified finance document subledger (AR/AP)
- [x] FIFO allocation engine with validation tests
- [x] Document application flows (`preview` and `apply`) in API
- [x] Automatic accounting traceability links per document event
- [x] Aging service (`0-30`, `31-60`, `61-90`, `90+`)
- [x] SDK contracts for documents, applications, aging, and journal links
- [x] Finance sidebar routes for `CxC`, `CxP`, `Aging`, and `Aplicaciones`
- [x] Desktop AR/AP screens with document creation and lifecycle actions
- [x] Desktop application workflows (FIFO automatic + manual editable allocation)
- [x] Desktop journal-links panel for accounting traceability

Verified: 2026-05-05 (`node --test apps/api/src/services/__tests__/finance-application-engine.test.js`, `node --check apps/api/src/services/finance-documents-service.js`, `node --check apps/api/src/services/finance-posting-service.js`, `node --check apps/api/src/services/finance-aging-service.js`, `node --check apps/api/src/index.js`, `node --check packages/sdk/src/index.js`, `pnpm.cmd --filter ./apps/desktop build:web`)

### Phase 8.4-B - Application reversal + cross-currency traceability

Spec: `docs/superpowers/specs/2026-05-05-phase8-4-b-finance-application-reversal-design.md`  
Plan: `docs/superpowers/plans/2026-05-05-phase8-4-b-finance-application-reversal.md`

- [x] `FinanceDocumentApplication` extended with status + reversal metadata + FX fields
- [x] `REVERSE` event support in finance document accounting links
- [x] Cross-currency application resolution using historical FX rates (direct or inverse)
- [x] Cross-currency preview/apply API responses include source/target amount trace
- [x] Reversal endpoint `POST /finance/applications/:id/reverse` with transactional restoration and idempotency guard
- [x] Validators + SDK contracts updated (`status` filter + reverse mutation)
- [x] Applications desktop view updated with status filter, status badges, FX columns, and reverse action
- [x] Applications CSV export expanded with status/FX/reversal metadata

Verified: 2026-05-05 (`pnpm.cmd prisma migrate dev`, `pnpm.cmd db:generate`, `node --check apps/api/src/services/finance-documents-service.js`, `node --check apps/api/src/services/finance-posting-service.js`, `node --check apps/api/src/index.js`, `node --check packages/validators/src/index.js`, `node --check packages/sdk/src/index.js`, `pnpm.cmd --filter ./apps/desktop build:web`)

### Phase 8.5 - Taxes and withholdings

Spec: `docs/superpowers/specs/2026-05-05-phase8-5-finance-taxes-withholdings-design.md`  
Plan: `docs/superpowers/plans/2026-05-05-phase8-5-finance-taxes-withholdings.md`

- [x] Added tax domain models in Prisma schema (`FinanceTaxRate`, `FinanceDocumentTaxLine`, `FinanceTaxKind`)
- [x] Added forward migration folder `20260505073000_phase8_5_finance_taxes_withholdings`
- [x] Added validators and SDK contracts for finance tax catalog
- [x] Added API tax catalog endpoints (`GET/POST/PATCH /finance/tax-rates`)
- [x] Extended finance document creation to persist tax trace lines and summary metadata
- [x] Added finance sidebar route and screen section for `Impuestos`
- [x] Added document modal tax selection with subtotal and suggested total preview
- [x] Apply migration in live dev DB and run DB-backed smoke for tax persistence

Verified: 2026-05-05 (`pnpm.cmd db:migrate`, `pnpm.cmd db:generate`, `pnpm.cmd --filter ./apps/desktop build:web`, manual smoke for `/finance/tax-rates` and document tax flow)

### Phase 8.6 - Finance operations UX (AR/AP)

Spec: `docs/superpowers/specs/2026-05-05-phase8-6-finance-operations-ux-design.md`  
Plan: `docs/superpowers/plans/2026-05-05-phase8-6-finance-operations-ux.md`

- [x] Operational status layer in UI with overdue detection (`OVERDUE`)
- [x] Spanish status labels for AR/AP daily operations
- [x] Status filter in CxC and CxP tables (`Todos`, `Vencidos`, `Abiertos`, `Parciales`, `Pagados`, `Anulados`)
- [x] Overdue badge style (`destructive`) for faster visual triage
- [x] Quick reminder action in AR/AP row action menu for open balances
- [x] Persist reminder actions as notification records (API-backed)
- [x] Due-date filters (`Vence hoy`, `Esta semana`) in CxC and CxP
- [x] Bulk reminder action for visible rows with open balances

Verified: 2026-05-05 (`node --check apps/api/src/services/finance-documents-service.js`, `node --check apps/api/src/index.js`, `node --check packages/validators/src/index.js`, `node --check packages/sdk/src/index.js`, `pnpm.cmd --filter ./apps/desktop build:web`, `FINANCE_FINAL_SMOKE_OK` scripted run covering taxes, reminders, cross-currency apply, and reversal)

## Phase 9 - HR module

Spec: `docs/superpowers/specs/2026-05-05-phase9-hr-design.md`  
Plan: `docs/superpowers/plans/2026-05-05-phase9-hr.md`

- [x] Dedicated routes for HR list and employee detail (`/hr/employees`, `/hr/employees/:id`)
- [x] Single long-form employee view with all core sections visible (not modal-first)
- [x] View/Edit toggle with stable layout and async loading safeguards
- [x] Full HR v1 employee model fields persisted via API/SDK/Prisma
- [x] Rich markdown notes editor + rendered read mode
- [x] Employee dossier attachments via canonical files pipeline (`atlas-files`)
- [x] Embedded employee audit timeline (`actor/action/timestamp`)
- [x] Permission and auth contracts for `hr.employee|department|job_title|org_chart.*`

Verified: 2026-05-25 (`node --check apps/api/src/services/hr-service.js`; `node --check apps/api/src/index.js`; `node --check packages/sdk/src/index.js`; `node --check packages/validators/src/index.js`; `node --test apps/api/src/services/__tests__/rbac-granular-contract.test.js`; `pnpm.cmd --filter @atlas/desktop build:web`; `rg -n "atlas.hr:/hr/employees|atlas.hr:/hr/employees/:id" apps/desktop/src/app/ModuleOutlet.jsx`; `rg -n "queryKey: \\[\\\"hr-employee-audit\\\"|FilesPanel|MarkdownField|isEditing" apps/desktop/src/modules/atlas.hr/screens/HrEmployeeDetail.jsx`)

## Phase 9.5 - Module Lifecycle v2

Spec: `docs/superpowers/specs/2026-05-09-module-lifecycle-v2-and-custom-modules-design.md`
Plan: `docs/superpowers/plans/2026-05-09-module-lifecycle-v2-and-custom-modules.md`

- [x] `Permission.active`, `Permission.moduleKey`, `AtlasModule.lifecycleConfig` — migration `20260509100000_module_lifecycle_v2`
- [x] Seed backfill: `active=false` for all permissions belonging to uninstalled/disabled modules
- [x] `module-cleanup-registry.js` — Map of per-module `{ count, purge }` handlers; atlas.ledger handler registered
- [x] `module-lifecycle-service.js` — `install`, `disable`, `enable`, `uninstall`, `reset`, `dryRunUninstall`, `dryRunReset`, `syncModules`
- [x] `getUserContextByAuthId` — `WHERE active = true` filter in both membership and admin permission loads (fail-closed)
- [x] `routes/modules.js` — 12-endpoint router extracted from `index.js` + new lifecycle endpoints
- [x] `GET /identity/permissions` — defaults to `active: true` filter; `?includeInactive=true` override available
- [x] `PATCH /identity/roles/:id/permissions` — only assigns active permissions to roles
- [x] Manifest v2 lifecycle blocks on all 4 feature manifests (contacts, finance, hr, ledger)
- [x] SDK `modules` domain expanded: `getAvailable`, `sync`, `getLifecycle`, `uninstallDryRun`, `uninstallExplicit`, `resetDryRun`, `reset`

Verified: 2026-05-09 (`node --check` all 7 modified/created service and route files; `pnpm exec prisma validate` — schema valid; `pnpm build` — full monorepo including Tauri native bundle passes; manual DB steps pending: `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:seed`, and curl smoke tests against running API require stopping dev server for db:generate on Windows)

---

## RME3 — Runly Module Engine v3

> Runly ERP is no longer an ERP with modules. Runly ERP is a module engine that ships ERP modules.

Architecture: `docs/architecture/runly-module-engine-v3.md`  
Custom modules guide: `docs/03_custom_modules.md`  
Module system: `docs/02_module_system.md`

**No new module work should extend the old system.** Old code (`packages/maps/`, transitional Prisma models, manual route mounting) may remain temporarily only to keep the app running during migration. Any new feature waits for the relevant RME3 layer or builds it first.

### RME3 Phase 1 — Package Foundation and Lifecycle v2

**Required spec:** `docs/superpowers/specs/2026-05-09-ame3-module-engine-foundation.md`  
**Required plan:** `docs/superpowers/plans/2026-05-09-ame3-module-engine-foundation.md`

- [x] `docs/architecture/runly-module-engine-v3.md` — master RME3 architecture document
- [x] `docs/03_custom_modules.md` — custom module developer guide
- [x] `docs/02_module_system.md` — module system rewrite (RME3-first)
- [x] `docs/01_erp_architecture.md` — updated architecture reference
- [x] `README.md` — updated module system and architecture sections
- [x] `docs/00_project_status.md` — RME3 direction and roadmap added
- [x] Module Lifecycle v2 (Phase 9.5): `Permission.active`, dry-run, reset, purge-data, cleanup registry
- [x] _Spec approved_ → Create `packages/module-engine/` — exports `defineAtlasModule`, `defineModel`, `defineView`, `definePage`
- [x] _Spec approved_ → Create `modules/custom/` directory with `README.md` and `.gitkeep`
- [x] _Spec approved_ → File-system discovery from `modules/custom/` at API boot and `POST /modules/sync`

Verified: 2026-05-09 (node --check 13 source files — all pass; node --test 4 test files — 61 tests, 0 fail [15 define-module, 14 define-model, 22 sql-generator, 10 checksum]; 16 named exports verified importable from packages/module-engine/src/index.js; pnpm --filter ./apps/desktop build:web exits 0)

### RME3 Phase 2 — Folder Structure and Custom Sample Module

**Required spec:** `docs/superpowers/specs/2026-05-09-ame3-custom-fleet-module.md`  
**Required plan:** `docs/superpowers/plans/2026-05-09-ame3-custom-fleet-module.md`

- [x] _Spec approved_ → Create `modules/official/` directory (migration target, initially empty)
- [x] _Spec approved_ → Route Loader: mount `api/index.js` from `modules/custom/*/` automatically
- [x] _Spec approved_ → Build and document one complete sample custom module (`custom.demo` or `custom.fleet`)
- [x] _Spec approved_ → Module-local validators auto-discovered from `validators/index.js` (no `packages/validators/` edit required)
- [x] _Spec approved_ → `@atlas/module-engine` ships with `defineAtlasModule`, `defineModel`, `defineView`, `definePage`

Verified: 2026-05-20 (`node --check apps/api/src/services/route-loader-service.js`; `node --check apps/api/src/services/module-discovery-service.js`; `node --check modules/custom/custom.fleet/module.manifest.js`; `node --test packages/module-engine/src/__tests__/define-module.test.js`; `pnpm.cmd --filter @atlas/desktop build:web`)

### RME3 Phase 3 — Runly ORM and Blueprint Renderer [COMPLETE]

**Spec:** `docs/superpowers/specs/2026-05-10-ame3-atlas-orm-blueprint-renderer-design.md`  
**Plan:** `docs/superpowers/plans/2026-05-10-ame3-atlas-orm-blueprint-renderer.md`

- [x] Add `AtlasModel`, `AtlasField`, `AtlasView`, `ModuleMigration` to `prisma/schema.prisma` — Verified: 2026-05-13 (migration applied, tables confirmed)
- [x] Runly ORM: provisions `atlas_*` tables from `defineModel` declarations, forward-only — Verified: 2026-05-13 (`fleet_vehicle`, `fleet_maintenance` provisioned by ORM hook)
- [x] Blueprint renderer: `AtlasTable`, `AtlasForm`, `AtlasDetail`, `AtlasCrudView`, `AtlasCardView`, `AtlasTableToolbar`, `AtlasSortMenu` — Verified: 2026-05-13 (build passes, browser renders list/detail/form)
- [x] Component Registry: `registry.register(key, component)` from module `components/index.js` — Verified: 2026-05-13 (route-loader-service loads components on boot)
- [x] First full RME3 module end-to-end: zero Prisma edits, zero manual route mounting, zero manual screen registration — Verified: 2026-05-13 (`custom.fleet` installs, provisions tables, mounts routes, and renders via `BlueprintCrudScreen` fallback with no hardcoded SCREEN_MAP entry)
- [x] Route Loader lifecycle wiring: install/retry-install/enable reload routes; disable/uninstall/clear-error/cleanup unload routes — in-memory state matches DB without API restart — Verified: 2026-05-14 (static checks + build pass; runtime validation pending API restart)

### custom.fleet Operational Expansion [COMPLETE]

**Spec:** `docs/superpowers/specs/2026-05-14-custom-fleet-operational-expansion-design.md`
**Plan:** `docs/superpowers/plans/2026-05-14-custom-fleet-operational-expansion.md`

- [x] Additive migrations: `fleet_vehicle` expansion columns (`vehicle_type_id`, `vehicle_brand_id`, `economic_group_number`, `economic_individual_number`, `photo_asset_id`) and `fleet_maintenance` expansion columns (`maintenance_type_id`, `title`, `status`, `driver_id`, `started_at`, `odometer_km`, `provider`, `currency`) — Verified: 2026-05-16 (all columns present in DB)
- [x] Seven new fleet tables provisioned via Runly ORM: `fleet_driver`, `fleet_vehicle_type`, `fleet_vehicle_brand`, `fleet_maintenance_type`, `fleet_vehicle_document`, `fleet_driver_document`, `fleet_maintenance_document` — Verified: 2026-05-16 (all 9 fleet tables present in DB)
- [x] Fleet service layer split: `fleet-service.js` → domain files (`driver-service.js`, `maintenance-service.js`, `catalog-service.js`) + `service-helpers.js` shared utilities — Verified: 2026-05-16 (34/34 node --check pass)
- [x] Driver CRUD API: full lifecycle with license fields, document associations, file resolution — Verified: 2026-05-16 (POST 201, GET 200, PATCH 200, PATCH/enabled 200)
- [x] Maintenance CRUD API: expanded schema with `type` enum, status lifecycle, odometer, cost, provider — Verified: 2026-05-16 (POST 201 `type:preventive`, GET 200, PATCH 200, PATCH/enabled 200)
- [x] Catalog APIs: vehicle types, vehicle brands, maintenance types with seed endpoint — Verified: 2026-05-16 (all 3 catalogs return 200 list, 201 create, 200 PATCH/enabled)
- [x] Document attachment endpoints for vehicles, drivers, and maintenance — Verified: 2026-05-16 (`GET /fleet/vehicles/:id/documents` → 200 with `data` array)
- [x] `ALLOWED_FILE_ENTITY_TYPES` updated: `FleetVehicle`, `FleetDriver`, `FleetMaintenance` — Verified: 2026-05-16 (code review of `files-service.js`; GET /files with fleet entity types returns 200)
- [x] Module manifest v0.2.0: 9 models, 21 views, 4 navigation items, 17 permissions — Verified: 2026-05-16 (AtlasModel: 9 rows, AtlasView: 21 rows, all enabled)
- [x] `syncModuleMetadata` transaction timeout fixed to 30s — Verified: 2026-05-16 (`module-metadata-service.js` line 284 `{ timeout: 30000 }`)
- [x] Desktop build passes — Verified: 2026-05-16 (`pnpm --filter @atlas/desktop build:web` → 1.42s, exit 0)
- [x] Smoke test: 46/46 E2E checks pass — Verified: 2026-05-16 (SMOKE_PASS: module sync, 6 list endpoints, catalog CRUD, driver CRUD, vehicle CRUD, maintenance CRUD, files integration)

Known follow-ups: relation field picker UX, DocumentsPanel UI component, fleet dashboards, maintenance type unique name DB constraint.

### custom.fleet + Blueprint Renderer Stabilization [COMPLETE]

**Spec:** `docs/superpowers/specs/2026-05-16-custom-fleet-blueprint-stabilization-design.md`  
**Plan:** `docs/superpowers/plans/2026-05-16-custom-fleet-blueprint-stabilization.md`

- [x] Multi-segment route parsing for blueprint CRUD routes (`catalogs/vehicle-types`, `catalogs/vehicle-brands`, `catalogs/maintenance-types`) in `BlueprintCrudScreen` — Verified: 2026-05-16 (runtime route harness `RUNTIME_ROUTE_VALIDATION_OK` across 20 route cases)
- [x] Longest PAGE path matching before entity fallback — Verified: 2026-05-16 (runtime route harness confirms `/app/m/custom.fleet/catalogs/*` uses full PAGE base path for list/create/detail/edit)
- [x] Canonical `schema.apiPath` usage (no fake appended IDs from route subsegments) — Verified: 2026-05-16 (runtime route harness confirms no generated requests for `/fleet/catalogs/vehicle-types/vehicle-types`, `/fleet/vehicles/m`, `/fleet/vehicles/new` as record id)
- [x] Explicit `schema.formMode` support (`page`/`sheet`/`auto`) in renderer adapters + CRUD view — Verified: 2026-05-16 (static diff + build pass)
- [x] Maintenance page-mode is metadata-driven (`schema.formMode = 'page'` in `maintenance.form.js`) — Verified: 2026-05-16 (blueprint metadata change only; no module hardcode in renderer)
- [x] Runtime availability checks for requested UI routes — Verified: 2026-05-16 (`Invoke-WebRequest` returns HTTP 200 for all maintenance/catalog/regression frontend routes)
- [x] No new CORS regressions — Verified: 2026-05-16 (`OPTIONS` preflight on `/fleet/maintenance`, `/fleet/catalogs/vehicle-types`, `/fleet/catalogs/vehicle-brands`, `/fleet/catalogs/maintenance-types`, `/fleet/vehicles`, `/fleet/drivers` → HTTP 204 with `access-control-allow-origin=http://localhost:5173`)
- [x] Desktop build passes — Verified: 2026-05-16 (`pnpm.cmd --filter @atlas/desktop build:web` → built in 1.66s, exit 0)

Verified: 2026-05-16 (`node --check packages/ui/src/atlas-renderer/renderer-adapters.js`; `node --check modules/custom/custom.fleet/views/maintenance.form.js`; `node --check apps/desktop/src/shell/BlueprintCrudScreen.jsx` and `node --check packages/ui/src/atlas-renderer/AtlasCrudView.jsx` executed but this Node runtime reports `ERR_UNKNOWN_FILE_EXTENSION` for `.jsx`; `pnpm.cmd --filter @atlas/desktop build:web`; frontend route HTTP checks; API CORS preflight checks; runtime route harness output `RUNTIME_ROUTE_VALIDATION_OK`)

### Blueprint Schema Expansion — Relation Fields [COMPLETE]

**Spec:** `docs/superpowers/specs/2026-05-16-blueprint-schema-relation-fields-design.md`  
**Plan:** `docs/superpowers/plans/2026-05-16-blueprint-schema-relation-fields.md`

- [x] `normalizeRelationDescriptor(fieldLike)` added to `packages/ui/src/atlas-renderer/renderer-adapters.js` — normalizes `source`, `apiPath`, `valueField`, `labelField` (string or array), `labelSeparator`, search/page params, `pageSize`, `preload`, `clearable`, `disabledField` with safe defaults; returns `null` for invalid config — Verified: 2026-05-16 (`node --check packages/ui/src/atlas-renderer/renderer-adapters.js` → OK)
- [x] `RelationSelectField` component added to `packages/ui/src/components/FormFields.jsx` — combobox control with Spanish loading/error/empty/search/clear states and `onSearchChange` callback — Verified: 2026-05-16 (included in build; `ERR_UNKNOWN_FILE_EXTENSION` from `node --check` on `.jsx` is expected)
- [x] `AtlasForm` updated: imports, `normalizeField`/`normalizeSections` preserve `relation` metadata; `loadRelationOptions` async loader (preload + debounced remote search); `resolveRelationLabel` for string and array `labelField`; `case "relation"` renders `RelationSelectField` with per-field relation state; invalid config degrades to labeled placeholder — Verified: 2026-05-16 (build pass)
- [x] `vehicle.form.js`: `vehicle_type_id` → relation `/fleet/catalogs/vehicle-types`; `vehicle_brand_id` → relation `/fleet/catalogs/vehicle-brands`; `driver_id` → relation `/fleet/drivers` (composed `first_name last_name`) — Verified: 2026-05-16 (`node --check` → OK)
- [x] `maintenance.form.js`: `maintenance_type_id` → relation `/fleet/catalogs/maintenance-types`; `vehicle_id` → required relation `/fleet/vehicles` (composed `plate · model_name`); `driver_id` → relation `/fleet/drivers` (composed `first_name last_name`) — Verified: 2026-05-16 (`node --check` → OK)
- [x] Desktop build passes — Verified: 2026-05-16 (`pnpm.cmd --filter @atlas/desktop build:web` → ✓ built in 2.78s, 0 errors, 4404 modules transformed)

Runtime checks: Not verified in this session (no browser access). Required manual follow-up:

- Vehicle form relation selectors (vehicle_type_id, vehicle_brand_id, driver_id) load options from API
- Maintenance form relation selectors load options (maintenance_type_id, vehicle_id, driver_id)
- Search triggers debounced re-fetch from remote endpoints
- Required relation fields block submit when empty
- Optional relation fields clear to null and submit null
- Edit mode shows readable labels for persisted IDs
- Payload inspection confirms only scalar IDs submitted (no label text)
- Existing text/select/date/number/boolean fields unaffected
- No custom.fleet hardcoding in core renderer files

### custom.fleet Vehicle Catalog Relational Redesign [COMPLETE]

**Spec:** `docs/superpowers/specs/2026-05-16-custom-fleet-vehicle-catalog-relational-redesign-design.md`
**Plan:** `docs/superpowers/plans/2026-05-16-custom-fleet-vehicle-catalog-relational-redesign.md`

- [x] `fleet_vehicle_model` table created (V004): brand_id FK, type_id FK, name, year, company-scoped, soft-delete, 4 indexes including unique (company, brand, type, name, year) — Verified: 2026-05-16 (DB column check + direct INSERT via smoke test HTTP 201)
- [x] `vehicle_model_id` FK column added to `fleet_vehicle` (V004 ALTER TABLE) — Verified: 2026-05-16 (information_schema column check: nullable=YES)
- [x] `economic_group_number` column added to `fleet_vehicle_type` (V005 ALTER TABLE) — Verified: 2026-05-16 (PATCH /fleet/catalogs/vehicle-types/:id returns updated field)
- [x] `brand`, `model_name`, `year` columns made nullable in `fleet_vehicle` (V004b) — Verified: 2026-05-16 (information_schema column check: nullable=YES; vehicle INSERT with only vehicle_model_id returns HTTP 201)
- [x] `vehicle-model.model.js` added to module manifest and AtlasModel table — Verified: 2026-05-16 (AtlasModel query: `fleet.vehicle_model -> fleet_vehicle_model`, modelsCount=10 in sync response)
- [x] Catalog service updated: vehicle type supports `economic_group_number` on create/update; full vehicle model CRUD (`listVehicleModels`, `createVehicleModel`, `updateVehicleModel`, `setVehicleModelEnabled`) with brand_name/type_name enrichment — Verified: 2026-05-16 (GET /fleet/catalogs/vehicle-models returns `brand_name: Kenworth`, `type_name: Camion`)
- [x] Catalogs routes: 4 new `/fleet/catalogs/vehicle-models` endpoints (GET, POST, PATCH /:id, PATCH /:id/enabled) — Verified: 2026-05-16 (smoke tests HTTP 200/201/409 as expected)
- [x] Fleet service updated: `listVehicles`/`getVehicle` JOIN `fleet_vehicle_model` + COALESCE fallback for `vehicle_brand_name`, `vehicle_type_name`, `economic_group_number_resolved`; `createVehicle`/`updateVehicle` accept `vehicle_model_id` — Verified: 2026-05-16 (GET /fleet/vehicles/:id returns `vehicle_model_name: T680`, `vehicle_brand_name: Kenworth`, `economic_number: 0002-0042`)
- [x] Blueprint views: `catalog.vehicle-models.table.js`, `.form.js` (brand_id + type_id relation fields), `.page.js` created — Verified: 2026-05-16 (AtlasView query: 3 new views present, type=TABLE/FORM/PAGE; `node --check` all pass)
- [x] `vehicle.form.js` updated: removed legacy brand/model_name/year/vehicle_type_id/vehicle_brand_id/economic_group_number fields; added `vehicle_model_id` relation selector — Verified: 2026-05-16 (`node --check` → OK; build pass)
- [x] `vehicle.table.js` updated: removed brand/model_name/year columns; added vehicle_model_name, vehicle_brand_name, vehicle_type_name — Verified: 2026-05-16 (`node --check` → OK)
- [x] `vehicle.detail.js` updated: shows vehicle_model_name, vehicle_model_year, vehicle_brand_name, vehicle_type_name, economic_number — Verified: 2026-05-16 (`node --check` → OK)
- [x] `catalog.vehicle-types.form.js` updated: added `economic_group_number` field — Verified: 2026-05-16 (`node --check` → OK)
- [x] Module manifest updated to v0.3.0: 10 models, 24 views, VehicleModel ACL, new navigation entry — Verified: 2026-05-16 (POST /modules/sync → modelsCount=10, viewsCount=24)
- [x] Desktop build passes — Verified: 2026-05-16 (`pnpm.cmd --filter @atlas/desktop build:web` → ✓ built in 2.61s, 0 errors)
- [x] API smoke tests: vehicle type with economic_group_number (201), vehicle brand (201), vehicle model (201), duplicate model (409), vehicle with vehicle_model_id (201), enriched GET/list with correct economic_number (0002-0042) — Verified: 2026-05-16

Verified: 2026-05-16 (full stack: DB migrations applied, module synced, all smoke tests pass)
Note: 2026-05-16 manual authenticated regression helper added at `scripts/smoke-fleet-relational.mjs` (requires `ATLAS_TOKEN`; runtime endpoint verification remains manual, not browser-automated).

### custom.fleet Catalog Hub Tabs [VERIFIED]

Spec: `docs/superpowers/specs/2026-05-16-custom-fleet-catalog-hub-tabs-design.md`  
Plan: `docs/superpowers/plans/2026-05-16-custom-fleet-catalog-hub-tabs.md`

- [x] Fleet sidebar catalog navigation simplified to one `Catálogos` entry pointing to `/app/m/custom.fleet/catalogs` and redundant `Modelos de vehículo` entry removed — Verified: 2026-05-16 (`node --check modules/custom/custom.fleet/module.manifest.js`)
- [x] Blueprint shell route-group catalog tabs added for grouped PAGE routes (including base-route redirect from `/catalogs` to default tab route) without duplicating CRUD rendering — Verified: 2026-05-16 (`pnpm.cmd --filter @atlas/desktop build:web`)
- [x] Runtime metadata sync and browser UX verification completed — Verified: 2026-05-16 (authenticated `POST /modules/sync` 200; sidebar shows one `Catálogos` entry; separate `Modelos de vehículo` removed; tabs visible for Tipos/Marcas/Modelos/Mantenimiento; each tab navigates to its route and renders existing CRUD table; direct catalog routes work; `Número económico de grupo` remains visible in vehicle type form; relation inline-create metadata remains present).

### custom.fleet Detail UX & Relationship Cards [VERIFIED]

Spec: `docs/superpowers/specs/2026-05-16-custom-fleet-detail-ux-relationship-cards-design.md`  
Plan: `docs/superpowers/plans/2026-05-16-custom-fleet-detail-ux-relationship-cards.md`

- [x] Fleet API enrichment for detail UX: vehicle detail now includes `driver_name`, `driver_phone`, `driver_license_number`; maintenance detail/list now include readable relation fields including `maintenance_type_name` and vehicle context — Verified: 2026-05-16 (`node --check modules/custom/custom.fleet/api/fleet-service.js`, `node --check modules/custom/custom.fleet/api/maintenance-service.js`)
- [x] New company-scoped endpoint `GET /fleet/drivers/:id/vehicles` added for relation-list cards in driver detail — Verified: 2026-05-16 (`node --check modules/custom/custom.fleet/api/driver-service.js`, `node --check modules/custom/custom.fleet/api/drivers-routes.js`)
- [x] Generic `AtlasDetail` renderer support added for `relation-card` and `relation-list` section types plus metadata-driven field icons (no custom.fleet hardcoding) — Verified: 2026-05-16 (`pnpm.cmd --filter @atlas/desktop build:web`; `node --check` for `.jsx` not available in this Node runtime due `ERR_UNKNOWN_FILE_EXTENSION`)
- [x] Sidebar icon resolver updated to correctly map Fleet icon names (`Truck`, `Wrench`, `ClipboardList`, `UserCheck`, `BookOpen`, `Library`, `Layers`) with safe fallback — Verified: 2026-05-16 (`pnpm.cmd --filter @atlas/desktop build:web`)
- [x] Fleet detail blueprints updated: vehicle driver relation card, driver assigned-vehicles relation list, maintenance vehicle/driver relation cards, and Spanish icon metadata while keeping DocumentsPanel sections — Verified: 2026-05-16 (`node --check modules/custom/custom.fleet/views/vehicle.detail.js`, `node --check modules/custom/custom.fleet/views/driver.detail.js`, `node --check modules/custom/custom.fleet/views/maintenance.detail.js`)
- [x] Runtime metadata synced via safe local tokenless metadata service script (no manual token flow) and AtlasView detail schemas updated — Verified: 2026-05-16 (sync result: `moduleKey=custom.fleet`, `syncedModels=10`, `syncedViews=24`; detail schemas include `relation-card`/`relation-list` + `documents` sections)
- [x] Authenticated contract verification for permissions and fail-closed company scope added in automated route tests (`fleet-routes-auth.test.js`) and service regression suite extended for scoped UUID behavior — Verified: 2026-05-20 (`node --test modules/custom/custom.fleet/api/__tests__/fleet-routes-auth.test.js`; `node --test modules/custom/custom.fleet/api/__tests__/fleet-services.test.js`)

Verified: 2026-05-20 (`node --test modules/custom/custom.fleet/api/__tests__/fleet-routes-auth.test.js`; `node --test modules/custom/custom.fleet/api/__tests__/fleet-services.test.js`; `pnpm.cmd --filter @atlas/desktop build:web`)

### Blueprint Attachments UI System + Fleet Form Opt-in [VERIFIED]

Spec: `docs/superpowers/specs/2026-05-16-blueprint-attachments-ui-system-design.md`  
Plan: `docs/superpowers/plans/2026-05-16-blueprint-attachments-ui-system.md`

- [x] Reusable attachments system implemented in `packages/ui` with shared controller/component flow (`useAttachmentsController`, `AttachmentsPanel`) and metadata-driven renderer integration — Verified: 2026-05-17 (static review + build pass)
- [x] `AtlasForm` supports attachments sections with create/edit lifecycle handling while remaining module-agnostic — Verified: 2026-05-17 (`pnpm.cmd --filter @atlas/desktop build:web`)
- [x] Fleet forms opt in via blueprint metadata only (`vehicle.form`, `driver.form`, `maintenance.form`) with no renderer hardcoding for `custom.fleet` — Verified: 2026-05-17 (runtime AtlasView schema check after safe local tokenless sync)
- [x] Create mode supports staged files before parent record exists and flushes upload/association after successful record creation — Verified: 2026-05-17 (implementation evidence in shared controller + form submit flow)
- [x] Edit mode supports existing attachment loading and immediate upload behavior — Verified: 2026-05-17 (implementation evidence + build pass)
- [x] `DocumentsPanel` remains compatible as wrapper over shared attachments logic for detail screens — Verified: 2026-05-17 (code review + build pass)
- [x] Attachments aside UX polished: no visible free-text document type input by default, no visible label input by default, inferred `document_type` from MIME/extension, filename as default label, and clear `Archivos pendientes`/`Archivos asociados` sections — Verified: 2026-05-17 (`node --check packages/ui/src/hooks/useAttachmentsController.js`; `pnpm.cmd --filter @atlas/desktop build:web`)
- [x] Browser/manual verification completed on Fleet vehicle create/detail flow: right-side `Documentos` aside visible, multi-file pending selection before save, differentiated file type visuals (including PDF icon/color), image thumbnail preview, cards with filename/type-extension/size/status, no visible `Tipo de documento` or `Etiqueta` inputs by default, save uploads/associates pending files, detail shows associated docs, and preview/open/download/remove actions available — Verified: 2026-05-20 (manual browser QA after latest attachments polish)

Verified: 2026-05-20 (`pnpm.cmd --filter @atlas/desktop build:web`; runtime service-level tokenless E2E previously passed for create/upload/associate/list/remove cleanup across Fleet vehicle/driver/maintenance + manual browser verification completed for vehicle attachments UX)

### custom.fleet Reportes V2 Rework [VERIFIED]

Plan: Fleet reportes V2 (maintenance/service/repair/other, strict typed flows)

- [x] New report domain models added and synced in manifest: `fleet.report`, `fleet.report_part`, `fleet.report_document` with company-scoped folio strategy by type (`MNT|SRV|REP|OTR`) and report status (`draft|finalized`) support.
- [x] New API router/service for reportes v2 with typed endpoints (`/fleet/reports/maintenance|service|repair|other`), common lifecycle endpoints (`/:id`, `/:id/enabled`, `/:id/finalize`, `/:id/reopen`), documents endpoints, parts list endpoint, and PDF generation endpoint (`GET /fleet/reports/:id/pdf`).
- [x] Strict business validation matrix enforced for report types (maintenance reminder requirement, service subtype + invoice/ticket, repair priority/damage/start-date/date coherence, other custom category).
- [x] Legacy maintenance flow removed from primary routing (`createMaintenanceRouter` no longer mounted in fleet router) and replaced by reports-first navigation/blueprints under `/app/m/custom.fleet/reports/*` with grouped tabs.
- [x] Reportes UI blueprints completed for 4 flows (`maintenance`, `service`, `repair`, `other`) including table/form/detail/page, status badge usage, attachments with `entityType: FleetReport`, relation-card vehicle context, parts relation-list in detail, and metadata-driven detail header actions (`Descargar PDF`, `Regenerar PDF`, `Finalizar`, `Reabrir`).
- [x] Files whitelist updated to allow report uploads (`FleetReport`) and report permissions aligned to `fleet.reports.read|create|update|delete` in module manifest ACL/navigation.

Verified: 2026-05-22 (`node --check modules/custom/custom.fleet/api/reports-service.js`; `node --check modules/custom/custom.fleet/api/reports-routes.js`; `node --check modules/custom/custom.fleet/api/vehicles-routes.js`; `node --check modules/custom/custom.fleet/validators/index.js`; `node --check modules/custom/custom.fleet/module.manifest.js`; `Get-ChildItem modules/custom/custom.fleet/views/reports*.js | ForEach-Object { node --check $_.FullName }`; `pnpm.cmd --filter @atlas/desktop build:web`)

### RME3 Phase 4 — Discovery as Primary Source

**Required spec:** `docs/superpowers/specs/2026-05-09-ame3-module-discovery-sync.md`  
**Required plan:** `docs/superpowers/plans/2026-05-09-ame3-module-discovery-sync.md`

- [x] _Spec approved_ → API boot reads modules from `modules/custom/` and `modules/official/` as primary sources
- [x] _Spec approved_ → `packages/maps/` read only as fallback for legacy official modules during decommission track
- [x] _Spec approved_ → Route Loader: mount all installed module routers at boot; unmount on disable/uninstall
- [x] _Spec approved_ → Component Registry: load all installed module component registrations at boot
- [x] _Spec approved_ → `POST /modules/sync` triggers re-discovery without restart

Verified: 2026-05-20 (`node --check apps/api/src/routes/modules.js`; `node --check apps/api/src/services/module-discovery-service.js`; `node --check apps/api/src/services/route-loader-service.js`; `node --check apps/api/src/services/module-lifecycle-service.js`; `node --check apps/api/src/services/module-metadata-service.js`; `node --check apps/api/src/services/module-migration-service.js`; `node --test packages/module-engine/src/__tests__/define-module.test.js`; `node --test packages/module-engine/src/__tests__/sql-generator.test.js`)

### RME3 Hardening — Discovery/Lifecycle/Route Loader

- [x] G1 package import hardening: API RME3 services now resolve `@atlas/module-engine` through workspace dependency (`@atlas/api` direct dependency added)
- [x] G2 discovery checksum enforcement: manifest migration checksums are validated during discovery (`MANIFEST_MIGRATION_CHECKSUM_MISMATCH` fail-fast)
- [x] G3 dependency cycle guard: required dependency cycle detection added for lifecycle install/sync and `/modules/sync` dependency reconciliation (`DEPENDENCY_CYCLE_DETECTED`)
- [x] G4 route collision visibility: route loader now detects `METHOD + PATH` collisions, keeps first owner, and marks conflicting module route loader state as `ERROR` with collision metadata
- [x] G5 `validateView` structural contracts: minimum schema validation added for TABLE/FORM/DETAIL kinds
- [x] G7 safe runtime signaling: desktop blueprint screen warns when namespaced component keys are missing from active runtime bundle and indicates rebuild requirement
- [x] G8 destructive uninstall mode: `purge-owned-tables` flow added with dry-run summary, `ACEPTO` confirmation, transactional table drop, migration ledger cleanup, and audit details
- [x] Regression/unit coverage added for new hardening behavior (`define-view`, dependency graph cycle detection, discovery checksum mismatch, route collision handling, lifecycle schema modes)

Verified: 2026-05-20 (`node --check apps/api/src/services/module-dependency-utils.js`; `node --check apps/api/src/services/module-discovery-service.js`; `node --check apps/api/src/services/module-migration-service.js`; `node --check apps/api/src/services/module-lifecycle-service.js`; `node --check apps/api/src/services/route-loader-service.js`; `node --check apps/api/src/routes/modules.js`; `node --check packages/module-engine/src/define-view.js`; `node --check packages/validators/src/index.js`; `node --test packages/module-engine/src/__tests__/define-view.test.js packages/validators/src/__tests__/module-lifecycle-schemas.test.js apps/api/src/services/__tests__/module-dependency-utils.test.js apps/api/src/services/__tests__/module-discovery-service.test.js apps/api/src/services/__tests__/route-loader-service.test.js`; `pnpm.cmd --filter @atlas/desktop build:web`)

### RME3 Phase 5 — Official Module Relocation to modules/official/ [RETIRED]

Architecture decision: as of 2026-05-25, relocating the six official base modules to `modules/official/` is no longer required.
Official modules remain in their current workspace locations, and RME3 continues through renderer completion and `packages/maps` decommission.

- [x] Decision recorded: remove official-module relocation as a required RME3 gate.
- [x] Roadmap realigned: subsequent RME3 phases no longer depend on module folder relocation.

Verified: 2026-05-25 (architecture decision documented in `docs/TASKS.md` and `AGENTS.md`)

### RME3 Phase 6 — Generic CRUD Blueprint Renderer

**Required spec:** `docs/superpowers/specs/YYYY-MM-DD-rme3-crud-blueprint-renderer.md`  
**Required plan:** `docs/superpowers/plans/YYYY-MM-DD-rme3-crud-blueprint-renderer.md`

- [x] Kickoff audit complete: renderer primitives (`AtlasTable`, `AtlasForm`, `AtlasDetail`, `AtlasCrudView`) and runtime registry wiring are present and actively used by `custom.fleet` routes.
- [x] _Spec approved_ → `AtlasTable` fully renders TABLE blueprints with sort, filter, and pagination controls.
- [x] _Spec approved_ → `AtlasForm` fully renders FORM blueprints using schema-driven sections, relation loaders, inline create, and submit validations.
- [x] _Spec approved_ → `AtlasDetail` renders DETAIL blueprints in read-only mode, including relation labels and attachments context.
- [x] _Spec approved_ → `AtlasCrudView` composes list + form + detail into a complete CRUD flow with create/view/edit transitions.
- [x] _Spec approved_ → Shell and layout resolution: `atlas.dashboardShell`, `atlas.crudLayout`
- [x] _Spec approved_ → Custom component key resolution via Component Registry

Verified: 2026-05-25 (`rg -n "filterValues|sortBy|sortDir|pagination|TablePaginationFooter" packages/ui/src/atlas-renderer/AtlasTable.jsx packages/ui/src/atlas-renderer/AtlasTableToolbar.jsx packages/ui/src/atlas-renderer/TablePaginationFooter.jsx`; `rg -n "normalizeSections|handleSubmit|relation|inlineCreate|AttachmentsPanel" packages/ui/src/atlas-renderer/AtlasForm.jsx packages/ui/src/atlas-renderer/atlas-form-schema.js`; `rg -n "readOnly|AttachmentsPanel" packages/ui/src/atlas-renderer/AtlasDetail.jsx`; `rg -n "AtlasTable|AtlasForm|AtlasDetail|mode=\"create\"|mode=\"edit\"" packages/ui/src/atlas-renderer/AtlasCrudView.jsx`; `node --test packages/ui/src/atlas-renderer/__tests__/renderer-adapters.test.js`; `pnpm.cmd --filter @atlas/desktop build:web`)

### RME3 Phase 7 — Remove packages/maps

**Required spec:** `docs/superpowers/specs/YYYY-MM-DD-rme3-remove-packages-maps.md`  
**Required plan:** `docs/superpowers/plans/YYYY-MM-DD-rme3-remove-packages-maps.md`

- [x] Kickoff inventory completed for `packages/maps` decommission: direct runtime/seed/test import points identified in API, desktop, and Prisma seed flows.
- [x] Desktop decommission cut #1 complete: removed `@atlas/maps` dependency/alias/import usage from runtime merge and module catalog install flow.
- [x] API decommission cut #1 complete: centralized official manifest access behind `module-manifests-service` and removed direct maps imports from module routes and RBAC contract tests.
- [x] Seed decommission cut #1 complete: `prisma/seed.js` now consumes `listOfficialModuleManifests()` and no longer imports map files directly.
- [x] _Spec approved_ → All official modules confirmed operational from current production locations (no `modules/official/` relocation required)
- [x] _Spec approved_ → `packages/maps/src/feature-modules.js` deleted
- [x] _Spec approved_ → `packages/maps/src/core-modules.js` deleted or absorbed into core runtime sources
- [x] _Spec approved_ → `packages/maps/` package removed from monorepo
- [x] _Spec approved_ → No remaining references to `packages/maps/` in core codebase

Verified: 2026-05-25 (`pnpm.cmd install --lockfile-only`; `node --check apps/api/src/index.js`; `node --check apps/api/src/routes/modules.js`; `node --check apps/api/src/services/module-manifests-service.js`; `node --check prisma/seed.js`; `node --check scripts/verify-permission-catalog.mjs`; `node --test apps/api/src/services/__tests__/rbac-granular-contract.test.js`; `node --test apps/api/src/services/__tests__/module-discovery-service.test.js apps/api/src/services/__tests__/route-loader-service.test.js apps/api/src/services/__tests__/module-dependency-utils.test.js`; `node --test packages/module-engine/src/__tests__/define-view.test.js packages/module-engine/src/__tests__/sql-generator.test.js`; `pnpm.cmd --filter @atlas/desktop build:web`; `rg -n "@atlas/maps|packages/maps" apps packages prisma scripts --glob "!**/dist/**"` -> `NO_MATCHES`)

---

## Future feature modules

- [ ] Purchases (supplier orders, receiving)
- [ ] Reports (cross-module reporting engine)

## Phase 10 - Responsive foundation, toolbar migrations, and Finance decomposition

### Phase 10.1 - Responsive / mobile foundation

- [x] Replaced `vh` with `dvh` in AppShell and all layout wrappers
- [x] Added `safe-area-inset` padding (`pb-[env(safe-area-inset-bottom)]`, `pt-safe`) across shell components
- [x] Added `min-w-0` to flex/grid children in AtlasApp shell to prevent overflow
- [x] Fixed `overflow-hidden` on body / `#root` to `overflow-auto` so content scrolls correctly
- [x] Responsive table column widths: `w-40 min-w-[10rem]` etc., no fixed `w-px` on data columns
- [x] Files and Contacts toolbars migrated to responsive grid; added `ViewModeSwitch`, `MobileFiltersSheet`, and `ListLayout` shared components to `@atlas/ui`
- [x] Button, Card, Pagination, PageHeader, Input components updated with responsive token sizes

Verified: 2026-05-06 (manual audit of AppShell, AtlasApp, Files, Contacts, and HR toolbars; all layout wrappers confirmed dvh + safe-area)

### Phase 10.2 - Finance module decomposition

- [x] Extracted all constants and utility functions from `FinanceScreen.jsx` into `lib/finance-utils.js` (~302 lines)
- [x] Created 8 self-contained Sheet components: `AccountSheet`, `DocumentSheet`, `EntrySheet`, `GuidedEntrySheet`, `ApplySheet`, `JournalLinksSheet`, `ReverseApplicationSheet`, `ReminderSheet`
- [x] Replaced all `window.prompt` violations with `ReverseApplicationSheet` (reversal reason textarea) and `ReminderSheet` (single + bulk reminder message)
- [x] Created 9 fully self-contained sub-screens: `FinanceSummary`, `FinanceAr`, `FinanceAp`, `FinanceAging`, `FinanceApplications`, `FinanceAccounts`, `FinanceEntries`, `FinanceTaxes`, `FinanceFxRates`
- [x] Replaced original 4462-line `FinanceScreen.jsx` monolith with 30-line orchestrator that routes to each sub-screen via `resolveFinanceSection`
- [x] All Finance files are under 1000 lines (largest: `FinanceApplications.jsx` at ~503 lines)
- [x] No `window.prompt`, `window.confirm`, or `window.alert` remain in the finance module

Verified: 2026-05-06 (`wc -l apps/desktop/src/modules/atlas.finance/screens/*.jsx apps/desktop/src/modules/atlas.finance/components/*.jsx apps/desktop/src/modules/atlas.finance/lib/finance-utils.js` — all under 1000 lines; `grep -r "window.prompt\|window.confirm\|window.alert" apps/desktop/src/modules/atlas.finance/` returns no results)

## Phase 11 - RBAC granular por feature (v2)

Spec: `docs/superpowers/specs/2026-05-08-rbac-granular-phase2-design.md`  
Plan: `docs/superpowers/plans/2026-05-08-rbac-granular-phase2.md`

- [x] Granular contract helpers (`module.access` + `module.feature.action`) and uniqueness checks
- [x] Oleada A manifests (`core`, `identity`, `company`) with ACL granular
- [x] Oleada B/C manifests (`files`, `contacts`, `finance`, `hr`) with ACL granular
- [x] API guards en modo granular-only (sin fallback legacy)
- [x] Runtime module and navigation checks con verificacion directa granular
- [x] Catalogo de permisos explicito en espanol para todas las llaves declaradas en manifiestos
- [x] Limpieza de permisos legacy en seed (Permission + RolePermission obsoletos)
- [x] Script operativo `rbac:verify-catalog` para validar `missing_in_catalog=0`
- [x] Roles/Permissions UI redesigned as module > feature > action tree with bulk toggles
- [x] Documentation rules for future modules (granular convention + authorization checklist)
- [x] Mandatory checklist for new modules:
  - [x] Declare granular permissions in manifest
  - [x] Map navigation `permissionKey` by route
  - [x] Protect API endpoints with granular guards
  - [x] Add role x endpoint authorization tests

Verified: 2026-05-08 (`node --test apps/api/src/services/__tests__/rbac-granular-contract.test.js`, `node --check apps/api/src/index.js`, `node --check packages/maps/src/core-modules.js`, `node --check packages/maps/src/feature-modules.js`, `node --check apps/api/src/permission-catalog.js`, `pnpm.cmd --filter ./apps/desktop build:web`)

## SDD Methodology adoption

Spec: `docs/superpowers/specs/2026-05-08-spec-driven-development-design.md`
Plan: `docs/superpowers/plans/2026-05-08-spec-driven-development.md`

- [x] Create `docs/spec-driven-development.md` (full methodology, 9 sections)
- [x] Create `docs/superpowers/README.md` (folder index, quick-start, existing spec/plan table)
- [x] Create `docs/superpowers/templates/feature-spec-template.md` (annotated 28-section skeleton)
- [x] Create `docs/superpowers/templates/implementation-plan-template.md` (task/checkbox plan skeleton)
- [x] Create `docs/superpowers/templates/verification-checklist-template.md` (grouped verification checklist)
- [x] Create `docs/superpowers/templates/decision-log-template.md` (5-field deviation log)
- [x] Add `## Spec-Driven Development` section to `CLAUDE.md`
- [x] Add principle #12 to `codex/00_MASTER_PROMPT.md`

Verified: 2026-05-08 (git commit 8249aac — 9 files changed, 1125 insertions; `grep "Spec-Driven" CLAUDE.md` returns section; `grep "spec aprobado" codex/00_MASTER_PROMPT.md` returns principle #12; all 4 template files present in `docs/superpowers/templates/`)

## custom.fleet Reportes V2 UX Rework

- [x] AtlasForm upgraded for report flows: collapsible sections + dedicated `parts-editor` section type with automatic `parts_cost` and `total_cost` recalculation.
- [x] New renderer helpers extracted to keep `AtlasForm.jsx` under project file-size limit (`<=1000` lines).
- [x] Report forms reworked for `maintenance`, `service`, `repair`, `other` with structured sections (vehiculo, datos, taller, refacciones, costos, observaciones, adjuntos) and labels in Spanish.
- [x] Removed unresolved custom badge dependencies in fleet table blueprints that caused “componentes no disponibles (requiere rebuild)” failures.

Verified: 2026-05-21 (`pnpm.cmd --filter @atlas/desktop build:web`; line-count check for `packages/ui/src/atlas-renderer/AtlasForm.jsx` = 978)

## custom.fleet Expansion — Fleet Operativo de Producción

Spec: `docs/superpowers/specs/2026-05-25-fleet-expansion-design.md`
Plan: `docs/superpowers/plans/ya-estamos-por-adaptive-backus.md`

### Área 1: Legacy Cleanup

- [x] Eliminated `fleet.maintenance`, `fleet.maintenance_document`, `fleet.maintenance_type` models from manifest
- [x] Deleted all legacy maintenance views: `maintenance.table.js`, `maintenance.form.js`, `maintenance.detail.js`, `catalog.maintenance-types.table.js`, `catalog.maintenance-types.form.js`, `catalog.maintenance-types.page.js`
- [x] Deleted legacy API files: `maintenance-routes.js`, `maintenance-service.js`
- [x] Removed maintenance navigation entries and ACL entries from `module.manifest.js`
- [x] Removed `createMaintenanceSchema`, `updateMaintenanceSchema` from `validators/index.js`
- [x] Unmounted maintenance router from `api/index.js`

### Área 2: Insurance Policy Entity

- [x] Created `fleet.insurance_policy` model (vehicle relation, insurer_name, policy_number, coverage_type, start/expiry dates, premium, currency, notes, document_asset_id; companyScoped + softDelete)
- [x] Added unique index on `(company_id, policy_number)` and expiry index for active-policy queries
- [x] `insurance-service.js`: `listPolicies`, `createPolicy` (uniqueness check), `getPolicy`, `updatePolicy`, `disablePolicy`, `listVehiclePolicies`, `getActivePolicyForVehicle`
- [x] `insurance-routes.js`: GET/POST /fleet/insurance, GET/PATCH/PATCH+enabled /:id, GET /fleet/vehicles/:vehicleId/insurance
- [x] `createInsurancePolicySchema` + `updateInsurancePolicySchema` with cross-field refinement (`expiry_date >= start_date`)
- [x] Manifest: 4 granular permissions (`fleet.insurance.read/create/update/delete`), Seguros navigation item with ShieldCheck icon
- [x] Insurance views: `insurance-policy.table.js`, `insurance-policy.form.js`, `insurance-policy.detail.js`, `insurance-policy.page.js`
- [x] Auth contract tests for all insurance routes

### Área 3: Vehicle Integration

- [x] `InsuranceBadgeCell.jsx` component (activa/vencida/sin póliza badges) registered in `components/index.js`
- [x] `fleet-service.js`: `listVehicles` enriched with `insurance_status` lateral query; `getVehicle` enriched with `active_insurance_policy`
- [x] `vehicle.table.js`: new `insurance_status` column using `custom.fleet:InsuranceBadgeCell`; `full_economic_number` computed column (`{group}-{individual}`)
- [x] `vehicle.detail.js`: `relation-card` "Póliza activa" (with empty-state CTA) + `relation-list` "Historial de pólizas"
- [x] `vehicles-routes.js`: `GET /fleet/vehicles/:vehicleId/insurance` delegating to insurance service

### Área 4: UX Polish + Validaciones

- [x] Cascading vehicle model picker: `catalogs-routes.js` accepts `?brand_id=&type_id=` filters; `vehicle.form.js` declares `dependsOn: ['vehicle_brand_id', 'vehicle_type_id']`
- [x] Financing validation fix: `updateVehicleSchema` correctly requires `financing_start_date` when `is_financed: true` and validates `financing_end_date >= financing_start_date`
- [x] Catalog filter: `GET /fleet/catalogs/vehicle-models?brand_id=&type_id=` scoped and paginated

Verified: 2026-05-26 (commits `d6e52cf`–`1be2e6a`; `node --check` on all modified files; `POST /modules/sync` rediscovery confirmed; insurance routes return 200 with empty list; vehicle list/detail include `insurance_status` and `active_insurance_policy`; browser QA: badge column visible, cascading picker filters correctly)

## Custom View Components — kind: CUSTOM + ImmersiveShell + Public Routes

Spec: `docs/superpowers/specs/2026-05-25-custom-view-components-design.md` (implied by plan)
Plan: `docs/superpowers/plans/` (inline subagent-driven-development session)

- [x] **CUSTOM validation in `define-view.js`**: validates `schema.component` (namespaced key `namespace:ComponentName`), `schema.path` (starts with `/`), `schema.public` (boolean true when declared), rejects `/p/` paths without `schema.public: true`
- [x] **16 passing tests** in `packages/module-engine/src/__tests__/define-view.test.js` covering all CUSTOM validation rules
- [x] **ImmersiveShell**: full-viewport hover-overlay nav wrapper (`apps/desktop/src/shell/ImmersiveShell.jsx`); mouse trigger ≤80px from top-left; 400ms hide delay; mobile hamburger at bottom-left; uses `h-full` (inside AtlasApp content area below topbar); no duplicate Topbar
- [x] **BlueprintCrudScreen CUSTOM branch**: `customBlueprint` useMemo + `isCustomView` flag; performance guards skip expensive memos on CUSTOM routes; renders `<ImmersiveShell>` wrapping the registered custom component; amber warning card if component not in registry
- [x] **GET /public/blueprints** unauthenticated endpoint: Prisma JSON path filter (`schema.public === true`), cacheGet/cacheSet with `TTL.BLUEPRINTS`, schema projection allowlist (`component`, `path`, `title`, `public`) — no auth data leakage
- [x] **PublicShell + PublicModuleOutlet**: bare outlet wrapper, matches pathname via `normalizePath`, resolves component from `componentRegistry`; NO `setActiveModules` call (would destructively overwrite authenticated registry)
- [x] **`/p/*` router group**: outside `AppAccessGuard`, before catch-all, with `PublicShell` layout and `PublicModuleOutlet` as wildcard child
- [x] **`pathUtils.js`** shared utility: `normalizePath` extracted from both `BlueprintCrudScreen` and `PublicModuleOutlet` to eliminate duplication
- [x] Browser QA: `GET /p/test` (no session) → "Vista pública no encontrada" (confirmed via screenshot 2026-05-26)
- [x] Build verified: `pnpm build` + Tauri native bundle — no errors

Verified: 2026-05-26 (commits `c84dabc`–`aba2ad8`; `node --test packages/module-engine/src/__tests__/define-view.test.js` → 16 passing; browser screenshot confirms `/p/test` shows empty state without session; `pnpm build` clean)

## runly.ledger — AI Statement Import (PDF/foto/CSV/XLSX)

Spec: `docs/superpowers/specs/2026-09-19-ledger-ai-statement-import-design.md`
Plan: `docs/superpowers/plans/2026-09-19-ledger-ai-statement-import.md`

- [x] PDF text-extraction worker (`ledger-import-pdf-worker.js`, `pdfjs-dist`, 20-page cap, no text truncation) + embedded-image extraction for scanned pages (no `node-canvas` — pulls raster XObjects via `sharp`)
- [x] Groq text extraction (`extractRowsFromText`) and vision fallback (`extractLedgerStatementPage` in `vision-service.js`), both prompted to use the running balance for deposito/retiro disambiguation and to collapse the same movement when represented twice in one document
- [x] CSV/XLSX support via AI column-mapping (`suggestColumnMapping`) reusing the existing `import-service.js` parser — no separate manual-mapping path added, the existing CSV wizard is untouched
- [x] Intra-file + DB duplicate detection (`ai-import-dedup.js`) — fingerprint keyed on date+amount only (not name/reference text), since the motivating real statement represents the same movement with two different name strings across report formats; flags only, never silently excludes
- [x] HMAC proof token (`ai-import-token.js`, 2h TTL) binding recognized rows to company/actor between recognize and commit
- [x] Idempotent commit (`ai-import-service.js`) via `AuditLog`, filtered by `metadata.key` at the query level (not just fetched-then-compared) so a prior unrelated import batch can't be mistaken for the current one
- [x] Routes `POST /ledger/imports/recognize` and `/commit`, reusing the existing `ledger.import` permission — no new permission, no new Prisma migration
- [x] `AiImportScreen.jsx` (upload → review → confirm) + entry point on `AccountsScreen.jsx`, route registered in `module-screen-resolver.js`/`ModuleOutlet.jsx`
- [x] `PageHeader` (`@runly/ui`) extended with optional `onBack`/`backLabel`/`loading` props (additive, non-breaking) to back this screen's header and `AccountScreen.jsx`/`ImportWizard.jsx`'s existing ones

Not done in this pass: AI-suggested category/type per row (spec allowed it; deferred — rows import with no category, user assigns manually); ledger chat assistant that could invoke this pipeline as a tool (explicit non-goal, fast-follow per spec).

**Post-implementation review found and fixed two ship-blocking issues** before this could be considered done: `commit()` had no write-access check on `accountId` (a viewer-only member of a shared account, or a caller targeting another company's account entirely, could have written transactions — fixed with the same `canWriteAccount` check every other ledger write path uses), and `markDbDuplicates`' fingerprint compared `row.fecha` as-is, but `$queryRaw` returns `@db.Date` columns as JS `Date` objects while extracted rows carry ISO strings — the two never matched, so duplicate detection against existing DB transactions silently never fired. Both fixed and covered by new tests (`node --test` count below includes them).

**Live-API manual verification** (real `GROQ_API_KEY`, real statement text reconstructed from the sample PDF shared in chat — not the full browser upload flow, since that needs interactive auth this session didn't have, but the actual Groq calls the feature depends on): found the deposito/retiro saldo-inference prompt was not reliably followed — the model classified every row as deposito when the account's balance strictly decreases (all real withdrawals). Strengthened the prompt into an explicit saldo-delta calculation with priority over ambiguous column-header text; re-tested live, 13 of 14 previously-misclassified rows corrected (the 1 remaining miss lacked a prior-row saldo to compute from, an artifact of testing a partial excerpt, not a prompt failure). Also confirmed live: the cross-page duplicate movement (same transaction in two report formats) correctly collapses to one row, and account auto-detection matches. Also found via a live `suggestColumnMapping` call that a CSV with no dedicated name/counterparty column (common real export shape) would have the model correctly decline to invent a mapping — but `validateImportRows` requires `nombre`, so every row would be silently rejected; fixed with a deterministic fallback to `concepto`.

Still not run: the full browser upload → review → commit flow against a running dev server (needs interactive auth). The underlying AI calls, dedup, and account-matching that flow depends on are now verified against the live API.

## runly.identity — User Session Info + atlas.admin Retirement

Spec: `docs/superpowers/specs/2026-09-23-identity-user-sessions-design.md`
Plan: `docs/superpowers/plans/2026-09-23-identity-user-sessions.md`

- [x] Forward migration `20260923120000_retire_atlas_admin_role_key`: idempotent merge-or-rename of any persisted `Role.key = 'atlas.admin'` into `runly.admin`, plus `CREATE OR REPLACE FUNCTION public.runly_member_active` dropping the `atlas.admin` branch from the Realtime/RLS admin-bypass check (discovered during implementation — a live DB function embedded in an earlier migration, not caught by the original text-only grep)
- [x] `atlas.admin` literal purged from all live guards: `apps/api/src/lib/tenant-context.js`, `apps/api/src/index.js` (`ADMIN_ROLE_KEYS`, `PROTECTED_IDENTITY_ROLE_KEYS`, `ensureSetupAdminRole`, `syncAdminRolesPermissions`), `files-service.js`, `company-service.js`, `collaboration-invitations-service.js`, `files/workspace.js`, `module-lifecycle-service.js`, `office/access.js`, `chat-moderation-service.js`, and the frontend `UserDetailScreen.jsx` — plus every test/fixture that asserted the literal (`cross-tenant` suite, `tenant-context.test.js`, `mirai-tools.test.js`, `chat-moderation-service.test.js`)
- [x] New permission `identity.users.sessions.read` declared in `identityMap` (manifest + ACL) and `permission-catalog.js`; no navigation change (gates a detail-screen section, not a route)
- [x] `GET /identity/users/:id/session` (new `routes/identity/identity-sessions-routes.js`, mounted via one `app.route()` call rather than adding inline routes to the already-oversized `index.js`): company-scoped lookup, live Supabase Admin API (`auth.admin.getUserById`) call with a 60s in-memory cache, graceful `{ data: null }` degrade when Supabase admin client or the auth user is unavailable
- [x] SDK: `runly.identity.getUserSession(id, token)`
- [x] Frontend: `UserSessionSection.jsx` (new) + `session-info` blueprint section on `identity-user-detail.blueprint.js` + registered in `moduleComponentRegistry.js` — renders nothing on a 403 (permission-gated, backend-authoritative), shows "Información de sesión no disponible." when data is null

Not done in this pass (explicit non-goals, see spec §6): session-by-session IP/device history via `auth.sessions`; a "last login" column on the paginated users list; force-logout/session revocation; wiring the existing unused `audit.read` permission to a viewer.

Verified: 2026-09-23 (`pnpm db:migrate` applied the new migration against the live dev DB with 0 pre-existing `atlas.admin` rows, confirmed no-op-safe; ad-hoc query confirmed `identity.users.sessions.read` seeded+active and 0 `Role` rows with `key = 'atlas.admin'` after `pnpm db:seed`; `node --test` green — `tenant-context.test.js` 15/15, `cross-tenant-security.test.js` 17/17 run live against the dev DB with `RUN_CROSS_TENANT_TESTS=1`, `mirai-tools.test.js` + `chat-moderation-service.test.js` 27/27; `pnpm build` clean (Vite + Tauri native bundle, no errors); `pnpm lint` clean; repo-wide `atlas.admin` grep sweep confirmed the only remaining matches are historical specs/plans, immutable migration files, and two intentional one-time retirement-note comments; manual `curl` confirmed the new route is mounted and returns 401 unauthenticated). Not verified: the rendered UI in an actual browser session (no interactive auth available this session) — `pnpm build` proves the JSX compiles and the component registers, but the live-rendered "Sesión (Supabase)" card layout was not visually confirmed.

Verified: 2026-09-20 (`node --test apps/api/src/routes/ledger/__tests__/*.test.js` → 42 passing; `npx eslint` clean across all touched backend/frontend files; `pnpm build:web` clean, `AiImportScreen` emitted as its own lazy chunk; live `GROQ_API_KEY` manual script runs against real statement text and CSV headers, see above)

## runly.chat — Call spotlight polish, round 2

Spec: `docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md`
Plan: `docs/superpowers/plans/2026-09-23-call-spotlight-polish-round2-plan.md`

- [x] Portrait camera tracks (phone participants) no longer get aggressively cropped in filmstrip/grid/PiP tiles — `ParticipantTile`'s `TrackRenderer` detects decoded video orientation (`videoWidth`/`videoHeight`, `loadedmetadata`/`resize`) and switches `"auto"` fit to `object-contain` for portrait, `object-cover` for landscape; the main spotlight tile (already `fit="contain"`) is unaffected
- [x] Guest chat unified into the real conversation: new `chat_messages.sender_call_guest_id` column (`20260923000000_chat_messages_call_guest_sender`, FK to `call_guest`, additive); `call-messages-service.js`'s `postGuestMessage` rewritten to insert into `chat_messages` (mirrors `call-service.js`'s `postSystemMessage` insert+bump+broadcast pattern) instead of the ephemeral `call_message` table; `call-guest-service.js`'s `getGuestState` reads full conversation history from `chat_messages`; `chat-service.js`'s `listMessages`/`getMessageFull` resolve a call-guest's name via a new `LEFT JOIN call_guest`. `CallChatPanel.jsx` always renders the real `ChatWindow` (the `roomMode="call"`/ephemeral branch, `CallRoomChat.jsx`, `useCallRoomMessages.js`, and the member-only `GET|POST /calls/:callId/messages` routes + SDK methods are removed as dead code); `GuestRoomChat.jsx`/`RoomChatView.jsx`/`mergeRoomMessages` are kept as-is (the guest's own lightweight polling UI, now backed by the real table)
- [x] Screen share and camera are independent spotlight entities: `spotlightStrip` (`calls/lib/callLayout.js`) no longer excludes the screen-sharer from the strip outright — when they're also the automatic spotlight main, their own live camera (if any) gets its own strip tile via a new `hasCamera` flag on `screenShareEntry`. `CallRoomLayout.jsx`/`GuestCallRoom.jsx` were also switched from an inline `.filter()` (duplicated, drifted from the 2026-09-22 spotlight-overhaul design) to actually calling `spotlightStrip`, which had zero non-test callers before this pass
- [x] Active-speaker priority: `ParticipantTile` gets a `speaking` ring prop; a new pure debounced state machine (`advanceSpeakingFocus`/`orderBySpeakingFocus`/`SPEAKING_FOCUS_STABLE_MS` in `callLayout.js`) plus a thin `useSpeakingOrder` hook reorder the `SpotlightLayout` strip to bring the current speaker (from LiveKit's `room.activeSpeakers`, already listened to) to the front after ~1.5s of stability — the classic grid and `DirectFocusLayout` get the ring only, no reordering

Not done in this pass (explicit non-goals, see spec §6): synced/host-controlled spotlight; any change to the LiveKit Egress recording composite (separate spec); guest join-flow changes; a visual "guest" badge on chat messages; a user-facing toggle for the speaking-reorder debounce.

Verified: 2026-09-23 (`pnpm db:migrate` applied `20260923000000_chat_messages_call_guest_sender` cleanly against the live dev DB; `node --test` green — `apps/api/src/routes/calls/__tests__/*.test.js` 112/112, `apps/api/src/routes/chat/__tests__/chat-service.test.js` 85/85, `apps/desktop/src/modules/runly.chat/calls/lib/__tests__/*.test.js` 39/39 (including `mergeRoomMessages`, confirming the kept guest-chat helper still works); `pnpm build` clean (Vite `build:web` + full Tauri native bundle, no errors); `pnpm lint` clean; repo-wide grep confirmed no remaining references to `CallRoomChat`, the old `roomMode` prop, or `postMemberMessage`/`listMessagesGuarded`). Not verified: live browser/device confirmation of the visual behavior (a real portrait phone camera in the filmstrip, the speaking ring/reorder timing feel, a guest message round-tripping through a real call) — no interactive browser session was available this pass; the automated coverage above validates the logic, not the rendered UX.

## runly.chat — Call transcription V1 (faster-whisper, audio mezclado)

Spec: `docs/TRANSCRIPTION_SPEC.md`. Plan: `docs/TRANSCRIPTION_IMPLEMENTATION_PLAN.md`. Estado actual auditado (antes de esta implementación): `docs/TRANSCRIPTION_CURRENT_STATE.md`. Decisiones de producto pendientes/resueltas: `docs/TRANSCRIPTION_OPEN_QUESTIONS.md`.

Etapa 1 (PoC aislada de faster-whisper, `scripts/poc-transcription/`) corrió en tres rondas — máquina de desarrollo (audio sintético y audio real corto) y **el VPS de producción KVM4 real** (ejecutado por el usuario, sin acceso remoto de ningún agente a esa VPS) — ver `scripts/poc-transcription/RESULTS.md` para las cifras completas. Hallazgo real que cambió la recomendación de modelo: `small`/int8 supera a `base` en calidad **y en velocidad** sobre audio real con ruido (en el KVM4: 20.8s vs 35.3s para el mismo clip de 71s), al revés de lo que sugería el audio sintético limpio de la primera ronda. Segundo hallazgo: `WHISPER_CPU_THREADS` debe fijarse explícitamente, no dejarse en autodetección — el número de hilos que faster-whisper autodetecta depende de los núcleos *visibles* del contenedor, no del límite real de `--cpus`/`deploy.resources.limits.cpus`, afectando de forma medible RAM y tiempo entre máquinas con distinto número de núcleos.

Etapa 2 (V1 — transcribe el audio mezclado de una `CallRecording` ya `READY`, sin identificación de hablantes) implementada y verificada de extremo a extremo contra la base de datos de desarrollo real:

- [x] Modelos Prisma `CallTranscript`/`CallTranscriptSegment` + enum `CallTranscriptSourceKind` (migraciones aditivas `20260924000000_add_call_transcript`, `20260924000001_call_transcript_finalized_at` — la segunda existe porque la primera ya estaba aplicada cuando se detectó la necesidad del campo `finalizedAt`; nunca se edita una migración ya aplicada)
- [x] `call-transcript-service.js`: `requestTranscript`/`retryTranscript`/`listTranscripts`/`getTranscript`/`deleteTranscript`/`reconcileReadyTranscripts`/`cleanupExpiredTranscripts`. Acceso más estricto que grabaciones a propósito (spec §5.1): leer una transcripción requiere haberla solicitado o haber sido `CallParticipant` de esa llamada específica — ser miembro *actual* de la conversación no basta, a diferencia de `listRecordings`. `chat.calls.transcript.manage` es un gate de administración separado (borrar cualquiera de una conversación que administras), no una expansión del alcance de lectura — simplificación deliberada de un punto que la propia spec dejó como pendiente de validación de producto, no una ambigüedad resuelta por decisión de negocio
- [x] Retención independiente de la de `CallRecording` (spec §5.7): `expiresAt` se fija cuando el sweep de la API ve la fila `READY`, leyendo un valor configurable de `InstanceConfig` (`transcription.retentionDays`, default provisional 90 días — el valor definitivo sigue pendiente de aprobación, ver Open Questions §6)
- [x] Dos permisos nuevos (`chat.calls.transcript.request`, `chat.calls.transcript.manage`) en `permission-catalog.js` + manifiesto de `runly.chat` — sembrados y confirmados `active: true` en la BD de desarrollo real
- [x] 5 rutas nuevas en `apps/api/src/routes/calls/index.js` + 5 métodos nuevos en `packages/sdk/src/domains/calls.js`
- [x] `apps/transcriber/` (nueva app Python, `main.py`) — contenedor de producción con arrendamiento (`lease_expires_at`, 10 min) + latido (renovación cada 2 min en un hilo separado) + escritura idempotente de segmentos (DELETE+INSERT transaccional) + distinción de errores transitorios (reintenta, vuelve a `PENDING`) vs. definitivos (`FAILED` directo) — diseño completo en spec §5.6
- [x] Rol de PostgreSQL de mínimo privilegio `runly_transcriber` (`prisma/provision-transcriber-role.mjs`, ejecutado dentro del contenedor de la API vía `pnpm db:provision-transcriber-role`, igual que `db:migrate`/`db:seed` — `infra/installer/` no tiene `pg` como dependencia propia, por eso la lógica SQL vive en `prisma/`, no en `infra/installer/lib/`) — acceso de escritura solo a `call_transcript`/`call_transcript_segment`, lectura solo a `call`/`call_participant`/`call_guest`/`call_recording`/`user_profile`
- [x] `docker-compose.yml`: servicios `runly-transcriber-local`/`runly-transcriber-external` (perfiles separados por modo de despliegue, no uno solo — Compose activa un servicio si CUALQUIERA de sus perfiles coincide, no si TODOS), con `deploy.resources.limits` explícitos (primer precedente de este patrón en el compose) y un volumen con nombre (`whisper-model-cache`) para no volver a descargar el modelo en cada actualización. Imagen publicada vía `pnpm docker:release:transcriber` (nuevo target en `build-push.mjs`) — sin `build:` en el compose (el flujo real de instalación descarga una lista curada de archivos, no el monorepo completo)
- [x] `setup-local.mjs`/`setup-external.mjs`: `TRANSCRIPTION_MODE` (`local`/`disabled`, sin un tercer valor `api` reservado-sin-implementar — decisión explícita del usuario de no exponer configuración de algo no implementado), aprovisionamiento del rol al migrar/actualizar, teardown del contenedor al desactivar (el rol de BD no se elimina automáticamente, es una acción deliberada vía `--drop`). `bootstrap-*.sh`/`.ps1` actualizados para descargar `lib/transcriber-db.mjs`
- [x] UI: `RecordingTranscriptAction.jsx` (botón por grabación lista, integrado en `ChatRecordingsGallery.jsx`) + `TranscriptViewerDialog.jsx` (segmentos con marcas de tiempo, reintentar si falló) + `useConversationTranscripts.js`

No hecho en esta etapa, decisión deliberada documentada (no un olvido): **V2 (identificación de hablantes por captura de pista de LiveKit, spec §0.2/Etapa 3)** — requiere validar `startTrackEgress` contra un LiveKit real en vivo, algo que no se pudo hacer sin una llamada real activa; escribir esa lógica sin poder probarla contra LiveKit real se consideró peor que no escribirla. **Actualización 2026-09-24 (mismo día que la función de texto a voz de MirAI, más abajo)**: a petición explícita del usuario, se completó el diseño de datos de V2 por análisis — no por prueba — del contrato ya documentado de `EgressClient.startTrackEgress` (cada llamada es un trabajo de egress independiente con su propio `egressId`/estado, igual que `CallRecording.egressId` para una composición de sala completa). Nuevo modelo `CallTranscriptTrack` (una fila por pista) diseñado en `TRANSCRIPTION_SPEC.md` §3.1 (revisión 3) — **sin migración aplicada, solo documento**, el usuario pidió explícitamente "el documento para que lo revise cuando tenga tiempo", no implementación. Lo que sigue genuinamente bloqueado por una llamada real: calidad/formato del audio por pista, costo real de CPU con N pistas simultáneas, y precisión del alineamiento de marca de tiempo entre pistas — ver el registro de cambios de la revisión 3 para el detalle exacto. **Etapa 5 (integración con MirAI — resumen/tareas/eventos propuestos desde una transcripción)** — sin implementar todavía, pero su diseño se completó el mismo día que el de V2, también a petición explícita del usuario tras probar la función de texto a voz y notar que faltaba ("no veo funciones de IA... para crear reuniones o hacer algún resumen"). `TRANSCRIPTION_SPEC.md` §7 (revisión 4) resuelve las dos preguntas que quedaban abiertas: el borrador de análisis **sí se persiste** (nuevo modelo `CallTranscriptAnalysis`, a diferencia de `runly.ledger` que nunca persiste el suyo — una minuta se reabre días después, un estado de cuenta se decide en el momento) y el mecanismo de prueba firmada de `runly.ledger` (`ai-import-token.js`) **sí vale la pena generalizarlo** (se confirmó, leyendo el código real, que no tiene nada específico de `runly.ledger` — extracción propuesta a `apps/api/src/lib/ai-proof-token.js`, cero cambio de comportamiento). Contrato de API completo en spec §7.3, permiso nuevo `chat.calls.transcript.analyze` en §5.2. Lo único que sigue genuinamente pendiente: el prompt exacto para Groq, que necesita iterarse contra transcripciones reales, no inventarse por escrito — mismo documento, sin código, misma instrucción explícita del usuario que para V2.

Verificado en la base de datos de desarrollo real, no solo con mocks: `pnpm db:migrate` aplicó ambas migraciones limpiamente; los dos permisos nuevos confirmados `active: true` tras `pnpm db:seed`; el rol `runly_transcriber` aprovisionado de verdad (incluyendo el hallazgo y arreglo de que Supabase no otorga `USAGE` sobre el esquema `public` a un rol nuevo por defecto — sin esto, cada tabla fallaba con "relation does not exist" pese a que los `GRANT` eran correctos); una prueba de integración real (creó un `Call`/`CallTranscript` sintéticos, reclamó el trabajo con el rol de mínimo privilegio, transcribió un audio real con faster-whisper, escribió segmentos, confirmó `status=READY`, limpió las fixtures) pasó de extremo a extremo. `node --test` — `apps/api/src/routes/calls/__tests__/call-transcript-service.test.js` 18/18, suite completa de `apps/api` 1640/1643 (2 pre-existentes skipped sin relación, 1 fallo pre-existente sin relación en `storefront-capture-foundation-contract.test.js` sobre navegación de `runly.growth`, confirmado no causado por este cambio vía `git diff` aislado), `infra/installer/__tests__/*` + `infra/installer/lib/*.test.mjs` 58/58, `prisma/__tests__/*` 7/7. `pnpm lint` limpio. `pnpm build` limpio (Vite + bundle nativo Tauri completo). El contenedor `runly-transcriber` se construyó y corrió realmente (local y en el VPS KVM4 para la PoC); la imagen publicada `raulbellosom/runlyerp:transcriber-latest` que el compose referencia todavía no existe en Docker Hub — pendiente de un `pnpm docker:release:transcriber` real antes de que una instalación limpia con `TRANSCRIPTION_MODE=local` pueda descargarla (documentado, no un bug oculto). No verificado: contención de CPU con una llamada/grabación de LiveKit real activa simultáneamente; una reunión de duración típica (10-20 min); QA visual en navegador de los componentes nuevos.

**Nota de seguridad de esta sesión**: durante la depuración de la conexión a la BD, un comando imprimió accidentalmente `DATABASE_URL` (con contraseña) en la salida de una herramienta — flagged de inmediato al usuario en el momento; recomendación pendiente de aplicar: rotar la contraseña del rol `postgres` de la instancia de desarrollo y actualizar `DATABASE_URL`/`DIRECT_URL`.

### Bug real en producción (post-lanzamiento V1): RLS bloqueaba `call_recording` en silencio

`20260919140000_user_resource_isolation` activó RLS en TODAS las tablas de `public` que ya existían en ese momento (incluida `call_recording`, creada antes de esa migración) sin crear ninguna política — a diferencia de `call`/`call_participant`, que sí la tienen. Con RLS activo y cero políticas, Postgres devuelve **0 filas en silencio** a cualquier rol no-superusuario, aunque tenga un `GRANT SELECT` correcto: sin error, sin pista. El worker (`runly_transcriber`) veía 0 filas en `SELECT playlist_object_key FROM call_recording WHERE id = ...` para una grabación real y `READY`, e interpretaba eso como "grabación sin archivo" — mientras una sesión `psql -U postgres` (superusuario, salta RLS) veía la fila perfectamente, lo que inicialmente descartó (incorrectamente) la hipótesis de permisos. `call_transcript`/`call_transcript_segment` nacieron después de esa migración y nunca quedaron con RLS, por eso reclamar/actualizar el trabajo sí funcionaba y solo esta lectura fallaba.

- [x] `prisma/provision-transcriber-role.mjs`: `ensureTranscriberRole` ahora también crea una política `FOR SELECT TO runly_transcriber USING (true)` en cada una de las 5 tablas de lectura (`call`, `call_participant`, `call_guest`, `call_recording`, `user_profile`) — segura porque el acceso real sigue acotado por el `GRANT SELECT`-only ya existente; `dropTranscriberRole` elimina esas políticas antes que el rol (Postgres rechaza `DROP ROLE` mientras una política lo siga referenciando). 7/7 tests (`prisma/__tests__/provision-transcriber-role.test.js`, 2 nuevos). Fix en código, no en migración: el rol se aprovisiona con un script aparte que corre *después* de `db:migrate`, así que una migración que lo referenciara rompería una instalación limpia
- [ ] **Pendiente en el VPS real**: republicar la imagen `api` (`pnpm docker:release:api`) y re-ejecutar `pnpm db:provision-transcriber-role` contra la base de datos ya provisionada — el fix de código no se aplica retroactivamente al rol que ya existe ahí

### Transcripciones: exportar y regenerar (mismo día)

- [x] `TranscriptViewerDialog.jsx`: "Copiar" (texto plano al portapapeles), "Descargar PDF" (PDF de texto real vía `jsPDF`, no una captura rasterizada — a diferencia de `notePageExport.js`, tiene sentido aquí porque el contenido es texto simple con marcas de tiempo, no una nota visual) y "Generar de nuevo" (tras `ConfirmDialog`) — todo en `apps/desktop/src/modules/runly.chat/lib/transcriptExport.js` + el diálogo
- [x] `regenerateTranscript` en `call-transcript-service.js`: reutiliza la MISMA fila (`READY` -> `PENDING`, limpia sus segmentos de una vez) en vez de crear una segunda — el worker Python ya hace DELETE+INSERT idempotente por `transcript_id`, así que no hace falta ningún modelo de versionado nuevo. Nueva ruta `POST /calls/transcripts/:id/regenerate` + método SDK. 21/21 tests en `call-transcript-service.test.js` (3 nuevos)
- [x] `useRetryTranscript`/`useRegenerateTranscript` ahora invalidan también la query individual (`["chat-transcript", id]`), no solo la lista — sin esto, un diálogo abierto seguía mostrando el estado viejo hasta que su propio `staleTime` (15s) expiraba
- No hecho a propósito: exportar a `.docx` — Copiar + PDF cubren la necesidad real; se puede agregar después si hace falta

### Etapa 3 (V2 — identificación de hablantes por captura de pista) — código escrito, 2026-09-25

A petición explícita del usuario ("continuemos con lo de identificar a los participantes"), implementada siguiendo el diseño de datos ya congelado en `TRANSCRIPTION_SPEC.md` §3.1 (revisión 3, completado el 2026-09-24). El bloqueo documentado ahí ("requiere validar `startTrackEgress` contra un LiveKit real en vivo") sigue sin resolverse en esta sesión — no hubo una llamada real disponible para probarlo. Todo lo de abajo está escrito y pasa sus propias pruebas automatizadas; nada de esto reemplaza la validación en vivo que el spec pide antes de considerar V2 listo para producción.

- [x] Modelo Prisma `CallTranscriptTrack` (una fila por `startTrackEgress`/pista) + relaciones en `UserProfile`/`CallGuest`/`CallTranscript` — `npx prisma validate` limpio; migración aditiva `20260925000000_call_transcript_track`
- [x] `call-transcript-service.js`: `requestTrackTranscription` (enumera participantes con micrófono publicado vía `RoomServiceClient.listParticipants`, resuelve cada identidad de LiveKit contra `CallParticipant`/`CallGuest` ANTES de capturar — nunca por voz —, un `startTrackEgress` por hablante atribuible), `stopTrackTranscription`, `reconcileActiveTranscriptTracks` (sondeo cada 30s, mismo patrón sin webhooks que `reconcileActiveRecordings`; promueve la fila `CallTranscript` de `CAPTURING` a `PENDING` solo cuando CADA pista llegó a `READY`/`FAILED`, y a `FAILED` directo si ninguna pista se pudo capturar). `cleanupExpiredTranscripts` extendido para borrar también los objetos de Storage por pista (`recordings/transcripts/...`), a diferencia de V1 que no tenía nada que borrar ahí. `node --test call-transcript-service.test.js`: 29/29 (7 nuevos)
- [x] `getTranscript` ahora incluye `speakerUser`/`speakerGuest` por segmento y aplana el nombre resuelto sobre `segment.speakerLabel` — campo que `TranscriptViewerDialog.jsx`/`transcriptExport.js` ya sabían renderizar desde que se escribió V1, sin cambios en esos dos archivos
- [x] 2 rutas nuevas (`POST /calls/:callId/transcript-tracks/{start,stop}`, reutilizan el permiso `chat.calls.transcript.request` existente — el spec no pide uno nuevo para V2) + 2 métodos SDK + sweep `reconcileActiveTranscriptTracks` cada 30s en `calls/index.js`. Sin tests de ruta HTTP — mismo nivel de cobertura que las rutas V1 (probadas solo a nivel de servicio)
- [x] `prisma/provision-transcriber-role.mjs`: `GRANT SELECT` (no escritura) sobre `call_transcript_track` para `runly_transcriber` — el ciclo de vida de cada pista lo escribe únicamente `call-transcript-service.js` via reconciliación contra LiveKit, nunca el contenedor Python. `node --test provision-transcriber-role.test.js`: 7/7
- [x] `apps/transcriber/main.py`: `download_track_audio` (descarga cada pista `READY`, una pista que falla se omite sin abortar las demás) + `transcribe_tracks` (transcribe cada pista por separado y fusiona por `start_ms` — sin offset de corrección por `joinedAt`, ver limitación abajo) + `write_result` ahora escribe `speaker_user_id`/`speaker_guest_id` por segmento. Solo verificado con `python -m py_compile` (sintaxis) — sin prueba de integración real, mismo nivel de evidencia que el resto de este contenedor fuera de la PoC de la Etapa 1
- [x] UI: botón "Transcribir con identificación de hablantes" (icono `Captions`/`CaptionsOff`) junto al de grabar en `CallRoomLayout.jsx`, gateado por `chat.calls.transcript.request` (o admin) igual que `canRecord`; `useTrackTranscription.js` (sondeo 5s, mismo patrón que `useCallRecording.js`); estado `CAPTURING` explícito en `TranscriptViewerDialog.jsx`; `useConversationTranscripts.js` ahora también sigue sondeando mientras una transcripción está `CAPTURING`, no solo `PENDING`/`PROCESSING`
- [ ] **Genuinamente pendiente, bloquea producción (spec §9 riesgos 1/4)** — nada de esto se pudo probar contra un LiveKit self-hosted real en esta sesión: si `startTrackEgress` se comporta como documenta el SDK en la versión de Egress que usa esta instancia (`v1.9.0`), el costo real de CPU de N pistas simultáneas, si el alineamiento de marca de tiempo entre pistas (sin corrección por `joinedAt`) es lo bastante preciso para no producir un desfase perceptible al fusionar, y que el nombre de un invitado (`CallGuest.displayName`) se vea correctamente de punta a punta. Requiere una llamada real con 2+ participantes.
- [ ] QA visual en navegador del nuevo botón/estados — no se probó en un navegador real durante esta sesión

**Re-verificación 2026-09-25 (sesión posterior, sin cambios de código, solo auditoría)**: se confirmó, contra el estado real del repo y de la base de datos de desarrollo, que nada de lo marcado `[x]` arriba se había quedado a medias entre sesiones:
- `npx prisma migrate status` contra la base de datos de desarrollo real: "Database schema is up to date!" — la migración `20260925000000_call_transcript_track` sí está aplicada (no solo escrita), igual que `20260925010000_call_transcript_analysis_module_proposals`.
- `node --test apps/api/src/routes/calls/__tests__/*.test.js`: 181/181 (todo el paquete de rutas de llamadas, incluyendo transcripción V1/V2 y el análisis con propuestas de módulo) y `node --test prisma/__tests__/provision-transcriber-role.test.js`: 7/7.
- `pnpm exec eslint` sobre los 9 archivos tocados por V2 (servicio, rutas, worker Python excluido por no ser JS, hooks, componentes, SDK, validators): limpio.
- Confirmado de punta a punta en el código (no solo por lectura del plan) que la atribución de hablante llega hasta la UI: `call-transcript-service.js`'s `getTranscript()` aplana `speakerUser.displayName`/`speakerGuest.displayName` sobre `segment.speakerLabel`, y `TranscriptViewerDialog.jsx`'s `SegmentRow` ya renderiza `"{speakerLabel}: {text}"` cuando ese campo viene con valor.
- Los dos ítems sin marcar arriba **siguen siendo el único bloqueo real**: ninguno es alcanzable desde una sesión de código — el contenedor `runly-transcriber` no está cableado al `pnpm dev` local (solo a `infra/installer/docker-compose.yml`), así que validar `startTrackEgress` en vivo requiere una llamada real con 2+ participantes contra una instancia con LiveKit+Egress+el contenedor transcriptor corriendo (local vía Docker o el VPS), una decisión y ejecución que le corresponde al usuario, no a este ciclo de trabajo.

## runly.chat — Análisis de MirAI: propuestas multi-módulo, piloto contactos (2026-09-25)

El usuario probó el análisis de MirAI (Etapa 5) y dio tres piezas de feedback: el modal "no terminaba de convencer" (calidad/diseño/fricción de elegir proyecto-por-tarea, y falta de poder copiar el resumen — arreglado aparte, ver entradas de UI de este mismo día), un bug real (se creaba la tarea pero nunca el evento de la siguiente reunión), y un pedido explícito de generalizar esto a **cualquier módulo de Runly, no solo tareas/eventos, respetando la barrera de empresas**. Spec completo: `docs/superpowers/specs/2026-09-25-transcript-module-proposals-design.md` (aprobado conversacionalmente, luego autorizado explícitamente a implementar de punta a punta en la misma sesión).

- [x] **Bug real corregido**: el prompt a Groq nunca incluía la fecha real de la reunión, así que una fecha relativa mencionada en la llamada ("nos vemos la próxima semana") no tenía ancla para resolverse — y el propio prompt ya instruía "nunca inventes una fecha", así que el modelo correctamente devolvía `proposedEvents` vacío. `analyzeTranscript` ahora incluye `call.startedAt` (fecha real de la llamada) en el prompt. 2 tests nuevos
- [x] **Framework de propuestas por módulo** (`transcript-proposal-registry.js`, nuevo): un módulo participa registrando un descriptor (qué le pide a Groq, cómo detecta si el registro ya existe, cómo lo crea/actualiza) — `call-transcript-analysis-service.js` nunca importa la lógica de un módulo específico, solo el registro genérico. Antes de construir el prompt, resuelve qué módulos con descriptor están **instalados y habilitados para la empresa de esa transcripción concreta** (`RunlyModule` + `CompanyModule`, mismo mecanismo que ya usa el resto de la plataforma) — la barrera de empresas se cierra ahí, no en la UI
- [x] **Modelo de datos**: `CallTranscriptAnalysis.moduleProposals Json?` — un solo bucket genérico indexado por `moduleKey` (`{ "runly.contacts": { proposed: [...], committedIds: [...] } }`), deliberadamente NO una columna tipada por módulo — sumar finanzas o inventario después es 100% código (un descriptor nuevo), cero migraciones de Prisma. Migración aditiva `20260925010000_call_transcript_analysis_module_proposals`, aplicada contra la base de datos de desarrollo real
- [x] **Piloto: `runly.contacts`** (`transcript-proposal-modules/contacts-proposal-module.js`): detecta personas/empresas nuevas mencionadas (nombre + correo/teléfono/empresa si se dijeron); busca coincidencia por nombre exacto entre los contactos ya existentes de esa empresa (`contactsService.picker`) y marca la propuesta como "actualizar" en vez de "crear" cuando hay match — el usuario confirma el tipo de contacto (persona/empresa/cliente/proveedor) antes de aceptar, la IA solo sugiere
- [x] **Permiso de escritura re-verificado dentro del commit, no en la ruta** (`company-scoped-permissions.js`, nuevo — utilidad genérica reutilizable, no específica de contactos): mismo patrón de dos capas que `assertProjectAccess` ya usaba para tareas — `contacts.contacts.create`/`.update` se resuelve contra la membresía/rol real del usuario en `transcript.companyId`, nunca confiando en el companyId del token. Un `matchedContactId` que el cliente devuelva se revalida contra esa misma empresa vía `assertContactOwnership` (ya existente en `contacts-service.js`) — nunca se confía en el ID tal cual
- [x] UI: tarjeta "Contactos propuestos" en `TranscriptAnalysisDialog.jsx` (mismo estilo de tarjeta que tareas/eventos), con casilla de aceptar + selector de tipo por contacto — distinto del patrón de tareas/eventos porque un contacto siempre trae un tipo sugerido, así que el combobox no puede doblar como señal de aceptación. Se suma a "Copiar todo"
- [x] `node --test`: 13 tests nuevos en `contacts-proposal-module.test.js` (disponibilidad por tenancy, normalización, coincidencia por nombre, permiso de escritura, commit crear/actualizar/rechazo cruzado de empresa) + 4 tests nuevos de integración en `call-transcript-analysis-service.test.js`. `pnpm lint` y `pnpm build:web` limpios
- **No verificado en esta sesión** (mismo aviso que el resto de trabajo de IA de esta conversación): calidad real de extracción de un contacto mencionado contra una llamada real — requiere una transcripción real, no se puede simular con confianza desde este entorno
- Finanzas (`runly.ledger`) e inventario, explícitamente diferidos por decisión del usuario (spec, Non-goals) — mismo patrón de descriptor, sin programar todavía

## runly.chat — MirAI "leer en voz alta" (Piper TTS)

Motor validado en `scripts/poc-piper/RESULTS.md` (medido en el mismo KVM4 real que la transcripción: 14x más rápido que tiempo real, <400MB RAM pico, calidad confirmada por el usuario escuchando el `.wav` generado) tras descartar `kokoro-onnx` (`scripts/poc-tts/RESULTS.md`, nunca por debajo de 1.8x tiempo real ni sin límite de CPU).

A diferencia de `runly-transcriber`, este servicio es **sin estado a propósito**: sintetizar ~8s de audio toma ~0.5s de CPU real en el KVM4, así que un ciclo HTTP síncrono (la API llama, `runly-tts` responde con el WAV) es suficiente — el patrón de cola en Postgres con lease/heartbeat que usa el transcriptor existe para un trabajo genuinamente largo (minutos), no para esto. Sin persistencia del audio generado: se regenera en cada clic, a propósito (no hay costo real que cachear).

- [x] `apps/tts/main.py` — servidor HTTP mínimo (stdlib `http.server`, sin framework nuevo) con `GET /health` y `POST /synthesize`; voz (`es_MX-claude-high`, Hugging Face `rhasspy/piper-voices`) horneada en la imagen en build time, no descargada en runtime (a diferencia de `WHISPER_MODEL`, es una única voz fija para V1, sin selector en la UI, así que no hay razón para pagar un volumen compartido)
- [x] `apps/api/src/routes/chat/mirai-tts-service.js` (archivo nuevo, no agregado a `mirai-service.js` que ya está en 1001 líneas — por encima del límite blando de 1000): `synthesize(text)` — 503 si `MIRAI_TTS_URL` no está configurado, 400 si el texto está vacío o excede 2000 caracteres, 502 si `runly-tts` no responde o responde con error
- [x] SDK: `runly.chat.tts.speak(text, token)` — usa `requestBlob` (ya existía en `packages/sdk/src/index.js` para exports de Excel/PDF, nunca antes expuesto al dominio `chat`), no `request`, porque la respuesta es audio, no JSON
- [x] UI: botón 🔊 por burbuja de respuesta en `MirAIPanel.jsx` (el panel lateral "solo tú ves esto") — un único `<audio>` compartido por instancia del hook, así que un segundo clic (misma burbuja o distinta) detiene lo que ya sonaba en vez de solaparlo; se detiene también al cerrar el panel

**Actualización el mismo día, tras probar en el VPS real**: el usuario reportó dos cosas al probar: (1) no encontraba el botón en ningún otro lado — resultó ser alcance esperado (solo el panel lateral) más un ícono que solo aparece al pasar el mouse, ninguna de las dos cosas obvia sin explicarla; (2) pidió explícitamente extenderlo — primero a "cualquier mensaje de cualquier persona", luego, tras una segunda vuelta de retroalimentación, lo acotó de nuevo a **solo mensajes de IA, pero en toda la conversación de chat, no solo el panel lateral**. Cambios de esa vuelta:
- [x] `chat.mirai.use` **ya no** protege `POST /chat/mirai/tts` (era una capacidad que nunca tuvo forma de "permiso de MirAI" — nada en "escuchar un texto que ya puedes ver" necesita ese permiso). Nuevo `GET /chat/tts/status` en el router principal de chat (sin permiso, solo sesión iniciada) reemplaza el campo `tts` que antes vivía en `GET /chat/mirai/status` — ese campo se quitó, quedaba mal ubicado detrás de un permiso que ya no aplica
- [x] Hooks renombrados de `useSpeakMirai`/`useMiraiStatus().tts` (nombres que ya no describían la capacidad real) a `useSpeakText`/`useTtsStatus`, nuevo archivo `hooks/useTextToSpeech.js`
- [x] "Leer en voz alta"/"Detener lectura" agregado a `lib/messageActions.jsx` (fuente única del menú de acciones por mensaje, ya consumida por el menú de escritorio y por `MessageActionSheet.jsx` en móvil/clic derecho) — gateado en `message.sender_type === "assistant"` en `ChatMessageList.jsx` (la misma señal que `ChatMessageBubble.jsx` ya usa para decidir si renderiza `AssistantMarkdown`), nunca en un mensaje humano. Cubre MirAI donde sea que publique — la conversación 1:1 dedicada, una mención `@MirAI` en un canal — sin tocar mensajes de personas. `MirAIPanel.jsx` ya filtraba por `role !== "user"` desde el principio, así que no necesitó ese cambio, solo el renombrado de hooks
- 353/353 tests de `apps/api` (chat), build completo de escritorio (incluido el bundle nativo de Tauri) y `pnpm lint` limpio tras este cambio
- [x] `infra/docker/tts.Dockerfile` (con `PYTHONUNBUFFERED=1` desde el día uno — lección real aprendida con `runly-transcriber` en producción, no repetida aquí) + `tts` agregado a `ALL_IMAGES` en `build-push.mjs` (`pnpm docker:release:tts`)
- [x] `docker-compose.yml`: un único servicio `runly-tts` (perfil `mirai-tts`) — a diferencia del transcriptor, **sin** split `-local`/`-external`: es sin estado, no hay `TRANSCRIBER_DATABASE_URL`-equivalente que difiera entre modos de instalación, así que un solo servicio compartido por ambos scripts de setup es correcto y más simple
- [x] `setup-local.mjs`/`setup-external.mjs`: `MIRAI_TTS_MODE` (`local`/`disabled`, mismo enum de 2 valores que `TRANSCRIPTION_MODE` y por la misma razón — no exponer una opción de proveedor en la nube que no existe todavía), `MIRAI_TTS_URL` derivado automáticamente (`http://runly-tts:8090`, nombre de servicio de Compose, no `container_name` — ese lleva el prefijo configurable `RUNLY_CONTAINER_PREFIX` y no es una forma estable de resolverlo por DNS interno). Sin aprovisionamiento de rol de BD (no aplica, es sin estado). `README.md`/`.env.local.example`/`.env.external.example`/`.env.example` actualizados
- No hecho a propósito: botón de lectura en mensajes humanos — se consideró explícitamente (el usuario lo pidió) y se descartó de nuevo por instrucción explícita del mismo usuario en la vuelta siguiente: es una función de voz de IA, no una herramienta general de accesibilidad de chat
- No hecho a propósito: selector de voz/idioma en la UI — una sola voz fija (`es_MX-claude-high`) para V1, igual que `WHISPER_MODEL` fue un valor fijo razonable antes de exponer configuración
- **Ya publicado y verificado en el VPS real**: `pnpm docker:release:tts` corrido por el usuario, `runly-tts` corriendo sano en producción (logs confirmados: voz cargada, 2 hilos de ONNX Runtime, escuchando en :8090) — a diferencia de `runly-transcriber`, este no se quedó pendiente de un primer release real

## runly.chat — MirAI puede leer transcripciones + renombrar grabaciones (2026-09-24)

El usuario probó el panel de MirAI y preguntó directamente si tenía acceso a la transcripción de una llamada — la respuesta fue no, solo veía el mensaje de sistema "Transcripción lista", nunca el texto real. Esto es distinto de la Etapa 5 (arriba, todavía sin implementar): aquí no se crea nada (ni resumen estructurado, ni tareas/eventos), solo se le da a MirAI una herramienta más de solo lectura, mismo patrón que ya tiene para calendario/tareas/bancos/inventario.

- [x] Dos herramientas nuevas en `mirai-tools.js`: `list_call_transcripts` (lista transcripciones de una conversación, con acceso) y `get_call_transcript` (texto completo con marcas de tiempo, dado un `transcriptId`). Reutilizan `call-transcript-service.js.listTranscripts`/`getTranscript` tal cual — el control de acceso (participó en esa llamada o la solicitó, más estricto que ser miembro de la conversación) es exactamente el mismo que ya protege el REST endpoint, no una copia. Texto capado a 6000 caracteres con `truncated: true` si aplica, para no chocar con el límite genérico de `clampToolResult` (8000 bytes) que si se excede reemplaza TODO el resultado por un aviso genérico
- [x] Disponibles en las tres superficies de MirAI que comparten `TOOL_DEFS`/`buildToolRunners` (chat 1:1 dedicado, panel lateral — donde el usuario probó esto — y ninguna otra) **y** en `CHANNEL_TOOL_DEFS`/`buildChannelToolRunners` (mención `@MirAI` en un canal/grupo) — a diferencia de `get_channel_messages`, que confía implícitamente en la membresía del canal, las dos herramientas de transcripción sí aplican el control de acceso estricto vía `callTranscriptService`, aunque el canal sea público
- [x] Nueva instancia de `createCallTranscriptService({ prisma })` en `apps/api/src/routes/chat/index.js` — deliberadamente separada de la que ya existe en `apps/api/src/routes/calls/index.js` (esa además maneja auditoría/mensajes de sistema en escritura, que MirAI nunca toca)
- [x] Los tres system prompts (chat 1:1, panel, canal) actualizados para mencionar explícitamente cuándo usar estas herramientas — mismo patrón que ya se sigue para las demás
- [x] 18 tests nuevos en `mirai-tools.test.js` (incluye la variante de canal, que resuelve `profileId` distinto — directo de `ctx.actorProfileId`, sin `resolveScopedErpContext`)

También, pedido en el mismo mensaje ("renombrar las grabaciones... para identificarlas más fácilmente"):

- [x] Migración aditiva `20260924000002_call_recording_title` (`call_recording.title`, nullable) — aplicada y verificada contra la base de datos de desarrollo real
- [x] `renameRecording` en `call-recording-service.js` — mismo nivel de acceso que `deleteRecording` (miembro de la conversación, permiso `chat.calls.record` a nivel de ruta); vacío/solo-espacios limpia el título de vuelta a `null`. Ruta nueva `PATCH /calls/recordings/:id` + método SDK + hook `useRenameRecording`. 5 tests nuevos
- [x] UI: edición en línea en `ChatRecordingsGallery.jsx` (lápiz visible al pasar el mouse, Enter guarda/Escape cancela) — cuando hay un título propio, la fecha se conserva en la línea de metadatos en vez de desaparecer. El título elegido también se usa como nombre del archivo en el visor (`AdvancedFileViewer`) y como título de la transcripción/PDF (`RecordingTranscriptAction.jsx`), no solo en la lista

## runly.chat/runly.notes — 3 bugs reportados en producción + formato de mensajes (2026-09-25)

Reportados por el usuario probando la app en `app.runly.mx`, con capturas reales. Solo verificado con `pnpm lint` + `pnpm build:web` (compilación/lint limpios) — ninguno de los tres se probó manualmente en el navegador durante esta sesión, pedido explícito de verificación visual pendiente del usuario.

- [x] **Bug real:** `pdf.worker.min.mjs` fallaba con "Failed to fetch dynamically imported module: https://app.runly.mx/pdf.worker.min.mjs" al subir un plano/PDF al lienzo de notas o al visor de PDF de chat. Causa raíz: `PDFViewer.jsx` y `canvasBaseImage.js` fijaban `pdfjs.GlobalWorkerOptions.workerSrc` a una ruta absoluta de raíz (`/pdf.worker.min.mjs`), pero producción sirve la SPA bajo `/app/` (`VITE_BASE_PATH`, `infra/docker/web.Dockerfile`) — nginx no tiene regla para una ruta de raíz, así que 404. Mismo bug ya diagnosticado y arreglado una vez para los sonidos de llamada (`callSounds.js`); ambos archivos ahora resuelven contra `import.meta.env.BASE_URL`, mismo patrón
- [x] **Bug real:** una imagen enviada en el chat "se desbordaba por completo" del bubble — peor en `MiniChatWindow.jsx` (ventana flotante de 300px). Causa raíz: `ChatMessageBubble.jsx`'s `data-msg-bubble` (el contenedor `flex flex-col` de cada burbuja) es un ítem flex de la fila del mensaje sin `min-w-0` — el mínimo automático de un ítem flex (`min-width: auto`) se calcula a partir del contenido (`ImageGrid`'s caja de imagen única, `width: 240px` fijo) y ese mínimo GANA sobre `max-w-[72%]/65%` cuando entran en conflicto (regla CSS: min-width vence a max-width). Agregado `min-w-0` en ambos wrappers (mensaje propio y recibido) — clase clásica de bug de flexbox, no específico de imágenes (un `FileCard`/`AudioCard` ancho también se beneficia)
- [x] **Feature nueva, a petición explícita del usuario** ("como en WhatsApp, al seleccionar texto en la caja de chat aparece un menú para darle formato; también quiero ver de una vez cómo se vería el markdown, no hasta enviar"): dos piezas, ambas reutilizando infraestructura ya existente, ninguna requirió cambios de backend:
  - Barra de formato flotante-en-flujo (Negrita/Cursiva/Tachado/Monoespaciado) que aparece al seleccionar texto en el composer (solo escritorio — táctil ya tiene el menú nativo del SO, mismo criterio que ya usaban los atajos Ctrl/Cmd+B/I existentes). Llama al mismo `MentionTextarea.wrapSelection()` que ya usaban esos atajos de teclado — no se duplicó la lógica de envolver texto, solo se le agregó un botón. Requirió un `onSelectionChange` nuevo (opcional, aditivo) en `MentionTextarea.jsx` (`packages/ui`) para exponer la selección sin romper sus otros consumidores (`CommentThread.jsx` de proyectos, que deliberadamente NO soporta `*bold*` — el botón nunca se agregó ahí, solo en el composer de chat)
  - Vista previa en vivo bajo el textarea, usando el mismo `renderRichText()` que ya usa `ChatMessageBubble.jsx` — es exactamente el resultado final, no una aproximación. Solo se muestra cuando el texto ya contiene sintaxis de formato real (evita un duplicado ruidoso de texto sin formato)
  - Extraído a `ComposerFormatting.jsx` (mismo patrón que `AttachmentPreviewCard.jsx`/`VoiceRecordingControls.jsx`) para mantener `MessageComposer.jsx` bajo el límite de 1000 líneas del proyecto
