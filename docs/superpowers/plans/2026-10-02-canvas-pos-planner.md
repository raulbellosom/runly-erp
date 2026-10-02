# Canvas × POS Planner (6b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DOM floor planner canvas (rulers, overlays) with the Canvas engine, keeping every planner capability and adding rotation and polygon vertex editing.

**Architecture:** Generic, opt-in engine features in `runly.canvas` (external creation tools, free polygon drawing, polygon vertex handles, `isSelectable`, `onContextMenu`). POS keeps its reducer/history/save flow (extracted to `lib/floorPlannerState.js`); a pure adapter converts planner elements ↔ canvas objects; `FloorPlannerStage.jsx` hosts `CanvasViewport` with POS drawers.

**Tech Stack:** React, Canvas2D, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-02-canvas-pos-planner-design.md`

**Rules:** JavaScript only; UI text Spanish; code/comments English; no emojis; `@runly/ui`; never start/stop dev servers (4010/5173); no file over 800 lines; tests with explicit globs; `npx eslint <touched files>` clean; another session may commit concurrently — stage only your own files. Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Every engine addition must be optional: with no new props, `runly.canvas` behaves exactly as before (its tests must keep passing).

---

### Task 1: Polygon vertex geometry (pure, engine)

**Files:** `apps/desktop/src/modules/runly.canvas/engine/geometry.js`, `engine/geometry.test.js`

- [ ] **Step 1: Failing tests** (append to `geometry.test.js`):

```js
import { absolutePoints, polygonFromAbsolute, polygonHandles, editVertex } from './geometry.js'

describe('polygon vertices', () => {
  const poly = { id: 'p', type: 'polygon', transform: { x: 10, y: 20, rotation: 0 }, geometry: { width: 100, height: 50, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] } }
  it('converts relative points to world points and back', () => {
    assert.deepEqual(absolutePoints(poly), [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 60, y: 70 }])
    const rebuilt = polygonFromAbsolute(poly, absolutePoints(poly))
    assert.deepEqual(rebuilt.transform, { x: 10, y: 20, rotation: 0 })
    assert.deepEqual(rebuilt.geometry.points, poly.geometry.points)
  })
  it('exposes vertex and midpoint handles', () => {
    const ids = polygonHandles(poly).map((h) => h.id)
    assert.deepEqual(ids, ['v:0', 'v:1', 'v:2', 'm:0', 'm:1', 'm:2'])
  })
  it('moves a vertex and refits the box', () => {
    const next = editVertex(poly, 'v:2', { x: 60, y: 120 })
    assert.equal(next.geometry.height, 100)
    assert.deepEqual(absolutePoints(next)[2], { x: 60, y: 120 })
  })
  it('inserts a vertex from a midpoint and deletes vertices down to three', () => {
    const inserted = editVertex(poly, 'm:0', { x: 60, y: 10 })
    assert.equal(inserted.geometry.points.length, 4)
    assert.deepEqual(absolutePoints(inserted)[1], { x: 60, y: 10 })
    assert.equal(editVertex(inserted, 'delete:1').geometry.points.length, 3)
    assert.equal(editVertex(poly, 'delete:0'), poly)
  })
})
```

- [ ] **Step 2: Implement** in `geometry.js` (rotation-aware: points rotate around the box centre):

```js
// ---- Polygon vertices (points are box-relative 0..1) -------------------
export function absolutePoints(object) {
  const b = boxOf(object), c = centerOf(b)
  return (object.geometry?.points ?? []).map((p) => rotatePoint({ x: b.x + p.x * b.width, y: b.y + p.y * b.height }, c, b.rotation))
}

// Rebuilds box + relative points from world points, keeping the rotation.
export function polygonFromAbsolute(object, world) {
  const b = boxOf(object), c = centerOf(b)
  const local = world.map((p) => rotatePoint(p, c, -b.rotation))
  const xs = local.map((p) => p.x), ys = local.map((p) => p.y)
  const minX = Math.min(...xs), minY = Math.min(...ys)
  const width = Math.max(Math.max(...xs) - minX, MIN_SIZE), height = Math.max(Math.max(...ys) - minY, MIN_SIZE)
  // The local box is unrotated around the old centre; place it so its centre maps back correctly.
  const localCenter = { x: minX + width / 2, y: minY + height / 2 }
  const worldCenter = rotatePoint(localCenter, c, b.rotation)
  return {
    ...object,
    transform: { ...object.transform, x: worldCenter.x - width / 2, y: worldCenter.y - height / 2 },
    geometry: { ...object.geometry, width, height, points: local.map((p) => ({ x: (p.x - minX) / width, y: (p.y - minY) / height })) },
  }
}

export function polygonHandles(object) {
  const points = absolutePoints(object)
  return [
    ...points.map((p, i) => ({ id: `v:${i}`, ...p })),
    ...points.map((p, i) => { const q = points[(i + 1) % points.length]; return { id: `m:${i}`, x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } }),
  ]
}

// handle 'v:i' moves vertex i; 'm:i' inserts after i; 'delete:i' removes i (min 3).
export function editVertex(object, handle, point) {
  const [kind, raw] = handle.split(':'), index = Number(raw)
  const points = absolutePoints(object)
  if (kind === 'v') points[index] = point
  else if (kind === 'm') points.splice(index + 1, 0, point)
  else if (kind === 'delete') { if (points.length <= 3) return object; points.splice(index, 1) }
  return polygonFromAbsolute(object, points)
}
```

Note: the round-trip test expects exact `transform` equality only for rotation 0; keep a `+ 0` normalisation if `-0` appears. Rounding: if float noise breaks `deepEqual`, round relative points to 1e-9 in `polygonFromAbsolute` and adjust only test literals that are mathematically wrong.

- [ ] **Step 3: Run** `node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js` — PASS. Commit — `feat(canvas): polygon vertex geometry`

---

### Task 2: Engine interaction options

**Files:** `components/CanvasViewport.jsx`, `engine/Canvas2DRenderer.js` (+ extract helpers to `lib/` if the viewport grows past ~420 lines)

All props optional; defaults keep current behaviour.

- [ ] **Step 1: Vertex handles** — when the single selected object is a `polygon` with `geometry.points` and `p.editVertices !== false`... (default: **on** for Canvas too — it is a pure improvement), `hitHandle` first checks `polygonHandles` (radius as box handles) and the renderer draws vertex handles (filled squares 7 px) and midpoint handles (small circles 5 px, 50 % opacity) for that object, in addition to rotate (no box resize handles for polygons with vertex editing). Dragging `v:i`/`m:i` uses `editVertex` in `pointerMove` (snap the point to grid unless Alt), commits via `onCommit` with mode `'resize'`. Double-click on a `v:i` handle commits `editVertex(object, 'delete:i')` instead of opening the object.
- [ ] **Step 2: External creation tools** — props `creationTools` (Set, default `CREATION_TOOLS`) and `draftFor(tool, box)` (default `draftObject`). `pointerDown` checks `p.creationTools ?? CREATION_TOOLS`; `pointerMove` builds `p.draftFor ? p.draftFor(tool, box) : draftObject(tool, box)` (skip drafts when the draft builder returns null, e.g. for tap-only tools).
- [ ] **Step 3: Free polygon tool** — tool id `'polygon-draw'` (works whenever `tool === 'polygon-draw'`, regardless of `creationTools`): each click adds a snapped world point to `liveRef.current.polygon = { points, cursor }`; `pointerMove` updates `cursor`; the renderer draws the open polyline + segment to cursor + vertex dots (`scene.polygonDraft`). Finish on double-click, `Enter`, or a click within 8 screen px of the first point when ≥ 3 points → `p.onCreate({ tool: 'polygon-draw', points })` and clear. `Escape` (key listener on the canvas element) or tool change cancels. Fewer than 3 points → cancel silently.
- [ ] **Step 4: `isSelectable(object)`** — `selectable()` additionally filters by `p.isSelectable` when provided (used for the POS surface).
- [ ] **Step 5: `onContextMenu(object | null, screenPoint)`** — in the canvas `onContextMenu` handler keep `preventDefault()` and, if the prop exists, hit-test `selectable()` at the event point and call it.
- [ ] **Step 6:** Canvas tests, eslint, build. Commit — `feat(canvas): vertex editing, free polygon drawing and planner hooks in the viewport`

---

### Task 3: POS planner state and adapter (pure)

**Files:**
- Create: `apps/desktop/src/modules/runly.pos/lib/floorPlannerState.js` — move `DEFAULT_SIZES`, `elementsFromFloor` (now also reading `rotation: parseFloat(el.rotation ?? 0) || 0`), `canvasReducer` (add action `'APPLY'`: `{ patches: [{ id, ...fields }] }` merging fields into matching elements, clamping `x`/`y` ≥ 0 and `width`/`height` ≥ 20, rounding to 2 decimals; one history step), `useHistoryReducer`, and `layoutPayload(elements)` (the body of `handleSave`'s map, plus `rotation: el.rotation ?? 0`) out of `PosFloorPlannerScreen.jsx`.
- Create: `apps/desktop/src/modules/runly.pos/lib/plannerObjects.js` (+ `plannerObjects.test.js`)

- [ ] **Step 1: Failing test** — `lib/plannerObjects.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { objectToPatch, plannerToObjects } from './plannerObjects.js'
import { canvasReducer, layoutPayload } from './floorPlannerState.js'

describe('POS planner adapter', () => {
  const floor = { canvasWidth: 1200, canvasHeight: 800 }
  const elements = [
    { id: 'p', kind: 'POLYGON', x: 10, y: 10, width: 100, height: 50, rotation: 0, label: 'Área', color: 'vip', points: [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 60, y: 60 }] },
    { id: 't', kind: 'TABLE_SQUARE', x: 200, y: 100, width: 80, height: 80, rotation: 30, tableName: 'Mesa 1', capacity: 4, chairStyle: 'auto' },
  ]
  it('round-trips a polygon unchanged', () => {
    const objects = plannerToObjects({ floor, elements })
    const patch = objectToPatch(objects.find((o) => o.id === 'p'))
    for (let i = 0; i < 3; i += 1) {
      assert.ok(Math.abs(patch.points[i].x - elements[0].points[i].x) < 0.01 && Math.abs(patch.points[i].y - elements[0].points[i].y) < 0.01)
    }
  })
  it('maps table props for the planner drawer and back', () => {
    const table = plannerToObjects({ floor, elements }).find((o) => o.id === 't')
    assert.equal(table.type, 'pos.table')
    assert.equal(table.properties.planner, true)
    assert.deepEqual(objectToPatch({ ...table, transform: { ...table.transform, x: -5.123 } }), { id: 't', x: -5.12, y: 100, width: 80, height: 80, rotation: 30 })
  })
  it('APPLY clamps and the payload carries rotation', () => {
    const state = canvasReducer({ elements, dirty: false }, { type: 'APPLY', patches: [{ id: 't', x: -5, y: 3.456, width: 10, height: 90, rotation: 30 }] })
    const t = state.elements.find((e) => e.id === 't')
    assert.deepEqual({ x: t.x, y: t.y, width: t.width, height: t.height }, { x: 0, y: 3.46, width: 20, height: 90 })
    assert.equal(state.dirty, true)
    assert.equal(layoutPayload(state.elements).find((e) => e.id === 't').rotation, 30)
  })
})
```

- [ ] **Step 2: `plannerObjects.js`** — reuse `floorToObjects` ideas but from planner element state (numbers already parsed, `tableName`, `capacity`, `chairStyle`, `color`, `points`, `rotation`):
  - Surface first (`pos.surface`, `layerId: 'pos-surface'`), then zones/polygons, decor, tables — all other objects `layerId: 'pos'`.
  - Tables: `type: 'pos.table'`, `properties: { kind, round, capacity, chairStyle, name: tableName, status: 'AVAILABLE', dimmed: false, orphan: false, tableId, label, planner: true }`.
  - Polygons: `type: 'polygon'` with relative points (as in `floorObjects.js`), `style` from `POLYGON_ZONE_COLORS[color]` (`stroke`, `fill`, `fillOpacity: 1` since the colour already has alpha, `dash: 'dashed'`), `properties: { kind: 'POLYGON', label, zone: color }`.
  - Zones/decor as in `floorObjects.js` (`pos.zone`, `pos.decor`).
  - `objectToPatch(object)` → `{ id, x, y, width, height, rotation }` rounded to 2 decimals (no clamping here; the reducer clamps), plus `points` (absolute, via `absolutePoints` from the canvas engine, rounded to 2 decimals) for polygons.
  - Export `buildPlannerElement(kind, box, existing)` for creation (default sizes, names "Mesa N", zone label "Zona", polygon label "Área") — move that logic out of `handlePlace`.
- [ ] **Step 3: Planner table look** — in `floorDrawers.js`, when `properties.planner` is true draw the table with the planner palette of `TableSvg` (amber fill/stroke from `FloorCanvasHelpers.jsx`, theme-aware: read the dark/light values there) and show `name` + capacity; no status text.
- [ ] **Step 4:** Run `node --test apps/desktop/src/modules/runly.pos/lib/*.test.js` — PASS. Commit — `refactor(pos): planner state and canvas adapter as pure modules`

---

### Task 4: `FloorPlannerStage` and screen rewrite

**Files:**
- Create: `apps/desktop/src/modules/runly.pos/components/FloorPlannerStage.jsx`
- Modify: `apps/desktop/src/modules/runly.pos/screens/PosFloorPlannerScreen.jsx` (must end < 800 lines; target < 600)
- Delete: `components/FloorCanvas.jsx`, `components/FloorCanvasRulers.jsx`, and anything in `FloorCanvasOverlays.jsx`/`FloorCanvasDecor.jsx`/`FloorCanvasHelpers.jsx` no longer imported (keep `ContextMenuOverlay` if reused; keep whatever `FloorToolbox`/`FloorPropertiesPanel` import). Confirm with grep.

- [ ] **Step 1: Stage** — props `{ floor, elements, selectedId, onSelect, activeTool, onToolDone, onApply(patches), onPlace(kind, box|points), onContextAction(action, id), clipboardAvailable, showGrid, viewport, onViewportChange }`:
  - `objects = useMemo(() => plannerToObjects({ floor, elements }), [floor, elements])`.
  - `CanvasViewport` in edit mode: `tool` = `'select'` for `SELECT`, `'polygon-draw'` for `POLYGON`, otherwise the POS kind string; `creationTools = new Set(Object.keys(DEFAULT_SIZES).filter((k) => k !== 'POLYGON'))`; `draftFor(kind, box)` → planner object for `buildPlannerElement(kind, box)` (adapter); `onCreate({ tool, box, point, points })` → `onPlace(...)` then `onToolDone()`; `onCommit(changes)` → `onApply(changes.map(({ next }) => objectToPatch(next)))`; `onSelect(ids)` → `onSelect(ids[0] ?? null)` (single selection: if more than one id comes from a marquee, keep the first); `selectedIds={selectedId ? [selectedId] : []}`; `isSelectable={(o) => o.type !== 'pos.surface'}`; `lockedLayerIds={new Set(['pos-surface'])}`; `drawers={POS_DRAWERS}`; `grid={{ enabled: showGrid, size: 20 }}`; `snapSize={showGrid ? 20 : 0}`; `onContextMenu` → open `ContextMenuOverlay` at the screen point with the existing actions (copy, paste, duplicate, delete, bringForward, sendBackward; empty space → paste only when `clipboardAvailable`).
  - Hint pill top-centre like Canvas (texts from the spec).
  - Fit to the floor surface on first load per floor id (`fitBounds` of the surface, padding 48).
  - Floating controls bottom-right: Canvas `ZoomControls` plus a grid toggle button (icon `Grid3x3`, `aria-pressed`), same styling as the Canvas bottom-right controls.
- [ ] **Step 2: Screen** — `PosFloorPlannerScreen.jsx` imports state helpers from `lib/floorPlannerState.js`; replaces `FloorCanvas` with `FloorPlannerStage`; removes `zoom`, `showRulers` state and ruler/zoom keyboard shortcuts that the viewport already handles (keep Ctrl+Z/Y, Delete, Ctrl+C/V/D, arrows, Escape — implement arrow nudge and others through `APPLY`/existing actions); `handleSave` uses `layoutPayload`; `handlePlace` uses `buildPlannerElement`; keep toolbox, properties panel, mobile sheets, dialogs, Guardar/Publicar exactly as they are. Remove the old floating zoom/grid/ruler block (replaced by the stage's controls).
- [ ] **Step 3: Cleanup** — delete the now-unused files/exports; `grep -rn "FloorCanvasRulers\|from '../components/FloorCanvas'" apps/desktop/src` returns nothing.
- [ ] **Step 4: Verification + commit**

```bash
node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js apps/desktop/src/modules/runly.pos/lib/*.test.js
node --test apps/api/src/routes/canvas/__tests__/*.test.js
npx eslint <touched files>
pnpm --filter ./apps/desktop build:web
wc -l apps/desktop/src/modules/runly.pos/screens/PosFloorPlannerScreen.jsx
```

Commit — `feat(pos): floor planner on the Canvas engine without rulers`

- [ ] **Step 5: Canvas help** — add to the canvas help `overview.md` (no-accent style) under "Herramientas" or at the end: `Los poligonos muestran un punto en cada vertice cuando estan seleccionados: arrastralo para moverlo, arrastra el punto pequeno entre dos vertices para agregar uno nuevo y haz doble clic en un vertice para quitarlo.` Commit with Step 4 or separately.
