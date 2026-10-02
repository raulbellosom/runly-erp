import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { createGeoFrame, worldBoundsOfBbox } from '../lib/geo.js'
import { fitBounds } from '../engine/viewport.js'
import { useMapConfig, useUpdatePage } from './useCanvasData.js'

// Half-side of the box the viewport fits to when a chosen place has no
// Nominatim bbox (a 300 m square around the origin).
const DEFAULT_HALF_M = 150

// "Fondo de mapa": owns the dialog open state and the save/remove flow for a
// page's map background, including fitting the viewport to the chosen place.
export function usePageMap({ boardId, pageId, background, calibration, size, setViewport }) {
  const mapConfig = useMapConfig()
  const updatePage = useUpdatePage(boardId)
  const [dialogOpen, setDialogOpen] = useState(false)

  const open = useCallback(() => setDialogOpen(true), [])
  const close = useCallback(() => setDialogOpen(false), [])

  const fitToBackground = useCallback((nextBackground) => {
    const frame = createGeoFrame(nextBackground.origin)
    const bounds = nextBackground.bbox
      ? worldBoundsOfBbox(nextBackground.bbox, frame)
      : { x: -DEFAULT_HALF_M, y: -DEFAULT_HALF_M, width: DEFAULT_HALF_M * 2, height: DEFAULT_HALF_M * 2 }
    setViewport(fitBounds(bounds, size))
  }, [setViewport, size])

  const save = useCallback((nextBackground) => {
    if (!pageId) return
    updatePage.mutate({ pageId, data: { background: nextBackground } }, {
      onSuccess: () => { toast.success('Mapa ubicado'); fitToBackground(nextBackground); close() },
      onError: (error) => toast.error(error.message),
    })
  }, [pageId, updatePage, fitToBackground, close])

  const remove = useCallback(() => {
    if (!pageId) return
    updatePage.mutate({ pageId, data: { background: null } }, {
      onSuccess: () => { toast.success('Mapa quitado'); close() },
      onError: (error) => toast.error(error.message),
    })
  }, [pageId, updatePage, close])

  const hasMap = background?.type === 'map'

  return {
    config: mapConfig.data, dialogOpen, open, close, save, remove, pending: updatePage.isPending,
    hasMap, hasManualCalibration: !hasMap && Boolean(calibration),
  }
}
