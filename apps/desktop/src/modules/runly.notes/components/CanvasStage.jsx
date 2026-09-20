import { memo } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
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
//  - hide Excalidraw's own shape "Library" (sidebar + its trigger button) —
//    not part of the Atlas UX, renders with broken theming here, and on the
//    public read-only view "Explorar bibliotecas" lets a visitor pull in and
//    render third-party content on a page that's supposed to be inert. The
//    selectors below are the real classes @excalidraw/excalidraw emits
//    (verified against the installed 0.18.1 bundle — the previous selectors,
//    `.library-button` / `[data-testid="library-button"]` /
//    `[aria-label="Library"]`, matched nothing in that version and silently
//    hid nothing). This only hides the UI; onDropCapture below (viewModeEnabled
//    only) is what actually blocks importing a dropped .excalidrawlib file,
//    since Excalidraw's own drop handler has no read-only guard.
//  - on small screens Excalidraw reserves a big top inset assuming it owns the
//    viewport top; our 44px toolbar sits above it, so pull its UI up.
const EXCALIDRAW_TWEAKS_CSS = `
.excalidraw .sidebar-trigger,
.excalidraw .default-sidebar,
.excalidraw .sidebar.default-sidebar { display: none !important; }

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

const CANVAS_ACTIONS = {
  loadScene: false,
  saveToActiveFile: false,
  saveAsImage: false,
  export: false,
  clearCanvas: false,
  changeViewBackgroundColor: true,
  toggleTheme: false,
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
  const dropGuardProps = viewModeEnabled
    ? { onDropCapture: blockDropWhenReadOnly, onDragOverCapture: blockDropWhenReadOnly }
    : {}
  return (
    <div className="h-full w-full" {...dropGuardProps}>
      <style>{EXCALIDRAW_TWEAKS_CSS}</style>
      <Excalidraw
        excalidrawAPI={onExcalidrawAPI}
        initialData={initialData}
        viewModeEnabled={viewModeEnabled}
        theme={theme}
        onChange={onChange}
        onPointerUpdate={onPointerUpdate}
        langCode={langCode}
        UIOptions={{ canvasActions: CANVAS_ACTIONS }}
      />
    </div>
  )
}

export default memo(CanvasStage)
