import { useEffect, useRef } from 'react'
import {
  moveNode, computeBlockRects, computeShiftMap, findCandidateIndex, findScrollParent,
  exceedsDragThreshold, LONG_PRESS_MS, computeIndicatorRect,
} from '../lib/dragReorder.js'

// Auto-scroll the note while dragging near the top/bottom of its viewport,
// so a block can be moved past what is currently visible.
const AUTOSCROLL_EDGE_PX = 56
const AUTOSCROLL_STEP_PX = 14

// Blocks taller than this are compacted while dragged (see startDrag): the
// preview scales down to about COMPACT_PREVIEW_PX tall (never below
// COMPACT_MIN_SCALE) and the slot collapses to COMPACT_SLOT_PX.
const COMPACT_MIN_PX = 160
const COMPACT_PREVIEW_PX = 140
const COMPACT_MIN_SCALE = 0.25
const COMPACT_SLOT_PX = 48

const CLONE_LIFT_STYLE = {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: 9999,
  margin: 0,
  transform: 'scale(1.03)',
  boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
  transition: 'none',
}

const INDICATOR_STYLE = {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: 9998,
  border: '2px dashed #f59e0b',
  borderRadius: '8px',
  backgroundColor: 'rgba(245, 158, 11, 0.08)',
  transition: 'top 120ms ease, left 120ms ease',
}

// Press-and-hold-anywhere drag reorder for a top-level block. Touch
// requires a LONG_PRESS_MS hold before arming (so an ordinary scroll
// gesture starting on the block is never hijacked); mouse arms as soon as
// it moves past DRAG_THRESHOLD_PX. Once armed, a floating clone of the
// block follows the pointer and every sibling between the original and
// candidate position slides out of the way in real time. Used by both
// image reordering (docs/superpowers/specs/2026-09-16-notes-image-drag-reorder-design.md)
// and table reordering (docs/superpowers/specs/2026-09-16-notes-table-drag-reorder-design.md).
//
// `getBoxEl`/`getFrameEl` are functions (not refs) returning the current DOM
// element — an image caller can supply `() => boxRef.current`; a table
// caller has no ref of its own and instead resolves the element by
// ProseMirror position (e.g. `() => editor.view.nodeDOM(getPos())`).
// `getBoxEl` is the element whose opacity is dimmed during the drag (its
// own layout slot stays reserved so the reflow math stays correct);
// `getFrameEl` is what's measured/cloned for the floating drag preview —
// for a table these are the same element; for an image `boxEl` also
// carries non-content chrome (control buttons) that shouldn't be part of
// the visual clone, so `frameEl` is narrower.
export function useBlockDragReorder({ editor, getPos, getBoxEl, getFrameEl, editable, isEditing }) {
  const pressRef = useRef(null) // { pointerId, startX, startY, pointerType, timerId }
  const dragRef = useRef(null) // { pointerId, originalPos, originalIndex, blockRects, draggedHeightPx, cloneEl, grabDX, grabDY, candidatePos }
  const wasDragRef = useRef(false) // set true right after a real drag commits; consumed once by the caller's click handler

  useEffect(() => () => {
    clearTimeout(pressRef.current?.timerId)
    pressRef.current = null
    dragRef.current?.cleanup()
  }, [editor, editable, isEditing])

  function cleanupDrag() {
    const d = dragRef.current
    if (!d) return
    clearTimeout(pressRef.current?.timerId)
    pressRef.current = null
    for (const b of d.blockRects) {
      const dom = editor.view.nodeDOM(b.offset)
      if (dom?.style) dom.style.transform = ''
    }
    if (d.slotEl && d.slotRestore) Object.assign(d.slotEl.style, d.slotRestore)
    d.cloneEl?.remove()
    d.indicatorEl?.remove()
    const boxEl = getBoxEl()
    if (boxEl) boxEl.style.opacity = ''
    dragRef.current = null
    window.removeEventListener('pointerup', onWindowPointerUp)
    window.removeEventListener('pointercancel', onWindowPointerCancel)
    window.removeEventListener('touchmove', preventDragScroll)
  }

  // Pointer capture alone doesn't stop the browser from starting a pan and
  // cancelling our pointer stream. Block scrolling only after the long press
  // arms a drag; ordinary swipes on the image/table still scroll the note.
  function preventDragScroll(e) {
    if (dragRef.current && e.cancelable) e.preventDefault()
  }

  // Fallback for when the release/cancel event doesn't reach the dragged
  // element itself (pointer capture can be lost if the pointer leaves the
  // browser window, a modifier interrupts the gesture, etc.) — without
  // this, that leaves the floating clone/indicator permanently orphaned
  // since nothing else would ever call cleanupDrag for that gesture.
  function onWindowPointerUp(e) {
    finishDrag(e)
  }
  function onWindowPointerCancel(e) {
    abortDrag(e)
  }

  function finishDrag(e) {
    const active = dragRef.current
    if (!active || active.pointerId !== e.pointerId) return
    const { originalPos, candidatePos } = active
    active.cleanup()
    if (candidatePos !== originalPos) moveNode(editor, originalPos, candidatePos)
    wasDragRef.current = true
  }

  function abortDrag(e) {
    const active = dragRef.current
    if (!active || active.pointerId !== e.pointerId) return
    active.cleanup()
  }

  function startDrag(e) {
    if (typeof getPos !== 'function') return
    // Self-healing: if a previous gesture's clone/indicator never got
    // cleaned up (e.g. an interrupted drag left dragRef populated), clear
    // it before starting a new one instead of leaving it orphaned forever.
    dragRef.current?.cleanup()
    const boxEl = getBoxEl()
    const frameEl = getFrameEl()
    if (!boxEl || !frameEl) return
    const view = editor.view
    const originalPos = getPos()
    if (!computeBlockRects(view).some((b) => b.offset === originalPos)) return
    const rect = frameEl.getBoundingClientRect()
    const layout = getComputedStyle(frameEl)
    const zoom = rect.width / parseFloat(layout.width) || 1

    // Large blocks (big images, tables, drawings) are compacted while
    // dragged: the floating preview shrinks and the block's slot collapses
    // to a short strip, so moving it past its neighbours takes a short
    // pointer travel instead of the block's whole height.
    const compact = rect.height > COMPACT_MIN_PX
    const scale = compact ? Math.max(COMPACT_MIN_SCALE, COMPACT_PREVIEW_PX / rect.height) : 1
    const slotEl = view.nodeDOM(originalPos)
    const slotRestore = compact && slotEl?.style
      ? { height: slotEl.style.height, minHeight: slotEl.style.minHeight, overflow: slotEl.style.overflow }
      : null
    if (slotRestore) {
      Object.assign(slotEl.style, { height: `${COMPACT_SLOT_PX}px`, minHeight: '0', overflow: 'hidden' })
    }
    // Measured after the collapse: this is the layout the drop math uses.
    const blockRects = computeBlockRects(view)
    const originalIndex = blockRects.findIndex((b) => b.offset === originalPos)
    const slotRect = blockRects[originalIndex]
    const draggedHeightPx = slotRestore ? slotRect.height : rect.height
    // Keeps the pointer "inside" the collapsed slot at drag start even when
    // the block was grabbed far below its new (short) height.
    const pointerOffsetPx = slotRestore ? Math.max(0, e.clientY - slotRect.top - slotRect.height / 2) : 0

    const clone = frameEl.cloneNode(true)
    // cloneNode doesn't copy canvas pixels (drawing blocks).
    const canvases = frameEl.querySelectorAll('canvas')
    clone.querySelectorAll('canvas').forEach((canvas, i) => {
      canvas.getContext('2d')?.drawImage(canvases[i], 0, 0)
    })
    clone.inert = true
    clone.setAttribute('aria-hidden', 'true')
    const grabDX = (e.clientX - rect.left) * scale
    const grabDY = (e.clientY - rect.top) * scale
    Object.assign(clone.style, CLONE_LIFT_STYLE, {
      left: `${e.clientX - grabDX}px`,
      top: `${e.clientY - grabDY}px`,
      // The preview lives outside the zoomed sheet. Scale its descendants
      // together so pixel-sized images keep filling their frame.
      width: layout.width,
      height: layout.height,
      transform: `scale(${zoom * 1.03 * scale})`,
      transformOrigin: 'top left',
    })
    document.body.appendChild(clone)

    const indicator = document.createElement('div')
    Object.assign(indicator.style, INDICATOR_STYLE, {
      left: `${rect.left}px`,
      top: `${slotRect.top}px`,
      width: `${rect.width}px`,
      height: `${draggedHeightPx}px`,
    })
    document.body.appendChild(indicator)

    boxEl.style.opacity = '0'
    const scroller = findScrollParent(view.dom)

    dragRef.current = {
      scroller,
      startScrollTop: scroller?.scrollTop ?? 0,
      pointerId: e.pointerId,
      originalPos,
      originalIndex,
      blockRects,
      draggedWidthPx: rect.width,
      draggedHeightPx,
      pointerOffsetPx,
      slotEl: slotRestore ? slotEl : null,
      slotRestore,
      cloneEl: clone,
      indicatorEl: indicator,
      grabDX,
      grabDY,
      candidatePos: originalPos,
      cleanup: cleanupDrag,
    }
    window.addEventListener('pointerup', onWindowPointerUp)
    window.addEventListener('pointercancel', onWindowPointerCancel)
    if (e.pointerType === 'touch') {
      window.addEventListener('touchmove', preventDragScroll, { passive: false })
    }
  }

  function onPointerDown(e, fromHandle = false) {
    if (!editable || isEditing || e.button !== 0) return
    pressRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      pointerType: e.pointerType,
      fromHandle,
      timerId: null,
    }
    if (e.pointerType === 'touch' && !fromHandle) {
      pressRef.current.timerId = setTimeout(() => {
        if (pressRef.current?.pointerId === e.pointerId) {
          e.target.setPointerCapture?.(e.pointerId)
          startDrag(e)
        }
      }, LONG_PRESS_MS)
    }
  }

  function onHandlePointerDown(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!editable || isEditing || e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    onPointerDown(e, true)
  }

  function onPointerMove(e) {
    const active = dragRef.current
    if (active && active.pointerId === e.pointerId) {
      e.preventDefault()
      const view = editor.view
      const { scroller } = active
      if (scroller) {
        const bounds = scroller.getBoundingClientRect()
        if (e.clientY < bounds.top + AUTOSCROLL_EDGE_PX) scroller.scrollTop -= AUTOSCROLL_STEP_PX
        else if (e.clientY > bounds.bottom - AUTOSCROLL_EDGE_PX) scroller.scrollTop += AUTOSCROLL_STEP_PX
      }
      // blockRects are viewport rects from drag start; translate the pointer
      // into that frame so scrolling mid-drag doesn't skew the drop slot.
      const scrolledPx = (scroller?.scrollTop ?? 0) - active.startScrollTop
      const candidateIndex = findCandidateIndex(active.blockRects, e.clientY + scrolledPx - active.pointerOffsetPx)
      const candidatePos = candidateIndex < active.blockRects.length
        ? active.blockRects[candidateIndex].offset
        : view.state.doc.content.size
      const shiftMap = computeShiftMap({
        blockRects: active.blockRects,
        originalIndex: active.originalIndex,
        candidateIndex,
        draggedHeightPx: active.draggedHeightPx,
      })
      for (const [offset, shiftPx] of shiftMap) {
        const dom = view.nodeDOM(offset)
        if (dom?.style) {
          const zoom = dom.getBoundingClientRect().width / parseFloat(getComputedStyle(dom).width) || 1
          dom.style.transform = shiftPx ? `translateY(${shiftPx / zoom}px)` : ''
        }
      }
      active.candidatePos = candidatePos
      active.cloneEl.style.left = `${e.clientX - active.grabDX}px`
      active.cloneEl.style.top = `${e.clientY - active.grabDY}px`
      const indicatorRect = computeIndicatorRect(active.blockRects, candidateIndex, active.draggedWidthPx, active.draggedHeightPx, active.originalIndex)
      active.indicatorEl.style.left = `${indicatorRect.left}px`
      active.indicatorEl.style.top = `${indicatorRect.top - scrolledPx}px`
      active.indicatorEl.style.width = `${indicatorRect.width}px`
      active.indicatorEl.style.height = `${indicatorRect.height}px`
      return
    }

    const press = pressRef.current
    if (!press || press.pointerId !== e.pointerId) return
    const deltaPx = Math.hypot(e.clientX - press.startX, e.clientY - press.startY)
    if (press.pointerType === 'touch' && !press.fromHandle) {
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
    if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
      finishDrag(e)
      return
    }
    const press = pressRef.current
    if (press?.pointerId === e.pointerId) {
      clearTimeout(press.timerId)
      pressRef.current = null
    }
  }

  function onPointerCancel(e) {
    if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
      abortDrag(e)
      return
    }
    const press = pressRef.current
    if (press?.pointerId === e.pointerId) {
      clearTimeout(press.timerId)
      pressRef.current = null
    }
  }

  return { onPointerDown, onHandlePointerDown, onPointerMove, onPointerUp, onPointerCancel, wasDragRef }
}
