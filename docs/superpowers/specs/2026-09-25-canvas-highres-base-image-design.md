# Canvas: high-resolution image/PDF base layer

Status: Approved
Date: 2026-09-25

## Background

Two related problems were reported in `runly.notes` canvas notes:

1. **Layers panel had no way to close on desktop.** `CanvasLayersPanel.jsx`'s
   desktop variant (the floating `absolute top-3 right-3 bottom-3 w-72`
   panel) had no close control, and it visually sits directly on top of the
   toolbar's "Capas" toggle button (`CanvasEditor.jsx`), so opening the panel
   could make the only way to close it unclickable. **Already fixed** (out of
   scope for this spec): a dedicated close (X) button was added to the
   desktop panel header, reusing the `pr-12` space already reserved in the
   header layout. Mobile already had a close X via `SheetContent`'s built-in
   `SheetPrimitive.Close`.

2. **Uploaded images appear pixelated on the canvas**, making them unusable
   as a base layer for something like a large construction blueprint where
   the user wants to zoom in and still read fine detail. Root cause:
   Excalidraw (`@excalidraw/excalidraw@0.18.1`) unconditionally downscales
   any newly inserted image to `DEFAULT_MAX_IMAGE_WIDTH_OR_HEIGHT = 1440`px
   on the longest side (`resizeImageFile` call inside `initializeImage`,
   confirmed by reading the installed package's dev build). This happens
   whenever the image's `fileId` isn't already present in Excalidraw's
   internal file store — there is no prop to disable it. This spec covers
   the fix for problem 2: a way to insert an image or PDF page onto the
   canvas at full resolution, plus the toolbar entry point to do it.

## Goals

- Add a "Subir plano" toolbar button in `CanvasEditor.jsx` that inserts an
  image or a PDF page onto the canvas at full source resolution, bypassing
  Excalidraw's 1440px insert-time downscale.
- Support both image files (any type Excalidraw already accepts) and PDF
  files. For a multi-page PDF, let the user pick which page to insert.
- The inserted element behaves like any other image on the canvas: it lands
  on whichever layer is active, is not locked, and the user organizes it
  manually (per product decision — no automatic "base layer" behavior).
- Available on both desktop and mobile.
- Raise the existing 10MB canvas-image upload cap to 30MB so a high-DPI
  scan or PDF render doesn't hit it immediately.

## Non-goals

- No automatic "send to back + lock" behavior for the inserted image.
- No change to how Excalidraw's own built-in image tool (drag-drop, paste,
  toolbar image tool) behaves — that still downscales to 1440px, unchanged.
  This spec only adds a second, explicit high-quality insert path.
- No multi-page batch insert (insert every PDF page at once) — one page per
  upload action.
- No configurable DPI/quality picker in the UI — PDF pages render at a
  fixed ~450 DPI (see below); this is a constant, not a setting.

## Root cause detail

Confirmed by reading
`node_modules/.pnpm/@excalidraw+excalidraw@0.18.1.../dist/dev/index.js`:

```js
// initializeImage(), only when this.files[fileId] has no dataURL yet:
imageFile = await resizeImageFile(imageFile, {
  maxWidthOrHeight: DEFAULT_MAX_IMAGE_WIDTH_OR_HEIGHT // = 1440, chunk-4FTI6OG3.js
});
```

This only triggers when `fileId` isn't already in Excalidraw's file store
with a `dataURL`. Excalidraw also exposes a supported, documented way to add
elements programmatically without going through this path:

- `excalidrawAPI.addFiles([{ id, dataURL, mimeType, created }])` — seeds the
  file store directly with whatever dataURL we hand it (full resolution,
  untouched).
- `convertToExcalidrawElements([{ type: 'image', fileId, x, y, width, height }])`
  — the public "skeleton" API that expands a plain descriptor into a fully
  formed Excalidraw element (via `newImageElement` internally), the same
  function Excalidraw's own docs use for programmatic element creation.

Since we control both calls, we skip `resizeImageFile` entirely. The
element's `width`/`height` only set its on-canvas *display box* — the
dataURL behind `fileId` is the actual pixel source Excalidraw samples from
when rendering at any zoom level, so a full-resolution dataURL is what
actually fixes the pixelation; the display box can start at a modest,
viewport-fitting size.

## Design

### 1. Toolbar entry point (`CanvasEditor.jsx`)

A new button, "Subir plano", placed in the toolbar row next to "Exportar"
and "Capas" (both desktop and mobile — the row already reflows there).
Clicking it opens a hidden `<input type="file" accept="image/*,application/pdf">`
(same trigger-button-plus-hidden-input pattern as
`packages/ui/src/components/ImageUploader.jsx`; there's no `@runly/ui`
"open OS file picker" component to reuse here, so this is the established
in-repo pattern, not a one-off deviation).

### 2. `lib/canvasBaseImage.js` (new)

Pure(-ish) helpers, unit-testable without a DOM canvas where possible:

- `readImageFullRes(file)` → `Promise<{ dataURL, mimeType, naturalWidth, naturalHeight }>`.
  Reads the file straight to a dataURL via `FileReader` (no resize step at
  all), then loads it into an offscreen `Image` to read
  `naturalWidth`/`naturalHeight`.
- `getPdfPageCount(file)` → `Promise<number>`, via `pdfjs-dist`'s
  `getDocument(...).promise` then `.numPages`. Uses the raw `pdfjs-dist`
  API directly (not `react-pdf`, which renders into a React tree — we need
  a headless render to an offscreen canvas), pointed at the same worker
  already served at `/pdf.worker.min.mjs` (see `packages/ui/src/components/PDFViewer.jsx`).
- `renderPdfPageThumbnail(file, pageNumber)` → cheap ~72 DPI (`scale: 1`)
  render for the page picker grid.
- `renderPdfPageFullRes(file, pageNumber)` → renders at `scale: 6.25`
  (≈450 DPI: PDF user space is 72 units/inch, so `450 / 72 ≈ 6.25`) to an
  offscreen `<canvas>`, then `canvas.toDataURL('image/png')`. Returns the
  same shape as `readImageFullRes`.

### 3. `components/CanvasPdfPageDialog.jsx` (new)

Only rendered when `getPdfPageCount(file) > 1`. A `@runly/ui` `Dialog` with
a grid of page thumbnails (from `renderPdfPageThumbnail`, rendered as they
resolve — no need to block on all of them). Picking one closes the dialog
and resolves with the chosen page number; the caller then calls
`renderPdfPageFullRes` for just that page. A single-page PDF skips this
dialog and goes straight to full-res render of page 1.

### 4. Insert pipeline (`CanvasEditor.jsx`)

New `handleUploadBaseImage(file)`:

1. Reject unsupported file types with a toast before doing any work.
2. If PDF: get page count. If `> 1`, await the page-select dialog; if `1`,
   use page 1. Render the chosen page at full res.
   If image: read full res directly.
3. Estimate the resulting payload size (reusing the existing
   `dataURLtoBlob` logic already in `lib/canvasImages.js` — exported for
   this reuse) and reject with a toast if it exceeds the (raised) limit,
   mirroring the existing "La imagen supera el limite de X MB" message.
4. `fileId = crypto.randomUUID()` — an Excalidraw file-store key, not a
   database row id; unrelated to the project's `uuidv7()`-for-DB-rows rule.
5. `apiRef.current.addFiles([{ id: fileId, dataURL, mimeType, created: Date.now() }])`.
6. Compute an initial on-canvas box: fit within the current viewport (read
   via `apiRef.current.getAppState()` scroll/zoom), capped so it starts
   fully visible, aspect ratio preserved from `naturalWidth`/`naturalHeight`.
   Centered on the current view.
7. `convertToExcalidrawElements([{ type: 'image', fileId, x, y, width, height }])`
   → one element.
8. `assignLayer(element, activeLayerIdRef.current ?? layersRef.current[0]?.id)`
   (same call `handleChange` already makes for user-drawn elements) so it
   participates in the layer system like anything else.
9. `applyElements([...elementsRef.current, element])` — the existing helper
   (`CanvasEditor.jsx:360`) that updates the ref, pushes the derived scene
   through `updateScene`, notifies the realtime sync, persists, and bumps
   the layers panel's element version.
10. Call `uploadPendingImages()` (see refactor below) so the new file gets
    pushed to storage and its manifest entry broadcast to collaborators,
    exactly like a normal drag-dropped image.
11. Toast success/failure.

### 5. Refactor: extract `uploadPendingImages()`

The "upload any new image, persist manifest, broadcast" block currently
lives inline inside `handleChange` (`CanvasEditor.jsx:290-312`). The new
insert path in step 10 above needs the identical logic (same
`syncNewImages` call, same manifest/persist/broadcast side effects), so
this block becomes a small shared `useCallback` used by both `handleChange`
and `handleUploadBaseImage`. This is a direct, minimal extraction — no
broader refactor of `handleChange`.

### 6. Raise the upload size cap

`MAX_IMAGE_BYTES` in `lib/canvasImages.js` goes from `10 * 1024 * 1024` to
`30 * 1024 * 1024`. This applies to all canvas image uploads (not gated to
this feature specifically) — a high-DPI blueprint scan or a 450 DPI PDF
render both plausibly exceed 10MB, and there's no reason the existing
drag-and-drop path should have a stricter limit than the new one.

## Error handling

- Unsupported file type (not image/* or application/pdf): toast, abort
  before any Excalidraw API call.
- PDF fails to load/render (corrupt file, worker failure): toast a clear
  Spanish error, abort — no partial element inserted.
- Oversized result (> 30MB): toast the existing size-limit message, abort
  before `addFiles`/`convertToExcalidrawElements` — never insert an element
  whose file never gets uploaded.
- Page-select dialog dismissed without a pick: no-op, no element inserted.

## Testing

Following this module's existing lean-coverage pattern (`node --test`, no
exhaustive suites):

- `lib/__tests__/canvas-base-image.test.js`: DPI→scale math
  (`450 / 72 ≈ 6.25`), that `readImageFullRes` never calls any resize path,
  and shape of the returned objects. PDF rendering itself needs a real PDF
  and a canvas context — covered by manual verification (see below) rather
  than unit tests, consistent with how this module already treats
  canvas/Excalidraw-dependent code (e.g. `canvasExport.js` has no unit
  tests; its pure helpers do).

## Manual verification plan

1. Open a canvas note, click "Subir plano", pick a large (>1440px) photo.
   Confirm it appears sharp when zoomed in past what a 1440px source would
   support.
2. Upload a single-page PDF; confirm it renders directly without a page
   picker.
3. Upload a multi-page PDF; confirm the page picker appears, thumbnails
   load, and the chosen page is what gets inserted at full resolution.
4. Confirm the inserted image is a normal, editable, unlocked element on
   the active layer (movable, resizable, deletable, assignable to another
   layer via the layers panel).
5. Reload the note; confirm the image persists (manifest survived) and
   still renders at full quality.
6. Try a file that pushes the result past 30MB; confirm a clear toast and
   no broken/partial element on the canvas.
