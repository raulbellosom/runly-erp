# Notes Editor — Mobile Image-Editing Friction Fixes

- Status: Approved (design)
- Date: 2026-09-16
- Module: `runly.notes` (frontend only)
- Author: Raul Belloso Medina

## Problem

Field feedback on the `runly.notes` editor's image-editing experience on
phones, reported after the tables/images/mobile-controls work
(`docs/superpowers/specs/2026-09-16-notes-tables-images-mobile-design.md`)
shipped:

1. The image-editing toolbar (drag handle, tool picker, color, line width,
   Recortar, Limpiar, Listo) wraps onto 2-3 rows on narrow screens, pushing
   the image itself down and eating most of the visible screen.
2. Tapping the image or its controls (e.g. "Editar imagen") opens the mobile
   on-screen keyboard even when the user has no intention of typing.
   Dismissing that keyboard (by tapping elsewhere) then loses whatever
   editing context the user was in.
3. When an image is the last thing in a note, tapping in the blank space
   below it does nothing — there is no way to place the cursor there and
   press Enter to add content underneath.
4. The crop modal ("Recortar imagen") frequently opens to a blank viewfinder
   that never finishes loading, for effectively every image, not just ones
   viewed in a prior session.
5. The `/` slash-command menu renders with no opaque/glass background —
   underlying content (e.g. an image) shows through it, unlike every other
   floating menu in the app.
6. Images visibly pop in and shift the surrounding content around as they
   load, especially noticeable when several images are on screen at once.

Root causes:

- **1 (toolbar wrapping):** the edit-mode toolbar in
  `components/ImageAnnotationOverlay.jsx:442-541` is a `flex-wrap` row with 8+
  controls (drag handle, tool popover, color popover, line-width select,
  Recortar, Limpiar, Listo) with no responsive collapsing — it always renders
  every control inline.
- **2 (unwanted keyboard):** the image node (`AnnotatableImage.jsx`) is an
  `atom: true` block inside TipTap's `contentEditable` document. None of the
  image's control buttons (`onImageClick`, the "Editar imagen" button at
  `ImageAnnotationOverlay.jsx:598-603`, the edit-mode toolbar's buttons) call
  `preventDefault()` on `pointerdown`/`mousedown` the way `NoteToolbar.jsx`'s
  `ToolbarButton` already does (`onMouseDown={e => { e.preventDefault(); ... }}`,
  `NoteToolbar.jsx:38`). Without that, tapping near/on the image can still
  shift ProseMirror's text selection into the surrounding document, and
  mobile browsers open the on-screen keyboard whenever the selection lands
  inside an editable region — regardless of whether the user meant to type.
- **3 (no click-below-content):** the editable ProseMirror element gets
  `min-h-full` (`NoteEditor.jsx:380`), relying on its scroll-container
  ancestor (`NoteEditor.jsx:437`, `flex-1 min-h-0 overflow-y-auto`) to be
  tall enough for that percentage to produce real fillable space, and there
  is no click handler anywhere that maps "clicked in the container but not on
  any node" to focusing the end of the document. There's already a
  `TrailingNode` extension (`lib/extensions/TrailingNode.js`) that guarantees
  an empty trailing paragraph exists after the image — but with nothing
  translating a tap on the surrounding blank area into a focus command, that
  paragraph is only reachable if the user's tap lands exactly on its own
  (typically tiny) rendered line box.
- **4 (blank crop modal):** `ImageCropModal.jsx` only learns the image's
  natural size (`nat`) from the `<img onLoad>` event
  (`ImageCropModal.jsx:299`, `setNat`). By the time a user taps "Recortar" on
  any image, that image is already rendered inline in the note via its own
  `<img>` tag (`ImageAnnotationOverlay.jsx`) using the exact same URL
  (`ImageCropModal` receives the same `src` — see
  `ImageAnnotationOverlay.jsx:649`). That makes the browser cache warm for
  essentially every image before the crop modal's own `<img>` ever mounts, so
  the `load` event has frequently already fired (or the image is already
  `.complete`) before React attaches the `onLoad` listener — `nat` never
  gets set, the viewfinder never sizes itself, and the modal stays blank.
- **5 (transparent slash menu):** `SlashCommandMenu.jsx:32,39` hand-rolls its
  own container background (`border border-border bg-popover shadow-lg`)
  instead of reusing the project's `.glass-strong` utility class
  (`apps/desktop/src/styles.css:253-258`) that every other floating menu
  uses — e.g. `@runly/ui`'s `PopoverContent`
  (`packages/ui/src/components/Popover.jsx:27`, `'z-50 rounded-xl
  glass-strong shadow-lg outline-none'`). `.glass-strong` bundles the
  `backdrop-filter: blur()` that a translucent-by-design surface needs to
  read as "frosted glass" rather than "broken/see-through" — without it, the
  plain `bg-popover` token (itself translucent by design in this app's glass
  system) shows whatever is underneath.
- **6 (image pop-in/shift):** `ImageAnnotationOverlay.jsx`'s `frameStyle`
  (`ImageAnnotationOverlay.jsx:394-398` as of the tables/images/mobile-controls
  work) only knows the image's aspect ratio once either the stored
  `aspectRatio` attribute is set (currently only written by the corner-resize
  handles, not at insert time) or the full-resolution `<img>` fires `onLoad`
  and populates `natural`. Until one of those happens, the frame falls back to
  a 1:1 (or crop-derived) placeholder ratio, then snaps to the real ratio the
  moment the full image finishes downloading — visibly shifting everything
  below it. `noteImageUpload.js` already computes the natural dimensions
  before upload (`getImageNaturalSize`, used today only to pick the initial
  width scale) but never persists them as `aspectRatio`, so even brand-new
  images pay this cost.

## Goals

1. The image edit-mode toolbar never wraps, regardless of screen width.
2. Ordinary image interaction (selecting it, opening edit mode, using
   Recortar, resizing) never opens the mobile keyboard. The keyboard only
   opens when the user deliberately picks the **Texto** annotation tool and
   taps the image to place a text annotation, exactly as today.
3. When there's blank space below a note's content (including below a
   trailing image), tapping anywhere in it moves the cursor to the end of
   the document, so the user can immediately start typing new content below
   the last image.
4. The crop modal reliably shows the image and sizes its viewfinder
   correctly on the first open, whether the image was just uploaded or is
   already cached.
5. The `/` slash-command menu renders with the same opaque glass background
   as every other floating menu in the app.
6. Images never visibly shift surrounding content as they load — new images
   reserve their exact space immediately, and a blurred low-quality preview
   fills the frame for any image (new or pre-existing) while the full
   resolution version is still loading.

## Non-goals

- No support for placing the cursor to the **side** of a narrower image in
  the same row — that requires a multi-column/side-by-side layout capability
  and is being designed separately as its own project.
- No redesign of the annotation tools themselves (pen/arrow/rect/text
  behavior, colors, line widths) — only how their controls are laid out and
  triggered.
- No change to the 4-corner image resize handles or `aspectRatio` behavior
  shipped in the tables/images/mobile-controls work — this spec only touches
  the edit-mode toolbar, focus/keyboard handling, click-below-content, and
  the crop modal's load timing.
- No change to desktop (fine-pointer) behavior for any of the toolbar,
  keyboard, crop, or blur-up fixes above, beyond what naturally falls out of
  them (which are pointer-type-agnostic — a mouse click on an image control
  was never going to move the caret into the document either, but the
  explicit `preventDefault()` makes that guarantee instead of relying on
  incidental browser behavior).
- No exhaustive audit of every other place in the app that might have the
  same "translucent token without `.glass-strong`/backdrop-blur" bug as the
  slash-command menu — only that one instance is fixed here. A broader sweep
  is a separate follow-up if wanted.
- No new backend/storage infrastructure for the low-quality image preview —
  it reuses the existing Supabase image-transform endpoint
  (`apps/desktop/src/lib/imageVariants.js`) with a new, smaller size preset,
  not a separately generated/stored thumbnail asset.
- No true blurhash/dominant-color placeholder algorithm — the "low quality"
  preview is simply a much smaller transformed version of the same image,
  blurred via CSS.

## Design

### 1 — Compact single-row edit-mode toolbar

`ImageAnnotationOverlay.jsx`'s edit-mode toolbar (currently
`ImageAnnotationOverlay.jsx:442-541`) is restructured into a single row that
never wraps:

```
[Herramienta ▾] [Color ▾] [Recortar] ... [⋯] [Listo]
```

- **Herramienta** (tool picker: pen/arrow/rect/text) and **Color** stay as
  `Popover` triggers — same interaction as today, just always inline.
- **Recortar** stays a direct button (opens `ImageCropModal` as today).
- **⋯** is a new `Popover` (matching the existing `TableMenuItem`-style
  dropdown pattern in `NoteToolbar.jsx`) containing:
  - **Grosor** (the line-width `Select`, currently inline at
    `ImageAnnotationOverlay.jsx:508-519`)
  - **Limpiar** (clear annotations, currently the conditional button at
    `ImageAnnotationOverlay.jsx:527-534`)
- **Listo** always stays visible on the far right (unchanged behavior:
  `exitEditMode`).
- **Mover** (the drag handle at `ImageAnnotationOverlay.jsx:443-453`) is
  removed from the edit-mode toolbar entirely. Reordering the image is still
  available via the grip handle already shown in view mode
  (`ImageAnnotationOverlay.jsx:604-614`, `editable && mode === 'view'`) — a
  user who wants to reorder taps "Listo" first, then drags, exactly like
  reordering any other block.

The row uses `flex items-center gap-1 flex-nowrap` (no `flex-wrap`), with
icon-only buttons sized like `NoteToolbar.jsx`'s `ToolbarButton` so the whole
row comfortably fits a 360px-wide screen.

### 2 — Stop unintended keyboard/selection theft from image controls

Every interactive control rendered by `ImageAnnotationOverlay.jsx` that
doesn't need to move the ProseMirror selection gets an `onPointerDown` (or
`onMouseDown`, matching whichever event type the element already listens on)
handler that calls `e.preventDefault()` before its `onClick` fires — the same
pattern `NoteToolbar.jsx:38`'s `ToolbarButton` already uses:

- The **"Editar imagen"** button (`ImageAnnotationOverlay.jsx:598-603`).
- The edit-mode toolbar's **Herramienta**, **Color**, **Recortar**, **⋯**,
  and **Listo** controls (Task 1's rebuilt toolbar).
- The 4 corner resize handles (already call `e.preventDefault()` in
  `onResizePointerDown` — verified as already correct, no change needed
  there).

This leaves exactly one intentional path to the keyboard: picking the
**Texto** tool and tapping the image, which still opens the existing
`textInput` UI (`ImageAnnotationOverlay.jsx:169-182`) and its `autoFocus`
input — unchanged, since that keyboard opening is deliberate and wanted.

### 3 — Tap-below-content focuses the end of the document

`NoteEditorSurface` (`NoteEditor.jsx`) adds a click handler on the scrollable
container (`NoteEditor.jsx:437`, the `flex-1 min-h-0 overflow-y-auto` div)
that checks whether the click's target is the container itself (i.e. the
click landed on empty background, not on any rendered node inside the
editor) and if so calls `editor.commands.focus('end')`:

```jsx
function handleContainerClick(e, editor) {
  if (e.target === e.currentTarget) editor?.commands.focus('end')
}
```

For this to have any blank area to catch clicks in, the scroll container
must actually extend to fill the available viewport height even when
content is short — `NoteEditor.jsx:380`'s existing `min-h-full` on the
ProseMirror element only helps if its containing chain reliably resolves a
real pixel height; this fix makes that explicit by also giving the outer
`flex-1 min-h-0 overflow-y-auto` container (`NoteEditor.jsx:437`) enough
presence to register the click (it already has real dimensions from the
flex layout — the change is only adding the click handler, not new CSS
sizing, since the container already occupies the available space).

When content is taller than the viewport (e.g. a very tall trailing image),
there is no extra blank background below it to catch a click on — the
existing `TrailingNode`-guaranteed empty paragraph sits immediately after
the image and is reached by scrolling to it and tapping directly, unchanged
from today. This spec's fix specifically targets the common case from the
bug report: a trailing image with blank page space below it within the
viewport.

### 4 — Crop modal: don't rely solely on `onLoad` for a possibly-cached image

`ImageCropModal.jsx`'s `<img>` (`ImageCropModal.jsx:299`,
`onLoad={(e) => setNat(...)}`) gets a companion check that runs when the
modal opens (or `src` changes): if the image element is already loaded
(`img.complete && img.naturalWidth > 0`), set `nat` immediately instead of
waiting for a `load` event that may never fire because it already happened
before the listener was attached.

```js
// On the <img> ref, checked on mount/src-change AND still handled by
// onLoad for the not-yet-cached case:
function checkAlreadyLoaded(imgEl) {
  if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
    setNat({ w: imgEl.naturalWidth, h: imgEl.naturalHeight })
  }
}
```

Wired via a `ref` callback (or a `useEffect` keyed on `[open, src]` that
reads a ref) rather than replacing the existing `onLoad` handler, so both
the already-loaded and the freshly-loading cases are covered.

### 5 — Slash-command menu: use the project's glass system

`SlashCommandMenu.jsx`'s two container `<div>`s (the populated-results list
at line 39 and the "Sin resultados" empty state at line 32) replace
`border border-border bg-popover shadow-lg` with `glass-strong` — matching
`@runly/ui`'s `PopoverContent` exactly (`rounded-xl glass-strong shadow-lg`).
`glass-strong` already includes the border and shadow, so those utility
classes are dropped as redundant; `rounded-lg` becomes `rounded-xl` to match
the same convention. No other structural change — this is a class-list swap,
not a rewrite of the component.

### 6 — Blur-up image loading, no layout shift

Two independent pieces:

**a) Persist `aspectRatio` at insert time.** `noteImageUpload.js`'s
`uploadAndInsertNoteImage` already computes `naturalSize` via
`getImageNaturalSize(file)` before calling `editor.chain().insertContent(...)`
(`noteImageUpload.js:67-75`). That same call adds
`aspectRatio: naturalSize.naturalWidth / naturalSize.naturalHeight` (only
when both are truthy) to the inserted node's `attrs`, alongside `width`. This
means every newly-inserted image carries its correct aspect ratio from its
very first render — `ImageAnnotationOverlay.jsx`'s `frameStyle` (Design 2 of
the tables/images/mobile-controls spec) already prefers
`node.attrs.aspectRatio` over the natural-size fallback, so no changes are
needed there beyond this one new attribute being populated earlier.

**b) Blurred low-quality placeholder for everyone else** (images inserted
before this attribute existed, and the brief window before any image's full
resolution arrives):

- `apps/desktop/src/lib/imageVariants.js` gets a new preset, e.g.
  `lqip: { width: 24, quality: 30 }` (no forced height, same
  aspect-preserving shape as the existing `content` preset, just far
  smaller/lower-quality) — no backend change, this only adds another
  `IMAGE_VARIANT_PRESETS` entry consumed by the existing
  `withImageVariant(url, variant)` URL-rewriter.
- `ImageAnnotationOverlay.jsx` renders two stacked `<img>` elements inside
  the existing frame `<div>` (`ImageAnnotationOverlay.jsx:544` area) instead
  of one:
  1. A `lqip`-variant `<img>`, `aria-hidden`, styled with a CSS blur filter
     and a slight `scale(1.1)` (to hide the blurred edge halo), positioned to
     fill the frame. Loads almost immediately (a few hundred bytes).
  2. The existing full-resolution `<img>` on top, starting at `opacity: 0`
     and transitioning to `opacity: 1` once its `onLoad` fires (CSS
     `transition-opacity`), so the sharp image visibly crossfades in over the
     blurred one rather than popping in abruptly.
- The `lqip` image's `onLoad` ALSO calls `setNatural(...)` (the same setter
  the full image's `onLoad` already calls) — since it loads first and shares
  the same aspect ratio, this lets `effNat`/`frameStyle` correct themselves
  within a frame or two even for legacy images that have no stored
  `aspectRatio` attribute at all, instead of waiting for the full-resolution
  image.

This applies everywhere `ImageAnnotationOverlay` renders (it's the sole
NodeView for the image node type), so both the editable note view and the
read-only/public note view get the fix from one implementation point.

## Components / files

Changed:

- `apps/desktop/src/modules/runly.notes/components/ImageAnnotationOverlay.jsx`
  (Design 1, 2, 6b)
- `apps/desktop/src/modules/runly.notes/components/NoteEditor.jsx` (Design 3)
- `apps/desktop/src/modules/runly.notes/components/ImageCropModal.jsx`
  (Design 4)
- `apps/desktop/src/modules/runly.notes/components/SlashCommandMenu.jsx`
  (Design 5)
- `apps/desktop/src/modules/runly.notes/lib/noteImageUpload.js` (Design 6a)
- `apps/desktop/src/lib/imageVariants.js` (Design 6b — new `lqip` preset)

No new files, no new `@runly/ui` components, no backend/API/Prisma changes.

## Data / compatibility

- `aspectRatio` is an existing node attribute (added in the
  tables/images/mobile-controls work) — Design 6a just populates it at one
  more call site (insert time, not only corner-resize time). No schema
  change, no migration.
- The `lqip` variant preset is a pure URL-parameter addition to an existing,
  already-public image-transform endpoint — no new stored data.
- All six fixes are presentational/interaction changes — no stored note
  content changes shape or meaning beyond the pre-existing `aspectRatio`
  attribute now sometimes being populated earlier.

## Testing

Node's built-in test runner (`node --test`), matching repo convention. Pure
logic only; DOM/TipTap/touch/keyboard interaction is verified manually.

- `handleContainerClick`-equivalent pure predicate (extracted so it's
  testable without mounting the editor): given `{ target, currentTarget }`,
  returns whether the click should focus the document end.
- `checkAlreadyLoaded`-equivalent pure predicate: given
  `{ complete, naturalWidth, naturalHeight }`, returns the `nat` value it
  should produce (or `null` if not yet loaded).
- `withImageVariant(url, 'lqip')` — extend the existing variant tests to
  cover the new preset the same way `content`/`banner`/etc. are covered.

Manual QA (per `docs/ai-context/ui-screen-audit-checklist.md`), 390px and
1440px, both themes:

- Enter edit mode on an image on a 390px-wide viewport: toolbar stays a
  single row, never wraps; Herramienta/Color/Recortar are directly tappable;
  "⋯" opens Grosor + Limpiar; Listo exits.
- On a touch-emulated viewport, tap "Editar imagen", then tap each toolbar
  control in turn (excluding Texto): confirm the on-screen keyboard never
  opens. Pick the Texto tool and tap the image: confirm the keyboard opens
  as expected and typing + blurring commits the annotation normally.
- With an image as the last block in a note (with visible blank space below
  it in the viewport), tap that blank space: cursor moves to the end of the
  document and typing adds a new paragraph below the image.
- Upload a fresh image, immediately tap "Recortar": crop viewfinder shows
  the image and sizes correctly on the very first open (no blank square).
  Repeat for an image that was already open/visible for a while (the
  previously-more-likely-to-repro case) to confirm both paths work.
- Both themes (light/dark): compact toolbar and "⋯" menu contrast readable
  in both.
- Open the `/` slash-command menu over an image: menu background is fully
  opaque/frosted (matches the look of the "Tabla" options popover), no
  content bleeds through. Check both the populated list and the "Sin
  resultados" empty state.
- Upload a new image on a slow/throttled connection (devtools network
  throttling): a blurred low-quality version appears almost immediately and
  crossfades to the sharp version once it loads, with no layout shift either
  time. Reload the note and confirm the same image (now "old") still shows
  the blur-up behavior and settles to the right size quickly.
- Scroll through a note with several images stacked vertically on a
  throttled connection: confirm surrounding text/blocks don't visibly jump
  as each image loads.

## Implementation plan

Single plan — all six fixes are frontend-only, touch a small, related
cluster of files (`ImageAnnotationOverlay.jsx`, `NoteEditor.jsx`,
`ImageCropModal.jsx`, `SlashCommandMenu.jsx`, `noteImageUpload.js`,
`imageVariants.js`), and total well under the 10-task threshold that would
call for an A/B split.
