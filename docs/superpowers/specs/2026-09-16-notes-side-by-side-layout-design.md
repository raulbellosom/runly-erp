# Notes Editor — Automatic Side-by-Side Content Flow

- Status: Approved (design) — Revision 2
- Date: 2026-09-16 (Revision 2: 2026-09-17)
- Module: `runly.notes` (frontend only)
- Author: Raul Belloso Medina

## Revision 2 — fixes after live testing

Revision 1 shipped, was tried live, and was reverted the same day: the drop
target during drag was hard to see, dropping near a floated pair sometimes
landed lower than expected, and images could silently queue into 3+ columns,
making the row cramped and hard to type in. The user confirmed the
Word-style automatic-flow *direction* is still right — these are bugs to fix,
not a reason to abandon the approach. Revision 2 re-ships Designs 1-4 below
unchanged, plus three additions: Design 5 (cap side-by-side to at most 2
images per row), Design 6 (a visible drop-zone indicator during drag, not
just the subtle sibling-slide), and Design 7 (row-height-aware reflow so the
visual shift and the final rest position agree).

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

### 5 — Cap side-by-side to at most 2 images per row

`ImageAnnotationOverlay.jsx` only floats an image when its width is in
`[34, 100)` percent — `displayWidthPct >= 34 && displayWidthPct < 100`
(previously any `displayWidthPct < 100` floated). Below 34% the image stays
a normal full-width block, same as 100%.

This threshold is chosen deliberately: three floated images can only ever
fit on the same row if each is under ⅓ (33.33%) of the row's width — by
requiring at least 34% to float at all, `3 × 34% = 102% > 100%`, so a third
floated image mathematically cannot fit and always wraps to its own new
row. Two images at 34%+ each fit comfortably (`68%` minimum combined,
`198%` maximum — the resize handles already clamp to `MAX_IMAGE_WIDTH_PCT`
so an individual image can't itself exceed 100%). This directly fixes the
reported "ends up 3 columns wide and hard to use" problem without needing
any JS-side column counting — it falls out of float layout's own packing
behavior once the threshold makes 3-wide arithmetically impossible.

An image resized below 34% (a small icon-like accent) is not intended to
pair with adjacent content for reading purposes and stays block-stacked,
matching its pre-side-by-side-work behavior exactly.

### 6 — A visible, authoritative drop-zone indicator during drag

Revision 1's only feedback for "where will this land" was the sibling-slide
animation (`docs/superpowers/specs/2026-09-16-notes-image-drag-reorder-design.md`,
Design 3) — subtle, and, once floated rows are involved, only an
approximation (it treats the dragged block's own height as the shift
amount for every affected sibling, which isn't exactly right when the
affected range crosses a shared row). Users found it hard to trust.

Fix: `hooks/useBlockDragReorder.js` gains a second floating overlay — a
dashed, tinted rectangle — sized and positioned directly from the exact
same values used to compute the real drop position, so it is always
accurate regardless of how precisely the secondary slide animation
approximates the physical reflow:

- Size: the dragged block's own on-screen width/height at drag start
  (measured once, same source as the existing floating clone).
- Position: at the candidate block's own `{ top, left }` when dropping
  before an existing block (row-aware — for two floated images, this is
  that specific image's own left edge, not just "the row's left edge");
  at `{ top: lastBlock.bottom, left: lastBlock.left }` when dropping past
  the end of the document.
- Created alongside the floating clone at drag start, repositioned on every
  `pointermove` (same imperative DOM-mutation approach as the clone, for
  60fps smoothness — no React re-render per frame), removed on drop/cancel.

The sibling-slide animation stays as supplementary motion feedback
(unchanged, same documented approximation as Revision 1) — the dashed box
is now the thing users are meant to trust for "where exactly will it land."

## Components / files

Changed:

- `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`
  (Design 1, 5)
- `apps/desktop/src/styles.css` (Design 2 — `.tiptap::after` clearfix)
- `apps/desktop/src/modules/runly.notes/lib/dragReorder.js` (Design 4 — only
  relevant once the image drag-reorder spec has shipped; extends its
  `findDropPosition`/`computeShiftMap`)
- `apps/desktop/src/modules/runly.notes/hooks/useBlockDragReorder.js`
  (Design 6 — the shared drag hook now used by both images and tables;
  gains the drop-zone indicator for both)

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
- Resize three images to 34%+ each and place them consecutively: only 2
  render side by side, the third wraps to its own new row. Resize one to
  33% or below: it never floats, even next to another narrow image.
- While dragging an image (mouse and touch), a dashed drop-zone box is
  clearly visible and tracks the pointer accurately, including landing at
  the correct side of a floated sibling.

## Implementation plan

This spec depends on the image drag-reorder spec
(`docs/superpowers/specs/2026-09-16-notes-image-drag-reorder-design.md`)
having shipped first for Design 4 to have something to extend — Designs 1-3
(the float itself, the clearfix, and the tables exception) have no
dependency and could ship independently if needed, but are planned together
here since they're one coherent feature.
