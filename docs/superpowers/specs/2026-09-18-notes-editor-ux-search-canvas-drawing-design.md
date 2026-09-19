# Notes: Editor UX (zoom, blank-note body, title+icon), smarter search, drawing-block dark default

Date: 2026-09-18
Status: Approved
Scope: three independent groups of work on `runly.notes`, decided together in one brainstorming pass per the user's request to batch them.

## Group 1: Editor UX

### 1a. Writing without a title

**Symptom:** clicking into a brand-new, blank note always places the cursor in the title line; there's no way to go straight to the body.

**Root cause:** a note's title is literally the document's first paragraph (Apple-Notes-style convention, styled via `.tiptap > p:first-child`), not a separate field. A brand-new note is created with `content: ''`, which `seedIfNeeded` (in `NoteEditor.jsx`) treats as falsy and skips seeding — TipTap/ProseMirror then falls back to its own minimal valid document (exactly one empty paragraph). With only one paragraph existing, EVERY click in the content area lands in that one paragraph (the title), because there's nothing else to click into.

**Fix:** seed brand-new **document**-type notes with two empty paragraphs (`<p></p><p></p>`) instead of an empty string, so a distinct, empty body paragraph exists from the start (it already has its own placeholder, "Empieza a escribir, o pulsa «/» para comandos", via the existing `bodyPlaceholderText` logic). With two real paragraphs on screen, native ProseMirror click-positioning (and the existing "click below all content focuses the end" fallback) naturally routes clicks below the title into the body — no new click-handling code needed, just fixing the seeded content. Canvas-type notes are unaffected (they don't use this content field the same way).

### 1b. Title shares a line with the icon

**Symptom:** the note icon sits in its own row above the title, visually separated.

**Design (per the user, confirmed after discussing the smaller-scope option vs. extracting title into its own field — they explicitly chose to keep title as the document's first line and get the icon onto its visual line via CSS):** the icon button overlaps the title's own line via a calculated negative `margin-bottom` on the icon row, pulling the title's paragraph up to visually align with the icon (classic "icon overlapping the next block" CSS technique), with the title paragraph given extra `padding-left` to clear the icon horizontally, and the icon row given `position: relative; z-index` so it paints above the title text in the overlap zone. This is acknowledged as the more fragile of the two options discussed and may need a follow-up visual tweak once seen live (the user has a dev server running and can spot-check immediately after this ships).

### 1c. Zoom control for the note area

**Symptom:** no way to zoom the note content in/out, useful on large screens.

**Design:**
- A floating control anchored to a corner of the editor panel (Google Docs/PDF-viewer style: `–`, current percentage, `+`).
- Range 50%–200%, in 10% steps, default 100%.
- Applies via the CSS `zoom` property on `NoteSheet`'s wrapper (not `transform: scale`, which visually resizes without adjusting layout size or interactive hit-boxes — `zoom` correctly reflows layout and keeps click targets aligned with what's drawn). Known limitation: `zoom` isn't supported in Firefox; acceptable here since this app targets the Tauri (Chromium) shell and Chromium-based browsers for daily use.
- Persisted as a single device-wide preference in `localStorage` (same pattern as the notes-list collapse preference), applying to every note opened afterward — not per-note.
- Desktop-only visual concern in practice, but the control itself isn't hidden on mobile (per the user's "conveniente para todos los dispositivos" — small screens can zoom out too if useful, no artificial restriction).

## Group 2: Smarter, correct search

**Symptom:** searching by a tag/label name doesn't filter results; more generally, search is unreliable.

**Root cause:** `NotesList.jsx` runs its own **client-side-only** substring filter over `title` + `content`, applied to whatever batch of notes is already loaded — which is capped by the current page size (30 by default). It never uses the backend's existing full-text-search parameter (`q`, already wired end-to-end through the route and `listNotes`'s SQL, doing Spanish full-text search on `title`/`content_text`), and that backend search doesn't match tags or folder names either.

**Fix (backend-driven, per the user's choice for a robust fix):**
- Extend `listNotes`'s SQL `WHERE` clause in `notes-service.js` so the `q` filter also matches: (a) any tag name assigned to the note (`note_tag_assignments` joined to `note_tags`), and (b) the name of the note's folder (`note_folders`), in addition to the existing title/content full-text match — combined with `OR`, so a note matches if *any* of the three match.
- Move search state from `NotesList.jsx` (locally-owned, disconnected from data fetching) up into `NotesScreen.jsx`, debounced 250ms (mirroring the existing debounce idiom already used elsewhere in this codebase, e.g. `useChatMessageSearch.js`), and pass it as `q` into the `useNotes` query — so search results come from the real backend query (covers every matching note regardless of pagination), scoped to whatever view/folder is currently active (unchanged scoping behavior — search doesn't reach outside the current folder/view, it just now correctly matches everything within it).
- `NotesList.jsx` no longer filters anything itself — it just renders whatever `notes` prop it's given (already filtered by the server) and owns only the `SearchInput`'s visual state, reporting changes up via a callback.

## Group 3: Drawing-block canvas defaults to white in dark mode

**Symptom (clarified with the user — this is NOT the Excalidraw canvas-type note; it's the inline freehand drawing tool insertable into a normal document note):** inserting a new drawing block always shows a white canvas, clashing with dark mode.

**Root cause:** `DrawingBlock.jsx`'s TipTap node schema hardcodes `backgroundColor: { default: '#ffffff' }`, and the `insertDrawingBlock` command (used by both the toolbar button and the `/dibujo` slash command) inserts the node with empty `attrs`, always falling back to that hardcoded white default regardless of the app's current theme.

**Fix:** have the `insertDrawingBlock` command read the current theme directly (`document.documentElement.classList.contains('dark')` — a plain DOM check, safe to do inside a TipTap command since it isn't a React component and doesn't need a hook) and pass an explicit `backgroundColor` attr at insertion time: a dark tone already present in the existing background swatch palette (`#1a1a1a`, already the last entry in `DrawingCanvas.jsx`'s `BACKGROUNDS` array) when dark mode is active, `#ffffff` otherwise. Both call sites (toolbar button, slash command) need no changes — they already call `insertDrawingBlock()` with no arguments; the command itself now decides the right default. Existing, already-created drawings are untouched (their saved background color is preserved either way — no retroactive migration, since there's no way to distinguish "explicitly chose white" from "never touched the default" after the fact, and retroactively changing it could surprise someone who really did want white).

## Non-goals

- Not extracting note title into a separate field (the more invasive, more correct architecture) — user explicitly chose to keep the current first-line-of-document convention for now.
- Not expanding search scope beyond the currently active view/folder (e.g. no new "search everywhere" mode).
- Not retrofitting existing drawing blocks with a dark background.
- Not touching the actual Excalidraw canvas-type note's theming — investigation found nothing wrong there; the reported symptom was specifically about the inline drawing tool.

## Testing

- Backend: extend the existing `notes-service.js` test coverage with a case asserting the `q` SQL now also matches on tag/folder name (mirrors the existing pattern for other `listNotes` filters).
- No automated tests for the CSS-based zoom/icon-overlap changes or the drawing-block default (component/CSS-only, consistent with this codebase's convention that only `lib/` functions are unit-tested).
- Manual verification: dev server — blank-note click-through, icon/title visual alignment (both light and dark), zoom control across the 50–200% range, search by a tag name and by a folder name across more than one page of notes, and a freshly-inserted drawing block's background in dark mode.
