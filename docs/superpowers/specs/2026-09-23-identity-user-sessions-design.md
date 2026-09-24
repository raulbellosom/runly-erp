# Identity — User Session Info + atlas.admin Retirement

Date: 2026-09-23
Status: In Progress
Author: Claude (agent session)
Spec file: docs/superpowers/specs/2026-09-23-identity-user-sessions-design.md
Plan file: docs/superpowers/plans/2026-09-23-identity-user-sessions.md (created after spec approval)

---

## 1. Feature title

Identity — User Session Info (last connection) for sysadmins, and full retirement of the `atlas.admin` role key.

## 2. Status

In Progress — implementation complete and automated verification passed (migration, purge sweep, `node --test`, `pnpm build`, `pnpm lint`); the two interactive-login manual checks in §26 (authenticated `runly.admin` view, authenticated non-admin 403) were not run in this session (no interactive Supabase credentials available) and remain outstanding for a human to confirm in a browser before this is marked Complete.

## 3. Context

`runly.identity` already exposes `/identity/users` and `/identity/roles` for user and RBAC administration, but the user detail screen has no visibility into Supabase Auth session state (last sign-in, confirmation status, ban status). A sysadmin currently has no way to answer "when did this user last connect?" or "is this account actually confirmed/banned in Supabase?" without going into Supabase Studio directly — which is an admin-only, out-of-product surface this ERP is meant to replace.

Separately, the codebase still carries `"atlas.admin"` as a live role-key literal in ~15 source/test files, kept only for backward compatibility with installs seeded before the "Runly" rebrand (`apps/api/src/lib/tenant-context.js:12-14`, `docs/superpowers/specs/2026-09-13-runly-catalog-default-design.md`). Fresh installs have seeded `runly.admin` since that spec shipped, and this project's current environment has no persisted `atlas.admin` data to protect. The user has decided the legacy key should no longer exist anywhere in the codebase.

## 4. Problem

1. Sysadmins cannot see a user's last Supabase connection or auth account status from within the ERP; the only source of truth (Supabase Auth) is not surfaced anywhere in `runly.identity`, and there is no permission scoped to that information.
2. `"atlas.admin"` remains a live, checked role-key literal across admin-bypass guards, tests, and the seed, even though it is no longer seeded and is only kept for a backward-compatibility case that does not apply to this environment. This is dead compatibility code masquerading as an active security boundary.

## 5. Goals

1. A user holding the new permission `identity.users.sessions.read` (granted by default to `runly.admin`/`system.admin` via the existing admin-bypass, and independently assignable to any custom role) can open a user's detail screen in `/identity/users/:id` and see: last Supabase sign-in timestamp, Supabase account creation timestamp, email confirmation timestamp, phone confirmation timestamp, ban status, and auth provider(s) — sourced live from Supabase Auth, not duplicated into Postgres.
2. The new permission is declared, seeded, and manageable through the existing Roles/Permissions screens exactly like every other `identity.*` permission — no special-casing.
3. `Role.key = 'atlas.admin'` no longer exists anywhere after this feature ships: a forward migration renames/merges any persisted row into `runly.admin`, `prisma/seed.js` never re-creates it, and every guard/test/fixture literal referencing `"atlas.admin"` is removed in favor of `"runly.admin"` / `"system.admin"`.
4. `pnpm db:seed` run against a fresh database never produces a `Role` row with `key = 'atlas.admin'`.

## 6. Non-goals

1. Real-time "who is online right now" presence — out of scope, would need a different mechanism (e.g. the existing chat presence system).
2. Session-by-session login history with IP address and user agent — self-hosted Supabase exposes this in the internal `auth.sessions` table, but coupling this feature to that internal (non-versioned-API) schema is deferred; see Future enhancements (§28.1).
3. A "last login" column on the paginated `/identity/users` list screen — would require one Supabase Admin API call per row per page load; deferred, see §28.2.
4. Force-logout / session revocation UI.
5. Building a viewer for the existing, already-seeded-but-unused `audit.read` permission (declared on `runly.core`, no route or screen consumes it today). Unrelated to this feature.
6. Rewriting `atlas.admin` mentions inside historical spec/plan files under `docs/superpowers/specs/**` and `docs/superpowers/plans/**` — those are frozen decision records per this project's own maintenance rules (§9) and are left as-is. Only active source code, tests, seed data, and the one living reference in `docs/07_auth_permissions_strategy.md` are updated.
7. Migrating or auditing any external/production Supabase project beyond this repository's own dev database — confirmed out of scope: this environment has no persisted `atlas.admin` data (per user confirmation during spec discovery).

## 7. User stories

- As a sysadmin (`runly.admin`/`system.admin`), quiero ver la última conexión de un usuario en su ficha de Identidad, para auditar actividad de cuentas sin salir del ERP.
- As a sysadmin, quiero saber si el correo o teléfono de un usuario están confirmados, o si la cuenta está baneada en Supabase, para diagnosticar problemas de acceso reportados por el usuario.
- As an instance owner, quiero poder crear un rol personalizado que solo pueda ver información de sesión de usuarios, sin otorgarle el resto de privilegios de administración de identidad.
- As a platform maintainer, quiero que `atlas.admin` deje de existir como clave de rol viva en el código, para cerrar la migración de marca a Runly sin dejar comparaciones de string olvidadas que sean un riesgo de seguridad silencioso.

## 8. UX requirements

- New read-only section "Sesión (Supabase)" added to the existing blueprint-driven `RunlyDetail` on `UserDetailScreen.jsx`, as a `type: "component"` section (same pattern as the existing "Actividad" section), column `aside`, icon `LogIn` (or similar from lucide-react), placed directly below the existing "Actividad" section.
- Fields shown (Spanish labels), each backed by the API response in §12:
  - "Último inicio de sesión" (`lastSignInAt`, relative + absolute date, e.g. "hace 3 días — 2026-09-20 14:32")
  - "Cuenta creada en Supabase" (`createdAt`, date)
  - "Correo confirmado" (`emailConfirmedAt` → badge "Confirmado"/"Sin confirmar")
  - "Teléfono confirmado" (`phoneConfirmedAt` → badge "Confirmado"/"Sin confirmar")
  - "Proveedor de acceso" (`providers`, comma-joined, e.g. "email, google")
  - "Estado de la cuenta" (`bannedUntil` → badge "Activa" / "Suspendida hasta <fecha>")
- Loading state: skeleton/spinner consistent with the existing `ActivityTimeline` loading pattern used in the sibling "Actividad" section.
- Empty/unavailable state: if the API returns `{ data: null }` (Supabase admin client not configured, or no matching Supabase Auth user), render a single line: "Información de sesión no disponible." — never an error toast, this is an expected degrade path.
- Permission gating: if the caller lacks `identity.users.sessions.read` (and is not an admin-bypass role), the section does not render at all — the component treats a 403 from the endpoint the same as "no data" (renders nothing, no error). This mirrors the backend being the authoritative gate; the frontend does not need a separate `hasPermission` prop plumbed in, since a 403 response is itself sufient signal.

## 9. Routes/screens

No new frontend route. Existing route below gets a new section; no other screens change.

| Route | Screen | Module | Description |
|---|---|---|---|
| /app/m/runly.identity/identity/users/:id | UserDetailScreen | runly.identity | Adds a "Sesión (Supabase)" read-only section |

## 10. Data model

### New models

None.

### Modified models

None (schema-level). Data-only change: existing `Role` rows where `key = 'atlas.admin'` are renamed to `key = 'runly.admin'` (merging into an existing `runly.admin` row in the same `companyId` scope when one already exists, to respect the `@@unique([companyId, key])` constraint on `Role`). See §11.

Session info itself (last sign-in, confirmation timestamps, ban status, providers) is never persisted in Postgres — it is fetched live from Supabase Auth on each detail-screen view, with a short in-memory cache (see §24.2). This avoids staleness and avoids a new table entirely.

## 11. Prisma impact

New models: none
Modified models: none (no `schema.prisma` changes — this is a data migration, not a schema migration)
New migration required: Yes — one forward, data-only migration
Migration safety notes:
- Pure `UPDATE`/merge logic against `role`, `membership`, and `role_permission` tables; no column, type, or constraint changes.
- Must handle three cases per company scope (including the global/system scope where `company_id IS NULL`):
  1. Only `atlas.admin` exists → rename `key` to `runly.admin` in place.
  2. Both `atlas.admin` and `runly.admin` exist → reassign every `membership.role_id` pointing at the `atlas.admin` row to the `runly.admin` row's id, reassign/ignore duplicate `role_permission` rows (skip on conflict), then delete the now-orphaned `atlas.admin` role row.
  3. Neither exists → no-op.
- Idempotent: safe to reason about even if run against a database that already has no `atlas.admin` rows (this environment's case, per user confirmation) — the migration becomes a no-op `UPDATE ... WHERE key = 'atlas.admin'` touching zero rows.
- This is a genuinely new forward migration; no existing applied migration is edited, per project rules.

## 12. API contract

### GET /identity/users/:id/session

Auth: required
Permission: `identity.users.sessions.read`
Response (success, Supabase record found):
```
{ "data": {
  "lastSignInAt": "2026-09-20T14:32:00.000Z" | null,
  "createdAt": "2025-01-10T09:00:00.000Z" | null,
  "emailConfirmedAt": "2025-01-10T09:05:00.000Z" | null,
  "phoneConfirmedAt": null,
  "bannedUntil": null,
  "providers": ["email"]
} }
```
Response (Supabase admin client not configured, or no matching Supabase Auth user for this profile's `authUserId`):
```
{ "data": null }
```
(HTTP 200 in both cases — this is a graceful-degradation path, not an error.)

Errors:
- 401 — not authenticated (standard `authMiddleware` behavior)
- 403 — authenticated but missing `identity.users.sessions.read` and not an admin-bypass role
- 404 — `:id` does not resolve to a `UserProfile` within the caller's active company scope (mirrors the existing `GET /identity/users/:id` scoping behavior — no existence leak across tenants)

## 13. SDK contract

Domain: `identity` (packages/sdk/src/index.js, existing `identity` block)

- `getUserSession(id, token)` — `GET /identity/users/:id/session`, returns `{ data: SessionInfo | null }`

## 14. Validator contract

N/A — read-only endpoint, no request body. The `:id` path param reuses the same UUID identity-user lookup already used by `GET /identity/users/:id`; no new Zod schema required.

## 15. Module manifest impact

Manifest: `runly.identity` (`apps/api/src/manifests/official/core-modules.js`, `identityMap`)

- Dependencies: unchanged (`[{ key: "runly.core" }]`)
- Permissions array: add `{ key: "identity.users.sessions.read", name: "Read User Session Info" }`
- ACL actions map: add `"identity.users.sessions.read": "identity.users.sessions.read"`
- ACL models map: unchanged — this permission does not gate a CRUD model, so it is not added to `acl.models`
- Navigation: unchanged — no new nav item; this permission gates a section within the existing Users detail screen

## 16. Navigation impact

N/A — no new navigation item. The permission gates a UI section, not a route.

## 17. Blueprint impact

Modify `apps/desktop/src/modules/runly.identity/blueprints/identity-user-detail.blueprint.js` (`IDENTITY_USER_DETAIL`, kind `DETAIL`): add one new `sections[]` entry —

```
{
  id: "session-info",
  type: "component",
  label: "Sesión (Supabase)",
  icon: "LogIn",
  column: "aside",
  component: "runly.identity:UserSessionSection",
}
```

registered in `apps/desktop/src/lib/moduleComponentRegistry.js` alongside the existing `UserActivitySection`/`MembershipsSection`/`PermissionGrantsSection` entries, backed by a new `apps/desktop/src/modules/runly.identity/components/UserSessionSection.jsx` (same `{ data, token }` prop contract as the sibling `UserActivitySection.jsx`).

## 18. RBAC/permissions

| Permission key | Guards endpoint(s) | Gates navigation |
|---|---|---|
| identity.users.sessions.read | GET /identity/users/:id/session | No (gates a detail-screen section, not a nav item) |

`runly.admin` and `system.admin` receive this automatically via the existing `ADMIN_ROLE_KEYS` bypass (`apps/api/src/index.js:317`, `isSystemAdmin` gets every permission key) — no seed change needed for those two roles beyond the permission existing in the catalog. Any other role must be granted `identity.users.sessions.read` explicitly through the existing Roles/Permissions screen, same as every other `identity.*` permission.

## 19. Multi-company behavior

Supabase Auth session data (`last_sign_in_at`, confirmation timestamps, ban status, providers) is a property of the Supabase Auth user (`authUserId`), not company-scoped by itself. The endpoint still enforces the caller's company scope by first resolving `:id` through the same tenant-scoped `UserProfile` lookup used by `GET /identity/users/:id` (404 if the profile is not visible in the caller's active company) — this prevents a caller from enumerating another tenant's users' session info via a guessed `UserProfile` id, even though the underlying Supabase data itself has no company boundary.

## 20. Files/storage impact

N/A

## 21. Export/import requirements

N/A

## 22. Audit log requirements

N/A. This is a read-only view; the existing `AuditLog` convention in this codebase only records mutating actions (create/update/delete), never reads. The `atlas.admin` migration is a one-time forward data migration, not a runtime user action, and is not audit-logged (consistent with how other historical migrations in `prisma/migrations/` are not audit-logged).

## 23. Edge cases

1. Supabase admin client unavailable (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` not configured in this environment) → endpoint returns `{ data: null }`, UI shows "Información de sesión no disponible."
2. `UserProfile.authUserId` does not resolve to any Supabase Auth user (orphaned/legacy profile) → Supabase Admin API 404s internally → endpoint still returns `{ data: null }` with HTTP 200, never a 500.
3. Caller requests session info for a `UserProfile` outside their active company scope → 404 (matches existing `/identity/users/:id` behavior, no existence leak).
4. A company has both an `atlas.admin` and a `runly.admin` `Role` row (possible if the 2026-09-13 catalog-rename spec created a fresh `runly.admin` row alongside a still-persisted `atlas.admin` row in the same company) → migration must merge, not blind-rename, to avoid violating `@@unique([companyId, key])` (see §11).
5. A company has only `atlas.admin` (no `runly.admin` row yet) → straightforward in-place rename.
6. `RolePermission` rows attached to the old `atlas.admin` row must carry over to the surviving `runly.admin` row where not already present, so no permission regresses for any user who only had `atlas.admin`.
7. The Postgres function `public.runly_member_active(p_company, p_user, p_permission)` — created by the already-applied migration `20260919140000_user_resource_isolation` and used by Realtime RLS policies — hardcodes `r.key IN ('runly.admin', 'atlas.admin')` in its admin-bypass branch. This is live, queried SQL, not just historical migration commentary, so it is in scope: a new forward migration replaces it via `CREATE OR REPLACE FUNCTION` (same signature, so no dependent policy needs to change) dropping the `atlas.admin` branch. Discovered during implementation; not caught by the original text-only grep sweep because it is embedded inside a migration file's SQL body rather than a `.js` literal.
8. Tests/fixtures currently asserting `role.key === "atlas.admin"` (e.g. `apps/api/src/__tests__/cross-tenant/fixtures.mjs`, `apps/api/src/lib/__tests__/tenant-context.test.js`, `apps/api/src/routes/chat/__tests__/mirai-tools.test.js`, `apps/api/src/routes/chat/__tests__/chat-moderation-service.test.js`) must be updated to `"runly.admin"` in the same change, or they fail after the literal is removed from `COMPANY_ADMIN_ROLE_KEYS`/`ADMIN_ROLE_KEYS`/`PROTECTED_IDENTITY_ROLE_KEYS`/`PROTECTED_ROLE_KEYS`/`PROTECTED_MEMBER_ROLE_KEYS`.
8. Rapid repeated opens of the same user's detail screen (e.g. pagination back-and-forth in a modal) should not re-hit the Supabase Admin API on every render — mitigated by the short server-side cache (§24.2).

## 24. Risks

1. Risk: the data migration could collide with an existing `runly.admin` row per company scope, violating `Role`'s `@@unique([companyId, key])`. Mitigation: migration explicitly checks for an existing target row and merges (§11) instead of blind-renaming; written to be idempotent and safe to reason about even with zero matching rows (this environment's actual case).
2. Risk: calling Supabase Admin API (`auth.admin.getUserById`) on every detail-screen view adds external HTTP latency and Supabase API load. Mitigation: scope this feature to the single-user detail endpoint only (not the paginated list, see §6.3), and add a short in-memory cache (60s TTL) keyed by `authUserId`, reusing the existing `cacheGet`/`cacheSet` utility already used by `authMiddleware`.
3. Risk: `SUPABASE_SERVICE_ROLE_KEY` grants broad admin privileges; a poorly scoped integration could leak more than intended. Mitigation: reuse the existing `createSupabaseAdminClient` factory unchanged (already used for `auth.getUser` in `authMiddleware`), call only `auth.admin.getUserById` (never `listUsers`, which would enumerate the whole instance), and gate the endpoint behind the new granular permission plus the existing company-scoped `UserProfile` lookup.
4. Risk: `docs/superpowers/specs/2026-09-13-runly-catalog-default-design.md` explicitly documented keeping `atlas.admin` for backward compatibility, and this spec reverses that guidance. Mitigation: that guidance was written for installs that might have persisted `atlas.admin` data; this environment has none (confirmed with the user during discovery), so the stated risk in that spec (silent admin-privilege loss) does not apply here. That spec is left as a historical record (§6.6), not edited or marked superseded, since its subject (the catalog rename) is unrelated to session info and it remains an accurate record of the decision made at the time.
5. Risk: forgetting one of the ~15 files carrying the `"atlas.admin"` literal leaves a dead-but-misleading compatibility branch. Mitigation: the implementation plan's verification step includes an exhaustive grep sweep confirming zero remaining matches outside the excluded historical-docs paths (§26).

## 25. Acceptance criteria

1. Given a user with `identity.users.sessions.read` (or an admin-bypass role), when they open a user's detail screen at `/identity/users/:id`, then a "Sesión (Supabase)" section renders showing last sign-in, account creation, confirmation status, provider(s), and ban status sourced live from Supabase.
2. Given a user without `identity.users.sessions.read` and without an admin-bypass role, when they open the same screen, then the session section does not render, and a direct call to `GET /identity/users/:id/session` returns 403.
3. Given the Supabase admin client is not configured in the current environment, when `GET /identity/users/:id/session` is called by an authorized caller, then it returns HTTP 200 with `{ data: null }`, not a 500.
4. Given a fresh `pnpm db:seed`, when seeding completes, then no `Role` row anywhere in the database has `key = 'atlas.admin'`.
5. Given the migration runs against a dev database containing both an `atlas.admin` and a `runly.admin` role in the same company, when the migration completes, then every membership that pointed to `atlas.admin` now points to `runly.admin`, and only one role row remains for that company.
6. Given `node --test` is run across `apps/api/src` after this change, then no test asserts against or fixtures the literal `"atlas.admin"`, and all suites pass.
7. Given a repo-wide grep for `atlas.admin` after this change, then the only remaining matches are inside `docs/superpowers/specs/**`, `docs/superpowers/plans/**`, `docs/TASKS.md`'s already-completed historical entries (frozen records, §6.6), `prisma/migrations/**/migration.sql` (both already-applied, immutable migrations and this feature's own new migration, which must literally name `'atlas.admin'` as the value it migrates away from — migrations are an append-only historical log, never edited or excluded from that log), and exactly two one-time explanatory comments (`apps/api/src/lib/tenant-context.js`, `docs/07_auth_permissions_strategy.md`) that document the retirement itself — no other `.js`/`.jsx` file or live test may reference the literal.

## 26. Verification plan

- `pnpm build` — no build errors
- `pnpm db:generate` — Prisma client regenerates cleanly
- `pnpm db:migrate` — migration applies without errors against the dev database
- `pnpm db:seed` — completes; a follow-up query/manual check confirms no `Role.key = 'atlas.admin'` row exists
- `node --test apps/api/src/lib/__tests__/tenant-context.test.js`
- `node --test apps/api/src/__tests__/cross-tenant/`
- `node --test apps/api/src/routes/chat/__tests__/mirai-tools.test.js apps/api/src/routes/chat/__tests__/chat-moderation-service.test.js`
- `pnpm lint`
- Grep sweep: `atlas\.admin` repo-wide, confirm remaining matches are only under `docs/superpowers/specs/`, `docs/superpowers/plans/`, and `docs/TASKS.md` historical entries.
- Manual: authenticate as `runly.admin`, open a user detail screen, confirm the "Sesión (Supabase)" section renders with data (or the graceful "no disponible" message if `GROQ`/Supabase admin env vars aren't set locally).
- Manual: authenticate as a non-admin user without the new permission, confirm the section does not render, and confirm a direct `curl` to the endpoint (with `$RUNLY_TOKEN`, never a literal token) returns 403.

## 27. Rollback plan

Session-info feature: fully additive (new permission, new endpoint, new SDK method, new blueprint section, new component) — rollback is a plain revert of those files; no destructive step. If only mitigation is needed without a code revert, removing `identity.users.sessions.read` from any non-bypass role via the existing Roles UI immediately hides the feature for that role.

`atlas.admin` migration: forward-only per project rules — the applied migration is never hand-edited. If a critical issue is found after merge (e.g. a company's memberships were merged incorrectly), a new forward migration is written to correct the data; the git history of the original migration is not altered.

## 28. Future enhancements

1. Full session-by-session login history (timestamp, IP address, user agent) sourced from self-hosted Supabase's internal `auth.sessions` table via raw SQL, once the DB role behind `DATABASE_URL`/`DIRECT_URL` is confirmed to have `SELECT` privilege on the `auth` schema and the target GoTrue version's `auth.sessions` columns are confirmed stable for this instance.
2. A "last login" column on the paginated `/identity/users` list screen, with a batching/short-TTL-caching strategy that avoids one Supabase Admin API call per row per page load.
3. Force-logout / session revocation action for sysadmins, once Supabase Auth admin session-revocation is wired in.
4. A cross-module audit-log viewer screen consuming the existing, currently-unused `audit.read` permission on `runly.core`.
5. A Supabase Auth Hook (webhook) recording precise, discrete login events server-side, replacing the `last_sign_in_at` snapshot approach with true event history without depending on the internal `auth.sessions` table shape.
