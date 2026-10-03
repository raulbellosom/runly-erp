// Pointer-based block reordering for TipTap/ProseMirror node views.
// Native HTML5 drag-and-drop does not fire on touch devices, so block
// dragging (e.g. moving an image within a note) is implemented manually
// with pointer events instead, which work uniformly for mouse and touch.

// Pure: drop slot for pointer `y` against the block rects measured when the
// drag started (document order). Measuring live DOM instead would read the
// siblings' own drag shifts back in and make the slot flip-flop, so the drop
// landed somewhere other than where the indicator showed. Returns an index
// into blockRects, or blockRects.length for "after the last block".
export function findCandidateIndex(blockRects, y) {
  for (let i = 0; i < blockRects.length; i++) {
    const r = blockRects[i]
    if (y < r.top + r.height / 2) return i
  }
  return blockRects.length
}

// Nearest scrollable ancestor (the note's scroll container), or null.
export function findScrollParent(el) {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  return null
}

// Moves the node currently at fromPos to targetPos (a position computed
// against the pre-move document, e.g. from findCandidateIndex). No-ops if
// the target falls inside the node being moved.
export function moveNode(editor, fromPos, targetPos) {
  const { state, view } = editor
  const node = state.doc.nodeAt(fromPos)
  if (!node) return
  const nodeSize = node.nodeSize
  if (targetPos >= fromPos && targetPos <= fromPos + nodeSize) return

  const tr = state.tr
  tr.delete(fromPos, fromPos + nodeSize)
  const mappedTarget = tr.mapping.map(targetPos)
  tr.insert(mappedTarget, node.type.create(node.attrs, node.content, node.marks))
  view.dispatch(tr)
}

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

/**
 * Pure: given block rects (document order), the candidate drop array index
 * (from findCandidateIndex), and the dragged block's
 * own width/height in px, returns the exact `{ top, left, width, height }`
 * rect a visible drop-zone indicator should occupy — at the candidate
 * block's own top-left, or below the last block when dropping past the end.
 */
// With `originalIndex` (the dragged block's index) the rect matches the gap
// computeShiftMap actually opens: a no-op drop shows the block's own slot,
// and a drop further DOWN sits `heightPx` above the candidate's original
// top, because the blocks in between slid up by that much.
export function computeIndicatorRect(blockRects, candidateIndex, widthPx, heightPx, originalIndex) {
  if (originalIndex != null && blockRects[originalIndex] &&
      (candidateIndex === originalIndex || candidateIndex === originalIndex + 1)) {
    const r = blockRects[originalIndex]
    return { top: r.top, left: r.left, width: widthPx, height: heightPx }
  }
  const lift = originalIndex != null && candidateIndex > originalIndex ? heightPx : 0
  if (candidateIndex < blockRects.length) {
    const r = blockRects[candidateIndex]
    return { top: r.top - lift, left: r.left, width: widthPx, height: heightPx }
  }
  const last = blockRects[blockRects.length - 1]
  return {
    top: last ? last.bottom - lift : 0,
    left: last ? last.left : 0,
    width: widthPx,
    height: heightPx,
  }
}

// ── table drag reorder ─────────────────────────────────────────────────────

/**
 * Pure: given editor state, walks up from the current selection looking for
 * an ancestor `table` node and returns its top-level document position
 * (the same shape `getPos()` returns for a NodeView) plus the node itself.
 * Returns null when the selection isn't inside a table — the same
 * condition `editor.isActive('table')` reports, computed independently
 * here since callers need the actual position, not just a boolean.
 */
export function findTableAtSelection(state) {
  const $pos = state.selection.$from
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type.name === 'table') {
      return { pos: $pos.before(d), node }
    }
  }
  return null
}
