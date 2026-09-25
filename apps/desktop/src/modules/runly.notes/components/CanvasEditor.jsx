import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Layers, FileDown, Upload } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@runly/ui'
import { useAuth } from '../../../auth/AuthProvider'
import { supabase } from '../../../lib/supabase'
import { useIsDark } from '../hooks/useIsDark.js'
import { useCanvasScene, useSaveCanvasScene } from '../hooks/useCanvasScene.js'
import {
  ensureLayers,
  defaultLayer,
  assignLayer,
  deriveScene,
  mergeVisibleBack,
  setLayerOpacity,
  setLayerLocked,
  moveElementsToLayer,
  moveElementNear,
  groupElementsByLayer,
  setElementHidden,
  setElementLocked,
  deleteElement,
  renameElement,
  mergeDown,
  duplicateLayer,
  deleteLayerElements,
} from '../lib/canvasLayers.js'
import { SupabaseCanvasSync } from '../lib/SupabaseCanvasSync.js'
import { syncNewImages, hydrateImages, pickManifest, dataURLtoBlob, MAX_IMAGE_BYTES } from '../lib/canvasImages.js'
import { exportCanvasPng, exportCanvasSvg, exportCanvasPdf } from '../lib/canvasExport.js'
import { readImageFullRes, getPdfPageCount, renderPdfPageFullRes, computeFitDimensions } from '../lib/canvasBaseImage.js'
import { CanvasLayersPanel } from './CanvasLayersPanel.jsx'
import { CanvasPdfPageDialog } from './CanvasPdfPageDialog.jsx'

const CanvasStage = lazy(() => import('./CanvasStage.jsx'))
const AUTOSAVE_DELAY = 1500
const PRESENCE_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#06b6d4', '#f97316']

function colorForUser(seed) {
  const s = String(seed ?? '')
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length]
}

function filesArrayToMap(arr) {
  const map = {}
  for (const f of arr) map[f.id] = f
  return map
}

// Top-first list from the panel -> normalised ascending `order` (index 0 in the
// panel is the frontmost layer = highest order).
function orderFromTopFirst(topFirst) {
  const n = topFirst.length
  return topFirst.map((l, i) => ({ ...l, order: n - 1 - i }))
}

export function CanvasEditor({ note }) {
  const { session, userProfile } = useAuth()
  const token = session?.access_token
  const noteId = note?.id
  const isDark = useIsDark()

  const { data, isLoading, error } = useCanvasScene(noteId)
  const saveScene = useSaveCanvasScene(noteId)
  const saveRef = useRef(saveScene)
  saveRef.current = saveScene

  // ── source of truth (refs, never fed back into <Excalidraw> as props) ──
  const elementsRef = useRef([])
  const filesManifestRef = useRef({})
  const appStateRef = useRef({})
  const [layers, setLayers] = useState([defaultLayer()])
  const layersRef = useRef(layers)
  layersRef.current = layers
  const [activeLayerId, setActiveLayerId] = useState(null)
  const activeLayerIdRef = useRef(null)
  activeLayerIdRef.current = activeLayerId

  const [ready, setReady] = useState(false)
  const [showLayers, setShowLayers] = useState(false)
  const showLayersRef = useRef(false)
  showLayersRef.current = showLayers
  const [isMobile, setIsMobile] = useState(false)
  const [pdfPicker, setPdfPicker] = useState(null) // { file, pageCount } while a multi-page PDF awaits a page choice
  const fileInputRef = useRef(null)
  const [selectionCount, setSelectionCount] = useState(0)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const selectionRef = useRef(0)
  const selKeyRef = useRef('')
  // Bumped (throttled) on element changes while the layers panel is open, so the
  // panel's per-layer shape list stays roughly live without re-rendering
  // <CanvasStage> (memoised — a CanvasEditor re-render never reaches it).
  const [elementsVersion, setElementsVersion] = useState(0)
  const lastElementsBump = useRef(0)

  // The ONE frozen object handed to <Excalidraw>. Built once when the scene has
  // loaded; its identity must never change afterwards (see CanvasStage).
  const initialDataRef = useRef(null)

  const apiRef = useRef(null)
  const syncRef = useRef(null)
  const saveTimer = useRef(null)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const on = () => setIsMobile(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // Seed from the server scene once loaded, then reveal the editor.
  useEffect(() => {
    if (!data?.scene || ready) return
    let cancelled = false
    ;(async () => {
      const s = data.scene
      elementsRef.current = Array.isArray(s.elements) ? s.elements : []
      const ls = ensureLayers(s.layers)
      const topLayer = [...ls].sort((a, b) => b.order - a.order)[0]
      filesManifestRef.current = s.files ?? {}
      appStateRef.current = s.appState ?? {}
      const fileArr = await hydrateImages(s.files)
      if (cancelled) return
      initialDataRef.current = {
        elements: deriveScene(elementsRef.current, ls),
        appState: { ...(s.appState ?? {}), collaborators: new Map() },
        files: filesArrayToMap(fileArr),
        scrollToContent: true,
      }
      setLayers(ls)
      setActiveLayerId(topLayer.id)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [data?.scene, ready])

  // Realtime provider — lifecycle keyed by note + token (see NoteEditor's engine).
  useEffect(() => {
    if (!noteId || !token) return undefined
    const sync = new SupabaseCanvasSync({
      noteId,
      supabase,
      identity: {
        id: session?.user?.id,
        name: userProfile?.displayName ?? session?.user?.email ?? 'Usuario',
        color: colorForUser(session?.user?.id ?? session?.user?.email),
        avatarUrl: userProfile?.avatarUrl ?? null,
      },
      getLocalElements: () => elementsRef.current,
      getSnapshot: () => ({
        elements: elementsRef.current,
        layers: layersRef.current,
        appState: appStateRef.current,
        files: filesManifestRef.current,
      }),
      onRemoteElements: (reconciled) => {
        elementsRef.current = reconciled
        apiRef.current?.updateScene({ elements: deriveScene(reconciled, layersRef.current) })
      },
      onRemoteSnapshot: async (snap) => {
        elementsRef.current = Array.isArray(snap.elements) ? snap.elements : elementsRef.current
        if (Array.isArray(snap.layers) && snap.layers.length) setLayers(ensureLayers(snap.layers))
        if (snap.appState) appStateRef.current = snap.appState
        if (snap.files && typeof snap.files === 'object') {
          filesManifestRef.current = snap.files
          try {
            const arr = await hydrateImages(snap.files)
            if (arr.length) apiRef.current?.addFiles(arr)
          } catch {
            /* best effort */
          }
        }
        apiRef.current?.updateScene({
          elements: deriveScene(elementsRef.current, snap.layers ?? layersRef.current),
        })
      },
      onRemoteLayers: (remoteLayers) => {
        const ls = ensureLayers(remoteLayers)
        setLayers(ls)
        apiRef.current?.updateScene({ elements: deriveScene(elementsRef.current, ls) })
      },
      onRemoteFiles: async (files) => {
        filesManifestRef.current = { ...filesManifestRef.current, ...files }
        try {
          const arr = await hydrateImages(files)
          if (arr.length) apiRef.current?.addFiles(arr)
          apiRef.current?.updateScene({
            elements: deriveScene(elementsRef.current, layersRef.current),
          })
        } catch {
          /* best effort */
        }
      },
      onRemotePointer: (p) => {
        const map = new Map()
        map.set(p.senderId, {
          pointer: { x: p.x, y: p.y },
          username: p.user?.name,
          color: p.user?.color,
        })
        apiRef.current?.updateScene({ collaborators: map })
      },
    })
    syncRef.current = sync
    return () => {
      sync.destroy()
      syncRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, token])

  const persist = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveRef.current.mutate({
        elements: elementsRef.current,
        appState: appStateRef.current,
        layers: layersRef.current,
        files: filesManifestRef.current,
      })
    }, AUTOSAVE_DELAY)
  }, [])

  // Flush once on unmount so a fast note switch never drops the last edits.
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current)
      if (elementsRef.current.length || Object.keys(filesManifestRef.current).length) {
        saveRef.current.mutate({
          elements: elementsRef.current,
          appState: appStateRef.current,
          layers: layersRef.current,
          files: filesManifestRef.current,
        })
      }
    },
    [],
  )

  // Stable — never re-created, so <CanvasStage> (memo) never re-renders.
  const handleExcalidrawAPI = useCallback((api) => {
    apiRef.current = api
    // Make sure a reloaded drawing is actually in view (we deliberately don't
    // persist scroll/zoom, so the viewport starts at the origin).
    requestAnimationFrame(() => {
      const els = api.getSceneElements?.() ?? []
      if (els.length) {
        try {
          api.scrollToContent?.(els, { fitToContent: true, animate: false })
        } catch {
          /* older signature */
          api.scrollToContent?.()
        }
      }
    })
  }, [])

  // Upload any freshly added images, then persist + share the manifest so
  // they survive a reload and reach other participants (deltas carry
  // elements, not file bytes). Shared by handleChange (drag/drop/paste,
  // Excalidraw's own image tool) and the high-res insert path below.
  const uploadPendingImages = useCallback(async () => {
    const files = apiRef.current?.getFiles?.() ?? {}
    const hasNew = Object.keys(files).some((id) => !filesManifestRef.current[id]?.url)
    if (!hasNew) return
    try {
      const { manifest, uploadedIds } = await syncNewImages({
        files,
        manifest: filesManifestRef.current,
        noteId,
        token,
      })
      filesManifestRef.current = manifest
      if (uploadedIds.length) {
        syncRef.current?.broadcastFiles(pickManifest(manifest, uploadedIds))
        persist()
      }
    } catch (err) {
      console.warn('[canvas] image upload failed:', err?.message ?? err)
      toast.error(err?.message ?? 'No se pudo subir la imagen al lienzo')
    }
  }, [noteId, token, persist])

  const handleChange = useCallback(
    async (elements, appState) => {
      const active = activeLayerIdRef.current ?? layersRef.current[0]?.id
      const withLayers = elements.map((el) => assignLayer(el, active))
      // Excalidraw only ever hands back visible-layer elements — merge the
      // hidden ones back so the source of truth stays whole.
      elementsRef.current = mergeVisibleBack(elementsRef.current, withLayers, layersRef.current)

      const selMap = appState?.selectedElementIds ?? {}
      const selKeys = Object.keys(selMap).filter((k) => selMap[k])
      if (selKeys.length !== selectionRef.current) {
        selectionRef.current = selKeys.length
        setSelectionCount(selKeys.length)
      }
      const selKey = selKeys.slice().sort().join(',')
      if (showLayersRef.current && selKey !== selKeyRef.current) {
        selKeyRef.current = selKey
        setSelectedIds(new Set(selKeys))
      }

      if (showLayersRef.current && Date.now() - lastElementsBump.current > 400) {
        lastElementsBump.current = Date.now()
        setElementsVersion((v) => v + 1)
      }

      syncRef.current?.notifyLocalChange()
      persist()

      await uploadPendingImages()
    },
    [persist, uploadPendingImages],
  )

  const handlePointer = useCallback((payload) => {
    const p = payload?.pointer
    if (!p) return
    syncRef.current?.broadcastPointer({ x: p.x, y: p.y })
  }, [])

  // Every layer op (visibility / lock / opacity / order / move) pushes its own
  // updateScene, so this only needs to run once the editor is ready to make the
  // initial derived scene authoritative (initialData already seeded it).
  useEffect(() => {
    if (ready) apiRef.current?.updateScene({ elements: deriveScene(elementsRef.current, layersRef.current) })
  }, [ready])

  // When the layers panel opens, pull the current canvas selection so the
  // matching shape rows highlight without needing another canvas interaction.
  useEffect(() => {
    if (!showLayers) return
    const sel = apiRef.current?.getAppState?.().selectedElementIds ?? {}
    const keys = Object.keys(sel).filter((k) => sel[k])
    selKeyRef.current = keys.slice().sort().join(',')
    setSelectedIds(new Set(keys))
    setSelectionCount(keys.length)
    selectionRef.current = keys.length
    setElementsVersion((v) => v + 1)
  }, [showLayers])

  const layerElements = useMemo(
    () => groupElementsByLayer(elementsRef.current, layers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layers, showLayers, elementsVersion],
  )

  const mutateLayers = useCallback(
    (next) => {
      setLayers(next)
      syncRef.current?.broadcastLayers(next)
      persist()
    },
    [persist],
  )

  // Apply an already-computed element list: update the ref, the visible scene,
  // broadcast, persist, and refresh the panel's shape list.
  const applyElements = useCallback(
    (nextElements) => {
      elementsRef.current = nextElements
      apiRef.current?.updateScene({ elements: deriveScene(nextElements, layersRef.current) })
      syncRef.current?.notifyLocalChange()
      persist()
      setElementsVersion((v) => v + 1)
    },
    [persist],
  )

  // A reorder / layer move: Excalidraw 0.18 sorts by `element.index` (a
  // fractional index), NOT array position, so we must NULL every index and let
  // updateScene re-derive them from OUR grouped-by-layer, in-layer array order.
  const applyOrder = useCallback(
    (nextElements, nextLayers) => {
      elementsRef.current = nextElements
      const layersToUse = nextLayers ?? layersRef.current
      const scene = deriveScene(nextElements, layersToUse).map((el) => ({ ...el, index: null }))
      apiRef.current?.updateScene({ elements: scene, captureUpdate: 'IMMEDIATELY' })
      if (nextLayers) {
        setLayers(nextLayers)
        syncRef.current?.broadcastLayers(nextLayers)
      }
      syncRef.current?.notifyLocalChange()
      persist()
      setElementsVersion((v) => v + 1)
    },
    [persist],
  )

  const childHandlers = {
    onSelectElement: (id) => {
      const api = apiRef.current
      if (!api) return
      const el = elementsRef.current.find((e) => e.id === id)
      if (!el || el.customData?.hidden) return
      // A drawing tool being active hides the selection UI — force the pointer
      // tool first, then assert the selection on the next frame so it survives
      // any in-flight updateScene.
      try { api.setActiveTool({ type: 'selection' }) } catch { /* noop */ }
      requestAnimationFrame(() => {
        api.updateScene({
          appState: { selectedElementIds: { [id]: true } },
          captureUpdate: 'IMMEDIATELY',
        })
        try {
          api.scrollToContent([el], { fitToContent: true, animate: true })
        } catch { /* older signature */ }
      })
    },
    onToggleElementHidden: (id) => {
      const el = elementsRef.current.find((e) => e.id === id)
      applyElements(setElementHidden(elementsRef.current, id, !el?.customData?.hidden))
    },
    onToggleElementLocked: (id) => {
      const el = elementsRef.current.find((e) => e.id === id)
      applyElements(setElementLocked(elementsRef.current, id, !el?.locked))
    },
    onDeleteElement: (id) => {
      applyElements(deleteElement(elementsRef.current, id))
    },
    onRenameElement: (id, name) => {
      applyElements(renameElement(elementsRef.current, id, name))
    },
  }

  const layerCbs = {
    activeLayerId,
    layerElements,
    childHandlers,
    onMoveElementToLayer: (elementId, layerId) => {
      applyOrder(moveElementsToLayer(elementsRef.current, new Set([elementId]), layerId))
      setActiveLayerId(layerId)
    },
    onMoveElementNear: (draggedId, targetId) => {
      applyOrder(moveElementNear(elementsRef.current, draggedId, targetId))
    },
    onSelect: setActiveLayerId,
    onRename: (id, name) => mutateLayers(layers.map((l) => (l.id === id ? { ...l, name } : l))),
    onSetColor: (id, color) => mutateLayers(layers.map((l) => (l.id === id ? { ...l, color } : l))),
    onToggleVisible: (id) => {
      const nl = layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
      apiRef.current?.updateScene({ elements: deriveScene(elementsRef.current, nl) })
      mutateLayers(nl)
    },
    onToggleLocked: (id) => {
      const layer = layers.find((l) => l.id === id)
      const nextLocked = !layer?.locked
      elementsRef.current = setLayerLocked(elementsRef.current, id, nextLocked)
      apiRef.current?.updateScene({ elements: deriveScene(elementsRef.current, layers) })
      syncRef.current?.notifyLocalChange()
      mutateLayers(layers.map((l) => (l.id === id ? { ...l, locked: nextLocked } : l)))
    },
    onOpacity: (id, opacity) => {
      elementsRef.current = setLayerOpacity(elementsRef.current, id, opacity)
      apiRef.current?.updateScene({ elements: deriveScene(elementsRef.current, layers) })
      syncRef.current?.notifyLocalChange()
      mutateLayers(layers.map((l) => (l.id === id ? { ...l, opacity } : l)))
    },
    onReorderList: (topFirst) => applyOrder(elementsRef.current, orderFromTopFirst(topFirst)),
    onMoveSelectionHere: (layerId) => {
      const api = apiRef.current
      const sel = api?.getAppState?.().selectedElementIds ?? {}
      const idSet = new Set(Object.keys(sel).filter((k) => sel[k]))
      if (!idSet.size) return
      applyOrder(moveElementsToLayer(elementsRef.current, idSet, layerId))
      setActiveLayerId(layerId)
      toast.success(`${idSet.size} elemento${idSet.size === 1 ? '' : 's'} movido${idSet.size === 1 ? '' : 's'}`)
    },
    onDuplicate: (id) => {
      const { layers: nl, elements: ne } = duplicateLayer(layers, elementsRef.current, id)
      applyOrder(ne, nl)
    },
    onMergeDown: (id) => {
      const { layers: nl, elements: ne } = mergeDown(layers, elementsRef.current, id)
      applyOrder(ne, nl)
    },
    onDelete: (id) => {
      if (layers.length === 1) return
      const ne = deleteLayerElements(elementsRef.current, id)
      const nl = [...layers]
        .filter((l) => l.id !== id)
        .sort((a, b) => a.order - b.order)
        .map((l, i) => ({ ...l, order: i }))
      if (activeLayerId === id) setActiveLayerId(nl[nl.length - 1].id)
      applyOrder(ne, nl)
    },
  }

  const addLayer = () => {
    const order = layers.length
    const nl = [...layers, defaultLayer(`Capa ${order + 1}`, order)]
    setActiveLayerId(nl[nl.length - 1].id)
    mutateLayers(nl)
  }

  const exportScoped = useCallback(
    async (scope, format) => {
      const api = apiRef.current
      let elements
      if (scope === 'selection') {
        const sel = api?.getAppState?.().selectedElementIds ?? {}
        elements = (api?.getSceneElements?.() ?? []).filter((e) => sel[e.id])
        if (!elements.length) {
          toast.info('No hay elementos seleccionados')
          return
        }
      } else {
        elements = deriveScene(elementsRef.current, layersRef.current)
      }
      const args = {
        elements,
        appState: appStateRef.current,
        files: api?.getFiles?.() ?? {},
        title: note?.title,
      }
      const fn =
        format === 'png' ? exportCanvasPng : format === 'svg' ? exportCanvasSvg : exportCanvasPdf
      try {
        await fn(args)
      } catch (err) {
        toast.error(err?.message ?? 'No se pudo exportar')
      }
    },
    [note?.title],
  )

  if (error) {
    return <div className="p-8 text-sm text-muted-foreground">No se pudo cargar el lienzo.</div>
  }

  const activeLayer = layers.find((l) => l.id === activeLayerId)

  return (
    <div className="relative flex h-full min-h-0">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-1 px-3 h-11 border-b border-border shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted rounded-lg"
              >
                <FileDown size={13} /> Exportar
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Todo el lienzo</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => exportScoped('all', 'png')}>PNG</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportScoped('all', 'svg')}>SVG</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportScoped('all', 'pdf')}>PDF</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Seleccion</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => exportScoped('selection', 'png')}>PNG</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportScoped('selection', 'svg')}>SVG</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportScoped('selection', 'pdf')}>PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setShowLayers((v) => !v)}
            title={`Capa activa: ${activeLayer?.name ?? ''}`}
            className={[
              'flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-lg max-w-[45%]',
              showLayers
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                : 'text-muted-foreground hover:bg-muted',
            ].join(' ')}
          >
            <Layers size={13} className="shrink-0" />
            {activeLayer && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: activeLayer.color }}
              />
            )}
            <span className="truncate">{activeLayer?.name ?? 'Capas'}</span>
          </button>
        </div>
        <div className="flex-1 min-h-0">
          {isLoading || !ready ? (
            <div className="h-full grid place-items-center text-sm text-muted-foreground">
              Cargando lienzo...
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="h-full grid place-items-center text-sm text-muted-foreground">
                  Cargando editor...
                </div>
              }
            >
              <CanvasStage
                initialData={initialDataRef.current}
                theme={isDark ? 'dark' : 'light'}
                onExcalidrawAPI={handleExcalidrawAPI}
                onChange={handleChange}
                onPointerUpdate={handlePointer}
              />
            </Suspense>
          )}
        </div>
      </div>

      <CanvasLayersPanel
        open={showLayers}
        onOpenChange={setShowLayers}
        isMobile={isMobile}
        onAddLayer={addLayer}
        layers={layers}
        selectionCount={selectionCount}
        selectedIds={selectedIds}
        {...layerCbs}
      />
    </div>
  )
}
