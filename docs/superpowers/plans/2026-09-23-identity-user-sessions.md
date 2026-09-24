# Identity — User Session Info + atlas.admin Retirement — Implementation Plan

Date: 2026-09-23
Spec: docs/superpowers/specs/2026-09-23-identity-user-sessions-design.md
Status: In Progress — all 8 tasks implemented and automated validations passed; manual browser login checks outstanding (see spec §2)

> **For agentic workers:** Declare `Mode: IMPLEMENTATION` before starting. Do not begin coding until the spec is approved and this plan is approved. Use checkbox syntax (`- [ ]`) to track progress. Mark each task completed only after its validation commands pass.

## Goal

Deliver a read-only "Sesión (Supabase)" panel on the identity user detail screen, gated by a new `identity.users.sessions.read` permission, sourced live from Supabase Auth's admin API with a short server-side cache — and, in the same change, fully retire the `atlas.admin` role-key literal from all live code, tests, and the seed, via one defensive forward data migration plus a repo-wide literal purge. Matches spec Goals §5.1–§5.4.

## Architecture summary

Session info is never persisted — `GET /identity/users/:id/session` calls `supabaseAdmin.auth.admin.getUserById(authUserId)` on demand (spec §12), cached 60s per `authUserId` via the existing `cacheGet`/`cacheSet` utility (spec §24.2). The route lives in a new dedicated router file (`routes/identity/identity-sessions-routes.js`) mounted into `index.js` with a single `app.route()` call, rather than adding more inline routes to the already-oversized `apps/api/src/index.js` (6050 lines, a known CLAUDE.md violator) — this plan adds no new inline route bodies to that file, only an import + one mount line + the `ADMIN_ROLE_KEYS`/`PROTECTED_*_ROLE_KEYS` literal edits already required by the atlas.admin cleanup.

The `atlas.admin` retirement is a single idempotent forward migration (merge-or-rename per company scope, spec §11) followed by a synchronized literal purge across ~15 backend files, 1 frontend file, and their tests — done together so no intermediate commit has the DB and code out of sync.

---

## File Structure Map

### Create

- `prisma/migrations/20260923120000_retire_atlas_admin_role_key/migration.sql`
- `apps/api/src/routes/identity/identity-sessions-routes.js`
- `apps/desktop/src/modules/runly.identity/components/UserSessionSection.jsx`

### Modify

- `apps/api/src/lib/tenant-context.js` — `COMPANY_ADMIN_ROLE_KEYS` drops `"atlas.admin"`
- `apps/api/src/index.js` — `ADMIN_ROLE_KEYS` (line 317), `PROTECTED_IDENTITY_ROLE_KEYS` (line 773), and lines 656/686/2690 drop the `"atlas.admin"` literal; add import + mount for the new identity-sessions router
- `apps/api/src/services/files-service.js` (line 229)
- `apps/api/src/services/company-service.js` (`PROTECTED_MEMBER_ROLE_KEYS`, line 18)
- `apps/api/src/services/collaboration-invitations-service.js` (lines 38, 66)
- `apps/api/src/services/files/workspace.js` (lines 266, 345)
- `apps/api/src/services/module-lifecycle-service.js` (line 164)
- `apps/api/src/services/office/access.js` (line 30)
- `apps/api/src/routes/chat/chat-moderation-service.js` (`PROTECTED_IDENTITY_ROLE_KEYS`, line 17)
- `apps/api/src/__tests__/cross-tenant/fixtures.mjs`
- `apps/api/src/__tests__/cross-tenant/cross-tenant-security.test.js`
- `apps/api/src/lib/__tests__/tenant-context.test.js`
- `apps/api/src/routes/chat/__tests__/mirai-tools.test.js`
- `apps/api/src/routes/chat/__tests__/chat-moderation-service.test.js`
- `apps/desktop/src/modules/runly.identity/screens/UserDetailScreen.jsx` (`PROTECTED_ROLE_KEYS`, line 25)
- `docs/07_auth_permissions_strategy.md` (living doc, line 63 mention)
- `prisma/seed.js` (comment at line 15 only — no functional change)
- `apps/api/src/manifests/official/core-modules.js` — add `identity.users.sessions.read` to `identityMap.permissions[]` and `acl.actions`
- `apps/api/src/permission-catalog.js` — add presentation entry for `identity.users.sessions.read`
- `packages/sdk/src/index.js` — add `identity.getUserSession(id, token)`
- `apps/desktop/src/modules/runly.identity/blueprints/identity-user-detail.blueprint.js` — add `session-info` section
- `apps/desktop/src/lib/moduleComponentRegistry.js` — register `runly.identity:UserSessionSection`
- `docs/TASKS.md` — add phase entry

---

## Task 1 — Migration: merge/rename `atlas.admin` → `runly.admin`

**Files:**
- Create: `prisma/migrations/20260923120000_retire_atlas_admin_role_key/migration.sql`

**Changes:**

- [x] Step 1: Write a single SQL script, scoped per `(company_id)` (including `NULL`, the system scope), that:
  1. For every `role` row with `key = 'atlas.admin'`, look up a sibling `role` row in the same `company_id` scope with `key = 'runly.admin'`.
  2. If a sibling exists: `UPDATE membership SET role_id = <runly.admin id> WHERE role_id = <atlas.admin id>`; `INSERT INTO role_permission (...) SELECT ... FROM role_permission WHERE role_id = <atlas.admin id> ON CONFLICT DO NOTHING` targeting the `runly.admin` id; then `DELETE FROM role WHERE id = <atlas.admin id>`.
  3. If no sibling exists: `UPDATE role SET key = 'runly.admin' WHERE id = <atlas.admin id>`.
  4. Implement as a `DO $$ ... $$` PL/pgSQL block looping over `SELECT id, company_id FROM role WHERE key = 'atlas.admin'`, so it is a no-op when zero rows match (this environment's case).
- [x] Step 2: Add a header comment stating this migration is idempotent and safe to run against a database with zero `atlas.admin` rows.
- [x] Step 3: `CREATE OR REPLACE FUNCTION public.runly_member_active(p_company uuid, p_user uuid, p_permission text DEFAULT NULL)` with the same body as defined in `20260919140000_user_resource_isolation/migration.sql`, except the admin-bypass branch drops `'atlas.admin'`, leaving `r.key = 'runly.admin' OR (r.key = 'system.admin' AND r.company_id IS NULL)`. Same signature, so no dependent RLS policy or grant needs to change (spec §23.7, discovered during implementation).

**Validation:**

```bash
pnpm db:migrate
```
Success: migration applies with no errors (expected no-op in this environment, per user confirmation there is no persisted `atlas.admin` data).

---

## Task 2 — Purge `atlas.admin` literal from backend guards + seed comment

**Files:**
- Modify: `apps/api/src/lib/tenant-context.js`
- Modify: `apps/api/src/index.js`
- Modify: `apps/api/src/services/files-service.js`
- Modify: `apps/api/src/services/company-service.js`
- Modify: `apps/api/src/services/collaboration-invitations-service.js`
- Modify: `apps/api/src/services/files/workspace.js`
- Modify: `apps/api/src/services/module-lifecycle-service.js`
- Modify: `apps/api/src/services/office/access.js`
- Modify: `apps/api/src/routes/chat/chat-moderation-service.js`
- Modify: `prisma/seed.js`

**Changes:**

- [x] Step 1: `tenant-context.js` — change `COMPANY_ADMIN_ROLE_KEYS = new Set(["runly.admin", "atlas.admin"])` to `new Set(["runly.admin"])`; update the preceding comment to state the backward-compat case no longer applies (this codebase has no live `atlas.admin` data).
- [x] Step 2: `index.js` — `ADMIN_ROLE_KEYS` (317) → `new Set(["runly.admin", "system.admin"])`; `PROTECTED_IDENTITY_ROLE_KEYS` (773) → drop `"atlas.admin"`; lines 656 and 686 (role-key `in` filters) drop `"atlas.admin"`; line 2690 unaffected (reads `ADMIN_ROLE_KEYS`, already covered by Step 2's constant change).
- [x] Step 3: `files-service.js:229`, `company-service.js:18` (`PROTECTED_MEMBER_ROLE_KEYS`), `collaboration-invitations-service.js:38,66`, `files/workspace.js:266,345`, `module-lifecycle-service.js:164`, `office/access.js:30`, `chat-moderation-service.js:17` (`PROTECTED_IDENTITY_ROLE_KEYS` duplicate) — each drops `"atlas.admin"` from its inline `["runly.admin", "atlas.admin", "system.admin"]` array/Set literal, leaving `["runly.admin", "system.admin"]`.
- [x] Step 4: `prisma/seed.js:15` — update the comment (`// (companyId IS NULL, e.g. atlas.admin/system.admin) ...`) to reference `runly.admin`/`system.admin` only.

**Validation:**

```bash
node --check apps/api/src/lib/tenant-context.js
node --check apps/api/src/index.js
node --test apps/api/src/lib/__tests__/tenant-context.test.js
```
(Full test suite run in Task 8 after fixtures/tests are updated in Task 3 — this task's own files must at least syntax-check and the already-passing tenant-context unit test must still pass once Task 3 updates its literals.)

---

## Task 3 — Purge `atlas.admin` literal from frontend guard + all tests/fixtures

**Files:**
- Modify: `apps/desktop/src/modules/runly.identity/screens/UserDetailScreen.jsx`
- Modify: `apps/api/src/__tests__/cross-tenant/fixtures.mjs`
- Modify: `apps/api/src/__tests__/cross-tenant/cross-tenant-security.test.js`
- Modify: `apps/api/src/lib/__tests__/tenant-context.test.js`
- Modify: `apps/api/src/routes/chat/__tests__/mirai-tools.test.js`
- Modify: `apps/api/src/routes/chat/__tests__/chat-moderation-service.test.js`

**Changes:**

- [x] Step 1: `UserDetailScreen.jsx:25` — `PROTECTED_ROLE_KEYS` drops `"atlas.admin"`; update the comment above it (currently notes it mirrors the API's set) to match the API's new two-key set.
- [x] Step 2: `fixtures.mjs` — the seeded-role lookup (`where: { companyId: null, key: "atlas.admin" }`) and its error message switch to `"runly.admin"`; update the file's header comments describing the fixture's intent accordingly.
- [x] Step 3: `cross-tenant-security.test.js` — the `"User A, a company-scoped atlas.admin ..."` test (line 260) and its `membership?.role?.key` assertion (line 284) switch to `"runly.admin"`; rename the test description to say `runly.admin`.
- [x] Step 4: `tenant-context.test.js` — every `roleKey: "atlas.admin"` membership fixture and the two dedicated assertions (`COMPANY_ADMIN_ROLE_KEYS.has("atlas.admin")` / `SYSTEM_ADMIN_ROLE_KEYS.has("atlas.admin")`, lines 161–163) switch to `"runly.admin"`; the test titled `"atlas.admin is a company-admin key, not a system-admin key"` is renamed to `"runly.admin is a company-admin key, not a system-admin key"`.
- [x] Step 5: `mirai-tools.test.js` (lines 103, 124) and `chat-moderation-service.test.js` (line 216) — membership fixtures switch `roleKey: "atlas.admin"` → `"runly.admin"`.

**Validation:**

```bash
node --test apps/api/src/lib/__tests__/tenant-context.test.js
node --test apps/api/src/__tests__/cross-tenant/
node --test apps/api/src/routes/chat/__tests__/mirai-tools.test.js apps/api/src/routes/chat/__tests__/chat-moderation-service.test.js
```
Success: all listed suites pass with zero references to `"atlas.admin"` remaining in these files.

---

## Task 4 — Update living docs mentioning atlas.admin

**Files:**
- Modify: `docs/07_auth_permissions_strategy.md`

**Changes:**

- [x] Step 1: Line 63 ("Admin bypass only for roles `runly.admin` (or the legacy `atlas.admin`) and `system.admin`.") — update to state the bypass is `runly.admin` and `system.admin` only, with a one-line historical note that `atlas.admin` was retired on 2026-09-23 (reference this spec's path).

**Validation:**

Manual read-through; no command (documentation-only change).

---

## Task 5 — New permission: manifest + permission-catalog presentation

**Files:**
- Modify: `apps/api/src/manifests/official/core-modules.js`
- Modify: `apps/api/src/permission-catalog.js`

**Changes:**

- [x] Step 1: In `identityMap.permissions[]` (core-modules.js), insert `{ key: "identity.users.sessions.read", name: "Read User Session Info" }` immediately after the `identity.users.delete` entry.
- [x] Step 2: In `identityMap.acl.actions`, add `"identity.users.sessions.read": "identity.users.sessions.read"` alongside the other `identity.users.*` entries. Do not add it to `acl.models` (it does not gate a CRUD model).
- [x] Step 3: In `permission-catalog.js`'s `PERMISSION_PRESENTATION` map, insert an entry between `identity.users.delete` (order 50) and `identity.roles.read` (order 60):
  ```
  "identity.users.sessions.read": {
    displayNameEs: "Ver sesión de usuarios",
    descriptionEs: "Permite ver el último inicio de sesión y estado de cuenta de un usuario en Supabase.",
    groupKey: "identity",
    order: 55,
  },
  ```

**Validation:**

```bash
node --check apps/api/src/manifests/official/core-modules.js
node --check apps/api/src/permission-catalog.js
pnpm db:seed
```
Success: seed completes; `identity.users.sessions.read` appears in the `Permission` table (spot-check via `pnpm db:studio` or a one-off `node -e` read, no secrets printed).

---

## Task 6 — Backend: session-info route + service + SDK method

**Files:**
- Create: `apps/api/src/routes/identity/identity-sessions-routes.js`
- Modify: `apps/api/src/index.js` (import + mount only, no inline route body)
- Modify: `packages/sdk/src/index.js`

**Changes:**

- [x] Step 1: `identity-sessions-routes.js` exports `createIdentitySessionsRouter({ prisma, supabaseAdmin, authMiddleware, requirePermission })` (matches the existing `createXxxRouter({ ... })` pattern used by `createFilesRouter`/`createOfficeRouter`), declaring `GET /identity/users/:id/session`:
  - Resolve `:id` to a `UserProfile` scoped to the caller's active company (reuse the same tenant-scoping helper already used by the existing `GET /identity/users/:id` handler in `index.js`) → 404 if not visible.
  - If `supabaseAdmin` is falsy, or `profile.authUserId` is falsy, return `{ data: null }`.
  - Check a 60s in-memory cache (`cacheGet`/`cacheSet`, key `identity:session:${authUserId}`); on miss, call `supabaseAdmin.auth.admin.getUserById(profile.authUserId)`.
  - On Supabase error or no `data.user`, return `{ data: null }` (never propagate as a 4xx/5xx — spec §23.2).
  - On success, map to `{ lastSignInAt: user.last_sign_in_at, createdAt: user.created_at, emailConfirmedAt: user.email_confirmed_at, phoneConfirmedAt: user.phone_confirmed_at, bannedUntil: user.banned_until ?? null, providers: user.app_metadata?.providers ?? (user.app_metadata?.provider ? [user.app_metadata.provider] : []) }`, cache it, return as `{ data: ... }`.
  - Route guarded by `authMiddleware, requirePermission("identity.users.sessions.read")`.
- [x] Step 2: `index.js` — import `createIdentitySessionsRouter` and mount it once (`app.route("/", createIdentitySessionsRouter({ prisma, supabaseAdmin, authMiddleware, requirePermission }))`) near the other `createXxxRouter` mounts (~line 2477 area).
- [x] Step 3: `packages/sdk/src/index.js` — in the `identity` domain block, add:
  ```
  getUserSession: (id, token) =>
    request(`/identity/users/${encodeURIComponent(id)}/session`, {
      headers: withAuthHeaders(token),
    }),
  ```

**Validation:**

```bash
node --check apps/api/src/routes/identity/identity-sessions-routes.js
pnpm build
```
Manual: with a local API running and a valid `$RUNLY_TOKEN` for a `runly.admin` user, `curl -s -H "Authorization: Bearer $RUNLY_TOKEN" http://localhost:4010/identity/users/<id>/session` returns 200 with either real Supabase data or `{ "data": null }` if Supabase env vars are unset locally.

---

## Task 7 — Frontend: session section on the user detail screen

**Files:**
- Create: `apps/desktop/src/modules/runly.identity/components/UserSessionSection.jsx`
- Modify: `apps/desktop/src/modules/runly.identity/blueprints/identity-user-detail.blueprint.js`
- Modify: `apps/desktop/src/lib/moduleComponentRegistry.js`

**Changes:**

- [x] Step 1: `UserSessionSection.jsx` — same `{ data, token }` prop contract as the sibling `UserActivitySection.jsx`; `useQuery` against `runly.identity.getUserSession(data.id, token)`; on a 403/error response render `null` (section disappears, no error toast — spec §8); on success with `data: null`, render the single line "Información de sesión no disponible."; on success with data, render the field list from spec §8 (relative+absolute last sign-in, account created, confirmed badges, providers, ban status), reusing whatever badge/date-formatting primitives the sibling sections already import from `@runly/ui`.
- [x] Step 2: `identity-user-detail.blueprint.js` — add the `session-info` section object exactly as specified in spec §17, placed after the `activity` section in the `sections[]` array.
- [x] Step 3: `moduleComponentRegistry.js` — register `"runly.identity:UserSessionSection"` pointing at the new component, following the exact pattern already used for `"runly.identity:UserActivitySection"`.

**Validation:**

```bash
pnpm build
```
Manual (per CLAUDE.md UI-change policy): `pnpm dev:frontend`, sign in as a `runly.admin` user, open `/app/m/runly.identity/identity/users/:id` for a real user, confirm the "Sesión (Supabase)" card renders (or shows the graceful "no disponible" message); sign in as a user without the new permission, confirm the card is absent.

---

## Task 8 — Full verification sweep + TASKS.md entry

**Files:**
- Modify: `docs/TASKS.md`

**Changes:**

- [x] Step 1: Repo-wide grep for `atlas\.admin`; confirm every remaining match is under `docs/superpowers/specs/`, `docs/superpowers/plans/`, `prisma/migrations/**/migration.sql` (immutable historical/forward migrations, including this feature's own), an already-completed historical entry in `docs/TASKS.md`, or one of the two intentional one-time retirement-note comments in `apps/api/src/lib/tenant-context.js` and `docs/07_auth_permissions_strategy.md` (spec §6.6, §25.7) — anything else (a live `.js`/`.jsx` comparison, a live test, or any other doc) is a missed literal and must be fixed before proceeding.
- [x] Step 2: Add a `docs/TASKS.md` phase entry for this feature, left unchecked until the commands below are actually run and their output recorded per this project's `Verified: YYYY-MM-DD (...)` convention.

**Validation:**

```bash
pnpm build
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm lint
node --test apps/api/src/lib/__tests__/tenant-context.test.js
node --test apps/api/src/__tests__/cross-tenant/
node --test apps/api/src/routes/chat/__tests__/mirai-tools.test.js apps/api/src/routes/chat/__tests__/chat-moderation-service.test.js
```

---

## Rollback Notes

- If aborted before Task 6: revert Tasks 1–5's file changes; the migration (Task 1) is expected to be a no-op in this environment, so reverting it is safe (no data was actually changed to undo).
- If aborted after Task 6: the new endpoint/permission/SDK method are additive and inert if unmounted — reverting Task 6's files is enough; no migration cleanup needed (Task 6 introduces no schema/data changes).
- If the atlas.admin migration (Task 1) is later found to have merged a company's roles incorrectly in some other environment: write a new forward migration to correct the data — never hand-edit the applied migration file (project rule).

---

## Verification Gate

Before marking any phase task complete in `docs/TASKS.md`:

- [x] All task validation commands have been run.
- [x] All commands exited without errors.
- [x] Verification checklist at `docs/superpowers/templates/verification-checklist-template.md` has been filled in.
- [x] `docs/TASKS.md` updated with `Verified: YYYY-MM-DD (commands executed)`.
