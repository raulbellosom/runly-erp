import { useEffect, useState } from 'react'

// CSS percentages can't express "my width = my parent's height", which is
// exactly what a 90/270-rotated image needs: rendered at the parent's
// SWAPPED pixel dimensions (pre-rotation) so that after `transform:
// rotate()` it exactly fills the parent. This measures the parent live
// (ResizeObserver — covers resize-handle drags, crop/rotation changes,
// window resizes) and returns the raw <img>'s pre-rotation pixel size, or
// null before the parent has a measurable size.
//
// `naturalWidth`/`naturalHeight` (the loaded image's effective natural
// size, when known) are extra dependencies, NOT used in the measurement
// itself — the observed element's own height is CSS `aspect-ratio`-driven
// from these values (see ImageCropModal.jsx/ImageAnnotationOverlay.jsx), so
// it renders at 0 height until they're known. If that happens on a LATER
// render than this hook's own mount (e.g. a cached image's natural size
// arrives asynchronously after an initial 0-height measurement was already
// discarded), the ResizeObserver watching the 0-sized element does not
// reliably re-fire for that specific follow-up layout change. Including
// these values here forces a fresh manual measurement once they arrive,
// instead of depending solely on the observer to catch it.
export function useRotatedFillSize(ref, rotation, naturalWidth, naturalHeight) {
  const [size, setSize] = useState(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined

    function recompute() {
      // Measure layout pixels, before the sheet's zoom. Viewport rectangles
      // already include zoom and would scale the image a second time.
      const style = getComputedStyle(el)
      const width = parseFloat(style.width)
      const height = parseFloat(style.height)
      if (!(width > 0) || !(height > 0)) return
      const swapped = rotation === 90 || rotation === 270
      setSize(swapped ? { width: height, height: width } : { width, height })
    }

    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, rotation, naturalWidth, naturalHeight])

  return size
}
