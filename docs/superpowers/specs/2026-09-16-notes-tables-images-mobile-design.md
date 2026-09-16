# Notes Editor — Tables, Image Resize, Camera Capture, Mobile Table Controls

- Status: Approved (design)
- Date: 2026-09-16
- Module: `runly.notes` (frontend only)
- Author: Raul Belloso Medina

## Problem

Field feedback on the `runly.notes` editor, primarily on phones:

1. Images (and other non-text content) cannot be inserted inside a table
   cell, and there is no way to resize an image once it is placed inside one.
2. Images lack resize controls: today there is a single bottom-right corner
   handle, width-only, height locked to the original aspect ratio.
3. On Android, adding an image only ever opens the gallery — there is no way
   to force the camera to open directly.
4. On mobile, table controls are effectively inaccessible: the column-resize
   handle is invisible on touch, and the "Tabla" options menu (add/delete
   row/column, delete table) is easy to lose inside a horizontally-scrolling
   toolbar.

Underlying causes found in the code:

- `lib/extensions/SlashCommand.jsx:57` — `allow: ({ editor }) =>
  !editor.isActive('codeBlock') && !editor.isActive('table')` disables the
  entire `/` menu (including image and drawing) while the cursor is inside
  any table cell. This is a codebase restriction, not a schema one:
  `@tiptap/extension-table`'s cell node declares `content: "block+"`, and the
  custom image node (`lib/extensions/AnnotatableImage.jsx:7`) is
  `group: 'block'`, so images are schema-legal inside a cell today.
- `apps/desktop/src/styles.css:681-685` — `.tiptap .tableWrapper {
  overflow-x: auto }` computes `overflow-y: auto` too (per the CSS overflow
  spec, `overflow-x` non-visible forces `overflow-y` non-visible when it
  would otherwise be `visible`), clipping the image resize handle's
  `-m-5` extended hit area (`components/ImageAnnotationOverlay.jsx:630`) near
  a table's right/bottom edge.
- `components/ImageAnnotationOverlay.jsx:618-635` — a single corner handle,
  width-only (`onResizePointerDown/Move/Up`), clamped 20-100% of the
  container (`lib/imageSize.js`); height is always `auto` (aspect-locked).
- `apps/desktop/src/styles.css:661-680` — `.column-resize-handle` is only
  `opacity: 1` on `:hover` (`td:hover`/`th:hover`) or `.resize-cursor`,
  neither of which exists on touch, so the handle is invisible on phones even
  though a touch→mouse bridge already exists
  (`components/NoteEditor.jsx:248-296`).
- `components/NoteToolbar.jsx:400-429` — the "Tabla" options menu (add/delete
  row/column/table) only renders inside the toolbar, which is
  `flex-nowrap overflow-x-auto` on small screens, and only appears when
  `editor.isActive('table')`. Reaching it on a phone means scrolling the
  toolbar to find it while the cursor is inside a table.
- `lib/noteImageUpload.js:85-87`, `components/NoteToolbar.jsx:310-320`,
  `components/NoteCoverBanner.jsx:64-110` — all three image-attach entry
  points use a bare `<input type="file" accept="image/*">` with no `capture`
  attribute, so Android's WebView always opens the document/photo chooser,
  never the camera directly. `capture="environment"` (already used in
  `apps/desktop/src/modules/runly.pfm/screens/ReceiptsScreen.jsx:106`) is
  what forces the camera app to open instead.

## Goals

1. Images and drawing blocks can be inserted inside table cells via the `/`
   menu and the toolbar image button, and resize identically to images
   outside a table.
2. Image resize gains 4 corner handles, each able to set width and height
   independently (no aspect lock), anchored at the image's fixed top-left
   corner.
3. Adding an image offers an explicit "Tomar foto" / "Elegir de galería"
   choice on touch devices; desktop behavior (single click opens the file
   picker) is unchanged.
4. On touch devices, table column resize is visible and easy to grab, and the
   row/column/table options menu is reachable via a floating control instead
   of a scrolling toolbar.

## Non-goals

- No backend, API, validator, or Prisma changes.
- No row-height resize — `@tiptap/extension-table` does not support it
  natively and it was not requested.
- No nested tables, headings, lists, quotes, or code blocks inside table
  cells — only image and drawing-canvas blocks are unblocked there.
- No true PowerPoint-style per-corner anchoring (each corner anchoring its
  opposite corner). The image node lives in normal document flow, not a free
  canvas; moving the top-left corner on drag would shift surrounding text in
  a confusing way. All 4 handles anchor at the fixed top-left corner instead
  (see Design ｣2).
- No alignment (left/center/right) or preset sizes (S/M/L/Full) for images —
  not requested; only free 4-corner resize.
- No change to the crop/rotate/annotate tools, autosave, or Yjs collaboration
  model.

## Design

### 1 — Images and drawing blocks inside table cells

`lib/extensions/SlashCommand.jsx:57`: narrow the table guard so only the
`image` and `drawingBlock` slash items stay available inside a cell; every
other item keeps `!editor.isActive('table')`:

```js
allow: ({ editor, range }) => {
  const inTable = editor.isActive('table')
  if (!inTable) return !editor.isActive('codeBlock')
  // only image + drawing are legal inside a cell
  return false // per-item override below
}
```

In practice this means moving the table/codeBlock check into each item's own
`command`/`allow`, or filtering the shown item list by
`item.allowedInTable` — implementation detail for the plan, but the rule is:
image and drawing pass inside a table, everything else does not.

`components/NoteToolbar.jsx:298-321` (image button) and
`lib/extensions/DrawingBlock.jsx` already have no table guard — verify (test)
that inserting via the toolbar while the selection is inside a cell lands the
node in that cell, not elsewhere.

CSS fix — `apps/desktop/src/styles.css:681-685`:

```css
.tiptap .tableWrapper {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  margin: 0.75rem 0;
  padding-bottom: 0.75rem; /* keeps the image resize handle's -m-5 hit area
                               from being clipped near the table's bottom edge */
}
```

A similar right-side allowance is needed if a cell in the last column can
render an image whose handle would clip at the wrapper's right edge; verified
during implementation with a table filling the full note width.

No changes needed to the resize math in `ImageAnnotationOverlay.jsx`: width
is already `%` of the nearest containing block, so it resolves correctly
against a `<td>` the same way it resolves against the note's content column.

### 2 — Free 4-corner image resize

`lib/extensions/AnnotatableImage.jsx` gains a new attribute, following the
existing `crop`/`rotation` pattern:

```js
aspectRatio: {
  default: null, // null = derive from natural image size (current behavior)
  parseHTML: (el) => {
    const raw = Number(el.getAttribute('data-aspect-ratio'))
    return Number.isFinite(raw) && raw > 0 ? raw : null
  },
  renderHTML: (attrs) =>
    attrs.aspectRatio ? { 'data-aspect-ratio': String(attrs.aspectRatio) } : {},
},
```

`components/ImageAnnotationOverlay.jsx`:

- `frameStyle.aspectRatio` uses `node.attrs.aspectRatio` when set, falling
  back to the current natural-size calculation when `null`.
- Replace the single bottom-right `<button>` handle (lines 618-635) with 4,
  one per corner (`top-left`, `top-right`, `bottom-left`, `bottom-right`),
  each a 44px pointer target (same `-m-5` trick), visually a small dot at its
  corner.
- All 4 anchor at the box's fixed top-left (confirmed — no real per-corner
  anchoring). Drag math for every handle:
  - `deltaX`/`deltaY` from the pointer's movement since pointer-down.
  - New width (px) = `startWidthPx + deltaX`, clamped so the resulting `%` of
    the container stays within `MIN_IMAGE_WIDTH_PCT..MAX_IMAGE_WIDTH_PCT`
    (`lib/imageSize.js`, unchanged constants).
  - New height (px) = `startHeightPx + deltaY`, clamped to a minimum
    (`MIN_IMAGE_HEIGHT_PX = 40`, new constant in `imageSize.js`), no maximum.
  - Live preview mirrors the existing `liveWidthPct` pattern
    (`liveWidthPct`/`liveAspectRatio` state during drag).
  - On pointer-up: `updateAttributes({ width: Math.round(newWidthPct),
    aspectRatio: newWidthPx / newHeightPx })`.
- Because all handles share the same top-left anchor, `top-left` and
  `bottom-left` behave identically to `top-right`/`bottom-right` for the
  horizontal axis (dragging left/right of the fixed anchor still changes
  width the same way) — the practical benefit is 4 large, easy-to-grab touch
  targets instead of 1, plus independent height everywhere.
- Applies identically to images inside table cells (Design 1) — no special
  casing.

### 3 — Camera vs. gallery choice (touch devices)

New shared component, `packages/ui/src/components/ImageSourceSheet.jsx`
(added per the UI-first policy — this pattern applies beyond notes):

```jsx
<ImageSourceSheet
  open={open}
  onOpenChange={setOpen}
  onPickFile={(file) => handleImageFile(file)}
/>
```

- Built on `Sheet`/`SheetContent` (bottom sheet on mobile automatically via
  `useIsMobile`). Two rows: "Tomar foto" (camera icon) and "Elegir de
  galería" (image icon).
- Each row is backed by its own hidden `<input type="file" accept="image/*">`
  — "Tomar foto" adds `capture="environment"` (same attribute already used in
  `apps/desktop/src/modules/runly.pfm/screens/ReceiptsScreen.jsx:106`),
  "Elegir de galería" has none. Clicking a row programmatically clicks its
  input; the input's `onChange` calls `onPickFile(file)` and closes the sheet.
- Exported from `packages/ui/src/index.js`; documented in
  `docs/ai-context/rme3-runtime-capabilities.md`.

Integration in `runly.notes` (3 call sites), gated by
`useCoarsePointer()` (`packages/ui/src/hooks/usePointerCapabilities.js`,
already exists):

- `components/NoteToolbar.jsx:298-321` — the image `<label>`/input becomes: on
  coarse pointer, a plain button that opens `ImageSourceSheet`; on fine
  pointer (desktop), unchanged (`<label>` + hidden plain input, single click).
- `lib/noteImageUpload.js` (`pickAndUploadNoteImage`, used by the slash
  command) — same branch: coarse pointer opens the sheet via a small promise
  wrapper, fine pointer keeps the direct file dialog.
- `components/NoteCoverBanner.jsx:64-110` — same treatment for the cover
  image inputs.

### 4 — Mobile table controls

CSS, `apps/desktop/src/styles.css:661-680`:

```css
.tiptap .column-resize-handle {
  /* ...unchanged base rule... */
  width: 6px;
}
@media (pointer: coarse) {
  .tiptap .column-resize-handle {
    opacity: 1;   /* :hover never fires on touch — always visible instead */
    width: 12px;  /* wider hit target; touch bridge already targets this element */
  }
}
```

New component, `components/TableFloatingMenu.jsx`:

- Rendered from `NoteEditor.jsx` (sibling of `NoteToolbar`, inside the scroll
  container) alongside the editor, not inside the toolbar.
- Visible when `editor.isActive('table')` **and** `useCoarsePointer()` is
  true. A single round floating button fixed near the bottom-right of the
  editor viewport (above any safe-area inset), `Table2` icon.
- Tapping it opens a `Sheet` (bottom) with the same items as
  `NoteToolbar.jsx`'s existing `TableMenuItem` list (add column
  before/after, add row before/after, delete column/row/table) — same
  `editor.chain().focus()...run()` calls, just presented as sheet rows
  instead of popover rows.
- On fine pointer (desktop), nothing changes — `NoteToolbar.jsx:400-429`'s
  inline popover stays exactly as it is today, and `TableFloatingMenu` does
  not render.

## Components / files

New:

- `packages/ui/src/components/ImageSourceSheet.jsx`
- `apps/desktop/src/modules/runly.notes/components/TableFloatingMenu.jsx`

Changed:

- `apps/desktop/src/modules/runly.notes/lib/extensions/SlashCommand.jsx`
- `apps/desktop/src/modules/runly.notes/lib/extensions/AnnotatableImage.jsx`
- `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`
- `apps/desktop/src/modules/runly.notes/lib/imageSize.js`
- `apps/desktop/src/modules/runly.notes/lib/noteImageUpload.js`
- `apps/desktop/src/modules/runly.notes/components/NoteToolbar.jsx`
- `apps/desktop/src/modules/runly.notes/components/NoteCoverBanner.jsx`
- `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx`
- `apps/desktop/src/styles.css`
- `packages/ui/src/index.js` (export `ImageSourceSheet`)
- `docs/ai-context/rme3-runtime-capabilities.md` (document `ImageSourceSheet`)

## Data / compatibility

- `aspectRatio` defaults to `null`; existing images keep rendering with their
  current natural-aspect behavior until a user drags a corner handle.
- No migration — both new attributes (`aspectRatio`) round-trip through
  stored note HTML the same way `crop`/`rotation` already do.
- `ImageSourceSheet` and the coarse-pointer gating are additive; desktop
  upload flows are byte-for-byte unchanged.

## Testing

Node's built-in runner (`node --test`), matching repo convention. Pure-logic
units only; DOM/TipTap/touch interaction is verified manually.

- `lib/imageSize.js`: new `clampImageHeightPx` (or equivalent) helper —
  clamps to `MIN_IMAGE_HEIGHT_PX`, no upper bound.
- Corner-resize geometry helper (extracted from `ImageAnnotationOverlay.jsx`):
  given a start box + pointer delta for each of the 4 corners, returns the
  same `{ widthPct, aspectRatio }` regardless of which corner was dragged
  (top-left-anchored math).
- `SlashCommand.jsx` item filter: given `editor.isActive('table') === true`,
  only `image` and `drawingBlock` remain in the filtered item list.

Manual QA (per `docs/ai-context/ui-screen-audit-checklist.md`), screenshots
at 390px and 1440px (both themes):

- Insert an image and a drawing block inside a table cell via `/` and via the
  toolbar button; confirm other slash items stay blocked in cells.
- Resize an image (in and out of a table cell) from all 4 corners; confirm
  independent width/height, and that the handle is not clipped near a table
  edge.
- On a touch-emulated viewport: tap the image button — sheet appears with
  "Tomar foto" / "Elegir de galería"; on desktop, a single click opens the
  file dialog directly (no sheet).
- On a touch-emulated viewport: the column-resize handle is visible without
  hovering, and dragging it resizes the column; with the cursor in a table,
  the floating "Tabla" button appears and its sheet exposes add/delete
  row/column/table.
- Desktop (1440px, mouse): toolbar's inline "Tabla" popover behaves exactly
  as before; no floating button appears.

## Implementation plan split

- **Plan A — Tables:** `SlashCommand.jsx` cell guard narrowing, tableWrapper
  CSS clipping fix, always-visible + wider column-resize handle on coarse
  pointer, `TableFloatingMenu` + bottom-sheet table options. Covers points 1
  (table-cell insertion) and 4.
- **Plan B — Images:** `aspectRatio` attribute, 4-corner free resize math and
  handles, `ImageSourceSheet` in `@runly/ui` + integration across the 3
  image-attach entry points. Covers points 2 and 3.

Plan A and Plan B are independent (no shared new state), but both touch
`NoteEditor.jsx` (Plan A adds `TableFloatingMenu`, Plan B's resize changes are
scoped to `ImageAnnotationOverlay.jsx`) — low collision risk, either order
works.
