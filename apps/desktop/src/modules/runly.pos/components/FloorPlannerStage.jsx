// Editable floor planner canvas: hosts the Canvas engine (CanvasViewport +
// Canvas2DRenderer) with the POS drawers (floorDrawers.js) and the
// planner/Canvas-objects adapter (plannerObjects.js). Same look as the
// Canvas Board editor (dot grid, floating zoom controls, hint pill) —
// replaces the old DOM canvas, rulers and polygon-drawing overlay.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Grid3x3 } from 'lucide-react'
import { CanvasViewport } from '../../runly.canvas/components/CanvasViewport.jsx'
import { ZoomControls } from '../../runly.canvas/components/ZoomControls.jsx'
import { sceneBounds } from '../../runly.canvas/engine/Canvas2DRenderer.js'
import { fitBounds, zoomAt } from '../../runly.canvas/engine/viewport.js'
import { ContextMenuOverlay } from './FloorCanvasOverlays.jsx'
import { DEFAULT_SIZES } from '../lib/floorPlannerState.js'
import { POS_DRAWERS } from '../lib/floorDrawers.js'
import { buildPlannerElement, elementToObject, objectToPatch, plannerToObjects } from '../lib/plannerObjects.js'

const CREATION_TOOLS = new Set(Object.keys(DEFAULT_SIZES).filter((kind) => kind !== 'POLYGON'))
const NO_IMAGES = new Map()
const NO_IDS = new Set()
const FIT_PADDING = 48

const TOOL_LABELS = {
  TABLE_SQUARE: 'mesa cuadrada', TABLE_ROUND: 'mesa redonda', BAR: 'barra', SOFA: 'sofá', PLANT: 'planta',
  WALL: 'pared', WINDOW: 'ventana', DOOR: 'puerta', PILLAR: 'columna', STAIRS: 'escaleras', FLOOR_ZONE: 'zona / área',
}

function hintFor(tool) {
  if (tool === 'POLYGON') return 'Haz clic para añadir puntos · doble clic o Enter para terminar'
  const label = TOOL_LABELS[tool]
  return label ? `Arrastra para dibujar: ${label} · clic para tamaño estándar · Esc para cancelar` : null
}

function isEditableTarget(target) { return Boolean(target?.closest?.('input, textarea, [contenteditable], [role="dialog"]')) }

export default function FloorPlannerStage({
  floor, elements, selectedId, onSelect, activeTool, onToolDone, onApply, onPlace, onContextAction,
  clipboardAvailable, showGrid, onShowGridChange, viewport, onViewportChange,
}) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [spacePan, setSpacePan] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const wrapperRef = useRef(null)
  const fittedFloorRef = useRef(null)

  const objects = useMemo(() => plannerToObjects({ floor, elements }), [floor, elements])
  // No fixed floor rectangle: the view frames whatever has been drawn.
  const fit = useCallback(
    () => onViewportChange(fitBounds(sceneBounds(objects), size, FIT_PADDING)),
    [objects, size, onViewportChange],
  )

  // Fit once per floor, as soon as the container has a real size.
  useEffect(() => {
    if (!size.width || !size.height || fittedFloorRef.current === floor?.id) return
    fittedFloorRef.current = floor?.id
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor?.id, size.width, size.height])

  // Holding Space pans, same as the Canvas Board editor; ignored while
  // typing in a field or with a dialog open.
  useEffect(() => {
    function keyDown(event) {
      if (event.code !== 'Space' || event.repeat || isEditableTarget(event.target)) return
      event.preventDefault()
      setSpacePan(true)
    }
    function keyUp(event) { if (event.code === 'Space') setSpacePan(false) }
    function blur() { setSpacePan(false) }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const tool = activeTool === 'SELECT' ? 'select' : activeTool === 'POLYGON' ? 'polygon-draw' : activeTool

  const draftFor = useCallback((kind, box) => {
    const element = buildPlannerElement(kind, box, elements)
    return element ? elementToObject({ ...element, id: '__draft__' }) : null
  }, [elements])

  const handleCreate = useCallback(({ tool: createdTool, box, point, points }) => {
    if (createdTool === 'polygon-draw') { onPlace('POLYGON', { points }); onToolDone(); return }
    onPlace(createdTool, box ?? point)
    onToolDone()
  }, [onPlace, onToolDone])

  const handleCommit = useCallback(
    (changes) => onApply(changes.map(({ next }) => objectToPatch(next))),
    [onApply],
  )

  const handleSelect = useCallback((ids) => onSelect(ids[0] ?? null), [onSelect])

  const handleContextMenu = useCallback((hit, screen) => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    setContextMenu({ clientX: (rect?.left ?? 0) + screen.x, clientY: (rect?.top ?? 0) + screen.y, elementId: hit?.id ?? null })
  }, [])

  const zoomBy = (factor) => onViewportChange(zoomAt(viewport, { x: size.width / 2, y: size.height / 2 }, viewport.zoom * factor))
  const resetZoom = () => onViewportChange(zoomAt(viewport, { x: size.width / 2, y: size.height / 2 }, 1))

  const hint = hintFor(activeTool)

  return (
    <div ref={wrapperRef} className="relative h-full w-full" style={{ background: 'hsl(var(--muted)/0.35)' }}>
      <CanvasViewport
        objects={objects}
        tool={tool}
        spacePan={spacePan}
        viewport={viewport}
        onViewportChange={onViewportChange}
        onResize={setSize}
        selectedIds={selectedId ? [selectedId] : []}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onCommit={handleCommit}
        onContextMenu={handleContextMenu}
        lockedLayerIds={NO_IDS}
        creationTools={CREATION_TOOLS}
        draftFor={draftFor}
        drawers={POS_DRAWERS}
        grid={{ enabled: showGrid, size: 20 }}
        snapSize={showGrid ? 20 : 0}
        images={NO_IMAGES}
        linkedIds={NO_IDS}
      />

      {hint ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-4">
          <p role="status" className="glass rounded-full px-3.5 py-2 text-center text-xs font-medium shadow-md">
            {hint}
          </p>
        </div>
      ) : null}

      {!hint && !objects.length ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-xs text-center">
            <p className="text-sm font-medium text-[hsl(var(--foreground))]">Este plano está vacío</p>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              Elige un elemento en el panel y colócalo con un clic. Dibuja paredes, zonas o un polígono para dar forma a tu local.
            </p>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-4 right-4 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onShowGridChange(!showGrid)}
          aria-pressed={showGrid}
          title={showGrid ? 'Ocultar cuadrícula' : 'Mostrar cuadrícula'}
          className={[
            'pointer-events-auto glass flex h-11 w-11 items-center justify-center rounded-2xl shadow-lg transition-colors sm:h-9 sm:w-9',
            showGrid ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]',
          ].join(' ')}
        >
          <Grid3x3 size={16} />
        </button>
        <ZoomControls zoom={viewport.zoom} onZoomIn={() => zoomBy(1.2)} onZoomOut={() => zoomBy(1 / 1.2)} onReset={resetZoom} onFit={fit} />
      </div>

      {contextMenu ? (
        <ContextMenuOverlay
          menu={contextMenu}
          hasClipboard={clipboardAvailable}
          onAction={onContextAction}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  )
}
