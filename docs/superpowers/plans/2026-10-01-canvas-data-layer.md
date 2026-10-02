# Canvas Data Layer (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Canvas objects can be bound to ERP records (inventory locations/items first, any relation-target type generically) and show live title, summary and status colour; inventory item detail lists the Boards it appears in.

**Architecture:** A `canvas-data-sources.js` service in the API owns the source catalog, search and batched resolution (inventory providers with Prisma; other types delegate to `relation-targets-service`). Bindings live in `CanvasObject.properties.binding`. The desktop resolves bound objects of the visible page through one TanStack Query (30 s stale, 60 s polling) and passes the results to `Canvas2DRenderer`, which tints and labels bound shapes.

**Tech Stack:** Hono, Prisma, React + TanStack Query, `@runly/ui`, Canvas2D, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-01-canvas-data-layer-design.md`

**Rules:** JavaScript only; UI text Spanish, code/comments English; no emojis; `@runly/ui` components (check real props in `packages/ui/src` before use); modal header/footer fixed, body scrolls; never start/stop dev servers (4010/5173); no file over 800 lines; tests with explicit globs (bare directories fail on this Windows setup); `pnpm lint` has 8 pre-existing errors in `custom.encuestas` bundles — check touched files with `npx eslint <files>`. Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Data sources service (API)

**Files:**
- Create: `apps/api/src/routes/canvas/canvas-data-sources.js`
- Test: `apps/api/src/routes/canvas/__tests__/canvas-data-sources.test.js`

- [ ] **Step 1: Failing tests**

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DATA_SOURCES, createCanvasDataSources, isDataSource } from '../canvas-data-sources.js'

const COMPANY = 'company-1'
const allowAll = { assertCompanyMember: async () => true }
const denyAll = { assertCompanyMember: async () => { throw new Error('no') } }
const profile = { userProfile: { findUnique: async () => ({ id: 'profile-1' }) } }

function prismaWith(extra) {
  return {
    ...profile,
    runlyModule: { findMany: async () => [{ key: 'runly.inventory' }, { key: 'runly.fleet' }] },
    ...extra,
  }
}

describe('Canvas data sources', () => {
  it('knows inventory sources plus every relation target type', () => {
    assert.ok(isDataSource('inventory_location'))
    assert.ok(isDataSource('inventory_item'))
    assert.ok(isDataSource('vehicle'))
    assert.equal(isDataSource('nope'), false)
    assert.equal(DATA_SOURCES.inventory_location.permission, 'inventory.item.read')
  })

  it('summarises a location by item status', async () => {
    const prisma = prismaWith({
      invLocation: { findMany: async ({ where }) => { assert.equal(where.companyId, COMPANY); return [{ id: 'loc-1', name: 'Rack A-3', description: null }] } },
      invItem: { groupBy: async () => [{ locationId: 'loc-1', status: 'available', _count: { _all: 2 } }, { locationId: 'loc-1', status: 'maintenance', _count: { _all: 1 } }] },
    })
    const sources = createCanvasDataSources({ prisma, access: allowAll, relationTargets: {} })
    const result = await sources.resolve({ authUserId: 'auth-1', companyId: COMPANY, refs: [{ source: 'inventory_location', id: 'loc-1' }, { source: 'inventory_location', id: 'loc-x' }] })
    assert.equal(result['inventory_location:loc-1'].summary, '3 equipos · 1 en mantenimiento')
    assert.equal(result['inventory_location:loc-1'].tone, 'warning')
    assert.equal(result['inventory_location:loc-x'].missing, true)
  })

  it('describes an item by status, assignee and location', async () => {
    const prisma = prismaWith({
      invItem: { findMany: async () => [{ id: 'it-1', name: 'Laptop 14', assetTag: 'A-001', status: 'assigned', adminStatus: 'registered', assignedTo: { firstName: 'Ana', lastName: 'Ruiz' }, location: { name: 'Oficina' }, condition: { name: 'Buena' } }] },
    })
    const sources = createCanvasDataSources({ prisma, access: allowAll, relationTargets: {} })
    const result = await sources.resolve({ authUserId: 'auth-1', companyId: COMPANY, refs: [{ source: 'inventory_item', id: 'it-1' }] })
    const item = result['inventory_item:it-1']
    assert.equal(item.tone, 'info')
    assert.equal(item.subtitle, 'A-001')
    assert.deepEqual(item.metrics.find((m) => m.label === 'Asignado a'), { label: 'Asignado a', value: 'Ana Ruiz' })
    assert.equal(item.url, '/app/m/runly.inventory/inventory/it-1')
  })

  it('marks refs restricted when the user lacks the source permission', async () => {
    const sources = createCanvasDataSources({ prisma: prismaWith({}), access: denyAll, relationTargets: {} })
    const result = await sources.resolve({ authUserId: 'auth-1', companyId: COMPANY, refs: [{ source: 'inventory_item', id: 'it-1' }] })
    assert.equal(result['inventory_item:it-1'].restricted, true)
  })

  it('delegates other types to relation targets', async () => {
    const relationTargets = { resolve: async ({ type, ids }) => new Map(ids.map((id) => [id, { title: `${type} ${id}`, subtitle: null, url: '/x' }])) }
    const sources = createCanvasDataSources({ prisma: prismaWith({}), access: allowAll, relationTargets })
    const result = await sources.resolve({ authUserId: 'auth-1', companyId: COMPANY, refs: [{ source: 'vehicle', id: 'v-1' }, { source: 'vehicle', id: 'v-2' }] })
    assert.equal(result['vehicle:v-1'].title, 'vehicle v-1')
    assert.equal(result['vehicle:v-1'].tone, 'neutral')
  })

  it('lists sources with installed/allowed flags', async () => {
    const sources = createCanvasDataSources({ prisma: prismaWith({}), access: allowAll, relationTargets: {} })
    const list = await sources.catalog({ authUserId: 'auth-1', companyId: COMPANY })
    const location = list.find((s) => s.key === 'inventory_location')
    assert.equal(location.installed, true); assert.equal(location.allowed, true)
    assert.equal(list.find((s) => s.key === 'contact').installed, false)
  })
})
```

- [ ] **Step 2: Run** `node --test apps/api/src/routes/canvas/__tests__/canvas-data-sources.test.js` — expect FAIL (module not found).

- [ ] **Step 3: Implement `canvas-data-sources.js`**

```js
// apps/api/src/routes/canvas/canvas-data-sources.js
//
// Sources a Canvas object can be bound to (`properties.binding`). Inventory
// locations and items have their own providers with live metrics; every other
// relation-target type (vehicles, employees, projects…) resolves through
// relation-targets-service with title/subtitle/url only.
import { EXTERNAL_RELATION_TARGETS } from '@runly/module-compiler'
import { createUserAccessService } from '../../services/user-access-service.js'

const INVENTORY = { module: 'runly.inventory', permission: 'inventory.item.read' }
export const DATA_SOURCES = Object.freeze({
  inventory_location: { label: 'Ubicación de inventario', ...INVENTORY },
  inventory_item: { label: 'Artículo de inventario', ...INVENTORY },
  ...Object.fromEntries(Object.entries(EXTERNAL_RELATION_TARGETS)
    .filter(([type]) => type !== 'inventory_item')
    .map(([type, target]) => [type, { label: target.label, module: target.module, permission: target.permission }])),
})
export const isDataSource = (key) => Object.hasOwn(DATA_SOURCES, key)
export const MAX_REFS = 500

const STATUS_LABELS = { available: 'Disponible', assigned: 'Asignado', maintenance: 'Mantenimiento' }
const STATUS_TONES = { available: 'ok', assigned: 'info', maintenance: 'warning' }
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

export function createCanvasDataSources({ prisma, relationTargets, access = createUserAccessService({ prisma }) }) {
  async function profileIdOf(authUserId) {
    const profile = await prisma.userProfile.findUnique({ where: { authUserId }, select: { id: true } })
    return profile?.id ?? null
  }
  async function allowed(companyId, profileId, source) {
    if (!profileId) return false
    try { await access.assertCompanyMember(companyId, profileId, DATA_SOURCES[source].permission); return true } catch { return false }
  }

  async function catalog({ authUserId, companyId }) {
    const installed = new Set((await prisma.runlyModule.findMany({ where: { status: 'INSTALLED', enabled: true }, select: { key: true } })).map((row) => row.key))
    const profileId = await profileIdOf(authUserId)
    return Promise.all(Object.entries(DATA_SOURCES).map(async ([key, source]) => ({
      key, label: source.label, module: source.module,
      installed: installed.has(source.module), allowed: await allowed(companyId, profileId, key),
    })))
  }

  const providers = {
    async inventory_location(companyId, ids) {
      const locations = await prisma.invLocation.findMany({ where: { companyId, id: { in: ids }, enabled: true }, select: { id: true, name: true, description: true } })
      const counts = await prisma.invItem.groupBy({ by: ['locationId', 'status'], where: { companyId, enabled: true, adminStatus: 'registered', locationId: { in: locations.map((row) => row.id) } }, _count: { _all: true } })
      return new Map(locations.map((location) => {
        const byStatus = Object.fromEntries(counts.filter((row) => row.locationId === location.id).map((row) => [row.status, row._count._all]))
        const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0), maintenance = byStatus.maintenance ?? 0
        return [location.id, {
          title: location.name, subtitle: location.description ?? null,
          summary: maintenance ? `${plural(total, 'equipo', 'equipos')} · ${maintenance} en mantenimiento` : plural(total, 'equipo', 'equipos'),
          tone: maintenance ? 'warning' : total ? 'ok' : 'neutral',
          metrics: [
            { label: 'Total', value: String(total) },
            { label: 'Disponibles', value: String(byStatus.available ?? 0) },
            { label: 'Asignados', value: String(byStatus.assigned ?? 0) },
            { label: 'En mantenimiento', value: String(maintenance) },
          ],
          url: '/app/m/runly.inventory',
        }]
      }))
    },
    async inventory_item(companyId, ids) {
      const items = await prisma.invItem.findMany({
        where: { companyId, id: { in: ids }, enabled: true },
        select: { id: true, name: true, assetTag: true, status: true, adminStatus: true, assignedTo: { select: { firstName: true, lastName: true } }, location: { select: { name: true } }, condition: { select: { name: true } } },
      })
      return new Map(items.map((item) => {
        const retired = item.adminStatus && item.adminStatus !== 'registered'
        const assignee = item.assignedTo ? `${item.assignedTo.firstName} ${item.assignedTo.lastName}`.trim() : null
        const status = STATUS_LABELS[item.status] ?? item.status
        return [item.id, {
          title: item.name, subtitle: item.assetTag ?? null,
          summary: retired ? 'Dado de baja' : assignee ? `${status} · ${assignee}` : status,
          tone: retired ? 'danger' : STATUS_TONES[item.status] ?? 'neutral',
          metrics: [
            { label: 'Estado', value: retired ? 'Dado de baja' : status },
            ...(assignee ? [{ label: 'Asignado a', value: assignee }] : []),
            ...(item.location?.name ? [{ label: 'Ubicación', value: item.location.name }] : []),
            ...(item.condition?.name ? [{ label: 'Condición', value: item.condition.name }] : []),
          ],
          url: `/app/m/runly.inventory/inventory/${item.id}`,
        }]
      }))
    },
  }

  // refs: [{ source, id }] -> { 'source:id': Resolution }
  async function resolve({ authUserId, companyId, refs }) {
    const bySource = new Map()
    for (const ref of (refs ?? []).slice(0, MAX_REFS)) {
      if (!ref || !isDataSource(ref.source) || typeof ref.id !== 'string') continue
      if (!bySource.has(ref.source)) bySource.set(ref.source, new Set())
      bySource.get(ref.source).add(ref.id)
    }
    const profileId = await profileIdOf(authUserId)
    const out = {}
    await Promise.all([...bySource].map(async ([source, idSet]) => {
      const ids = [...idSet]
      if (!(await allowed(companyId, profileId, source))) {
        for (const id of ids) out[`${source}:${id}`] = { title: 'Sin acceso', tone: 'neutral', restricted: true }
        return
      }
      let found
      try {
        found = providers[source]
          ? await providers[source](companyId, ids)
          : new Map([...(await relationTargets.resolve({ authUserId, companyId, type: source, ids }))].map(([id, row]) => [id, { ...row, tone: 'neutral' }]))
      } catch { found = new Map() }
      for (const id of ids) out[`${source}:${id}`] = found.get(id) ?? { title: 'Registro no disponible', tone: 'danger', missing: true }
    }))
    return out
  }

  async function search({ authUserId, companyId, source, q = '' }) {
    if (!isDataSource(source)) throw Object.assign(new Error('Fuente de datos desconocida.'), { status: 404 })
    const profileId = await profileIdOf(authUserId)
    if (!(await allowed(companyId, profileId, source))) throw Object.assign(new Error('No tienes permiso para ver esta fuente de datos.'), { status: 403 })
    if (source === 'inventory_location') {
      const query = String(q ?? '').trim().slice(0, 100)
      const rows = await prisma.invLocation.findMany({
        where: { companyId, enabled: true, ...(query ? { name: { contains: query, mode: 'insensitive' } } : {}) },
        select: { id: true, name: true, address: true }, orderBy: { name: 'asc' }, take: 20,
      })
      return rows.map((row) => ({ id: row.id, title: row.name, subtitle: row.address ?? null }))
    }
    return relationTargets.search({ authUserId, companyId, type: source, q, limit: 20 })
  }

  return { catalog, resolve, search }
}
```

If `@runly/module-compiler` is not importable from the API package in tests, import `EXTERNAL_RELATION_TARGETS` the same way `apps/api/src/services/relation-targets-service.js` does.

- [ ] **Step 4: Run** — expect PASS. **Commit** — `feat(canvas): data sources service with inventory providers`

---

### Task 2: Routes, binding validation, template data layers, SDK, wiring

**Files:**
- Modify: `apps/api/src/routes/canvas/canvas-routes.js`, `apps/api/src/routes/canvas/canvas-service.js`, `apps/api/src/routes/canvas/canvas-templates.js`, `apps/api/src/index.js:2371`, `packages/sdk/src/domains/canvas.js`
- Test: `apps/api/src/routes/canvas/__tests__/canvas-routes.test.js`, `canvas-service.test.js`, `canvas-templates.test.js`

- [ ] **Step 1: Failing tests**

`canvas-service.test.js`:

```js
  it('validates object bindings', () => {
    const base = { type: 'rectangle', geometry: { width: 10, height: 10 } }
    assert.doesNotThrow(() => validateCanvasObject({ ...base, properties: { binding: { source: 'inventory_location', id: '00000000-0000-4000-8000-000000000009' } } }))
    assert.throws(() => validateCanvasObject({ ...base, properties: { binding: { source: 'nope', id: '00000000-0000-4000-8000-000000000009' } } }), (error) => error.status === 400)
    assert.throws(() => validateCanvasObject({ ...base, properties: { binding: { source: 'inventory_item', id: 'x' } } }), (error) => error.status === 400)
    assert.doesNotThrow(() => validateCanvasObject({ ...base, properties: { binding: null } }))
  })

  it('finds boards that reference a record through links or bindings', async () => {
    let where
    const prisma = { canvasBoard: { findMany: async (query) => { where = query.where; return [{ id: BOARD, name: 'Plano', templateType: 'plan' }] } } }
    const rows = await createCanvasService({ prisma }).listReferences(COMPANY, USER, { moduleKey: 'runly.inventory', entityType: 'inventory_item', entityId: 'it-1' })
    assert.deepEqual(rows, [{ boardId: BOARD, name: 'Plano', templateType: 'plan' }])
    assert.equal(where.companyId, COMPANY)
    assert.ok(JSON.stringify(where).includes('it-1'))
  })
```

`canvas-templates.test.js`:

```js
  it('plan, technical-map and layout end with a data layer', () => {
    for (const key of ['plan', 'technical-map', 'layout']) assert.equal(templateFor(key).layers.at(-1).type, 'data', key)
  })
```

`canvas-routes.test.js`:

```js
  it('resolves bindings for a board the user can view', async () => {
    let asserted, resolved
    const requirePermission = () => async (c, next) => { c.set('companyId', 'company-1'); c.set('authUserId', 'auth-1'); c.set('userContext', { profile: { id: 'user-1' } }); return next() }
    const service = { assertBoardAccess: async (...args) => { asserted = args; return {} } }
    const dataSources = { resolve: async (input) => { resolved = input; return { 'inventory_item:i': { title: 'X', tone: 'ok' } } } }
    const app = createCanvasRouter({ requirePermission, service, dataSources })
    const response = await app.request('http://localhost/canvas/boards/board-1/bindings/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refs: [{ source: 'inventory_item', id: 'i' }] }) })
    assert.equal(response.status, 200)
    assert.deepEqual(asserted.slice(0, 3), ['company-1', 'user-1', 'board-1'])
    assert.equal(resolved.authUserId, 'auth-1')
    assert.equal((await response.json()).data['inventory_item:i'].title, 'X')
  })
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement**

1. `canvas-service.js`:
   - `import { isDataSource } from './canvas-data-sources.js'` and `const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.
   - At the end of `validateCanvasObject` (before `return true`):

```js
  const binding = data.properties?.binding
  if (binding != null) {
    if (!isDataSource(binding.source) || typeof binding.id !== 'string' || !UUID.test(binding.id)) throw new CanvasServiceError('La conexión de datos no es válida.', 400)
  }
```

   - New service function (export it in the returned object):

```js
  // Boards of the active company the user can open where a record appears,
  // through an entity link or an object's data binding.
  async function listReferences(companyId, actorId, { moduleKey, entityType, entityId }) {
    if (!moduleKey || !entityType || !entityId) throw new CanvasServiceError('Indica el registro a buscar.', 400)
    const source = entityType === 'inventory_item' || entityType === 'inventory.asset' ? 'inventory_item' : entityType
    const rows = await prisma.canvasBoard.findMany({
      where: {
        companyId, archivedAt: null,
        AND: [
          { OR: [{ ownerId: actorId }, { collaborators: { some: { userId: actorId } } }] },
          { OR: [
            { entityLinks: { some: { moduleKey, entityType, entityId } } },
            { objects: { some: { deletedAt: null, AND: [{ properties: { path: ['binding', 'source'], equals: source } }, { properties: { path: ['binding', 'id'], equals: entityId } }] } } },
          ] },
        ],
      },
      select: { id: true, name: true, templateType: true }, orderBy: { updatedAt: 'desc' }, take: 50,
    })
    return rows.map((row) => ({ boardId: row.id, name: row.name, templateType: row.templateType }))
  }
```

   Check the relation field names on `CanvasBoard` in `prisma/schema.prisma` (`entityLinks`, `objects`, `collaborators`) and use the real ones.

2. `canvas-templates.js`: append `{ name: 'Datos Runly', type: 'data' }` to the `layers` of `plan`, `technical-map` and `layout`, and add `'Capa Datos Runly para conectar registros'` to their `includes`.

3. `canvas-routes.js`:
   - Signature: `createCanvasRouter({ prisma, requirePermission, broadcaster = null, entityResolver = null, service = null, dataSources = null })`.
   - Routes (place before `/canvas/boards/:boardId` routes):

```js
  app.get('/canvas/data-sources', requirePermission('canvas.view'), async (c) => {
    try { return c.json({ data: await dataSources.catalog({ authUserId: c.get('authUserId'), companyId: companyId(c) }) }) }
    catch (error) { return errorResponse(c, error, 'Error al listar fuentes de datos.') }
  })
  app.get('/canvas/data-sources/:source/search', requirePermission('canvas.view'), async (c) => {
    try { return c.json({ data: await dataSources.search({ authUserId: c.get('authUserId'), companyId: companyId(c), source: c.req.param('source'), q: c.req.query('q') ?? '' }) }) }
    catch (error) { return errorResponse(c, error, 'Error al buscar registros.') }
  })
  app.post('/canvas/boards/:boardId/bindings/resolve', requirePermission('canvas.view'), async (c) => {
    try {
      await canvas.assertBoardAccess(companyId(c), actorId(c), c.req.param('boardId'))
      const body = await c.req.json().catch(() => ({}))
      return c.json({ data: await dataSources.resolve({ authUserId: c.get('authUserId'), companyId: companyId(c), refs: Array.isArray(body.refs) ? body.refs : [] }) })
    } catch (error) { return errorResponse(c, error, 'Error al cargar los datos del Board.') }
  })
  app.get('/canvas/references', requirePermission('canvas.view'), async (c) => {
    try { return c.json({ data: await canvas.listReferences(companyId(c), actorId(c), c.req.query()) }) }
    catch (error) { return errorResponse(c, error, 'Error al buscar referencias.') }
  })
```

   (`relation-targets-service` throws `RelationTargetError` with `status`; `errorResponse` already maps any error with an integer `status`.)

4. `apps/api/src/index.js`: import `createCanvasDataSources` from `./routes/canvas/canvas-data-sources.js` and change the mount to
   `createCanvasRouter({ prisma, requirePermission, broadcaster, entityResolver: resolveCanvasEntityLink, dataSources: createCanvasDataSources({ prisma, relationTargets }) })` (the `relationTargets` const is defined above, near `CANVAS_ENTITY_TARGETS`).

5. SDK `packages/sdk/src/domains/canvas.js`:

```js
    listDataSources: (token) => send('GET', '/canvas/data-sources', undefined, token),
    searchDataSource: (source, q, token) => send('GET', `/canvas/data-sources/${id(source)}/search${toQueryString({ q })}`, undefined, token),
    resolveBindings: (boardId, refs, token) => send('POST', `/canvas/boards/${id(boardId)}/bindings/resolve`, { refs }, token),
    listReferences: (params, token) => send('GET', `/canvas/references${toQueryString(params)}`, undefined, token),
```

- [ ] **Step 4: Run** `node --test apps/api/src/routes/canvas/__tests__/*.test.js` — expect PASS (update the earlier template test expecting `['Plano base', 'Mobiliario', 'Hotspots']` layer names for `plan` to include `'Datos Runly'`). Check `node --check apps/api/src/index.js`.

- [ ] **Step 5: Commit** — `feat(canvas): data source routes, binding validation and reverse references`

---

### Task 3: Desktop binding resolution and rendering

**Files:**
- Create: `apps/desktop/src/modules/runly.canvas/lib/dataBindings.js` (+ `dataBindings.test.js`)
- Modify: `apps/desktop/src/modules/runly.canvas/hooks/useCanvasData.js`
- Modify: `apps/desktop/src/modules/runly.canvas/engine/Canvas2DRenderer.js`, `engine/theme.js`
- Modify: `apps/desktop/src/modules/runly.canvas/components/CanvasViewport.jsx`, `screens/BoardEditor.jsx`

- [ ] **Step 1: Failing tests** — `lib/dataBindings.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BINDABLE_TYPES, bindingKey, bindingRefs, canBind, chunk } from './dataBindings.js'

describe('Canvas data bindings', () => {
  const rows = [
    { id: 'a', type: 'rectangle', properties: { binding: { source: 'inventory_item', id: 'i1' } } },
    { id: 'b', type: 'ellipse', properties: { binding: { source: 'inventory_item', id: 'i1' } } },
    { id: 'c', type: 'rectangle', properties: {} },
    { id: 'd', type: 'rectangle', pending: true, properties: { binding: { source: 'vehicle', id: 'v1' } } },
  ]
  it('collects unique refs from persisted bound rows', () => {
    assert.deepEqual(bindingRefs(rows), [{ source: 'inventory_item', id: 'i1' }])
    assert.equal(bindingKey(rows[0].properties.binding), 'inventory_item:i1')
    assert.equal(bindingKey(null), null)
  })
  it('only lets shapes and text be bound', () => {
    assert.ok(canBind({ type: 'rectangle' }))
    assert.equal(canBind({ type: 'line' }), false)
    assert.equal(canBind({ type: 'image' }), false)
    assert.ok(BINDABLE_TYPES.has('polygon'))
  })
  it('splits refs into batches', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  })
})
```

- [ ] **Step 2: `lib/dataBindings.js`**

```js
// Objects bound to ERP records (properties.binding = { source, id }).
export const BINDABLE_TYPES = new Set(['rectangle', 'ellipse', 'polygon', 'text', 'hotspot'])
export const canBind = (object) => BINDABLE_TYPES.has(object?.type)
export const bindingKey = (binding) => (binding?.source && binding?.id ? `${binding.source}:${binding.id}` : null)

export function bindingRefs(rows) {
  const seen = new Map()
  for (const row of rows) {
    const binding = row.properties?.binding, key = bindingKey(binding)
    if (key && !row.pending && !seen.has(key)) seen.set(key, { source: binding.source, id: binding.id })
  }
  return [...seen.values()]
}

export function chunk(list, size) {
  const out = []
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size))
  return out
}
```

- [ ] **Step 3: Query hook** (append to `useCanvasData.js`):

```js
// Live data for bound objects of the visible page (polled while open).
export function useBindings(boardId, rows) {
  const token = useToken()
  const refs = useMemo(() => bindingRefs(rows), [rows])
  const keyPart = refs.map((ref) => `${ref.source}:${ref.id}`).sort().join('|')
  return useQuery({
    queryKey: ['canvas', 'boards', boardId, 'bindings', keyPart],
    queryFn: async () => {
      const parts = await Promise.all(chunk(refs, 500).map(async (batch) => unwrap(await runly.canvas.resolveBindings(boardId, batch, token)) ?? {}))
      return Object.assign({}, ...parts)
    },
    enabled: Boolean(token && boardId && refs.length),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  })
}
export function useDataSources(enabled = true) {
  const token = useToken()
  return useQuery({ queryKey: ['canvas', 'data-sources'], queryFn: async () => unwrap(await runly.canvas.listDataSources(token)) ?? [], enabled: Boolean(token && enabled), staleTime: 5 * 60_000 })
}
export function useDataSourceSearch(source, q) {
  const token = useToken()
  return useQuery({
    queryKey: ['canvas', 'data-search', source, q],
    queryFn: async () => unwrap(await runly.canvas.searchDataSource(source, q, token)) ?? [],
    enabled: Boolean(token && source), placeholderData: keepPreviousData, staleTime: 30_000,
  })
}
```

(import `bindingRefs`, `chunk` from `../lib/dataBindings.js`.)

- [ ] **Step 4: Theme tones** — in `engine/theme.js` add to `FALLBACK` and to the object returned by `readCanvasTheme`:

```js
  tones: { ok: '#16a34a', info: '#2563eb', warning: '#d97706', danger: '#dc2626', neutral: '#64748b' },
```

(the same fixed hex in both places; status colours do not change with theme).

- [ ] **Step 5: Renderer** — `render(scene)` destructures `bindings` (an object keyed by `source:id`, default `{}`). In `drawObject`, compute `const data = bindingKey(object.properties?.binding) ? bindings[bindingKey(object.properties.binding)] : null` (import `bindingKey` from `../lib/dataBindings.js`) — pass `bindings` from `render` into `drawObject` as an extra argument. Then:

```js
    // Bound objects take their status colour unless the user opted out.
    const tint = data && object.properties?.binding?.tint !== false ? this.theme.tones[data.tone] ?? this.theme.tones.neutral : null
    const stroke = tint ?? this.strokeColor(object)
```

and when `tint` is set, apply fill with `fillOpacity` 0.14 using `tint` (override `style.fill` for that draw: create `const drawn = tint ? { ...object, style: { ...object.style, fill: tint, fillOpacity: 0.14 } } : object` and use `drawn` for fill/stroke helpers).

After the shape is drawn (still inside the rotated transform, before `ctx.restore()`), for non-linear bound objects call `this.drawDataLabel(ctx, data, x, y, w, h, zoom, tint)` and `this.drawDataBadge(ctx, x + w, y, zoom, tint)`:

```js
  drawDataLabel(ctx, data, x, y, w, h, zoom, color) {
    if (!data) return
    const roomy = w * zoom >= 80 && h * zoom >= 40
    const title = data.title.length > 40 ? `${data.title.slice(0, 39)}…` : data.title
    ctx.save()
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = this.theme.foreground
    if (roomy) {
      const size = Math.min(16, Math.max(10, h / 5))
      ctx.font = `600 ${size}px ${this.theme.font}`
      ctx.fillText(title, 0 + x + w / 2, y + h / 2 - (data.summary ? size * 0.7 : 0), w - 12)
      if (data.summary) { ctx.font = `400 ${size * 0.85}px ${this.theme.font}`; ctx.fillStyle = color; ctx.fillText(data.summary, x + w / 2, y + h / 2 + size * 0.7, w - 12) }
    } else {
      const size = 12 / zoom
      ctx.font = `600 ${size}px ${this.theme.font}`; ctx.textBaseline = 'top'
      ctx.fillText(title, x + w / 2, y + h + 4 / zoom)
    }
    ctx.restore()
  }

  drawDataBadge(ctx, cx, cy, zoom, color) {
    const r = 7 / zoom
    ctx.save()
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2 / zoom
    // Tiny database glyph: two stacked ellipses.
    for (const dy of [-2.2, 1.8]) { ctx.beginPath(); ctx.ellipse(cx, cy + dy / zoom, 3.2 / zoom, 1.4 / zoom, 0, 0, Math.PI * 2); ctx.stroke() }
    ctx.restore()
  }
```

Text objects that are bound keep their own text rendering (no label), but take the tint for the text colour; hotspots keep their pin (tint only).

- [ ] **Step 6: Wiring** — `CanvasViewport` passes `bindings: p.bindings ?? {}` to `renderer.render`. In `BoardEditor.jsx`: `const bindings = useBindings(boardId, rows)` (visible rows only) and `<CanvasViewport ... bindings={bindings.data ?? {}} />`. Also invalidate bindings when a binding changes: TanStack key includes the refs, so a new binding triggers a fetch automatically.

- [ ] **Step 7: Tests, eslint, build; commit** — `feat(canvas): bound objects show live record data on the canvas`

---

### Task 4: Connect/insert UI

**Files:**
- Create: `apps/desktop/src/modules/runly.canvas/components/DataBindingDialog.jsx`
- Create: `apps/desktop/src/modules/runly.canvas/components/inspector/DataBindingSection.jsx`
- Modify: `components/BoardInspector.jsx`, `components/CanvasToolbar.jsx`, `hooks/useBoardEditorActions.js`, `screens/BoardEditor.jsx`

- [ ] **Step 1: `DataBindingDialog.jsx`** — props `{ open, mode: 'connect' | 'insert', onOpenChange, onConfirm(binding, record), pending }`.
  - Title: "Conectar a datos" / "Insertar datos"; description "Elige un registro de Runly. El objeto mostrará su información y estado actualizados."
  - `SelectField` "Fuente" with options from `useDataSources(open)` filtered to `installed && allowed` (label `source.label`); default the first inventory source available.
  - Record picker: `ComboboxField` (check its props; it must support async options/search text) bound to `useDataSourceSearch(source, debouncedQuery)` (250 ms debounce with a small `useEffect` timer), options `{ value: id, label: title, description: subtitle }`; placeholder "Buscar…". Empty state text "Sin resultados".
  - Footer: "Cancelar" and primary "Conectar"/"Insertar" (disabled until a record is chosen). On confirm call `onConfirm({ source, id }, { title, subtitle })`.
  - Loading → `Skeleton`; data-sources error → `ErrorState` with retry; no allowed sources → `EmptyState` "No tienes fuentes de datos disponibles".

- [ ] **Step 2: Actions** — in `useBoardEditorActions.js` add:

```js
  const dataLayer = () => layers.find((layer) => layer.type === 'data' && !layer.locked) ?? null

  // Binds a shape and moves it to the page's data layer when there is one.
  function connectData(object, binding) {
    const row = current(object.id)
    if (!row || layerById(row.layerId)?.locked) return
    const target = dataLayer()
    const data = { properties: { ...(row.properties ?? {}), binding } }
    if (target && target.id !== row.layerId) { data.layerId = target.id; data.position = topPosition(target.id) }
    applyUpdates([{ row, data }], 'Conectar a datos')
  }
  function disconnectData(object) {
    const row = current(object.id)
    if (!row) return
    const { binding: _binding, ...properties } = row.properties ?? {}
    applyUpdates([{ row, data: { properties } }], 'Desconectar datos')
  }
  async function insertData(binding, record) {
    const layer = dataLayer() ?? drawableLayer()
    if (!layer) return toast.error('No hay una capa disponible para insertar datos.')
    const center = screenToWorld({ x: size.width / 2, y: size.height / 2 }, viewport)
    const data = buildObjectData('rectangle', { x: center.x - 100, y: center.y - 50, width: 200, height: 100 })
    try {
      await createRows([{ ...data, properties: { ...data.properties, binding, label: record?.title ?? null }, pageId, layerId: layer.id, position: topPosition(layer.id) }], 'Insertar datos')
    } catch (error) { fail(error) }
  }
```

(import `screenToWorld` from `../engine/viewport.js`; export the three from the hook's return.) Note `applyUpdates` already handles optimistic updates and undo; `layerId`/`position` are tracked fields in history.

- [ ] **Step 3: `DataBindingSection.jsx`** — props `{ object, data, readOnly, locked, onConnect, onDisconnect }` where `data` is the resolution for its binding (or undefined while loading). Renders inside a `Section title="Datos Runly"`:
  - Not bound: short text "Conecta esta forma a un registro de Runly para ver su estado en el lienzo." + `Button variant="outline"` "Conectar a datos" (disabled if `readOnly || locked`).
  - Bound: title (semibold), source label, summary, metrics as a two-column `dl`, a tone dot; buttons "Abrir ficha" (navigates with `useNavigate()` to `data.url` when present), "Cambiar" (calls `onConnect`) and "Desconectar" (`onDisconnect`), the last two hidden for `readOnly`.
  - `restricted`/`missing` show their title with muted text.

- [ ] **Step 4: Inspector + editor + toolbar**
  - `BoardInspector` receives `bindings` (resolutions map) and `actions.connectData/openDataDialog/disconnectData`; when `single && canBind(single)`, render `<DataBindingSection ... />` inside `ObjectInspector` children (above `EntityLinksSection`).
  - `BoardEditor`: dialog state `{ kind: 'data', mode, id? }` reusing the existing `dialog` state; `DataBindingDialog` `onConfirm`: mode `connect` → `actions.connectData(row, binding)`; mode `insert` → `actions.insertData(binding, record)`; then close.
  - `CanvasToolbar`: new `ToolButton` (icon `Database`, label "Insertar datos") next to the insert-media button, hidden for `readOnly`; prop `onInsertData`.

- [ ] **Step 5: eslint, build; commit** — `feat(canvas): connect shapes to Runly data and insert data objects`

---

### Task 5: Reverse references, help, verification

**Files:**
- Create: `apps/desktop/src/modules/runly.canvas/components/CanvasReferences.jsx`
- Modify: `apps/desktop/src/modules/runly.inventory/screens/InventoryItemDetail.jsx`
- Modify: `apps/api/src/manifests/official/help/runly.canvas/overview.md`

- [ ] **Step 1: `CanvasReferences.jsx`** — props `{ moduleKey, entityType, entityId }`. `useQuery(['canvas', 'references', moduleKey, entityType, entityId], () => runly.canvas.listReferences({ moduleKey, entityType, entityId }, token))`, `retry: false`. Render nothing while loading, on error (e.g. no `canvas.view`) or when empty. Otherwise a card section titled "En Canvas" with one row per Board: template icon (`templateIcon` via `useCanvasTemplates`), name, and an outline `Button size="sm"` "Abrir" navigating to `/app/m/runly.canvas/<boardId>`.

- [ ] **Step 2: Inventory detail** — render `<CanvasReferences moduleKey="runly.inventory" entityType="inventory_item" entityId={id} />` right after the `RunlyDetail` element in `InventoryItemDetail.jsx` (use the same id variable the screen uses for the item). Keep the file small.

- [ ] **Step 3: Help** — in the canvas help `overview.md` (no-accent style), replace the bullet about **Datos Runly** in the layers section with:

```md
- **Datos Runly**: aqui van los objetos **conectados a datos**. Selecciona una forma y usa "Conectar a datos" en el inspector (o el boton "Insertar datos" de la barra inferior) para ligarla a una ubicacion o articulo de inventario, un vehiculo, un colaborador, un proyecto u otro registro. El objeto muestra el nombre del registro, un resumen y un color segun su estado (por ejemplo, una ubicacion con equipos en mantenimiento se ve en ambar) y se actualiza solo cada minuto. Ocultar esta capa oculta todos los datos de la pagina.
```

and add:

```md
### Donde aparece un registro

En la ficha de un articulo de inventario, la seccion **En Canvas** lista los Boards donde ese articulo esta conectado o vinculado, con un boton para abrirlos.
```

(If the layers section no longer has a Datos Runly bullet after the templates phase rewrite, add this bullet at the end of that section.)

- [ ] **Step 4: Verification**

```bash
node --test apps/api/src/routes/canvas/__tests__/*.test.js
node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js
npx eslint <touched files>
node --check apps/api/src/index.js
pnpm --filter ./apps/desktop build:web
```

- [ ] **Step 5: Commit** — `feat(canvas): boards that reference an inventory item; help for the data layer`
