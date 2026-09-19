# Notes editor: mobile keyboard, collapse/fullscreen, paper backgrounds, unified proportions

Date: 2026-09-18
Status: Approved
Scope: `apps/desktop/src/modules/runly.notes` editor surface (TipTap rich-text notes only), `apps/api/src/routes/notes`. Excludes canvas/Excalidraw notes except where noted. This is the "Editor" half of a two-part effort; the "Nota pública" half (image lightbox, live refresh, redesign, collaborator footer) is a separate spec.

## Problem

Four independent but related issues in the notes editor:

1. On mobile, the on-screen keyboard covers the bottom of the note being edited. There is no keyboard-avoidance logic today (confirmed: no `visualViewport`/`scrollIntoView` usage anywhere in the module), so users must insert manual blank lines to keep their cursor visible.
2. There is no way to collapse the notes list or enter a distraction-free fullscreen mode to reclaim screen space, on desktop or mobile.
3. There is no paper-style background option (lined/grid) for notes; nothing like it exists anywhere in the codebase today.
4. The editable note surface is full-bleed with no max-width (`NotesScreen.jsx` editor panel), while the public note view is already constrained to `max-w-3xl mx-auto` (`PublicNoteScreen.jsx:78`). Desktop, mobile, and public renders look inconsistent.

## Non-goals

- Canvas/Excalidraw notes are unaffected (confirmed with user: keyboard issue is TipTap-only).
- No export pipeline is being built for rich-text notes in this spec. Paper-style backgrounds are pure CSS on the live container, so if/when a rich-text export or browser print path is added later, it inherits the visual for free — no dedicated work here.
- No cross-device sync of the "list collapsed" preference — it's local-only (`localStorage`).
- No changes to the public note screen's own layout/redesign — covered by the sibling "Nota pública" spec, though its `max-w-3xl` value becomes the shared constant here.

## Design

### 1. Mobile keyboard avoidance

New hook: `apps/desktop/src/modules/runly.notes/hooks/useKeyboardInset.js`.

- Listens to `window.visualViewport`'s `resize` and `scroll` events (guarded — not all browsers expose `visualViewport`).
- Only activates when `matchMedia('(pointer: coarse)')` matches (touch devices); no-op on desktop/mouse.
- Computes `insetBottom = window.innerHeight - (visualViewport.height + visualViewport.offsetTop)`, clamped to `>= 0`.
- Returns `insetBottom` reactively (state updated on the listener).

Wiring into `NoteEditor.jsx`:

- Only applied when `!readOnly` (the public/trash read-only views never show a keyboard).
- The scrollable wrapper (`NoteEditor.jsx:448-453`) gets `style={{ paddingBottom: insetBottom }}` so there's always scroll room below the last line while the keyboard is up.
- On TipTap `onSelectionUpdate` (and after `onUpdate` when the selection is a caret), if `insetBottom > 0`, compute the caret's screen position via `editor.view.coordsAtPos(selection.head)` and compare against `visualViewport.height`. If the caret is below the visible area, scroll the container so the caret sits just above the keyboard (`scrollIntoView`-equivalent using the container's `scrollTop`, with smooth behavior). This mirrors what native note apps already do and removes the need for manual blank lines.

### 2. Collapse notes list + fullscreen/zen mode (separate controls)

**Collapse list** (desktop only, `lg:` breakpoint and up — mobile already shows one panel at a time via existing `mobileView` state):

- New chevron button in the list panel header (`NotesScreen.jsx:164-189`).
- Collapsing shrinks panel 1 (`NotesScreen.jsx:158-162`, currently `w-full lg:w-72`) to a narrow icon rail (~48px, shows only a "expand" affordance) instead of unmounting it.
- Persisted in `localStorage` under `runly.notes.listCollapsed` (`"1"`/absent), read on mount, same pattern as other local collapse toggles in the app (referenced: `RunlyApp.jsx` / `sidebar-slots.js` collapse state).

**Fullscreen/zen mode** (works identically on mobile and desktop):

- New toggle button placed next to "Compartir"/"Ajustes" in the editor header (`NotesScreen.jsx:252-273`).
- When active: hides the notes-list panel entirely (regardless of the collapse toggle above) **and** the app's global chrome (sidebar + topbar from the shell, `RunlyApp.jsx`), leaving only the note content plus a small floating "exit fullscreen" control (and `Escape` key to exit).
- Session-only state (a `useState` in `NotesScreen.jsx`, not persisted) — resets when the user navigates away.
- Needs a way to tell the shell to hide its own chrome; implementation will inspect `RunlyApp.jsx`/`sidebar-slots.js` at plan time to find the least-invasive mechanism (context flag or route-level signal) rather than duplicating shell layout logic inside the notes module.

### 3. Paper-style background (per note)

- New column `paper_style` on the notes table (`text`, values `'none' | 'lined' | 'grid'`, default `'none'`), added via a **new** forward migration (existing migrations, e.g. `20260910182109_notes_canvas`, are never edited).
- `notes-service.js`: extend the same `CASE`-based conditional-update pattern already used for `background_color` (`notes-service.js:293-296`) to cover `paper_style`; include it in the `SELECT` list alongside `a.background_color` (`notes-service.js:241`).
- Validators (`packages/validators`) and `useUpdateNote` payload mapping (`NotesScreen.jsx:117-121` `camelToSnake` map) gain `paperStyle` → `paper_style`.
- `NoteSettingsPanel.jsx`: new "Estilo de hoja" section mirroring the existing "Color de fondo" section (`NoteSettingsPanel.jsx:216-246`) — three thumbnail buttons (blank / lined / grid) instead of color swatches, same active-state ring styling.
- Rendering lives inside `NoteEditor.jsx`'s content area: a CSS background (`repeating-linear-gradient`, one direction for `lined`, crossed for `grid`) sized to match the paragraph `line-height` in px so ruled lines land under actual text lines. Color/opacity adapts to light/dark theme and to the note's `background_color` (subtle, low-contrast lines — never fighting with text). Because `NoteEditor` is shared, this renders identically in the authenticated editor and the public view once `paper_style` is passed through.

### 4. Unified content width ("sheet on a canvas")

- Introduce a shared constant, e.g. `NOTE_SHEET_MAX_WIDTH_CLASS = 'max-w-3xl mx-auto'` (matches the public view's existing 768px), placed in a small shared module (e.g. `lib/noteLayout.js`) so both `NotesScreen.jsx` and `PublicNoteScreen.jsx` import the same value instead of duplicating it.
- Desktop editor panel (`NotesScreen.jsx:221-295`) changes from full-bleed to: an outer full-width area painted with the app's neutral canvas background, containing an inner centered column at `NOTE_SHEET_MAX_WIDTH_CLASS`. The note's `background_color` and `paper_style` are painted **inside** that inner column (the "sheet"), not on the outer panel — this is the Notion/Word-style look the user chose.
- This means the `style={{ backgroundColor: ... }}` currently applied to the whole editor panel (`NotesScreen.jsx:226-231`) moves down onto the inner sheet wrapper.
- On mobile, the sheet uses the full available width with the same relative padding (no visible side canvas, since there's no room for one) — consistent padding rules, not necessarily consistent pixel width.
- Cover banner, icon/title row, and editor content inside `NoteEditor.jsx` (currently each individually `px-8`, lines 384-386 and 409) move inside the same centered sheet wrapper so everything lines up; the sticky toolbar (`NoteEditor.jsx:401-404`) can remain full-width above the sheet if that reads better, decided during implementation by visual inspection.

## Data model change

New migration (name TBD at implementation time, e.g. `20260918_notes_paper_style`):

```sql
ALTER TABLE <notes_table> ADD COLUMN paper_style text NOT NULL DEFAULT 'none';
```

(Exact table name confirmed from the existing `atlas_notes_tables` / `notes_canvas` migrations at implementation time.)

## Testing

- `node --test` coverage for `notes-service.js`'s new `paper_style` conditional update (mirrors existing `background_color` test if one exists).
- Manual verification (per CLAUDE.md UI policy): dev server, real mobile viewport (or Chrome device emulation with on-screen keyboard simulation via DevTools) for the keyboard-avoidance behavior, since this can't be meaningfully unit-tested.
- Visual check in light and dark mode for paper backgrounds and the sheet-on-canvas layout, on desktop width and mobile width.

## Open items resolved during brainstorming

- Keyboard fix scope: TipTap notes only, not canvas.
- Collapse and fullscreen are two separate controls, not one.
- Collapse state: local-only (`localStorage`), not synced.
- Paper style: per-note setting (not a global preference).
- Unified width criterion: fixed max-width sheet, centered, same on all breakpoints — with the sheet sitting on a neutral canvas on desktop (Notion/Word style), full-width-with-padding on mobile.
