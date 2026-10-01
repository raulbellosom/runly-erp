import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog, ErrorState, Sheet, SheetContent, SheetHeader, SheetTitle, Skeleton, useIsMobile } from '@runly/ui'
import { MapPin, Square } from 'lucide-react'
import { toast } from 'sonner'
import { BoardInspector } from '../components/BoardInspector.jsx'
import { CanvasToolbar } from '../components/CanvasToolbar.jsx'
import { CanvasViewport } from '../components/CanvasViewport.jsx'
import { EditorTopBar } from '../components/EditorTopBar.jsx'
import { PagesLayersPanel } from '../components/PagesLayersPanel.jsx'
import { ZoomControls } from '../components/ZoomControls.jsx'
import { sceneBounds } from '../engine/Canvas2DRenderer.js'
import { DEFAULT_VIEWPORT, fitBounds, zoomAt } from '../engine/viewport.js'
import { useBoard, useCanvasObjects, useCreateHotspot, useCreatePage, useObjectBatch, useUpdateLayer } from '../hooks/useCanvasData.js'
import { useCanvasRealtime } from '../hooks/useCanvasRealtime.js'
import { useCanvasShortcuts } from '../hooks/useCanvasShortcuts.js'

const CREATE_HINTS = { rectangle: { icon: Square, text: 'Toca el lienzo para colocar un rectángulo' }, hotspot: { icon: MapPin, text: 'Toca el lienzo para colocar un hotspot' } }

function DesktopPanel({ side, label, children }) {
  return (
    <aside aria-label={label} className={side === 'left' ? 'w-64 shrink-0 border-r border-[hsl(var(--border))] bg-[hsl(var(--card))]' : 'w-72 shrink-0 border-l border-[hsl(var(--border))] bg-[hsl(var(--card))]'}>
      {children}
    </aside>
  )
}

function MobilePanel({ open, onOpenChange, side, title, children }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className="gap-0 p-0">
        <SheetHeader className="px-4 pb-1 pt-1"><SheetTitle className="text-base">{title}</SheetTitle></SheetHeader>
        <div className="min-h-0 flex-1">{children}</div>
      </SheetContent>
    </Sheet>
  )
}

export default function BoardEditor() {
  // ModuleOutlet mounts screens under `/app/m/:moduleKey/*`, so the board id
  // arrives as the wildcard segment (`/app/m/runly.canvas/<boardId>`).
  const { '*': wildcard } = useParams(), boardId = String(wildcard ?? '').split('/').filter(Boolean)[0]
  const navigate = useNavigate(), board = useBoard(boardId)
  const isDesktop = !useIsMobile(1280)
  const [pageId, setPageId] = useState(null), [layerId, setLayerId] = useState(null), [selectedId, setSelectedId] = useState(null), [tool, setTool] = useState('select')
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT), [size, setSize] = useState({ width: 0, height: 0 })
  const [desktopPanels, setDesktopPanels] = useState({ left: true, right: true }), [mobileSheet, setMobileSheet] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fittedPageRef = useRef(null)

  const pages = useMemo(() => board.data?.pages ?? [], [board.data])
  const activePage = pages.find((page) => page.id === pageId), layers = useMemo(() => activePage?.layers ?? [], [activePage])
  const objects = useCanvasObjects(boardId, pageId), batch = useObjectBatch(boardId, pageId), hotspot = useCreateHotspot(boardId, pageId)
  const createPage = useCreatePage(boardId), updateLayer = useUpdateLayer(boardId)
  const { presence } = useCanvasRealtime(boardId)

  const hiddenLayerIds = useMemo(() => new Set(layers.filter((layer) => !layer.visible).map((layer) => layer.id)), [layers])
  const lockedLayerIds = useMemo(() => new Set(layers.filter((layer) => layer.locked).map((layer) => layer.id)), [layers])
  const allRows = useMemo(() => objects.data ?? [], [objects.data])
  const rows = useMemo(() => allRows.filter((row) => !hiddenLayerIds.has(row.layerId)), [allRows, hiddenLayerIds])
  const objectCounts = useMemo(() => allRows.reduce((acc, row) => ({ ...acc, [row.layerId]: (acc[row.layerId] ?? 0) + 1 }), {}), [allRows])
  const selected = rows.find((row) => row.id === selectedId) ?? null
  const activeLayer = layers.find((layer) => layer.id === layerId), hotspotLayer = layers.find((layer) => layer.type === 'hotspot')

  useEffect(() => {
    const page = pages[0]
    if (!pageId && page) { setPageId(page.id); setLayerId(page.layers?.find((layer) => layer.type === 'vector')?.id ?? page.layers?.[0]?.id) }
  }, [pages, pageId])

  const fit = useCallback(() => setViewport(fitBounds(sceneBounds(rows), size)), [rows, size])
  // Frame each page's content once, after both its objects and the canvas size are known.
  useEffect(() => {
    if (!pageId || objects.isLoading || !size.width || fittedPageRef.current === pageId) return
    fittedPageRef.current = pageId
    fit()
  }, [fit, objects.isLoading, pageId, size.width])

  const zoomBy = (factor) => setViewport((current) => zoomAt(current, { x: size.width / 2, y: size.height / 2 }, current.zoom * factor))
  const changePage = (id) => {
    const page = pages.find((item) => item.id === id)
    setPageId(id); setSelectedId(null)
    setLayerId(page?.layers?.find((layer) => layer.type === 'vector')?.id ?? page?.layers?.[0]?.id)
    if (!isDesktop) setMobileSheet(null)
  }
  const requestDelete = () => { if (selected) setConfirmDelete(true) }

  const { spacePan } = useCanvasShortcuts({
    enabled: Boolean(board.data),
    onTool: setTool,
    onDelete: requestDelete,
    onEscape: () => { setSelectedId(null); setTool('select') },
    onZoomIn: () => zoomBy(1.2),
    onZoomOut: () => zoomBy(1 / 1.2),
    onReset: () => setViewport((current) => zoomAt(current, { x: size.width / 2, y: size.height / 2 }, 1)),
    onFit: fit,
  })

  async function createObject({ type, x, y }) {
    const targetLayer = type === 'hotspot' ? hotspotLayer : activeLayer
    if (!targetLayer || (type !== 'hotspot' && targetLayer.type === 'hotspot')) return toast.error('Selecciona una capa de vectores para dibujar.')
    if (targetLayer.locked) return toast.error(`La capa «${targetLayer.name}» está bloqueada.`)
    const geometry = type === 'hotspot' ? { width: 36, height: 36 } : { width: 160, height: 100 }
    try {
      const response = await batch.mutateAsync([{ op: 'create', clientId: `local-${Date.now()}`, data: { pageId, layerId: targetLayer.id, type, transform: { x: x - geometry.width / 2, y: y - geometry.height / 2, rotation: 0, scaleX: 1, scaleY: 1 }, geometry, style: {} } }])
      const created = response.data?.[0]?.object
      if (type === 'hotspot' && created) await hotspot.mutateAsync({ objectId: created.id, title: 'Nuevo hotspot' })
      setSelectedId(created?.id ?? null); setTool('select')
    } catch (error) { toast.error(error.message) }
  }
  async function moveObject(object) {
    try { await batch.mutateAsync([{ op: 'update', id: object.id, expectedRevision: object.revision, data: { transform: object.transform } }]) }
    catch (error) { toast.error(error.message) }
  }
  async function deleteSelected() {
    if (!selected) return
    try { await batch.mutateAsync([{ op: 'delete', id: selected.id, expectedRevision: selected.revision }]); setSelectedId(null); setConfirmDelete(false) }
    catch (error) { toast.error(error.message) }
  }
  async function addPage() {
    try {
      const page = await createPage.mutateAsync({ name: `Página ${pages.length + 1}` })
      if (page?.id) changePage(page.id)
    } catch (error) { toast.error(error.message) }
  }
  async function toggleLayer(layer, data) {
    try { await updateLayer.mutateAsync({ pageId, layerId: layer.id, data }) }
    catch (error) { toast.error(error.message) }
  }

  const leftOpen = isDesktop ? desktopPanels.left : mobileSheet === 'left'
  const rightOpen = isDesktop ? desktopPanels.right : mobileSheet === 'right'
  const togglePanel = (side) => {
    if (isDesktop) setDesktopPanels((current) => ({ ...current, [side]: !current[side] }))
    else setMobileSheet((current) => current === side ? null : side)
  }

  const pagesPanel = <PagesLayersPanel pages={pages} activePageId={pageId} onPageChange={changePage} activeLayerId={layerId} onLayerChange={setLayerId} onAddPage={addPage} addingPage={createPage.isPending} onToggleLayer={toggleLayer} objectCounts={objectCounts} />
  const inspectorPanel = <BoardInspector selected={selected} layerName={layers.find((layer) => layer.id === selected?.layerId)?.name} presence={presence} onDelete={selected && !lockedLayerIds.has(selected.layerId) ? requestDelete : null} />
  const hint = CREATE_HINTS[tool]
  const subtitle = [activePage?.name, activeLayer ? `Capa: ${activeLayer.name}` : null].filter(Boolean).join(' · ')

  if (board.isError) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <ErrorState title="No se pudo abrir el Board" description={board.error?.message} onRetry={() => board.refetch()} />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[hsl(var(--background))]">
      <EditorTopBar
        title={board.data?.name ?? 'Board'}
        subtitle={subtitle || 'Sin páginas'}
        loading={board.isLoading}
        saving={batch.isPending || hotspot.isPending || updateLayer.isPending}
        presence={presence}
        onBack={() => navigate('/app/m/runly.canvas')}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => togglePanel('left')}
        onToggleRight={() => togglePanel('right')}
      />
      <div className="flex min-h-0 flex-1">
        {isDesktop && leftOpen ? <DesktopPanel side="left" label="Páginas y capas">{pagesPanel}</DesktopPanel> : null}
        <div className="@container relative min-w-0 flex-1 overflow-hidden bg-[hsl(var(--muted)/0.4)]">
          {board.isLoading || objects.isLoading ? <Skeleton className="absolute inset-3 rounded-2xl" /> : null}
          <CanvasViewport
            objects={rows}
            lockedLayerIds={lockedLayerIds}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCreate={createObject}
            onMoveEnd={moveObject}
            tool={tool}
            spacePan={spacePan}
            viewport={viewport}
            onViewportChange={setViewport}
            onResize={setSize}
          />

          {!board.isLoading && !objects.isLoading && !rows.length && !hint ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-xs text-center">
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">Esta página está vacía</p>
                <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Elige Rectángulo o Hotspot en la barra inferior y toca el lienzo para empezar.</p>
              </div>
            </div>
          ) : null}

          {hint ? (
            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-4">
              <p role="status" className="glass flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium shadow-md">
                <hint.icon className="h-3.5 w-3.5 text-primary" />{hint.text}
                <span className="hidden text-[hsl(var(--muted-foreground))] sm:inline">· Esc para cancelar</span>
              </p>
            </div>
          ) : null}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] @3xl:flex-row @3xl:items-end @3xl:justify-center">
            <div className="pointer-events-none flex w-full justify-end @3xl:absolute @3xl:bottom-[max(0.75rem,env(safe-area-inset-bottom))] @3xl:right-3 @3xl:w-auto">
              <ZoomControls zoom={viewport.zoom} onZoomIn={() => zoomBy(1.2)} onZoomOut={() => zoomBy(1 / 1.2)} onReset={() => setViewport((current) => zoomAt(current, { x: size.width / 2, y: size.height / 2 }, 1))} onFit={fit} />
            </div>
            <CanvasToolbar tool={tool} onToolChange={setTool} canDelete={Boolean(selected) && !lockedLayerIds.has(selected?.layerId)} onDelete={requestDelete} />
          </div>
        </div>
        {isDesktop && rightOpen ? <DesktopPanel side="right" label="Inspector">{inspectorPanel}</DesktopPanel> : null}
      </div>

      {!isDesktop ? (
        <>
          <MobilePanel open={mobileSheet === 'left'} onOpenChange={(open) => setMobileSheet(open ? 'left' : null)} side="left" title="Páginas y capas">{pagesPanel}</MobilePanel>
          <MobilePanel open={mobileSheet === 'right'} onOpenChange={(open) => setMobileSheet(open ? 'right' : null)} side="right" title="Inspector">{inspectorPanel}</MobilePanel>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Eliminar objeto"
        description="El objeto se eliminará de esta página. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        loading={batch.isPending}
        onConfirm={deleteSelected}
      />
    </div>
  )
}
