# RME3 Module Builder — code extensions kept by the Builder, and leaving developer mode

Date: 2026-09-28
Status: Approved design (product owner, Module Builder session)
Builds on: `2026-09-28-rme3-builder-advanced-mode-design.md`, `2026-09-28-module-update-review-design.md`

## 1. Goal

- **Mixed mode (B)**: a Builder module can carry hand-written React screens
  without leaving visual editing. The Builder stores them and re-emits them on
  every publish.
- **Leave developer mode (A)**: "Volver al modo visual" keeps whatever is
  extension-compatible, lists what would be lost, offers a backup, confirms.

## 2. Extensions contract (`definition.extensions`)

```js
extensions: {
  files: [{ path: 'components/Panel.jsx', content: '...' }],   // components/** (.js .jsx .css .json .svg) and views/<name>.custom.js
  views: [{ file: 'views/panel.custom.js' }],                  // listed in the manifest `views`
  navigation: [{ label, path, icon, permissionKey }],          // appended to the manifest navigation
}
```

Validation: safe relative paths only, unique, text, 1.5 MB total; every view
file must be a `views/<name>.custom.js` present in `files`; navigation paths
stay inside `/app/m/<moduleKey>/`, permission keys must be module permissions.
`compileModule` emits the files verbatim and appends views/navigation to the
generated manifest.

## 3. Classifying a package against the Builder

`classifyPackage({ key, files, manifest })` (module-compiler, pure): reads the
package's `.module-definition.json`, compiles it **without** extensions, and
compares:

- generated files must be byte-identical (EOL-normalized); missing or
  modified ones are "foreign";
- extra files are extensions when they match the extension paths, else foreign;
- manifest (loaded object): models and permissions must match; extra `views`
  entries must be extension view files; extra navigation entries (by path)
  are extension navigation; removed generated entries are foreign.

Result: `{ managed, extensions, foreign[] }`. No `.module-definition.json` or
an invalid one => `managed: false`.

## 4. API

- Upload apply (`POST /modules/:key/upload`), for a module with an attached
  Builder project and a changed package: `managed && !foreign.length` =>
  capture extensions into the project draft, and record the installed state
  (`publishedDefinition` = embedded definition + extensions, `publishedVersion`
  = manifest version, `publishedAt`); otherwise detach (developer mode).
  Response: `builderKept` or `builderDetached` + reasons.
- Upload check report gains `builder: { action: 'keep'|'detach'|'none', reasons[], extensions }`.
- `POST /module-builder/projects/:id/reattach` `{ confirm }`: classifies the
  installed package; nothing lost => captures extensions and reattaches;
  otherwise 409 with `lost[]` unless `confirm: true` (then captures what is
  compatible and reattaches).
- `GET /module-builder/projects/:id/installed-package`: ZIP of the installed
  package (backup before leaving developer mode).

## 5. UI

- Vistas tab: "Pantallas propias (código)" lists extension views/navigation
  with "Quitar" (removes the view, its navigation and view file).
- Update review: explains whether the Builder keeps working or switches to
  developer mode, and why.
- Developer mode dialog: copy explains mixed mode; when detached, "Volver al
  modo visual" (backup download + loss list + confirm).

## 6. Out of scope

Editing extension code inside Runly, extensions outside `components/` and
custom views (api/, models) — those still require developer mode.
