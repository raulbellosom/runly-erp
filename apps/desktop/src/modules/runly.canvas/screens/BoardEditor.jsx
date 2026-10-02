import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, ErrorState, Sheet, SheetContent, SheetHeader, SheetTitle, Skeleton, cn, useIsMobile } from '@runly/ui'
import { BoardInspector } from '../components/BoardInspector.jsx'
import { CalibrateDialog } from '../components/CalibrateDialog.jsx'
import { CanvasContextMenu } from '../components/CanvasContextMenu.jsx'
import { CanvasToolbar, SHAPES } from '../components/CanvasToolbar.jsx'
import { CanvasViewport } from '../components/CanvasViewport.jsx'
import { DataBindingDialog } from '../components/DataBindingDialog.jsx'
import { EditorTopBar } from '../components/EditorTopBar.jsx'
import { HotspotDialog } from '../components/HotspotDialog.jsx'
import { LayersPanel } from '../components/layers/LayersPanel.jsx'
import { LibraryPanel } from '../components/library/LibraryPanel.jsx'
import { SaveToLibraryDialog } from '../components/library/SaveToLibraryDialog.jsx'
import { libraryItemsKey } from '../hooks/useLibraries.js'
import { MapBackdrop } from '../components/MapBackdrop.jsx'
import { MapLocationDialog } from '../components/MapLocationDialog.jsx'
import { PdfPagesDialog } from '../components/PdfPagesDialog.jsx'
import { ScaleControl } from '../components/ScaleControl.jsx'
import { TextEditDialog } from '../components/TextEditDialog.jsx'
import { ZoomControls } from '../components/ZoomControls.jsx'
import { ShareBoardDialog } from '../components/ShareBoardDialog.jsx'
import { VersionsSheet } from '../components/VersionsSheet.jsx'
import { canEditBoard } from '../lib/roles.js'
import { initialLayerId, parseEmptyAction } from '../lib/boardTemplates.js'
import { sceneBounds } from '../engine/Canvas2DRenderer.js'
import { snapSizeFor } from '../engine/snap.js'
import { measureTextHeight } from '../engine/text.js'
import { DEFAULT_VIEWPORT, fitBounds, screenToWorld, zoomAt } from '../engine/viewport.js'
import { useBindings, useBoard, useCanvasImages, useCanvasObjects, useCanvasTemplates, useEntityLinks, useUpdateBoardSettings, useUpdateHotspot } from '../hooks/useCanvasData.js'
import { toast } from 'sonner'
import { useBoardEditorActions } from '../hooks/useBoardEditorActions.js'
import { useBoardThumbnail } from '../hooks/useBoardThumbnail.js'
import { useCanvasRealtime } from '../hooks/useCanvasRealtime.js'
import { useCanvasShortcuts } from '../hooks/useCanvasShortcuts.js'
import { useContextMenuState } from '../hooks/useContextMenuState.js'
import { useFocusAnimation } from '../hooks/useFocusAnimation.js'
import { useExportPage } from '../hooks/useExportPage.js'
import { usePageMap } from '../hooks/usePageMap.js'
import { usePageScale } from '../hooks/usePageScale.js'
import { useSharpPdfImages } from '../hooks/useSharpPdfImages.js'
import { useMiraiRecordContext } from '../../runly.chat/lib/miraiPageContext.js'

const HINTS = {
  text: 'Toca el lienzo para escribir un texto', hotspot: 'Toca el lienzo para colocar un hotspot',
  measure: 'Arrastra para medir · Shift mantiene 45°', calibrate: 'Traza una línea sobre una medida conocida',
}
const hintFor = (tool) => HINTS[tool] ?? (SHAPES[tool] ? `Arrastra para dibujar: ${SHAPES[tool].label.toLowerCase()} · Shift mantiene proporción` : null)

function DesktopPanel({ side, label, children }) {
  return (
    <aside aria-label={label} className={cn('shrink-0 border-[hsl(var(--border))] bg-[hsl(var(--card))]', side === 'left' ? 'w-72 border-r' : 'w-80 border-l')}>
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
  const navigate = useNavigate(), board = useBoard(boardId), isDesktop = !useIsMobile(1280)
  const queryClient = useQueryClient()
  const [pageId, setPageId] = useState(null), [layerId, setLayerId] = useState(null), [selectedIds, setSelectedIds] = useState([]), [tool, setTool] = useState('select')
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT), [size, setSize] = useState({ width: 0, height: 0 })
  const [desktopPanels, setDesktopPanels] = useState({ left: true, right: true }), [mobileSheet, setMobileSheet] = useState(null)
  const [dialog, setDialog] = useState(null), [zen, setZen] = useState(false), [shareOpen, setShareOpen] = useState(false), [versionsOpen, setVersionsOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const fittedPageRef = useRef(null)

  const pages = useMemo(() => board.data?.pages ?? [], [board.data])
  const myRole = board.data?.myRole ?? 'VIEWER', readOnly = Boolean(board.data) && !canEditBoard(myRole)
  const settings = board.data?.effectiveSettings ?? null
  const templates = useCanvasTemplates(), updateSettings = useUpdateBoardSettings(boardId)
  const template = templates.data?.find((item) => item.key === board.data?.templateType) ?? null
  const activePage = pages.find((page) => page.id === pageId), layers = useMemo(() => activePage?.layers ?? [], [activePage])
  const objects = useCanvasObjects(boardId, pageId), linksQuery = useEntityLinks(boardId), updateHotspot = useUpdateHotspot(boardId, pageId)
  const { presence, cursors, broadcastPointer } = useCanvasRealtime(boardId, { pageId, selectedIds })
  const pageScale = usePageScale({ boardId, pageId, calibration: activePage?.calibration ?? null, setTool })
  const pageMap = usePageMap({ boardId, pageId, background: activePage?.background ?? null, calibration: activePage?.calibration ?? null, size, setViewport })
  // Lets MirAI answer about "this Board" without the user naming it.
  useMiraiRecordContext({ recordType: 'board', recordId: board.data?.id, label: board.data?.name })

  const layerOrder = useMemo(() => new Map(layers.map((layer, index) => [layer.id, index])), [layers])
  const hiddenLayerIds = useMemo(() => new Set(layers.filter((layer) => !layer.visible).map((layer) => layer.id)), [layers])
  const lockedLayerIds = useMemo(() => new Set(layers.filter((layer) => layer.locked).map((layer) => layer.id)), [layers])
  const allRows = useMemo(() => objects.data ?? [], [objects.data])
  // Paint order: layer stack first, then each object's position in its layer.
  // A hidden element (its own flag, not just a hidden layer) is neither
  // drawn nor selectable from the canvas — it still shows in the Layers tree.
  const rows = useMemo(() => allRows.filter((row) => !hiddenLayerIds.has(row.layerId) && !row.properties?.hidden).sort((a, b) =>
    (layerOrder.get(a.layerId) ?? 0) - (layerOrder.get(b.layerId) ?? 0) || (a.position ?? 0) - (b.position ?? 0)), [allRows, hiddenLayerIds, layerOrder])
  const { flash, focusOn } = useFocusAnimation({ viewport, setViewport, size, hiddenLayerIds })
  // Only visible objects resolve against the ERP; a bound shape in a hidden layer stays unresolved.
  const bindings = useBindings(boardId, rows)
  const exportPage = useExportPage({ board: board.data, activePage, rows, bindings: bindings.data, scale: pageScale.scale })
  const links = useMemo(() => linksQuery.data ?? [], [linksQuery.data])
  const linkedIds = useMemo(() => new Set(links.map((link) => link.targetId)), [links])
  const images = useCanvasImages(allRows)
  // Editor-only: re-renders visible PDF page images from the source PDF at
  // higher resolution as the user zooms in; exports/thumbnails keep using
  // the stored raster (see useExportPage.js / useBoardThumbnail.js).
  const sharpImages = useSharpPdfImages({ rows, viewport, size, images })
  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.includes(row.id)), [rows, selectedIds])
  const selected = selectedRows.length === 1 ? selectedRows[0] : null
  const editableSelection = readOnly ? [] : selectedRows.filter((row) => !lockedLayerIds.has(row.layerId) && !row.properties?.locked)
  const activeLayer = layers.find((layer) => layer.id === layerId)

  useEffect(() => {
    const page = pages[0]
    if (!pageId && page) { setPageId(page.id); setLayerId(initialLayerId(page)) }
  }, [pages, pageId])

  const openDialog = useCallback((next) => setDialog(next), [])
  const actions = useBoardEditorActions({
    boardId, pageId, rows: allRows, layers, layerId, setLayerId, setSelectedIds, setTool, viewport, size, openDialog,
    calibratePage: pageScale.calibratePage, hasCalibration: Boolean(activePage?.calibration),
  })
  useBoardThumbnail({ boardId, enabled: Boolean(board.data) && !readOnly, rows: allRows, saving: actions.saving, board: board.data, loaded: !objects.isLoading })

  // The template's starting tool, applied once per Board for editors only.
  const toolAppliedRef = useRef(null)
  useEffect(() => {
    if (!settings || !layerId || toolAppliedRef.current === boardId) return
    toolAppliedRef.current = boardId
    if (!readOnly && settings.defaultTool && settings.defaultTool !== 'select') actions.chooseTool(settings.defaultTool)
  }, [settings, layerId, boardId, readOnly, actions])

  const fit = useCallback(() => setViewport(fitBounds(sceneBounds(rows), size)), [rows, size])
  useEffect(() => {
    if (!pageId || objects.isLoading || !size.width || fittedPageRef.current === pageId) return
    fittedPageRef.current = pageId
    fit()
  }, [fit, objects.isLoading, pageId, size.width])

  const zoomBy = (factor) => setViewport((current) => zoomAt(current, { x: size.width / 2, y: size.height / 2 }, current.zoom * factor))
  const resetZoom = () => setViewport((current) => zoomAt(current, { x: size.width / 2, y: size.height / 2 }, 1))
  const select = (ids) => {
    setSelectedIds(ids)
    const row = ids.length === 1 ? allRows.find((item) => item.id === ids[0]) : null
    if (row && row.layerId !== layerId) setLayerId(row.layerId)
  }
  const selectAll = () => { setTool('select'); select(rows.filter((row) => !lockedLayerIds.has(row.layerId)).map((row) => row.id)) }
  const contextMenu = useContextMenuState({ rows, selectedIds, select, viewport, size, enabled: Boolean(board.data) })
  const changePage = (id) => {
    const page = pages.find((item) => item.id === id)
    setPageId(id); setSelectedIds([])
    setLayerId(initialLayerId(page))
    if (!isDesktop) setMobileSheet(null)
  }
  const openObject = (object) => {
    if (object.type === 'hotspot') setDialog({ kind: 'hotspot', id: object.id })
    else if (object.type === 'text' && !readOnly && !lockedLayerIds.has(object.layerId)) setDialog({ kind: 'text', id: object.id })
    else if (!isDesktop) setMobileSheet('right')
  }
  const deleteSelection = () => actions.remove(editableSelection)
  // Stores ids, not row references, so the dialog always saves the latest
  // geometry/style even if it opened a moment before the last edit landed.
  const saveToLibrary = (objects) => setDialog({ kind: 'save-library', ids: objects.map((object) => object.id) })
  const saveToLibraryRows = dialog?.kind === 'save-library' ? allRows.filter((row) => dialog.ids.includes(row.id)) : []
  // Dropping a library tile (see LibraryPanel/LibraryItemTile): the payload
  // is just ids, resolved from the same React Query cache the panel already
  // populated (see hooks/useLibraries.js#libraryItemsKey).
  const onLibraryDragOver = (event) => { if (event.dataTransfer.types.includes('application/x-runly-library-item')) event.preventDefault() }
  const onLibraryDrop = (event) => {
    const raw = event.dataTransfer.getData('application/x-runly-library-item')
    if (!raw || readOnly) return
    event.preventDefault()
    let parsed
    try { parsed = JSON.parse(raw) } catch { return }
    const items = queryClient.getQueryData(libraryItemsKey(parsed.libraryId)) ?? []
    const item = items.find((entry) => entry.id === parsed.itemId)
    if (!item) return toast.error('No se encontró el elemento de la biblioteca.')
    const rect = event.currentTarget.getBoundingClientRect()
    const point = screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, viewport)
    actions.insertLibraryItem(item, point)
  }
  const saveText = (object, text) => {
    const row = allRows.find((item) => item.id === object.id)
    if (row) actions.patch([row], { properties: { text }, geometry: { height: measureTextHeight(text, row.style, row.geometry?.width ?? 220) } }, 'Editar texto')
  }

  const { spacePan } = useCanvasShortcuts({
    enabled: Boolean(board.data),
    onTool: (next) => { if (!readOnly || next === 'select' || next === 'pan' || next === 'measure') actions.chooseTool(next) },
    onInsert: () => { if (!readOnly) actions.openFilePicker() },
    onDelete: deleteSelection,
    onDuplicate: () => actions.duplicate(editableSelection),
    onNudge: (dx, dy) => actions.nudge(editableSelection, dx, dy),
    onCopy: () => { if (!readOnly) actions.copy(editableSelection) },
    onPaste: () => { if (!readOnly) actions.paste() },
    onFocus: () => { if (selected) focusOn(selected) },
    onOpen: () => { if (selected) openObject(selected) },
    onUndo: () => { if (!readOnly) actions.undo() },
    onRedo: () => { if (!readOnly) actions.redo() },
    onSelectAll: selectAll,
    onEscape: () => {
      if (selectedIds.length || tool !== 'select') { setSelectedIds([]); setTool('select') } else if (zen) setZen(false)
    },
    onZoomIn: () => zoomBy(1.2), onZoomOut: () => zoomBy(1 / 1.2), onReset: resetZoom, onFit: fit,
  })

  const leftOpen = isDesktop ? desktopPanels.left : mobileSheet === 'left'
  const rightOpen = isDesktop ? desktopPanels.right : mobileSheet === 'right'
  const togglePanel = (side) => {
    if (isDesktop) setDesktopPanels((current) => ({ ...current, [side]: !current[side] }))
    else setMobileSheet((current) => current === side ? null : side)
  }

  const pagesPanel = (
    <LayersPanel
      pages={pages} activePageId={pageId} onPageChange={changePage} activeLayerId={layerId} onLayerChange={setLayerId}
      onAddPage={async () => { const page = await actions.addPage(pages.length); if (page?.id) changePage(page.id) }}
      addingPage={actions.createPage.isPending} onToggleLayer={actions.toggleLayer} readOnly={readOnly}
      onAddDataLayer={actions.addDataLayer} addingLayer={actions.addingLayer}
      layers={layers} allRows={allRows} selectedIds={selectedIds} onSelect={select} onFocus={focusOn}
      onSetHidden={actions.setHidden} onSetLocked={actions.setLocked}
      onReorderElements={actions.reorderElements}
    />
  )
  const inspectorPanel = (
    <BoardInspector
      boardId={boardId}
      selectedRows={selectedRows}
      layers={layers}
      lockedLayerIds={lockedLayerIds}
      links={links}
      bindings={bindings.data ?? {}}
      presence={presence}
      readOnly={readOnly}
      settings={settings}
      scale={pageScale.scale}
      onSettingsChange={(next) => updateSettings.mutate(next, { onError: (error) => toast.error(error.message) })}
      actions={{
        patch: actions.patch, remove: actions.remove,
        hotspotChange: (object, data) => {
          if (!object.hotspot) return toast.info('Espera un momento: el hotspot todavía se está guardando.')
          updateHotspot.mutate({ hotspotId: object.hotspot.id, data }, { onError: (error) => toast.error(error.message) })
        }, duplicate: actions.duplicate, arrange: actions.arrange, convertShapes: actions.convertShapes,
        openHotspot: (object) => setDialog({ kind: 'hotspot', id: object.id }),
        editText: (object) => setDialog({ kind: 'text', id: object.id }),
        openDataDialog: (object) => setDialog({ kind: 'data', mode: 'connect', id: object.id }),
        disconnectData: actions.disconnectData, saveToLibrary,
      }}
    />
  )
  const hint = hintFor(tool)
  const empty = template?.emptyState ?? { title: 'Esta página está vacía', description: 'Dibuja formas, escribe textos, coloca hotspots o inserta una imagen o PDF desde la barra inferior.', action: null }
  const emptyAction = parseEmptyAction(empty.action?.kind)
  // The file picker must open from this click: browsers block it otherwise.
  const runEmptyAction = () => {
    if (emptyAction?.type === 'insert-media') actions.openFilePicker()
    else if (emptyAction?.type === 'tool') actions.chooseTool(emptyAction.tool)
    else if (emptyAction?.type === 'map') pageMap.open()
  }
  const subtitle = [activePage?.name, activeLayer ? `Capa: ${activeLayer.name}` : null].filter(Boolean).join(' · ')
  const dialogObject = dialog ? allRows.find((row) => row.id === dialog.id) ?? null : null

  if (board.isError) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <ErrorState title="No se pudo abrir el Board" description={board.error?.message} onRetry={() => board.refetch()} />
      </div>
    )
  }

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden bg-[hsl(var(--background))]', zen ? 'fixed inset-0 z-50 h-dvh' : 'h-full')}>
      <EditorTopBar
        title={board.data?.name ?? 'Board'} subtitle={subtitle || 'Sin páginas'} loading={board.isLoading} saving={actions.saving}
        presence={presence} onBack={() => navigate('/app/m/runly.canvas')}
        leftOpen={leftOpen} rightOpen={rightOpen} onToggleLeft={() => togglePanel('left')} onToggleRight={() => togglePanel('right')}
        zen={zen} onToggleZen={() => setZen((value) => !value)}
        history={{ undo: actions.undo, redo: actions.redo, canUndo: actions.canUndo, canRedo: actions.canRedo, undoLabel: actions.undoLabel, redoLabel: actions.redoLabel }}
        readOnly={readOnly} onShare={() => setShareOpen(true)} onVersions={() => setVersionsOpen(true)}
        onExport={exportPage.exportAs} exportDisabled={exportPage.exportDisabled}
      />
      <div className="flex min-h-0 flex-1">
        {isDesktop && leftOpen ? <DesktopPanel side="left" label="Páginas y capas">{pagesPanel}</DesktopPanel> : null}
        <div className="@container relative min-w-0 flex-1 overflow-hidden bg-[hsl(var(--muted)/0.4)]" onDragOver={onLibraryDragOver} onDrop={onLibraryDrop}>
          {board.isLoading || objects.isLoading ? <Skeleton className="absolute inset-3 rounded-2xl" /> : null}
          <MapBackdrop background={activePage?.background} viewport={viewport} size={size} config={pageMap.config} />
          <CanvasViewport
            objects={rows} lockedLayerIds={lockedLayerIds} selectedIds={selectedIds} images={sharpImages} linkedIds={linkedIds}
            onSelect={select} onCreate={actions.create} onCommit={actions.commit} onOpen={openObject}
            tool={tool} spacePan={spacePan} viewport={viewport} onViewportChange={setViewport} onResize={setSize}
            readOnly={readOnly} grid={pageMap.hasMap ? { ...(settings?.grid ?? {}), enabled: false } : settings?.grid} snapSize={snapSizeFor(settings)}
            remote={cursors} onPointerWorld={broadcastPointer} bindings={bindings.data ?? {}} flash={flash}
            scale={pageScale.scale} onCalibrate={pageScale.onViewportCalibrate} onContextMenu={contextMenu.openAt}
          />
          <CanvasContextMenu
            menu={contextMenu.menu} onClose={contextMenu.close} layers={layers} lockedLayerIds={lockedLayerIds}
            readOnly={readOnly} canPaste={actions.canPaste} onFocus={focusOn}
            onEditText={(object) => setDialog({ kind: 'text', id: object.id })}
            onOpenHotspot={(object) => setDialog({ kind: 'hotspot', id: object.id })}
            onDuplicate={actions.duplicate} onCopy={actions.copy} onPaste={actions.paste}
            onConvert={actions.convertShapes} onMoveToLayer={actions.moveToLayer} onArrange={actions.arrange}
            onToggleHidden={actions.setHidden} onToggleLocked={actions.setLocked}
            onConnectData={(object) => setDialog({ kind: 'data', mode: 'connect', id: object.id })}
            onDelete={actions.remove} onSelectAll={selectAll} onFit={fit} onAddToSelection={select}
            onSaveToLibrary={saveToLibrary}
          />

          {!board.isLoading && !objects.isLoading && !rows.length && !hint ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-xs text-center">
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">{readOnly ? 'Esta página está vacía' : empty.title}</p>
                <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{readOnly ? 'Todavía no hay contenido en esta página.' : empty.description}</p>
                {!readOnly && emptyAction ? (
                  <Button size="sm" className="pointer-events-auto mt-3" disabled={actions.inserting} onClick={runEmptyAction}>{empty.action.label}</Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {hint ? (
            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-4">
              <p role="status" className="glass rounded-full px-3.5 py-2 text-center text-xs font-medium shadow-md">
                {hint}<span className="hidden text-[hsl(var(--muted-foreground))] sm:inline"> · Esc para cancelar</span>
              </p>
            </div>
          ) : null}

          {/* Zoom + scale: one vertical stack on the right edge, so the bottom
              bar only holds the drawing tools (also on phones). */}
          <div className="pointer-events-none absolute right-2 top-1/2 z-20 -translate-y-1/2 sm:right-3">
            <ZoomControls orientation="vertical" zoom={viewport.zoom} onZoomIn={() => zoomBy(1.2)} onZoomOut={() => zoomBy(1 / 1.2)} onReset={resetZoom} onFit={fit}>
              <ScaleControl
                scale={pageScale.scale} canEdit={!readOnly} onCalibrate={pageScale.startCalibrate} onClear={pageScale.clear}
                hasMap={pageMap.hasMap} onMap={pageMap.open}
              />
            </ZoomControls>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <CanvasToolbar
              tool={tool} onToolChange={actions.chooseTool} canDelete={editableSelection.length > 0} onDelete={deleteSelection}
              onInsertMedia={actions.openFilePicker} onInsertData={() => setDialog({ kind: 'data', mode: 'insert' })} inserting={actions.inserting}
              onToggleLibrary={() => setLibraryOpen((value) => !value)} libraryOpen={libraryOpen}
              readOnly={readOnly}
            />
          </div>
          <input
            ref={actions.fileInputRef}
            type="file"
            accept="image/*,application/pdf,.dxf"
            className="hidden"
            onChange={(event) => { actions.handleFile(event.target.files?.[0]); event.target.value = '' }}
          />
        </div>
        {isDesktop && rightOpen ? <DesktopPanel side="right" label="Inspector">{inspectorPanel}</DesktopPanel> : null}
      </div>

      {!isDesktop ? (
        <>
          <MobilePanel open={mobileSheet === 'left'} onOpenChange={(open) => setMobileSheet(open ? 'left' : null)} side="left" title="Páginas y capas">{pagesPanel}</MobilePanel>
          <MobilePanel open={mobileSheet === 'right'} onOpenChange={(open) => setMobileSheet(open ? 'right' : null)} side="right" title="Inspector">{inspectorPanel}</MobilePanel>
        </>
      ) : null}

      <HotspotDialog boardId={boardId} pageId={pageId} object={dialog?.kind === 'hotspot' ? dialogObject : null} links={links} readOnly={readOnly} canAttach={myRole === 'COMMENTER'} onOpenChange={(open) => { if (!open) setDialog(null) }} />
      <ShareBoardDialog open={shareOpen} onOpenChange={setShareOpen} boardId={boardId} boardName={board.data?.name ?? 'Board'} myRole={myRole} />
      <VersionsSheet
        open={versionsOpen} onOpenChange={setVersionsOpen} boardId={boardId} currentVersionId={board.data?.currentVersionId}
        canCreate={!readOnly} canRestore={myRole === 'OWNER'}
        onRestored={() => { setSelectedIds([]); setPageId(null); fittedPageRef.current = null }}
      />
      <LibraryPanel
        open={libraryOpen} onOpenChange={setLibraryOpen}
        onInsert={(item) => actions.insertLibraryItem(item, screenToWorld({ x: size.width / 2, y: size.height / 2 }, viewport))}
      />
      <SaveToLibraryDialog open={dialog?.kind === 'save-library'} rows={saveToLibraryRows} onOpenChange={(open) => { if (!open) setDialog(null) }} />
      <TextEditDialog object={dialog?.kind === 'text' ? dialogObject : null} onSave={saveText} onOpenChange={(open) => { if (!open) setDialog(null) }} />
      <DataBindingDialog
        open={dialog?.kind === 'data'} mode={dialog?.mode ?? 'connect'} onOpenChange={(open) => { if (!open) setDialog(null) }}
        pending={actions.batch.isPending}
        onConfirm={(binding, record) => {
          if (dialog?.mode === 'insert') actions.insertData(binding, record)
          else if (dialogObject) actions.connectData(dialogObject, binding)
          setDialog(null)
        }}
      />
      <PdfPagesDialog key={actions.pdf?.file.name} pdf={actions.pdf} busy={actions.inserting} onConfirm={(pagesToInsert) => actions.insertPdfPages(pagesToInsert)} onCancel={actions.cancelPdf} />
      <CalibrateDialog
        open={pageScale.dialogOpen} onOpenChange={(open) => { if (!open) pageScale.closeDialog() }}
        pixels={pageScale.pixels} onSave={pageScale.save} pending={pageScale.saving}
      />
      <MapLocationDialog
        open={pageMap.dialogOpen} onOpenChange={(open) => { if (!open) pageMap.close() }}
        current={activePage?.background ?? null} hasManualCalibration={pageMap.hasManualCalibration} hasObjects={rows.length > 0}
        onSave={pageMap.save} onRemove={pageMap.remove} pending={pageMap.pending}
      />
    </div>
  )
}
