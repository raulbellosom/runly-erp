# Notes Editor — Image Drag-Reorder UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cramped move-handle button and the plain drop-line indicator with press-and-hold-anywhere dragging, a floating clone that follows the pointer, and continuous sibling reflow.

**Architecture:** Pure geometry (`computeShiftMap`, `exceedsDragThreshold`) lives in `lib/dragReorder.js` alongside the existing `findDropPosition`/`moveNode`. All DOM/gesture state (long-press timer, floating clone, imperative sibling-transform application) lives in a new hook, `hooks/useImageDragReorder.js`, keeping `ImageAnnotationOverlay.jsx` from growing further. The hook returns plain pointer-event handlers the component spreads onto its existing `boxRef` div.

**Tech Stack:** React, TipTap v3 (ProseMirror), Node's built-in test runner (`node --test`).

Spec: `docs/superpowers/specs/2026-09-16-notes-image-drag-reorder-design.md`.

---

### Task 1: Pure geometry helpers in `dragReorder.js`

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/lib/dragReorder.js`
- Test: `apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeShiftMap, exceedsDragThreshold, DRAG_THRESHOLD_PX } from '../dragReorder.js'

// 6 blocks at indices 0-5, offsets deliberately uneven (not equal to index)
// so a bug that confuses "array index" with "ProseMirror offset" would fail.
const BLOCK_RECTS = [
  { offset: 0, top: 0, height: 20 },
  { offset: 10, top: 20, height: 20 },
  { offset: 20, top: 40, height: 20 },
  { offset: 30, top: 60, height: 20 },
  { offset: 40, top: 80, height: 20 },
  { offset: 50, top: 100, height: 20 },
]

test('computeShiftMap: dragging down shifts only the blocks strictly between original and candidate', () => {
  const map = computeShiftMap({ blockRects: BLOCK_RECTS, originalIndex: 1, candidateIndex: 4, draggedHeightPx: 100 })
  assert.deepEqual([...map.entries()], [
    [0, 0], [10, 0], [20, -100], [30, -100], [40, 0], [50, 0],
  ])
})

test('computeShiftMap: dragging up shifts only the blocks strictly between candidate and original', () => {
  const map = computeShiftMap({ blockRects: BLOCK_RECTS, originalIndex: 4, candidateIndex: 1, draggedHeightPx: 50 })
  assert.deepEqual([...map.entries()], [
    [0, 0], [10, 50], [20, 50], [30, 50], [40, 0], [50, 0],
  ])
})

test('computeShiftMap: candidate equal to original is a no-op (all zero)', () => {
  const map = computeShiftMap({ blockRects: BLOCK_RECTS, originalIndex: 2, candidateIndex: 2, draggedHeightPx: 100 })
  assert.deepEqual([...map.values()], [0, 0, 0, 0, 0, 0])
})

test('computeShiftMap: candidate immediately after original is a no-op (adjacent swap-with-self)', () => {
  const map = computeShiftMap({ blockRects: BLOCK_RECTS, originalIndex: 1, candidateIndex: 2, draggedHeightPx: 100 })
  assert.deepEqual([...map.values()], [0, 0, 0, 0, 0, 0])
})

test('computeShiftMap: dropping past the last block shifts everything after the original up to the end', () => {
  const map = computeShiftMap({ blockRects: BLOCK_RECTS, originalIndex: 1, candidateIndex: BLOCK_RECTS.length, draggedHeightPx: 30 })
  assert.deepEqual([...map.entries()], [
    [0, 0], [10, 0], [20, -30], [30, -30], [40, -30], [50, -30],
  ])
})

test('exceedsDragThreshold: false at and below the threshold, true above it', () => {
  assert.equal(exceedsDragThreshold(DRAG_THRESHOLD_PX), false)
  assert.equal(exceedsDragThreshold(DRAG_THRESHOLD_PX - 1), false)
  assert.equal(exceedsDragThreshold(DRAG_THRESHOLD_PX + 1), true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js`
Expected: FAIL — `computeShiftMap`/`exceedsDragThreshold`/`DRAG_THRESHOLD_PX` are not exported yet.

- [ ] **Step 3: Add the implementation**

Append to `apps/desktop/src/modules/runly.notes/lib/dragReorder.js` (after the existing `moveNode`):

```js
// ── press-and-hold drag reorder (mouse + touch via Pointer Events) ────────

// Touch requires holding this long before a press-and-hold arms into an
// active drag, so an ordinary scroll gesture starting on the image is never
// hijacked — see docs/superpowers/specs/2026-09-16-notes-image-drag-reorder-design.md.
export const LONG_PRESS_MS = 450
// Movement past this distance (px) either cancels a pending touch long-press
// (the user is scrolling) or, on mouse, arms the drag immediately.
export const DRAG_THRESHOLD_PX = 8

export function exceedsDragThreshold(deltaPx) {
  return deltaPx > DRAG_THRESHOLD_PX
}

// Measures every top-level document child's on-screen rect, in document
// order — the fixed "before" layout a drag gesture computes shifts against.
// Not independently unit-tested (requires a live ProseMirror view/DOM),
// matching the existing untested DOM-dependent helpers in this file.
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

/**
 * Pure: given every top-level block's rect (in document order, from
 * computeBlockRects) and the dragged block's original/candidate array
 * indices (NOT ProseMirror offsets — see the calling hook for how those are
 * resolved), returns a Map from each block's `offset` to the pixel amount it
 * should visually shift by. Every block strictly between the original and
 * candidate position shifts by exactly `draggedHeightPx`, closing the gap
 * left behind and opening an equivalent one at the candidate position;
 * everything else maps to 0.
 */
export function computeShiftMap({ blockRects, originalIndex, candidateIndex, draggedHeightPx }) {
  const map = new Map()
  for (const b of blockRects) map.set(b.offset, 0)
  if (originalIndex === candidateIndex) return map
  const down = originalIndex < candidateIndex
  const lo = down ? originalIndex + 1 : candidateIndex
  const hi = down ? candidateIndex - 1 : originalIndex - 1
  const shift = down ? -draggedHeightPx : draggedHeightPx
  blockRects.forEach((b, i) => {
    if (i >= lo && i <= hi) map.set(b.offset, shift)
  })
  return map
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/dragReorder.js \
        apps/desktop/src/modules/runly.notes/lib/__tests__/drag-reorder.test.js
git commit -m "feat(notes): add sibling-reflow geometry helpers for image drag reorder"
```

---

### Task 2: `useImageDragReorder` hook

**Files:**
- Create: `apps/desktop/src/modules/runly.notes/hooks/useImageDragReorder.js`

- [ ] **Step 1: Write the hook**

```js
// apps/desktop/src/modules/runly.notes/hooks/useImageDragReorder.js
import { useRef } from 'react'
import {
  findDropPosition, moveNode, computeBlockRects, computeShiftMap,
  exceedsDragThreshold, LONG_PRESS_MS,
} from '../lib/dragReorder.js'

const CLONE_LIFT_STYLE = {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: 9999,
  margin: 0,
  transform: 'scale(1.03)',
  boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
  transition: 'none',
}

// Press-and-hold-anywhere drag reorder for an image node view. Touch
// requires a LONG_PRESS_MS hold before arming (so an ordinary scroll
// gesture starting on the image is never hijacked); mouse arms as soon as
// it moves past DRAG_THRESHOLD_PX. Once armed, a floating clone of the
// image's frame follows the pointer and every sibling block between the
// original and candidate position slides out of the way in real time. See
// docs/superpowers/specs/2026-09-16-notes-image-drag-reorder-design.md.
export function useImageDragReorder({ editor, getPos, boxRef, frameRef, editable, isEditing }) {
  const pressRef = useRef(null) // { pointerId, startX, startY, pointerType, timerId }
  const dragRef = useRef(null) // { pointerId, originalPos, originalIndex, blockRects, draggedHeightPx, cloneEl, grabDX, grabDY, candidatePos }
  const wasDragRef = useRef(false) // set true right after a real drag commits; consumed once by the caller's click handler

  function cleanupDrag() {
    const d = dragRef.current
    if (!d) return
    for (const b of d.blockRects) {
      const dom = editor.view.nodeDOM(b.offset)
      if (dom?.style) dom.style.transform = ''
    }
    d.cloneEl?.remove()
    if (boxRef.current) boxRef.current.style.opacity = ''
    dragRef.current = null
  }

  function startDrag(e) {
    if (typeof getPos !== 'function' || !boxRef.current || !frameRef.current) return
    const view = editor.view
    const originalPos = getPos()
    const blockRects = computeBlockRects(view)
    const originalIndex = blockRects.findIndex((b) => b.offset === originalPos)
    if (originalIndex === -1) return
    const rect = frameRef.current.getBoundingClientRect()

    const clone = frameRef.current.cloneNode(true)
    Object.assign(clone.style, CLONE_LIFT_STYLE, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
    document.body.appendChild(clone)
    boxRef.current.style.opacity = '0'

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
  }

  function onPointerDown(e) {
    if (!editable || isEditing) return
    pressRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      pointerType: e.pointerType,
      timerId: null,
    }
    if (e.pointerType === 'touch') {
      pressRef.current.timerId = setTimeout(() => {
        if (pressRef.current?.pointerId === e.pointerId) {
          e.target.setPointerCapture?.(e.pointerId)
          startDrag(e)
        }
      }, LONG_PRESS_MS)
    }
  }

  function onPointerMove(e) {
    const active = dragRef.current
    if (active && active.pointerId === e.pointerId) {
      e.preventDefault()
      const view = editor.view
      const candidatePos = findDropPosition(view, e.clientY)
      const rawCandidateIndex = active.blockRects.findIndex((b) => b.offset === candidatePos)
      const candidateIndex = rawCandidateIndex === -1 ? active.blockRects.length : rawCandidateIndex
      const shiftMap = computeShiftMap({
        blockRects: active.blockRects,
        originalIndex: active.originalIndex,
        candidateIndex,
        draggedHeightPx: active.draggedHeightPx,
      })
      for (const [offset, shiftPx] of shiftMap) {
        const dom = view.nodeDOM(offset)
        if (dom?.style) dom.style.transform = shiftPx ? `translateY(${shiftPx}px)` : ''
      }
      active.candidatePos = candidatePos
      active.cloneEl.style.left = `${e.clientX - active.grabDX}px`
      active.cloneEl.style.top = `${e.clientY - active.grabDY}px`
      return
    }

    const press = pressRef.current
    if (!press || press.pointerId !== e.pointerId) return
    const deltaPx = Math.hypot(e.clientX - press.startX, e.clientY - press.startY)
    if (press.pointerType === 'touch') {
      if (exceedsDragThreshold(deltaPx)) {
        clearTimeout(press.timerId)
        pressRef.current = null
      }
      return
    }
    if (exceedsDragThreshold(deltaPx)) {
      e.target.setPointerCapture?.(e.pointerId)
      startDrag(e)
      pressRef.current = null
    }
  }

  function onPointerUp(e) {
    const active = dragRef.current
    if (active && active.pointerId === e.pointerId) {
      const { originalPos, candidatePos } = active
      cleanupDrag()
      if (candidatePos !== originalPos) moveNode(editor, originalPos, candidatePos)
      wasDragRef.current = true
      return
    }
    const press = pressRef.current
    if (press?.pointerId === e.pointerId) {
      clearTimeout(press.timerId)
      pressRef.current = null
    }
  }

  function onPointerCancel(e) {
    const active = dragRef.current
    if (active && active.pointerId === e.pointerId) {
      cleanupDrag()
      return
    }
    const press = pressRef.current
    if (press?.pointerId === e.pointerId) {
      clearTimeout(press.timerId)
      pressRef.current = null
    }
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, wasDragRef }
}
```

- [ ] **Step 2: Syntax-check the file**

Run: `npx eslint apps/desktop/src/modules/runly.notes/hooks/useImageDragReorder.js`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/hooks/useImageDragReorder.js
git commit -m "feat(notes): add useImageDragReorder hook (press-and-hold, floating clone, sibling reflow)"
```

---

### Task 3: Wire the hook into `ImageAnnotationOverlay.jsx`

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`

- [ ] **Step 1: Update imports**

Replace:

```jsx
import {
  GripVertical, Pencil, Crop as CropIcon, Check,
  PenLine, ArrowUpRight, Square, Type, MoreHorizontal,
} from 'lucide-react'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Popover, PopoverTrigger, PopoverContent } from '@runly/ui'
import { findDropPosition, moveNode } from '../lib/dragReorder.js'
import { withImageVariant } from '../../../lib/imageVariants.js'
```

with:

```jsx
import {
  Pencil, Crop as CropIcon, Check,
  PenLine, ArrowUpRight, Square, Type, MoreHorizontal,
} from 'lucide-react'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Popover, PopoverTrigger, PopoverContent } from '@runly/ui'
import { withImageVariant } from '../../../lib/imageVariants.js'
import { useImageDragReorder } from '../hooks/useImageDragReorder.js'
```

(`GripVertical` is dropped — its only remaining use, the view-mode grip button, is removed in this task. `findDropPosition`/`moveNode` move into the new hook and are no longer called directly from this component.)

- [ ] **Step 2: Remove the old drag-handle state/refs and add `frameRef`**

Replace:

```js
  const svgRef = useRef(null)
  const boxRef = useRef(null) // the sized img+svg container — resize math + click-outside
  const rotWrapRef = useRef(null) // sized/positioned per crop; useRotatedFillSize measures this
  const dragRef = useRef(null) // { pointerId, dropPos } — image reorder
  const drawRef = useRef(null) // { pointerId } — annotation drawing
  const resizeRef = useRef(null) // { pointerId, startX, startY, startWidthPx, startHeightPx, containerWidthPx }
```

with:

```js
  const svgRef = useRef(null)
  const boxRef = useRef(null) // the sized img+svg container — resize math + click-outside
  const frameRef = useRef(null) // the image frame only (no control chrome) — measured/cloned for drag reorder
  const rotWrapRef = useRef(null) // sized/positioned per crop; useRotatedFillSize measures this
  const drawRef = useRef(null) // { pointerId } — annotation drawing
  const resizeRef = useRef(null) // { pointerId, startX, startY, startWidthPx, startHeightPx, containerWidthPx }
```

Replace:

```js
  const [dropIndicator, setDropIndicator] = useState(null) // { top, left, width }
```

with nothing (delete this line entirely — the floating clone replaces the line indicator).

- [ ] **Step 3: Call the hook**

`isEditing` is already declared (`const isEditing = editable && mode === 'edit'`, right after `editable`). Find the end of that declaration block:

```js
  const effectiveCrop = crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const effNat = effectiveNaturalSize(natural, rotation)
  const fillSize = useRotatedFillSize(rotWrapRef, rotation)
```

Replace with:

```js
  const effectiveCrop = crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const effNat = effectiveNaturalSize(natural, rotation)
  const fillSize = useRotatedFillSize(rotWrapRef, rotation)
  const {
    onPointerDown: onDragPointerDown,
    onPointerMove: onDragPointerMove,
    onPointerUp: onDragPointerUp,
    onPointerCancel: onDragPointerCancel,
    wasDragRef,
  } = useImageDragReorder({ editor, getPos, boxRef, frameRef, editable, isEditing })
```

- [ ] **Step 4: Remove `getIndicatorRect` and the old `onHandlePointer*` functions**

Delete this entire block:

```js
  // ── image reorder drag handle (mouse + touch via Pointer Events) ─────────
  function getIndicatorRect(view, pos) {
    const { doc } = view.state
    const dom = pos < doc.content.size ? view.nodeDOM(pos) : null
    if (dom?.getBoundingClientRect) {
      const rect = dom.getBoundingClientRect()
      return { top: rect.top, left: rect.left, width: rect.width }
    }
    let lastDom = null
    doc.forEach((_n, offset) => {
      lastDom = view.nodeDOM(offset) ?? lastDom
    })
    if (lastDom?.getBoundingClientRect) {
      const rect = lastDom.getBoundingClientRect()
      return { top: rect.bottom, left: rect.left, width: rect.width }
    }
    const containerRect = view.dom.getBoundingClientRect()
    return { top: containerRect.top, left: containerRect.left, width: containerRect.width }
  }

  function onHandlePointerDown(e) {
    if (!editable || typeof getPos !== 'function') return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, dropPos: null }
  }
  function onHandlePointerMove(e) {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return
    const view = editor.view
    const dropPos = findDropPosition(view, e.clientY)
    dragRef.current.dropPos = dropPos
    setDropIndicator(getIndicatorRect(view, dropPos))
  }
  function onHandlePointerUp(e) {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return
    const { dropPos } = dragRef.current
    dragRef.current = null
    setDropIndicator(null)
    if (dropPos !== null) moveNode(editor, getPos(), dropPos)
  }

```

- [ ] **Step 5: Make `onImageClick` swallow the click that follows a real drag**

Replace:

```js
  // ── click-to-resize (Word/PowerPoint-style corner handle) ────────────────
  function onImageClick() {
    if (!editable || mode !== 'view') return
    setSelected(true)
  }
```

with:

```js
  // ── click-to-resize (Word/PowerPoint-style corner handle) ────────────────
  function onImageClick() {
    if (wasDragRef.current) {
      wasDragRef.current = false
      return
    }
    if (!editable || mode !== 'view') return
    setSelected(true)
  }
```

- [ ] **Step 6: Attach the drag handlers to `boxRef` and the frame ref to the frame div**

Find:

```jsx
      <div
        ref={boxRef}
        onClick={onImageClick}
        className={[
          'relative',
          selected && mode === 'view' ? 'ring-2 ring-amber-500 ring-offset-1 rounded-b' : '',
        ].join(' ')}
        style={wrapperStyle}
      >
```

Replace with:

```jsx
      <div
        ref={boxRef}
        onClick={onImageClick}
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        onPointerCancel={onDragPointerCancel}
        className={[
          'relative',
          selected && mode === 'view' ? 'ring-2 ring-amber-500 ring-offset-1 rounded-b' : '',
        ].join(' ')}
        style={wrapperStyle}
      >
```

Find:

```jsx
        <div className="relative rounded-b overflow-hidden" style={frameStyle}>
```

Replace with:

```jsx
        <div ref={frameRef} className="relative rounded-b overflow-hidden" style={frameStyle}>
```

- [ ] **Step 7: Remove the view-mode grip/move button**

Find:

```jsx
        {editable && mode === 'view' && (
          <div
            // Top-right: keeps the primary "Editar imagen" affordance in view
            // above the fold on a tall image, and clear of the bottom-right
            // resize handle.
            className={`absolute top-2 right-2 flex items-center gap-1.5 opacity-100 transition-opacity ${
              selected ? 'sm:opacity-100' : 'sm:opacity-0 sm:group-hover/img:opacity-100'
            }`}
          >
            <button
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setMode('edit')}
              className="flex items-center gap-1.5 text-xs font-medium bg-[hsl(var(--background)/0.9)] backdrop-blur-sm border border-[hsl(var(--border))] rounded-lg px-2.5 py-1.5 shadow-sm hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Editar imagen
            </button>
            <button
              title="Arrastrar para mover la imagen"
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-[hsl(var(--background)/0.9)] backdrop-blur-sm border border-[hsl(var(--border))] shadow-sm text-[hsl(var(--muted-foreground))] cursor-grab active:cursor-grabbing"
              style={{ touchAction: 'none' }}
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={onHandlePointerUp}
            >
              <GripVertical className="w-4 h-4" />
            </button>
          </div>
        )}
```

Replace with:

```jsx
        {editable && mode === 'view' && (
          <div
            // Top-right: keeps the primary "Editar imagen" affordance in view
            // above the fold on a tall image, clear of the corner resize
            // handles. No separate move handle any more — press-and-hold
            // anywhere on the image body (via boxRef's own pointer handlers
            // above) starts a reorder drag instead.
            className={`absolute top-2 right-2 flex items-center gap-1.5 opacity-100 transition-opacity ${
              selected ? 'sm:opacity-100' : 'sm:opacity-0 sm:group-hover/img:opacity-100'
            }`}
          >
            <button
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
              onClick={() => setMode('edit')}
              className="flex items-center gap-1.5 text-xs font-medium bg-[hsl(var(--background)/0.9)] backdrop-blur-sm border border-[hsl(var(--border))] rounded-lg px-2.5 py-1.5 shadow-sm hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Editar imagen
            </button>
          </div>
        )}
```

(`e.stopPropagation()` is added here so a press on "Editar imagen" never reaches `boxRef`'s new drag-arming `onPointerDown` — without it, tapping the button would also start a pending long-press/drag-arm timer alongside the button's own click.)

- [ ] **Step 8: Add `stopPropagation` to the corner resize handles (verify — likely already correct)**

Find `onResizePointerDown` — it already calls both `e.preventDefault()` and `e.stopPropagation()` (`ImageAnnotationOverlay.jsx`, unchanged). No edit needed here; this step is a verification checkpoint, not a code change.

- [ ] **Step 9: Remove the `dropIndicator` rendering**

Find:

```jsx
      {dropIndicator && (
        <div
          className="fixed h-0.5 bg-amber-500 rounded-full z-50 pointer-events-none"
          style={{ top: dropIndicator.top, left: dropIndicator.left, width: dropIndicator.width }}
        />
      )}

```

Replace with nothing (delete this block — the floating clone from Task 2's hook replaces this visual entirely).

- [ ] **Step 10: Syntax-check the file**

Run: `npx eslint apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`
Expected: no output (clean) — this also confirms no leftover references to the deleted `dragRef`/`dropIndicator`/`getIndicatorRect`/`onHandlePointer*`/`GripVertical`/`findDropPosition`/`moveNode`.

- [ ] **Step 11: Manual check**

Run `pnpm dev:frontend`. At 1440px (mouse): a quick click on an image still selects it (resize handles appear); pressing and dragging past a few pixels lifts the image (visible scale/shadow clone) and moves it, with other blocks sliding out of the way in real time; releasing drops it in the new position. At 390px (touch-emulated): a quick tap still selects; a brief touch-and-release under ~450ms with no real movement does NOT drag; holding still for ~450ms arms the drag (visible cue), and moving afterward reorders exactly like the mouse case; scrolling the note by swiping through an image (without holding still first) still scrolls normally. Confirm "Editar imagen" and the 4 corner resize handles still work without accidentally starting a drag.

- [ ] **Step 12: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx
git commit -m "feat(notes): press-and-hold anywhere on an image to reorder it, with a floating drag preview"
```

---

### Task 4: Full verification pass

- [ ] **Step 1: Run the full notes unit test suite**

Run: `node --test "apps/desktop/src/modules/runly.notes/lib/__tests__/*.test.js"`
Expected: PASS (all files, including the new `drag-reorder.test.js`)

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Run a production build**

Run: `pnpm --filter @runly/desktop exec vite build --mode development`
Expected: builds cleanly, no import/JSX errors. Remove the generated `apps/desktop/dist/` afterward (not committed).

- [ ] **Step 4: Manual QA — 390px and 1440px, both themes (per `docs/ai-context/ui-screen-audit-checklist.md`)**

- Quick tap/click selects an image without moving it.
- Touch: holding still under 450ms, or moving before 450ms elapses, never starts a drag — normal scroll through the note (including over images) still works.
- Touch: holding still past 450ms arms the drag; dragging afterward shows the floating lifted clone following the finger, with siblings sliding out of the way, and drop commits the new position.
- Mouse: press-and-drag past a few pixels starts immediately, same visual behavior.
- "Editar imagen" and all 4 corner resize handles work without triggering a drag-arm.
- Dragging to the very top or very bottom of a note reorders correctly.
- Both themes: the floating clone and lift shadow are visible/readable in both.
