import { useEffect, useRef, lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { runly } from '../../lib/runly'
import { NoteEditor } from './components/NoteEditor.jsx'
import { NOTE_SHEET_MAX_WIDTH_CLASS } from './components/NoteSheet.jsx'
import { PublicNoteToolbar } from './components/PublicNoteToolbar.jsx'
import { PublicNoteCollaborators } from './components/PublicNoteCollaborators.jsx'
import { exportNoteSheetAsJpg, exportNoteSheetAsPdf } from './lib/notePageExport.js'
import { ErrorState } from '@runly/ui'

const PublicCanvasView = lazy(() => import('./PublicCanvasView.jsx'))

export default function PublicNoteScreen() {
  const { slug } = useParams()
  const contentRef = useRef(null)

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

  // Browser tab title — there's no separate on-page heading anymore (see the
  // icon+title row rendered inside NoteEditor itself, right above the first
  // paragraph, matching the authenticated editor instead of duplicating it).
  useEffect(() => {
    document.title = note?.title ? `${note.title} · Runly` : 'Runly'
  }, [note?.title])

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

  const publicUrl = typeof window !== 'undefined' ? window.location.href : ''

  return (
    // html/body are globally overflow:hidden (the authenticated app shell
    // does its own internal scrolling) — this page needs its own bounded,
    // scrollable region or content taller than the viewport is unreachable.
    <div className="h-dvh overflow-y-auto overscroll-contain bg-gray-100">
      <div className={`${NOTE_SHEET_MAX_WIDTH_CLASS} py-8 sm:py-12 px-4`}>
        <div className="mb-4 flex justify-end">
          <PublicNoteToolbar
            title={note.title}
            publicUrl={publicUrl}
            onDownloadPdf={() =>
              exportNoteSheetAsPdf(contentRef.current?.querySelector('.note-sheet'), {
                title: note.title,
                backgroundColor: note.background_color,
              })
            }
            onDownloadImage={() =>
              exportNoteSheetAsJpg(contentRef.current?.querySelector('.note-sheet'), {
                title: note.title,
                backgroundColor: note.background_color,
              })
            }
          />
        </div>
        <div ref={contentRef} className="rounded-xl shadow-sm overflow-hidden bg-white">
          {/* scrollable=false: this page already owns scroll (the h-dvh
              overflow-y-auto root above) — see NoteEditor's scrollable prop.
              Background color and the max-width sheet column are now rendered
              by NoteEditor itself (NoteSheet), shared with the authenticated
              editor — this wrapper only supplies the rounded/shadow chrome.
              publicSlug (+ readOnly) turns on the live realtime path — see
              NoteEditor's collabEnabled — instead of only refetching on
              focus/remount. */}
          <NoteEditor note={note} readOnly scrollable={false} publicSlug={slug} />
        </div>
        <PublicNoteCollaborators collaborators={note.collaborators} />
      </div>
    </div>
  )
}
