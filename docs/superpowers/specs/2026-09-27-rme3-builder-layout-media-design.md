# RME3 Module Builder — layout designer (tabs, sections, hero) and media fields (upload, camera, attachments)

Date: 2026-09-27
Status: Approved design (brainstorming session with the product owner)
Plan: `docs/superpowers/plans/2026-09-27-rme3-builder-layout-media-plan.md` (to be written)

## 1. Goal

Modules built with the No-Code Module Builder today always compile to one
form section and one detail section containing every field, opened in a
modal (unless the heuristic in `shouldUsePageMode` kicks in). File fields
render a dropzone that stores a browser `File` object and never uploads it.

This spec makes builder-made modules produce richer screens:

1. A per-entity **layout** (tabs → sections → fields) shared by the form and
   the detail, with a detail hero, KPI strip, two-column option, and an
   explicit page-vs-modal mode.
2. **Media**: `file` fields that really upload to runly.files, optionally
   restricted to images and captured from the camera, plus an **attachments
   section** backed by generic, module-scoped file endpoints.

Out of scope (later sub-projects): related-record tabs in the detail,
separate form/detail layouts, conditional visibility rules for sections.

## 2. What already exists (reuse, do not rebuild)

- `RunlyForm` / `RunlyDetail` render `schema.sections` with `columns`,
  `type: 'attachments'` sections (`AttachmentsPanel`), and aside placement.
- `RunlyDetail` renders `schema.hero`, `schema.kpis` and
  `schema.layout: 'two-column'` (`detail-presentation.js`).
- `resolveFormMode` / `shouldUsePageMode` (`renderer-adapters.js`) honor an
  explicit `page` / `sheet` mode.
- `FileAsset` already stores `moduleKey`, `entityType`, `entityId`.
- `ImageSourceSheet` (camera vs gallery on touch devices), `ImageAssetCell`
  (signed thumbnail + viewer), `useAttachmentsController`.
- RME3 `file` column is `UUID` (`field-types.js`).

Missing: tabs in both renderers, a real uploading file field, camera capture
on desktop, module-scoped file endpoints, and builder UI + compiler output.

## 3. Contract — `entity.layout` in the ModuleDefinition

Optional. When absent, compiler output is byte-for-byte what it is today.

```js
layout: {
  mode: 'auto',                       // 'auto' | 'page' | 'sheet'
  tabs: [
    {
      key: 'general',                 // identifier, unique within the entity
      label: 'General',
      sections: [
        { key: 'datos', label: 'Datos', columns: 2, fields: ['nombre', 'foto'] },
        { key: 'docs', type: 'attachments', label: 'Documentos', placement: 'embedded' },
      ],
    },
  ],
  detail: {
    hero: { titleField: 'nombre', subtitleFields: ['codigo'], statusField: 'estado', imageField: 'foto' },
    kpis: [{ field: 'monto', label: 'Monto' }],
    twoColumn: false,
  },
}
```

Rules:

- `tabs` length 1–8. With exactly one tab, no tab bar is rendered (the
  single tab's sections render as plain sections).
- Section `type` is `fields` (default) or `attachments`. `columns` ∈ {1,2,3},
  default 2. `placement` (attachments only) ∈ {`embedded`, `aside`}.
- Every field key appears at most once across the layout
  (`LAYOUT_DUPLICATE_FIELD`) and must exist on the entity
  (`LAYOUT_FIELD_NOT_FOUND`).
- Entity fields not placed anywhere are appended by the compiler to a final
  section "Otros datos" in the last tab, so a field can never silently
  disappear (warning `LAYOUT_UNPLACED_FIELDS`, not an error).
- At most one attachments section per entity (`LAYOUT_MULTIPLE_ATTACHMENTS`).
- `hero.titleField` required when `hero` is present; `hero.imageField` must be
  a `file` field with `accept: 'image'`; `statusField` must be `select`.
- `kpis` max 4; fields must be `number`, `decimal`, `date`, `datetime` or
  `select`.
- Labels follow the same `UNSAFE_SOURCE_TEXT` rule as other labels.
- Keys follow `IDENTIFIER`.

### File field options

The `file` field type gains:

| Option | Values | Default |
|---|---|---|
| `accept` | `image` \| `document` \| `any` | `any` |
| `camera` | boolean (only valid with `accept: 'image'`) | `false` |
| `maxSizeMB` | 1–50 | 10 |

Invalid combinations: `FILE_CAMERA_REQUIRES_IMAGE`, `FILE_MAX_SIZE_OUT_OF_RANGE`.

## 4. Compiler (`@runly/module-compiler`)

- `validateModuleDefinition` validates `entity.layout` and file options
  (new `layout.js` module to keep `definition.js` small).
- `normalizeModuleDefinition` keeps `layout` and file options.
- `generateFormView` / `generateDetailView` (split into a new
  `templates/layout-views.js` if `views.js` would exceed ~300 lines):
  - With a layout: emit `schema.tabs` (array of `{ key, label, sections }`)
    when there are 2+ tabs, otherwise `schema.sections`.
  - Form: `formMode` from `layout.mode` when not `auto`.
  - Detail: `hero`, `kpis`, `layout: 'two-column'` when `twoColumn`.
  - File fields emit `{ type: 'file', accept, camera, maxSizeMB, filesPath }`
    in the form and `{ type: 'file-asset', accept, filesPath }` in the detail.
  - Attachments sections emit the `attachments` config for
    `AttachmentsPanel` pointing at the module-scoped endpoints (section 5).
- Table view: `file` fields with `accept: 'image'` emit `type: 'image-asset'`
  columns with the module-scoped signed-url template.
- No layout: output unchanged (regression test with a snapshot of today's
  output).

## 5. API — module-scoped files

### `moduleContext.files` (route loader)

`route-loader-service.js` injects a capability bound to the module's own key,
next to `notifications` and `cleanup`:

```js
files: {
  upload(c, { file, entityType, entityId }),      // -> FileAsset (moduleKey forced)
  list(c, { entityType, entityId }),              // -> FileAsset[]
  link(c, { fileId, entityType, entityId }),      // sets entity_id on an unlinked asset of this module
  unlink(c, { fileId, entityType, entityId }),    // clears entity_id; the asset itself stays in runly.files
  signedUrl(c, { fileId, entityType }),           // -> { url }
}
```

Every call resolves the tenant from the request context, forces
`moduleKey` to the bound key, and rejects assets belonging to another company,
another module, or another `entityType`. It reuses `filesService`; it does not
require `files.assets.*` permissions (the generated route's entity
permission is the gate).

### Generated routes (per entity, only when the entity has a `file` field or an attachments section)

| Route | Permission |
|---|---|
| `POST /<slug>/<entities>/files` (multipart, unlinked upload for new records and `file` fields) | `<slug>.<entity>.create` or `.update` |
| `GET /<slug>/<entities>/:id/files` | `.read` |
| `POST /<slug>/<entities>/:id/files` (link an uploaded asset) | `.update` |
| `DELETE /<slug>/<entities>/:id/files/:fileId` | `.update` |
| `GET /<slug>/<entities>/files/:fileId/signed-url` | `.read` |

Create and update in the generated service call `files.link` for every `file`
field value that is set, so single-file fields end up associated to the
record too. Upload size is enforced server-side against `maxSizeMB` from
the manifest.

## 6. Runtime UI (`@runly/ui`)

### Tabs

- New pure helper `resolveSchemaTabs(schema)` in `runly-renderer/`:
  returns `[{ key, label, sections }]` from either `schema.tabs` or
  `schema.sections` (single implicit tab). Both renderers use it.
- `RunlyForm`: renders a tab bar when there are 2+ tabs; all tabs stay
  mounted (hidden) so React Hook Form keeps every value. On submit with
  validation errors, the first tab containing an error becomes active and
  tabs with errors show an error indicator.
- `RunlyDetail`: hero and KPIs render above the tab bar; each tab renders
  its sections with the existing section shell and two-column split.
- `formMode: 'page'` opens create/edit/detail as full pages with their own
  URL (existing page-mode path in `BlueprintCrudScreen`).

### `FileAssetField` (new, in `packages/ui/src/components/`)

- Form field for `type: 'file'`. Value is a `fileAssetId` string.
- On pick: uploads immediately to `filesPath` (`POST .../files`), shows
  progress, stores the returned id. Shows thumbnail (image) or file chip
  (document) with replace/remove.
- `accept: 'image'` restricts the picker to `image/*`; `document` to common
  document MIME types.
- `camera: true`:
  - Coarse pointer (touch): opens `ImageSourceSheet` (camera or gallery).
  - Fine pointer (desktop): offers "Tomar foto", which opens a new
    `CameraCaptureDialog` (`getUserMedia`, preview, capture to JPEG, retake,
    confirm). If no camera or permission is denied it shows an inline error
    and falls back to the file picker.
- `maxSizeMB` checked client-side before upload (server also enforces it).
- Exported from `packages/ui/src/index.js` and documented in
  `docs/ai-context/rme3-runtime-capabilities.md`, together with
  `CameraCaptureDialog`.

### Detail rendering of file fields

`type: 'file-asset'`: image → `ImageAssetCell`-style thumbnail with viewer;
document → chip with name and download via the signed-url route.

## 7. Builder UI (`apps/desktop/src/modules/runly.core/components/builder/`)

- The entity card gains a "Diseño" action that opens a `LayoutDesignerSheet`
  (header and footer fixed, only the middle scrolls).
- Left: tree of tabs → sections → fields. Add, rename, delete and reorder
  tabs, sections and fields with drag and drop, plus up/down buttons as an
  accessible alternative. Each section has a columns selector (1/2/3);
  "Agregar sección de documentos" adds the attachments section.
- "Campos sin colocar" list shows entity fields not in any section; they can
  be dragged into a section.
- Right panel "Detalle": hero (título, subtítulo, estado, imagen), KPIs
  (up to 4), "Dos columnas", and "Modo de apertura": Automático / Página
  completa / Modal.
- "Vista previa" uses the existing `PreviewSheet` rendering the real
  `RunlyForm` and `RunlyDetail` with sample data.
- `FieldSheet`: for `file` fields, shows "Tipo de archivo" (Imagen /
  Documento / Cualquiera), "Permitir cámara" (only for Imagen) and
  "Tamaño máximo (MB)".
- Compiler diagnostics for layout errors surface in the existing
  `DiagnosticsPanel` with the section/field path.
- All new files stay under 400 lines; reuse `@runly/ui` components
  (`Sheet`, `SelectField`, `CheckboxField`, `TextField`, `ConfirmDialog`).

## 8. Error handling

- Compiler: all layout/file problems are diagnostics; publish is blocked on
  errors, allowed with the unplaced-fields warning.
- Upload failures: field shows the API error in Spanish, keeps the previous
  value.
- Camera: permission denied / no device → inline message
  "No se pudo acceder a la cámara" and file picker fallback.
- Endpoints return 404 for assets of another company/module/entity type
  (no existence leak), 413 for oversize uploads.

## 9. Testing

- Compiler (`node --test`): layout validation codes, unplaced fields
  appended, tabs vs sections emission, hero/kpis/mode emission, file options
  validation, attachments config, and a no-layout regression against today's
  output.
- UI (pure): `resolveSchemaTabs`, first-error-tab selection helper.
- API: `moduleContext.files` scoping — wrong company, wrong module, wrong
  entity type rejected; link only unlinked assets of the same module.
- Manual: build a module with 2 tabs, hero image with camera, attachments
  section; publish; create a record uploading a photo from the webcam and a
  document; verify detail tabs, hero, thumbnails and attachments.

## 10. Backward compatibility

- Entities without `layout` compile exactly as today.
- Existing records whose `file` column is null are unaffected; no data
  migration.
- Hand-written RME3 modules using `schema.sections` keep working because
  `resolveSchemaTabs` treats them as a single tab.
