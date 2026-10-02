# Canvas Board Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `runly.canvas` Board templates real: each template sets grid, snapping, initial tool, layers and empty state, the editor honours those settings, and the "Nuevo Board" dialog explains every template.

**Architecture:** One catalog in the API (`canvas-templates.js`) is applied by `createBoard`/`createPage`, served by `GET /canvas/templates` and reused by MirAI. `GET /canvas/boards/:id` returns `effectiveSettings` (saved settings with `version: 2`, otherwise the template defaults), and the editor reads only that. Snapping is pure helpers in `engine/snap.js` wired into `CanvasViewport`.

**Tech Stack:** Hono, Prisma (no schema change), React + TanStack Query, `@runly/ui`, Canvas2D, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-01-canvas-board-templates-design.md`

**Rules for the implementer:** JavaScript only; UI text in Spanish, code and comments in English; no emojis; never start, stop or restart the dev servers on 4010/5173 (check `curl -s localhost:4010/health` and reuse them); no file over 800 lines.

---

## File map

| File | Responsibility |
|---|---|
| Create `apps/api/src/routes/canvas/canvas-templates.js` | Template catalog, settings normalization, effective settings, layer rows |
| Create `apps/api/src/routes/canvas/__tests__/canvas-templates.test.js` | Catalog and settings tests |
| Modify `apps/api/src/routes/canvas/canvas-service.js` | Apply catalog in create/update/get Board and createPage |
| Modify `apps/api/src/routes/canvas/__tests__/canvas-service.test.js` | Template-aware service tests |
| Modify `apps/api/src/routes/canvas/canvas-routes.js` | `GET /canvas/templates` |
| Modify `apps/api/src/routes/canvas/__tests__/canvas-routes.test.js` | Route test |
| Modify `apps/api/src/routes/canvas/canvas-mirai-queries.js` | `BOARD_TYPES` derived from catalog |
| Modify `packages/sdk/src/domains/canvas.js` | `listTemplates` |
| Create `apps/desktop/src/modules/runly.canvas/engine/snap.js` (+ `snap.test.js`) | Grid snapping helpers |
| Modify `apps/desktop/src/modules/runly.canvas/engine/Canvas2DRenderer.js` | Grid from scene |
| Modify `apps/desktop/src/modules/runly.canvas/components/CanvasViewport.jsx` | Snap create/move/resize, Alt override |
| Create `apps/desktop/src/modules/runly.canvas/lib/boardTemplates.js` (+ `boardTemplates.test.js`) | Initial layer, media target layer, empty-state action parsing |
| Modify `apps/desktop/src/modules/runly.canvas/hooks/useMediaInsert.js` | Insert into media-target layer, lock after insert |
| Modify `apps/desktop/src/modules/runly.canvas/hooks/useBoardEditorActions.js` | Pass layers/lock to media insert |
| Modify `apps/desktop/src/modules/runly.canvas/hooks/useCanvasData.js` | `useCanvasTemplates`, `useUpdateBoardSettings` |
| Modify `apps/desktop/src/modules/runly.canvas/screens/BoardEditor.jsx` | Settings, default tool, initial layer, template empty state |
| Create `apps/desktop/src/modules/runly.canvas/components/inspector/BoardSettingsSection.jsx` | "Ajustes del Board" |
| Modify `apps/desktop/src/modules/runly.canvas/components/BoardInspector.jsx` | Render settings section with no selection |
| Create `apps/desktop/src/modules/runly.canvas/lib/templatePreviews.js` (+ `templatePreviews.test.js`) | Preview primitives per template |
| Create `apps/desktop/src/modules/runly.canvas/components/TemplatePreview.jsx` | SVG preview renderer |
| Modify `apps/desktop/src/modules/runly.canvas/lib/boardMeta.js` | Icon map only (labels come from the catalog) |
| Modify `apps/desktop/src/modules/runly.canvas/components/CreateBoardDialog.jsx` | New dialog |
| Modify `apps/desktop/src/modules/runly.canvas/components/BoardCard.jsx` | Label/icon from catalog |
| Modify `apps/api/src/manifests/official/help/runly.canvas/overview.md` | Help text for templates and board settings |

---

### Task 1: Template catalog in the API

**Files:**
- Create: `apps/api/src/routes/canvas/canvas-templates.js`
- Test: `apps/api/src/routes/canvas/__tests__/canvas-templates.test.js`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BOARD_TOOLS, CANVAS_TEMPLATES, effectiveBoardSettings, normalizeBoardSettings, templateFor, templateLayerRows,
} from '../canvas-templates.js'

describe('Canvas templates catalog', () => {
  it('declares six templates with complete, self-consistent definitions', () => {
    assert.deepEqual(CANVAS_TEMPLATES.map((t) => t.key), ['blank', 'plan', 'technical-map', 'diagram', 'layout', 'pdf-review'])
    for (const template of CANVAS_TEMPLATES) {
      assert.ok(template.label && template.description && template.useWhen && template.namePlaceholder, template.key)
      assert.ok(template.includes.length >= 2, template.key)
      assert.ok(template.layers.some((layer) => layer.type === 'vector'), template.key)
      assert.deepEqual(normalizeBoardSettings(template.settings, template.settings), template.settings)
      assert.ok(template.emptyState.title && template.emptyState.description, template.key)
    }
  })

  it('falls back to blank for unknown template keys', () => {
    assert.equal(templateFor('nope').key, 'blank')
    assert.equal(templateFor(undefined).key, 'blank')
  })

  it('merges partial settings over the base and always stamps version 2', () => {
    const base = templateFor('plan').settings
    assert.deepEqual(normalizeBoardSettings({ grid: { size: 30 } }, base), { version: 2, grid: { enabled: true, size: 30 }, snapping: true, defaultTool: 'select' })
  })

  it('rejects invalid settings with status 400', () => {
    const base = templateFor('plan').settings
    for (const input of [{ grid: { size: 2 } }, { grid: { size: 500 } }, { grid: { size: 10.5 } }, { snapping: 'yes' }, { defaultTool: 'laser' }]) {
      assert.throws(() => normalizeBoardSettings(input, base), (error) => error.status === 400, JSON.stringify(input))
    }
    assert.ok(BOARD_TOOLS.includes('hotspot'))
  })

  it('gives legacy boards their template defaults', () => {
    const legacy = { templateType: 'blank', settings: { grid: { enabled: false, size: 10 }, snapping: true } }
    assert.deepEqual(effectiveBoardSettings(legacy), templateFor('blank').settings)
    assert.deepEqual(effectiveBoardSettings({ templateType: 'diagram', settings: null }), templateFor('diagram').settings)
    const saved = { version: 2, grid: { enabled: true, size: 50 }, snapping: false, defaultTool: 'select' }
    assert.deepEqual(effectiveBoardSettings({ templateType: 'plan', settings: saved }), saved)
  })

  it('builds ordered layer rows with metadata', () => {
    const rows = templateLayerRows(templateFor('pdf-review'), 'page-1')
    assert.deepEqual(rows.map((row) => [row.name, row.type, row.position]), [['Documento', 'vector', 0], ['Anotaciones', 'vector', 1], ['Hotspots', 'hotspot', 2]])
    assert.deepEqual(rows[0].metadata, { mediaTarget: true, lockAfterInsert: true })
    assert.equal(rows[0].pageId, 'page-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/src/routes/canvas/__tests__/canvas-templates.test.js`
Expected: FAIL with `Cannot find module '../canvas-templates.js'`

- [ ] **Step 3: Write the implementation**

```js
// apps/api/src/routes/canvas/canvas-templates.js
//
// Single catalog of Board templates. createBoard/createPage apply it,
// GET /canvas/templates serves it to the "Nuevo Board" dialog and MirAI
// derives its board types from it, so the three never drift apart.

export const BOARD_TOOLS = ['select', 'rectangle', 'ellipse', 'triangle', 'diamond', 'line', 'arrow', 'text', 'hotspot']
export const GRID_SIZE_MIN = 4
export const GRID_SIZE_MAX = 200

const settings = (enabled, size, snapping, defaultTool = 'select') => ({ version: 2, grid: { enabled, size }, snapping, defaultTool })
// Inserted images/PDF pages go to the first layer flagged mediaTarget.
const MEDIA = { mediaTarget: true }

export const CANVAS_TEMPLATES = [
  {
    key: 'blank', label: 'En blanco', icon: 'square', preview: 'blank',
    description: 'Lienzo libre',
    useWhen: 'Quieres bocetar ideas o tu caso no encaja en otro tipo.',
    includes: ['Sin cuadrícula', 'Capas: Dibujo, Hotspots y Datos Runly', 'Todas las herramientas disponibles'],
    namePlaceholder: 'Ej. Ideas de lanzamiento',
    settings: settings(false, 24, false),
    layers: [{ name: 'Dibujo', type: 'vector' }, { name: 'Hotspots', type: 'hotspot' }, { name: 'Datos Runly', type: 'data' }],
    emptyState: { title: 'Esta página está vacía', description: 'Dibuja formas, escribe textos, coloca hotspots o inserta una imagen o PDF desde la barra inferior.', action: null },
  },
  {
    key: 'plan', label: 'Plano', icon: 'frame', preview: 'plan',
    description: 'Planta o croquis',
    useWhen: 'Tienes la planta de un local, oficina, bodega o casa y quieres marcar áreas y puntos.',
    includes: ['Cuadrícula de 20 con ajuste', 'Capas: Plano base, Mobiliario y Hotspots', 'El plano que insertes queda en la capa Plano base'],
    namePlaceholder: 'Ej. Planta baja — bodega',
    settings: settings(true, 20, true),
    layers: [{ name: 'Plano base', type: 'vector', metadata: MEDIA }, { name: 'Mobiliario', type: 'vector' }, { name: 'Hotspots', type: 'hotspot' }],
    emptyState: { title: 'Sube el plano de tu espacio', description: 'Inserta una imagen o un PDF del plano; queda en la capa Plano base para dibujar encima.', action: { label: 'Insertar plano', kind: 'insert-media' } },
  },
  {
    key: 'technical-map', label: 'Mapa técnico', icon: 'map', preview: 'technical-map',
    description: 'Instalaciones y puntos',
    useWhen: 'Documentas instalaciones (electricidad, agua, datos, maquinaria) y quieres un punto por equipo.',
    includes: ['Cuadrícula suave de 40', 'Capas: Instalaciones y Puntos', 'Empieza con la herramienta de hotspot'],
    namePlaceholder: 'Ej. Red eléctrica — nave 2',
    settings: settings(true, 40, false, 'hotspot'),
    layers: [{ name: 'Instalaciones', type: 'vector', metadata: MEDIA }, { name: 'Puntos', type: 'hotspot' }],
    emptyState: { title: 'Marca los puntos de tu instalación', description: 'Coloca hotspots sobre equipos, tomas o tableros y vincúlalos con inventario o vehículos. También puedes insertar un esquema de fondo.', action: { label: 'Insertar esquema', kind: 'insert-media' } },
  },
  {
    key: 'diagram', label: 'Diagrama', icon: 'workflow', preview: 'diagram',
    description: 'Procesos y flujos',
    useWhen: 'Vas a dibujar un proceso, un flujo de aprobación o un organigrama.',
    includes: ['Cuadrícula de 10 con ajuste', 'Capas: Formas y Notas', 'Empieza con la herramienta de rectángulo'],
    namePlaceholder: 'Ej. Flujo de compras',
    settings: settings(true, 10, true, 'rectangle'),
    layers: [{ name: 'Formas', type: 'vector' }, { name: 'Notas', type: 'vector' }],
    emptyState: { title: 'Dibuja tu primer paso', description: 'Usa rectángulos para los pasos, rombos para las decisiones y flechas para el flujo.', action: { label: 'Dibujar rectángulo', kind: 'tool:rectangle' } },
  },
  {
    key: 'layout', label: 'Distribución', icon: 'layout-grid', preview: 'layout',
    description: 'Espacios y mobiliario',
    useWhen: 'Acomodas mesas, estantes o puestos de trabajo, para un evento o una reubicación.',
    includes: ['Cuadrícula de 20 con ajuste', 'Capas: Espacios, Elementos y Hotspots', 'El plano que insertes queda en la capa Espacios'],
    namePlaceholder: 'Ej. Acomodo evento aniversario',
    settings: settings(true, 20, true),
    layers: [{ name: 'Espacios', type: 'vector', metadata: MEDIA }, { name: 'Elementos', type: 'vector' }, { name: 'Hotspots', type: 'hotspot' }],
    emptyState: { title: 'Acomoda tu espacio', description: 'Inserta el plano del lugar o dibuja directamente los espacios, mesas o estantes.', action: { label: 'Insertar plano', kind: 'insert-media' } },
  },
  {
    key: 'pdf-review', label: 'Revisión de PDF', icon: 'file-search', preview: 'pdf-review',
    description: 'Marcas sobre documentos',
    useWhen: 'Necesitas revisar un PDF y dejar observaciones encima de sus páginas.',
    includes: ['Sin cuadrícula', 'Capas: Documento, Anotaciones y Hotspots', 'El PDF queda bloqueado en la capa Documento'],
    namePlaceholder: 'Ej. Revisión contrato proveedor',
    settings: settings(false, 24, false),
    layers: [{ name: 'Documento', type: 'vector', metadata: { ...MEDIA, lockAfterInsert: true } }, { name: 'Anotaciones', type: 'vector' }, { name: 'Hotspots', type: 'hotspot' }],
    emptyState: { title: 'Inserta el PDF a revisar', description: 'Las páginas quedan en la capa Documento, bloqueada para que no se muevan mientras anotas.', action: { label: 'Insertar PDF', kind: 'insert-media' } },
  },
]

export function templateFor(key) {
  return CANVAS_TEMPLATES.find((template) => template.key === key) ?? CANVAS_TEMPLATES[0]
}

function invalid(message) { return Object.assign(new Error(message), { status: 400 }) }
const copySettings = (value) => ({ ...value, grid: { ...value.grid } })

// Validates `input` merged over `base` and returns a clean version-2 object.
export function normalizeBoardSettings(input, base = CANVAS_TEMPLATES[0].settings) {
  const source = input && typeof input === 'object' ? input : {}
  const grid = { ...base.grid, ...(source.grid && typeof source.grid === 'object' ? source.grid : {}) }
  if (typeof grid.enabled !== 'boolean') throw invalid('La cuadrícula debe estar activada o desactivada.')
  if (!Number.isInteger(grid.size) || grid.size < GRID_SIZE_MIN || grid.size > GRID_SIZE_MAX) {
    throw invalid(`El tamaño de cuadrícula debe ser un entero entre ${GRID_SIZE_MIN} y ${GRID_SIZE_MAX}.`)
  }
  const snapping = source.snapping ?? base.snapping
  if (typeof snapping !== 'boolean') throw invalid('El ajuste a la cuadrícula debe estar activado o desactivado.')
  const defaultTool = source.defaultTool ?? base.defaultTool
  if (!BOARD_TOOLS.includes(defaultTool)) throw invalid('Herramienta inicial no válida.')
  return { version: 2, grid: { enabled: grid.enabled, size: grid.size }, snapping, defaultTool }
}

// Boards saved before templates had behaviour carry an old settings shape
// (no `version`); they get their template defaults instead, so an old blank
// Board does not suddenly start snapping.
export function effectiveBoardSettings(board) {
  const base = templateFor(board?.templateType).settings
  if (board?.settings?.version !== 2) return copySettings(base)
  try { return normalizeBoardSettings(board.settings, base) } catch { return copySettings(base) }
}

export function templateLayerRows(template, pageId) {
  return template.layers.map((layer, position) => ({ pageId, name: layer.name, type: layer.type, position, metadata: layer.metadata ?? {} }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/src/routes/canvas/__tests__/canvas-templates.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/canvas/canvas-templates.js apps/api/src/routes/canvas/__tests__/canvas-templates.test.js
git commit -m "feat(canvas): board template catalog with settings and layers"
```

---

### Task 2: Service applies the catalog

**Files:**
- Modify: `apps/api/src/routes/canvas/canvas-service.js` (lines 1-2 constants, `getBoard` ~98, `createBoard` ~110, `updateBoard` ~137, `createPage` ~159)
- Test: `apps/api/src/routes/canvas/__tests__/canvas-service.test.js`

- [ ] **Step 1: Update and add failing tests**

In `canvas-service.test.js`, replace the assertion line in `'creates Board, owner ACL, initial page/layers and audit atomically'`:

```js
    assert.deepEqual(calls.find(([name]) => name === 'layers')[1].map((layer) => layer.type), ['vector', 'hotspot', 'data'])
```

with:

```js
    assert.deepEqual(calls.find(([name]) => name === 'layers')[1].map((layer) => layer.name), ['Plano base', 'Mobiliario', 'Hotspots'])
    assert.deepEqual(calls.find(([name]) => name === 'board')[1].settings, { version: 2, grid: { enabled: true, size: 20 }, snapping: true, defaultTool: 'select' })
```

Append inside the `describe` block:

```js
  it('creates new pages with the Board template layers', async () => {
    let layers
    const tx = {
      canvasPage: { findFirst: async () => ({ position: 0 }), create: async ({ data }) => ({ id: 'page-2', ...data }) },
      canvasLayer: { createMany: async ({ data }) => { layers = data } },
    }
    const prisma = { canvasBoard: { findFirst: async () => accessibleBoard({ templateType: 'diagram' }) }, $transaction: (fn) => fn(tx) }
    await createCanvasService({ prisma }).createPage(COMPANY, USER, BOARD, { name: 'Página 2' })
    assert.deepEqual(layers.map((layer) => [layer.name, layer.position]), [['Formas', 0], ['Notas', 1]])
  })

  it('returns effective settings with the Board', async () => {
    const prisma = { canvasBoard: { findFirst: async () => accessibleBoard({ templateType: 'plan', settings: { grid: { enabled: false, size: 10 }, snapping: true }, pages: [] }) } }
    const board = await createCanvasService({ prisma }).getBoard(COMPANY, USER, BOARD)
    assert.deepEqual(board.effectiveSettings, { version: 2, grid: { enabled: true, size: 20 }, snapping: true, defaultTool: 'select' })
  })

  it('validates settings on update', async () => {
    let saved
    const prisma = {
      canvasBoard: {
        findFirst: async () => accessibleBoard({ templateType: 'plan', settings: null }),
        update: async ({ data }) => { saved = data; return { id: BOARD, ...data } },
      },
      auditLog: { create: async () => ({}) },
    }
    const service = createCanvasService({ prisma })
    await assert.rejects(() => service.updateBoard(COMPANY, USER, BOARD, { settings: { grid: { size: 2 } } }), (error) => error instanceof CanvasServiceError && error.status === 400)
    await service.updateBoard(COMPANY, USER, BOARD, { settings: { grid: { enabled: true, size: 30 } } })
    assert.deepEqual(saved.settings, { version: 2, grid: { enabled: true, size: 30 }, snapping: true, defaultTool: 'select' })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/api/src/routes/canvas/__tests__/canvas-service.test.js`
Expected: FAIL in the 4 template-related tests (layer names, `effectiveSettings` undefined, size 2 accepted).

- [ ] **Step 3: Implement**

In `canvas-service.js`:

1. Replace line 2 (`const BOARD_TEMPLATES = new Set([...])`) with an import at the top of the file:

```js
import { effectiveBoardSettings, normalizeBoardSettings, templateFor, templateLayerRows } from './canvas-templates.js'
```

2. Below `function finite(...)` add:

```js
// Settings errors from the catalog surface as regular 400 service errors.
function boardSettings(input, base) {
  try { return normalizeBoardSettings(input, base) } catch (error) { throw new CanvasServiceError(error.message, 400) }
}
```

3. In `getBoard`, replace `return board ? { ...board, myRole: role } : board` with:

```js
    return board ? { ...board, myRole: role, effectiveSettings: effectiveBoardSettings(board) } : board
```

4. Replace the body of `createBoard` with:

```js
  async function createBoard(companyId, actorId, data) {
    const name = cleanText(data?.name, 200)
    if (!name) throw new CanvasServiceError('El nombre del Board es requerido.', 400)
    const template = templateFor(data?.templateType)
    const settings = boardSettings(data?.settings, template.settings)
    return prisma.$transaction(async (tx) => {
      const board = await tx.canvasBoard.create({ data: {
        companyId, ownerId: actorId, createdById: actorId, updatedById: actorId, name,
        description: cleanText(data?.description), templateType: template.key,
        settings, metadata: data?.metadata ?? {},
      } })
      await tx.canvasCollaborator.create({ data: { boardId: board.id, userId: actorId, role: 'OWNER', createdBy: actorId } })
      const page = await tx.canvasPage.create({ data: {
        boardId: board.id, name: 'Página 1', position: 0, infinite: data?.infinite !== false,
        coordinateSystem: { unit: 'px', origin: { x: 0, y: 0 }, axis: 'screen' },
        background: data?.background ?? null,
      } })
      await tx.canvasLayer.createMany({ data: templateLayerRows(template, page.id) })
      await audit(tx, { companyId, actorId, action: 'BOARD_CREATED', entityType: 'CanvasBoard', entityId: board.id, after: board })
      return board
    })
  }
```

5. In `updateBoard`, replace:

```js
    for (const key of ['description', 'settings', 'metadata', 'thumbnailFileId']) {
      if (data[key] !== undefined) patch[key] = key === 'description' ? cleanText(data[key]) : data[key]
    }
```

with:

```js
    for (const key of ['description', 'metadata', 'thumbnailFileId']) {
      if (data[key] !== undefined) patch[key] = key === 'description' ? cleanText(data[key]) : data[key]
    }
    if (data.settings !== undefined) patch.settings = boardSettings(data.settings, effectiveBoardSettings(board))
```

6. In `createPage`, change the first line to `const { board } = await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')` and replace its `tx.canvasLayer.createMany({ data: [ ...three literal layers... ] })` with:

```js
      await tx.canvasLayer.createMany({ data: templateLayerRows(templateFor(board.templateType), page.id) })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/api/src/routes/canvas/__tests__/`
Expected: PASS, all canvas API tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/canvas/canvas-service.js apps/api/src/routes/canvas/__tests__/canvas-service.test.js
git commit -m "feat(canvas): boards and pages are created from their template"
```

---

### Task 3: Templates route, SDK method and MirAI

**Files:**
- Modify: `apps/api/src/routes/canvas/canvas-routes.js`
- Modify: `apps/api/src/routes/canvas/__tests__/canvas-routes.test.js`
- Modify: `apps/api/src/routes/canvas/canvas-mirai-queries.js:11-18,39`
- Modify: `packages/sdk/src/domains/canvas.js`

- [ ] **Step 1: Write the failing route test**

Append inside the `describe` of `canvas-routes.test.js`:

```js
  it('serves the template catalog behind canvas.view', async () => {
    const permissions = []
    const requirePermission = (key) => { permissions.push(key); return async (_c, next) => next() }
    const app = createCanvasRouter({ requirePermission, service: {} })
    const response = await app.request('http://localhost/canvas/templates')
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.data.length, 6)
    assert.equal(body.data[1].key, 'plan')
    assert.ok(permissions.includes('canvas.view'))
  })

  it('MirAI board types mirror the catalog', async () => {
    const { BOARD_TYPES } = await import('../canvas-mirai-queries.js')
    const { CANVAS_TEMPLATES } = await import('../canvas-templates.js')
    assert.deepEqual(BOARD_TYPES.map((type) => type.templateType), CANVAS_TEMPLATES.map((template) => template.key))
    assert.equal(BOARD_TYPES[1].uso, CANVAS_TEMPLATES[1].useWhen)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test apps/api/src/routes/canvas/__tests__/canvas-routes.test.js`
Expected: FAIL (`/canvas/templates` returns 404; `uso` differs).

- [ ] **Step 3: Implement**

In `canvas-routes.js` add the import:

```js
import { CANVAS_TEMPLATES } from './canvas-templates.js'
```

and, right before `app.get('/canvas/boards', ...)`:

```js
  app.get('/canvas/templates', requirePermission('canvas.view'), (c) => c.json({ data: CANVAS_TEMPLATES }))
```

In `canvas-mirai-queries.js` replace the `BOARD_TYPES` array literal (lines 11-18) with:

```js
import { CANVAS_TEMPLATES } from './canvas-templates.js'
```
(placed with the other imports at the top of the file) and:

```js
export const BOARD_TYPES = CANVAS_TEMPLATES.map((template) => ({ templateType: template.key, label: template.label, uso: template.useWhen, incluye: template.includes }))
```

and replace the `canvas_board_types` `run()` note string with:

```js
      return { tipos: BOARD_TYPES, nota: 'Cada tipo prepara capas, cuadricula y herramienta inicial; todas las herramientas (formas, textos, hotspots, imagenes y PDF) funcionan en cualquier tipo.' }
```

In `packages/sdk/src/domains/canvas.js`, add as the first entry of the returned object:

```js
    listTemplates: (token) => send('GET', '/canvas/templates', undefined, token),
```

- [ ] **Step 4: Run tests**

Run: `node --test apps/api/src/routes/canvas/__tests__/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/canvas/canvas-routes.js apps/api/src/routes/canvas/__tests__/canvas-routes.test.js apps/api/src/routes/canvas/canvas-mirai-queries.js packages/sdk/src/domains/canvas.js
git commit -m "feat(canvas): GET /canvas/templates; MirAI board types from the catalog"
```

---

### Task 4: Snap helpers and grid from settings in the renderer

**Files:**
- Create: `apps/desktop/src/modules/runly.canvas/engine/snap.js`
- Test: `apps/desktop/src/modules/runly.canvas/engine/snap.test.js`
- Modify: `apps/desktop/src/modules/runly.canvas/engine/Canvas2DRenderer.js:43-76`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { snapMoveDelta, snapPoint, snapSizeFor, snapValue } from './snap.js'

describe('Canvas grid snapping', () => {
  it('rounds to the nearest grid line and is a no-op without size', () => {
    assert.deepEqual(snapPoint({ x: 13, y: 27 }, 20), { x: 20, y: 20 })
    assert.equal(snapValue(9, 20), 0)
    assert.deepEqual(snapPoint({ x: 13, y: 27 }, 0), { x: 13, y: 27 })
  })

  it('moves a group so its top-left corner lands on the grid', () => {
    assert.deepEqual(snapMoveDelta({ x: 5, y: 5 }, 12, 33, 20), { dx: 15, dy: 35 })
    assert.deepEqual(snapMoveDelta({ x: 5, y: 5 }, 12, 33, 0), { dx: 12, dy: 33 })
  })

  it('snaps only with the grid visible and snapping on', () => {
    assert.equal(snapSizeFor({ grid: { enabled: true, size: 20 }, snapping: true }), 20)
    assert.equal(snapSizeFor({ grid: { enabled: false, size: 20 }, snapping: true }), 0)
    assert.equal(snapSizeFor({ grid: { enabled: true, size: 20 }, snapping: false }), 0)
    assert.equal(snapSizeFor(undefined), 0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test apps/desktop/src/modules/runly.canvas/engine/snap.test.js`
Expected: FAIL (`Cannot find module './snap.js'`)

- [ ] **Step 3: Implement `snap.js`**

```js
// Grid snapping in world units. A size of 0 means snapping is off.
export const snapValue = (value, size) => (size ? Math.round(value / size) * size : value)
export const snapPoint = (point, size) => ({ x: snapValue(point.x, size), y: snapValue(point.y, size) })

// Offset that lands the dragged group's top-left corner on the grid.
export function snapMoveDelta(bounds, dx, dy, size) {
  if (!size) return { dx, dy }
  return { dx: snapValue(bounds.x + dx, size) - bounds.x, dy: snapValue(bounds.y + dy, size) - bounds.y }
}

// Snap step for a Board: off unless the grid is visible and snapping is on.
export function snapSizeFor(settings) {
  return settings?.snapping && settings?.grid?.enabled ? settings.grid.size : 0
}
```

- [ ] **Step 4: Renderer reads the grid from the scene**

In `Canvas2DRenderer.js` `render(scene)`, replace `this.drawGrid(ctx, viewport)` with:

```js
    // Public links and older callers pass no grid: keep the dotted default.
    const grid = scene.grid ?? { enabled: true, size: GRID_STEP }
    if (grid.enabled) this.drawGrid(ctx, viewport, grid.size)
```

and change `drawGrid` to:

```js
  drawGrid(ctx, viewport, size = GRID_STEP) {
    let step = size * viewport.zoom
    while (step < 12) step *= 2
```

(rest of the method unchanged).

- [ ] **Step 5: Run tests and commit**

Run: `node --test apps/desktop/src/modules/runly.canvas/engine/`
Expected: PASS

```bash
git add apps/desktop/src/modules/runly.canvas/engine/snap.js apps/desktop/src/modules/runly.canvas/engine/snap.test.js apps/desktop/src/modules/runly.canvas/engine/Canvas2DRenderer.js
git commit -m "feat(canvas): grid snapping helpers; renderer grid follows settings"
```

---

### Task 5: Snapping in the viewport

**Files:**
- Modify: `apps/desktop/src/modules/runly.canvas/components/CanvasViewport.jsx`

No new unit tests (pointer handling is covered by the helpers from Task 4 and the manual smoke in Task 9).

- [ ] **Step 1: Imports**

```js
import { Canvas2DRenderer, sceneBounds } from '../engine/Canvas2DRenderer.js'
import { snapMoveDelta, snapPoint } from '../engine/snap.js'
```

(replacing the existing `Canvas2DRenderer` import).

- [ ] **Step 2: Pass the grid to the renderer**

In `draw()`, add `grid: p.grid,` to the object passed to `renderer.render({...})`.

- [ ] **Step 3: Record the group bounds when a move starts**

In `pointerDown`, replace:

```js
      dragRef.current = { mode: 'move', screen, world, objects: group, hitId: hit.id, moved: false }
```

with:

```js
      dragRef.current = { mode: 'move', screen, world, objects: group, bounds: sceneBounds(group), hitId: hit.id, moved: false }
```

- [ ] **Step 4: Snap create, move and resize in `pointerMove`**

Replace the block from `const world = screenToWorld(screen, p.viewport)` (after the marquee line) through the end of the resize branch with:

```js
    const world = screenToWorld(screen, p.viewport)
    // Alt temporarily disables snapping for the current gesture.
    const snap = event.altKey ? 0 : (p.snapSize ?? 0)
    if (drag.mode === 'create') {
      if (tool === 'hotspot' || tool === 'text') return
      const kind = tool === 'line' || tool === 'arrow' ? tool : 'rectangle'
      liveRef.current = { draft: draftObject(tool, boxFromDrag(kind, snapPoint(drag.world, snap), snapPoint(world, snap), { constrain: event.shiftKey })) }
    } else if (drag.mode === 'move') {
      const { dx, dy } = snapMoveDelta(drag.bounds, world.x - drag.world.x, world.y - drag.world.y, snap)
      liveRef.current = { mode: 'move', objects: new Map(drag.objects.map((object) => [object.id, moveObject(object, dx, dy)])) }
      setCursor('grabbing')
    } else {
      const [object] = drag.objects
      // Rotated boxes resize in their own frame; snapping a world point there
      // would fight the rotation, so only unrotated shapes snap.
      const target = boxOf(object).rotation ? world : snapPoint(world, snap)
      const next = drag.mode === 'rotate'
        ? rotateObject(object, world, { snap: event.shiftKey })
        : resizeObject(object, drag.handle, target, { keepRatio: event.shiftKey || object.type === 'image' })
      liveRef.current = { mode: drag.mode, objects: new Map([[object.id, next]]) }
      if (drag.mode === 'rotate') setCursor('grabbing')
    }
    schedule()
```

- [ ] **Step 5: Snap tap-to-place in `pointerUp`**

Replace `else p.onCreate({ tool, point: drag.world })` with:

```js
      else p.onCreate({ tool, point: snapPoint(drag.world, event.altKey ? 0 : (p.snapSize ?? 0)) })
```

- [ ] **Step 6: Accessible hint**

Append to the canvas `aria-label` string: ` Alt al arrastrar desactiva el ajuste a la cuadrícula.`

- [ ] **Step 7: Check and commit**

Run: `pnpm lint`
Expected: no errors in the changed file.

```bash
git add apps/desktop/src/modules/runly.canvas/components/CanvasViewport.jsx
git commit -m "feat(canvas): snap create, move and resize to the board grid"
```

---

### Task 6: Template-aware layers, media target and empty-state actions

**Files:**
- Create: `apps/desktop/src/modules/runly.canvas/lib/boardTemplates.js`
- Test: `apps/desktop/src/modules/runly.canvas/lib/boardTemplates.test.js`
- Modify: `apps/desktop/src/modules/runly.canvas/hooks/useMediaInsert.js`
- Modify: `apps/desktop/src/modules/runly.canvas/hooks/useBoardEditorActions.js:181`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { initialLayerId, mediaTargetLayer, parseEmptyAction } from './boardTemplates.js'

const layers = [
  { id: 'doc', type: 'vector', metadata: { mediaTarget: true, lockAfterInsert: true } },
  { id: 'notes', type: 'vector', metadata: {} },
  { id: 'pins', type: 'hotspot', metadata: {} },
]

describe('Canvas template helpers', () => {
  it('starts on the first drawing layer that is not the media backdrop', () => {
    assert.equal(initialLayerId({ layers }), 'notes')
    assert.equal(initialLayerId({ layers: [layers[0], layers[2]] }), 'doc')
    assert.equal(initialLayerId({ layers: [layers[2]] }), 'pins')
    assert.equal(initialLayerId({ layers: [] }), null)
  })

  it('finds the media target layer', () => {
    assert.equal(mediaTargetLayer(layers).id, 'doc')
    assert.equal(mediaTargetLayer([layers[1]]), null)
  })

  it('parses empty-state actions', () => {
    assert.deepEqual(parseEmptyAction('insert-media'), { type: 'insert-media' })
    assert.deepEqual(parseEmptyAction('tool:rectangle'), { type: 'tool', tool: 'rectangle' })
    assert.equal(parseEmptyAction('tool:laser'), null)
    assert.equal(parseEmptyAction(undefined), null)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test apps/desktop/src/modules/runly.canvas/lib/boardTemplates.test.js`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `boardTemplates.js`**

```js
// Editor helpers driven by the Board template (the catalog itself lives in
// the API: apps/api/src/routes/canvas/canvas-templates.js).
import { CREATION_TOOLS } from './objectFactory.js'

// Active layer when a page opens: the first drawing layer that is not the
// backdrop for inserted plans/PDFs, so new shapes land above it.
export function initialLayerId(page) {
  const layers = page?.layers ?? []
  const layer = layers.find((item) => item.type === 'vector' && !item.metadata?.mediaTarget)
    ?? layers.find((item) => item.type === 'vector')
    ?? layers[0]
  return layer?.id ?? null
}

export function mediaTargetLayer(layers) {
  return layers.find((layer) => layer.metadata?.mediaTarget) ?? null
}

// emptyState.action.kind: 'insert-media' | 'tool:<creation tool>'
export function parseEmptyAction(kind) {
  if (kind === 'insert-media') return { type: 'insert-media' }
  const tool = typeof kind === 'string' && kind.startsWith('tool:') ? kind.slice(5) : null
  return tool && CREATION_TOOLS.has(tool) ? { type: 'tool', tool } : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/desktop/src/modules/runly.canvas/lib/boardTemplates.test.js`
Expected: PASS

- [ ] **Step 5: Media insertion uses the target layer**

In `useMediaInsert.js`:

1. Add the import `import { mediaTargetLayer } from '../lib/boardTemplates.js'`.
2. Change the signature to `export function useMediaInsert({ upload, viewport, size, drawableLayer, layers, lockLayer, rows, pageId, createRows, fail })`.
3. Replace the first two lines of `placeImages` (`const layer = drawableLayer()` and the `if (!layer) throw ...`) with:

```js
    // Templates flag a backdrop layer (Plano base, Documento…) for inserted
    // media; a hidden or locked one falls back to the active drawing layer.
    const target = mediaTargetLayer(layers)
    const layer = target && target.visible && !target.locked ? target : drawableLayer()
    if (!layer) throw new Error('No hay una capa de dibujo disponible.')
    if (target && layer !== target) toast.info(`La capa «${target.name}» está ${target.locked ? 'bloqueada' : 'oculta'}; se insertó en la capa activa.`)
```

4. Replace the last line of `placeImages` (`await createRows(datas, label)`) with:

```js
    await createRows(datas, label)
    if (layer === target && target.metadata?.lockAfterInsert) await lockLayer(target)
```

In `useBoardEditorActions.js`, replace the `useMediaInsert` call with:

```js
  const media = useMediaInsert({ upload, viewport, size, drawableLayer, layers, lockLayer: (layer) => toggleLayer(layer, { locked: true }), rows, pageId, createRows, fail })
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/modules/runly.canvas/lib/boardTemplates.js apps/desktop/src/modules/runly.canvas/lib/boardTemplates.test.js apps/desktop/src/modules/runly.canvas/hooks/useMediaInsert.js apps/desktop/src/modules/runly.canvas/hooks/useBoardEditorActions.js
git commit -m "feat(canvas): media goes to the template backdrop layer and can lock it"
```

---

### Task 7: Editor wiring — settings, default tool, initial layer, empty state, Board settings panel

**Files:**
- Modify: `apps/desktop/src/modules/runly.canvas/hooks/useCanvasData.js`
- Create: `apps/desktop/src/modules/runly.canvas/components/inspector/BoardSettingsSection.jsx`
- Modify: `apps/desktop/src/modules/runly.canvas/components/BoardInspector.jsx`
- Modify: `apps/desktop/src/modules/runly.canvas/screens/BoardEditor.jsx`

- [ ] **Step 1: Data hooks**

Append to `useCanvasData.js`:

```js
// Template catalog (static per API build).
export function useCanvasTemplates() {
  const token = useToken()
  return useQuery({
    queryKey: ['canvas', 'templates'],
    queryFn: async () => unwrap(await runly.canvas.listTemplates(token)) ?? [],
    enabled: Boolean(token),
    staleTime: Infinity,
  })
}

// Board settings are applied optimistically so the grid redraws at once.
export function useUpdateBoardSettings(boardId) {
  const token = useToken(), client = useQueryClient(), key = boardKey(boardId)
  return useMutation({
    mutationFn: (settings) => runly.canvas.updateBoard(boardId, { settings }, token),
    onMutate: (settings) => {
      client.cancelQueries({ queryKey: key, exact: true })
      const previous = client.getQueryData(key)
      client.setQueryData(key, (board) => board ? { ...board, effectiveSettings: settings } : board)
      return { previous }
    },
    onError: (_error, _settings, context) => client.setQueryData(key, context?.previous),
    onSettled: () => client.invalidateQueries({ queryKey: key, exact: true }),
  })
}
```

- [ ] **Step 2: `BoardSettingsSection.jsx`**

```jsx
import { SwitchField } from '@runly/ui'
import { FieldLabel, NumberInput, Section } from './fields.jsx'

const GRID_MIN = 4, GRID_MAX = 200

// Grid and snapping for the whole Board; shown when nothing is selected.
export function BoardSettingsSection({ settings, onChange, readOnly = false }) {
  if (!settings) return null
  const grid = settings.grid
  return (
    <Section title="Ajustes del Board">
      <div className="space-y-3 px-0.5">
        <SwitchField
          id="canvas-grid-enabled" label="Mostrar cuadrícula" checked={grid.enabled} disabled={readOnly}
          onChange={(enabled) => onChange({ ...settings, grid: { ...grid, enabled } })}
        />
        <div>
          <FieldLabel>Tamaño de cuadrícula</FieldLabel>
          <NumberInput
            label="Tamaño de cuadrícula" short="#" suffix="px" value={grid.size} min={GRID_MIN} max={GRID_MAX}
            disabled={readOnly || !grid.enabled}
            onCommit={(size) => onChange({ ...settings, grid: { ...grid, size: Math.round(size) } })}
          />
        </div>
        <SwitchField
          id="canvas-grid-snapping" label="Ajustar a la cuadrícula"
          description="Mantén Alt al arrastrar para desactivarlo un momento."
          checked={settings.snapping} disabled={readOnly || !grid.enabled}
          onChange={(snapping) => onChange({ ...settings, snapping })}
        />
      </div>
    </Section>
  )
}
```

- [ ] **Step 3: `BoardInspector.jsx`**

Add the import `import { BoardSettingsSection } from './inspector/BoardSettingsSection.jsx'`, add `settings, onSettingsChange` to the props, and replace the final branch of the selection ternary (the dashed hint `<div>`) with:

```jsx
      ) : (
        <>
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-6 text-center">
            <MousePointerClick className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Selecciona un elemento para editar su posición, tamaño, colores y vínculos.</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Shift + clic o arrastrar en un área vacía para seleccionar varios. En pantallas táctiles, mantén presionado. Doble clic abre hotspots y textos.
            </p>
          </div>
          <BoardSettingsSection settings={settings} onChange={onSettingsChange} readOnly={readOnly} />
        </>
      )}
```

- [ ] **Step 4: `BoardEditor.jsx`**

1. Imports: add `Button` to the `@runly/ui` import; change the data-hook import to
   `import { useBoard, useCanvasImages, useCanvasObjects, useCanvasTemplates, useEntityLinks, useUpdateBoardSettings, useUpdateHotspot } from '../hooks/useCanvasData.js'`;
   add `import { snapSizeFor } from '../engine/snap.js'` and `import { initialLayerId, parseEmptyAction } from '../lib/boardTemplates.js'`.

2. After `const myRole = ...` line add:

```js
  const settings = board.data?.effectiveSettings ?? null
  const templates = useCanvasTemplates(), updateSettings = useUpdateBoardSettings(boardId)
  const template = templates.data?.find((item) => item.key === board.data?.templateType) ?? null
```

3. Replace the first-page `useEffect` body and `changePage`'s `setLayerId(...)` to use the helper:

```js
  useEffect(() => {
    const page = pages[0]
    if (!pageId && page) { setPageId(page.id); setLayerId(initialLayerId(page)) }
  }, [pages, pageId])
```

and in `changePage`: `setLayerId(initialLayerId(page))`.

4. After the `actions` declaration add the default-tool effect:

```js
  // The template's starting tool, applied once per Board for editors only.
  const toolAppliedRef = useRef(null)
  useEffect(() => {
    if (!settings || !layerId || toolAppliedRef.current === boardId) return
    toolAppliedRef.current = boardId
    if (!readOnly && settings.defaultTool && settings.defaultTool !== 'select') actions.chooseTool(settings.defaultTool)
  }, [settings, layerId, boardId, readOnly, actions])
```

5. Add `settings={settings}` and `onSettingsChange={(next) => updateSettings.mutate(next, { onError: (error) => toast.error(error.message) })}` to the `<BoardInspector ... />` props.

6. Add `grid={settings?.grid} snapSize={snapSizeFor(settings)}` to the `<CanvasViewport ... />` props.

7. Replace the empty-page block (`{!board.isLoading && !objects.isLoading && !rows.length && !hint ? (...) : null}`) with:

```jsx
          {!board.isLoading && !objects.isLoading && !rows.length && !hint ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-xs text-center">
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">{readOnly ? 'Esta página está vacía' : empty.title}</p>
                <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{readOnly ? 'Todavía no hay contenido en esta página.' : empty.description}</p>
                {!readOnly && emptyAction ? (
                  <Button size="sm" className="pointer-events-auto mt-3" disabled={actions.inserting} onClick={runEmptyAction}>{empty.action.label}</Button>
                ) : null}
              </div>
            </div>
          ) : null}
```

   and, next to `const hint = hintFor(tool)`, define:

```js
  const empty = template?.emptyState ?? { title: 'Esta página está vacía', description: 'Dibuja formas, escribe textos, coloca hotspots o inserta una imagen o PDF desde la barra inferior.', action: null }
  const emptyAction = parseEmptyAction(empty.action?.kind)
  // The file picker must open from this click: browsers block it otherwise.
  const runEmptyAction = () => {
    if (emptyAction?.type === 'insert-media') actions.openFilePicker()
    else if (emptyAction?.type === 'tool') actions.chooseTool(emptyAction.tool)
  }
```

- [ ] **Step 5: Lint, build, commit**

Run: `pnpm lint` then `pnpm --filter ./apps/desktop build:web`
Expected: both succeed.

```bash
git add apps/desktop/src/modules/runly.canvas/hooks/useCanvasData.js apps/desktop/src/modules/runly.canvas/components/inspector/BoardSettingsSection.jsx apps/desktop/src/modules/runly.canvas/components/BoardInspector.jsx apps/desktop/src/modules/runly.canvas/screens/BoardEditor.jsx
git commit -m "feat(canvas): editor honours board settings, template tool and empty state"
```

---

### Task 8: "Nuevo Board" dialog with previews, and catalog labels on cards

**Files:**
- Create: `apps/desktop/src/modules/runly.canvas/lib/templatePreviews.js`
- Test: `apps/desktop/src/modules/runly.canvas/lib/templatePreviews.test.js`
- Create: `apps/desktop/src/modules/runly.canvas/components/TemplatePreview.jsx`
- Modify: `apps/desktop/src/modules/runly.canvas/lib/boardMeta.js`
- Modify: `apps/desktop/src/modules/runly.canvas/components/CreateBoardDialog.jsx`
- Modify: `apps/desktop/src/modules/runly.canvas/components/BoardCard.jsx`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CANVAS_TEMPLATES } from '../../../../../api/src/routes/canvas/canvas-templates.js'
import { TEMPLATE_PREVIEWS, previewFor } from './templatePreviews.js'

describe('Template previews', () => {
  it('has an illustration for every catalog template', () => {
    for (const template of CANVAS_TEMPLATES) assert.ok(TEMPLATE_PREVIEWS[template.preview]?.length, template.key)
  })
  it('falls back to blank for unknown keys', () => {
    assert.equal(previewFor('nope'), TEMPLATE_PREVIEWS.blank)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test apps/desktop/src/modules/runly.canvas/lib/templatePreviews.test.js`
Expected: FAIL (module not found)

- [ ] **Step 3: `templatePreviews.js`**

```js
// Mini illustrations for the "Nuevo Board" cards: SVG primitives in a
// 120×68 box. Tones: 'line' (outline), 'accent' (primary), 'soft' (muted fill).
export const TEMPLATE_PREVIEWS = {
  blank: [{ kind: 'rect', x: 28, y: 14, w: 64, h: 40, r: 6, tone: 'line', dash: true }],
  plan: [
    { kind: 'rect', x: 14, y: 8, w: 92, h: 52, tone: 'line' },
    { kind: 'line', x1: 60, y1: 8, x2: 60, y2: 36, tone: 'line' },
    { kind: 'line', x1: 14, y1: 34, x2: 44, y2: 34, tone: 'line' },
    { kind: 'rect', x: 70, y: 42, w: 26, h: 12, r: 2, tone: 'soft' },
    { kind: 'circle', cx: 82, cy: 22, r: 4, tone: 'accent' },
    { kind: 'circle', cx: 30, cy: 48, r: 4, tone: 'accent' },
  ],
  'technical-map': [
    { kind: 'path', d: 'M10 50 H50 V20 H110', tone: 'line' },
    { kind: 'path', d: 'M50 50 V60', tone: 'line' },
    { kind: 'circle', cx: 50, cy: 20, r: 4.5, tone: 'accent' },
    { kind: 'circle', cx: 82, cy: 20, r: 4.5, tone: 'accent' },
    { kind: 'circle', cx: 26, cy: 50, r: 4.5, tone: 'accent' },
  ],
  diagram: [
    { kind: 'rect', x: 8, y: 24, w: 28, h: 18, r: 3, tone: 'line' },
    { kind: 'path', d: 'M60 20 L73 33 L60 46 L47 33 Z', tone: 'line' },
    { kind: 'rect', x: 84, y: 24, w: 28, h: 18, r: 3, tone: 'line' },
    { kind: 'line', x1: 36, y1: 33, x2: 47, y2: 33, tone: 'accent' },
    { kind: 'line', x1: 73, y1: 33, x2: 84, y2: 33, tone: 'accent' },
  ],
  layout: [
    { kind: 'rect', x: 8, y: 6, w: 104, h: 56, r: 3, tone: 'line' },
    { kind: 'circle', cx: 30, cy: 24, r: 8, tone: 'soft' },
    { kind: 'circle', cx: 60, cy: 24, r: 8, tone: 'soft' },
    { kind: 'circle', cx: 90, cy: 24, r: 8, tone: 'soft' },
    { kind: 'rect', x: 18, y: 42, w: 24, h: 10, r: 2, tone: 'soft' },
    { kind: 'rect', x: 48, y: 42, w: 24, h: 10, r: 2, tone: 'soft' },
    { kind: 'rect', x: 78, y: 42, w: 24, h: 10, r: 2, tone: 'soft' },
  ],
  'pdf-review': [
    { kind: 'rect', x: 34, y: 6, w: 52, h: 58, r: 2, tone: 'line' },
    { kind: 'line', x1: 42, y1: 16, x2: 78, y2: 16, tone: 'soft' },
    { kind: 'line', x1: 42, y1: 24, x2: 74, y2: 24, tone: 'soft' },
    { kind: 'line', x1: 42, y1: 32, x2: 78, y2: 32, tone: 'soft' },
    { kind: 'line', x1: 42, y1: 40, x2: 64, y2: 40, tone: 'soft' },
    { kind: 'rect', x: 40, y: 28, w: 40, h: 8, r: 2, tone: 'accent', dash: true },
    { kind: 'circle', cx: 82, cy: 50, r: 5, tone: 'accent' },
  ],
}

export const previewFor = (key) => TEMPLATE_PREVIEWS[key] ?? TEMPLATE_PREVIEWS.blank
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/desktop/src/modules/runly.canvas/lib/templatePreviews.test.js`
Expected: PASS

- [ ] **Step 5: `TemplatePreview.jsx`**

```jsx
import { previewFor } from '../lib/templatePreviews.js'

const TONES = {
  line: { fill: 'none', stroke: 'hsl(var(--foreground) / 0.55)' },
  accent: { fill: 'hsl(var(--primary) / 0.18)', stroke: 'hsl(var(--primary))' },
  soft: { fill: 'hsl(var(--muted-foreground) / 0.18)', stroke: 'hsl(var(--muted-foreground) / 0.4)' },
}

function PreviewShape({ shape }) {
  const tone = TONES[shape.tone] ?? TONES.line
  const props = {
    fill: shape.kind === 'line' || (shape.kind === 'path' && shape.tone === 'line') ? 'none' : tone.fill,
    stroke: tone.stroke, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
    strokeDasharray: shape.dash ? '4 3' : undefined,
  }
  if (shape.kind === 'rect') return <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.r ?? 0} {...props} />
  if (shape.kind === 'circle') return <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...props} />
  if (shape.kind === 'line') return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...props} />
  return <path d={shape.d} {...props} />
}

// Decorative: the card label already names the template.
export function TemplatePreview({ preview, grid = false, className }) {
  const patternId = `canvas-template-grid-${preview}`
  return (
    <svg viewBox="0 0 120 68" className={className} aria-hidden="true" focusable="false">
      {grid ? (
        <>
          <defs>
            <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.6" fill="hsl(var(--muted-foreground) / 0.4)" />
            </pattern>
          </defs>
          <rect width="120" height="68" fill={`url(#${patternId})`} />
        </>
      ) : null}
      {previewFor(preview).map((shape, index) => <PreviewShape key={index} shape={shape} />)}
    </svg>
  )
}
```

- [ ] **Step 6: `boardMeta.js` keeps icons only**

Replace the `BOARD_TEMPLATES` array and `templateMeta` (and the lucide import line) with:

```js
import { FileSearch, Frame, LayoutGrid, Map, Square, Workflow } from 'lucide-react'

// Lucide icon per catalog `icon` name; labels and texts come from the API
// catalog (GET /canvas/templates).
const TEMPLATE_ICONS = { square: Square, frame: Frame, map: Map, workflow: Workflow, 'layout-grid': LayoutGrid, 'file-search': FileSearch }
export const templateIcon = (name) => TEMPLATE_ICONS[name] ?? Square
```

(`timeAgo` and its constants stay unchanged.)

- [ ] **Step 7: `BoardCard.jsx`**

Change imports to:

```js
import { templateIcon, timeAgo } from '../lib/boardMeta.js'
import { useCanvasTemplates } from '../hooks/useCanvasData.js'
```

and replace `const template = templateMeta(board.templateType), Icon = template.icon` with:

```js
  const templates = useCanvasTemplates()
  const template = templates.data?.find((item) => item.key === board.templateType)
  const Icon = templateIcon(template?.icon), templateLabel = template?.label ?? 'Board'
```

then replace `{template.label}` in the JSX with `{templateLabel}`.

- [ ] **Step 8: `CreateBoardDialog.jsx` (full replacement)**

```jsx
import { Fragment, useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ErrorState, Input, Label, Skeleton, Textarea, cn } from '@runly/ui'
import { Check, Loader2 } from 'lucide-react'
import { useCanvasTemplates } from '../hooks/useCanvasData.js'
import { templateIcon } from '../lib/boardMeta.js'
import { TemplatePreview } from './TemplatePreview.jsx'

const EMPTY = { name: '', description: '', templateType: 'blank' }
const HEADING = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]'

function TemplateDetail({ template, className }) {
  return (
    <div className={cn('rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] p-3', className)}>
      <p className={HEADING}>Úsala cuando…</p>
      <p className="mt-1 text-sm">{template.useWhen}</p>
      <p className={cn(HEADING, 'mt-3')}>Incluye</p>
      <ul className="mt-1 space-y-1">
        {template.includes.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />{item}</li>
        ))}
      </ul>
    </div>
  )
}

export function CreateBoardDialog({ open, onOpenChange, onSubmit, pending }) {
  const [form, setForm] = useState(EMPTY)
  const templates = useCanvasTemplates()
  const list = templates.data ?? []
  const selected = list.find((item) => item.key === form.templateType) ?? list[0] ?? null
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const close = (next) => { onOpenChange(next); if (!next) setForm(EMPTY) }

  async function submit(event) {
    event.preventDefault()
    if (pending || !selected || !form.name.trim()) return
    const ok = await onSubmit({ ...form, templateType: selected.key, name: form.name.trim(), description: form.description.trim() || undefined })
    if (ok) setForm(EMPTY)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent scrollable size="xl" className="gap-0 p-0 md:p-0 md:pt-0!">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="mb-0 shrink-0 px-5 pt-4 pb-2">
            <DialogTitle>Nuevo Board</DialogTitle>
            <DialogDescription>Elige una plantilla: cada una prepara capas, cuadrícula y herramientas para su uso.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Plantilla</legend>
              {templates.isError ? (
                <ErrorState title="No se pudieron cargar las plantillas" description={templates.error?.message} onRetry={() => templates.refetch()} />
              ) : templates.isLoading ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-36 rounded-xl" />)}</div>
              ) : (
                <div role="radiogroup" aria-label="Plantilla" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {list.map((template) => {
                    const active = selected?.key === template.key, Icon = templateIcon(template.icon)
                    return (
                      <Fragment key={template.key}>
                        <button
                          type="button" role="radio" aria-checked={active}
                          onClick={() => setForm((current) => ({ ...current, templateType: template.key }))}
                          className={cn(
                            'flex cursor-pointer flex-col items-start gap-1.5 rounded-xl border p-2.5 text-left transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                            active ? 'border-primary bg-primary/8' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)/0.6)]',
                          )}
                        >
                          <TemplatePreview preview={template.preview} grid={template.settings.grid.enabled} className="aspect-120/68 w-full rounded-lg bg-[hsl(var(--muted)/0.5)]" />
                          <span className="flex items-center gap-1.5 text-sm font-medium leading-tight">
                            <Icon className={cn('h-3.5 w-3.5', active ? 'text-primary' : 'text-[hsl(var(--muted-foreground))]')} aria-hidden />{template.label}
                          </span>
                          <span className="text-xs leading-tight text-[hsl(var(--muted-foreground))]">{template.description}</span>
                        </button>
                        {active ? <TemplateDetail template={template} className="sm:hidden" /> : null}
                      </Fragment>
                    )
                  })}
                </div>
              )}
              {selected ? <TemplateDetail template={selected} className="hidden sm:block" /> : null}
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="canvas-board-name">Nombre <span className="text-destructive" aria-hidden>*</span></Label>
              <Input id="canvas-board-name" value={form.name} onChange={set('name')} placeholder={selected?.namePlaceholder ?? 'Ej. Planta baja — almacén'} maxLength={200} required autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="canvas-board-description">Descripción <span className="font-normal text-[hsl(var(--muted-foreground))]">(opcional)</span></Label>
              <Textarea id="canvas-board-description" value={form.description} onChange={set('description')} rows={2} placeholder="¿Para qué se usará este Board?" />
            </div>
          </div>
          <DialogFooter className="mt-0 shrink-0 px-5 py-4">
            <Button type="button" variant="outline" onClick={() => close(false)}>Cancelar</Button>
            <Button type="submit" disabled={!form.name.trim() || !selected || pending}>
              {pending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
              {pending ? 'Creando…' : 'Crear Board'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

(`size="xl"` maps to `md:max-w-2xl` in `packages/ui/src/components/Dialog.jsx`, wide enough for three preview cards.)

- [ ] **Step 9: Verify nothing else uses the removed exports, lint, build, commit**

Run: `grep -rn "templateMeta\|BOARD_TEMPLATES" apps/desktop/src` — expected: no matches.
Run: `node --test apps/desktop/src/modules/runly.canvas/` — expected: PASS.
Run: `pnpm lint` and `pnpm --filter ./apps/desktop build:web` — expected: success.

```bash
git add apps/desktop/src/modules/runly.canvas/lib/templatePreviews.js apps/desktop/src/modules/runly.canvas/lib/templatePreviews.test.js apps/desktop/src/modules/runly.canvas/components/TemplatePreview.jsx apps/desktop/src/modules/runly.canvas/lib/boardMeta.js apps/desktop/src/modules/runly.canvas/components/CreateBoardDialog.jsx apps/desktop/src/modules/runly.canvas/components/BoardCard.jsx
git commit -m "feat(canvas): new board dialog explains each template with a preview"
```

---

### Task 9: Help text and verification

**Files:**
- Modify: `apps/api/src/manifests/official/help/runly.canvas/overview.md`
- Modify: `docs/superpowers/specs/2026-10-01-canvas-board-templates-design.md` (Status)

- [ ] **Step 1: Help text**

In `overview.md` (it is written without accents; keep that style), replace the paragraph under `### Tipos de Board (plantillas)` that starts with "Al crear un Board eliges una plantilla. La plantilla solo sirve..." with:

```md
Al crear un Board eliges una plantilla. Cada plantilla **prepara el Board para su uso**: crea capas con nombre, configura la cuadricula y el ajuste a la cuadricula, elige la herramienta inicial y muestra en la pagina vacia el primer paso recomendado. Todas las herramientas (formas, textos, hotspots, imagenes y PDF) funcionan en cualquier plantilla, y la cuadricula se puede cambiar despues.
```

and replace the `### Capas` section's first two lines plus its three bullets with:

```md
Cada pagina trae las capas de su plantilla (por ejemplo, un Plano trae **Plano base**, **Mobiliario** y **Hotspots**; una Revision de PDF trae **Documento**, **Anotaciones** y **Hotspots**). Las imagenes y PDF que insertes van a la capa de fondo de la plantilla (Plano base, Instalaciones, Espacios o Documento); en Revision de PDF esa capa se bloquea al insertar para que las paginas no se muevan mientras anotas. Los hotspots siempre van a su capa de hotspots.

### Cuadricula y ajuste

Sin nada seleccionado, el inspector muestra **Ajustes del Board**: mostrar u ocultar la cuadricula, su tamano y **Ajustar a la cuadricula**. Con el ajuste activo, las formas se alinean a la cuadricula al dibujarlas, moverlas o cambiar su tamano; mantén **Alt** mientras arrastras para desactivarlo un momento.
```

- [ ] **Step 2: Automated verification**

Run:

```bash
node --test apps/api/src/routes/canvas/__tests__/
node --test apps/desktop/src/modules/runly.canvas/
pnpm lint
pnpm --filter ./apps/desktop build:web
```

Expected: all pass. Report exact counts.

- [ ] **Step 3: Manual smoke (existing dev servers only)**

Check `curl -s http://localhost:4010/health`. If it is not running, stop and ask the user to start it — do not start it yourself. With the app at http://localhost:5173:

1. Create one Board per template; check the layer names in "Páginas y capas", the grid, the initial tool (Diagrama → Rectángulo, Mapa técnico → Hotspot) and the empty-state title/button.
2. In a Plano Board, drag a rectangle starting off-grid: its corner lands on the grid; repeat holding Alt: it does not snap.
3. In Revisión de PDF, use "Insertar PDF": pages land in Documento and that layer shows the lock.
4. In the inspector with nothing selected, change grid size to 30 and toggle snapping; reload: values persist.
5. Open a Board created before this change: no snapping for a blank Board, looks as before.
6. Ask MirAI "créame un Board de diagrama llamado Prueba": same layers as one created from the dialog.
7. Run the 14-aspect checklist in `docs/ai-context/ui-screen-audit-checklist.md` for the dialog (mobile width included) and note any finding.

- [ ] **Step 4: Mark the spec and commit**

Change `## 2. Status` in the spec to `Complete — Verified: YYYY-MM-DD (tests, lint, build:web, manual smoke)` with the real date and evidence.

```bash
git add apps/api/src/manifests/official/help/runly.canvas/overview.md docs/superpowers/specs/2026-10-01-canvas-board-templates-design.md
git commit -m "docs(canvas): help for board templates and grid settings"
```
