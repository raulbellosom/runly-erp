# Canvas Hotspot Pins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map-style hotspot pins with a constant screen size by default, an optional plan-scaled resizable mode, and non-overlapping labels.

**Architecture:** Pure helpers in `engine/pins.js` compute the pin metrics (screen size, anchor, hit area). The renderer draws a teardrop pin per mode and greedy-skips overlapping labels; geometry hit-testing takes an optional `zoom`; `canResize` allows plan-mode hotspots; the inspector exposes size and scale.

**Spec:** `docs/superpowers/specs/2026-10-02-canvas-hotspot-pins-design.md`

**Rules:** JavaScript only; UI Spanish, code English; no emojis; `@runly/ui`; never start/stop dev servers; tests with explicit globs; `npx eslint <touched files>` clean; stage only your own files (another session may commit concurrently). Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Pin helpers (pure)

**Files:** Create `apps/desktop/src/modules/runly.canvas/engine/pins.js` (+ `pins.test.js`)

- [ ] **Step 1: Failing test**

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PIN_SIZES, hitPin, labelsOverlap, pinOf } from './pins.js'

const hotspot = (style = {}) => ({ id: 'h', type: 'hotspot', transform: { x: 100, y: 100, rotation: 0 }, geometry: { width: 36, height: 36 }, style })

describe('hotspot pins', () => {
  it('defaults to a medium screen-fixed pin anchored at the box centre', () => {
    assert.deepEqual(pinOf(hotspot()), { size: 'md', scale: 'screen', anchor: { x: 118, y: 118 }, height: PIN_SIZES.md })
    assert.equal(pinOf(hotspot({ pin: { size: 'lg', scale: 'plan' } })).scale, 'plan')
    assert.equal(pinOf(hotspot({ pin: { size: 'xx' } })).size, 'md')
  })
  it('keeps the same screen height at any zoom', () => {
    assert.equal(PIN_SIZES.md, 32)
  })
  it('hits a screen pin by screen distance from its head', () => {
    const pin = pinOf(hotspot())
    // head centre sits above the anchor: anchor.y - 0.62 * height (in screen px, divided by zoom in world)
    const zoom = 2, headY = pin.anchor.y - (0.62 * pin.height) / zoom
    assert.equal(hitPin({ x: pin.anchor.x, y: headY + 5 / zoom }, pin, zoom), true)
    assert.equal(hitPin({ x: pin.anchor.x + 40 / zoom, y: headY }, pin, zoom), false)
  })
  it('detects overlapping label rectangles', () => {
    assert.equal(labelsOverlap({ x: 0, y: 0, width: 50, height: 20 }, [{ x: 40, y: 10, width: 50, height: 20 }]), true)
    assert.equal(labelsOverlap({ x: 0, y: 0, width: 50, height: 20 }, [{ x: 60, y: 0, width: 50, height: 20 }]), false)
  })
})
```

- [ ] **Step 2: `pins.js`**

```js
// Hotspot pins. "screen" pins keep a constant on-screen size (map style) and
// are anchored at the centre of their stored box; "plan" pins live inside
// their world box and scale with zoom.
export const PIN_SIZES = { sm: 24, md: 32, lg: 44 }
const HEAD = 0.62 // head centre height above the tip, as a fraction of pin height

export function pinOf(object) {
  const pin = object.style?.pin ?? {}
  const size = PIN_SIZES[pin.size] ? pin.size : 'md'
  const scale = pin.scale === 'plan' ? 'plan' : 'screen'
  const t = object.transform ?? {}, g = object.geometry ?? {}
  const anchor = { x: Number(t.x ?? 0) + Number(g.width ?? 36) / 2, y: Number(t.y ?? 0) + Number(g.height ?? 36) / 2 }
  return { size, scale, anchor, height: PIN_SIZES[size] }
}

// World-space point inside a screen pin (head circle or the stem to the tip)?
export function hitPin(point, pin, zoom, slop = 4) {
  const h = pin.height / zoom, r = (pin.height * 0.36) / zoom, s = slop / zoom
  const head = { x: pin.anchor.x, y: pin.anchor.y - HEAD * h }
  if (Math.hypot(point.x - head.x, point.y - head.y) <= r + s) return true
  return Math.abs(point.x - pin.anchor.x) <= r * 0.5 + s && point.y <= pin.anchor.y + s && point.y >= head.y
}

export const PIN_HEAD = HEAD

export function labelsOverlap(rect, placed) {
  return placed.some((o) => rect.x < o.x + o.width && rect.x + rect.width > o.x && rect.y < o.y + o.height && rect.y + rect.height > o.y)
}
```

Run the test (fix only mathematically wrong literals and report). Commit — `feat(canvas): hotspot pin helpers`

---

### Task 2: Engine + inspector

**Files:** `engine/geometry.js`, `engine/Canvas2DRenderer.js`, `components/CanvasViewport.jsx` (only if hit-testing needs `zoom` passed), `lib/connectors.js`, `components/inspector/ObjectInspector.jsx`, help `apps/api/src/manifests/official/help/runly.canvas/overview.md`

- [ ] **Step 1: Geometry** — `canResize(object)` returns true for hotspots whose `pinOf(object).scale === 'plan'`. `hitObject(point, object, slop = 0, zoom = null)`: for screen hotspots with a `zoom`, use `hitPin(point, pinOf(object), zoom)`. `Canvas2DRenderer.hitTest` passes `viewport.zoom`. `objectBounds` for screen hotspots stays the stored box (used by marquee/fit; acceptable). For plan-mode hotspot resize keep a square ratio (`keepRatio: true` in the viewport resize call when `object.type === 'hotspot'`). In `handlesOf`, plan hotspots get only the 4 corner handles.
- [ ] **Step 2: Connectors** — in `lib/connectors.js` `borderPoint`, screen-mode hotspots return the anchor (`pinOf(object).anchor`).
- [ ] **Step 3: Renderer** — `drawObject` routes `hotspot` to a new `drawPin(ctx, object, zoom, color)` that draws **outside** the box transform for screen pins (world coordinates around the anchor, sizes divided by zoom) and inside the box for plan pins (height = box height). Teardrop path: head circle radius `0.36·H` centred `0.62·H` above the tip, two tangents to the tip; fill = hotspot colour, white 2px (screen) border, icon (`getIconNode`, white, size `0.42·H`) or a white dot `0.12·H`. Labels: collect `{ text, rect }` for all pins during the object loop instead of drawing immediately; after the loop draw them in screen space (font 12 px, pill under the tip / under the box), skipping any whose rect `labelsOverlap` an already drawn one; threshold `zoom ≥ 0.25` screen / `≥ 0.5` plan. Remove the old label code in `drawHotspot`. Selection: screen pins get a primary ring (`2 / zoom` stroke) around the head, no handles; plan pins use the normal box selection with corner handles. Link badges for screen pins sit at the head's top-right.
- [ ] **Step 4: Inspector** — in `ObjectInspector.jsx` hotspot section add `Choice` "Tamaño del pin" (`Pequeño` sm, `Mediano` md, `Grande` lg) and `Choice` "Escala" (`Fijo en pantalla` screen, `Crece con el plano` plan), patching `style.pin` via `onPatch({ style: { pin: { ...current, size } } })` (merge with existing `style.pin`). When switching to `plan`, if the stored box is smaller than 24 world units, also patch the geometry to 36 × 36 keeping the centre.
- [ ] **Step 5: Help** — add to the canvas help (no-accent style, hotspots section): `Los pines se ven del mismo tamano con cualquier zoom, como en un mapa, y su punta marca el lugar exacto. En el inspector puedes elegir su tamano (pequeno, mediano o grande) o la escala "Crece con el plano" para que el pin cubra un elemento del plano y se pueda redimensionar.`
- [ ] **Step 6: Verification + commit**

```bash
node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js apps/desktop/src/modules/runly.pos/lib/*.test.js
npx eslint <touched files>
pnpm --filter ./apps/desktop build:web
```

Commit — `feat(canvas): map-style hotspot pins with size and scale options`
