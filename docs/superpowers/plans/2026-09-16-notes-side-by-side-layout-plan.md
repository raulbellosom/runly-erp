# Notes Editor — Automatic Side-by-Side Content Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a resized (narrower-than-100%) image float so following content (text, other images) automatically wraps into the remaining space, with tables as the one documented exception.

**Architecture:** A pure CSS change (float + a clearfix) does the actual layout work — no document/schema changes. The one piece of real logic this requires is making the drag-reorder feature's drop-position detection aware that two floated blocks can share a row (built on top of `docs/superpowers/plans/2026-09-16-notes-image-drag-reorder-plan.md`, which must be implemented first).

**Tech Stack:** React, TipTap v3 (ProseMirror), CSS, Node's built-in test runner (`node --test`).

Spec: `docs/superpowers/specs/2026-09-16-notes-side-by-side-layout-design.md`.

**Prerequisite:** `docs/superpowers/plans/2026-09-16-notes-image-drag-reorder-plan.md` must be fully implemented first — Task 3 of this plan extends `lib/dragReorder.js` and `hooks/useImageDragReorder.js`, both created by that plan.

---

### Task 1: Float the resized image node

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`

- [ ] **Step 1: Make the `NodeViewWrapper` conditionally float**

Find:

```jsx
  return (
    <NodeViewWrapper className="group/img relative my-2 block w-full">
```

Replace with:

```jsx
  // A full-width image stacks exactly as before (display:block). A resized
  // image floats instead, so whatever follows it in the note (text, another
  // image) automatically wraps into the leftover space on the same row —
  // see docs/superpowers/specs/2026-09-16-notes-side-by-side-layout-design.md.
  // Tables are the one exception (they never wrap, by design — their own
  // horizontal-scroll wrapper's `overflow-x: auto` already forces them onto
  // their own line, no extra handling needed here).
  const wrapperClass = displayWidthPct < 100
    ? 'group/img relative my-2 float-left'
    : 'group/img relative my-2 block w-full'

  return (
    <NodeViewWrapper className={wrapperClass} style={{ width: `${displayWidthPct}%` }}>
```

- [ ] **Step 2: Remove the now-redundant width from the inner `boxRef` style**

Find:

```js
  const wrapperStyle = { userSelect: 'none', width: `${displayWidthPct}%` }
```

Replace with:

```js
  const wrapperStyle = { userSelect: 'none' }
```

(The percentage width now lives on `NodeViewWrapper` itself, computed in Step 1 — `boxRef` simply fills its parent. `onResizePointerDown`'s existing math, `rect.width / (widthPct / 100)`, reads `boxRef`'s live rendered pixel width regardless of which ancestor sets the percentage, so it needs no change.)

- [ ] **Step 3: Syntax-check the file**

Run: `npx eslint apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`
Expected: no output (clean).

- [ ] **Step 4: Manual check**

Run `pnpm dev:frontend`. Resize an image to ~50% width, then type a paragraph directly after it: the paragraph's text should wrap into the remaining space beside the image, then resume full width once it clears the image's height. A full-width (100%) image should render exactly as before (no visual change). This step's full verification continues in Task 4 once the clearfix (Task 2) is also in place — a floated image with nothing after it may look broken until then.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx
git commit -m "feat(notes): float resized images so following content wraps beside them"
```

---

### Task 2: Clearfix the editor root

**Files:**
- Modify: `apps/desktop/src/styles.css`

- [ ] **Step 1: Add the clearfix**

Find (`apps/desktop/src/styles.css`):

```css
.tiptap {
  font-size: 0.9375rem;
  line-height: 1.72;
  color: hsl(var(--foreground));
  word-wrap: break-word;
  white-space: pre-wrap;
  caret-color: #f59e0b;
}
```

Replace with:

```css
.tiptap {
  font-size: 0.9375rem;
  line-height: 1.72;
  color: hsl(var(--foreground));
  word-wrap: break-word;
  white-space: pre-wrap;
  caret-color: #f59e0b;
}

/* Without this, a note ending with a floated (resized) image and nothing
   after it to clear the float collapses the editor's own height around
   that image (the classic CSS "collapsing float" bug) — breaking the
   editor's background and the tap-below-content behavior from the mobile
   image-editing fixes. Standard clearfix: an empty pseudo-element forces
   this container to include floated children in its own height. */
.tiptap::after {
  content: '';
  display: table;
  clear: both;
}
```

- [ ] **Step 2: Manual check**

Run `pnpm dev:frontend`. Create a note whose last block is a resized (narrower-than-100%) image with nothing after it. Confirm the editor's background/padding still extends correctly below the image (no visual collapse), and that tapping in the blank space below it still focuses the end of the document (the tap-below-content fix from the mobile image-editing work). Confirm no visual change to notes that don't contain any resized images.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/styles.css
git commit -m "fix(notes): clearfix the editor root so a trailing floated image doesn't collapse it"
```

---

### Task 3: Row-aware drop position for drag-reorder

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/lib/dragReorder.js`
- Modify: `apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js`
- Modify: `apps/desktop/src/modules/runly.notes/hooks/useImageDragReorder.js`

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js`:

```js
// (add to the existing import at the top of the file)
// import { ..., groupIntoRows, pickDropIndex } from '../dragReorder.js'

test('groupIntoRows: blocks that do not vertically overlap each stay in their own row', () => {
  const rects = [
    { offset: 0, top: 0, bottom: 20, left: 0, width: 300 },
    { offset: 10, top: 20, bottom: 40, left: 0, width: 300 },
  ]
  const rows = groupIntoRows(rects)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].length, 1)
  assert.equal(rows[1].length, 1)
})

test('groupIntoRows: two blocks with overlapping vertical ranges (floated side by side) group into one row', () => {
  const rects = [
    { offset: 0, top: 0, bottom: 100, left: 0, width: 150 },
    { offset: 10, top: 0, bottom: 100, left: 150, width: 150 },
  ]
  const rows = groupIntoRows(rects)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].length, 2)
})

test('pickDropIndex: single-column stacking still uses the top/bottom-half rule per block', () => {
  const rects = [
    { offset: 0, top: 0, bottom: 20, left: 0, width: 300 },
    { offset: 10, top: 20, bottom: 40, left: 0, width: 300 },
  ]
  // Near the top of the second block -> insert before it (index 1)
  assert.equal(pickDropIndex(rects, 150, 22), 1)
  // Near the bottom of the second block -> insert after it (index 2 = end)
  assert.equal(pickDropIndex(rects, 150, 38), 2)
  // Near the top of the first block -> insert before it (index 0)
  assert.equal(pickDropIndex(rects, 150, 2), 0)
})

test('pickDropIndex: two floated blocks side by side use clientX to decide between/around them', () => {
  const rects = [
    { offset: 0, top: 0, bottom: 100, left: 0, width: 150 }, // left half, x: 0-150
    { offset: 10, top: 0, bottom: 100, left: 150, width: 150 }, // right half, x: 150-300
  ]
  // Left of the first block's midpoint (x=75) -> insert before the first (index 0)
  assert.equal(pickDropIndex(rects, 50, 50), 0)
  // Between the two (past the first block's midpoint, before the second's) -> index 1
  assert.equal(pickDropIndex(rects, 200, 50), 1)
  // Past the second block's midpoint (x=225) -> insert after both (index 2)
  assert.equal(pickDropIndex(rects, 280, 50), 2)
})

test('pickDropIndex: pointer below every row inserts at the very end', () => {
  const rects = [
    { offset: 0, top: 0, bottom: 20, left: 0, width: 300 },
  ]
  assert.equal(pickDropIndex(rects, 150, 500), 1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js`
Expected: FAIL — `groupIntoRows`/`pickDropIndex` are not exported yet.

- [ ] **Step 3: Update the test file's import line**

Find (at the top of `apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js`):

```js
import { computeShiftMap, exceedsDragThreshold, DRAG_THRESHOLD_PX } from '../dragReorder.js'
```

Replace with:

```js
import { computeShiftMap, exceedsDragThreshold, DRAG_THRESHOLD_PX, groupIntoRows, pickDropIndex } from '../dragReorder.js'
```

- [ ] **Step 4: Add the implementation**

Append to `apps/desktop/src/modules/runly.notes/lib/dragReorder.js`:

```js
// ── row-aware drop position (side-by-side/floated layout) ─────────────────

/**
 * Pure: groups block rects (in document order) into visual "rows" — runs of
 * consecutive blocks whose rects vertically overlap (e.g. two floated
 * images sharing a line). A block that doesn't overlap its neighbor starts
 * a new row on its own, which is what keeps ordinary single-column content
 * behaving exactly as it did before floats existed.
 */
export function groupIntoRows(blockRects) {
  const rows = []
  for (const rect of blockRects) {
    const lastRow = rows[rows.length - 1]
    const overlapsLastRow = lastRow?.some((r) => rect.top < r.bottom && r.top < rect.bottom)
    if (overlapsLastRow) lastRow.push(rect)
    else rows.push([rect])
  }
  return rows
}

/**
 * Pure: given block rects (in document order, each needs top/bottom/
 * left/width) and a pointer position, returns the array INDEX (into the
 * flattened, document-order list — not a ProseMirror offset) to insert
 * before. Returns blockRects.length to mean "insert at the very end".
 *
 * Single-block rows use the original top/bottom-half rule (preserves
 * existing single-column behavior exactly). Multi-block rows (floated
 * siblings sharing a line) pick a position among them by comparing
 * clientX to each block's own horizontal midpoint, left to right.
 */
export function pickDropIndex(blockRects, clientX, clientY) {
  const rows = groupIntoRows(blockRects)
  let flatIndex = 0
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx]
    const rowBottom = Math.max(...row.map((r) => r.bottom))
    const isLastRow = rowIdx === rows.length - 1
    if (clientY < rowBottom || isLastRow) {
      if (row.length === 1) {
        const r = row[0]
        return clientY < r.top + (r.bottom - r.top) / 2 ? flatIndex : flatIndex + 1
      }
      const sorted = [...row].sort((a, b) => a.left - b.left)
      for (let i = 0; i < sorted.length; i++) {
        const r = sorted[i]
        if (clientX < r.left + r.width / 2) return flatIndex + i
      }
      return flatIndex + row.length
    }
    flatIndex += row.length
  }
  return blockRects.length
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js`
Expected: PASS (all tests, old and new)

- [ ] **Step 6: Extend `computeBlockRects` with the fields the new functions need**

Find:

```js
export function computeBlockRects(view) {
  const { doc } = view.state
  const rects = []
  doc.forEach((_node, offset) => {
    const dom = view.nodeDOM(offset)
    if (!dom?.getBoundingClientRect) return
    const rect = dom.getBoundingClientRect()
    rects.push({ offset, top: rect.top, height: rect.height })
  })
  return rects
}
```

Replace with:

```js
export function computeBlockRects(view) {
  const { doc } = view.state
  const rects = []
  doc.forEach((_node, offset) => {
    const dom = view.nodeDOM(offset)
    if (!dom?.getBoundingClientRect) return
    const rect = dom.getBoundingClientRect()
    rects.push({
      offset,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    })
  })
  return rects
}
```

(`computeShiftMap` only ever reads `offset` from each entry plus its own array position, so this is a purely additive, backward-compatible change — none of Task 1's existing `drag-reorder.test.js` fixtures or assertions need updating.)

- [ ] **Step 7: Make `findDropPosition` row-aware**

Find:

```js
// Finds the top-level block boundary closest to clientY and returns the
// document position to insert before. Falls back to the end of the doc.
export function findDropPosition(view, clientY) {
  const { doc } = view.state
  let pos = doc.content.size
  let found = false
  doc.forEach((node, offset) => {
    if (found) return
    const dom = view.nodeDOM(offset)
    if (!dom?.getBoundingClientRect) return
    const rect = dom.getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) {
      pos = offset
      found = true
    }
  })
  return pos
}
```

Replace with:

```js
// Finds the top-level block boundary closest to the pointer and returns the
// document position to insert before. Falls back to the end of the doc.
// Row-aware: when two blocks share a row (floated side by side), clientX
// breaks the tie instead of always picking the first one in document order —
// see pickDropIndex.
export function findDropPosition(view, clientX, clientY) {
  const { doc } = view.state
  const blockRects = computeBlockRects(view)
  if (blockRects.length === 0) return doc.content.size
  const index = pickDropIndex(blockRects, clientX, clientY)
  return index >= blockRects.length ? doc.content.size : blockRects[index].offset
}
```

- [ ] **Step 8: Update the one caller to pass `clientX`**

In `apps/desktop/src/modules/runly.notes/hooks/useImageDragReorder.js`, find:

```js
      const candidatePos = findDropPosition(view, e.clientY)
```

Replace with:

```js
      const candidatePos = findDropPosition(view, e.clientX, e.clientY)
```

- [ ] **Step 9: Run the full notes test suite**

Run: `node --test "apps/desktop/src/modules/runly.notes/lib/__tests__/*.test.js"`
Expected: PASS (all files)

- [ ] **Step 10: Syntax-check the changed files**

Run: `npx eslint apps/desktop/src/modules/runly.notes/lib/dragReorder.js apps/desktop/src/modules/runly.notes/hooks/useImageDragReorder.js`
Expected: no output (clean).

- [ ] **Step 11: Manual check**

Run `pnpm dev:frontend`. Place two images side by side (each resized to ~45-50%). Using the drag-reorder feature (press-and-hold on one of them), drag it toward the gap between the two — confirm the drop lands between them rather than always defaulting to one side. Drag it below the row entirely — confirm it drops after both. Confirm ordinary single-column dragging (no floated siblings involved) still behaves exactly as it did before this task.

- [ ] **Step 12: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/dragReorder.js \
        apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js \
        apps/desktop/src/modules/runly.notes/hooks/useImageDragReorder.js
git commit -m "feat(notes): make drag-reorder drop-position detection aware of floated rows"
```

---

### Task 4: Full verification pass

- [ ] **Step 1: Run the full notes unit test suite**

Run: `node --test "apps/desktop/src/modules/runly.notes/lib/__tests__/*.test.js"`
Expected: PASS (all files)

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Run a production build**

Run: `pnpm --filter @runly/desktop exec vite build --mode development`
Expected: builds cleanly. Remove the generated `apps/desktop/dist/` afterward (not committed).

- [ ] **Step 4: Manual QA — 390px and 1440px, both themes (per `docs/ai-context/ui-screen-audit-checklist.md`)**

- Resize an image to ~50% width; type a paragraph right after it — text wraps into the remaining space, then resumes full width once it clears the image.
- Two images resized to ~45-50% each, placed consecutively — render side by side.
- Three narrow images in a row wider than the available space — the third wraps to a new row.
- A table right after a resized image — always renders full-width, never squeezed beside it.
- A note ending with a resized (floated) image and nothing after it — editor background/click-below-content still work correctly (clearfix verification).
- A full-width (100%) image — renders identically to before this work (no regression).
- Both themes: no visual regressions in spacing around full-width images.
- Known, accepted limitation for this version (per the spec): the drag-reorder *reflow animation* while dragging through a floated row uses the dragged item's own height rather than a row-aware height — this can look slightly imperfect mid-drag even though the final drop position (Task 3) is correct. Confirm this doesn't produce an actively broken/glitchy visual, just a minor imprecision.

- [ ] **Step 5: Update `docs/TASKS.md` if it tracks notes-module work**

Add a line under the `atlas.notes` section noting the side-by-side layout and drag-reorder UX work is code-complete, with `Verified: YYYY-MM-DD (node --test + pnpm lint + vite build clean; manual QA pending)`.