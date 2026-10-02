# Files Access Model and Share Links

## 1. Feature title

runly.files access model: personal cloud, module-derived visibility, and public share links.

## 2. Status

Proposed

## 3. Context

`runly.files` started as a company file manager for the system administrator. The
product direction is now a personal cloud: each user manages their own files,
shares them deliberately, and sees module attachments (Canvas, Projects, HR,
Purchases, ...) only where they already have access to the originating record.

Today the access rule lives in `apps/api/src/services/files/access.js`:

- admin (`runly.admin`, `system.admin`) reads everything;
- `accessScope = COMPANY` (the schema default) is readable by any company member;
- `accessScope = RESTRICTED` is readable by the uploader and accepted shares.

Only workspace documents created with "Nuevo documento" are `RESTRICTED`
(`services/files/workspace.js`). Everything else, including plain uploads made
inside runly.files and every module attachment, is `COMPANY`.

## 4. Problem

1. A user who is not a member of a Canvas board can list, preview and download
   that board's hotspot files and board images from runly.files ("Adjuntos del
   ERP" tab, `GET /files`, signed-url, download, bulk download, Office open).
   The same leak applies to every module that stores attachments in
   `FileAsset`, including personal ones such as `PfmReceipt`.
2. Files uploaded through runly.files "Subir" are visible to the whole company
   without the uploader choosing that.
3. There is no way to hand a file to someone outside the system (view-only or
   download link) with expiry and revocation.

Module attachment screens themselves are not the problem: each module already
gates the record before listing its attachments (e.g. `routes/projects/project-files.js`
relies on `COMPANY` scope inside an already-authorized task).

## 5. Goals

1. Admins keep full read access to every file (unchanged). Keeping the admin
   count low is an operational policy, not enforced by this feature.
2. For non-admin users, every generic runly.files entry point (list, detail,
   signed URL, download, bulk download, rename/disable, Office open/save,
   share management) grants access only when one of these holds:
   a. the user uploaded the file;
   b. the user has an `ACCEPTED` `FileAssetShare` for it;
   c. the file is a runly.files document deliberately shared with the company
      (`accessScope = COMPANY` and origin runly.files);
   d. the file is a module attachment and the owning module's access resolver
      says the user can read the originating record.
3. Module attachments without a registered resolver are visible only to the
   uploader, accepted shares and admins (deny by default).
4. New uploads made through runly.files are `RESTRICTED` by default. The upload
   dialog offers "Compartir con toda la empresa" to opt into `COMPANY`.
5. Existing runly.files-origin files with `accessScope = COMPANY` become
   `RESTRICTED` (private to their uploader) via a forward data migration.
6. The runly.files screen is organized as a personal cloud with tabs
   "Mis archivos", "Compartidos conmigo", "De mis módulos" and, for admins only,
   "Todos".
7. The uploader (or an admin) can create public share links for a file with mode
   "Ver" (inline preview, no download button) or "Descargar", optional expiry
   and max uses, and can revoke them. Links are resolved by token only.
8. Module attachment routes (Projects, Canvas, HR, ...) keep working unchanged.

## 6. Non-goals

1. Changing module-internal attachment routes or their `COMPANY` storage scope.
2. Limiting what admins can read, or adding a metadata-only admin view.
3. Folder hierarchy, quotas, or trash/restore redesign.
4. Password-protected public links.
5. Public links for folders or for multiple files at once.
6. Resolvers for RME3 custom modules (`modules/custom/*`); their attachments fall
   under deny-by-default until a later version exposes a resolver hook.

## 7. User stories

1. As a regular user, I want runly.files to show only my files, files shared with
   me, and attachments from records I can access, so that I do not see other
   teams' private material.
2. As a Canvas board member, I want board attachments to stay visible to every
   member inside Canvas and in "De mis módulos", so that collaboration still works.
3. As a non-member of a board, I want to be unable to open its attachments from
   runly.files, so that board privacy is real.
4. As a user uploading a file in runly.files, I want it private by default and an
   explicit option to share with the company.
5. As a file owner, I want to create a view-only or download link with an expiry,
   see its usage and revoke it, so that I can share with external people safely.
6. As an admin, I want to keep seeing every file in a "Todos" tab, so that I can
   support and clean up the instance.

## 8. UX requirements

1. runly.files tabs (Spanish labels): "Mis archivos", "Compartidos conmigo",
   "De mis módulos", "Invitaciones" (existing), and "Todos" for admins only.
   "Mis archivos" is the default tab. The current "Adjuntos del ERP" tab is
   replaced by "De mis módulos".
2. Rows in "De mis módulos" show the origin ("Canvas · Plano de bodega",
   "Proyectos · Tarea X") with a link "Ir al origen" when the module exposes a
   route for the record.
3. Upload dialog: `CheckboxField` "Compartir con toda la empresa" (unchecked by
   default). File detail shows the current visibility as a badge: "Privado",
   "Compartido", "Toda la empresa", "Del módulo".
4. Share sheet (existing) gains a second section "Enlaces públicos": list of
   links (mode, expiry, uses, status), "Crear enlace" form with `SelectField`
   mode ("Ver" / "Descargar"), `DatePickerField` expiry (optional), `TextField`
   max uses (optional), copy-to-clipboard, and revoke via `ConfirmDialog`.
   The section is only shown to the uploader and admins.
5. Public view page (`/p/files/:token`): minimal page with file name, size,
   inline preview for images/PDF, and a "Descargar" button only in download
   mode. Expired/revoked/exhausted links show an `ErrorState` "Este enlace ya no
   está disponible". No Runly navigation, no login.
6. Follows the modal structure rule (fixed header/footer, scrolling body) and the
   UI-first policy (`@runly/ui` components only, no native dialogs).

## 9. Routes/screens

1. `/files` (runly.files) — `FilesScreen.jsx`, tabs via `?workspace=`
   `mine | shared | modules | invitations | all`.
2. `/p/files/:token` (public, unauthenticated) — new `PublicFileScreen.jsx` in
   `apps/desktop/src/modules/runly.files/screens/`, rendered outside `AppShell`.

## 10. Data model

1. `FileAsset` (existing) — no new columns. `accessScope` keeps the values
   `COMPANY | RESTRICTED`. Origin is derived: runly.files-origin when
   `entityType = 'AtlasFile'` and `moduleKey IN ('runly.files','atlas.files')`;
   module attachment otherwise. The originating record id is
   `metadata.sourceEntityId`.
2. `FileAssetShare` (existing) — unchanged.
3. Public links reuse `ModulePublicLink` (existing) with
   `moduleKey = 'runly.files'`, `resourceKey = 'file'`, `recordId = FileAsset.id`,
   `mode = 'view' | 'download'`, plus existing `expiresAt`, `maxUses`,
   `useCount`, `lastUsedAt`, `revokedAt`, `createdByUserId`, `label`.
   A dedicated files link service owns these rows; it does not go through the
   manifest public-resource resolution used by RME3 modules.
4. Access resolver registry (code, not data):
   `registerFileAccessResolver({ moduleKey, entityTypes, readFilter, canRead })`
   - `readFilter(context)` returns `{ all: true }`, `{ none: true }` or
     `{ sourceEntityIds: string[] }` for list queries;
   - `canRead(context, file)` returns boolean for single-file checks.

## 11. Prisma impact

1. No schema changes.
2. One new forward migration (data only):
   `UPDATE file_asset SET access_scope = 'RESTRICTED' WHERE access_scope = 'COMPANY'
   AND entity_type = 'AtlasFile' AND module_key IN ('runly.files','atlas.files');`
   Existing migrations are not edited.

## 12. API contract

All authenticated routes require a session and company context.

1. `GET /files?workspace=mine|shared|modules|all|...` — `all` returns 403 for
   non-admins. `modules` returns module attachments allowed by resolvers.
   Response shape unchanged (`{ data, pagination }`), rows gain
   `origin: { moduleKey, entityType, sourceEntityId, label, route } | null` and
   `visibility: 'private' | 'shared' | 'company' | 'module'`.
2. `GET /files/:id`, signed-url, download, bulk download, rename, enable/disable,
   Office endpoints — same shapes; return 404 when the file is not readable
   (do not reveal existence), 403 when readable but the operation is not allowed.
3. `POST /files/upload` — new optional field `shareWithCompany` (boolean) honored
   only when origin is runly.files; default `RESTRICTED`.
4. `GET /files/:id/links` — owner/admin; list links.
5. `POST /files/:id/links` — owner/admin; body `{ mode, expiresAt?, maxUses?, label? }`;
   returns `{ id, token, url, mode, expiresAt, maxUses, useCount, status }`.
   400 on invalid mode/expiry in the past; 403 for non-owner.
6. `POST /files/:id/links/:linkId/revoke` — owner/admin; 204.
7. `GET /public/files/:token` — unauthenticated, rate-limited with the existing
   token-bucket limiter; returns `{ name, mimeType, sizeBytes, mode, previewUrl,
   downloadUrl|null }` with short-lived signed URLs (download URL only in
   download mode, `Content-Disposition: attachment`). Increments `useCount`.
   410 when expired/revoked/exhausted or the file is disabled; 404 unknown token.

## 13. SDK contract

`files` domain in `@runly/sdk`:

1. `files.list(params)` — accepts the new `workspace` values.
2. `files.upload(file, { ..., shareWithCompany })`.
3. `files.links.list(fileId)`, `files.links.create(fileId, { mode, expiresAt, maxUses, label })`,
   `files.links.revoke(fileId, linkId)`.
4. `files.public.get(token)` — unauthenticated call.

## 14. Validator contract

`@runly/validators`:

1. `fileShareLinkCreateSchema` — `mode: enum('view','download')`,
   `expiresAt: ISO datetime in the future, optional`, `maxUses: int 1..10000, optional`,
   `label: string max 120, optional`.
2. `filesListQuerySchema` — extend `workspace` enum.

## 15. Module manifest impact

runly.files official manifest: no new permissions; navigation unchanged.
No new module keys or dependencies.

## 16. Navigation impact

N/A — tabs live inside the existing `/files` screen. The public route is not a
navigation item.

## 17. Blueprint impact

N/A.

## 18. RBAC/permissions

1. Existing runly.files permissions keep gating the module screen and routes.
2. Row-level access is enforced by `services/files/access.js` as described in
   Goal 2; admins bypass it (unchanged).
3. Link creation/revocation: uploader or admin only.
4. Resolvers delegate to each module's own rules:
   - `runly.canvas` (`CanvasBoard`, `CanvasHotspot`): board owner/member/share
     per canvas-service.
   - `runly.projects` (`Task`): project membership.
   - `runly.hr` (`HrEmployee`): HR read permission.
   - `runly.contacts` (`Contact`), purchases (`purchase_*`), inventory
     (`InvItem`), fleet (`Fleet*`), growth (`GrowthLead`), generated documents
     (`GeneratedDocument`): the module's read permission.
   - `UserProfile`, `Company`, `BrandingConfig`: company-wide read.
   - `PfmReceipt`: uploader only (no resolver; personal finance).

## 19. Multi-company behavior

All queries keep `entityId = companyId`. Resolvers receive the active company
context and must only return ids in that company. Public links store
`companyId` and resolve the file within it.

## 20. Files/storage impact

No new buckets or object key prefixes. Public links never expose bucket paths;
they return signed URLs (bucket `runly-files`) valid for 5 minutes. Files in the
`runly-website` public bucket keep their public URLs.

## 21. Export/import requirements

N/A.

## 22. Audit log requirements

1. `files.link.create` — actor, `{ fileId, linkId, mode, expiresAt, maxUses }`.
2. `files.link.revoke` — actor, `{ fileId, linkId }`.
3. `files.visibility.change` — actor, `{ fileId, before, after }` when toggling
   "Toda la empresa".

## 23. Edge cases

1. Hotspot file whose hotspot or board was deleted: resolver returns false →
   only uploader/admin see it.
2. User removed from a board after viewing: next list/signed-url request denies;
   previously issued signed URLs expire within their TTL.
3. File owner leaves the company (membership disabled): files remain; admin can
   still see them; existing public links keep working until revoked/expired.
4. File disabled (`enabled = false`): public links return 410.
5. Module attachment shared explicitly via `FileAssetShare`: share grants access
   even without module access (deliberate act of the uploader).
6. Bulk download mixing readable and unreadable ids: reject the whole request
   with 404 rather than silently dropping items.
7. Projects task attachment rule (`RESTRICTED` cannot be attached) still holds.
8. `atlas.files` legacy rows are treated as runly.files origin.
9. Large resolver id sets in list queries: resolvers must return ids filtered by
   company; the list query uses raw SQL `metadata->>'sourceEntityId' = ANY(...)`
   when the set exceeds what a Prisma `OR` handles efficiently.

## 24. Risks

1. Users lose sight of runly.files uploads that were implicitly company-visible.
   Mitigation: release note; owners can re-share with "Toda la empresa"; admins
   still see everything.
2. A module without a resolver hides attachments from the "De mis módulos" tab.
   Mitigation: resolvers for every entry in `ALLOWED_FILE_ENTITY_TYPES` ship in
   this version; a test asserts the registry covers the list.
3. List performance with resolver filters. Mitigation: indexed
   `(moduleKey, entityType, entityId)`; per-request resolver caching.
4. Public link abuse. Mitigation: rate limiting, unguessable tokens (existing
   generator), expiry/max uses, revocation, audit.

## 25. Acceptance criteria

1. Given a non-admin user who is not a member of board B, when they call
   `GET /files?workspace=modules` or `GET /files/:id/signed-url` for a B hotspot
   file, then the file is not listed and the request returns 404.
2. Given a member of board B, when they open "De mis módulos", then B's
   attachments appear with origin "Canvas".
3. Given an admin, when they open "Todos", then every company file is listed.
4. Given a non-admin, when they request `workspace=all`, then the API returns 403.
5. Given a runly.files upload without "Compartir con toda la empresa", when
   another non-admin user lists files, then it is not visible.
6. Given the migration ran, when listing runly.files-origin files that were
   `COMPANY`, then they are `RESTRICTED` and only visible to their uploader,
   shares and admins.
7. Given an owner creates a "view" link, when an anonymous visitor opens it, then
   the preview renders and no download URL is returned.
8. Given a revoked or expired link, when opened, then the API returns 410 and the
   page shows "Este enlace ya no está disponible".
9. Given a non-owner non-admin, when they call `POST /files/:id/links`, then 403.
10. Given a Projects task attachment, when a project member opens the task, then
    the attachment still lists (module routes unchanged).
11. Given a `PfmReceipt` file, when another non-admin user lists "De mis
    módulos", then it is not visible.

## 26. Verification plan

1. `node --test apps/api/src/services/__tests__/` — new focused tests for
   `access.js` (resolver allow/deny, deny-by-default, admin bypass, workspace=all
   403), the canvas resolver, and the files link service (create/revoke/expiry/
   max uses/view mode hides download).
2. `node --test apps/api/src/routes/projects/` and canvas tests — module
   attachment routes unchanged.
3. Registry coverage test over `ALLOWED_FILE_ENTITY_TYPES`.
4. `pnpm lint` and `pnpm build:web`.
5. Manual check against the running dev server with two non-admin users and one
   admin: Canvas board membership scenario, upload privacy, public link in a
   private browser window.

## 27. Rollback plan

1. Code rollback restores the previous `access.js` behavior.
2. The data migration is one-way in effect (we cannot know which rows were
   `COMPANY` before). Before running it, the migration copies affected ids into
   `InstanceConfig` key `files.access_model.migrated_company_ids` so a follow-up
   forward migration can restore `COMPANY` if required.
3. Public link rows can stay; with the code reverted they are inert.

## 28. Future enhancements

1. Resolver hook for RME3 custom modules (`defineRunlyModule` `fileAccess`).
2. Password-protected and domain-restricted public links.
3. Folder sharing and multi-file links.
4. Admin storage dashboard (metadata, quotas, cleanup).
5. Notification to owners when a public link is used for the first time.
