import { useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'
import { scaleLabel } from '../components/ScaleControl.jsx'
import { exportPdf, exportPng } from '../lib/exportPage.js'

const unwrap = (response) => response?.data ?? response

// Exports the active page to PNG or PDF: resolves signed URLs for its
// images (so they survive in the detached export canvas), then hands the
// scene to lib/exportPage.js. Kept out of BoardEditor.jsx to keep it short.
export function useExportPage({ board, activePage, rows, bindings, scale }) {
  const token = useAuth().session?.access_token
  const [exporting, setExporting] = useState(false)

  async function exportAs(format) {
    setExporting(true)
    try {
      const fileIds = [...new Set(rows.filter((row) => row.type === 'image' && row.properties?.fileId).map((row) => row.properties.fileId))]
      const imageUrls = fileIds.length ? (unwrap(await runly.files.batchSignedUrls(fileIds, token)) ?? {}) : {}
      const options = {
        boardName: board?.name ?? 'Board',
        pageName: activePage?.name ?? 'Página',
        scaleLabel: scale ? `Escala ${scaleLabel(scale)}` : null,
        imageUrls,
        bindings: bindings ?? {},
      }
      const ok = format === 'pdf' ? await exportPdf(rows, options) : await exportPng(rows, options)
      if (ok) toast.success('Exportación lista')
      else toast.error('Esta página está vacía: no hay nada que exportar.')
    } catch (error) {
      toast.error(error?.message ?? 'No se pudo exportar la página.')
    } finally {
      setExporting(false)
    }
  }

  return { exportAs, exporting, exportDisabled: !rows.length }
}
