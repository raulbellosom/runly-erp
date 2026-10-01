import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, EmptyState, SelectField, Skeleton } from '@runly/ui'
import { Eye, LinkIcon } from 'lucide-react'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { CanvasViewport } from '../components/CanvasViewport.jsx'
import { HotspotViewer } from '../components/HotspotViewer.jsx'
import { ZoomControls } from '../components/ZoomControls.jsx'
import { sceneBounds } from '../engine/Canvas2DRenderer.js'
import { DEFAULT_VIEWPORT, fitBounds, zoomAt } from '../engine/viewport.js'

const UNAVAILABLE = {
  revocado: 'El propietario revocó este enlace.',
  vencido: 'Este enlace ya venció.',
  agotado: 'Este enlace alcanzó su número máximo de aperturas.',
  archivado: 'Este Board ya no está disponible.',
}
const NO_LOCKS = new Set()

async function publicFetch(path) {
  const response = await fetch(`${getApiUrl()}${path}`)
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(json.error ?? 'Enlace no disponible')
    error.reason = json.reason ?? null
    error.status = response.status
    throw error
  }
  return json.data
}

function usePublicImages(imageUrls) {
  const [images, setImages] = useState(() => new Map())
  useEffect(() => {
    let cancelled = false
    for (const [fileId, url] of Object.entries(imageUrls ?? {})) {
      if (!url) continue
      const image = new Image()
      image.onload = () => { if (!cancelled) setImages((current) => new Map(current).set(fileId, image)) }
      image.src = url
    }
    return () => { cancelled = true }
  }, [imageUrls])
  return images
}

// Read-only board for people without a Runly account (public link).
export default function PublicBoardScreen() {
  const { token } = useParams()
  const board = useQuery({ queryKey: ['public-canvas', token], queryFn: () => publicFetch(`/public/canvas/${encodeURIComponent(token)}`), retry: false, staleTime: Infinity })
  const pages = useMemo(() => board.data?.pages ?? [], [board.data])
  const [pageId, setPageId] = useState(null)
  const activePageId = pageId ?? pages[0]?.id ?? null
  const objects = useQuery({
    queryKey: ['public-canvas', token, 'objects', activePageId],
    queryFn: () => publicFetch(`/public/canvas/${encodeURIComponent(token)}/pages/${encodeURIComponent(activePageId)}/objects`),
    enabled: Boolean(activePageId), retry: false,
  })
  const rows = useMemo(() => objects.data?.objects ?? [], [objects.data])
  const images = usePublicImages(objects.data?.imageUrls)
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT), [size, setSize] = useState({ width: 0, height: 0 })
  const [selectedIds, setSelectedIds] = useState([]), [openHotspot, setOpenHotspot] = useState(null)
  const fittedRef = useRef(null)

  const fit = useCallback(() => setViewport(fitBounds(sceneBounds(rows), size)), [rows, size])
  useEffect(() => {
    if (!activePageId || objects.isLoading || !size.width || fittedRef.current === activePageId) return
    fittedRef.current = activePageId
    fit()
  }, [activePageId, fit, objects.isLoading, size.width])
  useEffect(() => { if (board.data?.board?.name) document.title = `${board.data.board.name} · Runly Canvas` }, [board.data])

  const zoomBy = (factor) => setViewport((current) => zoomAt(current, { x: size.width / 2, y: size.height / 2 }, current.zoom * factor))

  if (board.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <EmptyState icon={LinkIcon} title="Enlace no disponible" description={UNAVAILABLE[board.error?.reason] ?? 'Este enlace no existe o ya no está activo. Pide uno nuevo a quien te lo compartió.'} />
      </div>
    )
  }

  const data = board.data
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 sm:px-4">
        {data?.company?.logoUrl ? <img src={data.company.logoUrl} alt={data.company.name} className="h-8 w-8 shrink-0 rounded-md object-contain" /> : null}
        <div className="min-w-0 flex-1">
          {board.isLoading ? <Skeleton className="h-4 w-40" /> : (
            <>
              <h1 className="truncate text-sm font-semibold leading-tight" title={data?.board?.name}>{data?.board?.name}</h1>
              <p className="truncate text-xs leading-tight text-[hsl(var(--muted-foreground))]">{data?.company?.name}</p>
            </>
          )}
        </div>
        {pages.length > 1 ? (
          <SelectField
            aria-label="Página"
            options={pages.map((page) => ({ value: page.id, label: page.name }))}
            value={activePageId}
            onValueChange={(value) => { if (value) { setPageId(value); setSelectedIds([]) } }}
            className="h-9 w-44"
          />
        ) : null}
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[hsl(var(--muted))] px-3 text-xs font-medium text-[hsl(var(--muted-foreground))]">
          <Eye className="h-3.5 w-3.5" />Solo lectura
        </span>
      </header>

      <main className="@container relative min-h-0 flex-1 overflow-hidden bg-[hsl(var(--muted)/0.4)]">
        {board.isLoading || objects.isLoading ? <Skeleton className="absolute inset-3 rounded-2xl" /> : null}
        <CanvasViewport
          objects={rows} lockedLayerIds={NO_LOCKS} selectedIds={selectedIds} images={images} linkedIds={NO_LOCKS}
          onSelect={setSelectedIds} onCreate={() => {}} onCommit={() => {}} onOpen={(object) => { if (object.hotspot) setOpenHotspot(object) }}
          tool="select" spacePan={false} viewport={viewport} onViewportChange={setViewport} onResize={setSize} readOnly
        />
        {!objects.isLoading && activePageId && !rows.length ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Esta página está vacía.</p>
          </div>
        ) : null}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="glass pointer-events-auto hidden rounded-full px-3 py-2 text-xs text-[hsl(var(--muted-foreground))] shadow-md @xl:block">Arrastra para moverte · pellizca o usa la rueda para acercar · toca un pin para ver su información</p>
          <div className="pointer-events-none ml-auto"><ZoomControls zoom={viewport.zoom} onZoomIn={() => zoomBy(1.2)} onZoomOut={() => zoomBy(1 / 1.2)} onReset={() => setViewport((current) => zoomAt(current, { x: size.width / 2, y: size.height / 2 }, 1))} onFit={fit} /></div>
        </div>
      </main>

      <Dialog open={Boolean(openHotspot)} onOpenChange={(open) => { if (!open) setOpenHotspot(null) }}>
        <DialogContent className="max-h-[min(90dvh,640px)] overflow-y-auto sm:max-w-md">
          <DialogHeader><DialogTitle className="sr-only">Hotspot</DialogTitle></DialogHeader>
          {openHotspot ? <HotspotViewer hotspot={openHotspot.hotspot} color={openHotspot.hotspot?.color || openHotspot.style?.stroke} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
