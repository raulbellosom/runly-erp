# Canvas × POS Operational View (6a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** POS waiter floor view renders through the Canvas engine (renderer + viewport) via an adapter, and POS tables become a Canvas data source.

**Architecture:** The renderer gains pluggable per-type drawers (`scene.drawers`); the viewport gains `drawers` passthrough and an `isTappable(object)` predicate for read-only taps. POS keeps its data; `runly.pos/lib/floorObjects.js` maps `PosFloorElement` + table states to canvas-shaped objects and `runly.pos/lib/floorDrawers.js` draws tables (with chairs and status), zones, decor and the floor surface. `FloorOperationalStage.jsx` replaces `FloorOperationalCanvas.jsx`.

**Tech Stack:** React, Canvas2D, Hono/Prisma (data source only), Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-02-canvas-pos-operational-design.md`

**Rules:** JavaScript only; UI text Spanish, code/comments English; no emojis; never start/stop dev servers (4010/5173); no file over 800 lines; tests with explicit globs; check touched files with `npx eslint <files>`; another session may commit concurrently — stage only your own files (no `git add -A`/`commit -a`). Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Engine extension points

**Files:** `apps/desktop/src/modules/runly.canvas/engine/Canvas2DRenderer.js`, `components/CanvasViewport.jsx`, `engine/geometry.js` (only if needed)

- [ ] **Step 1:** Renderer: `render(scene)` reads `drawers = {}`. In `drawObject`, after computing the box and before the `switch`, if `drawers[object.type]` exists: translate/rotate exactly like box objects, call `drawers[object.type](ctx, object, { x, y, w, h, zoom, theme: this.theme })`, `ctx.restore()` and return. Custom types are never linear.
- [ ] **Step 2:** Viewport: pass `drawers: p.drawers ?? {}` into `renderer.render`. In the read-only branch of `pointerDown`, replace `tapHotspot: hit?.type === 'hotspot' ? hit : null` with `tapTarget: hit && (p.isTappable ? p.isTappable(hit) : hit.type === 'hotspot') ? hit : null`, and in `pointerUp` use `drag?.tapTarget` (same `onOpen` call). In the mouse-hover cursor logic for read-only, use the same predicate for `'pointer'`.
- [ ] **Step 3:** Run canvas tests/eslint/build; commit — `feat(canvas): pluggable drawers and tappable objects in the engine`

---

### Task 2: POS adapter and drawers (pure + tested)

**Files:**
- Create: `apps/desktop/src/modules/runly.pos/lib/chairs.js` — move `CHAIR_PAD`, `squareChairPositions`, `roundChairPositions` out of `components/FloorCanvasHelpers.jsx` verbatim; `FloorCanvasHelpers.jsx` re-exports them (`export { CHAIR_PAD, squareChairPositions, roundChairPositions } from '../lib/chairs.js'`) so the planner keeps working.
- Create: `apps/desktop/src/modules/runly.pos/lib/tableStatus.js` — move `TABLE_STATUS_STYLE` (and default) from `FloorOperationalCanvas.jsx` verbatim.
- Create: `apps/desktop/src/modules/runly.pos/lib/floorObjects.js` (+ `floorObjects.test.js`)
- Create: `apps/desktop/src/modules/runly.pos/lib/floorDrawers.js`

- [ ] **Step 1: Failing test** — `lib/floorObjects.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { floorToObjects, isTableObject } from './floorObjects.js'

describe('POS floor adapter', () => {
  const floor = { canvasWidth: 1200, canvasHeight: 800 }
  const elements = [
    { id: 'z', kind: 'FLOOR_ZONE', x: '0', y: '0', width: '400', height: '300', rotation: '0', label: 'Terraza', style: { color: 'outdoor' } },
    { id: 'p', kind: 'POLYGON', x: '10', y: '10', width: '100', height: '50', rotation: '0', style: { points: [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 60, y: 60 }], color: 'vip' } },
    { id: 't', kind: 'TABLE_ROUND', tableId: 'tab-1', x: '500.50', y: '200', width: '80', height: '80', rotation: '15', label: 'M1', style: { capacity: 4 } },
    { id: 'w', kind: 'WALL', x: '0', y: '0', width: '10', height: '300', rotation: '0' },
  ]
  const tableStates = { 'tab-1': { id: 'tab-1', name: 'Mesa 1', status: 'OCCUPIED', capacity: 6, isMine: false } }
  const objects = floorToObjects({ floor, elements, tableStates })

  it('starts with the floor surface and keeps zones/polygons below tables', () => {
    assert.equal(objects[0].type, 'pos.surface')
    assert.deepEqual(objects[0].geometry, { width: 1400, height: 900 })
    const order = objects.map((o) => o.id)
    assert.ok(order.indexOf('z') < order.indexOf('t') && order.indexOf('p') < order.indexOf('t'))
  })
  it('converts decimals, rotation and polygon points', () => {
    const table = objects.find((o) => o.id === 't')
    assert.deepEqual(table.transform, { x: 500.5, y: 200, rotation: 15, scaleX: 1, scaleY: 1 })
    assert.deepEqual(table.properties, { kind: 'TABLE_ROUND', round: true, capacity: 6, chairStyle: 'auto', name: 'Mesa 1', status: 'OCCUPIED', dimmed: true, tableId: 'tab-1', label: 'M1' })
    assert.ok(isTableObject(table))
    const polygon = objects.find((o) => o.id === 'p')
    assert.equal(polygon.type, 'polygon')
    assert.deepEqual(polygon.geometry.points, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }])
  })
  it('falls back to the element label and AVAILABLE without a table', () => {
    const [, , , , wall] = objects
    const solo = floorToObjects({ floor, elements: [{ id: 'x', kind: 'TABLE_SQUARE', x: 0, y: 0, width: 60, height: 60, label: 'B2', style: { capacity: 2 } }], tableStates: {} }).find((o) => o.id === 'x')
    assert.equal(solo.properties.status, 'AVAILABLE')
    assert.equal(solo.properties.name, 'B2')
    assert.equal(solo.properties.dimmed, false)
    assert.ok(wall === undefined || wall.type === 'pos.decor')
  })
})
```

- [ ] **Step 2: `floorObjects.js`**

```js
// Maps POS floor elements (PosFloorElement + live table states) to the object
// shape the Canvas engine draws. POS data stays in POS; this is view-only.
const num = (value, fallback = 0) => { const n = Number.parseFloat(value); return Number.isFinite(n) ? n : fallback }
const TABLE_KINDS = new Set(['TABLE_SQUARE', 'TABLE_ROUND'])
export const isTableObject = (object) => object?.type === 'pos.table'

function base(el, type) {
  return {
    id: el.id, type,
    transform: { x: num(el.x), y: num(el.y), rotation: num(el.rotation), scaleX: 1, scaleY: 1 },
    geometry: { width: num(el.width, 1), height: num(el.height, 1) },
    style: {},
  }
}

function polygonObject(el) {
  const object = base(el, 'polygon'), points = el.style?.points ?? []
  const { x, y } = object.transform, { width, height } = object.geometry
  const zone = el.style?.color ?? 'neutral'
  object.geometry.points = points.length > 2
    ? points.map((p) => ({ x: (num(p.x) - x) / (width || 1), y: (num(p.y) - y) / (height || 1) }))
    : [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
  object.properties = { kind: 'POLYGON', zone, label: el.label ?? null }
  return object
}

export function floorToObjects({ floor, elements = [], tableStates = {} }) {
  const surface = {
    id: '__surface__', type: 'pos.surface',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    geometry: { width: Math.max(num(floor?.canvasWidth, 1400), 1400), height: Math.max(num(floor?.canvasHeight, 900), 900) },
    style: {}, properties: {},
  }
  const below = [], decor = [], tables = []
  for (const el of elements) {
    if (el.kind === 'POLYGON') below.push(polygonObject(el))
    else if (el.kind === 'FLOOR_ZONE') below.push({ ...base(el, 'pos.zone'), properties: { kind: el.kind, label: el.label ?? null, color: el.style?.color ?? el.color ?? 'neutral' } })
    else if (TABLE_KINDS.has(el.kind)) {
      const table = el.tableId ? tableStates[el.tableId] : null
      tables.push({
        ...base(el, 'pos.table'),
        properties: {
          kind: el.kind, round: el.kind === 'TABLE_ROUND',
          capacity: table?.capacity ?? el.style?.capacity ?? 0, chairStyle: el.style?.chairStyle ?? 'auto',
          name: table?.name ?? el.label ?? '', status: table?.status ?? 'AVAILABLE',
          dimmed: table?.isMine === false, tableId: el.tableId ?? null, label: el.label ?? null,
        },
      })
    } else decor.push({ ...base(el, 'pos.decor'), properties: { kind: el.kind, label: el.label ?? null } })
  }
  return [surface, ...below, ...decor, ...tables]
}
```

Adjust the zone colour source after reading how `FloorCanvasDecor.jsx` reads it (`el.color` vs `el.style.color`) and make the test match the real field.

- [ ] **Step 3: `floorDrawers.js`** — export `POS_DRAWERS = { 'pos.surface', 'pos.zone', 'pos.decor', 'pos.table' }`, each `(ctx, object, { x, y, w, h, zoom, theme })` drawing in the box-local frame (origin = box centre already translated/rotated by the renderer; `x, y` = top-left offsets, i.e. `-w/2, -h/2`):
  - `pos.surface`: `theme.surface` filled rounded rect (radius 8) with a 1 px `theme.muted`-ish border and an inner dashed border inset 12 (mirrors the current card look).
  - `pos.zone`: dashed rounded rect, stroke/fill from `POLYGON_ZONE_COLORS[color]` (import from `../components/FloorCanvasDecor.jsx` → move that constant to `lib/zoneColors.js` and re-export it from the decor file), label top-left at 12 px / zoom-independent world size 12.
  - `pos.decor`: simple vector icons per `kind`, matching the current colours from `FloorCanvasDecor.jsx` (read it): WALL dark filled rect; BAR rounded stone rect; PLANT green circle with leaves; DOOR quarter-circle arc + leaf line; PILLAR filled square; SOFA rounded violet rect with back; WINDOW double thin sky line; STAIRS rect with step stripes; label centred when present.
  - `pos.table`: port `OperationalTable` from `FloorOperationalCanvas.jsx`: chairs from `squareChairPositions`/`roundChairPositions` (positions are relative to the table box with `CHAIR_PAD`; translate accordingly), table fill/ring from `TABLE_STATUS_STYLE[status]` with `ringWidth`, name (ellipsis > 9 chars, font size `Math.min(13, Math.max(9, w / 6))`), status label when `h > 52`, global alpha 0.35 when `dimmed`.
- [ ] **Step 4:** Run `node --test apps/desktop/src/modules/runly.pos/lib/*.test.js` — PASS. eslint. Commit — `feat(pos): adapter and drawers to render floors with the Canvas engine`

---

### Task 3: Operational stage

**Files:**
- Create: `apps/desktop/src/modules/runly.pos/components/FloorOperationalStage.jsx`
- Modify: `apps/desktop/src/modules/runly.pos/screens/PosTablesScreen.jsx`
- Delete: `apps/desktop/src/modules/runly.pos/components/FloorOperationalCanvas.jsx` (after confirming with grep that nothing else imports it, and after moving its constants in Task 2)

- [ ] **Step 1:** `FloorOperationalStage({ floor, elements, tableStates, onTableClick })`:
  - `objects = useMemo(() => floorToObjects({ floor, elements, tableStates }), [...])`.
  - Viewport state `useState(DEFAULT_VIEWPORT)` and `size`; fit once per floor id (and on "Ajustar") with `fitBounds(sceneBounds(objects), size, 32)` but allowing zoom > 1 up to 2 on small floors (compute like `renderScene` export fit and clamp to `[MIN_ZOOM, 2]`).
  - Render `<CanvasViewport objects={objects} readOnly tool="select" spacePan={false} viewport={viewport} onViewportChange={setViewport} onResize={setSize} onSelect={() => {}} onOpen={(object) => { if (isTableObject(object)) onTableClick?.(tableArgument(object)) }} isTappable={isTableObject} drawers={POS_DRAWERS} selectedIds={[]} lockedLayerIds={new Set()} images={new Map()} linkedIds={new Set()} grid={{ enabled: false }} />` inside a `relative h-full w-full` container. Read `CanvasViewport` props and pass every required prop with a safe default.
  - `tableArgument(object)`: whatever the old component passed to `onTableClick` (read `OperationalTable`'s `onClick` call and `PosTablesScreen.handleTableClick`) — reproduce exactly (likely the table state object or `{ el, table }`).
  - Zoom controls bottom-right: reuse `runly.canvas/components/ZoomControls.jsx` (`onZoomIn`, `onZoomOut`, `onReset`, `onFit`), with `zoomAt` around the centre.
  - Keep any legend/empty state the old component had (read it); if the old component showed nothing for an empty floor, keep the surface + fit.
- [ ] **Step 2:** `PosTablesScreen.jsx`: import `FloorOperationalStage` instead of `FloorOperationalCanvas` with the same props.
- [ ] **Step 3:** Delete `FloorOperationalCanvas.jsx`; `grep -rn "FloorOperationalCanvas" apps/desktop/src` must return nothing.
- [ ] **Step 4:** eslint, build; commit — `feat(pos): waiter floor view on the Canvas engine`

---

### Task 4: `pos_table` data source

**Files:** `apps/api/src/routes/canvas/canvas-data-sources.js` (+ test), help `apps/api/src/manifests/official/help/runly.canvas/overview.md`

- [ ] **Step 1: Failing test** (append to `canvas-data-sources.test.js`):

```js
  it('describes POS tables by status', async () => {
    const prisma = prismaWith({
      posTable: { findMany: async ({ where }) => { assert.equal(where.companyId, COMPANY); return [{ id: 't1', name: 'Mesa 4', status: 'OCCUPIED', capacity: 4, zone: { name: 'Terraza' }, floor: { name: 'Planta baja' } }] } },
    })
    const sources = createCanvasDataSources({ prisma, access: allowAll, relationTargets: {} })
    const result = await sources.resolve({ authUserId: 'auth-1', companyId: COMPANY, refs: [{ source: 'pos_table', id: 't1' }] })
    assert.equal(result['pos_table:t1'].tone, 'warning')
    assert.equal(result['pos_table:t1'].summary, 'Ocupada · 4 personas')
    assert.equal(result['pos_table:t1'].subtitle, 'Terraza · Planta baja')
  })
```

(`prismaWith`'s `runlyModule.findMany` must also list `runly.pos` for catalog tests if any assert it; adjust only if needed.)

- [ ] **Step 2: Implement** — add to `DATA_SOURCES`: `pos_table: { label: 'Mesa de POS', module: 'runly.pos', permission: 'pos.floor.read' }`. Provider:

```js
    async pos_table(companyId, ids) {
      const rows = await prisma.posTable.findMany({ where: { companyId, id: { in: ids }, enabled: true }, select: { id: true, name: true, status: true, capacity: true, zone: { select: { name: true } }, floor: { select: { name: true } } } })
      return new Map(rows.map((row) => {
        const status = POS_STATUS[row.status] ?? { label: row.status, tone: 'neutral' }
        return [row.id, {
          title: row.name, subtitle: [row.zone?.name, row.floor?.name].filter(Boolean).join(' · ') || null,
          summary: `${status.label} · ${plural(row.capacity, 'persona', 'personas')}`, tone: status.tone,
          metrics: [{ label: 'Estado', value: status.label }, { label: 'Capacidad', value: String(row.capacity) }],
          url: '/app/m/runly.pos',
        }]
      }))
    },
```

with `const POS_STATUS = { AVAILABLE: { label: 'Disponible', tone: 'ok' }, RESERVED: { label: 'Reservada', tone: 'info' }, OCCUPIED: { label: 'Ocupada', tone: 'warning' }, BILL_REQUESTED: { label: 'Cuenta pedida', tone: 'danger' }, DIRTY: { label: 'Sucia', tone: 'neutral' }, DISABLED: { label: 'No disponible', tone: 'neutral' } }`. Search for `pos_table` in `search()`: `prisma.posTable.findMany({ where: { companyId, enabled: true, name contains q }, select: { id, name, floor: { select: { name } } }, orderBy: { name: 'asc' }, take: 20 })` → `{ id, title: name, subtitle: floor name }`. Verify the real `pos.floor.read` permission key and the POS module key (`runly.pos`) by grepping the POS routes/manifest; use the real ones.
- [ ] **Step 3:** Help — in the "Datos Runly" bullet of the canvas help add "una mesa de POS (se ve libre, ocupada o con cuenta pedida)".
- [ ] **Step 4: Verification + commit**

```bash
node --test apps/api/src/routes/canvas/__tests__/*.test.js
node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js apps/desktop/src/modules/runly.pos/lib/*.test.js
npx eslint <touched files>
pnpm --filter ./apps/desktop build:web
```

Commit — `feat(canvas): POS tables as a data source`
