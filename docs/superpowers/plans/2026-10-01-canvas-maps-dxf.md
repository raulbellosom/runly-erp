# Canvas Maps and DXF (Phase 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map backgrounds (MapLibre + OpenFreeMap, Nominatim geocoding through an API proxy) with automatic metre scale, a "Mapa de sitio" template, and DXF import as a calibrated image.

**Architecture:** Pure geo maths (`lib/geo.js`) maps lat/lng ↔ world metres on a tangent plane at the page origin and derives the MapLibre camera from the canvas viewport. A lazily loaded `MapBackdrop` renders a non-interactive MapLibre map beneath the transparent canvas and follows the viewport with `jumpTo`. The API validates map backgrounds (setting calibration automatically), serves map config and proxies geocoding with a 1 req/s queue and 24 h cache. DXF files are parsed client-side with `dxf-parser`, drawn onto a canvas and inserted through the existing image pipeline, calibrating the page from `$INSUNITS`.

**Tech Stack:** Hono, React, `maplibre-gl` (new), `dxf-parser` (new), Canvas2D, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-01-canvas-maps-dxf-design.md`

**Rules:** JavaScript only; UI text Spanish, code/comments English; no emojis; `@runly/ui` components (check real props); modal header/footer fixed; never start/stop dev servers (4010/5173); no file over 800 lines (`canvas-service.js` ~674 lines: new API logic goes in new modules); tests with explicit globs; check touched files with `npx eslint <files>` (8 pre-existing `custom.encuestas` lint errors are unrelated); add dependencies with `pnpm --filter ./apps/desktop add <pkg>`. Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: API — map background validation, map config, geocode proxy, template

**Files:**
- Create: `apps/api/src/routes/canvas/canvas-background.js` (+ test)
- Create: `apps/api/src/routes/canvas/canvas-geocoder.js` (+ test)
- Modify: `canvas-service.js` (`updatePage`, `createPage`), `canvas-routes.js`, `canvas-templates.js`, `apps/api/src/index.js` (router options if needed), `packages/sdk/src/domains/canvas.js`, `.env.example`

- [ ] **Step 1: Failing tests**

`__tests__/canvas-background.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AUTO_CALIBRATION, pageGeoPatch } from '../canvas-background.js'

describe('Map page background', () => {
  it('sets metre calibration and geo coordinates for a map background', () => {
    const patch = pageGeoPatch({ type: 'map', origin: { lat: 19.43, lng: -99.13 }, label: 'Zócalo', bbox: [19.4, 19.5, -99.2, -99.1] }, null)
    assert.deepEqual(patch.calibration, AUTO_CALIBRATION)
    assert.deepEqual(patch.coordinateSystem, { unit: 'm', axis: 'geo', origin: { lat: 19.43, lng: -99.13 } })
    assert.equal(patch.background.label, 'Zócalo')
  })
  it('rejects invalid coordinates', () => {
    for (const bad of [{ type: 'map', origin: { lat: 95, lng: 0 } }, { type: 'map', origin: { lat: 0, lng: 200 } }, { type: 'map', origin: { lat: 0, lng: 0 }, bbox: [1, 2] }]) {
      assert.throws(() => pageGeoPatch(bad, null), (error) => error.status === 400)
    }
  })
  it('removing the map clears only the automatic calibration', () => {
    assert.deepEqual(pageGeoPatch(null, { calibration: AUTO_CALIBRATION, background: { type: 'map' } }), { background: null, calibration: null, coordinateSystem: { unit: 'px', origin: { x: 0, y: 0 }, axis: 'screen' } })
    const manual = { a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, distance: 2, unit: 'm' }
    assert.equal(pageGeoPatch(null, { calibration: manual, background: { type: 'map' } }).calibration, undefined)
  })
  it('passes other backgrounds through untouched', () => {
    assert.deepEqual(pageGeoPatch({ type: 'blank' }, null), { background: { type: 'blank' } })
  })
})
```

`__tests__/canvas-geocoder.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createGeocoder } from '../canvas-geocoder.js'

describe('Canvas geocoder proxy', () => {
  it('maps Nominatim results, sends a User-Agent and caches repeated queries', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), ua: init.headers['User-Agent'] })
      return { ok: true, json: async () => [{ display_name: 'Zócalo, CDMX', lat: '19.4326', lon: '-99.1332', boundingbox: ['19.43', '19.44', '-99.14', '-99.13'] }] }
    }
    const geocoder = createGeocoder({ env: {}, fetchImpl, minIntervalMs: 0 })
    const first = await geocoder.search('zocalo')
    const second = await geocoder.search('  ZOCALO ')
    assert.deepEqual(first, [{ label: 'Zócalo, CDMX', lat: 19.4326, lng: -99.1332, bbox: [19.43, 19.44, -99.14, -99.13] }])
    assert.deepEqual(second, first)
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /nominatim\.openstreetmap\.org\/search\?/)
    assert.equal(calls[0].ua, 'RunlyERP/1.0')
  })
  it('validates input and can be disabled', async () => {
    const geocoder = createGeocoder({ env: { CANVAS_MAPS: 'false' }, fetchImpl: async () => ({ ok: true, json: async () => [] }) })
    await assert.rejects(() => geocoder.search('x'), (error) => error.status === 503)
    const enabled = createGeocoder({ env: {}, fetchImpl: async () => ({ ok: true, json: async () => [] }) })
    await assert.rejects(() => enabled.search('   '), (error) => error.status === 400)
    assert.deepEqual(enabled.mapConfig(), { enabled: true, styleUrl: 'https://tiles.openfreemap.org/styles/liberty', attribution: '© OpenStreetMap' })
  })
})
```

- [ ] **Step 2: `canvas-background.js`**

```js
// Page backgrounds. A map background fixes the page to metres on a tangent
// plane at `origin`, so it also sets calibration and coordinate system.
export const AUTO_CALIBRATION = Object.freeze({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, distance: 100, unit: 'm' })
const SCREEN = { unit: 'px', origin: { x: 0, y: 0 }, axis: 'screen' }
const invalid = () => Object.assign(new Error('El fondo de mapa no es válido.'), { status: 400 })
const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const sameCalibration = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Returns the page fields to write for a new `background` (current = page row).
export function pageGeoPatch(background, current) {
  if (background === null) {
    if (current?.background?.type !== 'map') return { background: null }
    return { background: null, coordinateSystem: SCREEN, ...(sameCalibration(current.calibration, AUTO_CALIBRATION) ? { calibration: null } : {}) }
  }
  if (background?.type !== 'map') return { background }
  const { lat, lng } = background.origin ?? {}
  if (!finite(lat) || !finite(lng) || lat < -85 || lat > 85 || lng < -180 || lng > 180) throw invalid()
  const bbox = background.bbox ?? null
  if (bbox !== null && (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(finite))) throw invalid()
  const origin = { lat, lng }
  return {
    background: { type: 'map', origin, label: typeof background.label === 'string' ? background.label.slice(0, 300) : null, bbox },
    calibration: { ...AUTO_CALIBRATION },
    coordinateSystem: { unit: 'm', axis: 'geo', origin },
  }
}
```

Note the second removal test expects `calibration` to be absent (`undefined`) when it was manual.

- [ ] **Step 3: `canvas-geocoder.js`**

```js
// Geocoding proxy for map pages. Nominatim's policy asks for an identifying
// User-Agent, at most one request per second and caching, so every search
// goes through one queue and a 24 h in-memory cache.
const DEFAULT_GEOCODER = 'https://nominatim.openstreetmap.org'
const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const DAY_MS = 86_400_000
const fail = (message, status) => Object.assign(new Error(message), { status })

export function createGeocoder({ env = process.env, fetchImpl = fetch, minIntervalMs = 1000 } = {}) {
  const enabled = env.CANVAS_MAPS !== 'false'
  const base = (env.CANVAS_GEOCODER_URL || DEFAULT_GEOCODER).replace(/\/+$/, '')
  const cache = new Map()
  let queue = Promise.resolve(), lastAt = 0

  function mapConfig() {
    return { enabled, styleUrl: env.CANVAS_MAP_STYLE_URL || DEFAULT_STYLE, attribution: '© OpenStreetMap' }
  }

  async function request(q) {
    const wait = Math.max(0, lastAt + minIntervalMs - Date.now())
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    lastAt = Date.now()
    const url = `${base}/search?${new URLSearchParams({ format: 'jsonv2', limit: '5', q })}`
    const response = await fetchImpl(url, { headers: { 'User-Agent': 'RunlyERP/1.0', 'Accept-Language': 'es' } })
    if (!response.ok) throw fail('El servicio de mapas no respondió.', 503)
    const rows = await response.json()
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      label: row.display_name, lat: Number(row.lat), lng: Number(row.lon),
      bbox: Array.isArray(row.boundingbox) ? row.boundingbox.map(Number) : null,
    }))
  }

  async function search(input) {
    if (!enabled) throw fail('Los mapas están desactivados en esta instancia.', 503)
    const q = String(input ?? '').trim()
    if (!q || q.length > 200) throw fail('Escribe una dirección o lugar (máximo 200 caracteres).', 400)
    const key = q.toLowerCase()
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < DAY_MS) return hit.rows
    const job = queue.then(() => request(q))
    queue = job.catch(() => {})
    let rows
    try { rows = await job } catch (error) { throw error.status ? error : fail('El servicio de mapas no respondió.', 503) }
    cache.set(key, { at: Date.now(), rows })
    if (cache.size > 500) cache.delete(cache.keys().next().value)
    return rows
  }

  return { search, mapConfig }
}
```

- [ ] **Step 4: Wire into service/routes/templates/SDK/env**
  - `canvas-service.js` `updatePage`: remove `'background'` and `'coordinateSystem'` from the generic loop handling when `data.background !== undefined`: `Object.assign(patch, backgroundPatch(data.background, page))` where `backgroundPatch` wraps `pageGeoPatch` converting its error into `CanvasServiceError(…, 400)`; then, if `data.calibration !== undefined` was also sent, the explicit calibration wins (apply it after). `createPage`: if `data.background` is a map, merge `pageGeoPatch(data.background, null)` into the create data.
  - `canvas-routes.js`: `createCanvasRouter({ …, geocoder = createGeocoder() })`; routes (before `/canvas/boards/:boardId`):

```js
  app.get('/canvas/map-config', requirePermission('canvas.view'), (c) => c.json({ data: geocoder.mapConfig() }))
  app.get('/canvas/geocode', requirePermission('canvas.view'), async (c) => {
    try { return c.json({ data: await geocoder.search(c.req.query('q')) }) }
    catch (error) { return errorResponse(c, error, 'Error al buscar la dirección.') }
  })
```

  - `canvas-templates.js`: new template appended to `CANVAS_TEMPLATES`:

```js
  {
    key: 'site-map', label: 'Mapa de sitio', icon: 'globe', preview: 'site-map',
    description: 'Sobre un mapa real',
    useWhen: 'Quieres marcar sucursales, terrenos, obras o rutas sobre un mapa con medidas en metros.',
    includes: ['Fondo de mapa de OpenStreetMap', 'Medidas en metros sin calibrar', 'Capas: Zonas, Puntos y Datos Runly'],
    namePlaceholder: 'Ej. Sucursales zona norte',
    settings: settings(false, 24, false),
    layers: [{ name: 'Zonas', type: 'vector' }, { name: 'Puntos', type: 'hotspot' }, { name: 'Datos Runly', type: 'data' }],
    emptyState: { title: 'Ubica tu sitio en el mapa', description: 'Busca una dirección o lugar para usar el mapa como fondo de esta página.', action: { label: 'Ubicar en el mapa', kind: 'map' } },
  },
```

  Update the catalog test that lists exactly six keys to include `'site-map'`.
  - SDK: `getMapConfig: (token) => send('GET', '/canvas/map-config', undefined, token)`, `geocode: (q, token) => send('GET', `/canvas/geocode${toQueryString({ q })}`, undefined, token)`.
  - `.env.example`: add commented lines documenting `CANVAS_MAPS`, `CANVAS_MAP_STYLE_URL`, `CANVAS_GEOCODER_URL` (defaults described, no values required).

- [ ] **Step 5: Run** `node --test apps/api/src/routes/canvas/__tests__/*.test.js` and `node --check apps/api/src/index.js` — PASS. **Commit** — `feat(canvas): map page backgrounds, map config and geocoding proxy`

---

### Task 2: Geo maths + map backdrop + location dialog (desktop)

**Files:**
- Create: `apps/desktop/src/modules/runly.canvas/lib/geo.js` (+ `geo.test.js`)
- Create: `components/MapBackdrop.jsx`, `components/MapLocationDialog.jsx`
- Modify: `lib/boardTemplates.js` (`parseEmptyAction` accepts `'map'`), `lib/templatePreviews.js` (`site-map` preview), `lib/boardMeta.js` (`globe` icon → `Globe`), `components/ScaleControl.jsx` (menu "Fondo de mapa…", label "Mapa · metros"), `screens/BoardEditor.jsx` (or `hooks/usePageScale.js`), `hooks/useCanvasData.js`

- [ ] **Step 1: Failing test** — `lib/geo.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createGeoFrame, mapCamera, worldBoundsOfBbox } from './geo.js'

describe('Canvas geo frame', () => {
  const frame = createGeoFrame({ lat: 19.4326, lng: -99.1332 })
  it('round-trips lat/lng through world metres', () => {
    const world = frame.toWorld({ lat: 19.44, lng: -99.12 })
    const back = frame.toLatLng(world)
    assert.ok(Math.abs(back.lat - 19.44) < 1e-6 && Math.abs(back.lng + 99.12) < 1e-6)
    assert.deepEqual(frame.toWorld({ lat: 19.4326, lng: -99.1332 }), { x: 0, y: 0 })
  })
  it('world units are close to ground metres near the origin', () => {
    const east = frame.toWorld({ lat: 19.4326, lng: -99.1332 + 0.001 })
    assert.ok(Math.abs(east.x - 104.9) < 0.5, String(east.x))
    assert.ok(frame.toWorld({ lat: 19.4336, lng: -99.1332 }).y < 0)
  })
  it('derives the MapLibre camera from the canvas viewport', () => {
    const equator = createGeoFrame({ lat: 0, lng: 0 })
    const cam = mapCamera({ x: 400, y: 300, zoom: 1 }, { width: 800, height: 600 }, equator)
    assert.ok(Math.abs(cam.zoom - Math.log2(40075016.686 / 512)) < 0.001)
    assert.ok(Math.abs(cam.center.lat) < 1e-9 && Math.abs(cam.center.lng) < 1e-9)
  })
  it('converts a bbox to world bounds', () => {
    const b = worldBoundsOfBbox([19.43, 19.44, -99.14, -99.13], frame)
    assert.ok(b.width > 0 && b.height > 0)
  })
})
```

- [ ] **Step 2: `lib/geo.js`**

```js
// Web Mercator (EPSG:3857) and a local tangent frame: world units are
// mercator metres scaled by cos(lat0), i.e. ~ground metres near the origin,
// with y growing south like the canvas.
const R = 6378137, EARTH = 40075016.686, TILE = 512
const rad = (deg) => (deg * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI

export function mercator({ lat, lng }) {
  return { x: R * rad(lng), y: R * Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2)) }
}
export function inverseMercator({ x, y }) {
  return { lat: deg(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2), lng: deg(x / R) }
}

export function createGeoFrame(origin) {
  const o = mercator(origin), k = Math.cos(rad(origin.lat))
  return {
    origin, k,
    toWorld(point) { const m = mercator(point); return { x: (m.x - o.x) * k + 0, y: -(m.y - o.y) * k + 0 } },
    toLatLng(world) { return inverseMercator({ x: o.x + world.x / k, y: o.y - world.y / k }) },
  }
}

// MapLibre camera matching a canvas viewport (screen = world * zoom + offset).
export function mapCamera(viewport, size, frame) {
  const center = frame.toLatLng({ x: (size.width / 2 - viewport.x) / viewport.zoom, y: (size.height / 2 - viewport.y) / viewport.zoom })
  return { center, zoom: Math.log2((EARTH * frame.k * viewport.zoom) / TILE) }
}

// Nominatim bbox [south, north, west, east] -> world rectangle.
export function worldBoundsOfBbox(bbox, frame) {
  const [south, north, west, east] = bbox
  const a = frame.toWorld({ lat: north, lng: west }), b = frame.toWorld({ lat: south, lng: east })
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}
```

(The `+ 0` normalises `-0` so `deepEqual` with `{ x: 0, y: 0 }` passes.)

- [ ] **Step 3: Dependency** — `pnpm --filter ./apps/desktop add maplibre-gl`.

- [ ] **Step 4: `MapBackdrop.jsx`** — props `{ background, viewport, size, config }`:
  - `useEffect` lazily `import('maplibre-gl')` and its CSS (`import('maplibre-gl/dist/maplibre-gl.css')`), creates `new maplibregl.Map({ container, style: config.styleUrl, interactive: false, attributionControl: { compact: true }, center, zoom, fadeDuration: 0 })` once per `background.origin`/style; removes it on unmount/change. On `error` events that prevent the style from loading, set a `failed` state.
  - `useEffect` on `[viewport, size]`: `map.jumpTo(mapCamera(viewport, size, frame))` clamped to zoom 0–22 (`frame = useMemo(() => createGeoFrame(background.origin))`).
  - Renders `<div ref className="pointer-events-none absolute inset-0" aria-hidden />` and, when `failed`, a small `glass` pill bottom-left "No se pudo cargar el mapa". Keep MapLibre's attribution control visible.
  - Only rendered when `background?.type === 'map'` and `config?.enabled`.

- [ ] **Step 5: `MapLocationDialog.jsx`** — props `{ open, onOpenChange, current, hasObjects, onSave(background), onRemove(), pending }`. Search form (Input + "Buscar" button, submit on Enter) calling `runly.canvas.geocode` via a `useMutation`; results list (selectable rows with label); footer "Usar este lugar" (saves `{ type: 'map', origin: { lat, lng }, label, bbox }`), and when `current` is a map, "Quitar mapa" (with `ConfirmDialog` when `hasObjects`). Note under the title when the page has a manual calibration: "La escala manual de esta página se reemplazará por metros del mapa.". Errors via toast.

- [ ] **Step 6: Editor wiring** (keep `BoardEditor.jsx` ≤ ~360 lines; put logic in `hooks/usePageScale.js` or a new `hooks/usePageMap.js`):
  - `useMapConfig()` hook in `useCanvasData.js` (`runly.canvas.getMapConfig`, `staleTime: Infinity`).
  - Render `<MapBackdrop background={activePage?.background} viewport={viewport} size={size} config={mapConfig.data} />` inside the viewport container **before** `<CanvasViewport>` so the canvas paints above it; when the page has a map, pass `grid={{ ...settings.grid, enabled: false }}` to the viewport unless the user explicitly enabled the grid in this session (simplest: disable grid on map pages).
  - Save: `updatePage.mutate({ pageId, data: { background } })`; then fit the viewport to `worldBoundsOfBbox(bbox, createGeoFrame(origin))` (or a 300 m box around the origin when there is no bbox) with `fitBounds`; toast "Mapa ubicado". Remove: `data: { background: null }`, toast "Mapa quitado".
  - `parseEmptyAction('map')` → `{ type: 'map' }`; the empty-state handler opens the dialog.
  - `ScaleControl`: when the page has a map show "Mapa · metros"; menu item "Fondo de mapa…" (editors) opens the dialog.
  - Template preview `site-map`: a few soft rects (blocks), a line path (street) and two accent circles. Icon map: `globe: Globe`.

- [ ] **Step 7: Tests, eslint, build; commit** — `feat(canvas): map backgrounds that follow the canvas, with address search`

---

### Task 3: DXF import

**Files:**
- Create: `apps/desktop/src/modules/runly.canvas/lib/dxf.js` (+ `dxf.test.js`)
- Modify: `lib/media.js` (`isDxf`), `hooks/useMediaInsert.js`, `screens/BoardEditor.jsx` (file input `accept`), help `overview.md`

- [ ] **Step 1: Dependency** — `pnpm --filter ./apps/desktop add dxf-parser`.

- [ ] **Step 2: Failing test** — `lib/dxf.test.js` (pure parts only):

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DXF_UNITS, collectSegments, drawingExtents, unitOf } from './dxf.js'

describe('DXF import helpers', () => {
  it('maps $INSUNITS to calibration units and metres', () => {
    assert.deepEqual(unitOf(4), { unit: 'mm', toUnit: 1 })
    assert.deepEqual(unitOf(6), { unit: 'm', toUnit: 1 })
    assert.deepEqual(unitOf(1), { unit: 'ft', toUnit: 1 / 12 })
    assert.equal(unitOf(0), null)
    assert.ok(DXF_UNITS[5])
  })
  it('flattens lines, polylines, circles and block inserts into segments', () => {
    const dxf = {
      entities: [
        { type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
        { type: 'LWPOLYLINE', shape: true, vertices: [{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 5, y: 5 }] },
        { type: 'CIRCLE', center: { x: 20, y: 20 }, radius: 2 },
        { type: 'INSERT', name: 'B', position: { x: 100, y: 0 }, xScale: 2, yScale: 2, rotation: 0 },
      ],
      blocks: { B: { entities: [{ type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }] } },
    }
    const { segments, circles } = collectSegments(dxf)
    assert.equal(segments.filter((s) => s.length === 2).length >= 4, true)
    assert.deepEqual(segments.at(-1), [{ x: 100, y: 0 }, { x: 102, y: 0 }])
    assert.deepEqual(circles, [{ x: 20, y: 20, r: 2 }])
    const e = drawingExtents({ segments, circles, texts: [] })
    assert.deepEqual(e, { minX: 0, minY: 0, maxX: 102, maxY: 22 })
  })
})
```

- [ ] **Step 3: `lib/dxf.js`** — implement:
  - `DXF_UNITS = { 1: { unit: 'ft', toUnit: 1 / 12 }, 2: { unit: 'ft', toUnit: 1 }, 4: { unit: 'mm', toUnit: 1 }, 5: { unit: 'cm', toUnit: 1 }, 6: { unit: 'm', toUnit: 1 } }` (inches are expressed in feet); `unitOf(code)` returns the entry or `null`.
  - `collectSegments(dxf)` → `{ segments: Array<[p, q]>, circles: Array<{x,y,r}>, arcs: Array<{x,y,r,start,end}>, texts: Array<{x,y,h,text,rotation}> }` handling `LINE`, `LWPOLYLINE`/`POLYLINE` (consecutive vertex pairs, closing pair when `shape`/closed), `CIRCLE`, `ARC` (angles in degrees), `TEXT`/`MTEXT` (`startPoint`/`position`, `textHeight`/`height`, `text`), and `INSERT` (recursively expand `dxf.blocks[name].entities` with translate `position`, scale `xScale/yScale` (default 1) and `rotation` degrees; depth limit 8). Throw `Error('El DXF es demasiado grande para importarlo.')` beyond 200 000 primitives.
  - `drawingExtents({ segments, circles, arcs = [], texts })` → min/max over all points (circles/arcs by centre ± r).
  - `async function rasterizeDxf(text, { maxSide = 4096 } = {})`: lazy `import('dxf-parser')`, parse, collect, extents; canvas sized so the longest side is `maxSide` (keep aspect, margin 2%); white background; strokes `#111827` 1px, y flipped (DXF y grows up); draws segments, circles (`arc`), arcs (angles converted, y flipped), texts (`fillText` with font size `h * scale`); returns `{ blob, width, height, extents, unit: unitOf(dxf.header?.$INSUNITS) }`.
  Pure functions must not touch `document`.

- [ ] **Step 4: Insert flow** — `media.js`: `export const isDxf = (file) => /\.dxf$/i.test(file?.name ?? '')`. `useMediaInsert.handleFile`: if `isDxf(file)`: `setInserting(true)`; `const result = await rasterizeDxf(await file.text())`; upload the original (`upload.mutateAsync(file)`) and the PNG (`new File([result.blob], file.name.replace(/\.dxf$/i, '') + '.png', { type: 'image/png' })`); place it with `placeImages` (size `fitSize(result.width, result.height, maxInsertSide())`, properties `{ fileId, sourceFileId, name, naturalWidth, naturalHeight, dxf: { unit, width: extentsWidth, height: extentsHeight } }`). If `result.unit` and the active page has no calibration, call a new `calibratePage(calibration)` callback with `{ a: { x: left, y: top }, b: { x: left + worldWidth, y: top }, distance: extentsWidth * result.unit.toUnit, unit: result.unit.unit }` (world coordinates of the placed image's top edge) and toast `Plano DXF insertado con escala en ${unit}`; else toast "Plano DXF insertado". `placeImages` must return the created rows (or their boxes) so the calibration can use the placed position — adjust it to return `createRows`' result. The `calibratePage` callback comes from the editor (wired to `updatePage` for the current page; pass `hasCalibration` too). Errors → `fail(error)` with the message "No se pudo leer el DXF." when parsing fails.
  - `BoardEditor.jsx` file input: `accept="image/*,application/pdf,.dxf"`; the "Formato no soportado" toast in `handleFile` mentions DXF.

- [ ] **Step 5: Help** — in `overview.md` (no-accent style):

```md
### Mapas

La plantilla **Mapa de sitio** (o "Fondo de mapa..." en el menu de escala) pone un mapa de OpenStreetMap detras de la pagina. Busca una direccion o lugar y el mapa se movera y hara zoom junto con el lienzo. En una pagina con mapa las medidas salen en metros sin calibrar. El mapa no aparece en exportaciones, miniaturas ni enlaces publicos.

### Planos DXF

Puedes insertar un archivo **DXF** de AutoCAD con el boton de insertar. Canvas lo dibuja como imagen en la capa de fondo y, si el archivo declara sus unidades (milimetros, centimetros, metros, pulgadas o pies), la pagina queda calibrada automaticamente.
```

- [ ] **Step 6: Verification + commit**

```bash
node --test apps/api/src/routes/canvas/__tests__/*.test.js
node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js
npx eslint <touched files>
node --check apps/api/src/index.js
pnpm --filter ./apps/desktop build:web
```

Commit — `feat(canvas): import DXF plans with automatic scale; help for maps and DXF`
