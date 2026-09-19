# Notes: Editor UX (zoom, blank-note body, title+icon), smarter search, drawing dark default — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three independent groups of notes improvements: (1) editor UX — a zoom control, writing without needing a title first, and the icon sharing the title's visual line; (2) search that actually matches tags and folder names, backed by the real database query instead of a truncated client-side batch; (3) new drawing blocks default to a dark-appropriate background in dark mode.

**Architecture:** Group 1 is four small, mostly-independent frontend changes to `NotesScreen.jsx`/`NoteEditor.jsx`/`NoteSheet.jsx`/`styles.css` (a new localStorage-backed zoom hook + floating control applied via the CSS `zoom` property; a content-seeding change for new notes; a CSS overlap technique for the icon/title). Group 2 extends the existing raw-SQL `listNotes` query in `notes-service.js` with two more `EXISTS` clauses (tags, folder name) and moves search-input state out of `NotesList.jsx` up into `NotesScreen.jsx`, debounced, driving the real `useNotes` query instead of a local re-filter. Group 3 is a one-file fix to a TipTap command in `DrawingBlock.jsx`.

**Tech Stack:** JavaScript (no TypeScript), React, TipTap/`@tiptap/react`, Tailwind CSS, Hono, `prisma.$queryRaw` (raw SQL), Node.js built-in test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-09-18-notes-editor-ux-search-canvas-drawing-design.md`

---

## Task 1: Backend — search matches tags and folder name

**Files:**
- Modify: `apps/api/src/routes/notes/notes-service.js` (the `q` clause inside `listNotes`)
- Test: `apps/api/src/routes/notes/__tests__/notes-access.test.js`

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `apps/api/src/routes/notes/__tests__/notes-access.test.js` (anywhere after the existing blocks, using the same `fakePrisma`/`sql` helpers already defined at the top of the file):

```js
describe("notes-service — listNotes search matches tags and folder name", () => {
  it("the q filter's SQL also checks tag names and the note's folder name", async () => {
    let capturedSql = "";
    const prisma = {
      $queryRaw: (strings) => {
        capturedSql = sql(strings).toLowerCase();
        return Promise.resolve([]);
      },
      $executeRaw: () => Promise.resolve([]),
    };
    const svc = createNotesService({ prisma });
    await svc.listNotes({ userId: OWNER, q: "urgente" });
    assert.match(capturedSql, /note_tag_assignments/);
    assert.match(capturedSql, /note_tags/);
    assert.match(capturedSql, /note_folders/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test apps/api/src/routes/notes/__tests__/notes-access.test.js`
Expected: FAIL — the current `q` clause never references `note_tag_assignments`/`note_folders`.

- [ ] **Step 3: Extend the `q` clause in `listNotes`**

In `apps/api/src/routes/notes/notes-service.js`, find this block inside `listNotes` (currently around line 215):

```js
      AND (
        ${q ?? null}::text IS NULL
        -- 'spanish' config must match notes_fts_idx so the GIN index is used.
        OR to_tsvector('spanish', COALESCE(a.title, '') || ' ' || COALESCE(a.content_text, ''))
           @@ plainto_tsquery('spanish', ${q ?? null}::text)
      )
```

Replace it with:

```js
      AND (
        ${q ?? null}::text IS NULL
        -- 'spanish' config must match notes_fts_idx so the GIN index is used.
        OR to_tsvector('spanish', COALESCE(a.title, '') || ' ' || COALESCE(a.content_text, ''))
           @@ plainto_tsquery('spanish', ${q ?? null}::text)
        OR EXISTS (
          SELECT 1 FROM note_tag_assignments nta_q
          JOIN note_tags nt_q ON nt_q.id = nta_q.tag_id
          WHERE nta_q.note_id = a.id
            AND nt_q.name ILIKE '%' || ${q ?? null}::text || '%'
        )
        OR EXISTS (
          SELECT 1 FROM note_folders nf_q
          WHERE nf_q.id = a.folder_id
            AND nf_q.name ILIKE '%' || ${q ?? null}::text || '%'
        )
      )
```

(When `q` is `null`, the first disjunct is already `TRUE`, so the whole `OR` chain short-circuits regardless of the new clauses — no behavior change when there's no search term.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test apps/api/src/routes/notes/__tests__/notes-access.test.js`
Expected: PASS (all tests in the file, confirm no regression beyond the one pre-existing unrelated `atlas.notes`/`runly.notes` failure already known from earlier work on this module).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/notes/notes-service.js apps/api/src/routes/notes/__tests__/notes-access.test.js
git commit -m "feat(notes): search also matches tag names and folder name"
```

---

## Task 2: Frontend — search hits the real backend query, not a truncated local filter

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/NotesList.jsx`
- Modify: `apps/desktop/src/modules/runly.notes/NotesScreen.jsx`

- [ ] **Step 1: Simplify `NotesList.jsx` — stop filtering, just render + report search text up**

Replace the entire file with:

```jsx
import { NoteCard } from './NoteCard.jsx'
import { EmptyState, SearchInput } from '@runly/ui'

export function NotesList({
  notes = [], selectedNoteId, onSelect, onTrash, isLoading, showTrash = false,
  search = '', onSearchChange,
}) {
  return (
    <div className="flex flex-col h-full bg-card">
      <div className="px-3 py-2.5 border-b border-border">
        <SearchInput
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          onClear={() => onSearchChange('')}
          placeholder="Buscar notas..."
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <div className="w-5 h-5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
            <span className="text-xs text-muted-foreground">Cargando notas...</span>
          </div>
        ) : notes.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title={search ? 'Sin resultados' : showTrash ? 'Papelera vacia' : 'Sin notas'}
              description={
                search
                  ? 'Intenta con otro termino de busqueda'
                  : showTrash
                  ? 'Las notas eliminadas apareceran aqui'
                  : 'Crea tu primera nota con el boton superior'
              }
            />
          </div>
        ) : (
          notes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              isSelected={note.id === selectedNoteId}
              onClick={() => onSelect(note)}
              onTrash={!showTrash ? onTrash : undefined}
            />
          ))
        )}
      </div>
    </div>
  )
}
```

(Notes now arrive already filtered by the server — this component owns only the `SearchInput`'s display and reports raw keystrokes up via `onSearchChange`; no debounce here, that lives in `NotesScreen.jsx` so the input itself stays perfectly responsive while the network request is debounced.)

- [ ] **Step 2: Add debounced search state to `NotesScreen.jsx`**

Add alongside the other `useState` declarations near the top of `NotesScreen` (after `listCollapsed`/`isDesktop`/`isZenMode`):

```js
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(handle)
  }, [search])
```

- [ ] **Step 3: Pass the debounced term into the notes query**

Find:

```js
  const { data, isLoading } = useNotes(buildQueryParams(activeView, folderId))
```

Change to:

```js
  const { data, isLoading } = useNotes(buildQueryParams(activeView, folderId, debouncedSearch))
```

Find `buildQueryParams` (currently at the bottom of the file):

```js
function buildQueryParams(view, folderId) {
  if (view === 'trash')  return { trashed: true }
  if (view === 'recent') return { pageSize: 20 }
  if (view === 'shared') return { shared: true }
  if (folderId)          return { folderId }
  return {}
}
```

Change to:

```js
function buildQueryParams(view, folderId, q) {
  const base =
    view === 'trash'  ? { trashed: true } :
    view === 'recent' ? { pageSize: 20 } :
    view === 'shared' ? { shared: true } :
    folderId          ? { folderId } :
    {}
  return q ? { ...base, q } : base
}
```

- [ ] **Step 4: Wire the new props into `<NotesList>`**

Find:

```jsx
            <NotesList
              notes={notes}
              selectedNoteId={selectedNote?.id}
              onSelect={selectNote}
              onTrash={!isTrashView ? handleTrash : undefined}
              isLoading={isLoading}
              showTrash={isTrashView}
            />
```

Change to:

```jsx
            <NotesList
              notes={notes}
              selectedNoteId={selectedNote?.id}
              onSelect={selectNote}
              onTrash={!isTrashView ? handleTrash : undefined}
              isLoading={isLoading}
              showTrash={isTrashView}
              search={search}
              onSearchChange={setSearch}
            />
```

- [ ] **Step 5: Manual verification**

Run `pnpm dev`:
- Type part of a tag name that's assigned to a note NOT visible in the currently-loaded list (e.g. one that would be beyond the first page, or just any tag name) — confirm it now shows up.
- Type part of a folder's name — confirm notes inside that folder show up even when not currently browsing that folder.
- Confirm typing still feels responsive (no visible lag before characters appear in the box — only the actual filtering/network request is debounced).
- Confirm clearing the search (the `X` button) restores the full list for the current view/folder.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/NotesList.jsx apps/desktop/src/modules/runly.notes/NotesScreen.jsx
git commit -m "feat(notes): drive the notes-list search from the real backend query"
```

---

## Task 3: Frontend — new notes can be written in without touching the title

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/NotesScreen.jsx`

- [ ] **Step 1: Seed new document notes with an empty title AND an empty body paragraph**

Find `handleCreateNote`:

```js
  function handleCreateNote(noteType = 'document') {
    createNote.mutate(
      {
        title: noteType === 'canvas' ? 'Nuevo lienzo' : 'Nueva nota',
        content: '',
        noteType,
      },
```

Change the `content` line to:

```js
  function handleCreateNote(noteType = 'document') {
    createNote.mutate(
      {
        title: noteType === 'canvas' ? 'Nuevo lienzo' : 'Nueva nota',
        content: noteType === 'canvas' ? '' : '<p></p><p></p>',
        noteType,
      },
```

(Canvas notes are untouched — they don't use this HTML content field the way document notes do. For document notes, two empty paragraphs give the note a real, distinct body line from the moment it's created: paragraph 1 is the title, "Sin título" placeholder; paragraph 2 is the body, "Empieza a escribir, o pulsa «/» para comandos" placeholder — both placeholders already exist via `bodyPlaceholderText` in `lib/placeholderText.js`, nothing to change there. With a real second paragraph on screen, clicking anywhere below the title routes the cursor into the body via ProseMirror's normal click-positioning — the note editor's `seedIfNeeded` in `NoteEditor.jsx` seeds the Y.Doc from exactly this HTML the first time the note is opened, since `note.content` is now truthy instead of an empty string.)

- [ ] **Step 2: Manual verification**

Run `pnpm dev`, create a new document note:
- Confirm the title shows the "Sin título" placeholder and, right below it, a second empty line shows "Empieza a escribir, o pulsa «/» para comandos".
- Click directly on that second line (without touching the title) — confirm the cursor lands there, not in the title.
- Type something in the body without ever typing a title — confirm it saves fine and the note still shows sensibly in the notes list (title falls back to whatever the existing empty-title handling already does elsewhere in the app — this step doesn't change that logic, just confirms it isn't broken by starting with two empty paragraphs instead of one).
- Create a new canvas note (lienzo) and confirm nothing about its creation flow changed.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/NotesScreen.jsx
git commit -m "feat(notes): seed new notes with a real body line so you can skip the title"
```

---

## Task 4: Frontend — icon shares the title's visual line

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx`
- Modify: `apps/desktop/src/styles.css`

This is the more visually fragile of the changes in this plan (flagged as such in the approved design) — a CSS overlap technique pulling the icon row down onto the title's own line via a calculated negative margin. The numbers below are computed from the actual current CSS values (title `font-size: 1.625rem`, `line-height: 1.25`, `.tiptap`'s own `pt-1` top padding, and the icon button's `w-10 h-10` + the icon row's `pt-4` top padding) but may need a small manual tweak once seen live — the user has a dev server running and will spot-check immediately after this ships.

- [ ] **Step 1: Overlap the icon row onto the title's line**

In `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx`, find the icon/presence row (inside `editorProvider`'s `slotBefore`):

```jsx
          {!readOnly && (
            // Sits directly above the title (the editor's first line — see
            // handleUpdate) so icon + title read as one unit, matching
            // Notion's page-icon convention.
            <div className="px-8 pt-4 flex items-center justify-between gap-2">
```

Change the className to add the overlap:

```jsx
          {!readOnly && (
            // Overlaps the title's own line (the editor's first paragraph —
            // see handleUpdate) via a negative margin-bottom, computed from
            // the title's font-size/line-height and .tiptap's own top
            // padding — see the matching CSS comment in styles.css for the
            // math. `relative z-10` makes this row paint above the title
            // text in the overlap zone instead of the reverse (later DOM
            // order would otherwise win).
            <div className="relative z-10 px-8 pt-4 flex items-center justify-between gap-2 -mb-10">
```

- [ ] **Step 2: Give the title extra left padding to clear the icon horizontally**

In `apps/desktop/src/styles.css`, find the title rule (right after the main `.tiptap` block):

```css
/* First paragraph = Apple-Notes-style title */
.tiptap > p:first-child {
  font-size: 1.625rem !important;
  font-weight: 700 !important;
  line-height: 1.25 !important;
  letter-spacing: -0.02em;
  color: hsl(var(--foreground));
  margin-bottom: 0.625rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid hsl(var(--border));
}
```

Add one declaration to reserve room for the overlapping icon:

```css
/* First paragraph = Apple-Notes-style title */
.tiptap > p:first-child {
  font-size: 1.625rem !important;
  font-weight: 700 !important;
  line-height: 1.25 !important;
  letter-spacing: -0.02em;
  color: hsl(var(--foreground));
  margin-bottom: 0.625rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid hsl(var(--border));
  /* Extra room so the title's text doesn't render under the note-icon
     button, which overlaps onto this line from the row above (see the
     `-mb-10` on that row in NoteEditor.jsx). */
  padding-left: 2.75rem;
}
```

- [ ] **Step 3: Manual verification (expect to iterate here)**

Run `pnpm dev`, open a note:
- Confirm the icon button visually sits roughly level with the title's text, not clearly above it in its own separate row.
- Confirm clicking the icon still opens the icon picker (the `z-10`/overlap shouldn't block clicks).
- Confirm the title text doesn't render underneath the icon.
- If the vertical alignment is off by a noticeable amount, adjust the `-mb-10` value in Step 1 up or down (each Tailwind spacing step is `0.25rem`/4px — e.g. `-mb-9` or `-mb-11`) and the `padding-left: 2.75rem` in Step 2 if the icon and text overlap horizontally, until they read as one line. Note in your final report what value you landed on and why, if it differs from the starting `-mb-10`/`2.75rem`.
- Confirm the collaborator presence avatars (`PresenceStack`, at the right end of the same row) still render sensibly and aren't clipped or overlapping text awkwardly.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx apps/desktop/src/styles.css
git commit -m "feat(notes): note icon overlaps the title's own line"
```

---

## Task 5: Frontend — zoom control for the note area

**Files:**
- Create: `apps/desktop/src/modules/runly.notes/hooks/useNoteZoom.js`
- Create: `apps/desktop/src/modules/runly.notes/components/ZoomControl.jsx`
- Modify: `apps/desktop/src/modules/runly.notes/components/NoteSheet.jsx`
- Modify: `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx`
- Modify: `apps/desktop/src/modules/runly.notes/NotesScreen.jsx`

- [ ] **Step 1: Create the zoom hook**

```js
// apps/desktop/src/modules/runly.notes/hooks/useNoteZoom.js
import { useState } from 'react'

const NOTE_ZOOM_KEY = 'atlas:v1:notes-zoom'
export const NOTE_ZOOM_MIN = 50
export const NOTE_ZOOM_MAX = 200
export const NOTE_ZOOM_STEP = 10

function getStoredZoom() {
  try {
    const raw = Number(localStorage.getItem(NOTE_ZOOM_KEY))
    return Number.isFinite(raw) && raw >= NOTE_ZOOM_MIN && raw <= NOTE_ZOOM_MAX ? raw : 100
  } catch {
    return 100
  }
}

function persistZoom(val) {
  try {
    localStorage.setItem(NOTE_ZOOM_KEY, String(val))
  } catch {
    // localStorage unavailable — zoom still works for the session, it just
    // won't persist across reloads.
  }
}

// Device-wide zoom preference for the note content area (not per-note),
// mirroring the localStorage pattern already used for the notes-list
// collapse preference.
export function useNoteZoom() {
  const [zoom, setZoomState] = useState(getStoredZoom)

  function setZoom(next) {
    const clamped = Math.min(NOTE_ZOOM_MAX, Math.max(NOTE_ZOOM_MIN, next))
    setZoomState(clamped)
    persistZoom(clamped)
  }

  return [zoom, setZoom]
}
```

- [ ] **Step 2: Create the floating zoom control**

```jsx
// apps/desktop/src/modules/runly.notes/components/ZoomControl.jsx
import { Minus, Plus } from 'lucide-react'
import { NOTE_ZOOM_MIN, NOTE_ZOOM_MAX, NOTE_ZOOM_STEP } from '../hooks/useNoteZoom.js'

export function ZoomControl({ zoom, onZoomChange }) {
  return (
    <div className="absolute bottom-4 right-4 z-30 flex items-center gap-1 rounded-full border border-border bg-card/95 backdrop-blur-sm shadow-sm px-1.5 py-1">
      <button
        type="button"
        onClick={() => onZoomChange(zoom - NOTE_ZOOM_STEP)}
        disabled={zoom <= NOTE_ZOOM_MIN}
        className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
        title="Alejar"
      >
        <Minus size={14} />
      </button>
      <span className="text-xs font-medium text-muted-foreground w-10 text-center tabular-nums select-none">
        {zoom}%
      </span>
      <button
        type="button"
        onClick={() => onZoomChange(zoom + NOTE_ZOOM_STEP)}
        disabled={zoom >= NOTE_ZOOM_MAX}
        className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
        title="Acercar"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Apply zoom in `NoteSheet.jsx`**

In `apps/desktop/src/modules/runly.notes/components/NoteSheet.jsx`, change:

```jsx
export function NoteSheet({ note, isDark = false, children }) {
  const raw = note?.background_color ?? null
  const backgroundColor = raw ? (isDark ? (DARK_BG_MAP[raw] ?? raw) : raw) : undefined

  return (
    <div
      className={`${NOTE_SHEET_MAX_WIDTH_CLASS} min-h-full bg-card note-sheet`}
      style={backgroundColor ? { backgroundColor } : undefined}
    >
      {children}
    </div>
  )
}
```

to:

```jsx
export function NoteSheet({ note, isDark = false, zoom = 100, children }) {
  const raw = note?.background_color ?? null
  const backgroundColor = raw ? (isDark ? (DARK_BG_MAP[raw] ?? raw) : raw) : undefined

  return (
    <div
      className={`${NOTE_SHEET_MAX_WIDTH_CLASS} min-h-full bg-card note-sheet`}
      style={{ zoom: `${zoom}%`, ...(backgroundColor ? { backgroundColor } : null) }}
    >
      {children}
    </div>
  )
}
```

(`zoom: 100%` when unset is a visual no-op, so `PublicNoteScreen.jsx`'s existing `<NoteEditor note={note} readOnly scrollable={false} />` call — which doesn't know about zoom at all — is completely unaffected.)

- [ ] **Step 4: Thread `zoom` through `NoteEditor.jsx`**

In `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx`, change the outer component's signature:

```jsx
export function NoteEditor({ note, readOnly = false, scrollable = true }) {
```

to:

```jsx
export function NoteEditor({ note, readOnly = false, scrollable = true, zoom = 100 }) {
```

Add `zoom={zoom}` to BOTH `<NoteEditorSurface>` call sites in this function (the "plain editor" branch and the "realtime editor" branch):

```jsx
      <NoteEditorSurface
        key={note.id}
        note={note}
        readOnly={readOnly}
        scrollable={scrollable}
        token={token}
        session={session}
        userProfile={userProfile}
        engine={null}
        zoom={zoom}
      />
```

and

```jsx
    <NoteEditorSurface
      key={note.id}
      note={note}
      readOnly={readOnly}
      scrollable={scrollable}
      token={token}
      session={session}
      userProfile={userProfile}
      engine={engine}
      zoom={zoom}
    />
```

Then update `NoteEditorSurface`'s own signature:

```jsx
function NoteEditorSurface({ note, readOnly, scrollable, token, session, userProfile, engine }) {
```

to:

```jsx
function NoteEditorSurface({ note, readOnly, scrollable, token, session, userProfile, engine, zoom = 100 }) {
```

Finally, pass `zoom={zoom}` to BOTH `<NoteSheet>` usages inside `NoteEditorSurface`'s return block (the `scrollable` and non-`scrollable` branches):

```jsx
          <NoteSheet note={note} isDark={isDark} zoom={zoom}>
            {editorProvider}
          </NoteSheet>
```

(both occurrences — don't miss the second one in the non-scrollable branch).

- [ ] **Step 5: Wire zoom state + the floating control into `NotesScreen.jsx`**

Add the import:

```js
import { useNoteZoom } from './hooks/useNoteZoom.js'
import { ZoomControl } from './components/ZoomControl.jsx'
```

Add the hook call alongside the other state declarations:

```js
  const [zoom, setZoom] = useNoteZoom()
```

Pass `zoom={zoom}` into the existing `<NoteEditor>` call (the one used for non-canvas, non-trash-view document notes — find `<NoteEditor note={selectedNote} readOnly={isTrashView} />` and add the prop):

```jsx
          <NoteEditor note={selectedNote} readOnly={isTrashView} zoom={zoom} />
```

Make Panel 2's wrapper a valid positioning context for the floating control when NOT in zen mode (when it IS in zen mode, its own `fixed` already provides one — don't add `relative` there too, to avoid two conflicting `position` utility classes on the same element). Find the Panel 2 wrapper's className array (from the earlier fullscreen-mode task):

```jsx
        className={[
          'flex-1 min-w-0 flex flex-col overflow-hidden',
          isZenMode ? 'fixed inset-x-0 top-0 h-dvh z-50 bg-background' : (isCanvasNote ? '' : 'bg-muted/30'),
          (mobileView === 'editor' || isZenMode) ? 'flex' : 'hidden lg:flex',
        ].join(' ')}
```

Change to:

```jsx
        className={[
          'flex-1 min-w-0 flex flex-col overflow-hidden',
          isZenMode ? 'fixed inset-x-0 top-0 h-dvh z-50 bg-background' : (isCanvasNote ? '' : 'bg-muted/30'),
          !isZenMode ? 'relative' : '',
          (mobileView === 'editor' || isZenMode) ? 'flex' : 'hidden lg:flex',
        ].join(' ')}
```

Render the control inside that same wrapper (anywhere after the header `<div>` — it's `position: absolute` so exact DOM order doesn't affect layout), only for an editable document note actually showing the editor (not settings, not canvas, not trash):

```jsx
        {selectedNote && !isTrashView && !isCanvasNote && rightPanel === 'editor' && (
          <ZoomControl zoom={zoom} onZoomChange={setZoom} />
        )}
```

- [ ] **Step 6: Manual verification**

Run `pnpm dev`, open a document note:
- Confirm the zoom control appears bottom-right, with `-`, a percentage, and `+`.
- Click `+`/`-` a few times — confirm the note content visibly scales, the buttons disable at 50%/200%, and the layout doesn't overflow oddly (the `zoom` CSS property should reflow correctly, unlike `transform: scale`).
- Reload the page — confirm the zoom level persisted.
- Open a canvas (lienzo) note — confirm the zoom control does NOT appear (Excalidraw has its own).
- Switch to the settings panel (Ajustes) — confirm the zoom control disappears while settings are shown, and reappears when switching back to the editor.
- Enter fullscreen/zen mode — confirm the zoom control still shows and still works.
- Open the note's public link — confirm it's unaffected (no zoom control, normal 100% rendering).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/hooks/useNoteZoom.js apps/desktop/src/modules/runly.notes/components/ZoomControl.jsx apps/desktop/src/modules/runly.notes/components/NoteSheet.jsx apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx apps/desktop/src/modules/runly.notes/NotesScreen.jsx
git commit -m "feat(notes): add a zoom control for the note content area"
```

---

## Task 6: Frontend — new drawing blocks default to a dark-appropriate background

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/lib/extensions/DrawingBlock.jsx`

- [ ] **Step 1: Make `insertDrawingBlock` theme-aware**

In `apps/desktop/src/modules/runly.notes/lib/extensions/DrawingBlock.jsx`, find:

```js
  addCommands() {
    return {
      insertDrawingBlock: () => ({ commands }) =>
        commands.insertContent({ type: 'drawingBlock', attrs: {} }),
    }
  },
```

Change to:

```js
  addCommands() {
    return {
      insertDrawingBlock: () => ({ commands }) => {
        // A TipTap command isn't a React component, so it can't use the
        // useIsDark hook — but it also doesn't need to: this is the same
        // plain DOM check that hook uses internally for its own initial
        // state. Read live at insertion time so a new drawing always starts
        // legible against the app's CURRENT theme.
        const isDark =
          typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
        return commands.insertContent({
          type: 'drawingBlock',
          attrs: { backgroundColor: isDark ? '#1a1a1a' : '#ffffff' },
        })
      },
    }
  },
```

(Both call sites — the toolbar button in `NoteToolbar.jsx` and the `/dibujo` slash command in `slashCommandItems.js` — already call `insertDrawingBlock()` with no arguments and need no changes; the command itself now decides the right default. `#1a1a1a` is already the dark option in `DrawingCanvas.jsx`'s own `BACKGROUNDS` swatch palette, so the picker's "active" state will correctly show it selected if the user opens the background picker on a freshly-inserted dark drawing. Existing, already-saved drawings are untouched — their stored `backgroundColor` attribute doesn't change.)

- [ ] **Step 2: Manual verification**

Run `pnpm dev` in dark mode, insert a new drawing block (via the toolbar pen icon and separately via typing `/dibujo`):
- Confirm the canvas background is dark, not white.
- Switch the app to light mode and insert another new drawing block — confirm it's white as before.
- Open an EXISTING drawing block created before this change — confirm its background is unchanged (still whatever it was saved with).
- Open the background-color picker on a freshly-inserted dark drawing — confirm the dark swatch shows as the active/selected one.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/extensions/DrawingBlock.jsx
git commit -m "fix(notes): new drawing blocks default to a dark background in dark mode"
```

---

## Final verification (whole plan)

- [ ] Run `node --test apps/api/src/routes/notes/__tests__/` and `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/` — confirm all pass except the one pre-existing, unrelated `atlas.notes`/`runly.notes` failure already known from earlier work on this module.
- [ ] Run `pnpm lint` — confirm clean.
- [ ] Manual pass through all six scenarios from this plan in one session (dev server, dark and light mode): search by tag/folder name, blank-note click-through, icon/title alignment, zoom across its range, and a freshly-inserted drawing block's background in both themes.
