import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { ErrorState } from '@runly/ui'
import { usePublicCanvasScene } from './hooks/useCanvasScene.js'
import { SupabaseCanvasSync } from './lib/SupabaseCanvasSync.js'
import { hydrateImages } from './lib/canvasImages.js'
import { deriveScene, ensureLayers } from './lib/canvasLayers.js'
import { PublicNoteToolbar } from './components/PublicNoteToolbar.jsx'
import { exportCanvasPdf, exportCanvasPng } from './lib/canvasExport.js'

const CanvasStage = lazy(() => import('./components/CanvasStage.jsx'))

// Live, read-only public canvas. Seeds from GET /public/notes/:slug/canvas then
// subscribes to the same broadcast channel as the editors in readOnly mode:
// it applies scene.delta / scene.full and never emits.
export default function PublicCanvasView({ slug }) {
  const { data, isLoading, error } = usePublicCanvasScene(slug)
  const apiRef = useRef(null)
  const elementsRef = useRef([])
  const layersRef = useRef([])

  const scene = data?.scene

  const initialData = useMemo(() => {
    if (!scene) return null
    return {
      elements: [],
      appState: { ...(scene.appState ?? {}), collaborators: new Map() },
      files: {},
      scrollToContent: true,
    }
  }, [scene])

  const handleExcalidrawAPI = useCallback((api) => {
    apiRef.current = api
  }, [])

  useEffect(() => {
    if (!scene) return undefined
    let cancelled = false
    elementsRef.current = Array.isArray(scene.elements) ? scene.elements : []
    layersRef.current = ensureLayers(scene.layers)
    ;(async () => {
      const files = await hydrateImages(scene.files)
      if (cancelled) return
      if (apiRef.current && files.length) apiRef.current.addFiles(files)
      apiRef.current?.updateScene({
        elements: deriveScene(elementsRef.current, layersRef.current),
      })
    })()

    const sync = new SupabaseCanvasSync({
      noteId: scene.noteId,
      supabase,
      readOnly: true,
      getLocalElements: () => elementsRef.current,
      onRemoteElements: (reconciled) => {
        elementsRef.current = reconciled
        apiRef.current?.updateScene({
          elements: deriveScene(reconciled, layersRef.current),
        })
      },
      onRemoteSnapshot: (snap) => {
        elementsRef.current = Array.isArray(snap.elements) ? snap.elements : elementsRef.current
        if (Array.isArray(snap.layers) && snap.layers.length) {
          layersRef.current = ensureLayers(snap.layers)
        }
        apiRef.current?.updateScene({
          elements: deriveScene(elementsRef.current, layersRef.current),
        })
      },
      onRemoteFiles: async (files) => {
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
    })
    return () => {
      cancelled = true
      sync.destroy()
    }
  }, [scene])

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50 text-sm text-gray-400">
        Cargando lienzo...
      </div>
    )
  }
  if (error || !scene) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50">
        <div className="max-w-md w-full p-8">
          <ErrorState
            title="Lienzo no encontrado"
            description="Este lienzo no existe o el enlace publico fue desactivado."
          />
        </div>
      </div>
    )
  }

  const publicUrl = typeof window !== 'undefined' ? window.location.href : ''

  return (
    <div className="h-dvh flex flex-col bg-white">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-200 shrink-0">
        <h1 className="text-sm font-semibold text-gray-900 truncate">{scene.title || 'Lienzo'}</h1>
        <span className="text-[11px] text-gray-400 shrink-0">Solo lectura</span>
        <div className="ml-auto">
          <PublicNoteToolbar
            title={scene.title}
            publicUrl={publicUrl}
            onDownloadPdf={() =>
              exportCanvasPdf({
                elements: deriveScene(elementsRef.current, layersRef.current),
                appState: {},
                files: apiRef.current?.getFiles?.() ?? {},
                title: scene.title,
              })
            }
            onDownloadImage={() =>
              exportCanvasPng({
                elements: deriveScene(elementsRef.current, layersRef.current),
                appState: {},
                files: apiRef.current?.getFiles?.() ?? {},
                title: scene.title,
              })
            }
            imageLabel="PNG"
          />
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <Suspense
          fallback={
            <div className="h-full grid place-items-center text-sm text-gray-400">
              Cargando editor...
            </div>
          }
        >
          <CanvasStage
            initialData={initialData}
            viewModeEnabled
            onExcalidrawAPI={handleExcalidrawAPI}
          />
        </Suspense>
      </div>
    </div>
  )
}
