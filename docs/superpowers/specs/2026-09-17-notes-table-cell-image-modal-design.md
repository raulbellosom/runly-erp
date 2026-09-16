# Notes Editor — Modal Editing for Images Inside Table Cells

- Status: Approved (design)
- Date: 2026-09-17
- Module: `runly.notes` (frontend only)
- Author: Raul Belloso Medina

## Problem

Images can be inserted inside table cells (tables/images/mobile-controls
work, `SlashCommand.jsx`). Once inside a cell, `ImageAnnotationOverlay.jsx`'s
existing inline controls don't fit:

1. The "Editar imagen" button (`ImageAnnotationOverlay.jsx:634-640`) is a
   text+icon pill sized for a normal note-width image. Inside a narrow table
   cell, the cell's own width constrains the button's box, wrapping "Editar
   imagen" onto several vertical lines of 2-3 characters each — unreadable.
2. The edit-mode toolbar (Tool/Color/Recortar/⋯/Listo, five ~36px buttons in
   a row) needs roughly 180px of width to render without overflowing —
   already tight on a normal narrow cell, and the blurred low-quality
   placeholder's blur radius can visibly bleed past the small image's own
   rounded corners at very small rendered sizes.

## Goals

1. An image inside a table cell always opens a properly-sized modal dialog
   to edit (annotate, change color/tool/line width, crop, clear
   annotations) instead of the cramped inline overlay.
2. The modal offers the exact same capability set as today's inline edit
   mode — no feature is dropped for table-cell images.
3. Images outside table cells are completely unaffected — same inline
   edit-mode UI as today, byte-for-byte.

## Non-goals

- No change to view-mode display of a table-cell image (the image itself,
  its resize handles, "Editar imagen" trigger location) beyond what's
  needed to fit a small trigger and route to the modal instead of inline
  mode.
- No general "small image anywhere opens a modal" rule — only the
  table-cell condition triggers the modal (per explicit choice); a
  resized-small image outside a table still uses inline edit mode.
- No change to cropping (`ImageCropModal.jsx`) — the modal reuses it
  exactly as the inline overlay does today (`Recortar` opens the same
  `ImageCropModal`).
- No change to drag-reorder — table-cell images are not currently
  draggable via `useBlockDragReorder` (images inside a cell aren't
  top-level document blocks, so the existing image drag-reorder feature
  doesn't apply to them today, and this work doesn't change that).

## Design

### 1 — Detecting "inside a table cell"

A new pure helper, `lib/tableContext.js`:

```js
export function isInsideTableCell(state, pos) {
  const $pos = state.doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name
    if (name === 'tableCell' || name === 'tableHeader') return true
  }
  return false
}
```

`ImageAnnotationOverlay.jsx` computes `const inTableCell = typeof getPos ===
'function' && isInsideTableCell(editor.state, getPos())` — recomputed each
render (cheap: a shallow walk up a handful of ancestor nodes), matching the
same resolve-and-walk pattern `findTableAtSelection`
(`lib/dragReorder.js`, table drag-reorder work) already uses for a related
purpose.

### 2 — Extracting the shared annotation-drawing logic

To avoid duplicating the pen/arrow/rect/text drawing math and SVG rendering
between the existing inline overlay and the new modal, the stateful drawing
logic and its SVG renderers move into a hook:

```
hooks/useImageAnnotationDrawing.js
```

Inputs: `{ svgRef, crop, annotations, tool, color, lineWidth, isEditing,
updateAttributes }`. Returns: `{ draft, textInput, onDrawPointerDown,
onDrawPointerMove, onDrawPointerUp, commitTextInput, cancelTextInput,
removeAnnotation, renderAnnotation, renderDraft }` — this is the exact
`getPoint`/`onDrawPointerDown`/`onDrawPointerMove`/`onDrawPointerUp`/
`commitTextInput`/`removeAnnotation`/`renderAnnotation`/`renderDraft` block
already in `ImageAnnotationOverlay.jsx`
(`ImageAnnotationOverlay.jsx:150-320` as of the table drag-reorder work),
moved verbatim into the hook with `annotations`/`crop`/etc. taken as
parameters instead of closed-over component state.

`ImageAnnotationOverlay.jsx` is refactored to call this hook instead of
defining that logic inline — pure refactor, no behavior change for images
outside table cells (verified by the existing manual QA checklist for
annotations still applying identically).

### 3 — `ImageEditModal.jsx`

New component, structurally similar to `ImageCropModal.jsx` (a `Dialog`
sized generously per the project's modal-sizing convention — `size="xl"`
or larger) but hosting the annotation toolset instead of the crop
viewfinder:

- Header: "Editar imagen".
- Body: the same Tool/Color/Recortar/⋯(Grosor/Limpiar) row from the inline
  toolbar (`ImageAnnotationOverlay.jsx:439-556`), now with room to breathe
  (no need for the compact single-row constraint that narrow inline
  rendering required — this can lay out comfortably within the modal's own
  width), above the image + SVG annotation surface (using
  `useImageAnnotationDrawing`'s returned handlers/renderers) sized to a
  sensible fixed viewport within the dialog (e.g. `max-h-[60dvh]`, matching
  `ImageCropModal`'s own `MAX_AREA_HEIGHT_FRACTION` convention) rather than
  the image's tiny table-cell-constrained rendered size — editing a small
  image inside a cell should feel like editing a normal-sized image, not a
  postage stamp.
- Footer: "Listo" closes the modal (returns to the table cell's view-mode
  display, now showing the updated annotations/crop at the cell's normal
  small size).
- `Recortar` inside the modal still opens the existing `ImageCropModal` on
  top (same nested-dialog pattern already used for the inline case, where
  `cropOpen` can coexist with `mode === 'edit'`).

### 4 — Wiring in `ImageAnnotationOverlay.jsx`

View-mode rendering for a table-cell image (`inTableCell === true`)
replaces the "Editar imagen" text pill (which doesn't fit) with an
icon-only button (just the pencil, no label — avoiding the text-wrapping
problem entirely regardless of cell width) that opens `ImageEditModal`
instead of switching `mode` to `'edit'`. The rest of view mode (the image
itself, click-to-select, corner resize handles) is unchanged — a
table-cell image can still be resized inline exactly as today; only
annotation/crop editing routes to the modal.

For a non-table-cell image, nothing changes: same text+icon "Editar
imagen" pill, same inline `mode === 'edit'` toggle.

## Components / files

New:

- `apps/desktop/src/modules/runly.notes/lib/tableContext.js`
- `apps/desktop/src/modules/runly.notes/hooks/useImageAnnotationDrawing.js`
- `apps/desktop/src/modules/runly.notes/components/ImageEditModal.jsx`

Changed:

- `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`
  — consumes the extracted hook (Design 2); routes table-cell images to the
  modal instead of inline edit mode (Design 4).

No backend/API/Prisma changes, no new node attributes.

## Data / compatibility

- No schema changes — the modal edits the exact same `annotations`/`crop`/
  `rotation` attributes via the same `updateAttributes` call already used
  inline.

## Testing

Node's built-in test runner (`node --test`):

- `isInsideTableCell`: given a fake resolved-position-shaped object (same
  fake-pos pattern already used for `findTableAtSelection`'s tests),
  returns `true` when a `tableCell`/`tableHeader` ancestor exists at any
  depth, `false` otherwise.

`useImageAnnotationDrawing` and `ImageEditModal.jsx` are DOM/React-heavy and
manual-QA'd only, matching the convention for this kind of code
(`ImageCropModal.jsx`, `useBlockDragReorder.js` are similarly untested).

Manual QA (per `docs/ai-context/ui-screen-audit-checklist.md`), 390px and
1440px, both themes:

- Insert an image inside a table cell; confirm the view-mode trigger is a
  small icon-only pencil button that fits the cell without wrapping.
- Tap/click it: the modal opens at a comfortable size, independent of the
  cell's own narrow width.
- Draw a pen/arrow/rect/text annotation, change color and line width, crop,
  and clear annotations inside the modal — all work identically to the
  inline toolset. Close with "Listo" and confirm the cell's small image
  shows the changes.
- Confirm resizing the table-cell image via its corner handles (outside the
  modal, in normal view mode) still works unchanged.
- Insert an image OUTSIDE any table and confirm its edit experience
  (pill button, inline toolbar, mode toggle) is completely unchanged from
  before this work.
- Both themes: modal contrast and the enlarged toolset layout read cleanly
  in both.
