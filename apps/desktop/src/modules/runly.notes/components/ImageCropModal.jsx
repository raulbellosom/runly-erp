import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@runly/ui'
import { RotateCw, Minus, Plus } from 'lucide-react'
import {
  fitRectForAspect,
  rectForZoomCenter,
  effectiveNaturalSize,
  normalizeRotation,
  addRotation,
} from '../lib/imageCrop.js'
import { useRotatedFillSize } from '../hooks/useRotatedFillSize.js'
import { getLoadedNaturalSize } from '../lib/imageLoadState.js'

const PRESETS = [
  { id: 'free', label: 'Libre', ratio: null },
  { id: '1', label: '1:1', ratio: 1 },
  { id: '43', label: '4:3', ratio: 4 / 3 },
  { id: '169', label: '16:9', ratio: 16 / 9 },
]

const MAX_ZOOM = 6
const ZOOM_STEP = 0.25
const MAX_AREA_HEIGHT_FRACTION = 0.6 // matches the previous max-h-[60dvh]

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}
function clampZoom(z) {
  return Math.min(MAX_ZOOM, Math.max(1, z))
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
// Convert a pixel aspect ratio to fraction space using the (rotation-aware)
// effective natural dimensions. Falls back to treating it as already
// fraction-space before the image has loaded (self-corrects once it does).
function toFracRatio(pixelRatio, effNat) {
  if (!pixelRatio) return null
  if (!effNat) return pixelRatio
  return pixelRatio * (effNat.h / effNat.w)
}

// Non-destructive image cropper — iOS "move and scale" style: the
// viewfinder (aspect from a preset, or the image's/existing crop's own
// shape for "Libre") is fixed, and the user pans + zooms the image under
// it. Also rotates in 90° steps. `onApply({ crop, rotation })` receives the
// result; `crop` is null when reset. Internally this still resolves to the
// same { x, y, w, h } fraction rect used everywhere else — only the
// interaction changed, not the stored data shape.
export function ImageCropModal({ open, onOpenChange, src, crop, rotation: initialRotation, onApply }) {
  const containerRef = useRef(null) // measures available width for the viewfinder box
  const areaRef = useRef(null) // the viewfinder box itself (fixed size + shape)
  const rotWrapRef = useRef(null) // sized/positioned per the current crop rect; useRotatedFillSize measures this
  const pointersRef = useRef(new Map()) // active pointerId -> {x,y}, for 1-finger pan / 2-finger pinch
  const gestureRef = useRef(null) // { type:'pan', pointerId, startX, startY, startCenter } | { type:'pinch', startDist, startZoom }
  const imgElRef = useRef(null) // the <img> DOM node — checked for an already-loaded image on open

  const [rotation, setRotation] = useState(normalizeRotation(initialRotation))
  const [preset, setPreset] = useState('free')
  const [freeRatioFrac, setFreeRatioFrac] = useState(null) // fraction-space ratio for "Libre"; null = full image (1)
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState({ x: 0.5, y: 0.5 }) // fraction-space point of the (rotated) image at the viewfinder's center
  const [nat, setNat] = useState(null) // { w, h } — natural size of the ORIGINAL (unrotated) image
  const [areaSize, setAreaSize] = useState(null) // { width, height } px — exact viewfinder size, no letterboxing

  // Reset/seed state whenever the modal opens, from the image's existing
  // crop + rotation so re-opening shows the current framing, not a blank one.
  useEffect(() => {
    if (!open) return
    const r = normalizeRotation(initialRotation)
    setRotation(r)
    setPreset('free')
    if (crop) {
      const ratio = crop.w / crop.h
      setFreeRatioFrac(ratio)
      const fit = fitRectForAspect(ratio)
      setZoom(clampZoom(fit.w / crop.w))
      setCenter({ x: clamp01(crop.x + crop.w / 2), y: clamp01(crop.y + crop.h / 2) })
    } else {
      setFreeRatioFrac(null)
      setZoom(1)
      setCenter({ x: 0.5, y: 0.5 })
    }
    // Only re-seed on an open/close transition, not on every crop/rotation prop tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const effNat = effectiveNaturalSize(nat, rotation)
  const presetRatioPx = PRESETS.find((p) => p.id === preset)?.ratio ?? null
  const viewfinderRatioFrac = preset === 'free' ? (freeRatioFrac ?? 1) : toFracRatio(presetRatioPx, effNat)
  const fitRect = fitRectForAspect(viewfinderRatioFrac)
  const rect = rectForZoomCenter(fitRect, zoom, center)

  // Exact viewfinder pixel size (JS, not CSS aspect-ratio + max-height
  // together — see the notes-editor-mobile-ux spec for why that letterboxes).
  useEffect(() => {
    if (!open) return
    const el = containerRef.current
    if (!el) return
    function recompute() {
      const availW = el.clientWidth
      const availH = window.innerHeight * MAX_AREA_HEIGHT_FRACTION
      const ratioPx = viewfinderRatioFrac && effNat ? viewfinderRatioFrac * (effNat.w / effNat.h) : 1.5
      let w = availW
      let h = w / ratioPx
      if (h > availH) {
        h = availH
        w = h * ratioPx
      }
      if (w > 0 && h > 0) setAreaSize({ width: Math.round(w), height: Math.round(h) })
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    window.addEventListener('resize', recompute)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', recompute)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewfinderRatioFrac, effNat?.w, effNat?.h])

  // A cached image (already displayed inline in the note before this modal's
  // own <img> mounts) can finish loading before onLoad's listener attaches,
  // so `nat` would otherwise never get set. Check synchronously whenever the
  // modal opens or the image changes, in addition to keeping onLoad below
  // for the not-yet-cached case.
  useEffect(() => {
    if (!open) return
    const size = getLoadedNaturalSize(imgElRef.current ?? {})
    if (size) setNat(size)
  }, [open, src])

  // Non-passive wheel listener (desktop): scroll to zoom. React's synthetic
  // wheel handler is passive by default, which would make preventDefault a
  // silent no-op — same reason NoteEditor.jsx's touch bridge uses a native
  // listener instead of a JSX prop.
  useEffect(() => {
    const el = areaRef.current
    if (!el || !open) return
    function onWheel(e) {
      e.preventDefault()
      setZoom((z) => clampZoom(z * (1 - e.deltaY * 0.0015)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [open])

  const fillSize = useRotatedFillSize(rotWrapRef, rotation)

  function handleRotate() {
    setRotation((r) => addRotation(r, 90))
    setZoom(1)
    setCenter({ x: 0.5, y: 0.5 })
  }

  function selectPreset(p) {
    setPreset(p.id)
    setZoom(1)
    setCenter({ x: 0.5, y: 0.5 })
  }

  function pointerXY(e) {
    return { x: e.clientX, y: e.clientY }
  }

  function onAreaPointerDown(e) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, pointerXY(e))
    if (pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()]
      gestureRef.current = { type: 'pinch', startDist: dist(pts[0], pts[1]), startZoom: zoom }
    } else {
      gestureRef.current = { type: 'pan', pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startCenter: center }
    }
  }

  function onAreaPointerMove(e) {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, pointerXY(e))
    const g = gestureRef.current
    if (!g) return

    if (g.type === 'pinch') {
      if (pointersRef.current.size < 2) return
      const pts = [...pointersRef.current.values()]
      const newDist = dist(pts[0], pts[1])
      if (g.startDist > 0) setZoom(clampZoom(g.startZoom * (newDist / g.startDist)))
      return
    }

    if (g.type === 'pan' && g.pointerId === e.pointerId && areaSize) {
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      // Rendered (rotated, windowed) image size in px within the viewfinder.
      const dispW = areaSize.width / rect.w
      const dispH = areaSize.height / rect.h
      setCenter({
        x: clamp01(g.startCenter.x - dx / dispW),
        y: clamp01(g.startCenter.y - dy / dispH),
      })
    }
  }

  function onAreaPointerUp(e) {
    pointersRef.current.delete(e.pointerId)
    const g = gestureRef.current
    if (g?.type === 'pinch' && pointersRef.current.size < 2) {
      const remaining = [...pointersRef.current.entries()][0]
      gestureRef.current = remaining
        ? { type: 'pan', pointerId: remaining[0], startX: remaining[1].x, startY: remaining[1].y, startCenter: center }
        : null
      return
    }
    if (g?.type === 'pan' && g.pointerId === e.pointerId) gestureRef.current = null
  }

  const imgStyle = fillSize
    ? {
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: `${fillSize.width}px`,
        height: `${fillSize.height}px`,
        maxWidth: 'none',
        transform: rotation ? `translate(-50%, -50%) rotate(${rotation}deg)` : 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }
    : { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, pointerEvents: 'none' }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="2xl" mobileVariant="center">
        <DialogHeader>
          <DialogTitle>Recortar imagen</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => selectPreset(p)}
              className={`px-3 h-9 rounded-lg text-xs font-medium border transition-colors ${
                preset === p.id
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="h-5 w-px bg-[hsl(var(--border))] mx-0.5" />
          <button
            onClick={handleRotate}
            title="Girar 90°"
            className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
          >
            <RotateCw className="w-3.5 h-3.5" /> Girar
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
              disabled={zoom <= 1}
              title="Alejar"
              className="flex items-center justify-center w-9 h-9 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-30"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
              disabled={zoom >= MAX_ZOOM}
              title="Acercar"
              className="flex items-center justify-center w-9 h-9 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-30"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Full-width measuring container — its own box is never sized by the
            image, so it gives the ResizeObserver effect a stable "available
            width" to fit the exact-shape viewfinder box inside. */}
        <div ref={containerRef} className="w-full flex justify-center">
          <div
            ref={areaRef}
            className="relative select-none overflow-hidden rounded-lg bg-[hsl(var(--muted))] touch-none cursor-move"
            style={{
              touchAction: 'none',
              width: areaSize ? `${areaSize.width}px` : '100%',
              height: areaSize ? `${areaSize.height}px` : '240px',
            }}
            onPointerDown={onAreaPointerDown}
            onPointerMove={onAreaPointerMove}
            onPointerUp={onAreaPointerUp}
            onPointerCancel={onAreaPointerUp}
          >
            <div
              ref={rotWrapRef}
              className="absolute"
              style={{
                width: `${100 / rect.w}%`,
                left: `${(-rect.x / rect.w) * 100}%`,
                top: `${(-rect.y / rect.h) * 100}%`,
                aspectRatio: effNat ? String(effNat.w / effNat.h) : undefined,
              }}
            >
              <img
                ref={imgElRef}
                src={src}
                alt=""
                draggable={false}
                onLoad={(e) => setNat({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
                style={imgStyle}
              />
            </div>

            {/* Fixed viewfinder outline — purely decorative, the whole box is the window. */}
            <div className="pointer-events-none absolute inset-0 rounded-lg border-2 border-white/90" />
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={() => onApply({ crop: null, rotation: 0 })}
            className="px-3 h-9 rounded-lg text-xs font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] sm:mr-auto"
          >
            Restablecer
          </button>
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 h-9 rounded-lg text-xs font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
          >
            Cancelar
          </button>
          <button
            onClick={() => onApply({ crop: rect, rotation })}
            className="px-4 h-9 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white"
          >
            Aplicar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
