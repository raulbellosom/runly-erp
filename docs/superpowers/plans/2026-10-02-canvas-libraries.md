# Canvas Libraries — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Personal/company libraries of reusable elements: import `.excalidrawlib`, SVG and ZIP-of-SVG; save the selection; insert by click or drag.

**Spec:** `docs/superpowers/specs/2026-10-02-canvas-libraries-design.md`

**Rules:** JavaScript only; UI Spanish, code English; no emojis; `@runly/ui` (check real props); never start/stop dev servers; **do not run `pnpm db:migrate` / `prisma migrate` against any database** — write the migration and run `pnpm db:generate` only; applied migrations are immutable, so only add a new folder; no file over 800 lines (`canvas-service.js` ~680: libraries go in a new `canvas-libraries.js` service); tests with explicit globs; `npx eslint <touched files>` clean; stage only your own files (another session commits concurrently). Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Schema, migration, service, routes, SDK

**Files:** `prisma/schema.prisma` (+ `CanvasLibrary`, `CanvasLibraryItem`, back-relations on `Company`, `UserProfile`, `FileAsset` as required by Prisma), `prisma/migrations/20261002120000_canvas_libraries/migration.sql`, `apps/api/src/routes/canvas/canvas-libraries.js` (+ `__tests__/canvas-libraries.test.js`), `canvas-routes.js`, `apps/api/src/services/files-service.js` (add `"CanvasLibrary"` next to `"CanvasBoard"` in the module-entity list), `packages/sdk/src/domains/canvas.js`.

- [ ] **Step 1: Migration** — mirror the style of `prisma/migrations/20261001120000_runly_canvas_foundation/migration.sql` (uuidv7 defaults, FKs, CHECKs, indexes, `REVOKE ALL ... FROM anon, authenticated`) for the two tables in the spec §10. Map Prisma models with `@@map`/`@map` exactly like the existing Canvas models. Run `pnpm db:generate` (must succeed).
- [ ] **Step 2: Failing service tests** (mock Prisma like `canvas-service.test.js`) covering: list returns personal-owned + company libraries with `canEdit` (owner for personal; `canManage` flag for company); creating a COMPANY library without manage → 403; adding items validates objects via `validateCanvasObject` (bad object → 400), rejects `image` items whose file is not `runly.canvas/CanvasLibrary/<libraryId>` → 400, caps 500 items and 300 objects per item; deleting a library disables its image `FileAsset`s and writes `LIBRARY_DELETED` audit.
- [ ] **Step 3: `createCanvasLibrariesService({ prisma })`** — functions `list(companyId, actorId, { canManage })`, `items(companyId, actorId, libraryId)`, `create`, `update`, `remove`, `addItems`, `renameItem`, `removeItem`. Access helper loads the library by `id` + `companyId` (404 otherwise; personal libraries of other users → 404). `canManage` comes from the route (whether the caller has `canvas.manage`): read how `requirePermission`/user context exposes permissions in `canvas-routes.js` or `apps/api/src/index.js` and reuse it (e.g. a helper that checks the permission set in `c.get('userContext')`); do not invent a new permission system.
- [ ] **Step 4: Routes** under `/canvas/libraries` per spec §12, using `errorResponse`. Route tests with a stubbed service (forwarding of company/actor/ids and `canManage`).
- [ ] **Step 5: SDK** methods per spec §13.
- [ ] **Step 6:** `node --test apps/api/src/routes/canvas/__tests__/*.test.js`, `node --check apps/api/src/index.js`, eslint. Commit — `feat(canvas): libraries schema, service and API`

---

### Task 2: Import converters (pure, tested)

**Files:** Create `apps/desktop/src/modules/runly.canvas/lib/libraryImport/excalidraw.js`, `svg.js`, `normalize.js` (+ tests for each).

- [ ] **Step 1: `normalize.js`** — `normalizeObjects(objects)` → `{ objects, width, height }` translating so the bounding box (use `sceneBounds` from the renderer module or `objectBounds` from geometry) starts at (0,0), stripping `id`, `pageId`, `layerId`, `revision`, `position`, `pending`, `hotspot`, timestamps; `placeObjects(item, origin)` → objects translated to `origin` with original relative order.
- [ ] **Step 2: `excalidraw.js`** — `parseExcalidrawLibrary(json)` → `{ items: [{ name, objects }], skipped }` supporting v1 (`library: Element[][]`, names "Elemento N") and v2 (`libraryItems: [{ name, elements, status }]`). Element mapping (skip `isDeleted`):
  - `rectangle` → `rectangle` (`radius` 8 when `roundness` set, else 0);
  - `ellipse` → `ellipse`;
  - `diamond` → `polygon` with diamond points and `properties.shape: 'diamond'`;
  - `line`/`arrow` with `points` (relative to `x,y`) → one `line` per consecutive pair; for `arrow` the last segment is `arrow` when `endArrowhead` is truthy (else `line`);
  - `freedraw` → decimate to ≤ 40 points, then line segments;
  - `text` → `text` (`properties.text`, `style.fontSize`, `style.textColor` = `strokeColor`, width = element width);
  - others (`image`, `frame`, `embeddable`…) → skipped.
  Style: `stroke` = `strokeColor` (or `strokeWidth: 0` when `transparent`), `fill` = `backgroundColor` unless `transparent` (then `'none'`), `fillOpacity` 1 for `solid`, 0.35 for `hachure`/`cross-hatch`, `strokeWidth`, `dash` from `strokeStyle` (`dashed`/`dotted`), `opacity` = `opacity/100`; rotation = `angle` radians → degrees. Each produced object must pass `validateCanvasObject` (import it in the test from the API like `objectFactory.test.js` does). Tests: v1 and v2 parsing, rectangle+3-point arrow → 1 rect + 2 segments with the last an `arrow`, transparent colours, skipped count.
- [ ] **Step 3: `svg.js`** — pure `svgSize(text)` (width/height attributes in px or unitless; else `viewBox`; else 64×64) and `sanitizeSvgText(text, parser = new DOMParser())` that removes `script`, `foreignObject`, `iframe`, `object`, `embed`, every `on*` attribute and any `href`/`xlink:href` not starting with `#` or `data:image/`, returning the serialized SVG (throws `Error('El SVG no es válido.')` on parse errors). Tests cover `svgSize` only (DOMParser is browser-only); note that in the test file.
- [ ] **Step 4:** tests, eslint. Commit — `feat(canvas): Excalidraw and SVG library import converters`

---

### Task 3: Library panel, import flow, save selection, insert

**Files:** Create `components/library/LibraryPanel.jsx`, `components/library/LibraryItemTile.jsx`, `components/library/SaveToLibraryDialog.jsx`, `hooks/useLibraries.js`; modify `components/CanvasToolbar.jsx`, `components/CanvasContextMenu.jsx`, `components/inspector/*` (button "Guardar en biblioteca"), `screens/BoardEditor.jsx` (keep < ~400 lines), `hooks/useBoardEditorActions.js` (insert helpers), help `overview.md`; add `jszip` to the desktop app (`pnpm --filter ./apps/desktop add jszip`, dynamic import).

- [ ] **Step 1: Hooks** (`useLibraries.js`): queries `['canvas', 'libraries']` and `['canvas', 'libraries', id, 'items']`; mutations for create/update/delete library, add/rename/delete items (invalidate on success).
- [ ] **Step 2: Import flow** — `importFiles(files, targetLibraryId | null)`: group by type; `.excalidrawlib`/`.json` → `parseExcalidrawLibrary` → items `{ name, kind: 'objects', payload: normalizeObjects(objects), width, height }`; `.svg` → sanitize → upload (`FormData`, `moduleKey runly.canvas`, `entityType CanvasLibrary`, `entityId libraryId`, as a `File` with `image/svg+xml`) → item `{ kind: 'image', fileAssetId, width, height, name: file name without extension }`; `.zip` → `jszip` → its `.svg` entries (≤ 300, ≤ 2 MB each) as above, others skipped. When no target library: create one named after the first file (scope PERSONAL, source by type). Batch `addLibraryItems` in chunks of 200. Toast summary "Se importaron N elementos (M omitidos)". Errors per file are counted as skipped, not fatal.
- [ ] **Step 3: Panel** — `Sheet` right with fixed header (title "Biblioteca", `SearchInput` filtering item names across libraries, buttons "Nueva" and "Importar" with a hidden multi file input `accept=".excalidrawlib,.json,.svg,.zip"`), body `Accordion` per library (badge Empresa/Personal, count, `DropdownMenu`: Renombrar (small dialog), Cambiar a Empresa/Personal (only if allowed), Eliminar (`ConfirmDialog`)), tile grid. Tiles: `objects` items render a thumbnail once via `renderScene` (from `lib/renderScene.js`, small size 96×96, cached in a module-level `Map` by item id → data URL); `image` items use signed URLs fetched in one `batchSignedUrls` call per library. Tile click → `insertLibraryItem(item, center)`; tiles are `draggable` with `dataTransfer.setData('application/x-runly-library-item', JSON.stringify({ libraryId, itemId }))`; the canvas container in `BoardEditor` handles `onDragOver`/`onDrop` (screen → world) to insert at the drop point. Empty state per spec.
- [ ] **Step 4: Insert** — action `insertLibraryItem(item, worldPoint)`: `objects` → `placeObjects` centred on the point, assign `pageId` and the drawable layer (hotspot objects go to the hotspot layer and get a hotspot record "Hotspot" like `paste`), `position` from `topPosition`, one `createRows` (undo label "Insertar de biblioteca"); `image` → one image object `{ properties: { fileId: item.fileAssetId, name: item.name, naturalWidth: item.width, naturalHeight: item.height } }` sized with `fitSize(item.width, item.height, maxInsertSide)`. Toolbar button "Biblioteca" (icon `Library`, editors only) toggles the panel.
- [ ] **Step 5: Save selection** — "Guardar en biblioteca" in the quick-actions menu (selection ≥ 1) and in the inspector (single and multi): `SaveToLibraryDialog` with `SelectField` of editable libraries + "Nueva biblioteca…" option (then a name input for it), item name (default: object label or "Selección"), Save → create library if needed → `addLibraryItems([{ name, kind: 'objects', payload: normalizeObjects(selected) }])` → toast "Guardado en la biblioteca".
- [ ] **Step 6: Help** — canvas help `overview.md` (no-accent style) section "Bibliotecas": personal vs company, import `.excalidrawlib` (mention libraries.excalidraw.com and checking each license), SVG and ZIP icon packs, save selection, insert by click or drag.
- [ ] **Step 7: Verification + commit**

```bash
node --test apps/api/src/routes/canvas/__tests__/*.test.js
node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js apps/desktop/src/modules/runly.canvas/lib/libraryImport/*.test.js apps/desktop/src/modules/runly.pos/lib/*.test.js
npx eslint <touched files>
node --check apps/api/src/index.js
pnpm --filter ./apps/desktop build:web
```

Commit — `feat(canvas): library panel with import, save selection and insert`
