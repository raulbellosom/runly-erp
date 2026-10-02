# Canvas Plan Tools (Phase 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real-world scale per page (calibration), a measure tool, object measures, align/distribute and PNG/PDF export for `runly.canvas`.

**Architecture:** Pure helpers (`lib/measure.js`, `lib/arrange.js`, `lib/renderScene.js`) hold the maths and offscreen rendering; the viewport gains two transient drag tools (`measure`, `calibrate`); calibration persists on `CanvasPage.calibration` through the existing page PATCH, now validated in the API.

**Tech Stack:** Hono, React + TanStack Query, `@runly/ui`, Canvas2D, `jspdf` (already a desktop dependency), Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-01-canvas-plan-tools-design.md`

**Rules:** JavaScript only; UI text Spanish, code/comments English; no emojis; `@runly/ui` components (check real props in `packages/ui/src`); modal header/footer fixed; never start/stop dev servers (4010/5173); no file over 800 lines — `apps/api/src/routes/canvas/canvas-service.js` is ~666 lines, so put new API validation in a new module; tests with explicit globs; `pnpm lint` has 8 pre-existing `custom.encuestas` errors — check touched files with `npx eslint <files>`. Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Calibration validation (API)

**Files:**
- Create: `apps/api/src/routes/canvas/canvas-calibration.js`
- Modify: `apps/api/src/routes/canvas/canvas-service.js` (`updatePage`, `createPage`)
- Test: `apps/api/src/routes/canvas/__tests__/canvas-calibration.test.js`

- [ ] **Step 1: Failing test**

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CALIBRATION_UNITS, normalizeCalibration } from '../canvas-calibration.js'

describe('Page calibration', () => {
  const valid = { a: { x: 0, y: 0 }, b: { x: 420, y: 0 }, distance: 10, unit: 'm' }
  it('accepts null and a valid calibration', () => {
    assert.equal(normalizeCalibration(null), null)
    assert.deepEqual(normalizeCalibration(valid), valid)
    assert.deepEqual(CALIBRATION_UNITS, ['m', 'cm', 'mm', 'ft'])
  })
  it('rejects bad calibrations with status 400', () => {
    for (const bad of [{ ...valid, distance: 0 }, { ...valid, unit: 'km' }, { ...valid, b: { x: 0, y: 0 } }, { ...valid, a: { x: 'x', y: 0 } }, 'nope']) {
      assert.throws(() => normalizeCalibration(bad), (error) => error.status === 400, JSON.stringify(bad))
    }
  })
})
```

- [ ] **Step 2: Implement `canvas-calibration.js`**

```js
// CanvasPage.calibration: two world points and the real distance between
// them. Everything measured on the page scales by distance / |b - a|.
export const CALIBRATION_UNITS = ['m', 'cm', 'mm', 'ft']
const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const invalid = () => Object.assign(new Error('La calibración de escala no es válida.'), { status: 400 })

export function normalizeCalibration(input) {
  if (input === null) return null
  if (!input || typeof input !== 'object') throw invalid()
  const { a, b, distance, unit } = input
  if (![a?.x, a?.y, b?.x, b?.y].every(finite) || Math.hypot(b.x - a.x, b.y - a.y) < 1) throw invalid()
  if (!finite(distance) || distance <= 0 || !CALIBRATION_UNITS.includes(unit)) throw invalid()
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, distance, unit }
}
```

- [ ] **Step 3: Use it** — in `canvas-service.js` import `normalizeCalibration`; in `updatePage`, when `data.calibration !== undefined` set `patch.calibration = calibrationOrError(data.calibration)` where (add near `boardSettings`):

```js
function calibrationOrError(input) {
  try { return normalizeCalibration(input) } catch (error) { throw new CanvasServiceError(error.message, 400) }
}
```

Remove `'calibration'` from `updatePage`'s generic key loop. In `createPage` replace `calibration: data?.calibration ?? null` with `calibration: data?.calibration == null ? null : calibrationOrError(data.calibration)`.

- [ ] **Step 4: Run** `node --test apps/api/src/routes/canvas/__tests__/*.test.js` — PASS. **Commit** — `feat(canvas): validate page scale calibration`

---

### Task 2: Measure and arrange helpers (desktop, pure)

**Files:**
- Create: `apps/desktop/src/modules/runly.canvas/lib/measure.js` (+ `measure.test.js`)
- Create: `apps/desktop/src/modules/runly.canvas/lib/arrange.js` (+ `arrange.test.js`)

- [ ] **Step 1: Failing tests**

`lib/measure.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calibrationScale, formatArea, formatLength, objectMeasures } from './measure.js'

const calibration = { a: { x: 0, y: 0 }, b: { x: 420, y: 0 }, distance: 10, unit: 'm' }

describe('Canvas measures', () => {
  it('derives units per world pixel', () => {
    assert.equal(calibrationScale(calibration), 10 / 420)
    assert.equal(calibrationScale(null), null)
  })
  it('formats lengths and areas in real units or px', () => {
    const scale = 1 / 42
    assert.equal(formatLength(84, { scale, unit: 'm' }), '2 m')
    assert.equal(formatLength(100, { scale, unit: 'm' }), '2,38 m')
    assert.equal(formatLength(84.4, null), '84 px')
    assert.equal(formatArea(210 * 84, { scale, unit: 'm' }), '10 m²')
    assert.equal(formatArea(100, null), '100 px²')
  })
  it('measures rectangles, ellipses, polygons and lines in world px', () => {
    const rect = objectMeasures({ type: 'rectangle', transform: { x: 0, y: 0 }, geometry: { width: 210, height: 84 } })
    assert.deepEqual(rect, { width: 210, height: 84, area: 210 * 84, perimeter: 2 * (210 + 84) })
    const tri = objectMeasures({ type: 'polygon', transform: { x: 0, y: 0 }, geometry: { width: 10, height: 10, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } })
    assert.equal(tri.area, 50)
    const line = objectMeasures({ type: 'line', transform: { x: 0, y: 0 }, geometry: { x2: 30, y2: 40 } })
    assert.equal(line.length, 50)
    const ellipse = objectMeasures({ type: 'ellipse', transform: { x: 0, y: 0 }, geometry: { width: 20, height: 10 } })
    assert.ok(Math.abs(ellipse.area - Math.PI * 10 * 5) < 1e-9)
  })
})
```

`lib/arrange.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { alignDeltas, distributeDeltas } from './arrange.js'

const box = (id, x, y, w = 10, h = 10) => ({ id, type: 'rectangle', transform: { x, y }, geometry: { width: w, height: h } })

describe('Canvas align and distribute', () => {
  it('aligns left edges to the leftmost object', () => {
    const deltas = alignDeltas([box('a', 0, 0), box('b', 30, 5), box('c', 12, 9)], 'left')
    assert.deepEqual(deltas.get('b'), { dx: -30, dy: 0 })
    assert.deepEqual(deltas.get('a'), { dx: 0, dy: 0 })
  })
  it('centres vertically on the selection box', () => {
    const deltas = alignDeltas([box('a', 0, 0, 10, 10), box('b', 0, 30, 10, 10)], 'vcenter')
    assert.deepEqual(deltas.get('a'), { dx: 0, dy: 15 })
    assert.deepEqual(deltas.get('b'), { dx: 0, dy: -15 })
  })
  it('distributes equal horizontal gaps keeping the outer objects', () => {
    const deltas = distributeDeltas([box('a', 0, 0), box('c', 100, 0), box('b', 20, 0)], 'h')
    assert.deepEqual(deltas.get('a'), { dx: 0, dy: 0 })
    assert.deepEqual(deltas.get('c'), { dx: 0, dy: 0 })
    assert.deepEqual(deltas.get('b'), { dx: 25, dy: 0 })
  })
  it('does nothing with fewer than three objects', () => {
    assert.equal(distributeDeltas([box('a', 0, 0), box('b', 50, 0)], 'h').size, 0)
  })
})
```

- [ ] **Step 2: `lib/measure.js`**

```js
import { boxOf } from '../engine/geometry.js'

export const UNIT_LABELS = { m: 'm', cm: 'cm', mm: 'mm', ft: 'ft' }
const number = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 })

// Real units per world pixel for a page calibration, or null.
export function calibrationScale(calibration) {
  if (!calibration?.a || !calibration?.b || !(calibration.distance > 0)) return null
  const px = Math.hypot(calibration.b.x - calibration.a.x, calibration.b.y - calibration.a.y)
  return px >= 1 ? calibration.distance / px : null
}

// `scale` = { scale, unit } from the page, or null for pixels.
export function formatLength(px, scale) {
  return scale ? `${number.format(px * scale.scale)} ${UNIT_LABELS[scale.unit]}` : `${Math.round(px)} px`
}
export function formatArea(px2, scale) {
  return scale ? `${number.format(px2 * scale.scale * scale.scale)} ${UNIT_LABELS[scale.unit]}²` : `${Math.round(px2)} px²`
}

function polygonArea(points, w, h) {
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i], q = points[(i + 1) % points.length]
    sum += p.x * w * q.y * h - q.x * w * p.y * h
  }
  return Math.abs(sum) / 2
}
function polygonPerimeter(points, w, h) {
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i], q = points[(i + 1) % points.length]
    sum += Math.hypot((q.x - p.x) * w, (q.y - p.y) * h)
  }
  return sum
}

// Measures in world px (rotation does not change them).
export function objectMeasures(object) {
  const b = boxOf(object)
  if (object.type === 'line' || object.type === 'arrow') return { length: Math.hypot(b.width, b.height) }
  const w = Math.abs(b.width), h = Math.abs(b.height)
  if (object.type === 'ellipse') {
    const a = w / 2, c = h / 2
    // Ramanujan's perimeter approximation.
    return { width: w, height: h, area: Math.PI * a * c, perimeter: Math.PI * (3 * (a + c) - Math.sqrt((3 * a + c) * (a + 3 * c))) }
  }
  if (object.type === 'polygon' && Array.isArray(object.geometry?.points) && object.geometry.points.length > 2) {
    const points = object.geometry.points
    return { width: w, height: h, area: polygonArea(points, w, h), perimeter: polygonPerimeter(points, w, h) }
  }
  if (object.type === 'rectangle' || object.type === 'image') return { width: w, height: h, area: w * h, perimeter: 2 * (w + h) }
  return { width: w, height: h }
}
```

- [ ] **Step 3: `lib/arrange.js`**

```js
import { objectBounds } from '../engine/geometry.js'

const MODES = {
  left: (b, g) => ({ dx: g.x - b.x, dy: 0 }),
  hcenter: (b, g) => ({ dx: g.x + g.width / 2 - (b.x + b.width / 2), dy: 0 }),
  right: (b, g) => ({ dx: g.x + g.width - (b.x + b.width), dy: 0 }),
  top: (b, g) => ({ dx: 0, dy: g.y - b.y }),
  vcenter: (b, g) => ({ dx: 0, dy: g.y + g.height / 2 - (b.y + b.height / 2) }),
  bottom: (b, g) => ({ dx: 0, dy: g.y + g.height - (b.y + b.height) }),
}

function groupBounds(bounds) {
  const x = Math.min(...bounds.map((b) => b.x)), y = Math.min(...bounds.map((b) => b.y))
  return { x, y, width: Math.max(...bounds.map((b) => b.x + b.width)) - x, height: Math.max(...bounds.map((b) => b.y + b.height)) - y }
}

// Map id -> { dx, dy } that aligns every object's bounds to the selection box.
export function alignDeltas(rows, mode) {
  const bounds = rows.map((row) => ({ id: row.id, ...objectBounds(row) }))
  const group = groupBounds(bounds), fn = MODES[mode]
  return new Map(bounds.map((b) => [b.id, fn(b, group)]))
}

// Equal gaps between bounds along an axis ('h' | 'v'); outer objects stay.
export function distributeDeltas(rows, axis) {
  if (rows.length < 3) return new Map()
  const start = axis === 'h' ? 'x' : 'y', size = axis === 'h' ? 'width' : 'height'
  const bounds = rows.map((row) => ({ id: row.id, ...objectBounds(row) })).sort((a, b) => a[start] - b[start])
  const first = bounds[0], last = bounds.at(-1)
  const total = last[start] + last[size] - first[start], used = bounds.reduce((sum, b) => sum + b[size], 0)
  const gap = (total - used) / (bounds.length - 1)
  const deltas = new Map()
  let cursor = first[start]
  for (const b of bounds) {
    const move = cursor - b[start]
    deltas.set(b.id, axis === 'h' ? { dx: move, dy: 0 } : { dx: 0, dy: move })
    cursor += b[size] + gap
  }
  return deltas
}
```

- [ ] **Step 4: Run** `node --test apps/desktop/src/modules/runly.canvas/lib/*.test.js` — PASS. **Commit** — `feat(canvas): measure and arrange helpers`

---

### Task 3: Scale, measure tool, calibration UI, measures section

**Files:**
- Modify: `engine/Canvas2DRenderer.js` (measure overlay), `components/CanvasViewport.jsx` (measure/calibrate tools, unit-aware overlay text), `components/CanvasToolbar.jsx` (Medir button), `hooks/useCanvasShortcuts.js` (M key), `hooks/useCanvasData.js` (`useUpdatePage`), `screens/BoardEditor.jsx`, `components/BoardInspector.jsx`
- Create: `components/ScaleControl.jsx`, `components/CalibrateDialog.jsx`, `components/inspector/MeasuresSection.jsx`

- [ ] **Step 1: Page mutation hook** (append to `useCanvasData.js`):

```js
export function useUpdatePage(boardId) {
  const token = useToken(), client = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId, data }) => runly.canvas.updatePage(boardId, pageId, data, token),
    onSuccess: () => client.invalidateQueries({ queryKey: boardKey(boardId), exact: true }),
  })
}
```

- [ ] **Step 2: Renderer overlay** — `render(scene)` destructures `measure` (`{ a, b, text }` in world coords or null). After `ctx.restore()` (screen space) and before the overlay label, call `if (measure) this.drawMeasure(ctx, measure, viewport)`:

```js
  drawMeasure(ctx, measure, viewport) {
    const a = worldToScreen(measure.a, viewport), b = worldToScreen(measure.b, viewport)
    ctx.save()
    ctx.strokeStyle = this.theme.primary; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4])
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([])
    for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = this.theme.primary; ctx.fill() }
    if (measure.text) {
      ctx.font = `600 11px ${this.theme.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 14 }, width = ctx.measureText(measure.text).width + 14
      ctx.fillStyle = this.theme.primary; ctx.beginPath(); ctx.roundRect(mid.x - width / 2, mid.y - 10, width, 20, 6); ctx.fill()
      ctx.fillStyle = '#ffffff'; ctx.fillText(measure.text, mid.x, mid.y + 0.5)
    }
    ctx.restore()
  }
```

- [ ] **Step 3: Viewport tools**
  - New props: `scale` (`{ scale, unit } | null`), `onCalibrate({ a, b })`.
  - `MEASURE_TOOLS = new Set(['measure', 'calibrate'])`; `baseCursor` returns `'crosshair'` for them.
  - `pointerDown`: before the read-only branch, `if (MEASURE_TOOLS.has(tool)) { dragRef.current = { mode: 'measure', world: snapPoint(world, event.altKey ? 0 : p.snapSize ?? 0) }; liveRef.current = null; schedule(); return }` (measure works for read-only users too; calibrate is only offered to editors by the UI).
  - `pointerMove` with `drag.mode === 'measure'`: compute `b` (Shift → 45° constraint using `boxFromDrag('line', a, world, { constrain: true })` end point), set `liveRef.current = { measure: { a: drag.world, b, text: tool === 'measure' ? formatLength(Math.hypot(b.x - a.x, b.y - a.y), p.scale) : null } }`, `schedule()`.
  - `pointerUp` with `drag.mode === 'measure'`: for `calibrate`, call `p.onCalibrate({ a, b })` when length ≥ 4 and clear `liveRef`; for `measure`, keep `liveRef.current = { measure, sticky: true }` so it stays visible.
  - `draw()`: pass `measure: liveRef.current?.measure ?? null`; a sticky measure is cleared on the next `pointerDown` (any tool) and when `tool` changes (in the existing `useEffect` on `[tool, spacePan]`).
  - `overlayText`: lengths/sizes use `formatLength(...)` with `propsRef.current.scale` (`W × H` becomes `formatLength(w) × formatLength(h)`).

- [ ] **Step 4: Toolbar + shortcut** — `CanvasToolbar` adds a `ToolButton` "Medir" (shortcut `M`, icon `Ruler`) visible for every role (in the read-only toolbar too). `useCanvasShortcuts`: map `m` → `'measure'` in `TOOL_KEYS`. In `BoardEditor`'s `onTool` handler allow `'measure'` for read-only users. Add hints: `measure: 'Arrastra para medir · Shift mantiene 45°'`, `calibrate: 'Traza una línea sobre una medida conocida'`.

- [ ] **Step 5: Calibration UI**
  - `CalibrateDialog.jsx` — props `{ open, onOpenChange, pixels, onSave(distance, unit), pending }`. Body: text `La línea mide ${Math.round(pixels)} px en el lienzo.`; `TextField`/`Input` "Longitud real" (`inputMode="decimal"`, accepts comma), `SelectField` "Unidad" (Metros m, Centímetros cm, Milímetros mm, Pies ft; default m). "Guardar" disabled unless the parsed number > 0.
  - `ScaleControl.jsx` — props `{ scale, canEdit, onCalibrate, onClear }`. A small `glass` pill placed next to `ZoomControls`: text "Sin escala" or `1 ${unit} = ${Math.round(1 / scale.scale)} px` (when `1/scale.scale < 1`, show `1 px = ${formatLength(1, scale)}`); a `DropdownMenu` (only if `canEdit`) with "Calibrar escala" and, when calibrated, "Quitar escala".
  - `BoardEditor`: `const calibration = activePage?.calibration ?? null`, `const scaleInfo = useMemo(() => { const s = calibrationScale(calibration); return s ? { scale: s, unit: calibration.unit } : null }, [calibration])`. State `pendingCalibration` (`{ a, b }`). `onCalibrate` → set state and open dialog; save → `updatePage.mutate({ pageId, data: { calibration: { ...pending, distance, unit } } })`, toast "Escala guardada", `setTool('select')`. Clear → `calibration: null`, toast "Escala quitada". Pass `scale={scaleInfo}` and `onCalibrate` to `CanvasViewport`.

- [ ] **Step 6: Measures in the inspector** — `MeasuresSection.jsx` props `{ object, scale }`: `Section title="Medidas"` with a two-column `dl`: for lines "Longitud"; otherwise "Ancho", "Alto", and when present "Área" and "Perímetro", using `formatLength`/`formatArea`. When `scale` is null add the muted hint "Calibra la escala para medir en unidades reales.". Skip for `hotspot` and `text`. `BoardInspector` receives `scale` and renders it inside `ObjectInspector` children (before the data section).

- [ ] **Step 7: eslint, build; commit** — `feat(canvas): page scale calibration, measure tool and object measures`

---

### Task 4: Align and distribute

**Files:**
- Modify: `hooks/useBoardEditorActions.js`, `components/inspector/MultiInspector.jsx`, `components/BoardInspector.jsx`

- [ ] **Step 1: Action** — in `useBoardEditorActions.js` (import `alignDeltas`, `distributeDeltas`):

```js
  // Moves editable rows by per-object deltas (align/distribute), one undo step.
  function moveBy(objects, deltas, label) {
    const entries = editable(objects).map((row) => {
      const d = deltas.get(row.id)
      if (!d || (!d.dx && !d.dy)) return null
      return { row, data: { transform: { ...row.transform, x: (row.transform?.x ?? 0) + d.dx, y: (row.transform?.y ?? 0) + d.dy } } }
    }).filter(Boolean)
    applyUpdates(entries, label)
  }
  const align = (objects, mode) => moveBy(objects, alignDeltas(editable(objects), mode), 'Alinear')
  const distribute = (objects, axis) => moveBy(objects, distributeDeltas(editable(objects), axis), 'Distribuir')
```

Return `align` and `distribute`.

- [ ] **Step 2: UI** — `MultiInspector` gets `onAlign(mode)` and `onDistribute(axis)`; new `Section title="Alinear"` above "Organizar": a 6-column grid of icon `Button variant="outline" size="icon"` with `aria-label`/`title`: "Alinear a la izquierda" (`AlignStartVertical`), "Centrar horizontalmente" (`AlignCenterVertical`), "Alinear a la derecha" (`AlignEndVertical`), "Alinear arriba" (`AlignStartHorizontal`), "Centrar verticalmente" (`AlignCenterHorizontal`), "Alinear abajo" (`AlignEndHorizontal`); then a 2-column row "Distribuir horizontal" (`AlignHorizontalDistributeCenter`) and "Distribuir vertical" (`AlignVerticalDistributeCenter`), disabled when `rows.length - lockedCount < 3`. Verify those icon names exist in the installed `lucide-react` (`node -e "console.log(Object.keys(require('lucide-react')).filter(k=>k.startsWith('Align')).join(' '))"` from `apps/desktop`) and substitute the closest existing ones. `BoardInspector` wires `onAlign={(mode) => actions.align(selectedRows, mode)}` and `onDistribute={(axis) => actions.distribute(selectedRows, axis)}`.

- [ ] **Step 3: eslint, build; commit** — `feat(canvas): align and distribute multiple objects`

---

### Task 5: Export PNG/PDF, help, verification

**Files:**
- Create: `apps/desktop/src/modules/runly.canvas/lib/renderScene.js` (+ test of the pure size helper)
- Modify: `apps/desktop/src/modules/runly.canvas/lib/thumbnail.js` (reuse `renderScene`)
- Create: `apps/desktop/src/modules/runly.canvas/lib/exportPage.js`, `components/ExportMenu.jsx`
- Modify: `components/EditorTopBar.jsx`, `screens/BoardEditor.jsx`, `engine/theme.js` (export the light fallback), help `overview.md`

- [ ] **Step 1: Failing test** — `lib/renderScene.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { exportSize } from './renderScene.js'

describe('Export sizing', () => {
  it('renders at 2x world size with padding, capped at 8000px', () => {
    assert.deepEqual(exportSize({ x: 0, y: 0, width: 500, height: 250 }), { width: 1096, height: 596, pixelRatio: 2 })
    const big = exportSize({ x: 0, y: 0, width: 20000, height: 1000 })
    assert.ok(big.width <= 8000 && big.height <= 8000)
  })
})
```

- [ ] **Step 2: `renderScene.js`** — move the offscreen logic out of `thumbnail.js` into a reusable function and keep `renderThumbnail` as a thin wrapper:

```js
import { Canvas2DRenderer, sceneBounds } from '../engine/Canvas2DRenderer.js'
import { LIGHT_THEME } from '../engine/theme.js'
import { fitBounds } from '../engine/viewport.js'

export const EXPORT_PADDING = 24, EXPORT_MAX = 8000

// Pixel size for exporting `bounds` at 2x (lower if it would exceed the cap).
export function exportSize(bounds) {
  const w = bounds.width + EXPORT_PADDING * 2, h = bounds.height + EXPORT_PADDING * 2
  const pixelRatio = Math.min(2, EXPORT_MAX / w, EXPORT_MAX / h)
  return { width: Math.round(w * pixelRatio), height: Math.round(h * pixelRatio), pixelRatio }
}
```

plus `async function renderScene(objects, { width, height, padding = EXPORT_PADDING, imageUrls, bindings = {}, light = false, background = null })` that: attaches an offscreen canvas (as `thumbnail.js` does today), creates the renderer, `resize(width, height, 1)`, uses `fitBounds(sceneBounds(objects), { width, height }, padding)` but **without the zoom cap of 1** for exports (compute `zoom = Math.min((width - 2p) / bounds.width, (height - 2p) / bounds.height)` and centre), applies `renderer.setTheme(LIGHT_THEME)` when `light`, paints `background` first if provided (renderer option or a fill before `render`: add an optional `scene.background` the renderer fills after `clearRect`), loads images via the CORS fetch helper already in `thumbnail.js` (move it here), renders with `grid: { enabled: false }`, `interactive: false`, `bindings`, and returns the canvas element (callers call `toBlob`/`toDataURL`; keep the tainted-canvas fallback by re-rendering without images if `toBlob` throws). `thumbnail.js` calls it with `{ width: 640, height: 360, padding: 24 }` and keeps its existing zoom ≤ 1 behaviour (pass a `maxZoom: 1` option).

In `engine/theme.js` export the existing light fallback object as `LIGHT_THEME` (including `tones`).

- [ ] **Step 3: `exportPage.js`**

```js
import { jsPDF } from 'jspdf'
import { sceneBounds } from '../engine/Canvas2DRenderer.js'
import { exportSize, renderScene } from './renderScene.js'

const safeName = (value) => String(value || 'board').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function pageCanvas(objects, options) {
  const bounds = sceneBounds(objects)
  if (!bounds) return null
  const size = exportSize(bounds)
  return renderScene(objects, { ...options, width: size.width, height: size.height, padding: 24 * size.pixelRatio, light: true, background: '#ffffff' })
}

export async function exportPng(objects, { boardName, pageName, imageUrls, bindings }) {
  const canvas = await pageCanvas(objects, { imageUrls, bindings })
  if (!canvas) return false
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  download(blob, `${safeName(boardName)} - ${safeName(pageName)}.png`)
  return true
}

export async function exportPdf(objects, { boardName, pageName, scaleLabel, imageUrls, bindings }) {
  const canvas = await pageCanvas(objects, { imageUrls, bindings })
  if (!canvas) return false
  const landscape = canvas.width >= canvas.height
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight(), margin = 10, header = 12
  pdf.setFontSize(12); pdf.text(`${boardName} — ${pageName}`, margin, margin + 4)
  pdf.setFontSize(8); pdf.text([new Date().toLocaleString('es-MX'), scaleLabel].filter(Boolean).join(' · '), margin, margin + 9)
  const maxW = pageW - margin * 2, maxH = pageH - margin * 2 - header
  const ratio = Math.min(maxW / canvas.width, maxH / canvas.height)
  const w = canvas.width * ratio, h = canvas.height * ratio
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin + (maxW - w) / 2, margin + header, w, h)
  pdf.save(`${safeName(boardName)} - ${safeName(pageName)}.pdf`)
  return true
}
```

Before finalising `download`, grep the desktop app for an existing download helper (`grep -rn "createObjectURL" apps/desktop/src/lib`) and reuse it if one exists (it may handle Tauri).

- [ ] **Step 4: `ExportMenu.jsx` + wiring** — `DropdownMenu` with trigger `ToolButton` (icon `Download`, label "Exportar"), items "Imagen PNG" and "PDF"; disabled when `disabled`; while exporting, show a spinner in the trigger. Props `{ disabled, onExport(format) }`. `EditorTopBar` renders it before the Versions button for every role (prop `onExport`, `exportDisabled`). In `BoardEditor`, `exportAs(format)`: collects image fileIds from visible `rows`, gets signed URLs with `runly.files.batchSignedUrls` (token from `useAuth`), calls `exportPng`/`exportPdf` with `{ boardName: board.data.name, pageName: activePage.name, scaleLabel: scaleInfo ? 'Escala ' + <same text as ScaleControl> : null, imageUrls, bindings: bindings.data ?? {} }`, `toast.success('Exportación lista')` / `toast.error(...)`. Keep this logic in a small hook `hooks/useExportPage.js` if `BoardEditor.jsx` grows past ~330 lines.

- [ ] **Step 5: Help** — add to the canvas help `overview.md` (no-accent style):

```md
### Escala y medidas

Con **Calibrar escala** (junto a los controles de zoom) trazas una linea sobre una medida conocida del plano, por ejemplo una pared de 5 m, y escribes su longitud real. Desde entonces la herramienta **Medir** (tecla M) muestra distancias en metros, centimetros, milimetros o pies, y el inspector muestra ancho, alto, area y perimetro de cada forma. Cada pagina tiene su propia escala.

### Alinear y distribuir

Con varios elementos seleccionados, la seccion **Alinear** del inspector los alinea por la izquierda, el centro, la derecha, arriba, en medio o abajo, y los distribuye con espacios iguales (minimo tres).

### Exportar

El menu **Exportar** de la barra superior descarga la pagina actual como imagen PNG o como PDF listo para imprimir, con el nombre del Board, la fecha y la escala.
```

- [ ] **Step 6: Verification**

```bash
node --test apps/api/src/routes/canvas/__tests__/*.test.js
node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js
npx eslint <touched files>
pnpm --filter ./apps/desktop build:web
```

- [ ] **Step 7: Commit** — `feat(canvas): export page to PNG and PDF; help for scale, align and export`
