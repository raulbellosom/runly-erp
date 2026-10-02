# Canvas Delete Board and Rename Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners can delete a Board with everything it owns (rows, comments, public links, files); editors can rename Boards and rename/delete pages.

**Spec:** `docs/superpowers/specs/2026-10-02-canvas-delete-rename-design.md`

**Rules:** JavaScript only; UI Spanish, code English; no emojis; `@runly/ui` (`ConfirmDialog`, `Dialog`, `DropdownMenu`, `TextField`/`Input` — check real props); modal header/footer fixed; never start/stop dev servers; never run DB migrations; no file over 800 lines (`canvas-service.js` is near 700: put the deletion in a new module); tests with explicit globs; `npx eslint <touched files>` clean; stage only your own files (other sessions commit concurrently). Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Board deletion service + route + SDK

**Files:** Create `apps/api/src/routes/canvas/canvas-board-delete.js` (+ `__tests__/canvas-board-delete.test.js`); modify `canvas-routes.js` (DELETE route), `packages/sdk/src/domains/canvas.js`.

- [ ] **Step 1: Failing test** — with a mocked Prisma (`$transaction(fn)` calling `fn(tx)`), assert that `deleteBoard(companyId, actorId, boardId)`:
  - rejects with 404 when the board is not in the company and with 403 when the actor is not the owner (reuse `assertBoardAccess(..., 'OWNER')` from the canvas service — inject it or the service);
  - collects hotspot ids of the board, then file ids with `fileAsset.findMany({ where: { moduleKey: 'runly.canvas', entityId: companyId, entityType: { in: ['CanvasBoard', 'CanvasThumbnail', 'CanvasHotspot'] }, OR: [{ metadata: { path: ['sourceEntityId'], equals: boardId } }, ...hotspotIds.map((id) => ({ metadata: { path: ['sourceEntityId'], equals: id } }))] } })`;
  - excludes file ids referenced by library items (raw query over `canvas_library_item` where `payload::text LIKE '%' || id || '%'`, company-scoped through `canvas_library.company_id`), mocked in the test via `$queryRaw`;
  - in the transaction deletes `entityComment` rows (`entityType: 'CanvasBoard', entityId: boardId` and `entityType: 'CanvasHotspot', entityId: { in: hotspotIds }`, `companyId`), `modulePublicLink` rows (`companyId`, `moduleKey: 'runly.canvas'`, `recordId: boardId` — verify field names in `canvas-public.js`'s `scope()`), then `canvasBoard.delete({ where: { id: boardId } })` (cascades), and writes `BOARD_DELETED` audit with counts;
  - after the transaction calls the injected `removeFiles({ id: { in: fileIds } })` (the same `removeFiles` the canvas service receives; see `canvas-files.js` `createCanvasFileRemover`) and, if it throws, disables those rows instead (`fileAsset.updateMany({ ..., data: { enabled: false } })`).
- [ ] **Step 2: Implement** `createCanvasBoardDeletion({ prisma, canvas, removeFiles })` exporting `deleteBoard`. Count pages/objects/hotspots before deleting for the audit metadata.
- [ ] **Step 3: Route** — replace the DELETE handler: `await boardDeletion.deleteBoard(companyId(c), actorId(c), boardId)`, broadcast `changed(boardId, 'board.deleted')`, return `c.body(null, 204)`. Create `boardDeletion` in `createCanvasRouter` from the same `prisma`/`canvas`/`removeFiles` it already receives (default `removeFiles` = disable rows, as in the service). Route test with stubs asserting 204 and the broadcast. Remove `archiveBoard` from the service only if nothing else uses it (grep; MirAI actions included) — otherwise leave it.
- [ ] **Step 4: SDK** — `deleteBoard: (boardId, token) => send('DELETE', ...)`; remove `archiveBoard` if unused anywhere (grep `apps/desktop`, `packages`).
- [ ] **Step 5:** API tests, `node --check apps/api/src/index.js`, eslint. Commit — `feat(canvas): delete a board with its files, comments and public links`

---

### Task 2: UI — delete/rename Board, rename/delete pages

**Files:** `hooks/useCanvasData.js` (mutations `useDeleteBoard`, `useRenameBoard`, `useUpdatePage` exists, `useDeletePage`), `components/BoardCard.jsx`, create `components/BoardActionsDialogs.jsx` (rename `Dialog` + delete `ConfirmDialog` with type-the-name confirmation, reused by home and editor), `components/EditorTopBar.jsx` ("Más" `DropdownMenu`), `screens/CanvasHome.jsx`, `screens/BoardEditor.jsx`, `components/layers/PagesSection.jsx`, `hooks/useCanvasRealtime.js` (handle `board.deleted`: invalidate boards list, and the editor navigates to `/app/m/runly.canvas` with toast "Este Board fue eliminado" unless this session deleted it).

- [ ] **Step 1: Hooks** — `useDeleteBoard()` (on success: remove `['canvas','boards',id]` queries, invalidate `['canvas','boards']` exact and `['canvas','search']`), `useRenameBoard()` (PATCH `{ name }`, invalidate list + board), `useDeletePage(boardId)` (invalidate board).
- [ ] **Step 2: `BoardActionsDialogs`** — props `{ board, mode: 'rename' | 'delete' | null, onClose, onDeleted }`. Delete confirmation requires typing the exact Board name (trimmed, case-sensitive) to enable the destructive button; shows the spec's description.
- [ ] **Step 3: BoardCard** — the card is a `<button>`; restructure so the menu is not nested inside it (e.g. outer `div` with the card button and an absolutely positioned menu button at the top-right of the body area, `opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100`). Menu: Abrir, Renombrar (`canEditBoard(myRole)`), Eliminar (`myRole === 'OWNER'`). `CanvasHome` owns the dialog state.
- [ ] **Step 4: Editor** — "Más" button (`MoreHorizontal`, label "Más opciones") in `EditorTopBar` before the Versions/Export group with the same two actions; after delete navigate to the list and toast "Board eliminado".
- [ ] **Step 5: Pages** — in `PagesSection` each page row gets a `MoreHorizontal` menu (editors only): Renombrar (inline `Input` in the row, Enter/blur saves via `updatePage`, Esc cancels, ignore empty) and Eliminar (`ConfirmDialog`, disabled when only one page; after deleting the active page switch to the first remaining one).
- [ ] **Step 6:** Help text in `apps/api/src/manifests/official/help/runly.canvas/overview.md` (no-accent style): renaming/deleting pages, renaming a Board, deleting a Board (owner only, permanent, removes files/comments/public links; type the name to confirm).
- [ ] **Step 7: Verification + commit**

```bash
node --test apps/api/src/routes/canvas/__tests__/*.test.js
node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js apps/desktop/src/modules/runly.canvas/lib/libraryImport/*.test.js
npx eslint <touched files>
pnpm --filter ./apps/desktop build:web
```

Commit — `feat(canvas): rename and delete boards; rename and delete pages`
