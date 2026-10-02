# Canvas Connectors and Sharp PDF (Phase 4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lines/arrows attach to shapes and follow them; PDF page images re-render sharper when zoomed in.

**Architecture:** A pure `resolveConnectors(objects)` recomputes connected endpoints at render/hit-test time (no extra writes when shapes move). The viewport sets `properties.connect` when a line endpoint is created or dropped over a shape. A `useSharpPdfImages` hook re-renders visible PDF pages from the source PDF at a zoom-dependent scale bucket and overrides entries of the images map passed to the renderer.

**Tech Stack:** React, Canvas2D, `pdfjs-dist` (already lazily loaded by `lib/media.js`), Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-01-canvas-connectors-sharp-pdf-design.md`

**Rules:** JavaScript only; code/comments English; no emojis; never start/stop dev servers (4010/5173); no file over 800 lines (`canvas-service.js` is ~672: keep the new validation tiny or in `canvas-calibration.js`-style module); tests with explicit globs; check touched files with `npx eslint <files>` (8 pre-existing `custom.encuestas` lint errors are unrelated). Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Connector resolution (pure) + API validation

**Files:**
- Create: `apps/desktop/src/modules/runly.canvas/lib/connectors.js` (+ `connectors.test.js`)
- Create: `apps/api/src/routes/canvas/canvas-connect.js`; modify `canvas-service.js` (`validateCanvasObject`)
- Test: `apps/api/src/routes/canvas/__tests__/canvas-service.test.js`

- [ ] **Step 1: Failing desktop test** — `lib/connectors.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { borderPoint, connectTargetAt, resolveConnectors } from './connectors.js'

const rect = (id, x, y, w = 100, h = 50, extra = {}) => ({ id, type: 'rectangle', transform: { x, y, rotation: 0 }, geometry: { width: w, height: h }, ...extra })
const arrow = (connect, x = 0, y = 0, x2 = 10, y2 = 0) => ({ id: 'arr', type: 'arrow', transform: { x, y }, geometry: { x2, y2 }, properties: { connect } })

describe('Canvas connectors', () => {
  it('ends on the border of connected rectangles', () => {
    const objects = [rect('a', 0, 0), rect('b', 300, 0), arrow({ start: 'a', end: 'b' })]
    const resolved = resolveConnectors(objects).find((o) => o.id === 'arr')
    assert.deepEqual({ x: resolved.transform.x, y: resolved.transform.y }, { x: 100, y: 25 })
    assert.deepEqual({ x: resolved.transform.x + resolved.geometry.x2, y: resolved.transform.y + resolved.geometry.y2 }, { x: 300, y: 25 })
  })
  it('touches the ellipse outline', () => {
    const ellipse = { id: 'e', type: 'ellipse', transform: { x: 0, y: 0, rotation: 0 }, geometry: { width: 100, height: 50 } }
    const p = borderPoint(ellipse, { x: 200, y: 100 })
    const nx = (p.x - 50) / 50, ny = (p.y - 25) / 25
    assert.ok(Math.abs(nx * nx + ny * ny - 1) < 0.01)
  })
  it('keeps stored geometry when the target is missing and returns the same array without connectors', () => {
    const objects = [arrow({ start: null, end: 'gone' }, 5, 5, 20, 0)]
    assert.deepEqual(resolveConnectors(objects)[0].geometry, { x2: 20, y2: 0 })
    const plain = [rect('a', 0, 0)]
    assert.equal(resolveConnectors(plain), plain)
  })
  it('finds the topmost connectable shape under a point', () => {
    const objects = [rect('a', 0, 0), rect('b', 50, 0), { id: 'l', type: 'line', transform: { x: 0, y: 0 }, geometry: { x2: 10, y2: 10 } }]
    assert.equal(connectTargetAt({ x: 60, y: 10 }, objects, 'none')?.id, 'b')
    assert.equal(connectTargetAt({ x: 60, y: 10 }, objects, 'b')?.id, 'a')
    assert.equal(connectTargetAt({ x: 500, y: 500 }, objects, null), null)
  })
})
```

- [ ] **Step 2: `lib/connectors.js`**

```js
import { boxOf, centerOf, hitObject, isLinear, rotatePoint } from '../engine/geometry.js'

const CONNECTABLE = new Set(['rectangle', 'ellipse', 'polygon', 'text', 'image', 'hotspot'])
export const isConnectable = (object) => CONNECTABLE.has(object?.type)

// Point where the ray from the shape's centre towards `toward` leaves it.
export function borderPoint(object, toward) {
  const b = boxOf(object), c = centerOf(b)
  const local = rotatePoint(toward, c, -b.rotation)
  const dx = local.x - c.x, dy = local.y - c.y
  if (!dx && !dy) return c
  const hw = Math.abs(b.width) / 2, hh = Math.abs(b.height) / 2
  let t
  if (object.type === 'ellipse' || object.type === 'hotspot') t = 1 / Math.sqrt((dx * dx) / (hw * hw || 1) + (dy * dy) / (hh * hh || 1))
  else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
  return rotatePoint({ x: c.x + dx * t, y: c.y + dy * t }, c, b.rotation)
}

// Lines/arrows with properties.connect get endpoints on their shapes' borders.
// Returns the same array when nothing is connected (cheap per frame).
export function resolveConnectors(objects) {
  if (!objects.some((o) => isLinear(o) && (o.properties?.connect?.start || o.properties?.connect?.end))) return objects
  const byId = new Map(objects.map((o) => [o.id, o]))
  return objects.map((object) => {
    const connect = object.properties?.connect
    if (!isLinear(object) || !connect) return object
    const startShape = connect.start ? byId.get(connect.start) : null
    const endShape = connect.end && connect.end !== connect.start ? byId.get(connect.end) : null
    if (!startShape && !endShape) return object
    const b = boxOf(object)
    let start = { x: b.x, y: b.y }, end = { x: b.x + b.width, y: b.y + b.height }
    const startRef = startShape ? centerOf(boxOf(startShape)) : start, endRef = endShape ? centerOf(boxOf(endShape)) : end
    if (startShape) start = borderPoint(startShape, endRef)
    if (endShape) end = borderPoint(endShape, startRef)
    return { ...object, transform: { ...object.transform, x: start.x, y: start.y }, geometry: { ...object.geometry, x2: end.x - start.x, y2: end.y - start.y } }
  })
}

// Topmost connectable shape under `point`, skipping `excludeId`.
export function connectTargetAt(point, objects, excludeId) {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index]
    if (object.id !== excludeId && isConnectable(object) && hitObject(point, object, 0)) return object
  }
  return null
}
```

Run `node --test apps/desktop/src/modules/runly.canvas/lib/connectors.test.js` — PASS (adjust only test literals that are mathematically wrong, and report).

- [ ] **Step 3: API validation** — `canvas-connect.js`:

```js
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const end = (value) => value === null || value === undefined || (typeof value === 'string' && UUID.test(value))
// properties.connect on lines/arrows: { start, end } object ids or null.
export function isValidConnect(connect) {
  return connect == null || (typeof connect === 'object' && !Array.isArray(connect) && end(connect.start) && end(connect.end))
}
```

In `validateCanvasObject` (next to the binding check): `if (!isValidConnect(data.properties?.connect)) throw new CanvasServiceError('La conexión de la línea no es válida.', 400)`. Test in `canvas-service.test.js`:

```js
  it('validates line connections', () => {
    const base = { type: 'arrow', geometry: { x2: 10, y2: 0 } }
    assert.doesNotThrow(() => validateCanvasObject({ ...base, properties: { connect: { start: '00000000-0000-4000-8000-000000000009', end: null } } }))
    assert.throws(() => validateCanvasObject({ ...base, properties: { connect: { start: 'x' } } }), (error) => error.status === 400)
  })
```

- [ ] **Step 4: Run both test globs; commit** — `feat(canvas): connector resolution and validation`

---

### Task 2: Connectors in the editor

**Files:**
- Modify: `components/CanvasViewport.jsx`, `engine/Canvas2DRenderer.js`, `hooks/useBoardEditorActions.js` (`create`, `commit`), `lib/renderScene.js`

- [ ] **Step 1: Render + hit-test resolved objects** — in `CanvasViewport.draw()`, after composing `objects` (live substitutions/draft), do `objects = resolveConnectors(objects)`. For hit-testing, replace uses of `p.objects`/`selectable()` passed to `hitTest` and marquee with resolved lists: add a helper `const resolved = () => resolveConnectors(propsRef.current.objects)` and make `selectable()` filter `resolved()`. Handles for a selected connected line must use the resolved row too (`single` lookups read from `selectable()`).

- [ ] **Step 2: Attach on create** — in `pointerUp` for `create` with `tool` `line` or `arrow` and a dragged draft: compute `start = connectTargetAt(drag.world, selectable(), null)`, `end = connectTargetAt(endPoint, selectable(), start?.id)` where `endPoint` is the draft's end; call `p.onCreate({ tool, box, connect: start || end ? { start: start?.id ?? null, end: end?.id ?? null } : null })`. While dragging the draft, set `liveRef.current.connectHint = connectTargetAt(world, selectable(), null)` and draw it (Step 4).

- [ ] **Step 3: Re-attach on endpoint drag** — in `pointerMove` resize branch for linear objects (`drag.handle` `start`/`end`), compute `hint = connectTargetAt(target, selectable(), otherEndId)` and store it in `liveRef.current.connectHint`; when building `next`, set `next.properties = { ...object.properties, connect: { ...(object.properties?.connect ?? { start: null, end: null }), [drag.handle]: hint?.id ?? null } }`. In `pointerUp`, the existing `onCommit` sends `{ prev, next }`.
  In `useBoardEditorActions.commit`, include `properties` in the update data when `next.properties !== prev.properties` (`data.properties = next.properties`). In `create`, accept `connect` and put it into `properties` of the created data (`properties: { ...data.properties, connect }` when present).

- [ ] **Step 4: Renderer hints** — `render(scene)` destructures `connectHint` (an object). Inside the world transform after objects: `if (connectHint) this.drawConnectHint(ctx, connectHint, viewport.zoom)` which strokes the hinted object's rotated box (or ellipse) with `this.theme.primary`, `lineWidth = 2 / zoom`, no dash. In `drawSelection`, for linear objects whose `properties.connect[start|end]` is set, fill that endpoint handle with `this.theme.primary` instead of `this.theme.surface`. The viewport passes `connectHint: liveRef.current?.connectHint ?? null`.

- [ ] **Step 5: Exports/thumbnails** — in `lib/renderScene.js`, resolve connectors before rendering and before computing bounds: `objects = resolveConnectors(objects)`.

- [ ] **Step 6: eslint, build; commit** — `feat(canvas): arrows and lines stay attached to shapes`

---

### Task 3: Sharp PDF pages

**Files:**
- Modify: `apps/desktop/src/modules/runly.canvas/lib/media.js` (add `renderPdfPageCanvas`, `openPdfFromUrl`)
- Create: `apps/desktop/src/modules/runly.canvas/lib/sharpPdf.js` (+ `sharpPdf.test.js` for the pure bucket logic)
- Create: `apps/desktop/src/modules/runly.canvas/hooks/useSharpPdfImages.js`
- Modify: `screens/BoardEditor.jsx`

- [ ] **Step 1: Failing test** — `lib/sharpPdf.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_SHARP_SIDE, neededBucket, sharpCandidates } from './sharpPdf.js'

describe('Sharp PDF buckets', () => {
  const page = { id: 'p', type: 'image', transform: { x: 0, y: 0 }, geometry: { width: 600, height: 800 }, properties: { fileId: 'png', sourceFileId: 'pdf', page: 2, naturalWidth: 1275, naturalHeight: 1700 } }
  it('needs no re-render while the raster is dense enough', () => {
    assert.equal(neededBucket(page, 1), 0)
  })
  it('asks for a power-of-two bucket when zoomed past the raster density', () => {
    assert.equal(neededBucket(page, 4), 2)
    // 1700px raster: 4x would exceed 4096px, so it stays at the 2x bucket.
    assert.equal(neededBucket(page, 8), 2)
    const small = { ...page, properties: { ...page.properties, naturalWidth: 600, naturalHeight: 800 } }
    assert.equal(neededBucket(small, 8), 4)
  })
  it('caps the bucket so the render stays under the max side', () => {
    const bucket = neededBucket(page, 64)
    assert.ok(1700 * bucket <= MAX_SHARP_SIDE * 1.0001)
  })
  it('selects only visible PDF page images', () => {
    const viewportBounds = { x: 0, y: 0, width: 100, height: 100 }
    const offscreen = { ...page, id: 'q', transform: { x: 5000, y: 5000 } }
    const photo = { ...page, id: 'r', properties: { fileId: 'jpg' } }
    assert.deepEqual(sharpCandidates([page, offscreen, photo], viewportBounds).map((o) => o.id), ['p'])
  })
})
```

- [ ] **Step 2: `lib/sharpPdf.js`**

```js
import { objectBounds } from '../engine/geometry.js'

export const MAX_SHARP_SIDE = 4096

// Extra resolution needed for a PDF page image at this zoom: 0 (the stored
// raster is enough) or a power of two (2, 4, 8…) relative to the raster,
// capped so the longest side stays under MAX_SHARP_SIDE.
export function neededBucket(object, zoom) {
  const p = object.properties ?? {}, width = Math.abs(object.geometry?.width ?? 0)
  if (!p.naturalWidth || !width) return 0
  const screenPx = width * zoom * (globalThis.devicePixelRatio || 1)
  const ratio = screenPx / p.naturalWidth
  if (ratio <= 1.2) return 0
  const longest = Math.max(p.naturalWidth, p.naturalHeight ?? p.naturalWidth)
  const cap = MAX_SHARP_SIDE / longest
  let bucket = 2
  while (bucket < ratio && bucket * 2 <= cap) bucket *= 2
  return Math.min(bucket, cap)
}

const intersects = (a, b) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y

// PDF page images (they carry sourceFileId + page) inside the visible area.
export function sharpCandidates(objects, viewportBounds) {
  return objects.filter((o) => o.type === 'image' && o.properties?.sourceFileId && o.properties?.page && intersects(objectBounds(o), viewportBounds))
}
```

(`neededBucket` test literals assume `devicePixelRatio` is undefined in Node → 1.)

- [ ] **Step 3: `media.js` helpers**

```js
// Loads a PDF from a (signed, CORS-enabled) URL.
export async function openPdfFromUrl(url) {
  const pdfjs = await getPdfjs()
  const response = await fetch(url, { mode: 'cors' })
  if (!response.ok) throw new Error('No se pudo cargar el PDF')
  return pdfjs.getDocument({ data: await response.arrayBuffer() }).promise
}

// Renders a PDF page to a canvas whose longest side is `targetSide` px.
export async function renderPdfPageCanvas(doc, pageNumber, targetSide) {
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: targetSide / Math.max(base.width, base.height) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  // The renderer checks image.complete/naturalWidth.
  return Object.assign(canvas, { complete: true, naturalWidth: canvas.width, naturalHeight: canvas.height })
}
```

- [ ] **Step 4: `hooks/useSharpPdfImages.js`** — signature `useSharpPdfImages({ rows, viewport, size, images })` returns a `Map` (the original `images` map with overrides). Behaviour:
  - Debounce 250 ms on `[rows, viewport, size]`.
  - Visible world bounds from `screenToWorld({0,0})` and `screenToWorld({size.width,size.height})`.
  - For each `sharpCandidates` object with `neededBucket(o, viewport.zoom) > 0`, key `${o.properties.fileId}@${bucket}`; skip if cached.
  - Load the source doc once per `sourceFileId` (promise cache in a module-level `Map`; URL from `runly.files.batchSignedUrls([sourceFileId], token)`), render `renderPdfPageCanvas(doc, page, naturalLongest * bucket)` and store in an LRU `Map` of max 12 entries (delete oldest on insert).
  - Overrides: for each candidate use the highest cached bucket ≤ needed (so a lower sharp render stays until the higher one arrives); if none, keep the original image.
  - Errors (CORS, network) mark the `sourceFileId` as failed for the session and stop retrying.
  - State update via `useState` counter bumped when a render finishes; return `useMemo` map.
- [ ] **Step 5: Wire** — in `BoardEditor.jsx` `const sharpImages = useSharpPdfImages({ rows, viewport, size, images })` and pass `images={sharpImages}` to `CanvasViewport` (the thumbnail/export code keeps using the stored rasters).

- [ ] **Step 6: Help + verification + commit** — add to the canvas help `overview.md` (no-accent style) under "Imagenes y PDF": `Al acercarte a una pagina de PDF, Canvas la vuelve a dibujar desde el PDF original con mas resolucion para que se lean los detalles.` and a new section:

```md
### Conectores

Si sueltas el inicio o el final de una linea o flecha sobre una forma, queda **conectada**: al mover o cambiar el tamano de la forma, la flecha la sigue. Arrastra el extremo fuera de la forma para desconectarlo.
```

Run all verification commands (API tests, desktop tests, eslint on touched files, `pnpm --filter ./apps/desktop build:web`). Commit — `feat(canvas): sharp PDF pages when zooming; help for connectors`
