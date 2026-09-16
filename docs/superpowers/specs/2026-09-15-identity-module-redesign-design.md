# Identity module redesign (Usuarios, Roles, Overview, Reportes de chat)

Date: 2026-09-15
Status: Approved
Author: Claude (agent)
Spec file: docs/superpowers/specs/2026-09-15-identity-module-redesign-design.md
Plan file: docs/superpowers/plans/2026-09-15-identity-module-redesign.md (created after this spec)

---

## 1. Feature title

Identity module redesign — Usuarios, Roles, Overview y Reportes de chat move to the shared blueprint/glassic pattern.

## 2. Status

Approved

## 3. Context

`runly.hr`, `runly.fleet`, and `runly.inventory` were recently migrated to a shared, "glassic" presentation layer built on `@runly/ui`'s blueprint renderer (`RunlyTable`, `RunlyForm`, `RunlyDetail`, `RunlyCrudView`, `DetailHero`, `StatStrip`) with two-column detail layouts, hero + KPI headers, and thin screen wrappers that delegate rendering to declarative blueprint files. `runly.identity` (Usuarios, Roles, Resumen, Reportes de chat) predates that pattern: its screens are hand-rolled React with duplicated Card/PageHeader scaffolding, and its largest file (`UserEditorScreen.jsx`, 759 lines) mixes read-only detail and editable form in one component using manual pathname parsing and a hand-built "draft" diffing pattern.

## 4. Problem

1. Usuarios' detail/edit screen does not match the visual language now established elsewhere in the ERP, and mixes two different concerns (viewing vs. editing) in a single 759-line file with duplicated field markup.
2. A user's company assignments are modeled as an array (`memberships[]`) in the backend, but the UI only ever shows and edits the first membership — there is no way to see or manage a user's access to more than one company from the UI, even though the data model already supports it.
3. The user detail screen has no dedicated fetch-by-id endpoint; it filters a paginated list query client-side, which silently fails to find a user who isn't on the first page.
4. Roles, Overview, and Reportes de chat each reimplement their own stat cards, headers, and table/list chrome instead of reusing the shared components other modules now rely on, producing visual and code drift across the same module.
5. `RunlyForm` has no way to embed a custom interactive field group (e.g., a cascading country → state → city picker) inside a blueprint-driven form; every module that needs this today (`CompanyAddress.jsx`, the current identity editor) hand-rolls it outside of any blueprint.

## 5. Goals

1. Usuarios (list, detail, create, edit) is restyled with the shared glassic hero/KPI/two-column language and, where it is a net simplification, rebuilt on the same blueprint primitives (`RunlyTable`, `RunlyDetail`, `RunlyForm`) already used by HR/Fleet/Inventory.
2. A user's detail and edit views are split into two focused screens/routes instead of one 759-line dual-mode component.
3. A user's assignments to companies (memberships), including companies where the assignment is currently disabled, can be viewed, added to, and edited (role, enabled state) from the user's detail screen — not just the first membership.
4. Roles (list, detail) moves to the same blueprint pattern: `RunlyCrudView` (table + card views) for the list, `RunlyDetail` (hero + KPIs) wrapping the existing permission-tree editor for the detail.
5. Overview is restyled to reuse `StatStrip` instead of its ad hoc local `StatCard` component; Reportes de chat gets matching visual polish (see Non-goal 9 for why it keeps its current `DataTable`).
6. `RunlyForm` gains a generic `type: "component"` section capability (mirroring the one `RunlyDetail` already has), and the country/state/city/address picker is extracted into a single reusable `@runly/ui` component (`AddressFieldsSection`) instead of being duplicated by every screen that needs an address.
7. `GET /identity/users/:id` exists as a dedicated single-record fetch, matching the pattern already used by `runly.hr` (`GET /hr/employees/:id`), and the response includes all of a user's memberships (including disabled ones) and a total count.
8. No source file touched by this feature exceeds 1000 lines (hard ceiling 1500), per project convention.

## 6. Non-goals

1. No new Prisma models or migrations. `UserProfile`, `Membership`, `Company`, `Role`, `Permission`, `RolePermission` already have every field this feature needs.
2. No new permission keys. All new/changed endpoints reuse the existing `identity.users.*`, `identity.roles.*`, `identity.permissions.*` catalog.
3. No "last login" or 2FA/MFA status. Confirmed absent from both the database and Supabase Auth integration today; adding them is out of scope (see Future enhancements).
4. No change to how visible-user scoping works today (`tenant.companyId`-gated list visibility) and no new cross-tenant restriction on who can manage a user's memberships — any holder of `identity.users.update` can already see another company's name/role via the existing `memberships[]` payload and will continue to be able to add/remove a user's access to any company in the instance, exactly as today's API already allows. This feature only makes that existing capability discoverable and usable from the UI.
5. `UserCreateScreen.jsx` keeps its current field set and creation behavior (name/email/password, optional role, membership created against the admin's active company) — restyled only, not restructured. Company/role assignment beyond the one created at signup happens afterward from the new user's detail screen.
6. `CompanyAddress.jsx` is not touched. The new `AddressFieldsSection` component is built for reuse by other screens later, but migrating `CompanyAddress.jsx` to it is deferred (Future enhancements).
7. Roles list drops its current three view modes (table/card/grid) down to one (table only) when migrated to `RunlyCrudView` — confirmed during planning that `RunlyCrudView` has no built-in table/card toggle (it only ever renders `RunlyTable` for browsing) and that `RunlyCardView` has zero existing consumers anywhere in the app, so wiring it in here would be unproven, unprecedented integration work, not a reuse of an established pattern. Card and grid views are dropped rather than rebuilt.
8. No RME3 migration. `runly.identity` remains a core module with its manifest in `apps/api/src/manifests/official/core-modules.js` and its routes inline in `apps/api/src/index.js` — this feature does not convert it to `defineRunlyModule`/`modules/custom/*`. Section 5 of `docs/spec-driven-development.md` (Runly Module Checklist) is N/A for this reason.
9. Reportes de chat is NOT converted to a `TABLE`-kind blueprint. Confirmed during planning: its backing endpoint (`GET /chat/reports` in `apps/api/src/routes/chat/moderation-routes.js`) only accepts `?status=` and returns a plain array with no pagination envelope, so it doesn't satisfy `RunlyTable`'s `schema.apiPath` contract (`page`/`pageSize`/`search`). Adding pagination to the chat moderation API would be scope creep into `runly.chat`. This screen keeps its current hand-wired `DataTable`, restyled only.

## 7. User stories

- As an admin with `identity.users.update`, I want to see a user's detail page with a clear hero, key stats, and a dedicated "Empresas y roles" section, so that I can understand and manage their access at a glance instead of hunting through a mixed edit/view screen.
- As an admin with `identity.users.update`, I want to assign a user to an additional company with a specific role, so that a user who needs access to more than one tenant doesn't require a support workaround.
- As an admin with `identity.users.update`, I want to disable a user's access to one company without affecting their access to others, so that I can revoke scoped access precisely.
- As an admin with `identity.roles.read`, I want a role's detail page to show how many users hold it and how many permissions it grants at a glance, so that I can judge the impact of editing or disabling it before I do.
- As an admin browsing Usuarios, Roles, Overview, or Reportes de chat, I want the same visual language (hero, KPI strip, glass cards) across all four screens, so that the module feels coherent instead of like four different eras of the app.

## 8. UX requirements

- All UI labels remain in Spanish, matching existing copy exactly where a screen is not otherwise changing (e.g., "Usuarios", "Roles y permisos", "Empresas y roles", "Activo"/"Inactivo").
- Detail and edit are separate routes/screens for Usuarios (`.../users/:id` read-only, `.../users/:id/edit` form), matching the pattern already used by `runly.hr`.
- Users detail hero: avatar (resolved through the existing `/identity/users/:id/avatar/signed-url` endpoint), display name, email as subtitle, Activo/Inactivo status pill, phone as a meta chip when present. A "Cambiar foto" hero action opens a dialog with the existing `DistDropZone` upload flow — this is not a blueprint field.
- Users KPI strip (`StatStrip`, 4 items): Estado, Rol principal (first enabled membership's role name, or "Sin rol"), Empresas asignadas (count of ALL memberships, enabled or not), Fecha de alta.
- Users detail main column: "Información personal" (name, phone, birth date, gender, bio) and "Dirección" sections, both read-only field grids like other DETAIL blueprints.
- Users detail aside column, in order: "Empresas y roles" (`MembershipsSection`), "Permisos" (`PermissionGrantsSection`, only rendered when the viewer has `identity.permissions.update` + `identity.users.update`, matching today's `canManageGrants` gate), "Actividad" (`UserActivitySection`, wraps the existing `ActivityTimeline`).
- `MembershipsSection` renders one row per membership (company name, role select scoped to that company's roles plus system-wide roles, Activo/Inactivo toggle) with autosave per row (loading state on the toggled/changed row, toast on success/error) — no separate "save" step, matching how `UserPermissionGrantsCard` already behaves today. A "+ Agregar empresa" action opens a small dialog (company combobox sourced from a new purpose-built endpoint + role select) and calls the create-membership endpoint on submit. Disabling a membership never hard-deletes it (soft-delete convention).
- Users edit form: sections "Identidad" (nombre, apellidos, correo, activo), "Perfil" (teléfono, fecha de nacimiento, sexo, biografía), and "Dirección" rendered via the new `AddressFieldsSection` component-type section (country/state/city cascading combobox exactly as today, plus colonia/calle/números/código postal). `showCompletion: true`. No role/membership fields in this form — those live only in the detail's `MembershipsSection`.
- Users list is unchanged visually beyond header/spacing polish — it already uses `RunlyTable` with bulk actions, export, and the self-delete/protected-admin-role guards; none of that logic changes.
- Roles list: `RunlyCrudView` in table view only (matching the pattern already used by `runly.fleet`'s `VehiclesScreen.jsx`), with search and the existing "Estado" filter carried into the table blueprint's `filters`. No `ViewModeSwitch` — table/card/grid toggle is dropped entirely (see Non-goal 7). "Nuevo rol" keeps opening the existing 3-field Sheet (key/nombre/descripción) — not converted to a blueprint form.
- Roles detail: hero (nombre as title, clave as subtitle, Sistema/Activo badges), KPI strip (Permisos asignados, Usuarios con este rol), main column keeps the existing `PermissionFeatureTree` editor with its `UnsavedChangesBar` save flow (via a thin `PermissionTreeSection` wrapper), aside column adds `RoleMembersSection` (avatar + name list of users holding the role, linking to each user's detail page). Editing nombre/descripción keeps opening the existing Sheet from a hero action.
- Overview: the four hand-built `StatCard` tiles are replaced by one `StatStrip` (Usuarios, Activos, Roles, Roles personalizados); quick-link cards and the "roles recientes" list keep their current behavior, restyled to match.
- Reportes de chat: keeps its current hand-wired `DataTable` and filter (see Non-goal 9), restyled with the module's glass-shell spacing; the existing columns (reportante, reportado, motivo, nota, estado, fecha) and resolve/dismiss/disable-user actions/`ConfirmDialog` are unchanged.
- Loading/error/empty states: every screen keeps using `LoadingState`/`ErrorState`/`EmptyState` as today; no new state UX is introduced beyond what the underlying `RunlyTable`/`RunlyDetail`/`RunlyForm` renderers already provide out of the box.

## 9. Routes/screens

| Route | Screen | Module | Description |
|---|---|---|---|
| /app/m/runly.identity/identity/users | UsersScreen | runly.identity | List of users (RunlyTable, unchanged behavior, blueprint extracted to its own file) |
| /app/m/runly.identity/identity/users/new | UserCreateScreen | runly.identity | Create user (bespoke, restyled only) |
| /app/m/runly.identity/identity/users/:id | UserDetailScreen (new) | runly.identity | Read-only detail (RunlyDetail), replaces the detail half of UserEditorScreen.jsx |
| /app/m/runly.identity/identity/users/:id/edit | UserEditScreen (new) | runly.identity | Edit form (RunlyForm), replaces the edit half of UserEditorScreen.jsx |
| /app/m/runly.identity/identity/roles | RolesScreen | runly.identity | List of roles (RunlyCrudView: table + card) |
| /app/m/runly.identity/identity/roles/:id | RoleEditorScreen | runly.identity | Role detail + permission tree (RunlyDetail wrapping the existing tree) |
| /app/m/runly.identity/identity/chat-reports | ChatReportsScreen | runly.identity | Chat moderation reports (RunlyTable) |
| /app/m/runly.identity/ | IdentityOverview | runly.identity | Module landing page (StatStrip + quick links) |

`UserEditorScreen.jsx` is deleted. `apps/desktop/src/app/ModuleOutlet.jsx`'s two entries for `runly.identity:/identity/users/:id` and `runly.identity:/identity/users/:id/edit` are repointed to `UserDetailScreen.jsx` and `UserEditScreen.jsx` respectively; no other route entries change.

## 10. Data model

### New models

None.

### Modified models

None. This feature is UI + API-shape work only; every field it needs (`UserProfile.*`, `Membership.{id,companyId,userId,roleId,enabled,createdAt,updatedAt}`, `Company.{id,name}`, `Role.{id,companyId,key,name,enabled,system}`) already exists in `prisma/schema.prisma`.

## 11. Prisma impact

New models: None
Modified models: None
New migration required: No
Migration safety notes: N/A

## 12. API contract

Runly response convention: success `{ data: ... }`, error `{ error: string }`.

### GET /identity/users/:id (new)

Auth: required
Permission: `identity.users.read`
Response success: `{ data: UserProfile & { avatarUrl, memberships: Membership[] (ALL, including disabled), membershipsTotal: number } }` — same `serializeIdentityUser` shape as the list endpoint, but scoped to one record, including disabled memberships, plus the computed `membershipsTotal` count. `memberships` is ordered by `createdAt` ascending, so `memberships[0]` (when enabled) deterministically defines "Rol principal" in the KPI strip and list column — the oldest membership is primary, not an arbitrary one.
Response error: `404 { error: "Usuario no encontrado." }` if the id doesn't resolve to a user visible in the requester's active company (same `assertUserInCompany` gate the existing PATCH/DELETE routes already use).

### PATCH /identity/users/:id/memberships/:membershipId (new)

Auth: required
Permission: `identity.users.update`
Body: `{ roleId?: string | null, enabled?: boolean }` — validated by `updateMembershipSchema`.
Behavior: verifies `membershipId` belongs to `:id` (same ownership check the existing membership-role-update code already performs inline); if `roleId` is provided, verifies the role's `companyId` matches the membership's `companyId` OR the role is system-wide (`companyId: null`); reuses the existing protected-admin-role guard (assigning `runly.admin`/`system.admin` requires `identity.roles.update`); if `enabled: false` is requested and this is the caller's own last enabled membership, rejects with `400` (see Edge cases).
Response success: `{ data: Membership & { companyName, roleName, roleKey } }`
Response error: `400 { error: "..." }` on ownership/role-scope/self-lockout violations, `403` on the protected-role guard, `404` if the membership or user doesn't exist.

### POST /identity/users/:id/memberships (new)

Auth: required
Permission: `identity.users.update`
Body: `{ companyId: string, roleId?: string | null }` — validated by `createMembershipSchema`.
Behavior: if the user already has a (possibly disabled) membership for `companyId`, reactivates/updates it instead of creating a duplicate row (upsert semantics); otherwise creates a new `Membership`. Applies the same role-scope and protected-role guards as the PATCH endpoint above.
Response success: `{ data: Membership & { companyName, roleName, roleKey } }` (`201` on create, `200` on reactivate)
Response error: `400` on validation/role-scope violations, `404` if the user or company doesn't exist.

### GET /identity/companies-options (new)

Auth: required
Permission: `identity.users.update`
Response: `{ data: [{ id: string, name: string }] }` — every company in the instance (purpose-built, pre-labeled combobox source; mirrors the existing `/hr/user-options` pattern), ordered by name.

### GET /identity/roles/:id/members (new)

Auth: required
Permission: `identity.roles.read`
Response: `{ data: [{ id, displayName, email, avatarUrl, companyName }] }` — every user with an enabled membership carrying this role, across companies the requester can see (same visibility rule as `GET /identity/users`).
Response error: `404 { error: "Rol no encontrado." }`

### Unchanged endpoints (no contract change)

`GET/POST /identity/users`, `PATCH /identity/users/bulk/enabled`, `DELETE /identity/users/bulk`, `POST /identity/users/export/{excel,pdf}`, `POST /identity/users/:id/avatar`, `GET /identity/users/:id/avatar/signed-url`, `DELETE /identity/users/:id`, `PATCH /identity/users/:id` (still handles the single-membership `membershipId`+`roleId` shape for backward compatibility, though the new UI stops sending it in favor of the dedicated membership endpoints above), `GET/POST/PUT/PATCH/DELETE /identity/roles*`, `GET /identity/permissions`, `GET/PUT /identity/users/:id/permission-grants`, chat-reports endpoints under `runly.chat`'s moderation routes.

## 13. SDK contract

Domain: `runly.identity` (existing domain object in `packages/sdk/src/index.js`)

New methods:
- `getUser(id, token)` — `GET /identity/users/:id` → `{ data: UserProfile }`
- `updateMembership(userId, membershipId, data, token)` — `PATCH /identity/users/:id/memberships/:membershipId` → `{ data: Membership }`
- `createMembership(userId, data, token)` — `POST /identity/users/:id/memberships` → `{ data: Membership }`
- `listCompanyOptions(token)` — `GET /identity/companies-options` → `{ data: { id, name }[] }`
- `listRoleMembers(roleId, token)` — `GET /identity/roles/:id/members` → `{ data: User[] }`

No existing method signatures change.

## 14. Validator contract

New Zod schemas in `@runly/validators` (`packages/validators/src/index.js`), following the existing `createUserSchema` pattern:

- `createMembershipSchema` — validates: `companyId` (string, uuid, required), `roleId` (string, uuid, nullable, optional)
- `updateMembershipSchema` — validates: `roleId` (string, uuid, nullable, optional), `enabled` (boolean, optional) — at least one of the two must be present

No existing schemas change.

## 15. Module manifest impact

N/A — `runly.identity` is an existing core module (`apps/api/src/manifests/official/core-modules.js`, `identityMap`). No new module key, no dependency change, no new permission entries in the manifest's `permissions` array (all permissions used already exist there).

## 16. Navigation impact

N/A — no new navigation items. All four screens are already reachable from existing navigation entries; only their internal implementation changes.

## 17. Blueprint impact

New blueprint files (all under `apps/desktop/src/modules/runly.identity/blueprints/`):

- `identity-user-table.blueprint.js` — `kind: TABLE`, extracted as-is from the `USERS_BLUEPRINT` object currently inlined in `UsersScreen.jsx` (no schema changes).
- `identity-user-detail.blueprint.js` — `kind: DETAIL`, `layout: two-column`. `hero`: titleField `displayName`, subtitleFields `[email]`, statusField `enabled` with a boolean status map, `avatarUserField` for the self-avatar (same mechanism HR's `linked-user` relation-card already uses to resolve a Runly Identity avatar), `fallbackIcon: 'UserRound'`, metaChips `[phone]`. `kpis`: Estado, Rol principal, Empresas asignadas (`membershipsTotal`), Fecha de alta. `sections`: "Información personal" and "Dirección" (`column: main`, plain field grids); `MembershipsSection`, `PermissionGrantsSection`, `UserActivitySection` (`column: aside`, `type: component`).
- `identity-user-form.blueprint.js` — `kind: FORM`, `showCompletion: true`. Sections: "Identidad", "Perfil" (plain field lists), "Dirección" (`type: component`, `component: 'runly.identity:AddressFieldsSection'`, `fields: [country, state, city, colony, street, extNumber, intNumber, postalCode]`).
- `identity-role-table.blueprint.js` — `kind: TABLE`, columns: nombre, clave, permisos (count), estado; filter: estado.
- `identity-role-detail.blueprint.js` — `kind: DETAIL`, `layout: two-column`. `hero`: titleField `name`, subtitleFields `[key]`, statusField `enabled`, metaChips `[system]`. `kpis`: Permisos asignados, Usuarios con este rol. `sections`: `PermissionTreeSection` (`column: main`, `type: component`), `RoleMembersSection` (`column: aside`, `type: component`).
- None for Reportes de chat — see Non-goal 9; it keeps its current hand-wired `DataTable`, not a blueprint.

## 18. RBAC/permissions

No new permission keys. Existing keys extend to guard the new endpoints:

| Permission key | Guards endpoint(s) | Gates navigation |
|---|---|---|
| identity.users.read | GET /identity/users, GET /identity/users/:id (new) | Yes (Usuarios) |
| identity.users.update | PATCH /identity/users/:id, PATCH .../memberships/:id (new), POST .../memberships (new), GET /identity/companies-options (new) | No |
| identity.users.create | POST /identity/users | No |
| identity.users.delete | DELETE /identity/users/:id, DELETE /identity/users/bulk | No |
| identity.roles.read | GET /identity/roles, GET /identity/roles/:id/members (new) | Yes (Roles) |
| identity.roles.update | PUT /identity/roles/:id, PATCH .../enabled, protected-role reassignment guard on membership endpoints | No |
| identity.roles.create | POST /identity/roles | No |
| identity.roles.delete | DELETE /identity/roles/:id | No |
| identity.permissions.read | GET /identity/permissions | No |
| identity.permissions.update | PATCH /identity/roles/:id/permissions, gates `PermissionGrantsSection` visibility together with identity.users.update | No |
| identity.chat_reports.read | GET chat-reports list | Yes (Reportes de chat) |
| identity.chat_reports.manage | resolve/dismiss/disable-user actions | No |

## 19. Multi-company behavior

`GET /identity/users` and the new `GET /identity/users/:id` continue to gate which USERS are visible by the requester's active company (`assertUserInCompany`/`tenant.companyId`-scoped `where` clause) — unchanged. Once a user is visible, the response already includes the names/roles of ALL of that user's enabled memberships regardless of company (pre-existing behavior, not introduced by this feature). This spec's new membership-management endpoints (`PATCH`/`POST .../memberships`) extend that same reach to writes: any holder of `identity.users.update` can add or change a visible user's membership to any company in the instance, matching what the API already technically allowed (see Non-goal 4 and Risk 1). Role options offered when assigning/changing a membership's role are scoped to that membership's `companyId` (plus system-wide, `companyId: null`, roles) — a company-scoped role can never be assigned to a membership in a different company. `GET /identity/roles/:id/members` reuses the same per-user visibility rule as the users list, so a company-scoped admin only sees role members from companies they can already see.

## 20. Files/storage impact

N/A for new work — this feature reuses the existing identity avatar upload path (`POST /identity/users/:id/avatar`, `atlas-files`-equivalent storage bucket already wired via `uploadIdentityAvatar`) without modification. No new file/storage code is introduced.

## 21. Export/import requirements

N/A — this feature does not add or change PDF/Excel/CSV export or bulk import. The existing Usuarios list export (Excel/PDF) is unchanged.

## 22. Audit log requirements

| Action key | Trigger | Payload |
|---|---|---|
| identity.membership.create | POST /identity/users/:id/memberships | after: { userId, companyId, roleId, enabled } |
| identity.membership.update | PATCH /identity/users/:id/memberships/:membershipId | before: { roleId, enabled }, after: { roleId, enabled } |

Existing audit entries (`identity.user.create/update/delete`, `identity.role.create/update/enable/disable/delete`) are unchanged.

## 23. Edge cases

1. A membership being disabled is the caller's own last enabled membership across all companies — reject with `400` (self-lockout guard), mirroring the existing self-delete guard on `DELETE /identity/users/:id`.
2. Assigning a role to a membership whose `companyId` doesn't match the role's `companyId` (and the role isn't system-wide) — reject with `400`.
3. Assigning a protected admin role (`runly.admin`/`system.admin`) via the new membership endpoints without `identity.roles.update` — reject with `403`, reusing the existing guard already present in `PATCH /identity/users/:id`.
4. `POST /identity/users/:id/memberships` targeting a company where the user already has a disabled membership — reactivate/update that row instead of creating a duplicate.
5. `POST /identity/users/:id/memberships` targeting a company where the user already has an ENABLED membership — reject with `400` ("El usuario ya tiene acceso a esta empresa.").
6. A role's `companyId` is `null` (system-wide) — it must appear as a role option for every company's membership row, not just one.
7. A user with zero memberships (e.g., created without a role and never assigned) — `MembershipsSection` shows an empty state with only the "+ Agregar empresa" action, KPI "Empresas asignadas" shows 0, "Rol principal" KPI shows "Sin rol".
8. `GET /identity/users/:id` for an id that exists but belongs to a different company than the requester's active company — `404`, matching today's `assertUserInCompany` behavior for PATCH/DELETE (not a `403`, to avoid confirming the id exists elsewhere).
9. A role has zero members — `RoleMembersSection` shows an empty state; the "Usuarios con este rol" KPI shows 0.
10. `AddressFieldsSection`'s country/state/city cascade is reset (state and city cleared) whenever the parent field (country, then state) changes, matching today's `UserEditorScreen.jsx` cascade-reset behavior exactly.
11. `RunlyForm`'s new `type: "component"` sections must participate in the form's dirty-tracking and `showCompletion` percentage the same way regular fields do, using the section's declared `fields: [...]` list — a form with unsaved component-section changes must still trigger the same "unsaved changes" affordance as a form with unsaved plain-field changes.

## 24. Risks

1. Risk: extending `RunlyForm` (shared renderer used by every module with a FORM blueprint) to support `type: "component"` sections could regress existing forms (HR, Fleet, Inventory) if the new code path is reached unintentionally or breaks dirty-tracking/submit assembly. Mitigation: the new section type is additive and opt-in (only triggered by `type: "component"` in a section, which no existing blueprint uses); existing HR/Fleet/Inventory FORM blueprints are exercised as part of manual verification after the renderer change, not just the new identity screens.
2. Risk: any `identity.users.update` holder can grant/revoke a user's access to ANY company in the instance once "Empresas y roles" is easy to reach from the UI, which was previously only reachable by direct API calls. Mitigation: none beyond what already exists today — this was an explicit product decision (see Non-goal 4); documented here so it isn't mistaken for an oversight later.
3. Risk: deleting `UserEditorScreen.jsx` and splitting it into two screens could regress a currently-working flow (avatar viewer, delete confirmation, self/protected-admin guards) if any of that logic isn't carried over to the new `UserDetailScreen.jsx`/`UserEditScreen.jsx`. Mitigation: the implementation plan must explicitly map every piece of existing behavior in `UserEditorScreen.jsx` to its new home before the old file is deleted.
4. Risk: `Membership` has no unique constraint enforced at the Prisma level on `(userId, companyId)` (confirmed absent from the schema) — the "upsert instead of duplicate" logic in `POST /identity/users/:id/memberships` is therefore an application-level check, not a database guarantee, and a race between two concurrent requests could still create two rows for the same user+company. Mitigation: acceptable for this feature (memberships are managed by admins one at a time in the UI, not high-concurrency); flagged as a Future enhancement if it ever needs a DB-level constraint (would require a migration, out of scope here per Non-goal 1).

## 25. Acceptance criteria

1. Given a user with `identity.users.read`, when they open a user's detail page, then they see a hero with avatar/status, a 4-item KPI strip, and separate "Empresas y roles", "Permisos" (if authorized), and "Actividad" sections — with no editable form fields on the page.
2. Given a user with `identity.users.update` viewing a user's detail page, when they click "Editar", then they land on `.../users/:id/edit`, a separate route rendering a `RunlyForm` with Identidad/Perfil/Dirección sections and no membership/role fields.
3. Given a user with `identity.users.update` on a user's detail page, when they use "+ Agregar empresa" to assign a company and role, then a new membership row appears in "Empresas y roles" without a page reload, and `GET /identity/users/:id` afterward reflects it.
4. Given a user's membership in Company A with role R (where R's `companyId` is A), when an admin tries to assign R to that same user's membership in Company B, then the API rejects the request with `400`.
5. Given a user whose only enabled membership is the one being disabled, when the admin submits the disable action, then the API returns `400` and the membership remains enabled.
6. Given a role with `memberCount` of N, when its detail page loads, then the "Usuarios con este rol" KPI shows N and `RoleMembersSection` lists exactly those N users.
7. Given the Roles list screen, when it renders, then it is a single `RunlyTable` view with no view-mode switch present (table/card/grid toggle removed).
8. Given the Overview screen, when it loads, then the four KPIs are rendered via the shared `StatStrip` component (verifiable by DOM structure matching `StatStrip`'s output), not the module-local `StatCard` function.
9. Given an existing HR employee FORM (`HR_EMPLOYEE_FORM`) after the `RunlyForm` renderer change, when it is submitted with no address/component section present, then it behaves identically to before the change (regression check).
10. Given `UserEditorScreen.jsx` is deleted, when the full test/build suite and a manual walkthrough of avatar upload, self-delete prevention, and protected-admin-role guards are run, then all of that behavior still works from the new `UserDetailScreen.jsx`/`UserEditScreen.jsx`.

## 26. Verification plan

- `pnpm build` — no build errors across `apps/api`, `apps/desktop`, `packages/ui`, `packages/sdk`, `packages/validators`.
- `pnpm lint` — no new lint violations.
- `node --check apps/api/src/index.js` and `node --test apps/api/src/services/__tests__/` — existing API test suite still passes.
- `node --test packages/ui/src/runly-renderer/__tests__/` (or equivalent) after adding `type: "component"` support to `RunlyForm`, including a regression check against an existing FORM blueprint (e.g. `HR_EMPLOYEE_FORM`) with no component sections.
- Manual: as a user with `identity.users.read` only, confirm `GET /identity/users/:id` returns 200 and the detail page renders with no edit affordance.
- Manual: as a user with `identity.users.update`, add a second company membership to a test user, confirm it appears immediately and persists after a reload.
- Manual: attempt to disable a test user's own last membership while logged in as that user (if reachable) or via direct API call as that user — confirm `400`.
- Manual: attempt to assign a company-scoped role across companies via `PATCH .../memberships/:id` — confirm `400`.
- Manual: confirm the Roles list table, Role detail KPI counts, Overview StatStrip, and Reportes de chat table all render and behave as before against a seeded dataset.
- Manual: confirm no source file touched by this feature exceeds 1000 lines (`git diff --stat` review + line counts on new/modified files).

## 27. Rollback plan

No migrations are involved (see Section 11), so rollback is a pure code revert: reverting the commit(s) restores `UserEditorScreen.jsx`, the old `RolesScreen.jsx`/`RoleEditorScreen.jsx`/`IdentityOverview.jsx`/`ChatReportsScreen.jsx`, the two `ModuleOutlet.jsx` route entries, and removes the new API routes/SDK methods/validators/blueprint files/components without any data cleanup, since no new tables or columns were created. The `RunlyForm` `type: "component"` addition is additive and backward-compatible, so it can be left in place even if the rest of the feature is rolled back, or reverted together with no data impact either way.

## 28. Future enhancements

1. Sync `last_sign_in_at` and MFA factor status from Supabase Auth into the user detail KPIs (deferred — requires new backend sync work, explicitly out of scope per Non-goal 3).
2. Migrate `CompanyAddress.jsx` to the new shared `AddressFieldsSection` component to remove its own duplicated country/state/city logic (deferred per Non-goal 6).
3. Rebuild the dropped compact icon-grid view for Roles as a proper blueprint view type if there's demand for it (deferred per Non-goal 7).
4. Add a DB-level unique constraint on `Membership(userId, companyId)` if the application-level upsert-or-reject logic in `POST /identity/users/:id/memberships` ever proves insufficient under concurrent use (see Risk 4).
5. Migrate `runly.identity` to RME3 (`defineRunlyModule`) as part of a broader core-module migration effort — out of scope for this UI/UX-focused redesign.
