import { memo, useCallback, useState } from 'react'
import { Excalidraw, useHandleLibrary } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

// Thin wrapper so CanvasEditor / PublicCanvasView never statically import the
// heavy Excalidraw bundle — they lazy-load THIS module, which is the only place
// that pulls it in.
//
// memo + a stable `initialData` prop (built once by the parent) are load-
// bearing: Excalidraw treats a change to its props as a signal and fires
// onChange, so a parent re-render with a fresh initialData object drives an
// infinite onChange -> setState -> re-render loop. Every prop here must be
// referentially stable for the life of the note.

// Scoped tweaks for the embed:
//  - on read-only canvases (public link, shared-resource view) hide
//    Excalidraw's default sidebar (shape Library + element search) and its
//    trigger: "Explorar bibliotecas" there would let a visitor pull in and
//    render third-party content on a page that's supposed to be inert. Editors
//    (inside Runly or via an edit invitation) keep the full sidebar. The
//    selectors are the real classes @excalidraw/excalidraw 0.18.1 emits. This
//    only hides the UI; onDropCapture below (viewModeEnabled only) is what
//    actually blocks importing a dropped .excalidrawlib file, since
//    Excalidraw's own drop handler has no read-only guard.
//  - on small screens Excalidraw reserves a big top inset assuming it owns the
//    viewport top; our 44px toolbar sits above it, so pull its UI up.
const READ_ONLY_SIDEBAR_CSS = `
.excalidraw .sidebar-trigger,
.excalidraw .default-sidebar,
.excalidraw .sidebar.default-sidebar { display: none !important; }
`

const EXCALIDRAW_TWEAKS_CSS = `
/* We are embedded below the app chrome, never at the true viewport edge, so
   Excalidraw must NOT add the device safe-area inset to its top toolbar (that
   was the big empty gap above the toolbar on iPhone; Android reports ~0). */
.excalidraw { --sat: 0px !important; --sar: 0px !important; --sal: 0px !important; }
.excalidraw .FixedSideContainer { padding-top: 0 !important; }

@media (max-width: 640px) {
  .excalidraw { --editor-container-padding: 0.5rem; }
  .excalidraw .App-menu_top { padding-top: 0 !important; margin-top: -0.25rem; }
  .excalidraw .mobile-misc-tools-container { top: calc(3.25rem - var(--editor-container-padding)) !important; }
}
`

// Main-menu actions. Kept off on purpose:
//  - loadScene / clearCanvas: wipe the whole scene in one click, bypassing the
//    Runly layer model (locked/hidden layers); dropping a .excalidraw file and
//    select-all + delete (with undo) still cover those cases while editing.
//  - saveToActiveFile: there is no local file — the server is the store.
//  - saveAsImage: superseded by Runly's "Exportar" (PNG/SVG/PDF, layer-aware).
//  - toggleTheme: follows the Runly theme.
// "Guardar en..." (download the editable .excalidraw) is offered to editors
// only, as a personal backup; read-only visitors get no source download.
const CANVAS_ACTIONS = {
  loadScene: false,
  saveToActiveFile: false,
  saveAsImage: false,
  export: false,
  clearCanvas: false,
  changeViewBackgroundColor: true,
  toggleTheme: false,
}
const UI_OPTIONS_READ_ONLY = { canvasActions: CANVAS_ACTIONS }
const UI_OPTIONS_EDIT = { canvasActions: { ...CANVAS_ACTIONS, export: { saveFileToDisk: true } } }

// The user's shape library lives in this browser (per device), shared by every
// canvas they edit. useHandleLibrary also installs libraries coming back from
// libraries.excalidraw.com ("Explorar bibliotecas" -> #addLibrary=... hash).
const LIBRARY_STORAGE_KEY = 'runly.notes.excalidrawLibrary'
const libraryAdapter = {
  load() {
    try {
      const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY)
      return raw ? { libraryItems: JSON.parse(raw) } : null
    } catch {
      return null
    }
  },
  save({ libraryItems }) {
    try {
      window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(libraryItems))
    } catch {
      // storage full / blocked: the library just won't survive a reload
    }
  },
}

// Excalidraw's own onDrop handler (handleAppOnDrop) never checks
// viewModeEnabled — an image, .excalidraw scene, or .excalidrawlib library
// file dropped on a "read-only" canvas is still parsed and applied. Block it
// ourselves in the capture phase before it reaches Excalidraw's listener.
function blockDropWhenReadOnly(e) {
  e.preventDefault()
  e.stopPropagation()
}

function CanvasStage({
  initialData,
  viewModeEnabled = false,
  theme = 'light',
  onExcalidrawAPI,
  onChange,
  onPointerUpdate,
  langCode = 'es-ES',
}) {
  const [api, setApi] = useState(null)
  const handleExcalidrawAPI = useCallback(
    (instance) => {
      setApi(instance)
      onExcalidrawAPI?.(instance)
    },
    [onExcalidrawAPI],
  )
  // null API on read-only canvases = no library loading/installing there.
  useHandleLibrary({ excalidrawAPI: viewModeEnabled ? null : api, adapter: libraryAdapter })

  const dropGuardProps = viewModeEnabled
    ? { onDropCapture: blockDropWhenReadOnly, onDragOverCapture: blockDropWhenReadOnly }
    : {}
  return (
    <div className="h-full w-full" {...dropGuardProps}>
      <style>{viewModeEnabled ? EXCALIDRAW_TWEAKS_CSS + READ_ONLY_SIDEBAR_CSS : EXCALIDRAW_TWEAKS_CSS}</style>
      <Excalidraw
        excalidrawAPI={handleExcalidrawAPI}
        initialData={initialData}
        viewModeEnabled={viewModeEnabled}
        theme={theme}
        onChange={onChange}
        onPointerUpdate={onPointerUpdate}
        langCode={langCode}
        UIOptions={viewModeEnabled ? UI_OPTIONS_READ_ONLY : UI_OPTIONS_EDIT}
      />
    </div>
  )
}

export default memo(CanvasStage)
