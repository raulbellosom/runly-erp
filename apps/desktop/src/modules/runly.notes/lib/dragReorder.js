// Pointer-based block reordering for TipTap/ProseMirror node views.
// Native HTML5 drag-and-drop does not fire on touch devices, so block
// dragging (e.g. moving an image within a note) is implemented manually
// with pointer events instead, which work uniformly for mouse and touch.

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
  for (const row of rows) {
    const rowBottom = Math.max(...row.map((r) => r.bottom))
    if (clientY < rowBottom) {
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

// Moves the node currently at fromPos to targetPos (a position computed
// against the pre-move document, e.g. from findDropPosition). No-ops if
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
