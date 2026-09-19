import { EditorProvider } from '@tiptap/react'
import { useEffect, useMemo, useRef, useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as Y from 'yjs'
import { NotebookPen } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@runly/ui'
import { useAuth } from '../../../auth/AuthProvider'
import { useIsDark } from '../hooks/useIsDark.js'
import { useKeyboardInset } from '../hooks/useKeyboardInset.js'
import { NoteSheet } from './NoteSheet.jsx'
import { runly } from '../../../lib/runly'
import { supabase } from '../../../lib/supabase'
import { SupabaseYjsProvider, bytesToBase64 } from '../lib/SupabaseYjsProvider.js'
import { buildExtensions } from '../lib/editor-extensions.js'
import { usePresence } from '../hooks/usePresence.js'
import { shouldFocusDocumentEnd } from '../lib/clickBelowContent.js'
import { isCaretHiddenByKeyboard, computeCaretScrollDelta } from '../lib/keyboardInset.js'
import { NoteToolbar } from './NoteToolbar.jsx'
import { TableFloatingMenu } from './TableFloatingMenu.jsx'
import { NoteCoverBanner } from './NoteCoverBanner.jsx'
import { NoteIconPickerContent } from './NoteIconPicker.jsx'
import { PresenceStack } from './PresenceStack.jsx'
import { NoteIcon } from '../noteIcons.jsx'
import { DrawingBlock } from '../lib/extensions/DrawingBlock.jsx'
import { AnnotatableImage } from '../lib/extensions/AnnotatableImage.jsx'

const AUTOSAVE_DELAY = 1500

// Fixed palette for per-collaborator cursor/avatar color — distinct from the
// amber brand accent so collaborators don't blend into UI chrome, and from
// each other (previously every user got the same hardcoded amber).
const PRESENCE_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1']

function colorForUser(seed) {
  const s = String(seed ?? '')
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length]
}

// scrollable=false opts out of NoteEditor's own overflow-y-auto wrapper —
// use this when an ancestor page already owns page-level scroll (e.g. the
// public share view). Nesting two independent scroll containers means the
// browser hit-tests the inner one first; here it has nothing real to
// scroll into (it's free to grow), so it just swallows the wheel/touch
// gesture instead of letting it reach the outer, actually-scrollable page.
// One page should have exactly one scroll owner.
//
// NoteEditor owns the realtime "engine" (Y.Doc + SupabaseYjsProvider) and
// only mounts the actual editor (NoteEditorSurface) once that engine exists
// AND has finished loading server state. This is load-bearing: TipTap's
// EditorProvider builds the ProseMirror editor on its first render and never
// rebuilds it (useEditor runs with empty deps). If we mounted the editor
// before the Y.Doc existed, the Collaboration/Caret plugins would be silently
// dropped and switching notes would leave stale content on screen — the
// editor instance would outlive the note it was built for. Keying the surface
// by note.id and gating on the engine fixes both.
export function NoteEditor({ note, readOnly = false, scrollable = true }) {
  const { session, userProfile } = useAuth()
  const token = session?.access_token

  // Collaboration only runs for an authenticated, editable note. The public
  // share view (PublicNoteScreen) has no session/token and the trash view is
  // read-only — both render a plain editor straight from note.content.
  const collabEnabled = !readOnly && Boolean(token) && Boolean(note?.id)

  // The engine is React state (not a ref) so the surface re-mounts when it
  // becomes ready / changes note.
  const [engine, setEngine] = useState(null)

  useEffect(() => {
    if (!collabEnabled) {
      setEngine(null)
      return
    }

    let disposed = false
    const ydoc = new Y.Doc()
    const provider = new SupabaseYjsProvider(ydoc, {
      noteId: note.id,
      supabase,
      runly,
      token,
      onSynced: () => {
        if (disposed) return
        setEngine(e =>
          e && e.ydoc === ydoc
            ? { ...e, synced: true, hadServerState: provider.hadServerState }
            : e,
        )
      },
    })
    setEngine({ noteId: note.id, ydoc, provider, synced: false, hadServerState: false })

    return () => {
      disposed = true
      provider.destroy()
      ydoc.destroy()
      setEngine(null)
    }
  }, [collabEnabled, note?.id, token])

  if (!note) return null

  // Plain editor — no realtime. Mount immediately from note.content.
  if (!collabEnabled) {
    return (
      <NoteEditorSurface
        key={note.id}
        note={note}
        readOnly={readOnly}
        scrollable={scrollable}
        token={token}
        session={session}
        userProfile={userProfile}
        engine={null}
      />
    )
  }

  // Realtime editor — wait until the engine for THIS note has loaded server
  // state, so the editor is built with Collaboration bound to the right doc.
  if (!engine || engine.noteId !== note.id || !engine.synced) {
    return <EditorLoading scrollable={scrollable} />
  }

  return (
    <NoteEditorSurface
      key={note.id}
      note={note}
      readOnly={readOnly}
      scrollable={scrollable}
      token={token}
      session={session}
      userProfile={userProfile}
      engine={engine}
    />
  )
}

function EditorLoading({ scrollable }) {
  const inner = (
    <div className="px-8 pt-10 space-y-3 animate-pulse">
      <div className="h-8 w-1/2 rounded bg-muted" />
      <div className="h-4 w-3/4 rounded bg-muted" />
      <div className="h-4 w-2/3 rounded bg-muted" />
      <div className="h-4 w-1/3 rounded bg-muted" />
    </div>
  )
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {scrollable ? <div className="flex-1 min-h-0 overflow-y-auto">{inner}</div> : inner}
    </div>
  )
}

// Everything below is a single editor instance for one note. It is mounted with
// key={note.id} by NoteEditor, so every hook/ref here is scoped to one note and
// torn down cleanly on switch.
function NoteEditorSurface({ note, readOnly, scrollable, token, session, userProfile, engine }) {
  const queryClient = useQueryClient()
  const containerRef = useRef(null)
  const scrollRef = useRef(null)
  const editorInstanceRef = useRef(null)
  const ydoc = engine?.ydoc ?? null
  const provider = engine?.provider ?? null
  const isDark = useIsDark()

  const rawKeyboardInset = useKeyboardInset()
  const keyboardInset = readOnly ? 0 : rawKeyboardInset

  const handleSelectionUpdate = useCallback(
    ({ editor }) => {
      if (readOnly || keyboardInset <= 0 || !scrollRef.current) return
      const coords = editor.view.coordsAtPos(editor.state.selection.head)
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight
      if (!isCaretHiddenByKeyboard(coords.bottom, viewportHeight)) return
      const delta = computeCaretScrollDelta(coords.bottom, viewportHeight)
      scrollRef.current.scrollBy({ top: delta, behavior: 'smooth' })
    },
    [readOnly, keyboardInset],
  )

  // ── autosave ───────────────────────────────────────────────────────────
  // pendingRef holds the latest not-yet-persisted snapshot; the debounce only
  // gates the network call. Computing the snapshot synchronously on every
  // update (not inside the timeout) means an unmount flush always has the
  // freshest content even if the debounce never fired.
  const pendingRef = useRef(null)
  const savingRef = useRef(false)
  const saveTimerRef = useRef(null)

  const flushSave = useCallback(async () => {
    if (readOnly || !note?.id || !token) return
    const snap = pendingRef.current
    if (!snap || savingRef.current) return
    savingRef.current = true
    pendingRef.current = null
    try {
      try {
        await runly.notes.update(note.id, snap, token)
        queryClient.invalidateQueries({ queryKey: ['notes'] })
        queryClient.invalidateQueries({ queryKey: ['notes', note.id] })
      } catch (err) {
        console.warn('[NoteEditor] content autosave failed:', err?.message)
        // Keep the snapshot so the next edit (or the unmount flush) retries.
        if (!pendingRef.current) pendingRef.current = snap
        return
      }
      // Persist the Y.js state separately — a failure here (NOT a content
      // failure) is exactly why a note can reload blank in the collaborative
      // editor, so surface it loudly instead of hiding it.
      if (ydoc) {
        try {
          const stateB64 = bytesToBase64(Y.encodeStateAsUpdate(ydoc))
          await runly.notes.saveYDoc(note.id, stateB64, token)
        } catch (err) {
          console.error(
            '[NoteEditor] Y.js state save FAILED — note will reload blank:',
            err?.message ?? err,
          )
        }
      }
    } finally {
      savingRef.current = false
    }
  }, [note?.id, token, readOnly, ydoc, queryClient])

  const handleUpdate = useCallback(
    ({ editor }) => {
      if (readOnly || !note?.id || !token) return
      // First paragraph text becomes the note title (Apple Notes pattern).
      // Always send it — an empty string clears a stale "Nueva nota".
      const firstChild = editor.state.doc.firstChild
      pendingRef.current = {
        content: editor.getHTML(),
        contentText: editor.getText(),
        title: firstChild?.textContent?.trim() ?? '',
      }
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(flushSave, AUTOSAVE_DELAY)
    },
    [note?.id, token, readOnly, flushSave],
  )

  // Flush once on unmount so switching notes fast never drops the last edits.
  const flushRef = useRef(flushSave)
  flushRef.current = flushSave
  useEffect(
    () => () => {
      clearTimeout(saveTimerRef.current)
      flushRef.current()
    },
    [],
  )

  // Immediate (non-debounced) update for discrete meta fields — icon and cover
  // banner are single user actions, not continuous typing.
  const updateNoteMeta = useCallback(
    async (patch) => {
      if (readOnly || !note?.id || !token) return
      try {
        await runly.notes.update(note.id, patch, token)
        queryClient.invalidateQueries({ queryKey: ['notes'] })
        queryClient.invalidateQueries({ queryKey: ['notes', note.id] })
      } catch (err) {
        console.warn('[NoteEditor] meta update failed:', err?.message)
      }
    },
    [note?.id, token, readOnly, queryClient],
  )

  // Touch-to-mouse bridge for TipTap column resize handles.
  // ProseMirror's columnResizing plugin only listens to mousedown/mousemove/mouseup.
  // This converts touchstart on .column-resize-handle into the equivalent mouse events.
  useEffect(() => {
    const container = containerRef.current
    if (!container || readOnly) return

    let active = false

    function makeMouseEvent(type, touch) {
      return new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: touch.clientX, clientY: touch.clientY,
        screenX: touch.screenX, screenY: touch.screenY,
        button: 0, buttons: type === 'mouseup' ? 0 : 1,
      })
    }

    function onTouchStart(e) {
      const handle = e.target.closest?.('.column-resize-handle') ??
        (e.target.classList?.contains('column-resize-handle') ? e.target : null)
      if (!handle) return
      e.preventDefault()
      active = true
      handle.dispatchEvent(makeMouseEvent('mousedown', e.touches[0]))
    }

    function onTouchMove(e) {
      if (!active) return
      e.preventDefault()
      document.dispatchEvent(makeMouseEvent('mousemove', e.touches[0]))
    }

    function onTouchEnd(e) {
      if (!active) return
      active = false
      document.dispatchEvent(makeMouseEvent('mouseup', e.changedTouches[0]))
    }

    container.addEventListener('touchstart', onTouchStart, { passive: false })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd)

    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
    }
  }, [readOnly])

  const presenceUsers = usePresence(provider, session?.user?.id)

  const extensions = useMemo(
    () => [
      ...buildExtensions({
        ydoc,
        provider,
        userName:
          userProfile?.displayName ??
          session?.user?.user_metadata?.full_name ??
          session?.user?.email ??
          'Usuario',
        userColor: colorForUser(session?.user?.id ?? session?.user?.email),
        userId: session?.user?.id ?? null,
        // On the self-hosted setup the avatar lives in FileAsset, surfaced as a
        // signed URL on /user/me (userProfile.avatarUrl) — user_metadata is empty.
        userAvatarUrl:
          userProfile?.avatarUrl ?? session?.user?.user_metadata?.avatar_url ?? null,
        readOnly,
        noteId: note.id,
        token,
      }),
      DrawingBlock,
      AnnotatableImage,
    ],
    [
      ydoc,
      provider,
      readOnly,
      note.id,
      token,
      session?.user?.id,
      session?.user?.email,
      userProfile?.avatarUrl,
      userProfile?.displayName,
    ],
  )

  // When Collaboration is active the Y.Doc is the single source of truth, so
  // we must NOT hand EditorProvider an initial `content` (it would double-seed
  // across clients). Instead, seed the doc once from the legacy HTML column iff
  // the server had no Y.js state yet and the doc is still empty.
  function seedIfNeeded({ editor }) {
    if (!engine || !ydoc) return
    // Only the OWNER migrates the legacy HTML into the shared Y.Doc. If every
    // client seeded, each would insert its own copy of the same paragraphs —
    // the doc ends up holding the content N times (this is the "self-
    // duplication" and the owner/guest divergence). Guests wait for the
    // owner's persisted Y.js state instead.
    const isOwner =
      Boolean(note?.owner_user_id) && note.owner_user_id === session?.user?.id
    if (!isOwner) return
    // Decide from the shared Y.Doc, which is ALREADY hydrated from the server
    // state at this point — NOT from editor.isEmpty. y-prosemirror has not
    // populated the ProseMirror view yet inside onCreate, so editor.isEmpty is
    // a false positive here; trusting it re-seeds (or wipes) a note that
    // actually has content. A non-empty fragment means "already has content".
    const frag = ydoc.getXmlFragment('default')
    if (frag.length > 0) {
      console.debug('[notes/yjs] seed skipped — Y.Doc already has content', frag.length)
      return
    }
    if (!note.content) return
    console.debug('[notes/yjs] seeding empty Y.Doc from note.content HTML')
    editor.commands.setContent(note.content)
    // Persist the migrated Y.js state immediately (skip the 1.5s autosave
    // debounce) so a guest opening the note right after sees the state and
    // never runs its own seed.
    clearTimeout(saveTimerRef.current)
    flushSave()
  }

  const editorProvider = (
    <EditorProvider
      extensions={extensions}
      content={engine ? '' : (note.content || '')}
      editable={!readOnly}
      onCreate={(props) => {
        editorInstanceRef.current = props.editor
        seedIfNeeded(props)
      }}
      onUpdate={handleUpdate}
      onSelectionUpdate={handleSelectionUpdate}
      editorProps={{
        attributes: {
          class: 'focus:outline-none px-8 pt-1 pb-6 min-h-full',
        },
      }}
      slotBefore={
        <>
          <NoteCoverBanner
            coverUrl={note.cover_url}
            editable={!readOnly}
            noteId={note.id}
            token={token}
            onChange={coverUrl => updateNoteMeta({ coverUrl })}
            onRemove={() => updateNoteMeta({ coverUrl: null })}
          />
          {!readOnly && (
            // Wrapper does the pinning inside the new scroll container;
            // NoteToolbar's own `sticky top-0` had no scrolling ancestor.
            <div className="sticky top-0 z-20">
              <NoteToolbar noteId={note.id} token={token} />
            </div>
          )}
          {!readOnly && (
            // Overlaps the title's own line (the editor's first paragraph —
            // see handleUpdate) via a negative margin-bottom, computed from
            // the title's font-size/line-height and .tiptap's own top
            // padding — see the matching CSS comment in styles.css for the
            // math. `relative z-10` makes this row paint above the title
            // text in the overlap zone instead of the reverse (later DOM
            // order would otherwise win).
            <div className="relative z-10 px-8 pt-4 flex items-center justify-between gap-2 -mb-10">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-muted transition-colors"
                    title="Seleccionar icono"
                  >
                    {note.icon
                      ? <NoteIcon name={note.icon} size={22} className="text-amber-500" />
                      : <NotebookPen className="w-5 h-5 text-muted-foreground/50" />
                    }
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-84 p-3" side="bottom" align="start">
                  <NoteIconPickerContent
                    value={note.icon}
                    onChange={icon => updateNoteMeta({ icon })}
                  />
                </PopoverContent>
              </Popover>
              <PresenceStack users={presenceUsers} />
            </div>
          )}
        </>
      }
    >
      {!readOnly && <TableFloatingMenu />}
    </EditorProvider>
  )

  function handleContainerClick(e) {
    if (shouldFocusDocumentEnd(e.target, e.currentTarget)) {
      editorInstanceRef.current?.commands.focus('end')
    }
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full overflow-hidden"
      data-paper-style={note.paper_style ?? 'none'}
    >
      {scrollable ? (
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
          style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
          onClick={readOnly ? undefined : handleContainerClick}
        >
          <NoteSheet note={note} isDark={isDark}>
            {editorProvider}
          </NoteSheet>
        </div>
      ) : (
        <NoteSheet note={note} isDark={isDark}>
          {editorProvider}
        </NoteSheet>
      )}
    </div>
  )
}
