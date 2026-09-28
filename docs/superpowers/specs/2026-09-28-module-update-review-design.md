# Module updates: review (validation + structure plan) and React preview before applying

Date: 2026-09-28
Status: Approved design (product owner, Module Builder session)
Builds on: `2026-09-28-rme3-builder-advanced-mode-design.md`

## 1. Goal

Uploading a module ZIP becomes review -> preview -> apply, from the Builder
editor (developer mode, "Subir actualización") and from Módulos > Subir módulo.

## 2. API

- `POST /modules/:key/upload/check` (`core.modules.upload`, multipart `file`):
  stages the package (same validation as the real upload), runs the same
  preflight as publish (dependencies + schema migration plan against the
  installed module) and, when `components/index.js` exists, builds a preview
  bundle into `<modulesDir>/.previews/<key>/<previewId>/`. Nothing is
  installed; the staging dir is always removed. Response (`module-update-report.js`):
  `{ blocked, blockers[], changes[], warnings[], currentVersion, nextVersion,
  versionNotIncreased, noChanges, installed, inspection, customViews[],
  preview: { id } | { error } | null }` with Spanish texts. Blockers mirror
  publish exactly: schema drift, schema changes that cannot be auto-applied,
  missing required dependencies; an invalid package returns `blocked` with the
  validation error instead of a 4xx.
- `GET /modules/:key/preview/:previewId/bundle.js`: serves the preview bundle
  (no auth header possible with `import()`; the previewId is a random UUID and
  previews expire after 1 hour, cleaned on the next check).

## 3. UI

`ModuleUpdateReview` (runly.core): pick ZIP -> report (version, blockers,
structure changes, warnings) -> "Pantallas React" preview (loads the preview
bundle into a temporary component registry and renders each CUSTOM view with
the real session props inside an error boundary; data comes from the
currently installed API) -> "Aplicar actualización" (existing upload, disabled
while blocked). Used by the editor's "Subir actualización" sheet and by
UploadModuleSheet.

## 4. Out of scope

Live reload while coding, previewing `api/` changes.
