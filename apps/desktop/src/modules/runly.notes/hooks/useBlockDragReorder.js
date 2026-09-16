import { useRef } from 'react'
import {
  findDropPosition, moveNode, computeBlockRects, computeShiftMap,
  exceedsDragThreshold, LONG_PRESS_MS, computeIndicatorRect,
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

  function cleanupDrag() {
    const d = dragRef.current
    if (!d) return
    for (const b of d.blockRects) {
      const dom = editor.view.nodeDOM(b.offset)
      if (dom?.style) dom.style.transform = ''
    }
    d.cloneEl?.remove()
    d.indicatorEl?.remove()
    const boxEl = getBoxEl()
    if (boxEl) boxEl.style.opacity = ''
    dragRef.current = null
    window.removeEventListener('pointerup', onWindowPointerUp)
    window.removeEventListener('pointercancel', onWindowPointerCancel)
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
    cleanupDrag()
    if (candidatePos !== originalPos) moveNode(editor, originalPos, candidatePos)
    wasDragRef.current = true
  }

  function abortDrag(e) {
    const active = dragRef.current
    if (!active || active.pointerId !== e.pointerId) return
    cleanupDrag()
  }

  function startDrag(e) {
    if (typeof getPos !== 'function') return
    // Self-healing: if a previous gesture's clone/indicator never got
    // cleaned up (e.g. an interrupted drag left dragRef populated), clear
    // it before starting a new one instead of leaving it orphaned forever.
    if (dragRef.current) cleanupDrag()
    const boxEl = getBoxEl()
    const frameEl = getFrameEl()
    if (!boxEl || !frameEl) return
    const view = editor.view
    const originalPos = getPos()
    const blockRects = computeBlockRects(view)
    const originalIndex = blockRects.findIndex((b) => b.offset === originalPos)
    if (originalIndex === -1) return
    const rect = frameEl.getBoundingClientRect()

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
    window.addEventListener('pointerup', onWindowPointerUp)
    window.addEventListener('pointercancel', onWindowPointerCancel)
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
      const candidatePos = findDropPosition(view, e.clientX, e.clientY)
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
      const indicatorRect = computeIndicatorRect(active.blockRects, candidateIndex, active.draggedWidthPx, active.draggedHeightPx)
      active.indicatorEl.style.left = `${indicatorRect.left}px`
      active.indicatorEl.style.top = `${indicatorRect.top}px`
      active.indicatorEl.style.width = `${indicatorRect.width}px`
      active.indicatorEl.style.height = `${indicatorRect.height}px`
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

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, wasDragRef }
}
