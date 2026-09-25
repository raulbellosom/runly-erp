import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@runly/ui'
import { renderPdfPageThumbnail } from '../lib/canvasBaseImage.js'

// Thumbnails render lazily, one page at a time, at a cheap ~72 DPI — the
// page the user picks gets re-rendered at full resolution by the caller
// (CanvasEditor's insertPdfPage), this component never touches the heavy
// version.
export function CanvasPdfPageDialog({ open, onOpenChange, file, pageCount, onSelect }) {
  const [thumbnails, setThumbnails] = useState({})

  useEffect(() => {
    if (!open || !file || !pageCount) return undefined
    let cancelled = false
    setThumbnails({})
    ;(async () => {
      for (let page = 1; page <= pageCount; page += 1) {
        if (cancelled) return
        try {
          const { dataURL } = await renderPdfPageThumbnail(file, page)
          if (!cancelled) setThumbnails((prev) => ({ ...prev, [page]: dataURL }))
        } catch {
          // A page whose thumbnail fails to render is still selectable —
          // the picker just shows a spinner in its place indefinitely.
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, file, pageCount])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Elegi una pagina</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto pr-1">
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => onSelect(page)}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-border hover:border-amber-500 transition-colors p-1.5"
            >
              <div className="w-full aspect-3/4 rounded bg-muted flex items-center justify-center overflow-hidden">
                {thumbnails[page] ? (
                  <img
                    src={thumbnails[page]}
                    alt={`Pagina ${page}`}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <Loader2 size={16} className="animate-spin text-muted-foreground/50" />
                )}
              </div>
              <span className="text-[11px] text-muted-foreground">Pagina {page}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
