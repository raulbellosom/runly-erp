# Notes Editor — Image Drag-Reorder UX

- Status: Approved (design)
- Date: 2026-09-16
- Module: `runly.notes` (frontend only)
- Author: Raul Belloso Medina

## Problem

Reordering an image today (`components/ImageAnnotationOverlay.jsx`) has two
problems:

1. The dedicated "move" grip button
   (`ImageAnnotationOverlay.jsx:663-673`, rendered in the same top-right
   corner area as "Editar imagen") sits close enough to the top-right corner
   resize handle's 44px extended hit area
   (`ImageAnnotationOverlay.jsx:688-705`, `-m-5` on a button anchored exactly
   at that corner) that the resize handle's touch target intercepts taps
   meant for the move handle, making it hard to grab.
2. While dragging, the only feedback is a thin 2px amber line
   (`ImageAnnotationOverlay.jsx:710-715`, the `dropIndicator` div) at the
   candidate drop position. There is no visual representation of the image
   actually moving — nothing lifts, nothing follows the pointer, and nothing
   else on screen shifts to show where the gap will open.

## Goals

1. Remove the dedicated move-handle button; pressing and holding the image
   itself (anywhere on its body, excluding the corner resize handles and the
   "Editar imagen" button) initiates a reorder drag.
2. A quick tap still selects the image (shows resize handles) exactly as
   today — only a press that moves past a threshold becomes a drag.
3. On touch, a ~450ms hold-in-place is required before the drag arms, so an
   ordinary scroll gesture that happens to start on an image is never
   hijacked. On mouse, dragging starts as soon as the pointer moves past a
   small pixel threshold while the primary button is held — no delay.
4. While dragging: the image visually lifts (scale + shadow) and follows the
   pointer directly, offset from wherever it was grabbed. Every top-level
   block between the image's original position and the current candidate
   position smoothly slides out of the way in real time, leaving a
   correctly-sized gap exactly where the image will land.
5. Releasing commits the move (same document mutation as today —
   `moveNode` in `lib/dragReorder.js`); releasing without ever exceeding the
   drag threshold selects the image instead, with no document change.

## Non-goals

- No change to reordering scope — this still only reorders among the note's
  top-level blocks, exactly like today's drag already does. Dragging an
  image into or out of a table cell is out of scope.
- No support for dragging any block type other than images (paragraphs,
  tables, headings, etc. still cannot be reordered by dragging) — unchanged
  from today.
- No changes to the 4-corner resize handles, the edit-mode toolbar, or
  click-to-select — those keep working exactly as shipped.
- This spec assumes today's plain vertical block-stacking layout. The
  side-by-side/float layout project
  (`docs/superpowers/specs/2026-09-16-notes-side-by-side-layout-design.md`)
  is designed separately and, when implemented, will extend the drop-position
  and reflow logic described here to be aware of floated rows — described
  there, not here.

## Design

### 1 — Drag initiation replaces the move-handle button

`ImageAnnotationOverlay.jsx`'s view-mode controls
(`ImageAnnotationOverlay.jsx:647-675`) drop the dedicated grip button
entirely. Instead, the `boxRef` div itself (`ImageAnnotationOverlay.jsx:448`,
already the click target for `onImageClick`) gets the drag pointer handlers:

- `onPointerDown`: records `{ pointerId, startX, startY }` and, on touch
  (`e.pointerType === 'touch'`), starts a ~450ms timer. If the pointer moves
  more than a small threshold (e.g. 8px) before the timer fires, the timer is
  cancelled and nothing else happens (this pointer gesture is left alone —
  the browser's native scroll takes over, since we never called
  `preventDefault`/set `touch-action: none` yet). On mouse
  (`e.pointerType === 'mouse'`), there is no timer — movement past the same
  small threshold immediately arms the drag.
- Once armed (timer fires on touch, or threshold crossed on mouse): the drag
  officially starts — this is the point at which `e.preventDefault()` /
  `setPointerCapture` happen, a floating clone is created (Design 2), and the
  subsequent `pointermove`s drive the drag instead of a click.
- `onPointerUp`: if the drag never armed, the browser's native `click` event
  fires afterward as always, which still hits `onImageClick` and selects the
  image — no special handling needed for the "just a tap" case. If the drag
  DID arm, the move is committed (or cancelled) and a flag suppresses the
  click that follows (browsers still fire `click` after `pointerup` even
  when there was movement in between) so the drop doesn't ALSO trigger
  "select".

The 4 corner resize handles (`ImageAnnotationOverlay.jsx:688-705`) and
"Editar imagen" (`ImageAnnotationOverlay.jsx:656-662`) already/will call
`e.stopPropagation()` in addition to their existing `preventDefault()`, so a
press on either of them never reaches the new body-level drag listener.

### 2 — Floating clone follows the pointer; original hides in place

On drag arm, `boxRef.current` (the sized image box, including its frame,
current crop/rotation rendering — everything already visible) is cloned via
`cloneNode(true)` into a `position: fixed` element appended to
`document.body`, sized and positioned to exactly overlay the original at the
moment of grabbing (same pattern already used for chat's clone-and-lift
spotlight interaction — see project memory `project_chat_action_sheet_mobile_2026_09_09`).
The clone gets a subtle lift treatment (slight `scale(1.03)`, drop shadow)
and `pointer-events: none`. On each `pointermove`, the clone's `left`/`top`
update to track the pointer, offset by the same relative grab point recorded
at drag start (so the image doesn't jump to be centered under the cursor —
it stays "held" where you grabbed it).

The original `boxRef` element's opacity is set to `0` for the duration of the
drag (it still occupies its layout slot — this matters for Design 3's
reflow math, which treats the gap as still being physically present in the
document until drop).

### 3 — Continuous sibling reflow

`lib/dragReorder.js` gains two additions, both pure and testable against a
plain array of block rects (no live DOM needed for the math itself):

```
computeBlockRects(view) -> [{ offset, top, height }, ...]   // one entry per top-level doc child, in document order
computeShiftMap({ blockRects, originalIndex, candidateIndex, draggedHeightPx })
  -> Map<offset, shiftPx>   // 0 for blocks outside the [original, candidate) range
```

`computeShiftMap`'s rule: every block strictly between the dragged image's
original index and the current candidate index shifts by `draggedHeightPx`,
direction depending on drag direction (dragging down: those blocks shift up
by `draggedHeightPx`; dragging up: they shift down by `draggedHeightPx`).
Blocks outside that range get `0` (no shift). This is the same math used by
common reorderable-list libraries (e.g. dnd-kit) — moving blocks visually
slide into the gap left behind, opening an equivalent gap at the candidate
position, with no document mutation happening until drop.

The result is applied imperatively (not via React state/re-render, for
smooth 60fps dragging) — `view.nodeDOM(offset).style.transform =
'translateY(...)'` plus a shared `transition: transform 150ms ease` class
toggled on for the duration of the drag, so each shift animates smoothly as
the candidate position changes. On drop or cancel, every affected node's
inline `transform` is cleared.

### 4 — Drop / cancel

On `pointerup` while armed: the clone and all sibling shift-transforms are
removed, and `moveNode(editor, originalPos, candidatePos)` — the same
function used today — commits the actual document change. On
`pointercancel` (or if the drag is aborted for any reason): the same
cleanup runs, but `moveNode` is never called, so nothing changes in the
document.

## Components / files

Changed:

- `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`
  — drag initiation moved to the image body; move-handle button removed;
  floating clone creation/tracking; drag-armed state.
- `apps/desktop/src/modules/runly.notes/lib/dragReorder.js` — new
  `computeBlockRects` and `computeShiftMap` pure functions, alongside the
  existing `findDropPosition`/`moveNode`.

No new files, no `@runly/ui` changes, no backend/API/Prisma changes.

## Data / compatibility

- No node attribute or schema changes — this is purely an interaction/visual
  change to how an existing move already happens.

## Testing

Node's built-in test runner (`node --test`). Pure logic only:

- `computeShiftMap`: given a set of block rects and an original/candidate
  index pair, returns the correct shift (`0`, `+draggedHeightPx`, or
  `-draggedHeightPx`) for each block, for both drag-down and drag-up cases,
  and for the "candidate equals original" (no-op) case.

Manual QA (per `docs/ai-context/ui-screen-audit-checklist.md`), 390px
(touch-emulated) and 1440px (mouse), both themes:

- Quick tap on an image still selects it (shows resize handles); no move
  happens.
- Touch: pressing and holding under 450ms, or moving significantly before
  450ms elapses, does NOT start a drag — normal page scroll still works when
  starting a touch on an image.
- Touch: holding past 450ms without much movement arms the drag (visible
  lift cue); moving afterward drags the image, with siblings sliding out of
  the way in real time and a gap opening at the candidate position.
- Mouse: pressing and dragging past a few pixels starts the drag immediately,
  same sibling-reflow behavior.
- Releasing commits the move to the new position; releasing without ever
  arming the drag leaves the document unchanged (just selects).
- Dragging near the very top or very bottom of the note reorders correctly
  (edge cases for `computeShiftMap`'s range boundaries).
