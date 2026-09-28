# RME3 Builder layout + media — Implementation Plan

> **For agentic workers:** executed inline (superpowers:executing-plans). Steps use checkbox syntax.

**Goal:** Builder-made modules get tabs/sections/hero/KPIs/page-mode screens and real file fields (upload, camera, attachments).

**Spec:** `docs/superpowers/specs/2026-09-27-rme3-builder-layout-media-design.md`

**Architecture:** `entity.layout` in the ModuleDefinition is validated in a new compiler module and emitted into the existing FORM/DETAIL schema shapes. Tabs are emitted as flat `sections` each carrying `tab: '<key>'` plus a `tabs: [{ key, label }]` list, so every existing consumer of `schema.sections` (field extraction, page-mode heuristic, normalizers) keeps working; renderers only group by `tab`. Files use a module-bound `moduleContext.files` capability injected by the route loader, reached through generated module routes gated by entity permissions.

**Tech stack:** Node test runner, Hono, Prisma (`fileAsset`), React + Radix Tabs (`@runly/ui` `Tabs`), `getUserMedia`.

## Spec deviations (decided while reading code)

1. `FileAsset.entityId` stores the **companyId**; the record id lives in `metadata.sourceEntityId` (same as HR employee documents). "Link" = set `metadata.sourceEntityId`; attachment remove = disable the asset (`enabled: false`), matching HR's `DELETE /files/:docId`.
2. `filesService.upload` caps uploads at 10 MB, so `maxSizeMB` range is 1–10.
3. Tabs are emitted as `sections[].tab` + `tabs[]` (not nested `tabs[].sections`), see Architecture.

## File map

| File | Responsibility |
|---|---|
| `packages/module-compiler/src/layout.js` (new) | validate `entity.layout` + file options; `resolveEntityLayout(entity)` fills unplaced fields |
| `packages/module-compiler/src/definition.js` | call layout validation; keep `layout` in normalization |
| `packages/module-compiler/src/templates/layout-views.js` (new) | form/detail section + hero/kpi emission when a layout exists; file field props |
| `packages/module-compiler/src/templates/views.js` | delegate to layout-views when layout present; image-asset table columns |
| `packages/module-compiler/src/templates/file-routes.js` (new) | generated `/files` routes per entity |
| `packages/module-compiler/src/templates/routes.js`, `service.js` | mount file routes; link file fields after create/update |
| `apps/api/src/services/module-files-service.js` (new) | `createModuleFilesCapability({ prisma, filesService })(moduleKey)` |
| `apps/api/src/services/route-loader-service.js`, `apps/api/src/index.js` | inject `moduleContext.files` |
| `packages/ui/src/runly-renderer/schema-tabs.js` (new) | `resolveSchemaTabs`, `tabOfSection`, `firstTabWithError` |
| `packages/ui/src/runly-renderer/SchemaTabBar.jsx` (new) | tab bar with error dots |
| `packages/ui/src/runly-renderer/RunlyForm.jsx`, `RunlyDetail.jsx`, `runly-form-schema.js` | preserve `tab`, render tab bar, filter/hide sections |
| `packages/ui/src/components/FileAssetField.jsx`, `CameraCaptureDialog.jsx` (new) | uploading file field + webcam capture |
| `apps/desktop/.../builder/LayoutDesignerSheet.jsx`, `LayoutTree.jsx`, `LayoutDetailPanel.jsx` (new) | builder "Diseño" |
| `apps/desktop/.../lib/layoutHelpers.js` (new) | pure layout editing ops |
| `apps/desktop/.../builder/FieldSheet.jsx`, `EntityCard.jsx` | file options; "Diseño" entry |

## Tasks

### Task 1: Compiler — layout contract
- [ ] Tests in `packages/module-compiler/src/__tests__/layout.test.js`: duplicate field, unknown field, >1 attachments, bad columns, hero image not image-file, KPI type, camera without image, maxSizeMB out of range, unplaced fields appended to "Otros datos" in last tab, valid layout passes, normalization keeps layout.
- [ ] Implement `layout.js` (`validateEntityLayout(entity, basePath, errors, warnings)`, `validateFileFieldOptions`, `resolveEntityLayout`), wire into `validateModuleDefinition` and `normalizeModuleDefinition`.
- [ ] `node --test packages/module-compiler/src/__tests__/` green. Commit.

### Task 2: Compiler — view emission
- [ ] Tests: with layout → form schema has `tabs` (2+ tabs) and sections with `tab`, `columns`, `formMode`; detail has `hero`, `kpis`, `layout: 'two-column'`; attachments section config uses module endpoints; file fields emit `accept/camera/maxSizeMB/filesPath` (form) and `file-asset` (detail); table image-asset column. No layout → generated files identical to before (compare against `generateFormView` output captured from a fixture without layout).
- [ ] Implement `templates/layout-views.js` emitting JSON via `JSON.stringify` (safe literals), delegate from `views.js`.
- [ ] Tests green. Commit.

### Task 3: Compiler — generated file routes + service linking
- [ ] Tests: entity with a file field/attachments emits `api/<entity>-file-routes.js` (node `--check`-parseable, routes + permissions present) and `<entity>-routes.js` mounts it; service create/update call `moduleContext.files.link` for set file fields; entity without files unchanged.
- [ ] Implement `templates/file-routes.js`; routes template mounts it; pass `moduleContext` to service factory for linking (routes call link after create/update, keeping the service pure SQL).
- [ ] Tests green. Commit.

### Task 4: API — `moduleContext.files`
- [ ] Tests `apps/api/src/services/__tests__/module-files-service.test.js` with a fake prisma + fake filesService: upload forces moduleKey; list filters module/entityType/company/sourceEntityId/enabled; link rejects other company/module/entityType and assets already linked to another record; remove disables; signedUrl rejects foreign assets (404 error).
- [ ] Implement service; inject in route loader (`filesCapability` option) and `index.js`.
- [ ] Tests green. Commit.

### Task 5: UI — tabs in renderers
- [ ] Tests `packages/ui/src/runly-renderer/__tests__/schema-tabs.test.js`: `resolveSchemaTabs` (none/1/2+ tabs, sections without tab go to first tab), `firstTabWithError`.
- [ ] Implement helper + `SchemaTabBar`; `runly-form-schema.js` and `RunlyDetail` normalization keep `tab`; RunlyForm keeps all tabs mounted (hidden), switches to first error tab on invalid submit; RunlyDetail renders hero/KPIs above tabs.
- [ ] Tests + `pnpm build:web` green. Commit.

### Task 6: UI — media fields
- [ ] `CameraCaptureDialog` (getUserMedia, capture JPEG, retake, confirm, error fallback, stops stream on close).
- [ ] `FileAssetField` (upload to `filesPath`, progress, preview via signed url, replace/remove, accept filter, maxSizeMB, camera: ImageSourceSheet on coarse pointer / dialog on fine pointer).
- [ ] RunlyForm `case "file"` uses FileAssetField when `field.filesPath` is set (else legacy dropzone); RunlyDetail renders `file-asset` thumbnails/chips. Export from `index.js`, document in `rme3-runtime-capabilities.md`.
- [ ] `pnpm build:web` green. Commit.

### Task 7: Builder UI
- [ ] Tests `apps/desktop/src/modules/runly.core/lib/__tests__/layoutHelpers.test.js`: create default layout from fields, add/rename/remove tab/section, move field (between sections, reorder), unplaced fields, remove field keys that no longer exist.
- [ ] Implement `layoutHelpers.js`, `LayoutDesignerSheet` (fixed header/footer), `LayoutTree` (SortableList drag + up/down), `LayoutDetailPanel` (hero, KPIs, twoColumn, mode); "Diseño" action in EntityCard; FieldSheet file options.
- [ ] Preview renders the compiled form/detail. `pnpm build:web` + lint green. Commit.

### Task 8: Verification + docs
- [ ] Full `node --test` for module-compiler, module-engine, api services, ui renderer, builder lib; `pnpm lint`; `pnpm build:web`.
- [ ] Update `docs/TASKS.md` with verification evidence.
