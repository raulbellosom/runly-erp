import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { objectBounds } from '../engine/geometry.js'
import { fitBounds } from '../engine/viewport.js'

const DURATION_MS = 350
const FLASH_MS = 1000
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2)
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

// Pans/zooms the viewport to frame `object` over ~350ms and leaves a 1s
// flash on it afterwards (see Canvas2DRenderer.drawFlash); jumps instantly
// when the user prefers reduced motion. Does nothing (with a toast) when the
// object's layer is hidden, since the canvas would not show anything.
export function useFocusAnimation({ viewport, setViewport, size, hiddenLayerIds }) {
  const [flash, setFlash] = useState(null)
  const frameRef = useRef(0)
  const flashTimerRef = useRef(0)

  const focusOn = useCallback((object) => {
    if (!object || !size.width || !size.height) return
    if (hiddenLayerIds?.has(object.layerId)) { toast.info('La capa está oculta'); return }
    const bounds = objectBounds(object)
    const framed = fitBounds(bounds, size, 120)
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, framed.zoom))
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    const target = { ...framed, zoom, x: size.width / 2 - center.x * zoom, y: size.height / 2 - center.y * zoom }

    clearTimeout(flashTimerRef.current)
    const startFlash = () => {
      const until = Date.now() + FLASH_MS
      setFlash({ id: object.id, until })
      flashTimerRef.current = setTimeout(() => setFlash((current) => (current?.until === until ? null : current)), FLASH_MS)
    }

    cancelAnimationFrame(frameRef.current)
    if (reducedMotion()) { setViewport(target); startFlash(); return }

    const from = viewport, start = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - start) / DURATION_MS), eased = easeInOut(t)
      setViewport({
        ...target,
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
        zoom: from.zoom + (target.zoom - from.zoom) * eased,
      })
      if (t < 1) frameRef.current = requestAnimationFrame(step)
      else startFlash()
    }
    frameRef.current = requestAnimationFrame(step)
  }, [viewport, setViewport, size, hiddenLayerIds])

  return { flash, focusOn }
}
