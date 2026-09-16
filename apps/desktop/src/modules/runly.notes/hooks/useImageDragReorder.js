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
