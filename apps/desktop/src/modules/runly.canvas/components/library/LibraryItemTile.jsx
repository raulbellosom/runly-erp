import { useEffect, useState } from 'react'
import { Button, cn } from '@runly/ui'
import { ImageOff, Shapes, Trash2 } from 'lucide-react'
import { renderScene } from '../../lib/renderScene.js'

// Rendering a library item's thumbnail is pure work (no network beyond the
// image kind's already-fetched signed URL), so once computed it never
// changes for that item id — cached across remounts/re-opens of the panel.
const thumbnailCache = new Map()

function useObjectThumbnail(item) {
  const cached = item.kind === 'objects' ? thumbnailCache.get(item.id) : undefined
  const [url, setUrl] = useState(cached ?? null)
  useEffect(() => {
    if (item.kind !== 'objects') return
    if (thumbnailCache.has(item.id)) { setUrl(thumbnailCache.get(item.id)); return }
    let cancelled = false
    renderScene(item.payload?.objects ?? [], { width: 96, height: 96, padding: 6 })
      .then((canvas) => {
        if (cancelled) return
        const dataUrl = canvas ? canvas.toDataURL('image/png') : null
        thumbnailCache.set(item.id, dataUrl)
        setUrl(dataUrl)
      })
      .catch(() => { if (!cancelled) { thumbnailCache.set(item.id, null); setUrl(null) } })
    return () => { cancelled = true }
  }, [item.id, item.kind, item.payload])
  return url
}

// Library tiles double as drop sources: click inserts at the view's center,
// dragging onto the canvas (handled in BoardEditor) inserts at the drop
// point. The drag payload is just ids — BoardEditor resolves the full item
// from the same React Query cache this panel already populated.
export function LibraryItemTile({ item, libraryId, imageUrl, onInsert, onDelete, canEdit, deleting = false }) {
  const objectThumbnail = useObjectThumbnail(item)
  const thumbnail = item.kind === 'image' ? imageUrl : objectThumbnail

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      aria-label={`Insertar ${item.name}`}
      onClick={() => onInsert(item)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onInsert(item) } }}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-runly-library-item', JSON.stringify({ libraryId, itemId: item.id }))
        event.dataTransfer.effectAllowed = 'copy'
      }}
      className="group relative flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 text-center transition-colors hover:border-[hsl(var(--ring))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
    >
      <div className="flex h-24 w-full items-center justify-center overflow-hidden rounded-lg bg-[hsl(var(--muted)/0.5)]">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
        ) : item.kind === 'image' ? (
          <ImageOff className="h-6 w-6 text-[hsl(var(--muted-foreground))]" />
        ) : (
          <Shapes className="h-6 w-6 text-[hsl(var(--muted-foreground))]" />
        )}
      </div>
      <p className="w-full truncate text-xs font-medium text-[hsl(var(--foreground))]">{item.name}</p>
      {canEdit ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Eliminar elemento"
          disabled={deleting}
          onClick={(event) => { event.stopPropagation(); onDelete(item) }}
          className={cn(
            'absolute right-1 top-1 h-6 w-6 rounded-md bg-[hsl(var(--card))]/90 text-[hsl(var(--muted-foreground))] opacity-0 shadow-sm transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100',
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  )
}
