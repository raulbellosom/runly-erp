# Canvas Editor Outline, Quick Actions and Shape Conversion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layers/elements tree with focus, per-element visibility/lock and drag-and-drop (mobile-ready), collapsible pages and help, a quick-actions menu (right click / long press), and shape conversion.

**Spec:** `docs/superpowers/specs/2026-10-02-canvas-editor-outline-design.md`

**Rules:** JavaScript only; UI Spanish, code English; no emojis; `@runly/ui` components (check real props: `Accordion*`, `DropdownMenu*` incl. sub-menus, `Choice` in `inspector/fields.jsx`); `@dnd-kit/core` + `@dnd-kit/sortable` are already desktop dependencies (see `runly.projects/components/KanbanView.jsx` for repo usage); never start/stop dev servers; no file over 800 lines (`BoardEditor.jsx` is ~345 — extract hooks/components rather than growing it past ~400); tests with explicit globs; `npx eslint <touched files>` clean; stage only your own files. Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Pure helpers

**Files:** Create `apps/desktop/src/modules/runly.canvas/lib/layerTree.js` (+ test), `lib/shapeConvert.js` (+ test); modify `lib/history.js` (`TRACKED_FIELDS` += `'type'`) and its test if needed.

- [ ] **Step 1: Failing tests**

`lib/layerTree.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildLayerTree, moveElement, reorderedLayerIds } from './layerTree.js'

const layers = [{ id: 'L1', name: 'Fondo', position: 0 }, { id: 'L2', name: 'Dibujo', position: 1 }]
const rows = [
  { id: 'a', layerId: 'L2', position: 1 }, { id: 'b', layerId: 'L2', position: 3 }, { id: 'c', layerId: 'L2', position: 2 },
  { id: 'd', layerId: 'L1', position: 0 },
]

describe('layer tree', () => {
  it('lists layers top-most first and elements top-most first', () => {
    const tree = buildLayerTree(layers, rows)
    assert.deepEqual(tree.map((l) => l.id), ['L2', 'L1'])
    assert.deepEqual(tree[0].elements.map((e) => e.id), ['b', 'c', 'a'])
  })
  it('computes new positions when moving an element to the top of its layer', () => {
    const patches = moveElement(rows, 'a', { layerId: 'L2', index: 0 })
    // index is in tree order (0 = top). Result: b? no — a moves above b.
    const byId = Object.fromEntries(patches.map((p) => [p.id, p]))
    assert.ok(byId.a.position > 3)
    assert.equal(byId.a.layerId, undefined)
  })
  it('moves an element into another layer at a given tree index', () => {
    const patches = moveElement(rows, 'b', { layerId: 'L1', index: 1 })
    const b = patches.find((p) => p.id === 'b')
    assert.equal(b.layerId, 'L1')
    assert.ok(b.position < 0 + 1e-9)
  })
  it('turns a visual layer order into the API order (bottom first)', () => {
    assert.deepEqual(reorderedLayerIds(['L1', 'L2']), ['L2', 'L1'])
  })
})
```

`moveElement(rows, id, { layerId, index })` returns minimal patches `[{ id, position, layerId? }]`: compute the destination layer's elements in tree order (top-most first, excluding the moved one), insert the moved id at `index`, then assign positions so that tree order maps to descending `position` — renumber the destination layer as `position = count - treeIndex` for every element whose position changes (keep it simple: renumber all elements of the destination layer, emit patches only for changed ones); include `layerId` only when it changes. Adjust the two "position" assertions in the test to the exact numbers your renumbering produces (they must express "a ends on top" and "b ends below d"); keep the intent, report the change.

`lib/shapeConvert.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SHAPE_KINDS, convertShape, shapeKindOf } from './shapeConvert.js'

describe('shape conversion', () => {
  const rect = { id: 'r', type: 'rectangle', geometry: { width: 100, height: 60 }, properties: { binding: { source: 'x', id: '1' } }, style: { stroke: '#000' } }
  it('knows the kind of each object', () => {
    assert.equal(shapeKindOf(rect), 'rectangle')
    assert.equal(shapeKindOf({ type: 'polygon', properties: { shape: 'diamond' } }), 'diamond')
    assert.equal(shapeKindOf({ type: 'arrow' }), 'arrow')
    assert.deepEqual(SHAPE_KINDS.closed, ['rectangle', 'ellipse', 'triangle', 'diamond'])
  })
  it('converts keeping box, style and properties', () => {
    const tri = convertShape(rect, 'triangle')
    assert.equal(tri.type, 'polygon')
    assert.equal(tri.properties.shape, 'triangle')
    assert.equal(tri.properties.binding.id, '1')
    assert.equal(tri.geometry.width, 100)
    assert.equal(tri.geometry.points.length, 3)
    const ellipse = convertShape(tri, 'ellipse')
    assert.equal(ellipse.type, 'ellipse')
    assert.equal(ellipse.properties.shape, undefined)
    assert.equal(ellipse.geometry.points, undefined)
    assert.equal(convertShape({ type: 'line', geometry: { x2: 5, y2: 0 } }, 'arrow').type, 'arrow')
    assert.equal(convertShape(rect, 'rectangle'), rect)
  })
})
```

- [ ] **Step 2: Implement** — `layerTree.js`: `buildLayerTree(layers, rows)` → layers sorted by `position` desc, each `{ ...layer, elements }` with elements sorted by `position` desc then `createdAt` desc; `moveElement`; `reorderedLayerIds(visualOrder)` → reversed. `shapeConvert.js`: `SHAPE_KINDS = { closed: ['rectangle', 'ellipse', 'triangle', 'diamond'], linear: ['line', 'arrow'] }`; `shapeKindOf(object)`; `convertShape(object, kind)` using `POLYGON_POINTS` from `objectFactory.js` for triangle/diamond, dropping `points`/`shape` when leaving polygon, keeping everything else; returns the same object when the kind is unchanged; returns the patch-ready object (`type`, `geometry`, `properties`). `history.js`: add `'type'` to `TRACKED_FIELDS` and make sure `buildOperations` sends it.
- [ ] **Step 3:** Run tests. Commit — `feat(canvas): layer tree and shape conversion helpers`

---

### Task 2: Element visibility/lock, focus animation, shape conversion, clipboard (engine + actions)

**Files:** `screens/BoardEditor.jsx` (or a new `hooks/useEditorView.js`), `components/CanvasViewport.jsx`, `engine/Canvas2DRenderer.js`, `hooks/useBoardEditorActions.js`, `components/inspector/ObjectInspector.jsx`, `hooks/useCanvasShortcuts.js`.

- [ ] **Step 1: Hidden/locked elements** — visible rows exclude `properties.hidden`; viewport `selectable()` excludes `properties.locked` (keep layer locks); `editable()` in actions excludes `properties.locked`. Actions `setHidden(objects, bool)` and `setLocked(objects, bool)` patch `properties` (one undo step each; these bypass the `editable` lock check so a locked element can be unlocked).
- [ ] **Step 2: Focus** — `hooks/useFocusAnimation.js`: `focusOn(object)` animates `viewport` from current to the target (`fitBounds(objectBounds(object), size, 120)` with zoom clamped to `[0.5, 2]`) over 350 ms with ease-in-out via `requestAnimationFrame` (respect `prefers-reduced-motion`: jump instead), then sets `flash = { id, until: now + 1000 }`. Renderer: `scene.flash` draws a pulsing primary ring (alpha from time) around the object's bounds; the viewport schedules frames while a flash is active. If the object's layer is hidden, toast "La capa está oculta" and do nothing.
- [ ] **Step 3: Shape conversion** — action `convertShapes(objects, kind)` applying `convertShape` to editable rows via `applyUpdates` with `data: { type, geometry, properties }` (label "Cambiar forma"). Inspector: for closed shapes a `Choice` "Forma" (Rectángulo, Elipse, Triángulo, Rombo); for line/arrow a `Choice` (Línea, Flecha). Make sure the optimistic cache update and the server batch accept `type` (objectPatch already allows it).
- [ ] **Step 4: Clipboard** — actions `copy(objects)` (stores snapshots in a ref) and `paste()` (creates copies offset 24 px on the current page; hotspots get their hotspot record copied like `duplicate`); shortcuts Ctrl+C / Ctrl+V in `useCanvasShortcuts`.
- [ ] **Step 5: Context menu hook in the viewport** — the existing optional `onContextMenu(object|null, screenPoint)` prop is used for mouse right click. For touch, in `armLongPress`, when `hit` exists **and** `p.onContextMenu` is provided: select the hit (unless already selected) and call `p.onContextMenu(hit, drag.screen)` instead of toggling selection. Without the prop, behaviour is unchanged (POS relies on that).
- [ ] **Step 6:** tests, eslint, build. Commit — `feat(canvas): element visibility and lock, focus animation, shape conversion and clipboard`

---

### Task 3: Quick actions menu

**Files:** Create `components/CanvasContextMenu.jsx`; modify `screens/BoardEditor.jsx`.

- [ ] **Step 1:** `CanvasContextMenu({ state, onClose, actions, ... })` where `state = { x, y, target: object|null, selection: rows }`: a controlled `DropdownMenu` (`open` from state) whose trigger is an invisible 1×1 `span` absolutely positioned at `{x, y}` inside the canvas container; content `align="start"`. Items per the spec (Spanish labels, `DropdownMenuSub` for "Cambiar forma" and "Mover a capa"; disabled entries for invalid targets: locked/hotspot-only layers; "Eliminar" with destructive styling). Read-only users get only Enfocar, Abrir hotspot, Copiar (no-op disabled if paste impossible) and Ajustar vista. "Agregar a la selección" appears for touch-opened menus.
- [ ] **Step 2:** Wire in `BoardEditor`: `onContextMenu` on `CanvasViewport` sets the menu state (select the target first when it is not in the selection); keyboard `Shift+F10`/`ContextMenu` key opens it at the selection centre.
- [ ] **Step 3:** eslint, build. Commit — `feat(canvas): quick actions on right click and long press`

---

### Task 4: Layers and elements panel

**Files:** Create `components/layers/LayersPanel.jsx`, `components/layers/LayerItem.jsx`, `components/layers/ElementItem.jsx`, `components/layers/PagesSection.jsx`; delete `components/PagesLayersPanel.jsx` after replacing its usages (keep the `layerKind` export by moving it to `lib/layerKinds.js`).

- [ ] **Step 1:** `PagesSection`: `AccordionItem` "Páginas" — trigger shows "Páginas · <active page name> (N)"; content list with `max-h-48 overflow-y-auto overscroll-contain`, "+" button (existing add page). Default open when ≤ 5 pages (persist the open state in `localStorage` key `runly.canvas.panel.pages` with try/catch).
- [ ] **Step 2:** `LayersPanel`: `buildLayerTree(layers, allRows)`; `DndContext` with `PointerSensor` (`activationConstraint: { distance: 6 }`), `TouchSensor` (`{ delay: 200, tolerance: 6 }`) and `KeyboardSensor` (`sortableKeyboardCoordinates`); one `SortableContext` for layers and one per expanded layer for its elements; drag handles via `useSortable` `listeners` on a `GripVertical` button only (so the list scrolls normally on touch). On layer drop → `reorderLayers` (new action using `runly.canvas.reorderLayers`, optimistic update of the board query, one toast on error). On element drop (same or different layer, allow dropping onto a collapsed layer row = top of that layer) → `moveElement` patches → `applyUpdates(..., 'Reordenar')`. Block drops into locked layers and of hotspots into non-hotspot layers (and non-hotspots into hotspot layers).
- [ ] **Step 3:** `LayerItem`: chevron (expanded state per layer id in component state; active layer expanded by default), kind icon + label from `lib/layerKinds.js`, name, count, eye, lock, grip; `ElementItem`: type icon, name, eye (`setHidden`), lock (`setLocked`), focus button (`LocateFixed`, `aria-label="Enfocar"`), grip; selected highlight; dimmed when hidden/locked; first 50 + "Mostrar todos (N)". Read-only: no grips/toggles, focus still available.
- [ ] **Step 4:** Collapsible help: last `AccordionItem` "¿Qué es cada capa?" (closed by default, persisted like pages) with the existing per-kind explanation and "Agregar capa de datos" button logic kept from the old panel.
- [ ] **Step 5:** Replace `PagesLayersPanel` in `BoardEditor.jsx` (desktop aside and mobile sheet). Help text in `apps/api/src/manifests/official/help/runly.canvas/overview.md` (no-accent style): describe the tree (expand a layer to see its elements, eye/lock per element, Enfocar, drag the handle to reorder or move between layers — on touch, hold the handle a moment), the quick actions (right click or long press), and "Cambiar forma".
- [ ] **Step 6: Verification + commit**

```bash
node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js apps/desktop/src/modules/runly.pos/lib/*.test.js
npx eslint <touched files>
pnpm --filter ./apps/desktop build:web
```

Commit — `feat(canvas): layers and elements tree with focus and drag-and-drop`
