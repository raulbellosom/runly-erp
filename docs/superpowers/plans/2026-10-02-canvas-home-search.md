# Canvas Home Filters, Smart Search and Auto Covers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filters and a content-aware, accent/typo-tolerant search on the Canvas home, plus automatic cover thumbnails for boards without one.

**Spec:** `docs/superpowers/specs/2026-10-02-canvas-home-search-design.md`

**Rules:** JavaScript only; UI Spanish, code English; no emojis; `@runly/ui` (check real props); never start/stop dev servers (4010/5173); no file over 800 lines (`canvas-service.js` is near 680: put search in a new module); tests with explicit globs; `npx eslint <touched files>` clean; stage only your own files (another session may commit concurrently). Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Search service and route (API)

**Files:** Create `apps/api/src/routes/canvas/canvas-search.js` (+ `__tests__/canvas-search.test.js`); modify `canvas-routes.js`, `packages/sdk/src/domains/canvas.js`.

- [ ] **Step 1: Pure helpers + failing tests** — export `searchTerms(q)` (trim, lower, strip accents with `normalize('NFD').replace(/\p{Diacritic}/gu, '')`, split on whitespace, drop 1-char tokens unless it is the only token, dedupe, max 6 tokens) and `rankBoards(rows, terms)` where `rows` are `{ boardId, field, label, text }` hits (one per matched field and term, with `fuzzy: boolean`). `rankBoards` keeps only boards whose hits cover **every** term, sums field weights (name 10, description 5, hotspot 4, page 3, text 2, link 2; fuzzy hits half) once per (field, label) pair, and returns `[{ boardId, score, matches }]` sorted by score desc with at most 2 `matches` per board (`{ field, label, snippet }`, highest weight first, snippet = up to 60 chars of `text` around the first term, with `…`). Tests:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { rankBoards, searchTerms } from '../canvas-search.js'

describe('canvas search helpers', () => {
  it('normalises terms', () => {
    assert.deepEqual(searchTerms('  Extintor  BODEGA  extintor '), ['extintor', 'bodega'])
    assert.deepEqual(searchTerms('Almacén'), ['almacen'])
    assert.deepEqual(searchTerms('a b'), [])
    assert.deepEqual(searchTerms('x'), ['x'])
  })
  it('requires every term and ranks by field weight', () => {
    const rows = [
      { boardId: 'b1', field: 'hotspot', label: 'Extintor 2', text: 'Extintor 2', term: 'extintor' },
      { boardId: 'b1', field: 'page', label: 'Bodega', text: 'Bodega', term: 'bodega' },
      { boardId: 'b2', field: 'name', label: 'Extintores', text: 'Extintores', term: 'extintor' },
    ]
    const ranked = rankBoards(rows, ['extintor', 'bodega'])
    assert.deepEqual(ranked.map((r) => r.boardId), ['b1'])
    assert.equal(ranked[0].score, 7)
    assert.deepEqual(ranked[0].matches.map((m) => m.field), ['hotspot', 'page'])
  })
  it('halves fuzzy hits', () => {
    const ranked = rankBoards([{ boardId: 'b', field: 'name', label: 'Extintor', text: 'Extintor', term: 'extintr', fuzzy: true }], ['extintr'])
    assert.equal(ranked[0].score, 5)
  })
})
```

- [ ] **Step 2: `createCanvasSearch({ prisma })` with `search(companyId, actorId, q)`**: throw `{ status: 400 }` for `q` outside 2..120 chars or no terms. Accessible board ids: `prisma.canvasBoard.findMany({ where: { companyId, archivedAt: null, OR: [{ ownerId: actorId }, { collaborators: { some: { userId: actorId } } }] }, select: { id: true } })`; none → `[]`. For each term run **one** `$queryRaw` (tagged template, parameterised; `ANY(${ids}::uuid[])`) that UNION ALLs per-field hits for those boards, using `atlas_unaccent(lower(col)) LIKE '%' || ${escaped} || '%' ESCAPE '\'` (escape `%`, `_`, `\` in the term), returning `board_id, field, label, text, false AS fuzzy`:
  - `name`/`description` from `canvas_board`;
  - `page` from `canvas_page.name`;
  - `hotspot` from `canvas_hotspot` (`archived_at IS NULL`) title, description and `tags::text`, label = title;
  - `text` from `canvas_object` (`deleted_at IS NULL`, `type = 'text'`) `properties->>'text'`, label = `left(properties->>'text', 40)`;
  - `link` from `canvas_entity_link` `metadata->'resolved'->>'title'`, label = that title;
  plus fuzzy hits for terms ≥ 4 chars: `word_similarity(${term}, atlas_unaccent(lower(name))) >= 0.45` on board names and hotspot titles (`true AS fuzzy`), excluding rows already matched by `LIKE`. Collect rows with `term`, call `rankBoards`, return the first 50. Verify the real table/column names in `prisma/migrations/20261001120000_runly_canvas_foundation/migration.sql`.
- [ ] **Step 3: Route + SDK** — `app.get('/canvas/search', requirePermission('canvas.view'), …)` → `{ data }` via `errorResponse`; router option `search = createCanvasSearch({ prisma })` (only when `prisma` is given). SDK: `search: (q, token) => send('GET', `/canvas/search${toQueryString({ q })}`, undefined, token)`. Add a route test with a stubbed `search` that asserts `companyId`, `actorId` and `q` are forwarded.
- [ ] **Step 4:** API tests + `node --check apps/api/src/index.js` + eslint. Commit — `feat(canvas): content-aware board search with accent and typo tolerance`

---

### Task 2: Home filters and search UI

**Files:** Create `apps/desktop/src/modules/runly.canvas/lib/boardFilters.js` (+ test), `components/BoardFilters.jsx`; modify `screens/CanvasHome.jsx`, `components/BoardCard.jsx`, `hooks/useCanvasData.js`.

- [ ] **Step 1: Pure filter logic + tests** — `DEFAULT_FILTERS = { templates: [], access: 'all', updated: 'any', sort: 'recent' }`; `applyBoardFilters(boards, filters, now = Date.now())` (templates: keep when list empty or includes `templateType`; access `mine` → `myRole === 'OWNER'`, `shared` → `myRole !== 'OWNER'`; updated `today` → same local calendar day as `now`, `7d`/`30d` → `updatedAt` within that many days; sort `recent` updatedAt desc, `name` `localeCompare('es')`, `oldest` createdAt asc); `activeFilterCount(filters)`; `orderBySearch(boards, results)` (keeps only boards present in `results`, in result order, attaching `matches`). Write focused tests for each rule.
- [ ] **Step 2: Hooks** — `useBoardSearch(q)` in `useCanvasData.js`: debounced value handled in the component; query key `['canvas', 'search', q]`, enabled when `q.trim().length >= 2`, `placeholderData: keepPreviousData`, `staleTime: 30_000`.
- [ ] **Step 3: `BoardFilters.jsx`** — desktop: a row with a "Plantilla" `DropdownMenu` of `DropdownMenuCheckboxItem`s (labels/icons from `useCanvasTemplates` + `templateIcon`), `SelectField`s for Acceso (Todos / Míos / Compartidos conmigo), Actualizado (Cualquier fecha / Hoy / Últimos 7 días / Últimos 30 días) and Orden (Recientes / Nombre A-Z / Más antiguos), and "Limpiar filtros" when `activeFilterCount > 0`. Mobile (`useIsMobile`): one outline button "Filtros" with a count badge opening a `Sheet` (fixed header/footer) containing the same controls.
- [ ] **Step 4: `CanvasHome.jsx`** — filters state initialised from `localStorage` key `runly.canvas.home.filters` (try/catch read/write, merge over `DEFAULT_FILTERS`); search input placeholder "Buscar en nombres, hotspots, textos y registros…" with 250 ms debounce; when the debounced query has ≥ 2 chars, list = `applyBoardFilters(orderBySearch(boards, searchResults), { ...filters, sort: null })` (search order wins; make `applyBoardFilters` skip sorting when `sort` is null), with `Skeleton` cards while the first search loads; otherwise `applyBoardFilters(boards, filters)`. Empty states: no boards at all (existing), no matches (`EmptyState` with "Limpiar búsqueda" and, if filters active, "Limpiar filtros"). Keep the thumbnail signed-URL logic.
- [ ] **Step 5: `BoardCard.jsx`** — optional `matches` prop: under the name render one muted line `Coincide en: ` + matches joined by " · " as `${FIELD_LABEL[field]}: ${snippet || label}` with `FIELD_LABEL = { name: 'Nombre', description: 'Descripción', page: 'Página', hotspot: 'Hotspot', text: 'Texto', link: 'Registro' }`, truncated to one line.
- [ ] **Step 6:** tests, eslint, build. Commit — `feat(canvas): board filters and smart search on the Canvas home`

---

### Task 3: Automatic covers

**Files:** `apps/desktop/src/modules/runly.canvas/hooks/useBoardThumbnail.js`, `screens/BoardEditor.jsx`

- [ ] **Step 1:** `useBoardThumbnail` gains `board` (the loaded board row: `thumbnailFileId`, `updatedAt`) and `loaded` (objects query finished). New effect: once per board id, when `enabled && loaded && rows.some((r) => !r.pending)` and (`!board.thumbnailFileId` or the board was updated after the last cover and the cover is older than 7 days — compare `board.updatedAt` with a `board.metadata?.thumbnailAt` timestamp if present, otherwise treat as missing), schedule `generate()` after 3 000 ms (cancel on unmount/board change). After a successful upload also patch `metadata: { ...board.metadata, thumbnailAt: new Date().toISOString() }` together with `thumbnailFileId` in the same `updateBoard` call. Keep the existing save-driven regeneration.
- [ ] **Step 2:** `BoardEditor.jsx` passes `board: board.data` and `loaded: !objects.isLoading`.
- [ ] **Step 3: Help** — add to the canvas help `overview.md` (no-accent style) under "Miniaturas": `Si un Board todavia no tiene miniatura, se crea sola unos segundos despues de abrirlo.` and a new section:

```md
### Buscar y filtrar

El buscador de la lista de Boards encuentra un Board por su nombre, descripcion, paginas, hotspots, textos del lienzo y registros vinculados; no importan mayusculas ni acentos y tolera errores de dedo. Cada resultado indica donde coincidio. Los filtros permiten ver solo ciertas plantillas, tus Boards o los compartidos contigo, por fecha de actualizacion, y ordenar por recientes, nombre o antiguedad.
```

- [ ] **Step 4: Verification + commit**

```bash
node --test apps/api/src/routes/canvas/__tests__/*.test.js
node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js
npx eslint <touched files>
node --check apps/api/src/index.js
pnpm --filter ./apps/desktop build:web
```

Commit — `feat(canvas): automatic covers for boards without a thumbnail; help for search`
