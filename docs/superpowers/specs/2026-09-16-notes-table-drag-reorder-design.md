# Notes Editor — Table Drag-Reorder

- Status: Approved (design)
- Date: 2026-09-16
- Module: `runly.notes` (frontend only)
- Author: Raul Belloso Medina

## Problem

Tables in a note have no way to be reordered at all — on any platform. Every
other block that supports moving (currently just images, per
`docs/superpowers/specs/2026-09-16-notes-image-drag-reorder-design.md`) has
a way to drag it to a new position; a table is stuck wherever it was
inserted, forcing the user to move everything else around it instead.

## Goals

1. A table can be dragged to a new position among the note's top-level
   blocks, on both mouse and touch.
2. Mobile: the existing floating "Opciones de tabla" button
   (`components/TableFloatingMenu.jsx`, a fixed bottom-left circular button
   that appears whenever the cursor is inside a table) gains a press-and-hold
   gesture that arms a drag — a quick tap still opens the options sheet,
   exactly as today.
3. Desktop: a new small grip handle appears near the table's top-left corner
   whenever the cursor is inside it (same trigger as the existing toolbar
   "Tabla" dropdown, `NoteToolbar.jsx`) — pressing and dragging it with the
   mouse reorders the table.
4. Once armed, dragging a table behaves exactly like dragging an image
   (`docs/superpowers/specs/2026-09-16-notes-image-drag-reorder-design.md`):
   it visually lifts and follows the pointer, other top-level blocks slide
   out of the way in real time, and releasing commits the move.

## Non-goals

- No change to the "Opciones de tabla" sheet/dropdown's own content (add/
  delete row/column/table) — unchanged, still reachable by a quick tap
  (mobile) or the toolbar dropdown (desktop).
- No dragging of anything INTO or OUT OF a table (e.g. dragging an image
  from the note body into a table cell) — this only reorders whole tables
  among the note's top-level blocks, the same reach the image drag-reorder
  feature already has.
- No changes to column resizing or any other existing table editing
  behavior.
- No per-row or per-cell drag handles — only the whole table moves as one
  unit.

## Technical constraint that shapes the design

`@tiptap/extension-table` (configured with `resizable: true`,
`editor-extensions.js`) does not use the Table node's own `addNodeView()` —
it returns `null` there and instead registers its own internal `TableView`
class through the `columnResizing` ProseMirror plugin
(`node_modules/@tiptap/extension-table`, `addProseMirrorPlugins`/
`addNodeView`). Replacing this with a custom React NodeView (the way
`ImageAnnotationOverlay` wraps the image node) would conflict with that
plugin-owned view and risk breaking column resizing.

Because of this, the table drag handle is a **floating overlay** — a
separate component that measures the target table's on-screen position via
`editor.view.nodeDOM(tablePos)` (the same DOM-lookup approach
`lib/dragReorder.js`'s `computeBlockRects` already uses for every top-level
block, table included, with no special-casing needed there) — rather than
something rendered inside the table's own DOM.

## Design

### 1 — Generalize the drag hook

`hooks/useImageDragReorder.js` becomes `hooks/useBlockDragReorder.js`. Its
only image-specific detail today is that it reads `boxRef.current`/
`frameRef.current` directly from React refs; everything else (long-press
arming, floating clone, sibling reflow via `computeShiftMap`, drop-position
via `findDropPosition`, commit via `moveNode`) is already block-agnostic.

The hook's parameters change from `{ boxRef, frameRef }` to
`{ getBoxEl, getFrameEl }` — plain functions returning the current DOM
element (or `null`), so a table caller (which has no ref of its own, only a
DOM lookup by position) can supply `() => editor.view.nodeDOM(getTablePos())`
just as easily as an image caller supplies `() => boxRef.current`.
`ImageAnnotationOverlay.jsx` updates its one call site to pass
`() => boxRef.current` / `() => frameRef.current` instead of the ref objects
directly. No behavior changes for images — this is a pure refactor.

### 2 — Finding the table at the current selection

A small new helper in `lib/dragReorder.js`:

```
findTableAtSelection(state) -> { pos, node } | null
```

Walks up from `state.selection.$from` through each ancestor depth looking
for a node whose `type.name === 'table'`, returning its top-level document
position (`$pos.before(depth)`) and the node itself. Returns `null` when the
selection isn't inside a table — the same condition `editor.isActive('table')`
already reports, computed independently here since the caller needs the
actual position, not just a boolean.

### 3 — `TableFloatingMenu.jsx` becomes the shared handle

The component drops its `isCoarsePointer`-only gate (`if (!editor ||
!isCoarsePointer || !editor.isActive('table')) return null` becomes `if
(!editor || !editor.isActive('table')) return null`) and branches its own
rendering by pointer type:

- **Coarse pointer (touch)**: unchanged fixed bottom-left circular button.
  Its existing `onClick` (opens the sheet) stays; it additionally gets the
  drag hook's pointer handlers (`onPointerDown`/`onPointerMove`/`onPointerUp`/
  `onPointerCancel`) wired in, exactly mirroring how `ImageAnnotationOverlay`
  layers a press-and-hold drag on top of a still-tappable element. A press
  that never arms (quick tap) still opens the sheet via the normal `click`
  event that follows; an armed drag suppresses that trailing click the same
  way `wasDragRef` does for images.
- **Fine pointer (mouse)**: instead of the circular button, renders a small
  grip icon positioned at the table's own top-left corner (measured via
  `findTableAtSelection` + `getBoundingClientRect()` on its DOM node,
  recomputed on selection change and on the note's scroll container
  scrolling/resizing — the same recompute-on-resize pattern
  `ImageCropModal.jsx`'s `ResizeObserver` effect already uses). Pressing and
  dragging it reorders the table; it has no click behavior of its own (the
  toolbar's existing "Tabla" dropdown remains the way to reach add/delete
  row/column/table options on desktop, unchanged).

Both variants call `useBlockDragReorder` with `getPos: () =>
findTableAtSelection(editor.state)?.pos` and `getBoxEl`/`getFrameEl` both
resolving to `editor.view.nodeDOM(pos)` (a table has no separate "frame vs.
box" distinction the way an image does — the whole table wrapper is both).

## Components / files

Changed:

- `apps/desktop/src/modules/runly.notes/hooks/useImageDragReorder.js` →
  renamed `useBlockDragReorder.js`, parameterized by `getBoxEl`/`getFrameEl`
  functions instead of refs (Design 1).
- `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`
  — updates its one call site to the renamed/re-parameterized hook. No
  behavior change.
- `apps/desktop/src/modules/runly.notes/lib/dragReorder.js` — new
  `findTableAtSelection` (Design 2).
- `apps/desktop/src/modules/runly.notes/components/TableFloatingMenu.jsx` —
  drops the coarse-pointer-only gate, adds the desktop grip-handle variant,
  wires the drag hook into both variants (Design 3).

No new files, no `@runly/ui` changes, no backend/API/Prisma changes.

## Data / compatibility

- No schema or attribute changes — dragging a table uses the same
  `moveNode` document mutation already used for images.

## Testing

Node's built-in test runner (`node --test`):

- `findTableAtSelection`: given a small fake ProseMirror-shaped state
  (mocking `$from.depth`/`$from.node(d)`/`$from.before(d)`), returns the
  correct `{ pos, node }` when the selection is inside a table at varying
  nesting depths, and `null` when it isn't inside a table at all.

The renamed `useBlockDragReorder` hook and `TableFloatingMenu.jsx`'s new
positioning logic are DOM/gesture-heavy and manual-QA'd only, matching the
existing convention for this kind of code.

Manual QA (per `docs/ai-context/ui-screen-audit-checklist.md`), 390px and
1440px, both themes:

- Mobile: cursor in a table shows the existing floating button; a quick tap
  still opens the options sheet; pressing and holding past ~450ms arms a
  drag, and dragging afterward moves the table with the same lift/reflow
  visual images already have.
- Desktop: clicking into a table shows a small grip handle near its
  top-left corner; pressing and dragging it with the mouse reorders the
  table; the existing toolbar "Tabla" dropdown still works unchanged.
- Scrolling the note while the desktop grip handle is visible keeps it
  correctly positioned against the table (not left behind or misplaced).
- Existing image drag-reorder (mouse and touch) still behaves exactly as
  before this refactor — no regression from the hook rename/re-parameterization.
- Column resizing and cell editing inside a table are unaffected.
