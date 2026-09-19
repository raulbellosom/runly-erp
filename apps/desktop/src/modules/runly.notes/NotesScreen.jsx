import { useState, useCallback, useEffect, lazy, Suspense } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import {
  Plus, ArrowLeft,
  Settings2, Share2, RotateCcw, Trash2, PenLine,
  FileText, Shapes, ChevronLeft, ChevronRight,
  Maximize2, Minimize2,
} from 'lucide-react'
import {
  ConfirmDialog,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@runly/ui'
import { NoteIcon } from './noteIcons.jsx'
import { useNotes, useCreateNote } from './hooks/useNotes.js'
import { useNote, useUpdateNote, useTrashNote, useRestoreNote, usePermanentDeleteNote } from './hooks/useNote.js'
import { usePublishNote, useUnpublishNote } from './hooks/useNoteShares.js'
import { useIsDark } from './hooks/useIsDark.js'
import { DARK_BG_MAP } from './lib/noteColors.js'
import { NotesList } from './components/NotesList.jsx'
import { NoteEditor } from './components/NoteEditor.jsx'
import { NoteSettingsPanel } from './components/NoteSettingsPanel.jsx'
import { NoteShareModal } from './components/NoteShareModal.jsx'
import { NoteTitleEditor } from './components/NoteTitleEditor.jsx'
import { ZoomControl } from './components/ZoomControl.jsx'
import { useNoteZoom } from './hooks/useNoteZoom.js'

// Lazy so the Excalidraw bundle only loads when a canvas note is opened.
const CanvasEditor = lazy(() =>
  import('./components/CanvasEditor.jsx').then((m) => ({ default: m.CanvasEditor })),
)

function viewFromPath(pathname) {
  if (pathname.endsWith('/notes/recent')) return 'recent'
  if (pathname.endsWith('/notes/shared')) return 'shared'
  if (pathname.endsWith('/notes/trash'))  return 'trash'
  return 'all'
}

const NOTES_LIST_COLLAPSED_KEY = 'atlas:v1:notes-list-collapsed'

function getListCollapsed() {
  try {
    return localStorage.getItem(NOTES_LIST_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function persistListCollapsed(val) {
  try {
    localStorage.setItem(NOTES_LIST_COLLAPSED_KEY, val ? '1' : '0')
  } catch {
    // localStorage unavailable (private mode, etc.) — collapse still works
    // for the session, it just won't persist across reloads.
  }
}

export default function NotesScreen() {
  const { pathname } = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeView = viewFromPath(pathname)
  const folderId   = searchParams.get('folder')
  const urlNoteId  = searchParams.get('note')
  const isTrashView = activeView === 'trash'

  const [selectedNote, setSelectedNote] = useState(null)
  const [rightPanel, setRightPanel]     = useState('editor')
  const [shareOpen, setShareOpen]       = useState(false)
  const [restoreOpen, setRestoreOpen]   = useState(false)
  const [deleteOpen, setDeleteOpen]     = useState(false)
  const [noteToAction, setNoteToAction] = useState(null)
  const [mobileView, setMobileView]     = useState('list')
  const [listCollapsed, setListCollapsed] = useState(getListCollapsed)
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = () => setIsDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const effectiveListCollapsed = listCollapsed && isDesktop

  const [isZenMode, setIsZenMode] = useState(false)
  const [zoom, setZoom] = useNoteZoom()

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(handle)
  }, [search])

  useEffect(() => {
    if (!isZenMode) return
    function onKeyDown(e) {
      if (e.key === 'Escape' && !e.defaultPrevented) setIsZenMode(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isZenMode])

  // Restore selected note from URL on mount / page reload
  const { data: urlNoteData } = useNote(urlNoteId)
  useEffect(() => {
    if (urlNoteData?.note && !selectedNote) {
      setSelectedNote(urlNoteData.note)
      setMobileView('editor')
    }
  // Only run when the fetched note data arrives — not on every selectedNote change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlNoteData?.note?.id])

  // Keep selectedNote in sync with server after any mutation invalidates ['notes', id]
  const { data: liveNoteData } = useNote(selectedNote?.id)
  useEffect(() => {
    if (liveNoteData?.note && liveNoteData.note.id === selectedNote?.id) {
      setSelectedNote(liveNoteData.note)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveNoteData])

  const { data, isLoading } = useNotes(buildQueryParams(activeView, folderId, debouncedSearch))
  const notes = data?.notes ?? []

  const isDark = useIsDark()

  const createNote      = useCreateNote()
  const updateNote      = useUpdateNote()
  const trashNote       = useTrashNote()
  const restoreNote     = useRestoreNote()
  const permanentDelete = usePermanentDeleteNote()
  const publishNote     = usePublishNote()
  const unpublishNote   = useUnpublishNote()

  function setNoteParam(noteId) {
    setSearchParams(p => {
      const next = new URLSearchParams(p)
      if (noteId) next.set('note', noteId)
      else next.delete('note')
      return next
    })
  }

  function handleCreateNote(noteType = 'document') {
    createNote.mutate(
      {
        title: noteType === 'canvas' ? 'Nuevo lienzo' : 'Nueva nota',
        content: noteType === 'canvas' ? '' : '<p></p><p></p>',
        noteType,
      },
      {
        onSuccess: (res) => {
          if (res?.note) {
            setSelectedNote(res.note)
            setNoteParam(res.note.id)
            setRightPanel('editor')
            setMobileView('editor')
          }
        },
      },
    )
  }

  const handleUpdateNote = useCallback((patch) => {
    if (!selectedNote) return
    // Optimistic local update so the UI reacts instantly (title bar, bg color, etc.)
    const camelToSnake = {
      title: 'title', content: 'content', icon: 'icon',
      backgroundColor: 'background_color', folderId: 'folder_id',
      isPinned: 'is_pinned', isArchived: 'is_archived', coverUrl: 'cover_url',
      paperStyle: 'paper_style',
    }
    const localPatch = {}
    for (const [k, v] of Object.entries(patch)) {
      localPatch[camelToSnake[k] ?? k] = v
    }
    setSelectedNote(prev => prev ? { ...prev, ...localPatch } : prev)
    updateNote.mutate(
      { noteId: selectedNote.id, data: patch },
      { onSuccess: (res) => { if (res?.note) setSelectedNote(res.note) } },
    )
  }, [selectedNote, updateNote])

  function handleTrash(note) {
    const target = note ?? selectedNote
    if (!target) return
    trashNote.mutate(target.id, {
      onSuccess: () => {
        if (selectedNote?.id === target.id) {
          setSelectedNote(null)
          setNoteParam(null)
          setMobileView('list')
        }
      },
    })
  }

  function selectNote(note) {
    setSelectedNote(note)
    setNoteParam(note.id)
    setRightPanel('editor')
    setMobileView('editor')
  }

  const isCanvasNote = selectedNote?.note_type === 'canvas'

  return (
    <div className="flex h-full min-h-0 overflow-hidden">

      {/* Panel 1: Note list */}
      <div
        {...(isZenMode ? { inert: '' } : {})}
        aria-hidden={isZenMode || undefined}
        className={[
          'shrink-0 border-r border-border flex flex-col bg-background',
          effectiveListCollapsed ? 'w-full lg:w-12' : 'w-full lg:w-72',
          mobileView === 'list' ? 'flex' : 'hidden lg:flex',
        ].join(' ')}
      >

        <div className={`flex items-center gap-2 h-11 border-b border-border shrink-0 ${effectiveListCollapsed ? 'justify-center px-1' : 'px-3'}`}>
          {!effectiveListCollapsed && (
            <span className="flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {folderId ? 'Carpeta' : VIEW_LABELS[activeView]}
            </span>
          )}
          {!effectiveListCollapsed && !isTrashView && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={createNote.isPending}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors disabled:opacity-50 shadow-sm"
                >
                  <Plus size={13} />
                  <span>Nueva</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => handleCreateNote('document')}>
                  <FileText size={13} className="mr-2" /> Documento
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleCreateNote('canvas')}>
                  <Shapes size={13} className="mr-2" /> Lienzo
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button
            onClick={() => {
              const next = !listCollapsed
              setListCollapsed(next)
              persistListCollapsed(next)
            }}
            className="hidden lg:flex p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title={effectiveListCollapsed ? 'Expandir lista' : 'Colapsar lista'}
          >
            {effectiveListCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>

        {!effectiveListCollapsed && (
          <>
            <NotesList
              notes={notes}
              selectedNoteId={selectedNote?.id}
              onSelect={selectNote}
              onTrash={!isTrashView ? handleTrash : undefined}
              isLoading={isLoading}
              showTrash={isTrashView}
              search={search}
              onSearchChange={setSearch}
            />

            {isTrashView && selectedNote && (
              <div className="px-3 py-2 border-t border-border flex gap-2 shrink-0">
                <button
                  onClick={() => { setNoteToAction(selectedNote); setRestoreOpen(true) }}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 border border-border rounded-lg hover:bg-muted text-foreground transition-colors"
                >
                  <RotateCcw size={13} />
                  Restaurar
                </button>
                <button
                  onClick={() => { setNoteToAction(selectedNote); setDeleteOpen(true) }}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 border border-red-200 dark:border-red-900/50 text-red-500 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                >
                  <Trash2 size={13} />
                  Eliminar
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Panel 2: Editor / Settings */}
      <div
        className={[
          'flex-1 min-w-0 flex flex-col overflow-hidden',
          // fixed inset-x-0 top-0 h-dvh (not bare inset-0) — see RunlyApp.jsx's
          // app-shell-root comment: plain inset-0 sizes against the
          // non-shrinking mobile layout viewport and breaks the h-full/
          // flex-1 min-h-0 chain NoteEditor's scroll/keyboard-avoidance logic
          // depends on.
          isZenMode ? 'fixed inset-x-0 top-0 h-dvh z-50 bg-background' : (isCanvasNote ? '' : 'bg-muted/30'),
          (mobileView === 'editor' || isZenMode) ? 'flex' : 'hidden lg:flex',
          !isZenMode ? 'relative' : '',
        ].join(' ')}
        style={(!isZenMode && isCanvasNote) ? (() => {
          const raw = selectedNote?.background_color
          if (!raw) return {}
          const color = isDark ? (DARK_BG_MAP[raw] ?? raw) : raw
          return { backgroundColor: color }
        })() : undefined}
      >
        <div className="flex items-center gap-2 px-3 h-11 border-b border-border shrink-0 bg-background/95 backdrop-blur-sm">
          <button
            className="lg:hidden p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setMobileView('list')}
          >
            <ArrowLeft size={15} />
          </button>

          {selectedNote && !isTrashView && selectedNote.note_type === 'canvas' ? (
            <NoteTitleEditor note={selectedNote} onUpdate={handleUpdateNote} />
          ) : (
            <span className="flex-1 flex items-center gap-1.5 min-w-0 text-xs text-muted-foreground truncate">
              {selectedNote?.icon && (
                <NoteIcon name={selectedNote.icon} size={13} className="text-amber-500 shrink-0" />
              )}
              {selectedNote ? (selectedNote.title || 'Sin titulo') : ''}
            </span>
          )}

          {selectedNote && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setShareOpen(true)}
                className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg transition-colors"
              >
                <Share2 size={13} />
                <span className="hidden sm:inline">Compartir</span>
              </button>
              <button
                onClick={() => setIsZenMode(z => !z)}
                className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg transition-colors"
                title={isZenMode ? 'Salir de pantalla completa' : 'Pantalla completa'}
              >
                {isZenMode ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
              <button
                onClick={() => setRightPanel(p => p === 'editor' ? 'settings' : 'editor')}
                className={`flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  rightPanel === 'settings'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Settings2 size={13} />
                <span className="hidden sm:inline">{rightPanel === 'settings' ? 'Editor' : 'Ajustes'}</span>
              </button>
            </div>
          )}
        </div>

        {!selectedNote ? (
          <EmptyEditor onCreateNote={!isTrashView ? () => handleCreateNote('document') : undefined} isTrash={isTrashView} />
        ) : rightPanel === 'settings' ? (
          <NoteSettingsPanel
            note={selectedNote}
            onUpdate={handleUpdateNote}
            onPublish={() => publishNote.mutate(selectedNote.id, { onSuccess: r => r?.note && setSelectedNote(r.note) })}
            onUnpublish={() => unpublishNote.mutate(selectedNote.id, { onSuccess: r => r?.note && setSelectedNote(r.note) })}
            onTrash={() => handleTrash(selectedNote)}
          />
        ) : (!isTrashView && selectedNote.note_type === 'canvas') ? (
          <Suspense fallback={
            <div className="h-full grid place-items-center text-sm text-muted-foreground">Cargando lienzo...</div>
          }>
            <CanvasEditor key={selectedNote.id} note={selectedNote} />
          </Suspense>
        ) : (
          <NoteEditor note={selectedNote} readOnly={isTrashView} zoom={zoom} />
        )}

        {rightPanel === 'editor' && !isTrashView && !isCanvasNote && selectedNote && (
          <ZoomControl zoom={zoom} onZoomChange={setZoom} />
        )}
      </div>

      {selectedNote && (
        <NoteShareModal note={selectedNote} open={shareOpen} onOpenChange={setShareOpen} />
      )}

      <ConfirmDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title="Restaurar nota"
        description="La nota se movera de vuelta a tu lista de notas activas."
        confirmLabel="Restaurar"
        onConfirm={() => {
          setRestoreOpen(false)
          if (noteToAction) restoreNote.mutate(noteToAction.id, {
            onSuccess: () => { setSelectedNote(null); setNoteParam(null) }
          })
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Eliminar nota permanentemente"
        description="Esta accion no se puede deshacer. La nota se eliminara para siempre."
        confirmLabel="Eliminar permanentemente"
        onConfirm={() => {
          setDeleteOpen(false)
          if (noteToAction) permanentDelete.mutate(noteToAction.id, {
            onSuccess: () => { setSelectedNote(null); setNoteParam(null) }
          })
        }}
      />
    </div>
  )
}

function EmptyEditor({ onCreateNote, isTrash }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8 select-none">
      <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center">
        <PenLine size={22} className="text-amber-400" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground mb-1">
          {isTrash ? 'Papelera' : 'Selecciona una nota'}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-48">
          {isTrash
            ? 'Selecciona una nota para restaurarla o eliminarla definitivamente'
            : 'Elige una nota de la lista o crea una nueva'}
        </p>
      </div>
      {onCreateNote && (
        <button
          onClick={onCreateNote}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors shadow-sm"
        >
          <Plus size={13} />
          Nueva nota
        </button>
      )}
    </div>
  )
}

const VIEW_LABELS = {
  all:    'Todas las notas',
  recent: 'Recientes',
  shared: 'Compartidas',
  trash:  'Papelera',
}

function buildQueryParams(view, folderId, q) {
  const base =
    view === 'trash'  ? { trashed: true } :
    view === 'recent' ? { pageSize: 20 } :
    view === 'shared' ? { shared: true } :
    folderId          ? { folderId } :
    {}
  return q ? { ...base, q } : base
}
