import { useEffect, lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { runly } from '../../lib/runly'
import { NoteEditor } from './components/NoteEditor.jsx'
import { NoteIcon } from './noteIcons.jsx'
import { ErrorState } from '@runly/ui'

const PublicCanvasView = lazy(() => import('./PublicCanvasView.jsx'))

export default function PublicNoteScreen() {
  const { slug } = useParams()

  // Force light theme for the public view — remove .dark from <html> and restore on unmount
  useEffect(() => {
    const html = document.documentElement
    const hadDark = html.classList.contains('dark')
    html.classList.remove('dark')
    return () => {
      if (hadDark) html.classList.add('dark')
    }
  }, [])

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-note', slug],
    queryFn: () => runly.notes.getPublic(slug),
    enabled: !!slug,
    retry: false,
    // Public content must always be current — an edit in the authenticated
    // editor invalidates a different query key (['notes', id]), never this
    // one, so without this the app-wide 5min staleTime (plus the 24h
    // persisted/IndexedDB cache from PersistQueryClientProvider) can leave
    // an already-open or recently-visited public tab silently showing a
    // stale snapshot of the note.
    staleTime: 0,
  })

  const note = data?.note

  if (note?.note_type === 'canvas') {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen grid place-items-center text-sm text-gray-400">Cargando...</div>
        }
      >
        <PublicCanvasView key={slug} slug={slug} />
      </Suspense>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-400">Cargando nota...</div>
      </div>
    )
  }

  if (error || !note) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full p-8">
          <ErrorState
            title="Nota no encontrada"
            description="Esta nota no existe o el enlace publico fue desactivado."
          />
        </div>
      </div>
    )
  }

  return (
    // html/body are globally overflow:hidden (the authenticated app shell
    // does its own internal scrolling) — this page needs its own bounded,
    // scrollable region or content taller than the viewport is unreachable.
    <div className="h-dvh overflow-y-auto overscroll-contain bg-gray-100">
      <div className="max-w-3xl mx-auto py-12 px-4">
        <div className="flex items-center gap-3 mb-6">
          {note.icon && <NoteIcon name={note.icon} size={28} className="text-amber-500 shrink-0" />}
          <h1 className="text-2xl font-bold text-gray-900">{note.title || 'Nota'}</h1>
        </div>
        <div className="rounded-xl shadow-sm overflow-hidden bg-white">
          {/* scrollable=false: this page already owns scroll (the h-dvh
              overflow-y-auto root above) — see NoteEditor's scrollable prop.
              Background color and the max-width sheet column are now rendered
              by NoteEditor itself (NoteSheet), shared with the authenticated
              editor — this wrapper only supplies the rounded/shadow chrome. */}
          <NoteEditor note={note} readOnly scrollable={false} />
        </div>
      </div>
    </div>
  )
}
