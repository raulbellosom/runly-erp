# Miembros de empresa (Company Members)

Date: 2026-09-20
Status: In Progress
Author: Claude Sonnet 5 (agent)
Spec file: docs/superpowers/specs/2026-09-20-company-members-design.md
Plan file: docs/superpowers/plans/2026-09-20-company-members.md (created after spec approval)

---

## 1. Feature title

Miembros de empresa — a lightweight membership management screen inside `runly.company`.

## 2. Status

In Progress — code written and unit-tested locally (lint + `node --test` pass); pending `pnpm db:seed` against the real Supabase instance and manual browser verification (see Section 26), which weren't run against the shared dev DB as part of this pass.

## 3. Context

`runly.company` today has three screens (Perfil, Direccion, Marca visual) covering the company's own record, but nothing shows who belongs to that company. That capability exists only from the opposite direction: `runly.identity`'s per-user detail screen (`UserDetailScreen.jsx` + `MembershipsSection.jsx`) lets an admin pick companies for one user at a time, and `runly.identity`'s "Usuarios" list (`UsersScreen.jsx`) is a full account-management CRUD table (create/edit/delete real user accounts), already implicitly scoped to the active company via `GET /identity/users`'s `companyId: tenant.companyId` filter, but gated by the broad `identity.users.*` permissions meant for full account administration.

An admin who only needs to answer "who is on my team, and can I add/remove someone" today has to either get `identity.users.*` (account-management-grade access) or go find each user individually from the Identity module.

## 4. Problem

There is no company-centric view of company membership, and no permission narrow enough to let someone manage who belongs to their company without also granting them the ability to create, edit, or delete arbitrary user accounts across the instance.

## 5. Goals

1. From a screen inside `runly.company`, a user with the right permission can see the list of members of the active company (name, avatar, role, enabled state).
2. A user with the manage permission can add an existing user (found via instance-wide search) to the active company, assigning a role in the same step.
3. A user with the manage permission can change a member's role or disable (remove) their membership.
4. Permission checks are scoped narrowly to company membership management, independent of `identity.users.*` (full account CRUD).
5. The screen offers a way to reach the existing full Identity "Usuarios" screen for advanced account management, for users who also have that permission.

## 6. Non-goals

1. Creating brand-new user accounts (invite-by-email-that-doesn't-exist-yet, account provisioning) — out of scope; that remains `identity.users.create`'s job.
2. Editing a user's own profile fields (name, email, avatar) from this screen — remains Identity's job.
3. Managing roles themselves (creating/editing Role records) — remains `identity.roles.*`'s job; this feature only assigns existing roles.
4. Bulk import/export of members.
5. Replacing or modifying `runly.identity`'s existing `UsersScreen.jsx` / `MembershipsSection.jsx` — this feature is additive.

## 7. User stories

- As a company admin without instance-wide user-management rights, I want to see who belongs to my company so that I know who has access.
- As a company admin with membership-manage rights, I want to add an existing platform user to my company and assign them a role in one step, so that they get access without a separate round trip through Identity.
- As a company admin with membership-manage rights, I want to disable a member's access when they leave, so that they lose access to my company without deleting their user account.
- As a company admin with membership-manage rights, I want to change a member's role, so that their permissions stay current as their responsibilities change.
- As a user with only `company.members.read`, I want the add/remove/role controls hidden (not just disabled), so the screen stays uncluttered when I can't act on it.

## 8. UX requirements

- New screen "Miembros" added to `runly.company`'s navigation, positioned after "Marca visual", same `PageHeader` + `Card` pattern as `CompanyProfile.jsx`/`CompanyAddress.jsx`.
- Member list: one row per membership — avatar (`CompanyLogo`-style fallback to initials), display name, email (secondary text), `SelectField` for role (only rendered interactive if `canManage`, otherwise plain text), `SwitchField` for enabled (only if `canManage`). Mirrors `MembershipsSection.jsx`'s row layout.
- Empty state (`EmptyState`, icon `Users`) when the company has zero enabled members (should not normally happen since the viewer is themself a member, but the list also includes disabled ones — keep the empty state for the zero-membership edge case).
- "Agregar miembro" button (`Button`, only rendered if `canManage`) opens a `Dialog` with:
  - `ComboboxField` searching `/company/members/candidates?q=` (debounced ~300ms, minimum 2 characters before firing), showing name + email per option.
  - `SelectField` for role, populated from `/company/members/roles`, defaulting to "Sin rol" like `MembershipsSection.jsx`.
  - Submit disabled until a candidate is selected.
- "Gestion avanzada de usuarios" link/button, shown only if the viewer also has `identity.users.read`, navigating to `/app/m/runly.identity/identity/users`.
- All labels in Spanish: "Miembros", "Agregar miembro", "Rol", "Sin rol", "Gestion avanzada de usuarios", error/toast copy following existing tone ("No se pudo agregar el miembro.", "No se pudo actualizar la membresia.").
- Loading state: `Skeleton` rows while the members list query is in flight, matching `CompanyProfile.jsx`'s pattern.
- `ErrorState` when `company.members.read` is missing, same pattern as `CompanyProfile.jsx`'s `!canManage` block.

## 9. Routes/screens

| Route | Screen | Module | Description |
|---|---|---|---|
| /company/members | CompanyMembers | runly.company | List + manage members of the active company |

## 10. Data model

No new entities. This feature reads and writes the existing `Membership` model (already used by `runly.identity`'s membership endpoints) scoped to the active company, plus reads `UserProfile` (candidate search) and `Role` (role options).

### New models

N/A

### Modified models

N/A — no schema change. `Membership` already has `userId`, `companyId`, `roleId`, `enabled`.

## 11. Prisma impact

New models: N/A
Modified models: N/A
New migration required: No
Migration safety notes: N/A

## 12. API contract

All endpoints below are new, live in `apps/api/src/index.js` (thin route handlers) backed by new functions added to the existing `apps/api/src/services/company-service.js` — not a separate service file as originally planned; `company-service.js` is already the established service for every other `/company/*` route (profile/address/branding), so a "Members" section was added there instead, for consistency with that pattern rather than introducing a second company service file. Reuses the existing pure helpers in `apps/api/src/lib/identity-memberships.js` (`checkMembershipRoleScope`, `checkProtectedRoleAssignment`, `checkSelfLockout`, `findExistingMembership`) — the same ones `/identity/users/:id/memberships*` already uses, so role-scope and self-lockout rules stay identical between the two entry points.

### GET /company/members

Auth: required
Permission: `company.members.read`
Response: `{ data: [{ membershipId, userId, displayName, email, avatarUrl, roleId, roleName, enabled }] }` — scoped to `tenant.companyId`, includes disabled memberships (so a manager can re-enable someone).

### GET /company/members/candidates?q=string

Auth: required
Permission: `company.members.manage`
Query: `q` (required, min length 2)
Response: `{ data: [{ userId, displayName, email, avatarUrl }] }` — instance-wide `UserProfile` search by name/email (case-insensitive contains), excluding users who already have an *enabled* membership in `tenant.companyId`, capped at 20 results.
Error: `400` if `q` is missing or shorter than 2 characters.

### GET /company/members/roles

Auth: required
Permission: `company.members.read`
Response: `{ data: [{ id, name }] }` — roles visible to this company (global roles `companyId: null` plus roles owned by `tenant.companyId`), same set `roleOptionsForCompany` in `MembershipsSection.jsx` already computes client-side from `identity.listRoles`, but pre-filtered server-side here so this screen doesn't need `identity.roles.read`.

### POST /company/members

Auth: required
Permission: `company.members.manage`
Body: `{ userId: string (uuid), roleId: string (uuid) | null }` — validated by new `createCompanyMemberSchema`.
Behavior: same create-or-reactivate logic as `POST /identity/users/:id/memberships` (finds an existing disabled membership for this user+company and re-enables it instead of creating a duplicate row), with `companyId` taken from `tenant.companyId` (never from the body).
Response: `{ data: { membershipId, userId, displayName, email, avatarUrl, roleId, roleName, enabled } }`
Errors: `404` user not found; `400` user already an enabled member ("El usuario ya es miembro de esta empresa."); `400`/`403` role-scope or protected-role violations (via the reused helpers); `403` missing permission.

### PATCH /company/members/:membershipId

Auth: required
Permission: `company.members.manage`
Body: `{ roleId?: string (uuid) | null, enabled?: boolean }` — reuses the existing `updateMembershipSchema`.
Behavior: rejects (`404`) if the membership does not belong to `tenant.companyId`. When `enabled: false` is requested and the target membership belongs to the acting user, applies `checkSelfLockout` (blocks only if it is the actor's last enabled membership anywhere — matches existing identity-side behavior).
Response: `{ data: { membershipId, userId, displayName, email, avatarUrl, roleId, roleName, enabled } }`

## 13. SDK contract

Domain: `runly.company` (existing `company` domain in `packages/sdk/src/index.js`, alongside `getProfile`/`updateProfile`)

- `listMembers(token)` — `GET /company/members` → `{ data: Member[] }`
- `searchMemberCandidates(query, token)` — `GET /company/members/candidates?q=...` → `{ data: Candidate[] }`
- `listMemberRoles(token)` — `GET /company/members/roles` → `{ data: Role[] }`
- `addMember(payload, token)` — `POST /company/members` → `{ data: Member }`
- `updateMember(membershipId, patch, token)` — `PATCH /company/members/:membershipId` → `{ data: Member }`

## 14. Validator contract

- `createCompanyMemberSchema` (new, in `@runly/validators`) — validates: `userId` (uuid, required), `roleId` (uuid, nullable, optional). Distinct from the existing `createMembershipSchema` because that one takes `companyId` in the body (the identity-side route targets an arbitrary company); this one never accepts `companyId` from the client.
- `updateMembershipSchema` (existing, reused as-is) — validates: `roleId` (uuid, nullable, optional), `enabled` (boolean, optional), at least one present.

## 15. Module manifest impact

Modifies the existing `runly.company` manifest at `apps/api/src/manifests/official/core-modules.js` (`companyMap`, `createModuleManifest`) — this is a Phase 1-2 core module (`createModuleManifest`, not RME3's `defineRunlyModule`), so the RME3 module checklist in `docs/spec-driven-development.md` Section 5 does not apply here. No new module, no new manifest file.

Module key: `runly.company` (unchanged)
Dependencies: unchanged (`runly.core`, `runly.files`)
Core: true (unchanged)
Uninstallable: false (unchanged)

Permissions added to the manifest's `permissions` array:
- `{ key: "company.members.read", name: "Read Company Members" }`
- `{ key: "company.members.manage", name: "Manage Company Members" }`

ACL: `acl.module` and `acl.models` unchanged (Membership is not a model this manifest scaffolds generic CRUD for). `acl.actions` gets two new entries for consistency with the existing action-name mapping style: `"company.members.read": "company.members.read"`, `"company.members.manage": "company.members.manage"`.

## 16. Navigation impact

| Label (Spanish) | Path | Icon | Layout | permissionKey |
|---|---|---|---|---|
| Miembros | /company/members | Users | main | company.members.read |

## 17. Blueprint impact

N/A — this screen is hand-built (React + `@runly/ui` primitives), same as `CompanyProfile.jsx`/`CompanyAddress.jsx`, not a blueprint-driven `RunlyTable`/`RunlyForm`.

## 18. RBAC/permissions

| Permission key | Guards endpoint(s) | Gates navigation |
|---|---|---|
| company.members.read | GET /company/members, GET /company/members/roles | Yes ("Miembros" nav item) |
| company.members.manage | GET /company/members/candidates, POST /company/members, PATCH /company/members/:membershipId | No (gates the Agregar/edit/disable controls client-side, in addition to the server-side check) |

Both new catalog entries are added to `apps/api/src/permission-catalog.js` under `groupKey: "company"`, `order: 140` and `150` respectively (after the existing `company.branding.delete` at `order: 130`).

## 19. Multi-company behavior

Every new endpoint scopes to `tenant.companyId` (the active company resolved by existing middleware, same `c.get("tenantContext")` pattern every other company-module route already uses):
- `GET /company/members` only returns memberships where `companyId === tenant.companyId`.
- `POST /company/members` always writes `companyId: tenant.companyId`, ignoring any company id a client might try to send (the schema does not even accept one).
- `PATCH /company/members/:membershipId` first loads the membership and 404s if its `companyId !== tenant.companyId`, so a membership id from another company can never be targeted.
- `GET /company/members/candidates` is the one intentionally cross-company query (by design, confirmed in brainstorming): it searches `UserProfile` across the whole instance so an admin can find a user to invite regardless of what company they currently belong to. It returns only `displayName`, `email`, `avatarUrl` — no company affiliation, role, or other data about the candidate's existing memberships elsewhere — and requires `company.members.manage`, not just `.read`, to reduce exposure of the instance's user directory to read-only viewers.

## 20. Files/storage impact

N/A — avatars are resolved through the existing `buildAvatarUrlMapByFileIds` helper already used by `/identity/users` and `/memberships/me`; no new upload or storage path.

## 21. Export/import requirements

N/A

## 22. Audit log requirements

Follows the existing pattern already used by `/identity/users/:id/memberships*` (`publishActivityFromContext`, `apps/api/src/services/activity-publisher.js`) — the same mechanism, applied to the new company-scoped entry points:

| Action key | Trigger | Payload |
|---|---|---|
| company.member.create | POST /company/members | after: `{ membershipId, userId, roleId, enabled: true }` |
| company.member.update | PATCH /company/members/:membershipId (roleId change) | before: `{ roleId }`, after: `{ roleId }` |
| company.member.disable | PATCH /company/members/:membershipId (enabled: false) | after: `{ enabled: false }` |
| company.member.enable | PATCH /company/members/:membershipId (enabled: true, re-activating a disabled row) | after: `{ enabled: true }` |

## 23. Edge cases

1. Candidate is already an enabled member of the active company: `POST /company/members` returns `400` ("El usuario ya es miembro de esta empresa.") — checked via `findExistingMembership` + `enabled` flag, same as the identity-side route.
2. Candidate previously had a disabled membership in this company: `POST /company/members` re-enables that row (updates `roleId`/`enabled: true`) instead of creating a duplicate `Membership` row — mirrors existing identity-side behavior exactly.
3. Acting user tries to disable their own membership and it is their only enabled membership anywhere: blocked by `checkSelfLockout`, same message as today ("No puedes deshabilitar el acceso a tu unica empresa habilitada.").
4. Acting user tries to disable their own membership but they have other enabled memberships elsewhere: allowed (they just lose access to this company, same as any other member being removed).
5. Assigning a role scoped to a different company (`role.companyId` set but `!== tenant.companyId`): rejected via `checkMembershipRoleScope`, `400`.
6. Assigning a protected role (`runly.admin`/`system.admin`) without role-management rights: rejected via `checkProtectedRoleAssignment`, `403`.
7. `q` shorter than 2 characters on the candidate search: `400`, prevents an unbounded/near-empty-string scan of the instance's user directory.
8. Candidate search returns zero results: combobox shows its existing "sin resultados" empty state (no new component needed).
9. A membership id in the PATCH URL belongs to a different company: `404`, not `403` — do not reveal that the id exists elsewhere.
10. Viewer has `company.members.read` but not `.manage`: list renders read-only (no role select, no switch, no "Agregar miembro" button), matching the existing `!canManage` degrade pattern in `CompanyProfile.jsx`.

## 24. Risks

1. Risk: candidate search becomes a way to enumerate/harvest the instance's full user directory (names + emails) across tenants. Mitigation: gated behind `company.members.manage` (not `.read`), minimum query length, capped result count, no membership/role data about candidates exposed in the response.
2. Risk: duplicating role-scope/self-lockout logic between the identity-side and company-side membership endpoints could let them drift out of sync over time. Mitigation: both entry points import the same pure helpers from `apps/api/src/lib/identity-memberships.js` rather than reimplementing the checks; a future behavior change to those rules only has to happen in one place.
3. Risk: `apps/api/src/index.js` is already flagged over its soft line-limit in `CLAUDE.md`. Mitigation: route handlers here stay thin (parse, call the service, respond); the actual logic lives in `apps/api/src/services/company-service.js`'s new "Members" section, adding only ~5 short route registrations plus a small actor-context helper to `index.js` itself.

## 25. Acceptance criteria

1. Given a user with `company.members.read` (and not `.manage`), when they open `/company/members`, then they see the member list with no "Agregar miembro" button and no editable role/enabled controls.
2. Given a user without `company.members.read`, when they navigate to `/company/members`, then the "Miembros" nav item is not shown and the screen renders the existing `ErrorState` pattern if reached directly.
3. Given a user with `company.members.manage`, when they search a candidate by name and submit with a role selected, then a new enabled `Membership` row (or a re-enabled existing one) is created for the active company and the list refreshes to show it.
4. Given a user with `company.members.manage`, when they try to add a user who is already an enabled member, then the API returns `400` and the UI shows a toast error.
5. Given a user with `company.members.manage` disabling their own only enabled membership, when they submit, then the API returns `400` (self-lockout) and the membership stays enabled.
6. Given a user with `company.members.manage`, when they assign a role scoped to a different company, then the API returns `400` and no change is persisted.
7. Given a `PATCH /company/members/:membershipId` request where the membership belongs to a different company, then the API returns `404`.
8. Given `GET /company/members/candidates?q=a`, then the API returns `400` (query too short).

## 26. Verification plan

- `pnpm build` — no build errors
- `pnpm db:seed` — new `company.members.read`/`company.members.manage` permissions seeded from the updated manifest + catalog
- `node --test apps/api/src/services/__tests__/` — new `company-members-service.test.js` covering: candidate search excludes existing enabled members, role-scope enforcement, self-lockout, cross-company 404 on PATCH
- Manual: authenticate as a user with only `company.members.read`, confirm `/company/members` list loads but shows no manage controls, and `POST /company/members` returns `403`
- Manual: authenticate as a user with `company.members.manage`, add a real second test user to the active company with a role, confirm they appear in `/identity/users` (company-scoped) too
- Manual: disable a member, confirm they lose access to the company on next login/token refresh, then re-enable and confirm access returns without creating a duplicate membership row
- `pnpm lint` — clean

## 27. Rollback plan

No migration to roll back (no schema change). Reverting is a plain code revert of the new route handlers, service file, manifest permission entries, SDK methods, and the new screen/navigation entry. Existing `Membership` rows created or modified through this feature are ordinary rows indistinguishable from ones created via the identity-side endpoints — no cleanup needed beyond the normal soft-disable state they're already in.

## 28. Future enhancements

1. Inviting a user who does not yet have an account (email invite flow) — currently a non-goal, deferred.
2. Bulk add/remove members (e.g., CSV).
3. Showing a member's last-active/last-login timestamp in the list.
4. Filtering/searching the members list itself once companies with large member counts exist (today's list has no pagination — acceptable at expected company sizes, revisit if needed).
