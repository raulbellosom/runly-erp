# Canvas high-resolution image/PDF upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `runly.notes` canvas note insert an image or a PDF page onto
the Excalidraw canvas at full source resolution, so a construction blueprint
stays legible when zoomed in, instead of Excalidraw's built-in insert path
silently downscaling it to 1440px.

**Architecture:** A new toolbar button reads the file (or rasterizes a
chosen PDF page via `pdfjs-dist` at ~450 DPI), seeds Excalidraw's file store
directly via `excalidrawAPI.addFiles()` with the untouched full-res dataURL,
then builds the canvas element via Excalidraw's public
`convertToExcalidrawElements()` skeleton API — bypassing
`initializeImage()`'s unconditional `resizeImageFile(..., { maxWidthOrHeight: 1440 })`
call entirely, since that only triggers when the fileId isn't already in the
file store.

**Tech Stack:** React, `@excalidraw/excalidraw` 0.18.1, `pdfjs-dist` 5.x
(already a dependency, worker already served at `/pdf.worker.min.mjs`),
`@runly/ui` (`Dialog`), `sonner` (`toast`), Node's built-in test runner.

**Design doc:** `docs/superpowers/specs/2026-09-25-canvas-highres-base-image-design.md`

---

### Task 1: Raise the canvas image size cap and export `dataURLtoBlob`

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/lib/canvasImages.js`

- [ ] **Step 1: Bump the limit and export the blob helper**

In `apps/desktop/src/modules/runly.notes/lib/canvasImages.js`, change:

```js
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
```

to:

```js
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024
```

And change:

```js
function dataURLtoBlob(dataURL) {
```

to:

```js
export function dataURLtoBlob(dataURL) {
```

(Everything else in the file — `syncNewImages`, `pickManifest`,
`hydrateImages`, `blobToDataURL` — is unchanged. `syncNewImages` already
references `MAX_IMAGE_BYTES` and `dataURLtoBlob` by their local names, which
still resolve fine after adding `export`.)

- [ ] **Step 2: Verify the file still parses**

Run: `node --check apps/desktop/src/modules/runly.notes/lib/canvasImages.js`
Expected: no output (this file is plain JS with no JSX, so `node --check`
works directly on it).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/canvasImages.js
git commit -m "$(cat <<'EOF'
feat(notes): raise canvas image upload cap to 30MB, export blob helper

Prepares for the high-res base-image insert path, which needs the same
size guard and dataURL->Blob conversion the existing upload flow uses.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `lib/canvasBaseImage.js` — read/render helpers

**Files:**
- Create: `apps/desktop/src/modules/runly.notes/lib/canvasBaseImage.js`
- Test: `apps/desktop/src/modules/runly.notes/lib/__tests__/canvas-base-image.test.js`

This file has both DOM-dependent parts (image/PDF rendering — exercised by
the manual verification plan in the design doc, same as `canvasExport.js`'s
canvas-dependent code today) and pure math (`dpiToScale`,
`computeFitDimensions`) that's fully unit-testable under plain Node.

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `apps/desktop/src/modules/runly.notes/lib/__tests__/canvas-base-image.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { dpiToScale, PDF_RENDER_DPI, computeFitDimensions } from '../canvasBaseImage.js'

test('dpiToScale: 72 DPI (PDF user space) is scale 1', () => {
  assert.equal(dpiToScale(72), 1)
})

test('dpiToScale: 450 DPI is scale 6.25', () => {
  assert.equal(dpiToScale(450), 6.25)
})

test('PDF_RENDER_DPI is print-grade (at least 400 DPI)', () => {
  assert.ok(PDF_RENDER_DPI >= 400)
})

test('computeFitDimensions: image already under the cap keeps its natural size', () => {
  const result = computeFitDimensions(800, 600, 1200)
  assert.deepEqual(result, { width: 800, height: 600 })
})

test('computeFitDimensions: oversized landscape image scales down, aspect ratio preserved', () => {
  const result = computeFitDimensions(4000, 2000, 1200)
  assert.deepEqual(result, { width: 1200, height: 600 })
})

test('computeFitDimensions: oversized portrait image scales down, aspect ratio preserved', () => {
  const result = computeFitDimensions(2000, 4000, 1200)
  assert.deepEqual(result, { width: 600, height: 1200 })
})

test('computeFitDimensions: missing natural size falls back to a maxDim square', () => {
  const result = computeFitDimensions(0, 0, 1200)
  assert.deepEqual(result, { width: 1200, height: 1200 })
})
```

- [ ] **Step 2: Run it to confirm it fails (module doesn't exist yet)**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/canvas-base-image.test.js`
Expected: FAIL — `Cannot find module '../canvasBaseImage.js'`

- [ ] **Step 3: Create `canvasBaseImage.js`**

Create `apps/desktop/src/modules/runly.notes/lib/canvasBaseImage.js`:

```js
import * as pdfjsLib from 'pdfjs-dist'

// Same worker file PDFViewer.jsx already serves — copied to public/ by the
// app's postinstall script from this same pdfjs-dist dependency.
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

// PDF "user space" is fixed at 72 units per inch by the PDF spec, so a
// render `scale` of N produces N * 72 DPI.
const PDF_USER_SPACE_DPI = 72

// ~450 DPI is print-shop-grade detail — enough for a construction
// blueprint's fine linework to stay legible at deep canvas zoom, without
// rendering every page at a size that would dominate the 30MB upload cap.
export const PDF_RENDER_DPI = 450
export const PDF_THUMBNAIL_DPI = 72

export function dpiToScale(dpi) {
  return dpi / PDF_USER_SPACE_DPI
}

// The on-canvas *display box* a freshly inserted element starts at. This is
// independent of the source image's actual pixel resolution — Excalidraw
// always samples from the full dataURL behind fileId when rendering at any
// zoom level, so keeping this modest just keeps the first paint sane; it
// never limits how much detail survives a later zoom-in.
export function computeFitDimensions(naturalWidth, naturalHeight, maxDim = 1200) {
  if (!naturalWidth || !naturalHeight) return { width: maxDim, height: maxDim }
  if (naturalWidth <= maxDim && naturalHeight <= maxDim) {
    return { width: naturalWidth, height: naturalHeight }
  }
  const scale = Math.min(maxDim / naturalWidth, maxDim / naturalHeight)
  return { width: Math.round(naturalWidth * scale), height: Math.round(naturalHeight * scale) }
}

// Reads an image file straight to a dataURL at its original resolution —
// deliberately no resize step, unlike Excalidraw's own insert path (see the
// design doc: it silently downscales any newly inserted image to 1440px).
export function readImageFullRes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.onload = async () => {
      try {
        const dataURL = reader.result
        const { naturalWidth, naturalHeight } = await loadImageDimensions(dataURL)
        resolve({ dataURL, mimeType: file.type || 'image/png', naturalWidth, naturalHeight })
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsDataURL(file)
  })
}

function loadImageDimensions(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight })
    img.onerror = () => reject(new Error('No se pudo leer las dimensiones de la imagen'))
    img.src = dataURL
  })
}

async function loadPdfDocument(file) {
  const buffer = await file.arrayBuffer()
  return pdfjsLib.getDocument({ data: buffer }).promise
}

export async function getPdfPageCount(file) {
  const doc = await loadPdfDocument(file)
  try {
    return doc.numPages
  } finally {
    await doc.destroy()
  }
}

async function renderPdfPage(file, pageNumber, dpi) {
  const doc = await loadPdfDocument(file)
  try {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale: dpiToScale(dpi) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
    return {
      dataURL: canvas.toDataURL('image/png'),
      mimeType: 'image/png',
      naturalWidth: canvas.width,
      naturalHeight: canvas.height,
    }
  } finally {
    await doc.destroy()
  }
}

// Cheap ~72 DPI render for the page-picker thumbnail grid.
export function renderPdfPageThumbnail(file, pageNumber) {
  return renderPdfPage(file, pageNumber, PDF_THUMBNAIL_DPI)
}

// Full ~450 DPI render for the page the user actually picked.
export function renderPdfPageFullRes(file, pageNumber) {
  return renderPdfPage(file, pageNumber, PDF_RENDER_DPI)
}
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/canvas-base-image.test.js`
Expected: PASS, 7 tests, 0 failures.

(`readImageFullRes`, `getPdfPageCount`, `renderPdfPage*` all need
`FileReader`/`Image`/`document.createElement('canvas')`/`pdfjs-dist`'s
worker — none of which exist under plain Node. They're exercised by the
manual verification plan in the design doc, the same way `canvasExport.js`'s
canvas-dependent code has no unit tests today.)

- [ ] **Step 5: Verify JSX-free syntax**

Run: `node --check apps/desktop/src/modules/runly.notes/lib/canvasBaseImage.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/canvasBaseImage.js apps/desktop/src/modules/runly.notes/lib/__tests__/canvas-base-image.test.js
git commit -m "$(cat <<'EOF'
feat(notes): add canvasBaseImage helpers for full-res image/PDF reads

Pure DPI/fit math is unit tested; the DOM- and pdfjs-dependent render
paths (image read, PDF page render) are covered by manual verification,
matching how canvasExport.js's canvas-dependent code is already treated.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `components/CanvasPdfPageDialog.jsx` — PDF page picker

**Files:**
- Create: `apps/desktop/src/modules/runly.notes/components/CanvasPdfPageDialog.jsx`

Only shown when a PDF has more than one page (the caller checks page count
and skips this dialog entirely for single-page PDFs — see Task 4).

- [ ] **Step 1: Create the component**

Create `apps/desktop/src/modules/runly.notes/components/CanvasPdfPageDialog.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@runly/ui'
import { renderPdfPageThumbnail } from '../lib/canvasBaseImage.js'

// Thumbnails render lazily, one page at a time, at a cheap ~72 DPI — the
// page the user picks gets re-rendered at full resolution by the caller
// (CanvasEditor's insertPdfPage), this component never touches the heavy
// version.
export function CanvasPdfPageDialog({ open, onOpenChange, file, pageCount, onSelect }) {
  const [thumbnails, setThumbnails] = useState({})

  useEffect(() => {
    if (!open || !file || !pageCount) return undefined
    let cancelled = false
    setThumbnails({})
    ;(async () => {
      for (let page = 1; page <= pageCount; page += 1) {
        if (cancelled) return
        try {
          const { dataURL } = await renderPdfPageThumbnail(file, page)
          if (!cancelled) setThumbnails((prev) => ({ ...prev, [page]: dataURL }))
        } catch {
          // A page whose thumbnail fails to render is still selectable —
          // the picker just shows a spinner in its place indefinitely.
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, file, pageCount])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Elegi una pagina</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto pr-1">
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => onSelect(page)}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-border hover:border-amber-500 transition-colors p-1.5"
            >
              <div className="w-full aspect-3/4 rounded bg-muted flex items-center justify-center overflow-hidden">
                {thumbnails[page] ? (
                  <img
                    src={thumbnails[page]}
                    alt={`Pagina ${page}`}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <Loader2 size={16} className="animate-spin text-muted-foreground/50" />
                )}
              </div>
              <span className="text-[11px] text-muted-foreground">Pagina {page}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Lint the new component**

Run: `pnpm eslint apps/desktop/src/modules/runly.notes/components/CanvasPdfPageDialog.jsx`
Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/CanvasPdfPageDialog.jsx
git commit -m "$(cat <<'EOF'
feat(notes): add CanvasPdfPageDialog page picker for multi-page PDFs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire the "Subir plano" button into `CanvasEditor.jsx`

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/CanvasEditor.jsx`

This task: (a) extracts the existing inline image-upload side effect out of
`handleChange` into a shared `uploadPendingImages` callback, (b) adds the
insert pipeline, (c) adds the toolbar button + hidden file input + PDF page
dialog wiring.

**Important:** `@excalidraw/excalidraw` must stay out of this file's static
imports — `CanvasStage.jsx`'s header comment explains it's the *only* place
that's allowed to pull in the heavy Excalidraw bundle, everything else
lazy-loads it. `convertToExcalidrawElements` is therefore imported with a
dynamic `await import('@excalidraw/excalidraw')` inside the insert callback,
not at the top of the file. By the time a user can click "Subir plano" the
canvas is already open and `CanvasStage` has already resolved that same
dynamic import, so this doesn't cause a second fetch — it reuses the
already-loaded module.

- [ ] **Step 1: Add the new imports**

In `apps/desktop/src/modules/runly.notes/components/CanvasEditor.jsx`,
change:

```js
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Layers, FileDown } from 'lucide-react'
import { toast } from 'sonner'
```

to:

```js
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Layers, FileDown, Upload } from 'lucide-react'
import { toast } from 'sonner'
```

And change:

```js
import { SupabaseCanvasSync } from '../lib/SupabaseCanvasSync.js'
import { syncNewImages, hydrateImages, pickManifest } from '../lib/canvasImages.js'
import { exportCanvasPng, exportCanvasSvg, exportCanvasPdf } from '../lib/canvasExport.js'
import { CanvasLayersPanel } from './CanvasLayersPanel.jsx'
```

to:

```js
import { SupabaseCanvasSync } from '../lib/SupabaseCanvasSync.js'
import { syncNewImages, hydrateImages, pickManifest, dataURLtoBlob, MAX_IMAGE_BYTES } from '../lib/canvasImages.js'
import { exportCanvasPng, exportCanvasSvg, exportCanvasPdf } from '../lib/canvasExport.js'
import { readImageFullRes, getPdfPageCount, renderPdfPageFullRes, computeFitDimensions } from '../lib/canvasBaseImage.js'
import { CanvasLayersPanel } from './CanvasLayersPanel.jsx'
import { CanvasPdfPageDialog } from './CanvasPdfPageDialog.jsx'
```

- [ ] **Step 2: Add state for the file input and PDF page picker**

Change:

```js
  const [ready, setReady] = useState(false)
  const [showLayers, setShowLayers] = useState(false)
  const showLayersRef = useRef(false)
  showLayersRef.current = showLayers
  const [isMobile, setIsMobile] = useState(false)
```

to:

```js
  const [ready, setReady] = useState(false)
  const [showLayers, setShowLayers] = useState(false)
  const showLayersRef = useRef(false)
  showLayersRef.current = showLayers
  const [isMobile, setIsMobile] = useState(false)
  const [pdfPicker, setPdfPicker] = useState(null) // { file, pageCount } while a multi-page PDF awaits a page choice
  const fileInputRef = useRef(null)
```

- [ ] **Step 3: Extract `uploadPendingImages` and use it from `handleChange`**

Change:

```js
  const handleChange = useCallback(
    async (elements, appState) => {
      const active = activeLayerIdRef.current ?? layersRef.current[0]?.id
      const withLayers = elements.map((el) => assignLayer(el, active))
      // Excalidraw only ever hands back visible-layer elements — merge the
      // hidden ones back so the source of truth stays whole.
      elementsRef.current = mergeVisibleBack(elementsRef.current, withLayers, layersRef.current)

      const selMap = appState?.selectedElementIds ?? {}
      const selKeys = Object.keys(selMap).filter((k) => selMap[k])
      if (selKeys.length !== selectionRef.current) {
        selectionRef.current = selKeys.length
        setSelectionCount(selKeys.length)
      }
      const selKey = selKeys.slice().sort().join(',')
      if (showLayersRef.current && selKey !== selKeyRef.current) {
        selKeyRef.current = selKey
        setSelectedIds(new Set(selKeys))
      }

      if (showLayersRef.current && Date.now() - lastElementsBump.current > 400) {
        lastElementsBump.current = Date.now()
        setElementsVersion((v) => v + 1)
      }

      syncRef.current?.notifyLocalChange()
      persist()

      // Upload any freshly added images, then persist + share the manifest so
      // they survive a reload and reach other participants (deltas carry
      // elements, not file bytes).
      const files = apiRef.current?.getFiles?.() ?? {}
      const hasNew = Object.keys(files).some((id) => !filesManifestRef.current[id]?.url)
      if (hasNew) {
        try {
          const { manifest, uploadedIds } = await syncNewImages({
            files,
            manifest: filesManifestRef.current,
            noteId,
            token,
          })
          filesManifestRef.current = manifest
          if (uploadedIds.length) {
            syncRef.current?.broadcastFiles(pickManifest(manifest, uploadedIds))
            persist()
          }
        } catch (err) {
          console.warn('[canvas] image upload failed:', err?.message ?? err)
          toast.error(err?.message ?? 'No se pudo subir la imagen al lienzo')
        }
      }
    },
    [noteId, token, persist],
  )
```

to:

```js
  // Upload any freshly added images, then persist + share the manifest so
  // they survive a reload and reach other participants (deltas carry
  // elements, not file bytes). Shared by handleChange (drag/drop/paste,
  // Excalidraw's own image tool) and the high-res insert path below.
  const uploadPendingImages = useCallback(async () => {
    const files = apiRef.current?.getFiles?.() ?? {}
    const hasNew = Object.keys(files).some((id) => !filesManifestRef.current[id]?.url)
    if (!hasNew) return
    try {
      const { manifest, uploadedIds } = await syncNewImages({
        files,
        manifest: filesManifestRef.current,
        noteId,
        token,
      })
      filesManifestRef.current = manifest
      if (uploadedIds.length) {
        syncRef.current?.broadcastFiles(pickManifest(manifest, uploadedIds))
        persist()
      }
    } catch (err) {
      console.warn('[canvas] image upload failed:', err?.message ?? err)
      toast.error(err?.message ?? 'No se pudo subir la imagen al lienzo')
    }
  }, [noteId, token, persist])

  const handleChange = useCallback(
    async (elements, appState) => {
      const active = activeLayerIdRef.current ?? layersRef.current[0]?.id
      const withLayers = elements.map((el) => assignLayer(el, active))
      // Excalidraw only ever hands back visible-layer elements — merge the
      // hidden ones back so the source of truth stays whole.
      elementsRef.current = mergeVisibleBack(elementsRef.current, withLayers, layersRef.current)

      const selMap = appState?.selectedElementIds ?? {}
      const selKeys = Object.keys(selMap).filter((k) => selMap[k])
      if (selKeys.length !== selectionRef.current) {
        selectionRef.current = selKeys.length
        setSelectionCount(selKeys.length)
      }
      const selKey = selKeys.slice().sort().join(',')
      if (showLayersRef.current && selKey !== selKeyRef.current) {
        selKeyRef.current = selKey
        setSelectedIds(new Set(selKeys))
      }

      if (showLayersRef.current && Date.now() - lastElementsBump.current > 400) {
        lastElementsBump.current = Date.now()
        setElementsVersion((v) => v + 1)
      }

      syncRef.current?.notifyLocalChange()
      persist()

      await uploadPendingImages()
    },
    [persist, uploadPendingImages],
  )
```

- [ ] **Step 4: Verify it still parses (this step won't catch JSX issues, just a quick sanity check before the bigger edit)**

Run: `pnpm eslint apps/desktop/src/modules/runly.notes/components/CanvasEditor.jsx`
Expected: no output.

- [ ] **Step 5: Commit the extraction on its own**

```bash
git add apps/desktop/src/modules/runly.notes/components/CanvasEditor.jsx
git commit -m "$(cat <<'EOF'
refactor(notes): extract uploadPendingImages out of handleChange

No behavior change — the high-res insert path (next commit) needs the
identical upload-manifest-broadcast side effect handleChange already
runs after every Excalidraw onChange.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Add the insert pipeline callbacks**

Find `applyOrder` (ends right before `const childHandlers = {`) in the same
file. Change:

```js
      apiRef.current?.updateScene({ elements: scene, captureUpdate: 'IMMEDIATELY' })
      syncRef.current?.notifyLocalChange()
      persist()
      setElementsVersion((v) => v + 1)
    },
    [persist],
  )

  const childHandlers = {
```

to:

```js
      apiRef.current?.updateScene({ elements: scene, captureUpdate: 'IMMEDIATELY' })
      syncRef.current?.notifyLocalChange()
      persist()
      setElementsVersion((v) => v + 1)
    },
    [persist],
  )

  // Inserts one image element at full source resolution, bypassing
  // Excalidraw's own insert path (which downscales to 1440px — see the
  // canvas-highres-base-image design doc). `data` is whatever
  // readImageFullRes / renderPdfPageFullRes resolved: full-res dataURL +
  // natural pixel size.
  const insertBaseImageElement = useCallback(
    async ({ dataURL, mimeType, naturalWidth, naturalHeight }) => {
      const blob = dataURLtoBlob(dataURL)
      if (blob.size > MAX_IMAGE_BYTES) {
        toast.error(`El archivo supera el limite de ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`)
        return
      }
      const fileId = crypto.randomUUID()
      apiRef.current?.addFiles([{ id: fileId, dataURL, mimeType, created: Date.now() }])
      const { width, height } = computeFitDimensions(naturalWidth, naturalHeight)
      // Dynamic import: keeps @excalidraw/excalidraw out of this file's own
      // chunk (CanvasStage.jsx is the only static importer). Already
      // resolved by the time this runs — the canvas has to be open (and
      // CanvasStage loaded) for the user to click "Subir plano" at all.
      const { convertToExcalidrawElements } = await import('@excalidraw/excalidraw')
      const [element] = convertToExcalidrawElements([
        { type: 'image', fileId, x: 0, y: 0, width, height },
      ])
      const active = activeLayerIdRef.current ?? layersRef.current[0]?.id
      const withLayer = assignLayer(element, active)
      applyElements([...elementsRef.current, withLayer])
      try {
        apiRef.current?.scrollToContent?.([withLayer], { fitToContent: true, animate: true })
      } catch {
        /* older signature */
      }
      await uploadPendingImages()
    },
    [applyElements, uploadPendingImages],
  )

  const handleUploadBaseImage = useCallback(
    async (file) => {
      const isPdf = file.type === 'application/pdf'
      const isImage = file.type.startsWith('image/')
      if (!isPdf && !isImage) {
        toast.error('Solo se pueden subir imagenes o archivos PDF')
        return
      }
      try {
        if (isImage) {
          const data = await readImageFullRes(file)
          await insertBaseImageElement(data)
          return
        }
        const pageCount = await getPdfPageCount(file)
        if (pageCount <= 1) {
          const data = await renderPdfPageFullRes(file, 1)
          await insertBaseImageElement(data)
          return
        }
        setPdfPicker({ file, pageCount })
      } catch (err) {
        toast.error(err?.message ?? 'No se pudo procesar el archivo')
      }
    },
    [insertBaseImageElement],
  )

  const insertPdfPage = useCallback(
    async (file, page) => {
      try {
        const data = await renderPdfPageFullRes(file, page)
        await insertBaseImageElement(data)
      } catch (err) {
        toast.error(err?.message ?? 'No se pudo procesar la pagina del PDF')
      }
    },
    [insertBaseImageElement],
  )

  const childHandlers = {
```

Note: `applyElements` is defined above this insertion point (it's the
function immediately before `applyOrder`), so `insertBaseImageElement`
closing over it is fine — no reordering needed.

- [ ] **Step 7: Add the toolbar button, hidden file input, and PDF dialog to the render**

Change:

```js
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setShowLayers((v) => !v)}
            title={`Capa activa: ${activeLayer?.name ?? ''}`}
```

to:

```js
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted rounded-lg"
          >
            <Upload size={13} /> Subir plano
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) handleUploadBaseImage(file)
            }}
          />
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setShowLayers((v) => !v)}
            title={`Capa activa: ${activeLayer?.name ?? ''}`}
```

Then change:

```js
      <CanvasLayersPanel
        open={showLayers}
        onOpenChange={setShowLayers}
        isMobile={isMobile}
        onAddLayer={addLayer}
        layers={layers}
        selectionCount={selectionCount}
        selectedIds={selectedIds}
        {...layerCbs}
      />
    </div>
  )
}
```

to:

```js
      <CanvasLayersPanel
        open={showLayers}
        onOpenChange={setShowLayers}
        isMobile={isMobile}
        onAddLayer={addLayer}
        layers={layers}
        selectionCount={selectionCount}
        selectedIds={selectedIds}
        {...layerCbs}
      />

      {pdfPicker && (
        <CanvasPdfPageDialog
          open
          onOpenChange={(o) => {
            if (!o) setPdfPicker(null)
          }}
          file={pdfPicker.file}
          pageCount={pdfPicker.pageCount}
          onSelect={async (page) => {
            const { file } = pdfPicker
            setPdfPicker(null)
            await insertPdfPage(file, page)
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 8: Lint the full file**

Run: `pnpm eslint apps/desktop/src/modules/runly.notes/components/CanvasEditor.jsx`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/CanvasEditor.jsx
git commit -m "$(cat <<'EOF'
feat(notes): add high-res image/PDF upload to the canvas toolbar

"Subir plano" reads an image (or rasterizes a chosen PDF page at ~450
DPI) and inserts it via Excalidraw's addFiles + convertToExcalidrawElements,
bypassing the library's own insert-time 1440px downscale so a large
blueprint stays sharp when zoomed in. Multi-page PDFs get a page picker;
single-page PDFs and images skip straight to insertion.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full runly.notes lib test suite**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/`
Expected: all tests pass, including the new `canvas-base-image.test.js`.

- [ ] **Step 2: `node --check` every new/modified plain-JS file**

Run:
```bash
node --check apps/desktop/src/modules/runly.notes/lib/canvasImages.js
node --check apps/desktop/src/modules/runly.notes/lib/canvasBaseImage.js
```
Expected: no output for either.

- [ ] **Step 3: Lint every touched file in one pass**

Run:
```bash
pnpm eslint apps/desktop/src/modules/runly.notes/components/CanvasEditor.jsx apps/desktop/src/modules/runly.notes/components/CanvasPdfPageDialog.jsx apps/desktop/src/modules/runly.notes/components/CanvasLayersPanel.jsx apps/desktop/src/modules/runly.notes/lib/canvasImages.js apps/desktop/src/modules/runly.notes/lib/canvasBaseImage.js
```
Expected: no output.

- [ ] **Step 4: Manual verification in the running app**

Follow the "Manual verification plan" section of
`docs/superpowers/specs/2026-09-25-canvas-highres-base-image-design.md`
(6 checks: large image stays sharp, single-page PDF skips the picker,
multi-page PDF shows the picker and inserts the chosen page, inserted
element is a normal editable unlocked element on the active layer, it
survives a reload, an oversized file is rejected with a toast). Start the
app with `pnpm dev`, open a canvas note, and work through each check.
Also re-verify the earlier `CanvasLayersPanel` close-button fix while
there: open "Capas" on desktop and confirm the new X closes the panel.

- [ ] **Step 5: Note any manual-verification findings in the final summary to the user — do not silently skip a failing check.**
