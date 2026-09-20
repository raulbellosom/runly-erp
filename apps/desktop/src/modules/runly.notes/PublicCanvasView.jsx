import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ErrorState } from '@runly/ui'
import { usePublicCanvasScene } from './hooks/useCanvasScene.js'
import { SupabaseCanvasSync } from './lib/SupabaseCanvasSync.js'
import { hydrateImages } from './lib/canvasImages.js'
import { deriveScene, ensureLayers } from './lib/canvasLayers.js'
import { PublicNoteToolbar } from './components/PublicNoteToolbar.jsx'
import { PublicNoteDates } from './components/PublicNoteDates.jsx'
import { PublicNoteCollaborators } from './components/PublicNoteCollaborators.jsx'
import { exportCanvasPdf, exportCanvasPng } from './lib/canvasExport.js'

const CanvasStage = lazy(() => import('./components/CanvasStage.jsx'))

function filesArrayToMap(arr) {
  const map = {}
  for (const f of arr) map[f.id] = f
  return map
}

// Live, read-only public canvas. Seeds from GET /public/notes/:slug/canvas then
// subscribes to the same broadcast channel as the editors in readOnly mode:
// it applies scene.delta / scene.full and never emits.
export default function PublicCanvasView({ slug, note }) {
  const { data, isLoading, error } = usePublicCanvasScene(slug)
  const apiRef = useRef(null)
  const elementsRef = useRef([])
  const layersRef = useRef([])
  // <Excalidraw> only mounts (via CanvasStage below) once this is populated —
  // it must carry the hydrated files from the start. Excalidraw is lazy-loaded
  // (Suspense), so on a cold visit the JS chunk can still be downloading when
  // hydrateImages() resolves; calling the imperative apiRef.current.addFiles()
  // at that point is a silent no-op (apiRef.current is still null, never
  // retried) and every image renders as a permanently broken placeholder.
  // Mirrors CanvasEditor.jsx's proven initialDataRef pattern.
  const initialDataRef = useRef(null)
  const [ready, setReady] = useState(false)

  const scene = data?.scene

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
      initialDataRef.current = {
        elements: deriveScene(elementsRef.current, layersRef.current),
        appState: { ...(scene.appState ?? {}), collaborators: new Map() },
        files: filesArrayToMap(files),
        scrollToContent: true,
      }
      setReady(true)
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

  if (isLoading || (scene && !ready)) {
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
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-200 shrink-0">
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
        <div className="w-full">
          <PublicNoteDates createdAt={note?.created_at} updatedAt={note?.updated_at} />
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
            initialData={initialDataRef.current}
            viewModeEnabled
            onExcalidrawAPI={handleExcalidrawAPI}
          />
        </Suspense>
      </div>
      {note?.show_public_collaborators !== false && <PublicNoteCollaborators collaborators={note?.collaborators} />}
    </div>
  )
}
