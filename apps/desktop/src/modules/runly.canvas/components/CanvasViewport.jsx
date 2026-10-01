import { useEffect, useLayoutEffect, useRef } from 'react'
import { Canvas2DRenderer } from '../engine/Canvas2DRenderer.js'
import { boxFromDrag, boxOf, hitHandle, isLinear, moveObject, resizeObject, rotateObject } from '../engine/geometry.js'
import { observeThemeChanges, readCanvasTheme } from '../engine/theme.js'
import { screenToWorld, zoomAt } from '../engine/viewport.js'
import { CREATION_TOOLS, draftObject } from '../lib/objectFactory.js'

const DRAG_THRESHOLD = 4
const HANDLE_CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', rotate: 'grab', start: 'move', end: 'move' }

function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }
function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
function overlayText(mode, object) {
  if (mode === 'rotate') return `${Math.round(object.transform?.rotation ?? 0)}°`
  const b = boxOf(object)
  if (isLinear(object)) return `${Math.round(Math.hypot(b.width, b.height))} px`
  return `${Math.round(b.width)} × ${Math.round(b.height)}`
}

function baseCursor(tool, spacePan) {
  if (tool === 'pan' || spacePan) return 'grab'
  if (CREATION_TOOLS.has(tool)) return tool === 'text' ? 'text' : 'crosshair'
  return 'default'
}

// Pointer interaction is imperative: the in-flight object lives in a ref and
// is painted on the next animation frame, so dragging never waits on a React
// render. React state only changes when a gesture commits.
export function CanvasViewport(props) {
  const { tool, spacePan, onViewportChange, onResize } = props
  const canvasRef = useRef(null), rendererRef = useRef(null), dragRef = useRef(null), pointersRef = useRef(new Map())
  const liveRef = useRef(null), propsRef = useRef(props), frameRef = useRef(0)

  function draw() {
    const renderer = rendererRef.current, p = propsRef.current
    if (!renderer) return
    const live = liveRef.current
    let objects = p.objects
    if (live?.object) objects = live.draft ? [...objects, live.object] : objects.map((row) => row.id === live.object.id ? live.object : row)
    renderer.render({
      objects, viewport: p.viewport, selectedId: live?.draft ? null : p.selectedId, images: p.images, linkedIds: p.linkedIds,
      overlay: live?.object && live.mode !== 'move' ? { object: live.object, text: overlayText(live.mode, live.object) } : null,
      interactive: !p.lockedLayerIds?.has(p.objects.find((row) => row.id === p.selectedId)?.layerId),
    })
  }
  function schedule() {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => { frameRef.current = 0; draw() })
  }

  useLayoutEffect(() => {
    propsRef.current = props
    // A committed gesture keeps its preview until the optimistic cache update
    // reaches `objects`, so a shape never flashes back to its old position.
    if (liveRef.current?.committed && props.objects !== liveRef.current.objectsAtCommit) liveRef.current = null
    draw()
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const renderer = new Canvas2DRenderer(canvas); rendererRef.current = renderer
    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect()
      renderer.resize(rect.width, rect.height)
      onResize?.({ width: rect.width, height: rect.height })
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas.parentElement); resize()
    const stopTheme = observeThemeChanges(() => renderer.setTheme(readCanvasTheme(canvas)))
    // React wheel listeners are passive; preventDefault() needs a native one.
    const wheel = (event) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect(), point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      if (event.shiftKey && !event.ctrlKey) { onViewportChange((current) => ({ ...current, x: current.x - (event.deltaX || event.deltaY) })); return }
      const intensity = event.ctrlKey || event.metaKey ? 0.01 : 0.0015
      onViewportChange((current) => zoomAt(current, point, current.zoom * Math.exp(-event.deltaY * intensity)))
    }
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => {
      observer.disconnect(); stopTheme(); canvas.removeEventListener('wheel', wheel)
      cancelAnimationFrame(frameRef.current); rendererRef.current = null
    }
    // Created once; the callbacks are stable state setters from the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (canvasRef.current) canvasRef.current.style.cursor = baseCursor(tool, spacePan) }, [tool, spacePan])

  const pointOf = (event) => { const rect = canvasRef.current.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top } }
  const selectable = () => {
    const { objects, lockedLayerIds } = propsRef.current
    return lockedLayerIds?.size ? objects.filter((row) => !lockedLayerIds.has(row.layerId)) : objects
  }
  const setCursor = (value) => { if (canvasRef.current) canvasRef.current.style.cursor = value }

  function pointerDown(event) {
    if (event.button === 2) return
    const p = propsRef.current
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus({ preventScroll: true })
    const screen = pointOf(event), world = screenToWorld(screen, p.viewport), touch = event.pointerType === 'touch'
    pointersRef.current.set(event.pointerId, screen)
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()]
      liveRef.current = null
      dragRef.current = { mode: 'pinch', distance: distance(a, b) || 1, mid: midpoint(a, b), viewport: p.viewport }
      schedule(); return
    }
    if (pointersRef.current.size > 2) return
    if (tool === 'pan' || spacePan || event.button === 1) { dragRef.current = { mode: 'pan', screen, viewport: p.viewport }; setCursor('grabbing'); return }
    if (CREATION_TOOLS.has(tool)) { dragRef.current = { mode: 'create', screen, world }; return }

    const selected = selectable().find((row) => row.id === p.selectedId)
    const handle = selected && hitHandle(world, selected, p.viewport.zoom, touch ? 16 : 9)
    if (handle) { dragRef.current = { mode: handle === 'rotate' ? 'rotate' : 'resize', handle, screen, object: selected, moved: false }; return }
    const hit = rendererRef.current?.hitTest(screen, selectable(), p.viewport, touch ? 14 : 6)
    p.onSelect(hit?.id ?? null)
    if (hit) dragRef.current = { mode: 'move', screen, world, object: hit, moved: false }
    else if (touch) dragRef.current = { mode: 'pan', screen, viewport: p.viewport }
  }

  function pointerMove(event) {
    const p = propsRef.current, screen = pointOf(event)
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, screen)
    const drag = dragRef.current
    if (!drag) {
      if (event.pointerType !== 'mouse' || tool !== 'select' || spacePan) return
      const world = screenToWorld(screen, p.viewport), selected = selectable().find((row) => row.id === p.selectedId)
      const handle = selected && hitHandle(world, selected, p.viewport.zoom, 9)
      setCursor(handle ? HANDLE_CURSORS[handle] : rendererRef.current?.hitTest(screen, selectable(), p.viewport) ? 'move' : 'default')
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
    if (drag.mode === 'idle') return
    if (!drag.moved && distance(screen, drag.screen) < DRAG_THRESHOLD) return
    drag.moved = true
    const world = screenToWorld(screen, p.viewport)
    if (drag.mode === 'create') {
      if (tool === 'hotspot' || tool === 'text') return
      const object = draftObject(tool, boxFromDrag(tool === 'line' || tool === 'arrow' ? tool : 'rectangle', drag.world, world, { constrain: event.shiftKey }))
      liveRef.current = { mode: 'create', draft: true, object }
    } else if (drag.mode === 'move') {
      liveRef.current = { mode: 'move', object: moveObject(drag.object, world.x - drag.world.x, world.y - drag.world.y) }
      setCursor('grabbing')
    } else if (drag.mode === 'rotate') {
      liveRef.current = { mode: 'rotate', object: rotateObject(drag.object, world, { snap: event.shiftKey }) }
      setCursor('grabbing')
    } else {
      liveRef.current = { mode: 'resize', object: resizeObject(drag.object, drag.handle, world, { keepRatio: event.shiftKey || drag.object.type === 'image' }) }
    }
    schedule()
  }

  function pointerUp(event) {
    const p = propsRef.current
    pointersRef.current.delete(event.pointerId)
    const drag = dragRef.current
    if (drag?.mode === 'pinch') { dragRef.current = pointersRef.current.size ? { mode: 'idle' } : null; return }
    dragRef.current = null
    setCursor(baseCursor(tool, spacePan))
    const live = liveRef.current
    if (event.type === 'pointercancel' || !drag) { liveRef.current = null; schedule(); return }
    if (drag.mode === 'create') {
      liveRef.current = null
      // Text and hotspots are placed with a tap; shapes use the dragged box
      // when there is one and fall back to a default size otherwise.
      if (live?.object && drag.moved) p.onCreate({ tool, box: boxOf(live.object) })
      else p.onCreate({ tool, point: drag.world })
      schedule(); return
    }
    if (live?.object && drag.moved && drag.object) {
      liveRef.current = { ...live, committed: true, objectsAtCommit: p.objects }
      p.onCommit(live.object, drag.object)
      // Safety net: drop the preview if the update never reaches `objects`.
      setTimeout(() => { if (liveRef.current?.committed) { liveRef.current = null; schedule() } }, 1500)
    }
  }

  function doubleClick(event) {
    const p = propsRef.current
    const hit = rendererRef.current?.hitTest(pointOf(event), selectable(), p.viewport)
    if (hit) p.onOpen?.(hit)
  }

  return (
    <canvas
      ref={canvasRef}
      role="application"
      aria-label="Lienzo del Board. V seleccionar, H mover vista, R rectángulo, O elipse, L línea, A flecha, T texto, P hotspot. Suprimir elimina la selección; las flechas la desplazan; + y - para el zoom."
      tabIndex={0}
      className="block h-full w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onDoubleClick={doubleClick}
      onContextMenu={(event) => event.preventDefault()}
    />
  )
}
