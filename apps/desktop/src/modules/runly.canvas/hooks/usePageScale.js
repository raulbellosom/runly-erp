import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { calibrationScale } from '../lib/measure.js'
import { useUpdatePage } from './useCanvasData.js'

// Page scale calibration: derives { scale, unit } from the stored two-point
// calibration, and owns the drag-to-dialog-to-save flow. `setTool` lets the
// hook put the viewport back in 'calibrate' mode (from the ScaleControl menu)
// and back to 'select' once the dialog closes, saved or not.
export function usePageScale({ boardId, pageId, calibration, setTool }) {
  const updatePage = useUpdatePage(boardId)
  const [pending, setPending] = useState(null) // { a, b } world points awaiting the dialog

  const scale = useMemo(() => {
    const value = calibrationScale(calibration)
    return value ? { scale: value, unit: calibration.unit } : null
  }, [calibration])

  const startCalibrate = useCallback(() => setTool('calibrate'), [setTool])
  const onViewportCalibrate = useCallback((drawn) => setPending(drawn), [])
  const closeDialog = useCallback(() => { setPending(null); setTool('select') }, [setTool])

  const save = useCallback((distance, unit) => {
    if (!pending || !pageId) return
    updatePage.mutate({ pageId, data: { calibration: { a: pending.a, b: pending.b, distance, unit } } }, {
      onSuccess: () => { toast.success('Escala guardada'); closeDialog() },
      onError: (error) => toast.error(error.message),
    })
  }, [pending, pageId, updatePage, closeDialog])

  const clear = useCallback(() => {
    if (!pageId) return
    updatePage.mutate({ pageId, data: { calibration: null } }, {
      onSuccess: () => toast.success('Escala quitada'),
      onError: (error) => toast.error(error.message),
    })
  }, [pageId, updatePage])

  const pixels = pending ? Math.hypot(pending.b.x - pending.a.x, pending.b.y - pending.a.y) : 0

  return { scale, startCalibrate, onViewportCalibrate, dialogOpen: Boolean(pending), pixels, save, closeDialog, clear, saving: updatePage.isPending }
}
