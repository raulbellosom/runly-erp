# Files Access Model — Implementation Plan

Spec: `docs/superpowers/specs/2026-10-01-files-access-model-design.md` (Approved 2026-10-01).

Agent mode: single agent, inline execution (user asleep; authorized to finish and commit).

## Decisions taken during planning

1. Module-internal attachment routes keep using `files/access.js` (`readWhere`,
   `assertAccess`) unchanged. The new resolver-based check lives in a separate
   `files/visibility.js` used only by the generic runly.files entry points
   (`files-service.js`: list, getById, signed URL, batch signed URLs, bulk
   download, rename/enable/delete/cover/reorder via `ensureFileBelongsToCompany`).
2. Resolvers are keyed by `FileAsset.entityType` (unique across modules today):
   `company` (any member), `permission` (module read permission), `records`
   (membership-derived source ids: Canvas boards/hotspots, Project tasks),
   `owner` (uploader only: `PfmReceipt`). Unknown entity types fall back to
   uploader/shares/admin.
3. `workspace=all` for non-admins returns the union of everything they can read
   (instead of 403) because internal callers such as the relation-target picker
   list files without a workspace. Admins get every company file.
4. Public file links reuse `module_public_link` with `moduleKey = runly.files`,
   `resourceKey = file.share`; served by a path-scoped public router
   (`/public/files/:token`) modelled on `routes/canvas/canvas-public.js`.
5. Data migration converts runly.files-origin `COMPANY` rows to `RESTRICTED`,
   saving the affected ids in `instance_config` for a possible restore.

## Tasks

1. `services/files/visibility.js` — rules table, `listWhere(context)`,
   `canRead(file, context)`, `describe(file)`; unit tests.
2. `files-service.js` — wire visibility into list/getById/signed URLs/bulk;
   workspaces `mine | shared | modules | documents | all`; `shareWithCompany` on
   upload; rows carry `origin` + `visibility`.
3. `services/files/public-links.js` + routes (`GET/POST /files/:id/links`,
   `POST /files/:id/links/:linkId/revoke`, `GET /public/files/:token`); audit
   `files.link.create` / `files.link.revoke`; tests.
4. Prisma forward data migration.
5. SDK + validators (`fileShareLinkCreateSchema`).
6. Desktop: tabs (Mis archivos / Compartidos conmigo / De mis módulos /
   Invitaciones / Todos for admins), upload "Compartir con toda la empresa",
   visibility badge, public links section in the sharing dialog, public page
   `/p/files/:token` and `/app/p/files/:token`.
7. Verification: `node --test` for files/canvas/projects suites, `pnpm lint`,
   `pnpm build:web`; commit.
