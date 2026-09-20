import { useQuery, useMutation } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider'
import { runly } from '../../../lib/runly'

export function useCanvasScene(noteId) {
  const { session } = useAuth()
  const token = session?.access_token
  return useQuery({
    queryKey: ['canvas-scene', noteId],
    queryFn: () => runly.notes.getCanvas(noteId, token),
    enabled: Boolean(token && noteId),
    // Always pull a fresh scene on (re)mount. The app persists queries to
    // IndexedDB for 24h, so `staleTime: Infinity` here would show a stale
    // snapshot after a page reload — exactly the "I drew but it's gone on
    // reload" bug. The realtime channel keeps the OPEN session in sync.
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })
}

export function useSaveCanvasScene(noteId) {
  const { session } = useAuth()
  const token = session?.access_token
  return useMutation({
    mutationFn: (scene) => runly.notes.saveCanvas(noteId, scene, token),
  })
}

export function usePublicCanvasScene(slug) {
  return useQuery({
    queryKey: ['public-canvas', slug],
    queryFn: () => runly.notes.getPublicCanvas(slug),
    enabled: Boolean(slug),
    retry: false,
    staleTime: 0,
    // CanvasStage's `initialData` must stay referentially stable for the life
    // of the mount (see its header comment) — a window-focus refetch would
    // hand PublicCanvasView a new `scene` object and re-run the whole hydrate
    // effect against an already-mounted Excalidraw instance.
    refetchOnWindowFocus: false,
  })
}
