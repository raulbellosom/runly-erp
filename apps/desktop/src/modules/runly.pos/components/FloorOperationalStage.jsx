// Read-only waiter floor view, rendered through the Canvas engine
// (CanvasViewport + Canvas2DRenderer) via the POS adapter (floorObjects.js)
// and drawers (floorDrawers.js). Replaces the old DOM/SVG operational
// canvas component — same data, same click contract, same look.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CanvasViewport } from '../../runly.canvas/components/CanvasViewport.jsx'
import { ZoomControls } from '../../runly.canvas/components/ZoomControls.jsx'
import { sceneBounds } from '../../runly.canvas/engine/Canvas2DRenderer.js'
import { DEFAULT_VIEWPORT, MIN_ZOOM, fitBounds, zoomAt } from '../../runly.canvas/engine/viewport.js'
import { floorToObjects, isTableObject } from '../lib/floorObjects.js'
import { POS_DRAWERS } from '../lib/floorDrawers.js'

const NO_IDS = new Set()
const NO_IMAGES = new Map()
const NO_GRID = { enabled: false }
// Small floors are allowed to zoom in past 100% (unlike the generic Canvas
// fitBounds, which never zooms past 1) so a two-table room still fills the
// screen, matching the old component's `Math.min(..., 1.5)` fit cap.
const MAX_FIT_ZOOM = 2

function fitFloor(objects, size) {
  const bounds = sceneBounds(objects)
  const fitted = fitBounds(bounds, size, 32)
  // fitBounds caps the zoom at 1 ("never blow up a small object"); when that
  // cap is what we got back, redo the ratio uncapped (except for MIN_ZOOM)
  // and clamp it to MAX_FIT_ZOOM instead, so small floors still fill the
  // screen — same center either way.
  if (!bounds || !size.width || !size.height || fitted.zoom < 1) return fitted
  const availableW = Math.max(1, size.width - 64), availableH = Math.max(1, size.height - 64)
  const zoom = Math.min(MAX_FIT_ZOOM, Math.max(MIN_ZOOM, Math.min(availableW / Math.max(bounds.width, 1), availableH / Math.max(bounds.height, 1))))
  return { ...fitted, zoom, x: size.width / 2 - (bounds.x + bounds.width / 2) * zoom, y: size.height / 2 - (bounds.y + bounds.height / 2) * zoom }
}

export default function FloorOperationalStage({ floor, elements = [], tableStates = {}, onTableClick }) {
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const fittedFloorId = useRef(null)

  const objects = useMemo(() => floorToObjects({ floor, elements, tableStates }), [floor, elements, tableStates])

  const fit = useCallback(() => setViewport(fitFloor(objects, size)), [objects, size])

  // Auto-fit once per floor, as soon as the container has a real size.
  useEffect(() => {
    if (!size.width || !size.height || fittedFloorId.current === floor?.id) return
    fittedFloorId.current = floor?.id
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor?.id, size.width, size.height])

  const isTappable = useCallback(
    (object) => {
      if (!isTableObject(object)) return false
      if (object.properties?.status === 'DISABLED') return false
      const tableId = object.properties?.tableId
      // A table shape can reference a tableId that no longer resolves (the
      // table was removed); the old view disabled taps on it entirely.
      if (tableId && !tableStates[tableId]) return false
      return true
    },
    [tableStates],
  )

  const handleOpen = useCallback(
    (object) => {
      if (!isTableObject(object)) return
      const tableId = object.properties?.tableId ?? null
      const table = tableId ? tableStates[tableId] : null
      onTableClick?.(table ?? { id: tableId, name: object.properties?.name ?? '', capacity: object.properties?.capacity ?? 0, status: 'AVAILABLE' })
    },
    [tableStates, onTableClick],
  )

  const zoomBy = (factor) => setViewport((current) => zoomAt(current, { x: size.width / 2, y: size.height / 2 }, current.zoom * factor))

  return (
    <div className="relative h-full w-full" style={{ background: 'hsl(var(--muted)/0.35)' }}>
      <CanvasViewport
        objects={objects}
        readOnly
        tool="select"
        spacePan={false}
        viewport={viewport}
        onViewportChange={setViewport}
        onResize={setSize}
        onSelect={() => {}}
        onCreate={() => {}}
        onCommit={() => {}}
        onOpen={handleOpen}
        isTappable={isTappable}
        drawers={POS_DRAWERS}
        selectedIds={[]}
        lockedLayerIds={NO_IDS}
        images={NO_IMAGES}
        linkedIds={NO_IDS}
        grid={NO_GRID}
      />
      <div className="pointer-events-none absolute bottom-4 right-4 z-10">
        <div className="pointer-events-auto">
          <ZoomControls
            zoom={viewport.zoom}
            onZoomIn={() => zoomBy(1.2)}
            onZoomOut={() => zoomBy(1 / 1.2)}
            onReset={() => setViewport((current) => zoomAt(current, { x: size.width / 2, y: size.height / 2 }, 1))}
            onFit={fit}
          />
        </div>
      </div>
    </div>
  )
}
