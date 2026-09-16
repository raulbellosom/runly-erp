# Notes Editor — Mobile Image-Editing Friction Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six mobile image-editing friction points in `runly.notes`: a wrapping edit toolbar, the mobile keyboard opening unintentionally from image controls, no way to tap below a trailing image to add content, a crop modal that frequently never finishes loading, a transparent slash-command menu, and images causing layout shift as they load.

**Architecture:** All changes live in `apps/desktop/src/modules/runly.notes/` and `apps/desktop/src/lib/imageVariants.js` (frontend only, no API/DB). Pure logic (click-target predicate, cached-image predicate, the new image-variant preset) is extracted into small testable modules; UI/DOM-dependent pieces (toolbar layout, `preventDefault` wiring, the blur-up two-image render) are verified manually per `docs/ai-context/ui-screen-audit-checklist.md`.

**Tech Stack:** React, TipTap v3 (ProseMirror), `@runly/ui`, Node's built-in test runner (`node --test`).

Spec: `docs/superpowers/specs/2026-09-16-notes-mobile-image-editing-fixes-design.md`.

---

### Task 1: Compact single-row edit-mode toolbar (with keyboard-safe buttons)

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`

- [ ] **Step 1: Update the icon imports**

In `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`, replace the `lucide-react` import (currently line 3-6):

```jsx
import {
  GripVertical, Pencil, Crop as CropIcon, Check,
  PenLine, ArrowUpRight, Square, Type, ChevronDown,
} from 'lucide-react'
```

with:

```jsx
import {
  GripVertical, Pencil, Crop as CropIcon, Check,
  PenLine, ArrowUpRight, Square, Type, MoreHorizontal,
} from 'lucide-react'
```

(`ChevronDown` is dropped — it was only used by the two toolbar popover triggers being rebuilt below as icon-only buttons; `MoreHorizontal` is added for the new "⋯" menu.)

- [ ] **Step 2: Replace the edit-mode toolbar block**

Find the block starting with `{isEditing && (` and ending at its matching `)}` (currently the toolbar `<div className="flex flex-wrap items-center ...">` containing the drag handle, tool/color popovers, line-width select, Recortar, Limpiar, and Listo). Replace the entire block with:

```jsx
        {isEditing && (
          // Single row that never wraps — a wrapping multi-row toolbar used
          // to push the image itself down on narrow screens. Every button
          // also preventDefaults its pointerdown so tapping it can't shift
          // ProseMirror's selection into the document and pop the mobile
          // keyboard (see docs/superpowers/specs/2026-09-16-notes-mobile-image-editing-fixes-design.md).
          <div className="flex items-center flex-nowrap gap-1 py-1.5 px-2 bg-[hsl(var(--muted))] border border-[hsl(var(--border))] rounded-t text-xs overflow-hidden">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  title="Herramienta"
                  onPointerDown={(e) => e.preventDefault()}
                  className="flex items-center justify-center w-9 h-9 rounded shrink-0 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted-foreground)/0.1)]"
                >
                  <ActiveToolIcon className="w-4 h-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="p-1 w-36" side="bottom" align="start">
                {TOOLS.map((t) => (
                  <button
                    key={t.id}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => setTool(t.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-medium ${
                      tool === t.id
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
                    }`}
                  >
                    <t.icon className="w-3.5 h-3.5" /> {t.label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <button
                  title="Color"
                  onPointerDown={(e) => e.preventDefault()}
                  className="flex items-center justify-center w-9 h-9 rounded shrink-0 hover:bg-[hsl(var(--muted-foreground)/0.1)]"
                >
                  <span
                    className="w-5 h-5 rounded-full border-2 border-[hsl(var(--border))]"
                    style={{ backgroundColor: color === '#ffffff' ? '#f3f4f6' : color }}
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent className="p-2 w-auto" side="bottom" align="start">
                <div className="grid grid-cols-4 gap-1.5">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => setColor(c)}
                      className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-amber-500 scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c === '#ffffff' ? '#f3f4f6' : c }}
                    />
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <button
              title="Recortar"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setCropOpen(true)}
              className="flex items-center justify-center w-9 h-9 rounded shrink-0 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted-foreground)/0.1)]"
            >
              <CropIcon className="w-3.5 h-3.5" />
            </button>

            <Popover>
              <PopoverTrigger asChild>
                <button
                  title="Mas opciones"
                  onPointerDown={(e) => e.preventDefault()}
                  className="flex items-center justify-center w-9 h-9 rounded shrink-0 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted-foreground)/0.1)]"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="p-1 w-44" side="bottom" align="start">
                <div className="px-2 py-1.5 text-[11px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                  Grosor
                </div>
                <div className="px-2 pb-1.5">
                  <Select value={String(lineWidth)} onValueChange={(v) => setLineWidth(Number(v))}>
                    <SelectTrigger className="h-9 w-full px-2 py-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 6, 8].map((w) => (
                        <SelectItem key={w} value={String(w)}>
                          {w}px
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {annotations.length > 0 && (
                  <>
                    <div className="my-1 border-t border-[hsl(var(--border))]" />
                    <button
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => updateAttributes({ annotations: '[]' })}
                      className="w-full text-left text-xs text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 px-2.5 py-1.5 rounded"
                    >
                      Limpiar
                    </button>
                  </>
                )}
              </PopoverContent>
            </Popover>

            <button
              onPointerDown={(e) => e.preventDefault()}
              onClick={exitEditMode}
              className="ml-auto flex items-center gap-1 px-3 h-9 rounded font-semibold bg-amber-500 hover:bg-amber-600 text-white shrink-0"
            >
              <Check className="w-3.5 h-3.5" /> Listo
            </button>
          </div>
        )}
```

Note: the drag/"Mover" handle (`onHandlePointerDown`/`onHandlePointerMove`/`onHandlePointerUp`) is intentionally dropped from this toolbar — those three functions stay in the file because the view-mode grip handle (further down, `editable && mode === 'view'`) still uses them unchanged.

- [ ] **Step 3: Syntax-check the file**

Run: `npx eslint apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`
Expected: no output (clean) — this also catches the removed `ChevronDown` import if it's still referenced anywhere, and any JSX syntax error from the replacement.

- [ ] **Step 4: Manual check**

Run `pnpm dev:frontend`, open a note, insert/select an image, tap "Editar imagen". At 390px width: the toolbar is a single row (Herramienta, Color, Recortar, ⋯, Listo) that never wraps. Tap "⋯": Grosor (line width select) and, once an annotation exists, "Limpiar" both work. Tap "Listo": exits edit mode. Confirm the image itself never gets pushed down by a wrapping bar.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx
git commit -m "feat(notes): compact the image edit-mode toolbar to a single non-wrapping row"
```

---

### Task 2: Stop "Editar imagen" from stealing the keyboard

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`

- [ ] **Step 1: Add `preventDefault` to the "Editar imagen" button**

Find (in the `editable && mode === 'view'` block):

```jsx
            <button
              onClick={() => setMode('edit')}
              className="flex items-center gap-1.5 text-xs font-medium bg-[hsl(var(--background)/0.9)] backdrop-blur-sm border border-[hsl(var(--border))] rounded-lg px-2.5 py-1.5 shadow-sm hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Editar imagen
            </button>
```

Replace with:

```jsx
            <button
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setMode('edit')}
              className="flex items-center gap-1.5 text-xs font-medium bg-[hsl(var(--background)/0.9)] backdrop-blur-sm border border-[hsl(var(--border))] rounded-lg px-2.5 py-1.5 shadow-sm hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Editar imagen
            </button>
```

(The 4 corner resize handles already call `e.preventDefault()` inside `onResizePointerDown` — verified, no change needed there. The view-mode grip/drag handle already calls `e.preventDefault()` inside `onHandlePointerDown` too.)

- [ ] **Step 2: Manual check**

On a touch-emulated 390px viewport: tap "Editar imagen" directly (without first tapping the image). Confirm the on-screen keyboard never opens. Then pick the **Texto** tool and tap the image: confirm the keyboard DOES open (expected, for typing the annotation), and that typing + blurring the input commits the text annotation normally.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx
git commit -m "fix(notes): prevent Editar imagen from moving the caret and opening the keyboard"
```

---

### Task 3: Tap-below-content focuses the end of the document

**Files:**
- Create: `apps/desktop/src/modules/runly.notes/lib/clickBelowContent.js`
- Test: `apps/desktop/src/modules/runly.notes/lib/__tests__/click-below-content.test.js`
- Modify: `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx`

- [ ] **Step 1: Write the failing test**

```js
// apps/desktop/src/modules/runly.notes/lib/__tests__/click-below-content.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldFocusDocumentEnd } from '../clickBelowContent.js'

test('shouldFocusDocumentEnd: true when the click target IS the container (blank background)', () => {
  const container = {}
  assert.equal(shouldFocusDocumentEnd(container, container), true)
})

test('shouldFocusDocumentEnd: false when the click target is a node rendered inside the container', () => {
  const container = {}
  const innerNode = {}
  assert.equal(shouldFocusDocumentEnd(innerNode, container), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/click-below-content.test.js`
Expected: FAIL — `Cannot find module '../clickBelowContent.js'`

- [ ] **Step 3: Write the implementation**

```js
// apps/desktop/src/modules/runly.notes/lib/clickBelowContent.js
// Pure predicate for NoteEditor.jsx's scroll-container click handler: should
// a click at this DOM target focus the end of the document? True only when
// the click landed on the container's own background (blank space below the
// last block), not on any node rendered inside it — otherwise every
// ordinary click inside the editor would also refocus to the end.
export function shouldFocusDocumentEnd(target, currentTarget) {
  return target === currentTarget
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/click-below-content.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire it into `NoteEditor.jsx`**

Add the import near the other `lib/` imports in `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx`:

```js
import { shouldFocusDocumentEnd } from '../lib/clickBelowContent.js'
```

Inside `NoteEditorSurface`, add an editor ref near the other refs (after `const containerRef = useRef(null)`):

```js
  const editorInstanceRef = useRef(null)
```

Update the `onCreate` prop on `<EditorProvider>` (currently `onCreate={seedIfNeeded}`) to also capture the editor instance:

```jsx
      onCreate={(props) => {
        editorInstanceRef.current = props.editor
        seedIfNeeded(props)
      }}
```

Add a click handler function above the `return` statement of `NoteEditorSurface`:

```js
  function handleContainerClick(e) {
    if (shouldFocusDocumentEnd(e.target, e.currentTarget)) {
      editorInstanceRef.current?.commands.focus('end')
    }
  }
```

Find the return block's scrollable branch:

```jsx
      {scrollable ? (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {editorProvider}
        </div>
      ) : (
        editorProvider
      )}
```

Replace with:

```jsx
      {scrollable ? (
        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
          onClick={readOnly ? undefined : handleContainerClick}
        >
          {editorProvider}
        </div>
      ) : (
        editorProvider
      )}
```

- [ ] **Step 6: Syntax-check the file**

Run: `npx eslint apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx`
Expected: no output (clean).

- [ ] **Step 7: Manual check**

Create a note whose last block is an image, small enough that there's visible blank page space below it in the viewport. Tap that blank space: the cursor moves to the end of the document (into the existing trailing empty paragraph) and typing adds a new paragraph below the image. Confirm clicking on an existing paragraph/image (not blank background) behaves exactly as before (no unexpected refocus-to-end).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/clickBelowContent.js \
        apps/desktop/src/modules/runly.notes/lib/__tests__/click-below-content.test.js \
        apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx
git commit -m "feat(notes): tapping blank space below note content focuses the document end"
```

---

### Task 4: Crop modal — don't rely solely on `onLoad` for a possibly-cached image

**Files:**
- Create: `apps/desktop/src/modules/runly.notes/lib/imageLoadState.js`
- Test: `apps/desktop/src/modules/runly.notes/lib/__tests__/image-load-state.test.js`
- Modify: `apps/desktop/src/modules/runly.notes/components/ImageCropModal.jsx`

- [ ] **Step 1: Write the failing test**

```js
// apps/desktop/src/modules/runly.notes/lib/__tests__/image-load-state.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getLoadedNaturalSize } from '../imageLoadState.js'

test('getLoadedNaturalSize: returns the size when the image is already complete with real dimensions', () => {
  assert.deepEqual(
    getLoadedNaturalSize({ complete: true, naturalWidth: 800, naturalHeight: 600 }),
    { w: 800, h: 600 },
  )
})

test('getLoadedNaturalSize: returns null when not yet complete', () => {
  assert.equal(getLoadedNaturalSize({ complete: false, naturalWidth: 800, naturalHeight: 600 }), null)
})

test('getLoadedNaturalSize: returns null when complete but naturalWidth is 0 (broken image)', () => {
  assert.equal(getLoadedNaturalSize({ complete: true, naturalWidth: 0, naturalHeight: 0 }), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/image-load-state.test.js`
Expected: FAIL — `Cannot find module '../imageLoadState.js'`

- [ ] **Step 3: Write the implementation**

```js
// apps/desktop/src/modules/runly.notes/lib/imageLoadState.js
// Pure predicate used by ImageCropModal.jsx (and anywhere else rendering an
// <img> whose onLoad might fire before React attaches the listener, because
// the image was already rendered elsewhere on the page and is warm in the
// browser cache). Given the DOM image element's own loaded-state fields,
// returns the natural size to store, or null if it isn't loaded yet.
export function getLoadedNaturalSize({ complete, naturalWidth, naturalHeight }) {
  if (!complete || !naturalWidth) return null
  return { w: naturalWidth, h: naturalHeight }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/desktop/src/modules/runly.notes/lib/__tests__/image-load-state.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire it into `ImageCropModal.jsx`**

Add the import near the top of `apps/desktop/src/modules/runly.notes/components/ImageCropModal.jsx`:

```js
import { getLoadedNaturalSize } from '../lib/imageLoadState.js'
```

Add an image ref near the other refs (after `const gestureRef = useRef(null)`):

```js
  const imgElRef = useRef(null) // the <img> DOM node — checked for an already-loaded image on open
```

Add an effect after the existing `areaSize` effect (which ends around `}, [open, viewfinderRatioFrac, effNat?.w, effNat?.h])`):

```js
  // A cached image (already displayed inline in the note before this modal's
  // own <img> mounts) can finish loading before onLoad's listener attaches,
  // so `nat` would otherwise never get set. Check synchronously whenever the
  // modal opens or the image changes, in addition to keeping onLoad below
  // for the not-yet-cached case.
  useEffect(() => {
    if (!open) return
    const size = getLoadedNaturalSize(imgElRef.current ?? {})
    if (size) setNat(size)
  }, [open, src])
```

Find the `<img>` element inside the viewfinder (currently):

```jsx
              <img
                src={src}
                alt=""
                draggable={false}
                onLoad={(e) => setNat({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
                style={imgStyle}
              />
```

Replace with:

```jsx
              <img
                ref={imgElRef}
                src={src}
                alt=""
                draggable={false}
                onLoad={(e) => setNat({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
                style={imgStyle}
              />
```

- [ ] **Step 6: Syntax-check the file**

Run: `npx eslint apps/desktop/src/modules/runly.notes/components/ImageCropModal.jsx`
Expected: no output (clean).

- [ ] **Step 7: Manual check**

Upload a fresh image in a note, then immediately tap "Recortar": the crop viewfinder shows the image and sizes correctly the very first time (no blank square). Repeat on an image that's been visible on screen for a while. Repeat again after closing and reopening the crop modal on the same image.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/imageLoadState.js \
        apps/desktop/src/modules/runly.notes/lib/__tests__/image-load-state.test.js \
        apps/desktop/src/modules/runly.notes/components/ImageCropModal.jsx
git commit -m "fix(notes): crop modal detects an already-loaded (cached) image on open"
```

---

### Task 5: Slash-command menu — use the project's glass background

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/SlashCommandMenu.jsx`

- [ ] **Step 1: Swap the empty-state background**

Find:

```jsx
      <div className="relative z-50 w-64 rounded-lg border border-border bg-popover shadow-lg p-3 text-xs text-muted-foreground">
        Sin resultados
      </div>
```

Replace with:

```jsx
      <div className="relative z-50 w-64 rounded-xl glass-strong p-3 text-xs text-muted-foreground">
        Sin resultados
      </div>
```

- [ ] **Step 2: Swap the results-list background**

Find:

```jsx
    <div className="relative z-50 w-64 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg p-1">
```

Replace with:

```jsx
    <div className="relative z-50 w-64 max-h-72 overflow-y-auto rounded-xl glass-strong p-1">
```

- [ ] **Step 3: Syntax-check the file**

Run: `npx eslint apps/desktop/src/modules/runly.notes/components/SlashCommandMenu.jsx`
Expected: no output (clean).

- [ ] **Step 4: Manual check**

Open the `/` menu over an image (so there's visible content behind it) in both light and dark theme. Confirm the menu background is fully opaque/frosted, matching the look of the "Tabla" options popover — no content bleeds through. Check both the populated results list and, by typing something that matches nothing (e.g. `/zzz`), the "Sin resultados" empty state.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/SlashCommandMenu.jsx
git commit -m "fix(notes): give the slash-command menu the same glass background as other floating menus"
```

---

### Task 6: Persist `aspectRatio` at image insert time

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/lib/noteImageUpload.js`

- [ ] **Step 1: Compute and pass `aspectRatio` in `uploadAndInsertNoteImage`**

Find (in `apps/desktop/src/modules/runly.notes/lib/noteImageUpload.js`):

```js
    const width = computeInitialImageWidthPct({
      naturalWidth: naturalSize.naturalWidth,
      naturalHeight: naturalSize.naturalHeight,
      columnWidthPx: getContentColumnWidthPx(editor),
    })
    editor.chain().focus().insertContent({
      type: 'image',
      attrs: { src: presign.publicUrl, alt: file.name, width },
    }).run()
```

Replace with:

```js
    const width = computeInitialImageWidthPct({
      naturalWidth: naturalSize.naturalWidth,
      naturalHeight: naturalSize.naturalHeight,
      columnWidthPx: getContentColumnWidthPx(editor),
    })
    // Stored immediately (not only on corner-resize) so the image's frame is
    // sized correctly from its very first render — no layout shift while
    // waiting for the full-resolution <img> to load.
    const aspectRatio = naturalSize.naturalWidth && naturalSize.naturalHeight
      ? naturalSize.naturalWidth / naturalSize.naturalHeight
      : null
    editor.chain().focus().insertContent({
      type: 'image',
      attrs: { src: presign.publicUrl, alt: file.name, width, aspectRatio },
    }).run()
```

- [ ] **Step 2: Syntax-check the file**

Run: `npx eslint apps/desktop/src/modules/runly.notes/lib/noteImageUpload.js`
Expected: no output (clean).

- [ ] **Step 3: Manual check**

Upload a new image on a throttled connection (devtools network throttling). Confirm the image's box is the correct final size immediately (before the image itself has finished downloading) — no shift once it loads.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/lib/noteImageUpload.js
git commit -m "feat(notes): store the image aspect ratio at insert time to prevent layout shift"
```

---

### Task 7: `lqip` image-variant preset

**Files:**
- Modify: `apps/desktop/src/lib/imageVariants.js`
- Modify: `apps/desktop/src/lib/__tests__/imageVariants.test.js`

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/src/lib/__tests__/imageVariants.test.js`:

```js
test('rewrites a public object URL using the lqip preset (tiny width-only placeholder)', () => {
  const result = withImageVariant(PUBLIC_URL, 'lqip');
  assert.equal(
    result,
    'https://supabase.racoondevs.com/storage/v1/render/image/public/runly-notes/notes/u1/n1/123-cover.jpg?width=24&quality=30',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/desktop/src/lib/__tests__/imageVariants.test.js`
Expected: FAIL — result URL has no `width=24&quality=30` (the `lqip` preset doesn't exist yet, so `withImageVariant` returns the original URL unchanged).

- [ ] **Step 3: Add the preset**

In `apps/desktop/src/lib/imageVariants.js`, add to `IMAGE_VARIANT_PRESETS` (after `content`):

```js
  content: { width: 1600, quality: 80 },
  // Tiny, heavily-compressed version used as a blurred loading placeholder
  // for arbitrary-aspect content images (note body images) — no forced
  // height, same aspect-preserving shape as `content`, just far smaller.
  lqip: { width: 24, quality: 30 },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/desktop/src/lib/__tests__/imageVariants.test.js`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/imageVariants.js apps/desktop/src/lib/__tests__/imageVariants.test.js
git commit -m "feat(images): add lqip variant preset for blurred loading placeholders"
```

---

### Task 8: Blur-up image loading in `ImageAnnotationOverlay.jsx`

**Files:**
- Modify: `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`

- [ ] **Step 1: Add the `fullLoaded` state**

Find:

```js
  const [liveWidthPct, setLiveWidthPct] = useState(null) // resize drag preview
  const [liveAspectRatio, setLiveAspectRatio] = useState(null) // resize drag preview
```

Replace with:

```js
  const [liveWidthPct, setLiveWidthPct] = useState(null) // resize drag preview
  const [liveAspectRatio, setLiveAspectRatio] = useState(null) // resize drag preview
  const [fullLoaded, setFullLoaded] = useState(false) // full-resolution <img> onLoad fired
```

- [ ] **Step 2: Compute the `lqip` source**

Find:

```js
  const src = withImageVariant(node.attrs.src, 'content')
```

Replace with:

```js
  const src = withImageVariant(node.attrs.src, 'content')
  const lqipSrc = withImageVariant(node.attrs.src, 'lqip')
```

- [ ] **Step 3: Render two stacked `<img>` layers instead of one**

Find:

```jsx
          <div ref={rotWrapRef} style={rotWrapStyle}>
            <img
              src={src}
              alt={node.attrs.alt ?? ''}
              style={imgStyle}
              draggable={false}
              onLoad={(e) => setNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
            />
          </div>
```

Replace with:

```jsx
          <div ref={rotWrapRef} style={rotWrapStyle}>
            {/* Tiny blurred placeholder — loads almost instantly (a few
                hundred bytes) and shares the full image's aspect ratio, so
                it corrects the frame size for legacy images that have no
                stored aspectRatio, well before the full image arrives. */}
            <img
              src={lqipSrc}
              alt=""
              aria-hidden="true"
              draggable={false}
              onLoad={(e) => setNatural((prev) => prev ?? { w: e.target.naturalWidth, h: e.target.naturalHeight })}
              style={{
                ...imgStyle,
                filter: 'blur(16px)',
                transform: imgStyle.transform ? `${imgStyle.transform} scale(1.15)` : undefined,
              }}
            />
            <img
              src={src}
              alt={node.attrs.alt ?? ''}
              draggable={false}
              onLoad={(e) => { setNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight }); setFullLoaded(true) }}
              style={{
                ...imgStyle,
                opacity: fillSize && fullLoaded ? 1 : 0,
                transition: 'opacity 200ms ease',
              }}
            />
          </div>
```

- [ ] **Step 4: Syntax-check the file**

Run: `npx eslint apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`
Expected: no output (clean).

- [ ] **Step 5: Manual check**

With devtools network throttling (e.g. "Slow 4G"), open a note with several images. Confirm each shows a blurred low-quality version almost immediately, then crossfades to the sharp version once it loads, with no layout shift either time. Reload the note and confirm an "old" image (inserted before this change, no stored `aspectRatio`) also shows the blur-up behavior and settles to the correct size quickly (via the lqip's own `onLoad` populating `natural`). Confirm this behaves identically for images inside a table cell and in the read-only/public note view.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx
git commit -m "feat(notes): blur-up image loading with a low-quality placeholder"
```

---

### Task 9: Full verification pass

- [ ] **Step 1: Run the full notes + imageVariants unit test suites**

Run:
```bash
node --test "apps/desktop/src/modules/runly.notes/lib/__tests__/*.test.js"
node --test apps/desktop/src/lib/__tests__/imageVariants.test.js
```
Expected: PASS (all files)

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Run a production build**

Run: `pnpm --filter @runly/desktop exec vite build --mode development` (or `pnpm build` for the full workspace)
Expected: builds cleanly, no import/JSX errors.

- [ ] **Step 4: Manual QA — screenshots at 390px and 1440px, both themes (per `docs/ai-context/ui-screen-audit-checklist.md`)**

- Edit-mode toolbar: single row, never wraps; Herramienta/Color/Recortar/⋯/Listo all work.
- Ordinary image interaction (select, edit, Recortar, resize) never opens the keyboard; the Texto tool still does, and typing + blurring still commits the annotation.
- Tapping blank space below a trailing image focuses the end of the document and lets you type immediately.
- Crop modal shows the image and sizes correctly on the very first open, for a fresh upload and for an already-visible image.
- `/` slash-command menu has a fully opaque glass background in both themes, populated and "Sin resultados" states.
- Images blur-up smoothly with no layout shift, for both new and pre-existing images, on a throttled connection.

- [ ] **Step 5: Update `docs/TASKS.md` if it tracks notes-module work**

Add a line under the `atlas.notes` section noting these six mobile image-editing fixes are code-complete, with `Verified: YYYY-MM-DD (node --test + pnpm lint + vite build clean; manual QA pending)` if manual QA hasn't been run yet, or the full verified date if it has.
