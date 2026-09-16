# Notes Editor — Automatic Side-by-Side Content Flow

- Status: Approved (design)
- Date: 2026-09-16
- Module: `runly.notes` (frontend only)
- Author: Raul Belloso Medina

## Problem

Every block in a note (`components/NoteEditor.jsx`'s `.tiptap` editable
root) always renders full-width and stacks vertically, regardless of how
narrow an image has been resized. Resizing an image down to, say, 50% width
(via the 4-corner resize handles from the tables/images/mobile-controls
work) leaves the other 50% of that row empty — nothing else can render
beside it, even when there is clearly room. There is no way to place two
images side by side, or an image next to a paragraph of text, without
manually accepting a lot of wasted horizontal space.

## Goals

1. Any image resized narrower than 100% width automatically shares its row
   with whatever content follows it in the note (another image, a
   paragraph, a heading, a list) — no explicit user action to "create a
   layout" is required.
2. Two (or more) narrow images placed consecutively naturally queue up side
   by side, wrapping to a new row once they run out of horizontal space.
3. Once enough following content has rendered to clear the image's height,
   subsequent blocks resume full width automatically.
4. This requires no changes to the note's underlying document structure —
   it is still a flat, ordered list of blocks, exactly as today. Only how a
   narrower-than-100%-width image *renders* changes.

## Non-goals

- No per-image left/right alignment control in this version — every
  resized image floats left by default. A future alignment toggle is
  possible but not part of this work.
- No explicit "columns" block/container concept (Notion-style deliberate
  multi-column layout) — this is purely automatic, space-driven flow.
- **Tables are the one exception and never wrap beside a floated image.**
  `.tiptap .tableWrapper` (`apps/desktop/src/styles.css`) needs
  `overflow-x: auto` for horizontal scroll on narrow screens (a real,
  already-shipped feature) — an element with its own `overflow` value other
  than `visible` establishes a new block formatting context, which by the
  CSS spec means it does not wrap around floats at all, regardless of any
  styling we could add on top. A table will always render on its own
  full-width line below/after any floated image. Everything else
  (paragraphs, headings, lists, blockquotes, other images) does wrap.
- No change to the drag-reorder UX design
  (`docs/superpowers/specs/2026-09-16-notes-image-drag-reorder-design.md`)
  itself — this spec only describes the additional 2D-awareness that
  design's drop-position/reflow math needs once floated rows exist (Design
  4 below).

## Design

### 1 — Floating the image node

`ImageAnnotationOverlay.jsx`'s `NodeViewWrapper`
(currently `ImageAnnotationOverlay.jsx:447`,
`className="group/img relative my-2 block w-full"`) becomes conditional on
`displayWidthPct`:

- `displayWidthPct === 100` (full width, the common/default case): unchanged
  — `block w-full`, no float, stacks exactly as today.
- `displayWidthPct < 100`: `float-left` instead of `block w-full`, with an
  inline `style={{ width: `${displayWidthPct}%` }}` on the wrapper itself
  (moved up from the inner `boxRef`, which no longer needs its own width —
  it simply fills its now-correctly-sized floated parent).

No other part of `ImageAnnotationOverlay.jsx` changes: the resize handles'
own math (`onResizePointerDown`, `ImageAnnotationOverlay.jsx:132-149`)
already reads `boxRef.current.getBoundingClientRect().width` — the actual
rendered pixel width — which is correct regardless of which ancestor
element carries the percentage style.

### 2 — Preventing the classic "collapsed float" container bug

`.tiptap` (`apps/desktop/src/styles.css:464`, the editable root) has no
`overflow` property today, so if its last rendered child ends up floated
with nothing after it to clear the float, the container's own height
collapses around the float per standard CSS behavior — visually breaking
the editor's background/padding and the tap-below-content fix from the
mobile image-editing work (which relies on the container actually having a
real height to catch clicks in). Fix: add the standard clearfix to `.tiptap`
itself:

```css
.tiptap::after {
  content: '';
  display: table;
  clear: both;
}
```

This is a well-established, side-effect-free technique (an empty
table-display pseudo-element that only exists to force the container to
include floated children in its own height) — it does not affect any
existing layout, spacing, or the first-paragraph title styling.

### 3 — Tables stay full-width (the documented exception)

No change needed — this falls out naturally from `.tiptap .tableWrapper`'s
existing `overflow-x: auto` (kept for mobile horizontal table scroll). No
extra CSS is required to force tables to clear; they already will, as a
side effect of that pre-existing rule. This is called out explicitly here
so a future contributor doesn't "fix" tables into wrapping and reintroduce
the mobile horizontal-scroll regression it would require reverting.

### 4 — Drop-position math becomes row-aware for drag-reorder

With floats in play, `lib/dragReorder.js`'s `findDropPosition` (today: a
single linear walk comparing only `clientY` against each top-level block's
vertical midpoint) can no longer assume one block occupies each row. Two
floated images side by side share the same vertical range but different
horizontal ranges.

`findDropPosition` (and `computeBlockRects`/`computeShiftMap` from the
drag-reorder spec) are extended to consider `clientX` as a tiebreaker:

- If the pointer's Y is entirely above a block's rect, that block is a
  candidate boundary exactly as today (unchanged case — this is what
  handles all non-floated, single-column stacking, which is still the
  overwhelming majority of content).
- If the pointer's Y falls WITHIN a block's own vertical range (i.e. the
  pointer is hovering over a row that contains a floated block), the
  candidate boundary is decided by comparing `clientX` to that block's own
  horizontal midpoint — before the block if the pointer is on its left half,
  after it if on its right half. This correctly resolves "drop between two
  side-by-side images" instead of only ever considering vertical position.

The sibling-reflow *animation* during drag (`computeShiftMap`) uses a
simpler, deliberately-scoped approximation for this first version: it
treats an entire floated row as a single unit for the shift calculation
(the whole row shifts together) rather than animating individual floated
items within a row independently. This keeps the reflow math tractable
while still being visually correct for the common cases (dragging into/out
of a single floated pair, or past a row entirely).

## Components / files

Changed:

- `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`
  (Design 1)
- `apps/desktop/src/styles.css` (Design 2 — `.tiptap::after` clearfix)
- `apps/desktop/src/modules/runly.notes/lib/dragReorder.js` (Design 4 — only
  relevant once the image drag-reorder spec has shipped; extends its
  `findDropPosition`/`computeShiftMap`)

No new files, no `@runly/ui` changes, no backend/API/Prisma changes, no new
node attributes.

## Data / compatibility

- No schema or attribute changes. A note's stored HTML is unaffected —
  `width` already exists as a percentage attribute on the image node; this
  work only changes how that percentage is interpreted at render time
  (float vs. block).
- Existing notes with resized images automatically gain the new
  side-by-side behavior on next render — no migration, no re-save needed.

## Testing

Node's built-in test runner (`node --test`) for the row-aware
`findDropPosition` logic (Design 4) — extending the drag-reorder spec's
existing test coverage with cases for two same-row blocks and a
left/right `clientX` tiebreak.

Manual QA (per `docs/ai-context/ui-screen-audit-checklist.md`), 390px and
1440px, both themes:

- Resize an image to ~50% width; type a paragraph right after it — the
  paragraph's text wraps into the remaining space beside the image, then
  resumes full width once it clears the image's height.
- Place two images each resized to ~45-50% width consecutively — they
  render side by side, not stacked.
- Resize three narrow images in a row wider than the available space — the
  third wraps to a new row.
- Insert a table right after a resized image — the table always renders
  full-width, never squeezed into the leftover space (documented
  exception).
- A note ending with a resized (floated) image and nothing after it: the
  editor's background/clickable area still extends correctly below the
  image (clearfix verification) and the tap-below-content behavior from the
  mobile image-editing fixes still works.
- Both themes: no visual regressions in spacing/margins around images that
  are still full-width (100%) — those should render byte-for-byte as before
  this change.

## Implementation plan

This spec depends on the image drag-reorder spec
(`docs/superpowers/specs/2026-09-16-notes-image-drag-reorder-design.md`)
having shipped first for Design 4 to have something to extend — Designs 1-3
(the float itself, the clearfix, and the tables exception) have no
dependency and could ship independently if needed, but are planned together
here since they're one coherent feature.
