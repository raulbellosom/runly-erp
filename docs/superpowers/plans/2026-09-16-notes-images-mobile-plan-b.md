# Notes Editor — Images (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single width-only resize handle with 4 free (independent width/height) corner handles, and let Android users choose "Tomar foto" vs "Elegir de galería" instead of always landing in the gallery.

**Architecture:** A new `aspectRatio` node attribute on the image node overrides the natural-aspect CSS so resize is responsive at any screen width. All 4 handles anchor at the image's fixed top-left corner (confirmed design decision — the node lives in document flow, not a free canvas) and share one pure geometry function. The camera/gallery choice ships as a new `@runly/ui` component (`ImageSourceSheet`) gated by `useCoarsePointer()`, reused across the notes module's 3 image-attach entry points.

**Tech Stack:** React, TipTap v3 (ProseMirror), `@runly/ui` (`Sheet`, `useCoarsePointer`), Node's built-in test runner (`node --test`).

Spec: `docs/superpowers/specs/2026-09-16-notes-tables-images-mobile-design.md` (sections 2 and 3).

---

### Task 1: Pure geometry helper for free 4-corner resize

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/lib/imageSize.js`
- Modify: `apps/desktop/src/modules/runly.notes/lib/__tests__/image-size.test.js`

- [ ] **Step 1: Write the failing tests (append to the existing test file)**

Append to `apps/desktop/src/modules/runly.notes/lib/__tests__/image-size.test.js`:

```js
// (add to the existing import block at the top of the file)
// import { ..., computeCornerResize, clampImageHeightPx, MIN_IMAGE_HEIGHT_PX } from '../imageSize.js'

test('computeCornerResize: grows width and height with the drag delta, from any corner', () => {
  const result = computeCornerResize({
    startWidthPx: 300, startHeightPx: 200, containerWidthPx: 600, deltaX: 60, deltaY: 40,
  })
  assert.equal(result.widthPct, 60) // (300+60)/600 * 100
  assert.equal(result.aspectRatio, 1.5) // 360/240
})

test('computeCornerResize: shrinking width clamps at MIN_IMAGE_WIDTH_PCT', () => {
  const result = computeCornerResize({
    startWidthPx: 300, startHeightPx: 200, containerWidthPx: 600, deltaX: -400, deltaY: 0,
  })
  assert.equal(result.widthPct, MIN_IMAGE_WIDTH_PCT)
})

test('computeCornerResize: growing width clamps at MAX_IMAGE_WIDTH_PCT', () => {
  const result = computeCornerResize({
    startWidthPx: 300, startHeightPx: 200, containerWidthPx: 600, deltaX: 900, deltaY: 0,
  })
  assert.equal(result.widthPct, MAX_IMAGE_WIDTH_PCT)
})

test('computeCornerResize: shrinking height clamps at MIN_IMAGE_HEIGHT_PX, width unaffected', () => {
  const result = computeCornerResize({
    startWidthPx: 300, startHeightPx: 50, containerWidthPx: 600, deltaX: 0, deltaY: -100,
  })
  assert.equal(result.widthPct, 50) // (300+0)/600 * 100, unchanged
  assert.equal(result.aspectRatio, 300 / MIN_IMAGE_HEIGHT_PX)
})

test('clampImageHeightPx: keeps an in-range value unchanged', () => {
  assert.equal(clampImageHeightPx(120), 120)
})

test('clampImageHeightPx: clamps below the minimum', () => {
  assert.equal(clampImageHeightPx(10), MIN_IMAGE_HEIGHT_PX)
})

test('clampImageHeightPx: falls back to the minimum for non-finite input', () => {
  assert.equal(clampImageHeightPx(NaN), MIN_IMAGE_HEIGHT_PX)
})
```

Update the import block at the top of the file to also pull in the 3 new names:

```js
import {
  clampImageWidthPct,
  computeInitialImageWidthPct,
  DEFAULT_IMAGE_WIDTH_PCT,
  MIN_IMAGE_WIDTH_PCT,
  MAX_IMAGE_WIDTH_PCT,
  computeCornerResize,
  clampImageHeightPx,
  MIN_IMAGE_HEIGHT_PX,
} from '../imageSize.js'
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/image-size.test.js`
Expected: FAIL — `computeCornerResize is not defined` (or similar import error)

- [ ] **Step 3: Add the implementation to `imageSize.js`**

Append to `apps/desktop/src/modules/runly.notes/lib/imageSize.js`:

```js
// A resized-down image can still be usefully wide even at a small height
// (e.g. a banner crop); this only guards against dragging a handle until
// the image becomes a sliver.
export const MIN_IMAGE_HEIGHT_PX = 40

export function clampImageHeightPx(px) {
  if (!Number.isFinite(px)) return MIN_IMAGE_HEIGHT_PX
  return Math.max(MIN_IMAGE_HEIGHT_PX, px)
}

/**
 * Pure geometry for the 4 free-resize corner handles in
 * ImageAnnotationOverlay.jsx. All 4 corners anchor at the image's fixed
 * top-left corner — the node lives in normal document flow, not a free
 * canvas, so no handle can move that corner without shifting surrounding
 * text. This means one formula covers every handle: dragging right/down
 * always grows width/height, regardless of which corner was grabbed.
 *
 * Returns `aspectRatio` (width/height) instead of a raw height in px so the
 * result stays correct if the note is later viewed at a different column
 * width — it is stored as the node's `aspectRatio` attribute and applied via
 * CSS `aspect-ratio`, not as a fixed pixel height.
 */
export function computeCornerResize({ startWidthPx, startHeightPx, containerWidthPx, deltaX, deltaY }) {
  const widthPx = Math.max(1, startWidthPx + deltaX)
  const widthPct = clampImageWidthPct((widthPx / containerWidthPx) * 100)
  const heightPx = clampImageHeightPx(startHeightPx + deltaY)
  const clampedWidthPx = (widthPct / 100) * containerWidthPx
  return { widthPct: Math.round(widthPct), aspectRatio: clampedWidthPx / heightPx }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/image-size.test.js`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/imageSize.js \
        apps/desktop/src/modules/runly.notes/lib/__tests__/image-size.test.js
git commit -m "feat(notes): add free-resize geometry helper for image corner handles"
```

---

### Task 2: `aspectRatio` node attribute

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/lib/extensions/AnnotatableImage.jsx`

- [ ] **Step 1: Add the attribute**

In `apps/desktop/src/modules/runly.notes/lib/extensions/AnnotatableImage.jsx`, inside `addAttributes()`, after the `rotation` attribute (following the exact same `data-*` round-trip pattern), add:

```js
      // Set once the user free-resizes an image via a corner handle
      // (ImageAnnotationOverlay.jsx). null = derive the frame's aspect ratio
      // from the natural image size instead (current/default behavior).
      aspectRatio: {
        default: null,
        parseHTML: (el) => {
          const raw = Number(el.getAttribute('data-aspect-ratio'))
          return Number.isFinite(raw) && raw > 0 ? raw : null
        },
        renderHTML: (attrs) =>
          attrs.aspectRatio ? { 'data-aspect-ratio': String(attrs.aspectRatio) } : {},
      },
```

- [ ] **Step 2: Manual check — no automated test (this is a thin TipTap schema declaration, exercised end-to-end in Task 3's manual QA)**

Run: `pnpm dev:frontend`, open the browser console on a note page, and confirm `editor.schema.nodes.image.spec.attrs.aspectRatio` exists (sanity check that the extension registered without a syntax error) before moving on.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/extensions/AnnotatableImage.jsx
git commit -m "feat(notes): add aspectRatio attribute to the image node"
```

---

### Task 3: Wire the 4 corner handles into `ImageAnnotationOverlay.jsx`

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`

- [ ] **Step 1: Update the import**

Change:

```js
import { clampImageWidthPct } from '../lib/imageSize.js'
```

to:

```js
import { clampImageWidthPct, computeCornerResize } from '../lib/imageSize.js'
```

- [ ] **Step 2: Replace resize state and handlers**

Find (current lines ~44, ~56):

```js
  const resizeRef = useRef(null) // { pointerId, startX, startWidthPct, columnWidthPx }
```
```js
  const [liveWidthPct, setLiveWidthPct] = useState(null) // resize drag preview
```

Replace with:

```js
  const resizeRef = useRef(null) // { pointerId, startX, startY, startWidthPx, startHeightPx, containerWidthPx }
```
```js
  const [liveWidthPct, setLiveWidthPct] = useState(null) // resize drag preview
  const [liveAspectRatio, setLiveAspectRatio] = useState(null) // resize drag preview
```

Find the `// ── click-to-resize (Word/PowerPoint-style corner handle) ────` block
(current lines ~124-157: `onImageClick`, `onResizePointerDown`, `onResizePointerMove`,
`onResizePointerUp`) and replace the 3 pointer handlers (keep `onImageClick`
as-is) with:

```js
  function onResizePointerDown(e) {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = boxRef.current.getBoundingClientRect()
    const containerWidthPx = rect.width / (widthPct / 100)
    resizeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startWidthPx: rect.width,
      startHeightPx: rect.height,
      containerWidthPx,
    }
    setLiveWidthPct(widthPct)
    setLiveAspectRatio(node.attrs.aspectRatio ?? (effNat ? effNat.w / effNat.h : rect.width / rect.height))
  }

  function onResizePointerMove(e) {
    const r = resizeRef.current
    if (!r || r.pointerId !== e.pointerId) return
    const { widthPct: newWidthPct, aspectRatio } = computeCornerResize({
      startWidthPx: r.startWidthPx,
      startHeightPx: r.startHeightPx,
      containerWidthPx: r.containerWidthPx,
      deltaX: e.clientX - r.startX,
      deltaY: e.clientY - r.startY,
    })
    setLiveWidthPct(newWidthPct)
    setLiveAspectRatio(aspectRatio)
  }

  function onResizePointerUp(e) {
    const r = resizeRef.current
    if (!r || r.pointerId !== e.pointerId) return
    resizeRef.current = null
    const finalWidthPct = liveWidthPct
    const finalAspectRatio = liveAspectRatio
    setLiveWidthPct(null)
    setLiveAspectRatio(null)
    if (finalWidthPct != null) {
      updateAttributes({ width: finalWidthPct, aspectRatio: finalAspectRatio })
    }
  }
```

- [ ] **Step 3: Make `frameStyle` prefer the live drag value, then the persisted attribute, then the natural/crop-derived ratio**

Find (current lines ~394-398):

```js
  const frameStyle = {
    aspectRatio: effNat
      ? String((effectiveCrop.w * effNat.w) / (effectiveCrop.h * effNat.h))
      : String(effectiveCrop.w / effectiveCrop.h),
  }
```

Replace with:

```js
  const displayAspectRatio = liveAspectRatio ?? node.attrs.aspectRatio ?? null
  const frameStyle = {
    aspectRatio: displayAspectRatio
      ? String(displayAspectRatio)
      : effNat
      ? String((effectiveCrop.w * effNat.w) / (effectiveCrop.h * effNat.h))
      : String(effectiveCrop.w / effectiveCrop.h),
  }
```

- [ ] **Step 4: Replace the single handle with 4 corner handles**

Find the single resize `<button>` (current lines ~618-635):

```jsx
        {editable && mode === 'view' && selected && (
          // Word/PowerPoint-style corner resize handle — drag horizontally to
          // scale the image; height follows automatically (img is height:auto).
          <button
            aria-label="Cambiar tamaño de la imagen"
            title="Arrastra para cambiar el tamaño"
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
            onPointerCancel={onResizePointerUp}
            // 44px hit area (Apple/Android minimum touch target), same trick
            // as ImageCropModal's corner handles — visually just the dot.
            className="absolute right-0 bottom-0 w-11 h-11 -m-5 flex items-center justify-center cursor-nwse-resize"
            style={{ touchAction: 'none' }}
          >
            <span className="w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-white dark:border-[hsl(var(--background))] shadow" />
          </button>
        )}
```

Replace with:

```jsx
        {editable && mode === 'view' && selected && (
          // Free 4-corner resize — all 4 anchor at the fixed top-left corner
          // (the node lives in document flow, not a free canvas), so every
          // handle shares the same onResizePointer* math; the cursor style
          // is just a visual hint matching each corner's diagonal.
          <>
            {[
              { pos: 'top-left', posClass: 'left-0 top-0', cursor: 'cursor-nwse-resize' },
              { pos: 'top-right', posClass: 'right-0 top-0', cursor: 'cursor-nesw-resize' },
              { pos: 'bottom-left', posClass: 'left-0 bottom-0', cursor: 'cursor-nesw-resize' },
              { pos: 'bottom-right', posClass: 'right-0 bottom-0', cursor: 'cursor-nwse-resize' },
            ].map(({ pos, posClass, cursor }) => (
              <button
                key={pos}
                aria-label="Cambiar tamaño de la imagen"
                title="Arrastra para cambiar el tamaño"
                onPointerDown={onResizePointerDown}
                onPointerMove={onResizePointerMove}
                onPointerUp={onResizePointerUp}
                onPointerCancel={onResizePointerUp}
                // 44px hit area (Apple/Android minimum touch target), same
                // trick as ImageCropModal's corner handles — visually just
                // the dot.
                className={`absolute ${posClass} w-11 h-11 -m-5 flex items-center justify-center ${cursor}`}
                style={{ touchAction: 'none' }}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-white dark:border-[hsl(var(--background))] shadow" />
              </button>
            ))}
          </>
        )}
```

- [ ] **Step 5: Manual check**

Run: `pnpm dev:frontend`. Insert an image, click it to select it (4 dots should appear, one per corner). Drag each corner in turn and confirm width and height both change independently (the image can be stretched taller/shorter or wider/narrower freely, not locked to its original proportions), and that the change persists after a reload (autosave). Resize at 390px (touch-emulated) and 1440px (mouse), both themes.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx
git commit -m "feat(notes): replace the single image resize handle with 4 free corner handles"
```

---

### Task 4: `ImageSourceSheet` shared component in `@runly/ui`

**Files:**
- Create: `packages/ui/src/components/ImageSourceSheet.jsx`
- Modify: `packages/ui/src/index.js`
- Modify: `docs/ai-context/rme3-runtime-capabilities.md`

- [ ] **Step 1: Write the component**

```jsx
// packages/ui/src/components/ImageSourceSheet.jsx
import { useRef } from "react";
import { Camera, Image as ImageIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "./Sheet.jsx";

// Lets a touch-device user choose between taking a new photo and picking an
// existing one, which a bare <input type="file"> cannot offer on Android —
// without a `capture` attribute Android always opens the gallery/document
// chooser, never the camera. Desktop callers should skip this component
// entirely (gate with useCoarsePointer()) and keep using a plain
// <input type="file"> click, since there is no camera-vs-gallery distinction
// on a mouse/trackpad device.
export function ImageSourceSheet({ open, onOpenChange, onPickFile, accept = "image/*" }) {
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  function handleChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    onOpenChange(false);
    if (file) onPickFile(file);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Agregar imagen</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-1">
          <button
            onClick={() => cameraInputRef.current?.click()}
            className="w-full flex items-center gap-3 text-left px-3 py-3 text-sm rounded-lg text-foreground hover:bg-muted transition-colors"
          >
            <Camera className="w-4 h-4 shrink-0" />
            Tomar foto
          </button>
          <button
            onClick={() => galleryInputRef.current?.click()}
            className="w-full flex items-center gap-3 text-left px-3 py-3 text-sm rounded-lg text-foreground hover:bg-muted transition-colors"
          >
            <ImageIcon className="w-4 h-4 shrink-0" />
            Elegir de galería
          </button>
        </div>
        <input
          ref={cameraInputRef}
          type="file"
          accept={accept}
          capture="environment"
          className="hidden"
          onChange={handleChange}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={handleChange}
        />
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Export it**

In `packages/ui/src/index.js`, near the other single-file component exports (alongside the existing `export { MobileFiltersSheet } from "./components/MobileFiltersSheet.jsx";`), add:

```js
export { ImageSourceSheet } from "./components/ImageSourceSheet.jsx";
```

- [ ] **Step 3: Document it**

Add a row for `ImageSourceSheet` to the component inventory table in
`docs/ai-context/rme3-runtime-capabilities.md` (find the existing table
listing components like `AttachmentsPanel`/`FileUploader` and add a row:
component name `ImageSourceSheet`, purpose "camera-vs-gallery picker for
touch devices — gate with `useCoarsePointer()`; on a fine-pointer device just
open a plain `<input type=\"file\">` directly instead", props
`open, onOpenChange, onPickFile, accept?`).

- [ ] **Step 4: Manual check — no automated test (thin UI composition, no pure logic to unit-test)**

Run: `pnpm dev:frontend` in a project that already imports `@runly/ui` (e.g. `apps/desktop`), and in the browser console run `import('@runly/ui').then(m => console.log(typeof m.ImageSourceSheet))` — expect `"function"`.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/ImageSourceSheet.jsx packages/ui/src/index.js \
        docs/ai-context/rme3-runtime-capabilities.md
git commit -m "feat(ui): add ImageSourceSheet camera-vs-gallery picker"
```

---

### Task 5: Wire `ImageSourceSheet` into the toolbar image button

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/NoteToolbar.jsx`

- [ ] **Step 1: Add imports**

At the top of `apps/desktop/src/modules/runly.notes/components/NoteToolbar.jsx`, add `useState` is already imported; add `ImageSourceSheet` and `useCoarsePointer` to the existing `@runly/ui` import:

```js
import { Popover, PopoverTrigger, PopoverContent, ImageSourceSheet, useCoarsePointer } from '@runly/ui'
```

- [ ] **Step 2: Add sheet-open state and the coarse-pointer check**

Inside `export function NoteToolbar(...)`, alongside the existing `useState` calls, add:

```js
  const isCoarsePointer = useCoarsePointer()
  const [imageSheetOpen, setImageSheetOpen] = useState(false)
```

- [ ] **Step 3: Branch the image button on pointer type**

Find the image `<label>` block (current lines 298-321):

```jsx
      <label
        title="Insertar imagen"
        className={[
          'h-8 min-w-8 sm:h-7 sm:min-w-7 px-1.5 rounded flex items-center justify-center gap-1 text-sm transition-colors select-none cursor-pointer shrink-0',
          uploadingImage
            ? 'opacity-50 cursor-not-allowed'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        ].join(' ')}
      >
        {uploadingImage
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <ImageIcon className="w-3.5 h-3.5" />}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={uploadingImage}
          onChange={e => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) handleImageFile(file)
          }}
        />
      </label>
```

Replace with:

```jsx
      {isCoarsePointer ? (
        <button
          type="button"
          title="Insertar imagen"
          disabled={uploadingImage}
          onClick={() => setImageSheetOpen(true)}
          className={[
            'h-8 min-w-8 sm:h-7 sm:min-w-7 px-1.5 rounded flex items-center justify-center gap-1 text-sm transition-colors select-none shrink-0',
            uploadingImage
              ? 'opacity-50 cursor-not-allowed'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          ].join(' ')}
        >
          {uploadingImage
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <ImageIcon className="w-3.5 h-3.5" />}
        </button>
      ) : (
        <label
          title="Insertar imagen"
          className={[
            'h-8 min-w-8 sm:h-7 sm:min-w-7 px-1.5 rounded flex items-center justify-center gap-1 text-sm transition-colors select-none cursor-pointer shrink-0',
            uploadingImage
              ? 'opacity-50 cursor-not-allowed'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          ].join(' ')}
        >
          {uploadingImage
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <ImageIcon className="w-3.5 h-3.5" />}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploadingImage}
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) handleImageFile(file)
            }}
          />
        </label>
      )}
      <ImageSourceSheet
        open={imageSheetOpen}
        onOpenChange={setImageSheetOpen}
        onPickFile={handleImageFile}
      />
```

- [ ] **Step 4: Manual check**

Run: `pnpm dev:frontend`. At 1440px with a mouse: clicking the image toolbar button opens the file dialog directly (no sheet) — unchanged from before. At 390px with touch emulation: clicking it opens a bottom sheet with "Tomar foto" / "Elegir de galería"; picking either uploads and inserts the image exactly as before.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/NoteToolbar.jsx
git commit -m "feat(notes): offer camera vs gallery for the toolbar image button on touch"
```

---

### Task 6: Wire `ImageSourceSheet` into the slash-command image item

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/lib/noteImageUpload.js`

- [ ] **Step 1: Read the current picker function**

`pickAndUploadNoteImage` (current lines 84-96 of `apps/desktop/src/modules/runly.notes/lib/noteImageUpload.js`) creates a bare `<input>` in JS and clicks it. Since the slash command's `run` calls this outside of React (no component to host a `Sheet`), this needs a small mount-a-component-on-demand approach, matching how `ReactRenderer` is already used for the slash menu itself in `SlashCommand.jsx`.

- [ ] **Step 2: Add a coarse-pointer branch that mounts `ImageSourceSheet` via `ReactRenderer`**

Replace `pickAndUploadNoteImage` with:

```js
// apps/desktop/src/modules/runly.notes/lib/noteImageUpload.js — replace the existing pickAndUploadNoteImage
import { ReactRenderer } from '@tiptap/react'
import { ImageSourceSheet } from '@runly/ui'

function isCoarsePointerDevice() {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
}

export function pickAndUploadNoteImage({ editor, noteId, token }) {
  if (isCoarsePointerDevice()) {
    pickViaSourceSheet({ editor, noteId, token })
    return
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) uploadAndInsertNoteImage(file, { editor, noteId, token })
  }
  input.click()
}

// Mounts a detached ImageSourceSheet (open by default) so the slash command
// — which runs outside any note screen's own component tree — can still
// offer the camera-vs-gallery choice already used by NoteToolbar.jsx.
function pickViaSourceSheet({ editor, noteId, token }) {
  const host = document.createElement('div')
  document.body.appendChild(host)

  function cleanup() {
    renderer.destroy()
    host.remove()
  }

  const renderer = new ReactRenderer(ImageSourceSheet, {
    editor,
    props: {
      open: true,
      onOpenChange: (next) => { if (!next) cleanup() },
      onPickFile: (file) => {
        uploadAndInsertNoteImage(file, { editor, noteId, token })
        cleanup()
      },
    },
  })
  host.appendChild(renderer.element)
}
```

- [ ] **Step 3: Manual check**

Run: `pnpm dev:frontend`. At 390px with touch emulation: type `/imagen` in a note and confirm the sheet appears with "Tomar foto" / "Elegir de galería"; picking one uploads and inserts the image, and the detached sheet's DOM node is removed afterward (check devtools Elements panel — no leftover empty `<div>` at the end of `<body>`). At 1440px with a mouse: `/imagen` still opens the file dialog directly.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/noteImageUpload.js
git commit -m "feat(notes): offer camera vs gallery for the slash-command image item on touch"
```

---

### Task 7: Wire `ImageSourceSheet` into the note cover banner

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/NoteCoverBanner.jsx`

- [ ] **Step 1: Replace the whole file**

The current file already centralizes uploads in one `handleFile(file)`
function used by both the empty-state "Agregar portada" label and the
hover "Cambiar portada" label — both branches below reuse it unchanged.

```jsx
// apps/desktop/src/modules/runly.notes/components/NoteCoverBanner.jsx
import { useState } from 'react'
import { ImagePlus, Image as ImageIcon, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ImageSourceSheet, useCoarsePointer } from '@runly/ui'
import { runly } from '../../../lib/runly'
import { supabase } from '../../../lib/supabase'
import { withImageVariant } from '../../../lib/imageVariants.js'

const MAX_BANNER_BYTES = 20 * 1024 * 1024

// Cover/banner image for a note — reuses the same presign-image + runly-notes
// bucket flow as in-body images (NoteToolbar.jsx), but persists the result on
// note.cover_url instead of inserting a TipTap node.
export function NoteCoverBanner({ coverUrl, editable, noteId, token, onChange, onRemove }) {
  const [uploading, setUploading] = useState(false)
  // If the Supabase image-transform endpoint (/render/image/public/) can't
  // serve the `banner` variant, fall back to the original object URL so a
  // transform failure never leaves the cover blank. Keyed by URL so a new
  // cover retries the transform.
  const [failedUrl, setFailedUrl] = useState(null)
  const imgFallback = failedUrl === coverUrl
  const isCoarsePointer = useCoarsePointer()
  const [coverSheetOpen, setCoverSheetOpen] = useState(false)

  if (!coverUrl && !editable) return null

  async function handleFile(file) {
    if (!file || !token) return
    if (!file.type.startsWith('image/')) {
      toast.error('Selecciona un archivo de imagen valido.')
      return
    }
    if (file.size > MAX_BANNER_BYTES) {
      toast.error('La imagen no puede superar 20 MB.')
      return
    }
    setUploading(true)
    try {
      const presign = await runly.notes.presignImage(
        { fileName: file.name, mimeType: file.type, noteId },
        token,
      )
      const { error } = await supabase.storage
        .from('runly-notes')
        .uploadToSignedUrl(presign.objectKey, presign.uploadToken, file)
      if (error) throw error
      // Only persist after the upload is confirmed — never optimistically.
      onChange(presign.publicUrl)
    } catch (err) {
      toast.error(err?.message ?? 'No se pudo subir la portada.')
    } finally {
      setUploading(false)
    }
  }

  const coverSheet = (
    <ImageSourceSheet open={coverSheetOpen} onOpenChange={setCoverSheetOpen} onPickFile={handleFile} />
  )

  if (!coverUrl) {
    return (
      <div className="px-8 pt-4">
        {isCoarsePointer ? (
          <button
            type="button"
            disabled={uploading}
            onClick={() => setCoverSheetOpen(true)}
            className={[
              'inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground rounded-lg px-2.5 py-1.5 transition-colors',
              uploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted hover:text-foreground',
            ].join(' ')}
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
            Agregar portada
          </button>
        ) : (
          <label
            className={[
              'inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors',
              uploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted hover:text-foreground',
            ].join(' ')}
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
            Agregar portada
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={e => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) handleFile(file)
              }}
            />
          </label>
        )}
        {coverSheet}
      </div>
    )
  }

  return (
    <div className="relative group/cover w-full aspect-[3/1] overflow-hidden bg-muted">
      <img
        key={coverUrl}
        src={imgFallback ? coverUrl : withImageVariant(coverUrl, 'banner')}
        alt=""
        className="w-full h-full object-cover"
        draggable={false}
        onError={() => setFailedUrl(coverUrl)}
      />
      {editable && (
        <div className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-100 sm:opacity-0 sm:group-hover/cover:opacity-100 transition-opacity">
          {isCoarsePointer ? (
            <button
              type="button"
              disabled={uploading}
              onClick={() => setCoverSheetOpen(true)}
              className={[
                'flex items-center gap-1.5 text-xs font-medium bg-background/90 backdrop-blur-sm border border-border rounded-lg px-2.5 py-1.5 shadow-sm transition-colors',
                uploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted',
              ].join(' ')}
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
              Cambiar portada
            </button>
          ) : (
            <label
              className={[
                'flex items-center gap-1.5 text-xs font-medium bg-background/90 backdrop-blur-sm border border-border rounded-lg px-2.5 py-1.5 cursor-pointer shadow-sm transition-colors',
                uploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted',
              ].join(' ')}
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
              Cambiar portada
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={e => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) handleFile(file)
                }}
              />
            </label>
          )}
          <button
            onClick={onRemove}
            className="flex items-center gap-1.5 text-xs font-medium bg-background/90 backdrop-blur-sm border border-border rounded-lg px-2.5 py-1.5 shadow-sm hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Quitar
          </button>
        </div>
      )}
      {coverSheet}
    </div>
  )
}
```

- [ ] **Step 2: Manual check**

Run: `pnpm dev:frontend`. At 390px touch emulation: both the "Agregar
portada" empty state and the hover "Cambiar portada" control open the
camera/gallery sheet; either choice uploads and sets the cover. At 1440px
mouse: both open the file dialog directly, unchanged from before.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/NoteCoverBanner.jsx
git commit -m "feat(notes): offer camera vs gallery for the note cover picker on touch"
```

---

### Task 8: Full verification pass

- [ ] **Step 1: Run the full notes unit test suite**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/`
Expected: PASS (all files)

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: no new errors in the changed files.

- [ ] **Step 3: Manual QA — screenshots at 390px and 1440px, both themes (per `docs/ai-context/ui-screen-audit-checklist.md`)**

- Resize an image from all 4 corners, in and out of a table cell; confirm
  independent width/height and that the change survives a reload.
- 390px, touch emulation: toolbar image button, `/imagen`, and both cover
  triggers all open "Tomar foto" / "Elegir de galería"; each path uploads
  correctly and the temporary DOM host for the slash-command path is cleaned
  up (no leftover detached nodes).
- 1440px, mouse: all 4 entry points (toolbar, slash command, 2 cover
  triggers) open the file dialog directly — no sheet, byte-for-byte the same
  as before this plan.
- Both themes: `ImageSourceSheet` contrast is readable in both.

- [ ] **Step 4: Update `docs/TASKS.md` if it tracks notes-module work**

Add a line noting Plan B (images) is complete, with
`Verified: YYYY-MM-DD (390px + 1440px, both themes)`.
