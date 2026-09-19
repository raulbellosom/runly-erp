import { useEffect, useRef, lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { runly } from '../../lib/runly'
import { NoteEditor } from './components/NoteEditor.jsx'
import { NOTE_SHEET_MAX_WIDTH_CLASS } from './components/NoteSheet.jsx'
import { PublicNoteToolbar } from './components/PublicNoteToolbar.jsx'
import { PublicNoteCollaborators } from './components/PublicNoteCollaborators.jsx'
import { PublicNoteDates } from './components/PublicNoteDates.jsx'
import { copyNoteContent } from './lib/noteClipboard.js'
import { ZoomControl } from './components/ZoomControl.jsx'
import { fitNoteZoom, useNoteZoom } from './hooks/useNoteZoom.js'
import { exportNoteSheetAsJpg, exportNoteSheetAsPdf } from './lib/notePageExport.js'
import { ErrorState } from '@runly/ui'

const PublicCanvasView = lazy(() => import('./PublicCanvasView.jsx'))

export default function PublicNoteScreen() {
  const { slug } = useParams()
  const contentRef = useRef(null)
  const [zoom, setZoom] = useNoteZoom()

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
    // Keep public metadata and the visibility preference current too; Y.js
    // updates the body but does not broadcast these note settings.
    refetchInterval: 30000,
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
        <PublicCanvasView key={slug} slug={slug} note={note} />
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
    <div className="relative h-dvh flex flex-col overflow-hidden bg-gray-100">
      <div className={`${NOTE_SHEET_MAX_WIDTH_CLASS} w-full px-4 py-3 shrink-0 space-y-2`}>
        <div className="flex justify-end">
          <PublicNoteToolbar
            title={note.title}
            publicUrl={publicUrl}
            onCopyContent={() => copyNoteContent(contentRef.current?.querySelector('.note-sheet'), { coverUrl: note.cover_url })}
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
        <PublicNoteDates createdAt={note.created_at} updatedAt={note.updated_at} />
      </div>
      <div ref={contentRef} className="relative flex-1 min-h-0">
        {/* Both views share one fixed sheet and its scroll/zoom behavior.
            publicSlug keeps this read-only view connected to live updates. */}
        <NoteEditor note={note} readOnly zoom={zoom} publicSlug={slug} />
        <ZoomControl zoom={zoom} onZoomChange={setZoom} onFit={() => setZoom(fitNoteZoom(contentRef.current.clientWidth - 16))} />
      </div>
      {note.show_public_collaborators !== false && <PublicNoteCollaborators collaborators={note.collaborators} />}
    </div>
  )
}
