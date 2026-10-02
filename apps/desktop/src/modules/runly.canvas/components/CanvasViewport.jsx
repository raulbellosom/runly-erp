import { useEffect, useLayoutEffect, useRef } from 'react'
import { Canvas2DRenderer, sceneBounds } from '../engine/Canvas2DRenderer.js'
import { boxFromDrag, boxOf, hitHandle, isLinear, moveObject, objectBounds, resizeObject, rotateObject } from '../engine/geometry.js'
import { snapMoveDelta, snapPoint } from '../engine/snap.js'
import { observeThemeChanges, readCanvasTheme } from '../engine/theme.js'
import { screenToWorld, zoomAt } from '../engine/viewport.js'
import { CREATION_TOOLS, draftObject } from '../lib/objectFactory.js'

const DRAG_THRESHOLD = 4
const LONG_PRESS_MS = 450
const HANDLE_CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', rotate: 'grab', start: 'move', end: 'move' }

function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }
function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
function rectFrom(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) } }
function intersects(a, b) { return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y }
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

// Pointer interaction is imperative: in-flight objects live in a ref and are
// painted on the next animation frame, so dragging never waits on a React
// render. React state only changes when a gesture commits.
export function CanvasViewport(props) {
  const { tool, spacePan, onViewportChange, onResize } = props
  const canvasRef = useRef(null), rendererRef = useRef(null), dragRef = useRef(null), pointersRef = useRef(new Map())
  const liveRef = useRef(null), propsRef = useRef(props), frameRef = useRef(0), pressTimerRef = useRef(0)

  function draw() {
    const renderer = rendererRef.current, p = propsRef.current
    if (!renderer) return
    const live = liveRef.current
    let objects = p.objects
    if (live?.draft) objects = [...objects, live.draft]
    else if (live?.objects) objects = objects.map((row) => live.objects.get(row.id) ?? row)
    const single = live?.objects?.size === 1 ? [...live.objects.values()][0] : null
    renderer.render({
      objects, viewport: p.viewport, images: p.images, linkedIds: p.linkedIds, grid: p.grid, remote: p.remote ?? [], bindings: p.bindings ?? {},
      selectedIds: live?.draft ? new Set() : new Set(p.selectedIds),
      overlay: single && live.mode !== 'move' ? { object: single, text: overlayText(live.mode, single) } : live?.draft ? { object: live.draft, text: overlayText('create', live.draft) } : null,
      marquee: live?.marquee ?? null,
      interactive: !p.readOnly && p.selectedIds.length === 1 && !p.lockedLayerIds?.has(p.objects.find((row) => row.id === p.selectedIds[0])?.layerId),
    })
  }
  function schedule() {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => { frameRef.current = 0; draw() })
  }

  useLayoutEffect(() => {
    propsRef.current = props
    // A committed gesture keeps its preview until the optimistic cache update
    // reaches `objects`, so shapes never flash back to their old position.
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
      cancelAnimationFrame(frameRef.current); clearTimeout(pressTimerRef.current); rendererRef.current = null
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
  const toggle = (ids, id) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]

  // Touch has no Shift key: holding a finger still turns the gesture into an
  // area selection (empty space) or adds/removes the object under it.
  function armLongPress(drag, hit) {
    clearTimeout(pressTimerRef.current)
    pressTimerRef.current = setTimeout(() => {
      if (dragRef.current !== drag || drag.moved) return
      navigator.vibrate?.(12)
      const p = propsRef.current
      if (hit) { p.onSelect(toggle(p.selectedIds, hit.id)); dragRef.current = { mode: 'idle' }; return }
      dragRef.current = { mode: 'marquee', screen: drag.screen, additive: true, base: p.selectedIds, moved: true }
      liveRef.current = { marquee: rectFrom(drag.screen, drag.screen) }
      schedule()
    }, LONG_PRESS_MS)
  }

  function pointerDown(event) {
    if (event.button === 2) return
    const p = propsRef.current
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus({ preventScroll: true })
    const screen = pointOf(event), world = screenToWorld(screen, p.viewport), touch = event.pointerType === 'touch'
    const additive = event.shiftKey || event.ctrlKey || event.metaKey
    pointersRef.current.set(event.pointerId, screen)
    if (pointersRef.current.size === 2) {
      clearTimeout(pressTimerRef.current)
      const [a, b] = [...pointersRef.current.values()]
      liveRef.current = null
      dragRef.current = { mode: 'pinch', distance: distance(a, b) || 1, mid: midpoint(a, b), viewport: p.viewport }
      schedule(); return
    }
    if (pointersRef.current.size > 2) return
    if (tool === 'pan' || spacePan || event.button === 1) { dragRef.current = { mode: 'pan', screen, viewport: p.viewport }; setCursor('grabbing'); return }
    if (CREATION_TOOLS.has(tool) && !p.readOnly) { dragRef.current = { mode: 'create', screen, world }; return }
    // Read-only (viewers, public links): tap selects or opens a hotspot,
    // dragging always pans; nothing can be moved or resized.
    if (p.readOnly) {
      const hit = rendererRef.current?.hitTest(screen, p.objects, p.viewport, touch ? 14 : 6)
      p.onSelect(hit ? [hit.id] : [])
      dragRef.current = { mode: 'pan', screen, viewport: p.viewport, tapHotspot: hit?.type === 'hotspot' ? hit : null }
      return
    }

    const rows = selectable()
    const single = p.selectedIds.length === 1 ? rows.find((row) => row.id === p.selectedIds[0]) : null
    const handle = single && !additive && hitHandle(world, single, p.viewport.zoom, touch ? 16 : 9)
    if (handle) { dragRef.current = { mode: handle === 'rotate' ? 'rotate' : 'resize', handle, screen, objects: [single], moved: false }; return }

    const hit = rendererRef.current?.hitTest(screen, rows, p.viewport, touch ? 14 : 6)
    if (hit && additive) { p.onSelect(toggle(p.selectedIds, hit.id)); return }
    if (hit) {
      const group = p.selectedIds.includes(hit.id) ? rows.filter((row) => p.selectedIds.includes(row.id)) : [hit]
      if (!p.selectedIds.includes(hit.id)) p.onSelect([hit.id])
      dragRef.current = { mode: 'move', screen, world, objects: group, bounds: sceneBounds(group), hitId: hit.id, moved: false }
      if (touch) armLongPress(dragRef.current, hit)
      return
    }
    if (!additive) p.onSelect([])
    if (touch) { dragRef.current = { mode: 'pan', screen, viewport: p.viewport }; armLongPress(dragRef.current, null); return }
    dragRef.current = { mode: 'marquee', screen, additive, base: additive ? p.selectedIds : [], moved: false }
  }

  function pointerMove(event) {
    const p = propsRef.current, screen = pointOf(event)
    if (event.pointerType !== 'touch') p.onPointerWorld?.(screenToWorld(screen, p.viewport))
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, screen)
    const drag = dragRef.current
    if (!drag) {
      if (event.pointerType !== 'mouse' || tool !== 'select' || spacePan) return
      if (p.readOnly) { setCursor(rendererRef.current?.hitTest(screen, p.objects, p.viewport)?.type === 'hotspot' ? 'pointer' : 'grab'); return }
      const world = screenToWorld(screen, p.viewport)
      const single = p.selectedIds.length === 1 ? selectable().find((row) => row.id === p.selectedIds[0]) : null
      const handle = single && hitHandle(world, single, p.viewport.zoom, 9)
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
    if (drag.mode === 'idle') return
    if (!drag.moved && distance(screen, drag.screen) < DRAG_THRESHOLD) return
    if (!drag.moved) clearTimeout(pressTimerRef.current)
    drag.moved = true
    if (drag.mode === 'pan') { onViewportChange({ ...drag.viewport, x: drag.viewport.x + screen.x - drag.screen.x, y: drag.viewport.y + screen.y - drag.screen.y }); return }
    if (drag.mode === 'marquee') { liveRef.current = { marquee: rectFrom(drag.screen, screen) }; schedule(); return }
    const world = screenToWorld(screen, p.viewport)
    // Alt temporarily disables snapping for the current gesture.
    const snap = event.altKey ? 0 : (p.snapSize ?? 0)
    if (drag.mode === 'create') {
      if (tool === 'hotspot' || tool === 'text') return
      const kind = tool === 'line' || tool === 'arrow' ? tool : 'rectangle'
      liveRef.current = { draft: draftObject(tool, boxFromDrag(kind, snapPoint(drag.world, snap), snapPoint(world, snap), { constrain: event.shiftKey })) }
    } else if (drag.mode === 'move') {
      const { dx, dy } = snapMoveDelta(drag.bounds, world.x - drag.world.x, world.y - drag.world.y, snap)
      liveRef.current = { mode: 'move', objects: new Map(drag.objects.map((object) => [object.id, moveObject(object, dx, dy)])) }
      setCursor('grabbing')
    } else {
      const [object] = drag.objects
      // Rotated boxes resize in their own frame; snapping a world point there
      // would fight the rotation, so only unrotated shapes snap.
      const target = boxOf(object).rotation ? world : snapPoint(world, snap)
      const next = drag.mode === 'rotate'
        ? rotateObject(object, world, { snap: event.shiftKey })
        : resizeObject(object, drag.handle, target, { keepRatio: event.shiftKey || object.type === 'image' })
      liveRef.current = { mode: drag.mode, objects: new Map([[object.id, next]]) }
      if (drag.mode === 'rotate') setCursor('grabbing')
    }
    schedule()
  }

  function pointerUp(event) {
    clearTimeout(pressTimerRef.current)
    const p = propsRef.current
    pointersRef.current.delete(event.pointerId)
    const drag = dragRef.current
    if (drag?.mode === 'pinch') { dragRef.current = pointersRef.current.size ? { mode: 'idle' } : null; return }
    dragRef.current = null
    setCursor(baseCursor(tool, spacePan))
    if (drag?.tapHotspot && !drag.moved && event.type !== 'pointercancel') { p.onOpen?.(drag.tapHotspot); return }
    const live = liveRef.current
    if (event.type === 'pointercancel' || !drag) { liveRef.current = null; schedule(); return }
    if (drag.mode === 'create') {
      liveRef.current = null
      // Text and hotspots are placed with a tap; shapes use the dragged box
      // when there is one and fall back to a default size otherwise.
      if (live?.draft && drag.moved) p.onCreate({ tool, box: boxOf(live.draft) })
      else p.onCreate({ tool, point: snapPoint(drag.world, event.altKey ? 0 : (p.snapSize ?? 0)) })
      schedule(); return
    }
    if (drag.mode === 'marquee') {
      liveRef.current = null
      if (live?.marquee && drag.moved) {
        const a = screenToWorld({ x: live.marquee.x, y: live.marquee.y }, p.viewport)
        const b = screenToWorld({ x: live.marquee.x + live.marquee.width, y: live.marquee.y + live.marquee.height }, p.viewport)
        const area = rectFrom(a, b)
        const hits = selectable().filter((row) => intersects(objectBounds(row), area)).map((row) => row.id)
        p.onSelect([...new Set([...drag.base, ...hits])])
      }
      schedule(); return
    }
    // A plain click on one member of a group narrows the selection to it.
    if (drag.mode === 'move' && !drag.moved && drag.objects.length > 1) { p.onSelect([drag.hitId]); return }
    if (live?.objects && drag.moved && drag.objects) {
      liveRef.current = { ...live, committed: true, objectsAtCommit: p.objects }
      p.onCommit(drag.objects.map((prev) => ({ prev, next: live.objects.get(prev.id) })).filter((change) => change.next), live.mode)
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
      aria-label="Lienzo del Board. V seleccionar, H mover vista, R rectángulo, O elipse, L línea, A flecha, T texto, P hotspot. Ctrl+Z deshacer, Ctrl+Shift+Z rehacer, Ctrl+A seleccionar todo, Suprimir elimina la selección, las flechas la desplazan. Alt al arrastrar desactiva el ajuste a la cuadrícula."
      tabIndex={0}
      className="block h-full w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onPointerLeave={() => propsRef.current.onPointerWorld?.(null)}
      onDoubleClick={doubleClick}
      onContextMenu={(event) => event.preventDefault()}
    />
  )
}
