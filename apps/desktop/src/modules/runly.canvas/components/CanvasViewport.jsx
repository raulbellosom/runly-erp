import { useEffect, useRef, useState } from 'react'
import { Canvas2DRenderer } from '../engine/Canvas2DRenderer.js'
import { observeThemeChanges, readCanvasTheme } from '../engine/theme.js'
import { screenToWorld, zoomAt } from '../engine/viewport.js'

const DRAG_THRESHOLD = 4

function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }
function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }

function cursorFor({ tool, spacePan, dragging, hovering }) {
  if (tool === 'pan' || spacePan) return dragging ? 'grabbing' : 'grab'
  if (tool === 'rectangle' || tool === 'hotspot') return 'crosshair'
  if (dragging) return 'grabbing'
  return hovering ? 'move' : 'default'
}

export function CanvasViewport({ objects, lockedLayerIds, selectedId, onSelect, onCreate, onMoveEnd, tool, spacePan, viewport, onViewportChange, onResize }) {
  const canvasRef = useRef(null), rendererRef = useRef(null), dragRef = useRef(null), pointersRef = useRef(new Map())
  const [dragPreview, setDragPreview] = useState(null)
  const [hovering, setHovering] = useState(false)
  const [dragging, setDragging] = useState(false)
  const preview = dragPreview ? objects.map((row) => row.id === dragPreview.id ? dragPreview : row) : objects
  const selectable = lockedLayerIds?.size ? preview.filter((row) => !lockedLayerIds.has(row.layerId)) : preview

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const renderer = new Canvas2DRenderer(canvas); rendererRef.current = renderer
    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect()
      renderer.resize(rect.width, rect.height)
      onResize?.({ width: rect.width, height: rect.height })
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas.parentElement); resize()
    const stopTheme = observeThemeChanges(() => renderer.setTheme(readCanvasTheme(canvas)))
    // React registers wheel listeners as passive, so preventDefault() there is
    // ignored and the page scrolls; a native non-passive listener is required.
    const wheel = (event) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect(), point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      if (event.shiftKey && !event.ctrlKey) { onViewportChange((current) => ({ ...current, x: current.x - (event.deltaX || event.deltaY) })); return }
      const intensity = event.ctrlKey || event.metaKey ? 0.01 : 0.0015
      onViewportChange((current) => zoomAt(current, point, current.zoom * Math.exp(-event.deltaY * intensity)))
    }
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => { observer.disconnect(); stopTheme(); canvas.removeEventListener('wheel', wheel); rendererRef.current = null }
    // Renderer is created once; callbacks are stable setters from the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => rendererRef.current?.render({ objects: preview, viewport, selectedId }), [preview, selectedId, viewport])

  const pointOf = (event) => { const rect = canvasRef.current.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top } }

  function startPinch() {
    const [a, b] = [...pointersRef.current.values()]
    dragRef.current = { mode: 'pinch', distance: distance(a, b) || 1, mid: midpoint(a, b), viewport }
    setDragPreview(null)
  }

  function pointerDown(event) {
    if (event.button === 2) return
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus({ preventScroll: true })
    const screen = pointOf(event)
    pointersRef.current.set(event.pointerId, screen)
    if (pointersRef.current.size === 2) { startPinch(); return }
    if (pointersRef.current.size > 2) return
    if (tool === 'pan' || spacePan || event.button === 1) { dragRef.current = { mode: 'pan', screen, viewport }; setDragging(true); return }
    if (tool === 'rectangle' || tool === 'hotspot') { dragRef.current = { mode: 'create', screen }; return }
    const hit = rendererRef.current?.hitTest(screen, selectable, viewport, event.pointerType === 'touch' ? 14 : 6)
    onSelect(hit?.id ?? null)
    if (hit) dragRef.current = { mode: 'object', screen, object: hit, moved: false }
  }

  function pointerMove(event) {
    const screen = pointOf(event)
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, screen)
    const drag = dragRef.current
    if (!drag) {
      if (tool === 'select' && event.pointerType === 'mouse') setHovering(Boolean(rendererRef.current?.hitTest(screen, selectable, viewport)))
      return
    }
    if (drag.mode === 'pinch') {
      const [a, b] = [...pointersRef.current.values()]
      if (!a || !b) return
      const mid = midpoint(a, b), next = zoomAt(drag.viewport, drag.mid, drag.viewport.zoom * (distance(a, b) / drag.distance))
      onViewportChange({ ...next, x: next.x + mid.x - drag.mid.x, y: next.y + mid.y - drag.mid.y })
      return
    }
    if (drag.mode === 'pan') { onViewportChange({ ...drag.viewport, x: drag.viewport.x + screen.x - drag.screen.x, y: drag.viewport.y + screen.y - drag.screen.y }); return }
    if (drag.mode !== 'object') return
    if (!drag.moved && distance(screen, drag.screen) < DRAG_THRESHOLD) return
    if (!drag.moved) { drag.moved = true; setDragging(true) }
    const dx = (screen.x - drag.screen.x) / viewport.zoom, dy = (screen.y - drag.screen.y) / viewport.zoom
    setDragPreview({ ...drag.object, transform: { ...drag.object.transform, x: (drag.object.transform?.x ?? 0) + dx, y: (drag.object.transform?.y ?? 0) + dy } })
  }

  function pointerUp(event) {
    pointersRef.current.delete(event.pointerId)
    const drag = dragRef.current
    if (drag?.mode === 'pinch') { dragRef.current = pointersRef.current.size ? { mode: 'idle' } : null; return }
    dragRef.current = null
    setDragging(false)
    if (event.type === 'pointercancel') { setDragPreview(null); return }
    if (drag?.mode === 'create' && distance(pointOf(event), drag.screen) < DRAG_THRESHOLD * 2) {
      const world = screenToWorld(drag.screen, viewport)
      onCreate({ type: tool, x: world.x, y: world.y })
    }
    if (drag?.mode === 'object' && drag.moved) {
      const object = dragPreview ?? drag.object
      setDragPreview(null)
      if (object) onMoveEnd(object)
    }
  }

  return (
    <canvas
      ref={canvasRef}
      role="application"
      aria-label="Lienzo del Board. Usa V, H, R y P para cambiar de herramienta, Suprimir para eliminar la selección y + o - para el zoom."
      tabIndex={0}
      className="block h-full w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]"
      style={{ cursor: cursorFor({ tool, spacePan, dragging, hovering }) }}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onPointerLeave={() => setHovering(false)}
      onContextMenu={(event) => event.preventDefault()}
    />
  )
}
