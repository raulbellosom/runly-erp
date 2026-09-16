# Notes Editor — Side-by-Side Fixes + Table-Cell Image Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-ship the automatic side-by-side image layout with three fixes (max 2 per row, a visible drop-zone indicator, restored row-aware drop position), and add modal-based editing for images inside table cells (their inline controls don't fit).

**Architecture:** The side-by-side fixes re-apply and extend the work already designed once (float layout, clearfix, row-aware `dragReorder.js`) plus a new pure `computeIndicatorRect` helper and a second floating overlay in `useBlockDragReorder.js`. The table-cell modal work extracts the existing annotation-drawing logic out of `ImageAnnotationOverlay.jsx` into a shared hook, then builds a new modal component that reuses it.

**Tech Stack:** React, TipTap v3 (ProseMirror), `@runly/ui`, Node's built-in test runner (`node --test`).

Specs:
- `docs/superpowers/specs/2026-09-16-notes-side-by-side-layout-design.md` (Revision 2)
- `docs/superpowers/specs/2026-09-17-notes-table-cell-image-modal-design.md`

---

### Task 1: Float resized images, capped to 2 per row

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`

- [ ] **Step 1: Make the wrapper conditionally float, capped at 34%+**

Find:

```js
  const wrapperStyle = { userSelect: 'none', width: `${displayWidthPct}%` }
```

Replace with:

```js
  const wrapperStyle = { userSelect: 'none' }
  // Float only when width is in [34, 100) — three floated images can only
  // ever fit on a row if each is under 1/3 (33.33%) of it, so requiring at
  // least 34% to float makes 3-wide arithmetically impossible: 3*34=102>100.
  // Below 34%, the image stays a normal full-width block (a small
  // icon-like image isn't meant to pair with adjacent content for reading).
  const canFloat = displayWidthPct >= 34 && displayWidthPct < 100
  const wrapperClass = canFloat
    ? 'group/img relative my-2 float-left'
    : 'group/img relative my-2 block w-full'
```

- [ ] **Step 2: Use the computed class + width on `NodeViewWrapper`**

Find:

```jsx
  return (
    <NodeViewWrapper className="group/img relative my-2 block w-full">
```

Replace with:

```jsx
  return (
    <NodeViewWrapper className={wrapperClass} style={{ width: `${displayWidthPct}%` }}>
```

- [ ] **Step 3: Syntax-check**

Run: `npx eslint apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx
git commit -m "feat(notes): float resized images (34%+) so following content wraps beside them, max 2 per row"
```

---

### Task 2: Clearfix the editor root

**Files:**
- Modify: `apps/desktop/src/styles.css`

- [ ] **Step 1: Add the clearfix**

Find:

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

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/styles.css
git commit -m "fix(notes): clearfix the editor root so a trailing floated image doesn't collapse it"
```

---

### Task 3: Row-aware drop position

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/lib/dragReorder.js`
- Modify: `apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js`
- Modify: `apps/desktop/src/modules/runly.notes/hooks/useBlockDragReorder.js`

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js`:

```js
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
  assert.equal(pickDropIndex(rects, 150, 22), 1)
  assert.equal(pickDropIndex(rects, 150, 38), 2)
  assert.equal(pickDropIndex(rects, 150, 2), 0)
})

test('pickDropIndex: two floated blocks side by side use clientX to decide between/around them', () => {
  const rects = [
    { offset: 0, top: 0, bottom: 100, left: 0, width: 150 },
    { offset: 10, top: 0, bottom: 100, left: 150, width: 150 },
  ]
  assert.equal(pickDropIndex(rects, 50, 50), 0)
  assert.equal(pickDropIndex(rects, 200, 50), 1)
  assert.equal(pickDropIndex(rects, 280, 50), 2)
})

test('pickDropIndex: pointer below every row inserts at the very end', () => {
  const rects = [
    { offset: 0, top: 0, bottom: 20, left: 0, width: 300 },
  ]
  assert.equal(pickDropIndex(rects, 150, 500), 1)
})
```

Update the import line at the top of the same file:

```js
import { computeShiftMap, exceedsDragThreshold, DRAG_THRESHOLD_PX, findTableAtSelection } from '../dragReorder.js'
```

becomes:

```js
import {
  computeShiftMap, exceedsDragThreshold, DRAG_THRESHOLD_PX, findTableAtSelection,
  groupIntoRows, pickDropIndex,
} from '../dragReorder.js'
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js`
Expected: FAIL — `groupIntoRows`/`pickDropIndex` not exported yet.

- [ ] **Step 3: Extend `computeBlockRects` with the fields the new functions need**

Find (in `apps/desktop/src/modules/runly.notes/lib/dragReorder.js`):

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

- [ ] **Step 4: Make `findDropPosition` row-aware and add `groupIntoRows`/`pickDropIndex`**

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

- [ ] **Step 6: Update the hook's call site to pass `clientX`**

In `apps/desktop/src/modules/runly.notes/hooks/useBlockDragReorder.js`, find:

```js
      const candidatePos = findDropPosition(view, e.clientY)
```

Replace with:

```js
      const candidatePos = findDropPosition(view, e.clientX, e.clientY)
```

- [ ] **Step 7: Run the full notes test suite + syntax-check**

Run: `node --test "apps/desktop/src/modules/runly.notes/lib/__tests__/*.test.js"`
Expected: PASS (all files)

Run: `npx eslint apps/desktop/src/modules/runly.notes/lib/dragReorder.js apps/desktop/src/modules/runly.notes/hooks/useBlockDragReorder.js`
Expected: no output (clean).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/dragReorder.js \
        apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js \
        apps/desktop/src/modules/runly.notes/hooks/useBlockDragReorder.js
git commit -m "feat(notes): make drag-reorder drop-position detection aware of floated rows"
```

---

### Task 4: Visible drop-zone indicator during drag

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/lib/dragReorder.js`
- Modify: `apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js`
- Modify: `apps/desktop/src/modules/runly.notes/hooks/useBlockDragReorder.js`

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js`, and add `computeIndicatorRect` to the existing import line:

```js
test('computeIndicatorRect: positions at the candidate block\'s own top-left when dropping before it', () => {
  const rects = [
    { offset: 0, top: 0, bottom: 20, left: 0, width: 300 },
    { offset: 10, top: 20, bottom: 40, left: 150, width: 150 },
  ]
  const rect = computeIndicatorRect(rects, 1, 80, 60)
  assert.deepEqual(rect, { top: 20, left: 150, width: 80, height: 60 })
})

test('computeIndicatorRect: positions below the last block when dropping past the end', () => {
  const rects = [
    { offset: 0, top: 0, bottom: 20, left: 0, width: 300 },
    { offset: 10, top: 20, bottom: 40, left: 0, width: 300 },
  ]
  const rect = computeIndicatorRect(rects, 2, 80, 60)
  assert.deepEqual(rect, { top: 40, left: 0, width: 80, height: 60 })
})

test('computeIndicatorRect: an empty document positions at the origin', () => {
  const rect = computeIndicatorRect([], 0, 80, 60)
  assert.deepEqual(rect, { top: 0, left: 0, width: 80, height: 60 })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js`
Expected: FAIL — `computeIndicatorRect` not exported yet.

- [ ] **Step 3: Add the implementation**

Append to `apps/desktop/src/modules/runly.notes/lib/dragReorder.js`:

```js
/**
 * Pure: given block rects (document order), the candidate drop array index
 * (from pickDropIndex), and the dragged block's own width/height in px,
 * returns the exact `{ top, left, width, height }` rect a visible drop-zone
 * indicator should occupy. Positioned at the candidate block's own
 * top-left (row-aware — lands beside a specific floated sibling, not just
 * "the row"), or below the last block when dropping past the end.
 */
export function computeIndicatorRect(blockRects, candidateIndex, widthPx, heightPx) {
  if (candidateIndex < blockRects.length) {
    const r = blockRects[candidateIndex]
    return { top: r.top, left: r.left, width: widthPx, height: heightPx }
  }
  const last = blockRects[blockRects.length - 1]
  return {
    top: last ? last.bottom : 0,
    left: last ? last.left : 0,
    width: widthPx,
    height: heightPx,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Wire the indicator into `useBlockDragReorder.js`**

Add `computeIndicatorRect` to the existing import:

```js
import {
  findDropPosition, moveNode, computeBlockRects, computeShiftMap,
  exceedsDragThreshold, LONG_PRESS_MS,
} from '../lib/dragReorder.js'
```

becomes:

```js
import {
  findDropPosition, moveNode, computeBlockRects, computeShiftMap,
  exceedsDragThreshold, LONG_PRESS_MS, computeIndicatorRect,
} from '../lib/dragReorder.js'
```

Add an indicator style constant next to `CLONE_LIFT_STYLE`:

```js
const INDICATOR_STYLE = {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: 9998,
  border: '2px dashed #f59e0b',
  borderRadius: '8px',
  backgroundColor: 'rgba(245, 158, 11, 0.08)',
  transition: 'top 120ms ease, left 120ms ease',
}
```

In `startDrag`, find:

```js
    const clone = frameEl.cloneNode(true)
    Object.assign(clone.style, CLONE_LIFT_STYLE, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
    document.body.appendChild(clone)
    boxEl.style.opacity = '0'

    dragRef.current = {
      pointerId: e.pointerId,
      originalPos,
      originalIndex,
      blockRects,
      draggedHeightPx: rect.height,
      cloneEl: clone,
      grabDX: e.clientX - rect.left,
      grabDY: e.clientY - rect.top,
      candidatePos: originalPos,
    }
```

Replace with:

```js
    const clone = frameEl.cloneNode(true)
    Object.assign(clone.style, CLONE_LIFT_STYLE, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
    document.body.appendChild(clone)

    const indicator = document.createElement('div')
    Object.assign(indicator.style, INDICATOR_STYLE, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
    document.body.appendChild(indicator)

    boxEl.style.opacity = '0'

    dragRef.current = {
      pointerId: e.pointerId,
      originalPos,
      originalIndex,
      blockRects,
      draggedWidthPx: rect.width,
      draggedHeightPx: rect.height,
      cloneEl: clone,
      indicatorEl: indicator,
      grabDX: e.clientX - rect.left,
      grabDY: e.clientY - rect.top,
      candidatePos: originalPos,
    }
```

In `onPointerMove`, find:

```js
      active.candidatePos = candidatePos
      active.cloneEl.style.left = `${e.clientX - active.grabDX}px`
      active.cloneEl.style.top = `${e.clientY - active.grabDY}px`
      return
```

Replace with:

```js
      active.candidatePos = candidatePos
      active.cloneEl.style.left = `${e.clientX - active.grabDX}px`
      active.cloneEl.style.top = `${e.clientY - active.grabDY}px`
      const indicatorRect = computeIndicatorRect(active.blockRects, candidateIndex, active.draggedWidthPx, active.draggedHeightPx)
      active.indicatorEl.style.left = `${indicatorRect.left}px`
      active.indicatorEl.style.top = `${indicatorRect.top}px`
      active.indicatorEl.style.width = `${indicatorRect.width}px`
      active.indicatorEl.style.height = `${indicatorRect.height}px`
      return
```

In `cleanupDrag`, find:

```js
    d.cloneEl?.remove()
    const boxEl = getBoxEl()
    if (boxEl) boxEl.style.opacity = ''
    dragRef.current = null
```

Replace with:

```js
    d.cloneEl?.remove()
    d.indicatorEl?.remove()
    const boxEl = getBoxEl()
    if (boxEl) boxEl.style.opacity = ''
    dragRef.current = null
```

- [ ] **Step 6: Syntax-check**

Run: `npx eslint apps/desktop/src/modules/runly.notes/hooks/useBlockDragReorder.js apps/desktop/src/modules/runly.notes/lib/dragReorder.js`
Expected: no output (clean).

- [ ] **Step 7: Manual check**

Drag an image (or table, once Task 4 of the table drag-reorder plan is in place) and confirm a dashed amber box clearly shows exactly where it will land, updating smoothly as you move the pointer, including correctly landing beside a specific floated sibling rather than just "somewhere in the row."

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/dragReorder.js \
        apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js \
        apps/desktop/src/modules/runly.notes/hooks/useBlockDragReorder.js
git commit -m "feat(notes): add a visible, accurate drop-zone indicator during block drag"
```

---

### Task 5: `isInsideTableCell` helper

**Files:**
- Create: `apps/desktop/src/modules/runly.notes/lib/tableContext.js`
- Test: `apps/desktop/src/modules/runly.notes/lib/__tests__/table-context.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// apps/desktop/src/modules/runly.notes/lib/__tests__/table-context.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isInsideTableCell } from '../tableContext.js'

// Minimal fake of a ProseMirror doc.resolve() result — isInsideTableCell
// only calls .depth and .node(d).
function fakePos(nodesAtDepth) {
  return {
    depth: nodesAtDepth.length - 1,
    node: (d) => nodesAtDepth[d],
  }
}

test('isInsideTableCell: true when a tableCell ancestor exists', () => {
  const docNode = { type: { name: 'doc' } }
  const tableNode = { type: { name: 'table' } }
  const cellNode = { type: { name: 'tableCell' } }
  const paragraphNode = { type: { name: 'paragraph' } }
  const $pos = fakePos([docNode, tableNode, cellNode, paragraphNode])
  const state = { doc: { resolve: () => $pos } }
  assert.equal(isInsideTableCell(state, 0), true)
})

test('isInsideTableCell: true when the ancestor is a tableHeader instead', () => {
  const docNode = { type: { name: 'doc' } }
  const tableNode = { type: { name: 'table' } }
  const headerNode = { type: { name: 'tableHeader' } }
  const $pos = fakePos([docNode, tableNode, headerNode])
  const state = { doc: { resolve: () => $pos } }
  assert.equal(isInsideTableCell(state, 0), true)
})

test('isInsideTableCell: false when there is no table ancestor at all', () => {
  const docNode = { type: { name: 'doc' } }
  const paragraphNode = { type: { name: 'paragraph' } }
  const $pos = fakePos([docNode, paragraphNode])
  const state = { doc: { resolve: () => $pos } }
  assert.equal(isInsideTableCell(state, 0), false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/table-context.test.js`
Expected: FAIL — `Cannot find module '../tableContext.js'`

- [ ] **Step 3: Write the implementation**

```js
// apps/desktop/src/modules/runly.notes/lib/tableContext.js
// Pure predicate: does the position at `pos` have a table-cell ancestor?
// Used to route an image's edit UI to a modal instead of cramped inline
// controls when it's inside a table cell — see
// docs/superpowers/specs/2026-09-17-notes-table-cell-image-modal-design.md.
export function isInsideTableCell(state, pos) {
  const $pos = state.doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name
    if (name === 'tableCell' || name === 'tableHeader') return true
  }
  return false
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/table-context.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/tableContext.js \
        apps/desktop/src/modules/runly.notes/lib/__tests__/table-context.test.js
git commit -m "feat(notes): add isInsideTableCell helper for table-cell image editing"
```

---

### Task 6: Extract `useImageAnnotationDrawing`

**Files:**
- Create: `apps/desktop/src/modules/runly.notes/hooks/useImageAnnotationDrawing.jsx`
- Modify: `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`

- [ ] **Step 1: Write the hook**

```jsx
// apps/desktop/src/modules/runly.notes/hooks/useImageAnnotationDrawing.jsx
import { useRef, useState } from 'react'
import { elementFracToImageSpace } from '../lib/imageCrop.js'

const W = 1000
const H = 1000

// Pen/arrow/rect/text annotation drawing over an image's SVG overlay —
// shared by the inline edit mode (ImageAnnotationOverlay.jsx) and the
// table-cell modal (ImageEditModal.jsx) so the drawing math and SVG
// rendering aren't duplicated between them. See
// docs/superpowers/specs/2026-09-17-notes-table-cell-image-modal-design.md.
export function useImageAnnotationDrawing({ svgRef, crop, annotations, tool, color, lineWidth, isEditing, updateAttributes }) {
  const drawRef = useRef(null) // { pointerId }
  const [draft, setDraft] = useState(null)
  const [textInput, setTextInput] = useState(null) // { screenX, screenY, svgX, svgY }

  function getPoint(e) {
    const rect = svgRef.current.getBoundingClientRect()
    const frac = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    }
    return elementFracToImageSpace(frac, crop)
  }

  function onDrawPointerDown(e) {
    if (!isEditing || textInput) return
    e.preventDefault()
    const p = getPoint(e)
    if (tool === 'text') {
      const rect = svgRef.current.getBoundingClientRect()
      setTextInput({
        svgX: p.x,
        svgY: p.y,
        screenX: e.clientX - rect.left,
        screenY: e.clientY - rect.top,
      })
      return
    }
    svgRef.current.setPointerCapture(e.pointerId)
    drawRef.current = { pointerId: e.pointerId }
    if (tool === 'pen') setDraft({ type: 'path', color, lineWidth, points: [p] })
    else setDraft({ type: tool, color, lineWidth, start: p, end: p })
  }

  function onDrawPointerMove(e) {
    if (!drawRef.current || drawRef.current.pointerId !== e.pointerId) return
    const p = getPoint(e)
    setDraft((d) => {
      if (!d) return d
      if (d.type === 'path') {
        const last = d.points[d.points.length - 1]
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.004) return d
        return { ...d, points: [...d.points, p] }
      }
      return { ...d, end: p }
    })
  }

  function onDrawPointerUp(e) {
    if (!drawRef.current || drawRef.current.pointerId !== e.pointerId) return
    drawRef.current = null
    const d = draft
    setDraft(null)
    if (!d) return
    if (d.type === 'path' && d.points.length < 2) return
    updateAttributes({
      annotations: JSON.stringify([...annotations, { ...d, id: Date.now() }]),
    })
  }

  function commitTextInput(text) {
    if (text?.trim()) {
      const ann = {
        type: 'text',
        id: Date.now(),
        color,
        lineWidth,
        text: text.trim(),
        svgX: textInput.svgX,
        svgY: textInput.svgY,
      }
      updateAttributes({ annotations: JSON.stringify([...annotations, ann]) })
    }
    setTextInput(null)
  }

  function cancelTextInput() {
    setTextInput(null)
  }

  function removeAnnotation(id) {
    updateAttributes({
      annotations: JSON.stringify(annotations.filter((a) => a.id !== id)),
    })
  }

  function renderAnnotation(ann) {
    const clickable = isEditing ? 'cursor-pointer' : ''
    if (ann.type === 'path') {
      const pts = (ann.points || []).map((p) => `${p.x * W},${p.y * H}`).join(' ')
      return (
        <g key={ann.id} onClick={() => isEditing && removeAnnotation(ann.id)} className={clickable}>
          <polyline
            points={pts}
            fill="none"
            stroke={ann.color}
            strokeWidth={ann.lineWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {isEditing && (
            <polyline points={pts} fill="none" stroke="transparent" strokeWidth={Math.max(ann.lineWidth + 12, 16)} />
          )}
        </g>
      )
    }
    if (ann.type === 'arrow') {
      const x1 = ann.start.x * W
      const y1 = ann.start.y * H
      const x2 = ann.end.x * W
      const y2 = ann.end.y * H
      return (
        <g key={ann.id} onClick={() => isEditing && removeAnnotation(ann.id)} className={clickable}>
          <defs>
            <marker id={`ah-${ann.id}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill={ann.color} />
            </marker>
          </defs>
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={ann.color}
            strokeWidth={ann.lineWidth}
            markerEnd={`url(#ah-${ann.id})`}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )
    }
    if (ann.type === 'rect') {
      const x = Math.min(ann.start.x, ann.end.x) * W
      const y = Math.min(ann.start.y, ann.end.y) * H
      const w = Math.abs(ann.end.x - ann.start.x) * W
      const h = Math.abs(ann.end.y - ann.start.y) * H
      return (
        <rect
          key={ann.id}
          x={x}
          y={y}
          width={w}
          height={h}
          stroke={ann.color}
          strokeWidth={ann.lineWidth}
          fill="none"
          vectorEffect="non-scaling-stroke"
          onClick={() => isEditing && removeAnnotation(ann.id)}
          className={clickable}
        />
      )
    }
    if (ann.type === 'text') {
      return (
        <text
          key={ann.id}
          x={ann.svgX * W}
          y={ann.svgY * H}
          fill={ann.color}
          fontSize={ann.lineWidth * 8 + 12}
          fontWeight="bold"
          fontFamily="sans-serif"
          onClick={() => isEditing && removeAnnotation(ann.id)}
          className={`select-none ${clickable}`}
        >
          {ann.text}
        </text>
      )
    }
    return null
  }

  function renderDraft() {
    if (!draft) return null
    if (draft.type === 'path') {
      const pts = draft.points.map((p) => `${p.x * W},${p.y * H}`).join(' ')
      return (
        <polyline
          points={pts}
          fill="none"
          stroke={draft.color}
          strokeWidth={draft.lineWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )
    }
    if (draft.type === 'arrow') {
      return (
        <line
          x1={draft.start.x * W}
          y1={draft.start.y * H}
          x2={draft.end.x * W}
          y2={draft.end.y * H}
          stroke={draft.color}
          strokeWidth={draft.lineWidth}
          strokeDasharray="6 3"
          vectorEffect="non-scaling-stroke"
        />
      )
    }
    if (draft.type === 'rect') {
      const x = Math.min(draft.start.x, draft.end.x) * W
      const y = Math.min(draft.start.y, draft.end.y) * H
      const w = Math.abs(draft.end.x - draft.start.x) * W
      const h = Math.abs(draft.end.y - draft.start.y) * H
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          stroke={draft.color}
          strokeWidth={draft.lineWidth}
          fill="none"
          strokeDasharray="6 3"
          vectorEffect="non-scaling-stroke"
        />
      )
    }
    return null
  }

  return {
    draft, textInput, onDrawPointerDown, onDrawPointerMove, onDrawPointerUp,
    commitTextInput, cancelTextInput, removeAnnotation, renderAnnotation, renderDraft,
  }
}
```

- [ ] **Step 2: Wire the hook into `ImageAnnotationOverlay.jsx`, removing the now-duplicated inline logic**

Add the import:

```js
import { useImageAnnotationDrawing } from '../hooks/useImageAnnotationDrawing.jsx'
```

Remove the now-redundant import (drawing math moved into the hook):

Find:

```js
import {
  cropToViewBox, elementFracToImageSpace, effectiveNaturalSize,
  normalizeRotation, rotateAnnotations,
} from '../lib/imageCrop.js'
```

Replace with:

```js
import {
  cropToViewBox, effectiveNaturalSize,
  normalizeRotation, rotateAnnotations,
} from '../lib/imageCrop.js'
```

(`elementFracToImageSpace` is now only used inside the extracted hook.)

Find:

```js
  const drawRef = useRef(null) // { pointerId } — annotation drawing
  const resizeRef = useRef(null) // { pointerId, startX, startY, startWidthPx, startHeightPx, containerWidthPx }

  const [mode, setMode] = useState('view') // 'view' | 'edit'
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState('#ef4444')
  const [lineWidth, setLineWidth] = useState(3)
  const [draft, setDraft] = useState(null)
  const [textInput, setTextInput] = useState(null) // { screenX, screenY, svgX, svgY }
  const [cropOpen, setCropOpen] = useState(false)
```

Replace with:

```js
  const resizeRef = useRef(null) // { pointerId, startX, startY, startWidthPx, startHeightPx, containerWidthPx }

  const [mode, setMode] = useState('view') // 'view' | 'edit'
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState('#ef4444')
  const [lineWidth, setLineWidth] = useState(3)
  const [cropOpen, setCropOpen] = useState(false)
```

Find (right after the `useBlockDragReorder` call):

```js
  } = useBlockDragReorder({
    editor, getPos, editable, isEditing,
    getBoxEl: () => boxRef.current,
    getFrameEl: () => frameRef.current,
  })
```

Replace with:

```js
  } = useBlockDragReorder({
    editor, getPos, editable, isEditing,
    getBoxEl: () => boxRef.current,
    getFrameEl: () => frameRef.current,
  })

  const {
    draft, textInput, onDrawPointerDown, onDrawPointerMove, onDrawPointerUp,
    commitTextInput, cancelTextInput, removeAnnotation, renderAnnotation, renderDraft,
  } = useImageAnnotationDrawing({ svgRef, crop, annotations, tool, color, lineWidth, isEditing, updateAttributes })
```

Remove the now-duplicated drawing block. Find (the entire block from the section comment through `removeAnnotation`):

```js
  // ── annotation drawing (Pointer Events) ─────────────────────────────────
  function getPoint(e) {
    const rect = svgRef.current.getBoundingClientRect()
    const frac = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    }
    return elementFracToImageSpace(frac, crop)
  }

  function onDrawPointerDown(e) {
    if (!isEditing || textInput) return
    e.preventDefault()
    const p = getPoint(e)
    if (tool === 'text') {
      const rect = svgRef.current.getBoundingClientRect()
      setTextInput({
        svgX: p.x,
        svgY: p.y,
        screenX: e.clientX - rect.left,
        screenY: e.clientY - rect.top,
      })
      return
    }
    svgRef.current.setPointerCapture(e.pointerId)
    drawRef.current = { pointerId: e.pointerId }
    if (tool === 'pen') setDraft({ type: 'path', color, lineWidth, points: [p] })
    else setDraft({ type: tool, color, lineWidth, start: p, end: p })
  }

  function onDrawPointerMove(e) {
    if (!drawRef.current || drawRef.current.pointerId !== e.pointerId) return
    const p = getPoint(e)
    setDraft((d) => {
      if (!d) return d
      if (d.type === 'path') {
        const last = d.points[d.points.length - 1]
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.004) return d
        return { ...d, points: [...d.points, p] }
      }
      return { ...d, end: p }
    })
  }

  function onDrawPointerUp(e) {
    if (!drawRef.current || drawRef.current.pointerId !== e.pointerId) return
    drawRef.current = null
    const d = draft
    setDraft(null)
    if (!d) return
    if (d.type === 'path' && d.points.length < 2) return
    updateAttributes({
      annotations: JSON.stringify([...annotations, { ...d, id: Date.now() }]),
    })
  }

  function commitTextInput(text) {
    if (text?.trim()) {
      const ann = {
        type: 'text',
        id: Date.now(),
        color,
        lineWidth,
        text: text.trim(),
        svgX: textInput.svgX,
        svgY: textInput.svgY,
      }
      updateAttributes({ annotations: JSON.stringify([...annotations, ann]) })
    }
    setTextInput(null)
  }

  function removeAnnotation(id) {
    updateAttributes({
      annotations: JSON.stringify(annotations.filter((a) => a.id !== id)),
    })
  }

  function exitEditMode() {
```

Replace with:

```js
  function exitEditMode() {
```

Remove the now-duplicated `renderAnnotation`/`renderDraft` function definitions. Find (the whole `// ── rendering ──` section's two functions, from the comment through the end of `renderDraft`):

```js
  // ── rendering ──────────────────────────────────────────────────────────
  function renderAnnotation(ann) {
```

... (the full ~140-line block through the closing `}` of `renderDraft`) ...

```js
    return null
  }

  const src = withImageVariant(node.attrs.src, 'content')
```

Replace the whole span with just:

```js
  const src = withImageVariant(node.attrs.src, 'content')
```

Update the two remaining call sites that referenced local `setTextInput(null)` for Escape/cancel. Find:

```jsx
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTextInput(e.target.value)
                if (e.key === 'Escape') setTextInput(null)
              }}
```

Replace with:

```jsx
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTextInput(e.target.value)
                if (e.key === 'Escape') cancelTextInput()
              }}
```

- [ ] **Step 3: Syntax-check**

Run: `npx eslint apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx apps/desktop/src/modules/runly.notes/hooks/useImageAnnotationDrawing.jsx`
Expected: no output (clean) — this also confirms no leftover references to the removed `drawRef`/`getPoint`/local `setDraft`/`setTextInput`.

- [ ] **Step 4: Run the full notes test suite**

Run: `node --test "apps/desktop/src/modules/runly.notes/lib/__tests__/*.test.js"`
Expected: PASS (all files — this is a pure refactor, no logic changed)

- [ ] **Step 5: Manual check**

Run `pnpm dev:frontend`. On an image OUTSIDE a table, enter edit mode and confirm drawing pen/arrow/rect/text annotations, changing color/line width, and clearing annotations all work exactly as before this refactor.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/hooks/useImageAnnotationDrawing.jsx \
        apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx
git commit -m "refactor(notes): extract annotation drawing into useImageAnnotationDrawing"
```

---

### Task 7: `ImageEditModal.jsx`

**Files:**
- Create: `apps/desktop/src/modules/runly.notes/components/ImageEditModal.jsx`

- [ ] **Step 1: Write the component**

```jsx
// apps/desktop/src/modules/runly.notes/components/ImageEditModal.jsx
import { useRef, useState } from 'react'
import {
  Crop as CropIcon, Check, PenLine, ArrowUpRight, Square, Type, MoreHorizontal,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  Popover, PopoverTrigger, PopoverContent,
} from '@runly/ui'
import { cropToViewBox } from '../lib/imageCrop.js'
import { useImageAnnotationDrawing } from '../hooks/useImageAnnotationDrawing.jsx'
import { ImageCropModal } from './ImageCropModal.jsx'

const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#1a1a1a', '#ffffff']
const TOOLS = [
  { id: 'pen', label: 'Lapiz', icon: PenLine },
  { id: 'arrow', label: 'Flecha', icon: ArrowUpRight },
  { id: 'rect', label: 'Recuadro', icon: Square },
  { id: 'text', label: 'Texto', icon: Type },
]

// Full-size annotation editor for images that don't have room for the
// inline overlay's controls — currently, any image inside a table cell.
// Hosts the exact same tool/color/crop/annotation capabilities as
// ImageAnnotationOverlay's inline edit mode, via the shared
// useImageAnnotationDrawing hook, just laid out with room to breathe
// instead of squeezed into a table cell's width. See
// docs/superpowers/specs/2026-09-17-notes-table-cell-image-modal-design.md.
export function ImageEditModal({ open, onOpenChange, src, alt, annotations, crop, rotation, updateAttributes }) {
  const svgRef = useRef(null)
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState('#ef4444')
  const [lineWidth, setLineWidth] = useState(3)
  const [cropOpen, setCropOpen] = useState(false)

  const {
    draft, textInput, onDrawPointerDown, onDrawPointerMove, onDrawPointerUp,
    commitTextInput, cancelTextInput, removeAnnotation, renderAnnotation, renderDraft,
  } = useImageAnnotationDrawing({
    svgRef, crop, annotations, tool, color, lineWidth, isEditing: true, updateAttributes,
  })

  const ActiveToolIcon = TOOLS.find((t) => t.id === tool)?.icon ?? PenLine

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Editar imagen</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">
                <ActiveToolIcon className="w-3.5 h-3.5" /> Herramienta
              </button>
            </PopoverTrigger>
            <PopoverContent className="p-1 w-36" side="bottom" align="start">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTool(t.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-medium ${
                    tool === t.id
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                      : 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
                  }`}
                >
                  <t.icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">
                <span
                  className="w-4 h-4 rounded-full border-2 border-[hsl(var(--border))]"
                  style={{ backgroundColor: color === '#ffffff' ? '#f3f4f6' : color }}
                />
                Color
              </button>
            </PopoverTrigger>
            <PopoverContent className="p-2 w-auto" side="bottom" align="start">
              <div className="grid grid-cols-4 gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-amber-500 scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c === '#ffffff' ? '#f3f4f6' : c }}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <Select value={String(lineWidth)} onValueChange={(v) => setLineWidth(Number(v))}>
            <SelectTrigger className="h-9 w-auto min-w-20 px-3 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 6, 8].map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {w}px
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <button
            onClick={() => setCropOpen(true)}
            className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
          >
            <CropIcon className="w-3.5 h-3.5" /> Recortar
          </button>

          {annotations.length > 0 && (
            <button
              onClick={() => updateAttributes({ annotations: '[]' })}
              className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border border-[hsl(var(--border))] text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <MoreHorizontal className="w-3.5 h-3.5" /> Limpiar
            </button>
          )}
        </div>

        <div className="relative w-full max-h-[60dvh] rounded-lg overflow-hidden bg-[hsl(var(--muted))]" style={{ aspectRatio: cropToViewBox(crop).split(' ').slice(2).join('/') }}>
          <img src={src} alt={alt ?? ''} draggable={false} className="absolute inset-0 w-full h-full object-contain" />
          <svg
            ref={svgRef}
            viewBox={cropToViewBox(crop)}
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            style={{
              touchAction: 'none',
              cursor: tool === 'text' ? 'text' : 'crosshair',
            }}
            onPointerDown={onDrawPointerDown}
            onPointerMove={onDrawPointerMove}
            onPointerUp={onDrawPointerUp}
            onPointerCancel={onDrawPointerUp}
          >
            {annotations.map(renderAnnotation)}
            {renderDraft()}
          </svg>

          {textInput && (
            <input
              autoFocus
              type="text"
              placeholder="Escribe una anotacion..."
              className="absolute bg-[hsl(var(--background))] text-[hsl(var(--foreground))] border border-amber-400 dark:border-amber-600 rounded px-2 py-1 text-sm shadow-lg outline-none z-10"
              style={{ left: textInput.screenX, top: textInput.screenY, minWidth: 180 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTextInput(e.target.value)
                if (e.key === 'Escape') cancelTextInput()
              }}
              onBlur={(e) => commitTextInput(e.target.value)}
            />
          )}
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="flex items-center gap-1.5 px-4 h-10 rounded-lg font-semibold bg-amber-500 hover:bg-amber-600 text-white"
          >
            <Check className="w-4 h-4" /> Listo
          </button>
        </DialogFooter>

        {cropOpen && (
          <ImageCropModal
            open={cropOpen}
            onOpenChange={setCropOpen}
            src={src}
            crop={crop}
            rotation={rotation}
            onApply={({ crop: nextCrop, rotation: nextRotation }) => {
              updateAttributes({ crop: nextCrop, rotation: nextRotation })
              setCropOpen(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Syntax-check**

Run: `npx eslint apps/desktop/src/modules/runly.notes/components/ImageEditModal.jsx`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/ImageEditModal.jsx
git commit -m "feat(notes): add ImageEditModal for full-size image annotation editing"
```

---

### Task 8: Route table-cell images to the modal

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`

- [ ] **Step 1: Import the new helper, modal, and a plain pencil icon**

Find:

```js
import {
  Pencil, Crop as CropIcon, Check,
  PenLine, ArrowUpRight, Square, Type, MoreHorizontal,
} from 'lucide-react'
```

Replace with (unchanged — `Pencil` is already imported and reused for the icon-only trigger):

```js
import {
  Pencil, Crop as CropIcon, Check,
  PenLine, ArrowUpRight, Square, Type, MoreHorizontal,
} from 'lucide-react'
```

Add two new imports after the existing `dragReorder`/hook imports:

```js
import { isInsideTableCell } from '../lib/tableContext.js'
import { ImageEditModal } from './ImageEditModal.jsx'
```

- [ ] **Step 2: Compute `inTableCell` and add modal-open state**

Find:

```js
  const [fullLoaded, setFullLoaded] = useState(false) // full-resolution <img> onLoad fired
```

Replace with:

```js
  const [fullLoaded, setFullLoaded] = useState(false) // full-resolution <img> onLoad fired
  const [editModalOpen, setEditModalOpen] = useState(false) // table-cell images edit via modal instead of inline mode
```

Find:

```js
  const annotations = JSON.parse(node.attrs.annotations || '[]')
  const crop = parseCrop(node.attrs.crop)
  const rotation = normalizeRotation(node.attrs.rotation)
  const editable = editor?.isEditable !== false
```

Replace with:

```js
  const annotations = JSON.parse(node.attrs.annotations || '[]')
  const crop = parseCrop(node.attrs.crop)
  const rotation = normalizeRotation(node.attrs.rotation)
  const editable = editor?.isEditable !== false
  const inTableCell = typeof getPos === 'function' && isInsideTableCell(editor.state, getPos())
```

- [ ] **Step 3: Swap the "Editar imagen" trigger for an icon-only button that opens the modal, inside a table cell**

Find:

```jsx
            <button
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
              onClick={() => setMode('edit')}
              className="flex items-center gap-1.5 text-xs font-medium bg-[hsl(var(--background)/0.9)] backdrop-blur-sm border border-[hsl(var(--border))] rounded-lg px-2.5 py-1.5 shadow-sm hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Editar imagen
            </button>
```

Replace with:

```jsx
            {inTableCell ? (
              <button
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                onClick={() => setEditModalOpen(true)}
                aria-label="Editar imagen"
                title="Editar imagen"
                className="flex items-center justify-center w-8 h-8 bg-[hsl(var(--background)/0.9)] backdrop-blur-sm border border-[hsl(var(--border))] rounded-lg shadow-sm hover:bg-[hsl(var(--muted))] transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                onClick={() => setMode('edit')}
                className="flex items-center gap-1.5 text-xs font-medium bg-[hsl(var(--background)/0.9)] backdrop-blur-sm border border-[hsl(var(--border))] rounded-lg px-2.5 py-1.5 shadow-sm hover:bg-[hsl(var(--muted))] transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Editar imagen
              </button>
            )}
```

- [ ] **Step 4: Render the modal**

Find (the closing of the component, right before the final `</NodeViewWrapper>`):

```jsx
      {cropOpen && (
        <ImageCropModal
          open={cropOpen}
          onOpenChange={setCropOpen}
          src={src}
          crop={crop}
          rotation={rotation}
          onApply={({ crop: nextCrop, rotation: nextRotation }) => {
            // Rotation is a NODE-level concept (affects the image everywhere
            // it renders, not just this modal session), so stored
            // annotations — defined in the image's own rotated fraction
            // space — must be re-expressed in the NEW rotation to stay
            // visually aligned with the image content.
            const delta = normalizeRotation(nextRotation - rotation)
            const rotatedAnnotations = delta === 0 ? annotations : rotateAnnotations(annotations, delta)
            updateAttributes({
              crop: nextCrop,
              rotation: nextRotation,
              annotations: JSON.stringify(rotatedAnnotations),
            })
            setCropOpen(false)
          }}
        />
      )}
    </NodeViewWrapper>
  )
}
```

Replace with:

```jsx
      {cropOpen && (
        <ImageCropModal
          open={cropOpen}
          onOpenChange={setCropOpen}
          src={src}
          crop={crop}
          rotation={rotation}
          onApply={({ crop: nextCrop, rotation: nextRotation }) => {
            // Rotation is a NODE-level concept (affects the image everywhere
            // it renders, not just this modal session), so stored
            // annotations — defined in the image's own rotated fraction
            // space — must be re-expressed in the NEW rotation to stay
            // visually aligned with the image content.
            const delta = normalizeRotation(nextRotation - rotation)
            const rotatedAnnotations = delta === 0 ? annotations : rotateAnnotations(annotations, delta)
            updateAttributes({
              crop: nextCrop,
              rotation: nextRotation,
              annotations: JSON.stringify(rotatedAnnotations),
            })
            setCropOpen(false)
          }}
        />
      )}

      {editModalOpen && (
        <ImageEditModal
          open={editModalOpen}
          onOpenChange={setEditModalOpen}
          src={src}
          alt={node.attrs.alt}
          annotations={annotations}
          crop={crop}
          rotation={rotation}
          updateAttributes={updateAttributes}
        />
      )}
    </NodeViewWrapper>
  )
}
```

- [ ] **Step 5: Syntax-check**

Run: `npx eslint apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`
Expected: no output (clean).

- [ ] **Step 6: Run the full notes test suite**

Run: `node --test "apps/desktop/src/modules/runly.notes/lib/__tests__/*.test.js"`
Expected: PASS (all files)

- [ ] **Step 7: Manual check**

Insert an image inside a table cell; confirm its "Editar" trigger is now a small icon-only button that fits the cell, and clicking it opens the modal (not inline edit mode) with full annotation/crop/color/line-width capability. Confirm an image OUTSIDE a table still shows the text+icon "Editar imagen" pill and uses inline edit mode, unchanged.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx
git commit -m "feat(notes): route table-cell image editing to the new modal"
```

---

### Task 9: Full verification pass

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

- Resize an image to 34%+ width; a paragraph typed after it wraps into the
  remaining space; three images at 34%+ each only ever show 2 per row.
- An image below 34% width stays full-width block, never floats.
- Dragging an image (or table) shows a clear, accurate dashed drop-zone box
  that matches where it actually lands, including beside a specific
  floated sibling.
- A note ending with a floated image and nothing after it: editor
  background and tap-below-content still work.
- Table cell images: icon-only edit trigger, opens a properly-sized modal
  with full annotation/crop capability; non-table images unaffected.
- Both themes: no regressions in existing image editing, table controls,
  or drag-reorder behavior.

- [ ] **Step 5: Update `docs/TASKS.md`**

Update the side-by-side content flow entry from "REVERTED" to reflect the
Revision 2 fixes are code-complete, and add a line for the table-cell image
modal work, both with `Verified: YYYY-MM-DD (node --test + pnpm lint +
vite build clean; manual QA pending)`.
