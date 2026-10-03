import { useEffect, useRef, useState } from 'react'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
  Tooltip, TooltipContent, TooltipTrigger,
} from '@runly/ui'
import { ImageOff, Pencil, Plus, Shapes, Trash2 } from 'lucide-react'
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

// The whole tile does one thing: insert (click at the view's center, or drag
// onto the canvas, handled in BoardEditor). Management lives in a context
// menu (right click, long press on touch, or the Menu key) so no button
// overlaps the thumbnail; Delete/F2 are keyboard shortcuts for it.
// Touch: dragging is off (on phones the library is a Sheet over the board,
// so there is nowhere to drop, and Chrome Android's native long-press drag
// would fight the long-press menu), and the tap that ends a long press must
// not also insert the element.
const coarsePointer = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches)

export function LibraryItemTile({ item, libraryId, imageUrl, onInsert, onRename, onDelete, canEdit }) {
  const objectThumbnail = useObjectThumbnail(item)
  const thumbnail = item.kind === 'image' ? imageUrl : objectThumbnail
  const [touch] = useState(coarsePointer)
  const menuOpenedAtRef = useRef(0)
  const insert = () => { if (Date.now() - menuOpenedAtRef.current > 600) onInsert(item) }

  function keyDown(event) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onInsert(item) }
    else if (canEdit && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); onDelete(item) }
    else if (canEdit && event.key === 'F2') { event.preventDefault(); onRename(item) }
  }

  return (
    <ContextMenu onOpenChange={(open) => { if (open) menuOpenedAtRef.current = Date.now() }}>
      <Tooltip delayDuration={500}>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild>
            <div
              role="button" tabIndex={0} draggable={!touch}
              aria-label={`Insertar ${item.name}`}
              onClick={insert}
              onKeyDown={keyDown}
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-runly-library-item', JSON.stringify({ libraryId, itemId: item.id }))
                event.dataTransfer.effectAllowed = 'copy'
              }}
              // select-none + no touch callout: a long press opens our menu,
              // not the OS "save image / select text" one.
              className="group flex min-w-0 cursor-pointer touch-manipulation select-none flex-col [-webkit-touch-callout:none] items-center gap-1 rounded-lg p-1 text-center outline-none transition-colors hover:bg-[hsl(var(--muted)/0.7)] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] active:scale-[0.97] data-[state=open]:bg-[hsl(var(--muted))] motion-reduce:active:scale-100"
            >
              <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.45)] p-1.5 transition-colors group-hover:border-[hsl(var(--primary)/0.5)]">
                {thumbnail ? (
                  <img src={thumbnail} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
                ) : item.kind === 'image' ? (
                  <ImageOff className="size-5 text-[hsl(var(--muted-foreground))]" />
                ) : (
                  <Shapes className="size-5 text-[hsl(var(--muted-foreground))]" />
                )}
              </div>
              <p className="w-full truncate text-[11px] leading-tight text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))]">{item.name}</p>
            </div>
          </TooltipTrigger>
        </ContextMenuTrigger>
        <TooltipContent side="bottom" className="max-w-56 text-center">
          <p className="font-medium">{item.name}</p>
          <p className="text-[11px] opacity-75">{canEdit ? 'Clic para insertar. Clic derecho para más opciones.' : 'Clic o arrastra para insertar.'}</p>
        </TooltipContent>
      </Tooltip>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => onInsert(item)}><Plus />Insertar en el Board</ContextMenuItem>
        {canEdit ? (
          <>
            <ContextMenuItem onSelect={() => onRename(item)}><Pencil />Renombrar<span className="ml-auto text-xs opacity-60">F2</span></ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onDelete(item)} className="text-destructive focus:bg-destructive/10 focus:text-destructive"><Trash2 />Eliminar<span className="ml-auto text-xs opacity-60">Supr</span></ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}
