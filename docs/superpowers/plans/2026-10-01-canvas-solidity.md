# Canvas Solidity (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delta realtime for Canvas objects, per-operation conflicts, remote cursors/selection, a Versions panel and automatic Board thumbnails.

**Architecture:** The batch endpoint returns `conflict` results instead of aborting and broadcasts the changed rows; a pure `realtimeCache.js` applies them to TanStack Query caches. Cursors go through the existing `/realtime/broadcast` relay (which now stamps `actorId`) and are drawn by `Canvas2DRenderer` from a `remote` scene field. Versions get a `Sheet`. Thumbnails are rendered client-side with the existing renderer into an offscreen canvas and uploaded through Files.

**Tech Stack:** Hono, Prisma, Supabase Realtime (via `authorizedRealtime.js` wrapper), React + TanStack Query, `@runly/ui`, Canvas2D, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-01-canvas-solidity-design.md`

**Rules:** JavaScript only; UI text Spanish, code/comments English; no emojis; `@runly/ui` components; never start/stop dev servers (4010/5173); no file over 800 lines; run tests with explicit globs (bare directories fail on this Windows setup); `pnpm lint` has 8 pre-existing errors in `custom.encuestas` bundles — check touched files with `npx eslint <files>`. Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Per-operation conflicts and object deltas (API)

**Files:**
- Modify: `apps/api/src/routes/canvas/canvas-service.js` (`batchObjects`)
- Modify: `apps/api/src/routes/canvas/canvas-routes.js` (batch route)
- Test: `apps/api/src/routes/canvas/__tests__/canvas-service.test.js`, `apps/api/src/routes/canvas/__tests__/canvas-routes.test.js`

- [ ] **Step 1: Failing service test** (append inside the `describe` of `canvas-service.test.js`)

```js
  it('keeps valid operations and reports stale ones as conflicts', async () => {
    const current = { id: 'b', revision: 5, hotspot: null }
    const tx = {
      canvasObject: {
        updateMany: async ({ where }) => ({ count: where.id === 'a' ? 1 : 0 }),
        findFirst: async ({ where }) => (where.id === 'a' ? { id: 'a', revision: 3 } : where.id === 'b' ? current : null),
      },
      canvasBoard: { update: async () => ({}) },
    }
    const prisma = { canvasBoard: { findFirst: async () => accessibleBoard() }, $transaction: (fn) => fn(tx) }
    const results = await createCanvasService({ prisma }).batchObjects(COMPANY, USER, BOARD, [
      { op: 'update', id: 'a', expectedRevision: 2, data: { transform: { x: 1, y: 1 } } },
      { op: 'update', id: 'b', expectedRevision: 1, data: { transform: { x: 2, y: 2 } } },
      { op: 'delete', id: 'gone', expectedRevision: 1 },
    ])
    assert.deepEqual(results.map((r) => r.op), ['update', 'conflict', 'conflict'])
    assert.equal(results[1].object, current)
    assert.equal(results[2].object, null)
  })
```

- [ ] **Step 2: Run** `node --test apps/api/src/routes/canvas/__tests__/canvas-service.test.js` — expect FAIL (409 thrown).

- [ ] **Step 3: Implement in `batchObjects`**

Inside the `prisma.$transaction(async (tx) => { ... })`, before the loop add:

```js
      // A stale or missing row is reported with its current server state
      // (null = gone) instead of aborting the whole batch.
      const currentRow = (id) => tx.canvasObject.findFirst({ where: { id, companyId, boardId, deletedAt: null }, include: { hotspot: true } })
      const conflict = async (id) => results.push({ op: 'conflict', id, object: await currentRow(id) })
```

Then change the branches:

- `update`: replace the layer-check block and the `if (changed.count !== 1) throw ...` with:

```js
          if (operation.data?.layerId) {
            const current = await tx.canvasObject.findFirst({ where: { id: operation.id, companyId, boardId, deletedAt: null }, select: { pageId: true } })
            if (!current) { await conflict(operation.id); continue }
            const layer = await tx.canvasLayer.findFirst({ where: { id: operation.data.layerId, pageId: current.pageId, page: { boardId } }, select: { id: true } })
            if (!layer) throw new CanvasServiceError('Capa no encontrada.', 404)
          }
          const changed = await tx.canvasObject.updateMany({
            where: { id: operation.id, companyId, boardId, deletedAt: null, revision: expectedRevision },
            data: objectPatch(operation.data ?? {}, actorId),
          })
          if (changed.count !== 1) { await conflict(operation.id); continue }
```

- `delete`: replace `if (changed.count !== 1) throw ...` with `if (changed.count !== 1) { await conflict(operation.id); continue }`.
- `restore`: same replacement.

The loop is a `for (const operation of operations)`, so `continue` is valid. Keep the validation throws (`400`, unknown op, missing `expectedRevision`) as they are.

- [ ] **Step 4: Failing route test** (append in `canvas-routes.test.js`)

```js
  it('broadcasts changed rows as a delta and skips conflicts', async () => {
    const sent = []
    const broadcaster = { broadcastToChannel: async (topic, event, payload) => { sent.push({ topic, event, payload }) } }
    const requirePermission = () => async (c, next) => { c.set('companyId', 'company-1'); c.set('userContext', { profile: { id: 'user-1' } }); return next() }
    const service = { batchObjects: async () => [
      { op: 'update', object: { id: 'a', revision: 3 } },
      { op: 'delete', id: 'b' },
      { op: 'conflict', id: 'c', object: { id: 'c', revision: 9 } },
    ] }
    const app = createCanvasRouter({ requirePermission, service, broadcaster })
    await app.request('http://localhost/canvas/boards/board-1/objects/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operations: [] }) })
    assert.equal(sent[0].payload.action, 'objects.changed')
    assert.deepEqual(sent[0].payload.upserts, [{ id: 'a', revision: 3 }])
    assert.deepEqual(sent[0].payload.deletedIds, ['b'])
  })

  it('falls back to refetch for oversized deltas', async () => {
    const { objectsDelta } = await import('../canvas-routes.js')
    const big = { id: 'x', revision: 2, properties: { text: 'a'.repeat(210_000) } }
    assert.deepEqual(objectsDelta([{ op: 'update', object: big }]), { refetch: true })
  })
```

- [ ] **Step 5: Implement in `canvas-routes.js`**

Add (exported, above `createCanvasRouter`):

```js
const DELTA_MAX_CHARS = 200_000

// Realtime payload for an object batch: the rows other editors need to patch
// their caches, or `refetch` when it would be too large for one message.
export function objectsDelta(results) {
  const upserts = [], deletedIds = []
  for (const result of results) {
    if (result.op === 'delete') deletedIds.push(result.id)
    else if (result.op !== 'conflict' && result.object) upserts.push(result.object)
  }
  const delta = { upserts, deletedIds }
  return JSON.stringify(delta).length <= DELTA_MAX_CHARS ? delta : { refetch: true }
}
```

and in the batch route replace `changed(id, 'objects.changed', { count: rows.length })` with `changed(id, 'objects.changed', objectsDelta(rows))`.

- [ ] **Step 6: Run** `node --test apps/api/src/routes/canvas/__tests__/*.test.js` — expect PASS. Fix any older test that expected a 409 from `batchObjects` to expect a `conflict` result instead.

- [ ] **Step 7: Commit** — `feat(canvas): per-object batch conflicts and delta broadcasts`

---

### Task 2: Versions and thumbnails (API) + relay actor stamp

**Files:**
- Modify: `apps/api/src/routes/canvas/canvas-service.js` (`updateBoard`, `createVersion`, `listVersions`, `restoreVersion`)
- Modify: `apps/api/src/services/realtime-access-service.js` (`relay`)
- Test: `apps/api/src/routes/canvas/__tests__/canvas-service.test.js`, create `apps/api/src/services/__tests__/realtime-access-service.test.js`

- [ ] **Step 1: Failing tests**

In `canvas-service.test.js`:

```js
  it('only accepts thumbnails uploaded for the Board and disables the previous one', async () => {
    const disabled = []
    const prisma = {
      canvasBoard: { findFirst: async () => accessibleBoard({ thumbnailFileId: 'old' }), update: async ({ data }) => ({ id: BOARD, ...data }) },
      fileAsset: {
        findFirst: async ({ where }) => (where.id === 'mine' && where.entityId === BOARD && where.moduleKey === 'runly.canvas' ? { id: 'mine' } : null),
        updateMany: async ({ where }) => { disabled.push(where.id); return { count: 1 } },
      },
      auditLog: { create: async () => ({}) },
    }
    const service = createCanvasService({ prisma })
    await assert.rejects(() => service.updateBoard(COMPANY, USER, BOARD, { thumbnailFileId: 'foreign' }), (error) => error.status === 404)
    await service.updateBoard(COMPANY, USER, BOARD, { thumbnailFileId: 'mine' })
    assert.deepEqual(disabled, ['old'])
  })
```

Create `apps/api/src/services/__tests__/realtime-access-service.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createRealtimeAccessService } from '../realtime-access-service.js'

describe('realtime relay', () => {
  it('stamps the authenticated actor on canvas payloads', async () => {
    const sent = []
    const prisma = {
      $queryRaw: async () => [{ allowed: true }],
      userProfile: { findFirst: async () => ({ displayName: 'Ana' }) },
    }
    const broadcaster = { broadcastToChannel: async (topic, event, payload) => { sent.push(payload) } }
    const service = createRealtimeAccessService({ prisma, broadcaster })
    const ok = await service.relay({ topic: 'canvas:board:00000000-0000-4000-8000-000000000004', event: 'cursor', payload: { x: 1, actorId: 'spoofed' }, actorId: 'user-1' })
    assert.equal(ok, true)
    assert.equal(sent[0].actorId, 'user-1')
    assert.equal(sent[0].x, 1)
  })
})
```

- [ ] **Step 2: Run both files** — expect FAIL.

- [ ] **Step 3: `updateBoard` thumbnail rules**

Remove `'thumbnailFileId'` from the generic key loop and add after it:

```js
    if (data.thumbnailFileId !== undefined) {
      const next = data.thumbnailFileId || null
      // Only an enabled file uploaded for this Board (Files tags Canvas
      // uploads with runly.canvas/CanvasBoard/<boardId>).
      if (next && !(await prisma.fileAsset.findFirst({ where: { id: next, enabled: true, moduleKey: 'runly.canvas', entityType: 'CanvasBoard', entityId: boardId }, select: { id: true } }))) {
        throw new CanvasServiceError('Archivo no encontrado.', 404)
      }
      patch.thumbnailFileId = next
    }
```

After `const updated = await prisma.canvasBoard.update(...)` add:

```js
    if (patch.thumbnailFileId !== undefined && board.thumbnailFileId && board.thumbnailFileId !== patch.thumbnailFileId) {
      await prisma.fileAsset.updateMany({ where: { id: board.thumbnailFileId, moduleKey: 'runly.canvas', entityId: boardId }, data: { enabled: false } })
    }
```

Thumbnail-only patches should not write an audit row: wrap the existing `audit(...)` call in `if (Object.keys(data).some((key) => key !== 'thumbnailFileId'))`.

- [ ] **Step 4: Versions**

1. Extract the body of `createVersion`'s transaction into an inner helper so restore can reuse it:

```js
  const VERSION_LIMIT = 100
  async function snapshotVersion(tx, companyId, actorId, boardId, { name = null, description = null, automatic = false } = {}) {
    const board = await tx.canvasBoard.findFirst({ where: { id: boardId, companyId } })
    const pages = await tx.canvasPage.findMany({ where: { boardId }, include: { layers: { orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } })
    const objects = await tx.canvasObject.findMany({ where: { boardId, companyId, deletedAt: null }, orderBy: { createdAt: 'asc' } })
    const hotspots = await tx.canvasHotspot.findMany({ where: { boardId, companyId, archivedAt: null } })
    const links = await tx.canvasEntityLink.findMany({ where: { boardId, companyId } })
    const last = await tx.canvasVersion.findFirst({ where: { boardId }, orderBy: { number: 'desc' }, select: { number: true } })
    const version = await tx.canvasVersion.create({ data: {
      boardId, number: (last?.number ?? 0) + 1, name: cleanText(name, 200), description: cleanText(description),
      snapshot: jsonValue({ schemaVersion: 1, board, pages, objects, hotspots, links }), objectCount: objects.length, createdById: actorId,
    } })
    await audit(tx, { companyId, actorId, action: 'BOARD_VERSION_CREATED', entityType: 'CanvasVersion', entityId: version.id, after: { number: version.number, objectCount: version.objectCount }, metadata: automatic ? { automatic: true } : null })
    // Retention: keep the newest VERSION_LIMIT versions (never the current one).
    const stale = await tx.canvasVersion.findMany({ where: { boardId, id: { not: board.currentVersionId ?? undefined } }, orderBy: { number: 'desc' }, skip: VERSION_LIMIT, select: { id: true } })
    if (stale.length) await tx.canvasVersion.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } })
    return version
  }
```

`createVersion` becomes:

```js
  async function createVersion(companyId, actorId, boardId, data = {}) {
    await assertBoardAccess(companyId, actorId, boardId, 'EDITOR')
    return prisma.$transaction(async (tx) => {
      const version = await snapshotVersion(tx, companyId, actorId, boardId, data)
      await tx.canvasBoard.update({ where: { id: boardId }, data: { currentVersionId: version.id, updatedById: actorId } })
      return version
    })
  }
```

2. In `restoreVersion`, right after the `version` lookup/validation and before the `deleteMany` calls, add:

```js
      await snapshotVersion(tx, companyId, actorId, boardId, { name: `Antes de restaurar la versión ${version.number}`, automatic: true })
```

3. `listVersions`: after `findMany`, resolve author names:

```js
    const rows = await prisma.canvasVersion.findMany({ /* existing args */ })
    const people = await prisma.userProfile.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.createdById))] } }, select: { id: true, displayName: true } })
    const names = new Map(people.map((person) => [person.id, person.displayName]))
    return rows.map((row) => ({ ...row, createdByName: names.get(row.createdById) ?? 'Usuario' }))
```

Update any existing version tests whose mocks lack `userProfile.findMany` / `canvasVersion.findMany` / `deleteMany` by adding those mocks.

- [ ] **Step 5: Relay stamp** — in `realtime-access-service.js` `relay`, replace the payload argument of `broadcaster.broadcastToChannel(...)`:

```js
    // Canvas peers identify cursors by the authenticated actor, never by a
    // client-supplied id.
    const outgoing = typing
      ? { isTyping: Boolean(payload?.isTyping), userId: actorId, displayName: user.displayName }
      : canvas ? { ...(payload ?? {}), actorId } : payload
    await broadcaster.broadcastToChannel(topic, event, outgoing, { authorize: () => allowed(topic, actorId, note || canvas) })
```

- [ ] **Step 6: Run** `node --test apps/api/src/routes/canvas/__tests__/*.test.js apps/api/src/services/__tests__/realtime-access-service.test.js apps/api/src/services/__tests__/realtime-broadcaster.test.js` — expect PASS.

- [ ] **Step 7: Commit** — `feat(canvas): validated thumbnails, version retention, auto version before restore`

---

### Task 3: Realtime cache helpers and delta handling (desktop)

**Files:**
- Create: `apps/desktop/src/modules/runly.canvas/lib/realtimeCache.js` (+ `realtimeCache.test.js`)
- Modify: `apps/desktop/src/modules/runly.canvas/lib/optimistic.js` (`mergeBatchResults`)
- Modify: `apps/desktop/src/modules/runly.canvas/hooks/useCanvasRealtime.js`
- Modify: `apps/desktop/src/modules/runly.canvas/hooks/useCanvasData.js` (`useObjectBatch`)
- Modify: `apps/desktop/src/modules/runly.canvas/hooks/useBoardEditorActions.js` (`replay`)

- [ ] **Step 1: Failing tests** — `lib/realtimeCache.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyObjectDelta, invalidationTargets } from './realtimeCache.js'

describe('Canvas realtime cache', () => {
  const rows = [{ id: 'a', pageId: 'p1', revision: 2, hotspot: { id: 'h' } }, { id: 'b', pageId: 'p1', revision: 1 }]
  it('applies newer rows, keeps hotspots, ignores stale echoes and other pages', () => {
    const next = applyObjectDelta(rows, 'p1', { upserts: [{ id: 'a', pageId: 'p1', revision: 3 }, { id: 'b', pageId: 'p1', revision: 1 }, { id: 'z', pageId: 'p2', revision: 1 }], deletedIds: [] })
    assert.equal(next.find((r) => r.id === 'a').revision, 3)
    assert.deepEqual(next.find((r) => r.id === 'a').hotspot, { id: 'h' })
    assert.equal(next.find((r) => r.id === 'b'), rows[1])
    assert.equal(next.some((r) => r.id === 'z'), false)
  })
  it('inserts new rows and removes deleted ones', () => {
    const next = applyObjectDelta(rows, 'p1', { upserts: [{ id: 'c', pageId: 'p1', revision: 1 }], deletedIds: ['b'] })
    assert.deepEqual(next.map((r) => r.id), ['a', 'c'])
  })
  it('returns the same array when nothing changes', () => {
    assert.equal(applyObjectDelta(rows, 'p1', { upserts: [], deletedIds: ['nope'] }), rows)
  })
  it('maps actions to the queries they invalidate', () => {
    assert.deepEqual(invalidationTargets('hotspot.updated'), ['objects'])
    assert.deepEqual(invalidationTargets('layer.updated'), ['board'])
    assert.deepEqual(invalidationTargets('version.restored'), ['board', 'objects', 'links', 'versions'])
    assert.deepEqual(invalidationTargets('entity-link.created'), ['links'])
    assert.deepEqual(invalidationTargets('something.new'), ['board', 'objects'])
  })
})
```

Add to `lib/optimistic.test.js`:

```js
  it('replaces conflicted rows with the server version or drops gone ones', () => {
    const rows = [{ id: 'a', revision: 4, hotspot: { id: 'h' } }, { id: 'b', revision: 2 }]
    const next = mergeBatchResults(rows, [{ op: 'conflict', id: 'a', object: { id: 'a', revision: 7 } }, { op: 'conflict', id: 'b', object: null }])
    assert.deepEqual(next, [{ id: 'a', revision: 7, hotspot: { id: 'h' } }])
  })
```

(import `mergeBatchResults` there if not yet imported).

- [ ] **Step 2: Run** `node --test apps/desktop/src/modules/runly.canvas/lib/*.test.js` — expect FAIL.

- [ ] **Step 3: `realtimeCache.js`**

```js
// Applies `canvas.changed` object deltas to a page's cached rows. The sender
// receives its own delta too; rows whose cached revision is already as new
// are left untouched, so echoes are harmless.
export function applyObjectDelta(rows = [], pageId, { upserts = [], deletedIds = [] } = {}) {
  let next = rows, changed = false
  const deleted = new Set(deletedIds)
  if (deleted.size && next.some((row) => deleted.has(row.id))) { next = next.filter((row) => !deleted.has(row.id)); changed = true }
  for (const incoming of upserts) {
    if (incoming.pageId !== pageId || incoming.deletedAt) continue
    const index = next.findIndex((row) => row.id === incoming.id)
    if (index === -1) { next = [...next, incoming]; changed = true; continue }
    const cached = next[index]
    if ((cached.revision ?? 0) >= (incoming.revision ?? 0)) continue
    next = next.map((row, i) => i === index ? { ...incoming, hotspot: incoming.hotspot ?? cached.hotspot } : row)
    changed = true
  }
  return changed ? next : rows
}

// Which cached queries a non-delta `canvas.changed` action makes stale.
const TARGETS = {
  board: ['board'], page: ['board'], layer: ['board'], layers: ['board'], collaborator: ['board'],
  hotspot: ['objects'], attachment: [], comment: [], 'entity-link': ['links'],
}
export function invalidationTargets(action = '') {
  if (action === 'version.restored') return ['board', 'objects', 'links', 'versions']
  if (action === 'version.created') return ['versions', 'board']
  const prefix = action.split('.')[0]
  return TARGETS[prefix] ?? ['board', 'objects']
}
```

- [ ] **Step 4: `mergeBatchResults` handles conflicts** — add a branch in its loop:

```js
    } else if (result.op === 'conflict') {
      next = result.object
        ? next.map((row) => row.id === result.id ? { ...result.object, hotspot: result.object.hotspot ?? row.hotspot } : row)
        : next.filter((row) => row.id !== result.id)
```

- [ ] **Step 5: `useObjectBatch` warns about conflicts** — in `useCanvasData.js`, import `toast` from `sonner`; in `onSuccess`, after computing `results` and before `setQueryData`, add:

```js
      const conflicts = results.filter((result) => result.op === 'conflict').length
      if (conflicts) toast.warning(conflicts === 1 ? 'Otra persona cambió un elemento; se cargó su versión más reciente.' : `Otra persona cambió ${conflicts} elementos; se cargó su versión más reciente.`)
```

Keep `onError` invalidation for real errors.

- [ ] **Step 6: Undo/redo with conflicts** — in `useBoardEditorActions.js` `replay`, replace `try { await batch.mutateAsync(operations) } catch (error) {` block with:

```js
    try {
      const response = await batch.mutateAsync(operations)
      if ((response?.data ?? response ?? []).some((result) => result.op === 'conflict')) {
        history.revert(direction); bump()
      }
    } catch (error) {
```

(the existing catch body stays; the conflict toast from Step 5 already informs the user).

- [ ] **Step 7: `useCanvasRealtime.js` applies deltas**

Replace the `onChanged` callback with:

```js
      onChanged: (message) => {
        const payload = message?.payload ?? {}
        if (payload.action === 'objects.changed' && !payload.refetch && (payload.upserts || payload.deletedIds)) {
          for (const [key] of client.getQueriesData({ queryKey: ['canvas', 'boards', boardId, 'objects'] })) {
            const pageId = key[4]
            client.setQueryData(key, (rows) => (rows ? applyObjectDelta(rows, pageId, payload) : rows))
          }
          return
        }
        const keys = { board: ['canvas', 'boards', boardId], objects: ['canvas', 'boards', boardId, 'objects'], links: ['canvas', 'boards', boardId, 'links'], versions: ['canvas', 'boards', boardId, 'versions'] }
        for (const target of payload.action === 'objects.changed' ? ['objects'] : invalidationTargets(payload.action)) {
          client.invalidateQueries({ queryKey: keys[target], exact: target === 'board' })
        }
      },
```

with `import { applyObjectDelta, invalidationTargets } from '../lib/realtimeCache.js'`. (Board key invalidation is `exact` so it does not refetch every page's objects.)

- [ ] **Step 8: Run tests + eslint on touched files; commit** — `feat(canvas): apply realtime object deltas and batch conflicts in the editor`

---

### Task 4: Remote cursors and selection

**Files:**
- Create: `apps/desktop/src/modules/runly.canvas/lib/remoteCursors.js` (+ `remoteCursors.test.js`)
- Modify: `apps/desktop/src/modules/runly.canvas/hooks/useCanvasRealtime.js`
- Modify: `apps/desktop/src/modules/runly.canvas/engine/Canvas2DRenderer.js`
- Modify: `apps/desktop/src/modules/runly.canvas/components/CanvasViewport.jsx`
- Modify: `apps/desktop/src/modules/runly.canvas/screens/BoardEditor.jsx`

- [ ] **Step 1: Failing test** — `lib/remoteCursors.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_TTL_MS, colorFor, createThrottle, reduceCursor, visibleCursors } from './remoteCursors.js'

describe('Remote cursors', () => {
  it('assigns a stable color per user', () => {
    assert.equal(colorFor('user-1'), colorFor('user-1'))
    assert.match(colorFor('user-2'), /^#[0-9a-f]{6}$/i)
  })
  it('stores the latest cursor per actor and drops self', () => {
    let state = reduceCursor(new Map(), { actorId: 'u2', pageId: 'p1', x: 1, y: 2, selectedIds: ['a'] }, { selfId: 'u1', now: 100 })
    state = reduceCursor(state, { actorId: 'u1', pageId: 'p1', x: 9, y: 9 }, { selfId: 'u1', now: 100 })
    assert.deepEqual([...state.keys()], ['u2'])
    assert.equal(state.get('u2').at, 100)
  })
  it('shows cursors on the same page that are fresh and still present', () => {
    const state = new Map([
      ['u2', { actorId: 'u2', pageId: 'p1', x: 1, y: 1, selectedIds: [], at: 1000 }],
      ['u3', { actorId: 'u3', pageId: 'p2', x: 1, y: 1, selectedIds: [], at: 1000 }],
      ['u4', { actorId: 'u4', pageId: 'p1', x: 1, y: 1, selectedIds: [], at: 0 }],
    ])
    const presence = [{ id: 'u2', name: 'Ana' }, { id: 'u3', name: 'Luis' }, { id: 'u4', name: 'Eva' }]
    const shown = visibleCursors(state, { pageId: 'p1', presence, now: 1000 + CURSOR_TTL_MS - 1 })
    assert.deepEqual(shown.map((c) => [c.id, c.name]), [['u2', 'Ana']])
  })
  it('throttles to one call per interval and flushes the last value', async () => {
    const calls = []
    const throttled = createThrottle((value) => calls.push(value), 20)
    throttled(1); throttled(2); throttled(3)
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.deepEqual(calls, [1, 3])
  })
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: `remoteCursors.js`**

```js
// Ephemeral cursor/selection state from other editors (relay event `cursor`).
export const CURSOR_TTL_MS = 10_000
export const CURSOR_SEND_MS = 120
const PALETTE = ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3']

export function colorFor(id = '') {
  let hash = 0
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

export function reduceCursor(state, payload, { selfId, now = Date.now() }) {
  if (!payload?.actorId || payload.actorId === selfId) return state
  const next = new Map(state)
  next.set(payload.actorId, { actorId: payload.actorId, pageId: payload.pageId, x: payload.x, y: payload.y, selectedIds: Array.isArray(payload.selectedIds) ? payload.selectedIds : [], at: now })
  return next
}

// Cursors to draw: same page, updated within the TTL, user still present.
export function visibleCursors(state, { pageId, presence, now = Date.now() }) {
  const names = new Map(presence.map((user) => [user.id, user.name]))
  return [...state.values()]
    .filter((cursor) => cursor.pageId === pageId && now - cursor.at < CURSOR_TTL_MS && names.has(cursor.actorId))
    .map((cursor) => ({ id: cursor.actorId, name: names.get(cursor.actorId), color: colorFor(cursor.actorId), x: cursor.x, y: cursor.y, selectedIds: cursor.selectedIds }))
}

// Leading call, then at most one trailing call per interval with the latest value.
export function createThrottle(fn, interval) {
  let last = 0, timer = null, pending
  return (value) => {
    pending = value
    const wait = interval - (Date.now() - last)
    if (wait <= 0 && !timer) { last = Date.now(); fn(value); return }
    if (timer) return
    timer = setTimeout(() => { timer = null; last = Date.now(); fn(pending) }, Math.max(wait, 0))
  }
}
```

- [ ] **Step 4: Hook** — in `useCanvasRealtime.js`:

1. Change the signature to `useCanvasRealtime(boardId, { pageId, selectedIds } = {})`.
2. Add state `const [cursors, setCursors] = useState(() => new Map())` and a `now` ticker: `const [now, setNow] = useState(Date.now())` with an effect `setInterval(() => setNow(Date.now()), 2000)` (cleared on unmount) so stale cursors disappear.
3. In `createCanvasRealtimeSession`, add `onCursor` and `channel.on('broadcast', { event: 'cursor' }, onCursor)`; pass `onCursor: (message) => setCursors((state) => reduceCursor(state, message?.payload, { selfId: userId }))`.
4. Sending: keep `others` as now; create a ref-held throttled sender:

```js
  const othersRef = useRef(0), pageRef = useRef(pageId), selectionRef = useRef(selectedIds ?? [])
  othersRef.current = others.length; pageRef.current = pageId; selectionRef.current = selectedIds ?? []
  const sendRef = useRef(null)
  if (!sendRef.current) {
    sendRef.current = createThrottle((point) => {
      if (!othersRef.current) return
      channelRef.current?.send({ type: 'broadcast', event: 'cursor', payload: { pageId: pageRef.current, x: point?.x ?? null, y: point?.y ?? null, selectedIds: selectionRef.current } })
    }, CURSOR_SEND_MS)
  }
  const lastPointRef = useRef(null)
  const broadcastPointer = useCallback((point) => { lastPointRef.current = point; sendRef.current(point) }, [])
  // Selection changes are sent even without pointer movement.
  const selectionKey = (selectedIds ?? []).join(',')
  useEffect(() => { sendRef.current?.(lastPointRef.current) }, [selectionKey, pageId])
```

5. Return `{ presence: others, cursors: visibleCursors(cursors, { pageId, presence: others, now }), broadcastPointer }` (remove the old unused `broadcastCursor`).

- [ ] **Step 5: Renderer** — in `Canvas2DRenderer.render(scene)` destructure `remote = []`. Inside the world transform (after drawing selection, before `ctx.restore()`), add:

```js
    for (const cursor of remote) {
      for (const object of objects) if (cursor.selectedIds?.includes(object.id)) this.drawRemoteSelection(ctx, object, viewport.zoom, cursor.color)
    }
```

after `ctx.restore()` (screen space), before overlay/marquee:

```js
    for (const cursor of remote) if (Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) this.drawRemoteCursor(ctx, cursor, viewport)
```

and add methods:

```js
  drawRemoteSelection(ctx, object, zoom, color) {
    const b = objectBounds(object), pad = 5 / zoom
    ctx.save()
    ctx.setLineDash([5 / zoom, 4 / zoom]); ctx.lineWidth = 1.5 / zoom; ctx.strokeStyle = color
    ctx.strokeRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2)
    ctx.restore()
  }

  // Arrow pointer plus a name pill, in screen space.
  drawRemoteCursor(ctx, cursor, viewport) {
    const p = worldToScreen(cursor, viewport)
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 16); ctx.lineTo(4.5, 12); ctx.lineTo(8, 19); ctx.lineTo(10.5, 18); ctx.lineTo(7, 11); ctx.lineTo(12, 11); ctx.closePath()
    ctx.fillStyle = cursor.color; ctx.fill(); ctx.lineWidth = 1.25; ctx.strokeStyle = '#ffffff'; ctx.stroke()
    ctx.font = `600 11px ${this.theme.font}`; ctx.textBaseline = 'middle'
    const label = cursor.name.length > 24 ? `${cursor.name.slice(0, 23)}…` : cursor.name, width = ctx.measureText(label).width + 12
    ctx.beginPath(); ctx.roundRect(12, 18, width, 18, 9); ctx.fillStyle = cursor.color; ctx.fill()
    ctx.fillStyle = '#ffffff'; ctx.fillText(label, 18, 27.5)
    ctx.restore()
  }
```

- [ ] **Step 6: Viewport** — `CanvasViewport` accepts `remote` and `onPointerWorld` props. In `draw()` pass `remote: p.remote ?? []`. In `pointerMove`, at the very top (after computing `screen`), call `p.onPointerWorld?.(screenToWorld(screen, p.viewport))` for mouse and pen pointers (`event.pointerType !== 'touch'`). Add `onPointerLeave={() => propsRef.current.onPointerWorld?.(null)}` to the `<canvas>`.

- [ ] **Step 7: Editor** — in `BoardEditor.jsx` change to `const { presence, cursors, broadcastPointer } = useCanvasRealtime(boardId, { pageId, selectedIds })` and pass `remote={cursors} onPointerWorld={broadcastPointer}` to `CanvasViewport`.

- [ ] **Step 8: Run tests, eslint touched files, `pnpm --filter ./apps/desktop build:web`; commit** — `feat(canvas): live cursors and selection of other editors`

---

### Task 5: Versions panel

**Files:**
- Modify: `apps/desktop/src/modules/runly.canvas/hooks/useCanvasData.js`
- Create: `apps/desktop/src/modules/runly.canvas/components/VersionsSheet.jsx`
- Modify: `apps/desktop/src/modules/runly.canvas/components/EditorTopBar.jsx`
- Modify: `apps/desktop/src/modules/runly.canvas/screens/BoardEditor.jsx`

- [ ] **Step 1: Hooks** (append to `useCanvasData.js`):

```js
// ---- Versions ---------------------------------------------------------
const versionsKey = (boardId) => ['canvas', 'boards', boardId, 'versions']
export function useVersions(boardId, enabled = true) {
  const token = useToken()
  return useQuery({ queryKey: versionsKey(boardId), queryFn: async () => unwrap(await runly.canvas.listVersions(boardId, token)) ?? [], enabled: Boolean(token && boardId && enabled) })
}
export function useVersionMutations(boardId) {
  const token = useToken(), client = useQueryClient()
  const create = useMutation({
    mutationFn: (data) => runly.canvas.createVersion(boardId, data, token),
    onSuccess: () => { client.invalidateQueries({ queryKey: versionsKey(boardId) }); client.invalidateQueries({ queryKey: boardKey(boardId), exact: true }) },
  })
  const restore = useMutation({
    mutationFn: (versionId) => runly.canvas.restoreVersion(boardId, versionId, token),
    onSuccess: () => client.invalidateQueries({ queryKey: ['canvas', 'boards', boardId] }),
  })
  return { create, restore }
}
```

- [ ] **Step 2: `VersionsSheet.jsx`** — props `{ open, onOpenChange, boardId, currentVersionId, canCreate, canRestore, onRestored }`. Structure:

- `Sheet` / `SheetContent side="right"` with `className="gap-0 p-0"`; `SheetHeader` (fixed) with `SheetTitle` "Versiones" and `SheetDescription` "Guarda el estado del Board para volver a él cuando lo necesites.".
- If `canCreate`: a `<form>` below the header (fixed, `border-b`) with `TextField`/`Input` "Nombre de la versión (opcional)" (`maxLength={200}`) and a `Button` "Guardar versión" (spinner while `create.isPending`); on success `toast.success('Versión guardada')` and clear the input; on error `toast.error(error.message)`.
- Scrollable list (`min-h-0 flex-1 overflow-y-auto`): `Skeleton` rows while loading; `ErrorState` with retry on error; `EmptyState` (icon `History`, title "Sin versiones", description "Guarda una versión para poder volver a este punto.") when empty. Each row: "Versión {number}" (semibold) + optional name; meta line `{createdByName} · {timeAgo(createdAt)} · {objectCount} elementos`; badges "Actual" (when `id === currentVersionId`) and "Restaurada" (when `restoredAt`); if `canRestore`, an outline `Button size="sm"` "Restaurar".
- `ConfirmDialog` (from `@runly/ui`) for restore: title `Restaurar la versión ${n}`, description "Se reemplazará el contenido del Board por esta versión. Antes se guardará una versión automática del estado actual.", confirm label "Restaurar". On confirm: `restore.mutateAsync(id)` → `toast.success('Versión restaurada')`, call `onRestored()`, close the dialog; on error `toast.error`.

Use `timeAgo` from `../lib/boardMeta.js`. Check the `ConfirmDialog` and `Badge` prop names in `packages/ui/src/index.js` / their component files before using them.

- [ ] **Step 3: Top bar** — `EditorTopBar` gets `onVersions` prop; add a `ToolButton` with the `History` icon, label "Versiones", placed just before the share button (visible for every role; the sheet decides what each role can do).

- [ ] **Step 4: Editor** — `BoardEditor.jsx`: state `versionsOpen`; pass `onVersions={() => setVersionsOpen(true)}`; render

```jsx
      <VersionsSheet
        open={versionsOpen} onOpenChange={setVersionsOpen} boardId={boardId} currentVersionId={board.data?.currentVersionId}
        canCreate={!readOnly} canRestore={myRole === 'OWNER'}
        onRestored={() => { setSelectedIds([]); fittedPageRef.current = null }}
      />
```

`onRestored` also needs the current page to still exist: if `pages` no longer contains `pageId` after the refetch, the existing first-page effect handles it only when `pageId` is falsy — so set `setPageId(null)` in `onRestored` too.

- [ ] **Step 5: eslint touched files, build; commit** — `feat(canvas): versions panel to save and restore board states`

---

### Task 6: Automatic thumbnails

**Files:**
- Create: `apps/desktop/src/modules/runly.canvas/lib/thumbnail.js` (+ `thumbnail.test.js` for the pure layout helper)
- Create: `apps/desktop/src/modules/runly.canvas/hooks/useBoardThumbnail.js`
- Modify: `apps/desktop/src/modules/runly.canvas/screens/BoardEditor.jsx`
- Modify: `apps/desktop/src/modules/runly.canvas/screens/CanvasHome.jsx`, `components/BoardCard.jsx`

- [ ] **Step 1: Failing test** — `lib/thumbnail.test.js`:

```js
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { THUMB_HEIGHT, THUMB_WIDTH, thumbnailViewport } from './thumbnail.js'

describe('Board thumbnail layout', () => {
  it('fits the scene inside the thumbnail with padding', () => {
    const viewport = thumbnailViewport({ x: 0, y: 0, width: 1000, height: 500 })
    assert.equal(THUMB_WIDTH, 640); assert.equal(THUMB_HEIGHT, 360)
    assert.ok(viewport.zoom > 0 && viewport.zoom <= 1)
    const right = viewport.x + 1000 * viewport.zoom, bottom = viewport.y + 500 * viewport.zoom
    assert.ok(viewport.x >= 0 && right <= THUMB_WIDTH && viewport.y >= 0 && bottom <= THUMB_HEIGHT)
  })
  it('returns null for an empty scene', () => { assert.equal(thumbnailViewport(null), null) })
})
```

- [ ] **Step 2: `thumbnail.js`**

```js
import { Canvas2DRenderer, sceneBounds } from '../engine/Canvas2DRenderer.js'
import { fitBounds } from '../engine/viewport.js'

export const THUMB_WIDTH = 640
export const THUMB_HEIGHT = 360

export function thumbnailViewport(bounds) {
  if (!bounds) return null
  const viewport = fitBounds(bounds, { width: THUMB_WIDTH, height: THUMB_HEIGHT }, 24)
  return { ...viewport, zoom: Math.min(viewport.zoom, 1) === viewport.zoom ? viewport.zoom : 1 }
}

// Images for the thumbnail are fetched with CORS so the canvas stays
// exportable; any that fail are drawn as placeholders.
async function loadImages(urls) {
  const images = new Map()
  await Promise.all(Object.entries(urls ?? {}).map(async ([fileId, url]) => {
    try {
      const response = await fetch(url, { mode: 'cors' })
      if (!response.ok) return
      const bitmap = await createImageBitmap(await response.blob())
      images.set(fileId, Object.assign(bitmap, { complete: true, naturalWidth: bitmap.width }))
    } catch { /* placeholder */ }
  }))
  return images
}

export async function renderThumbnail(objects, { imageUrls } = {}) {
  const viewport = thumbnailViewport(sceneBounds(objects))
  if (!viewport) return null
  const canvas = document.createElement('canvas')
  const renderer = new Canvas2DRenderer(canvas)
  renderer.resize(THUMB_WIDTH, THUMB_HEIGHT, 1)
  const draw = (images) => renderer.render({ objects, viewport, images, selectedIds: new Set(), grid: { enabled: false }, interactive: false })
  const toBlob = () => new Promise((resolve, reject) => { try { canvas.toBlob(resolve, 'image/png') } catch (error) { reject(error) } })
  draw(await loadImages(imageUrls))
  try { return await toBlob() } catch { draw(new Map()); return toBlob() }
}
```

Note: if `fitBounds` already clamps zoom, simplify `thumbnailViewport` to `fitBounds(...)` capped with `Math.min(zoom, 1)` and recompute `x/y` to center; make the test pass with the simplest correct code (read `engine/viewport.js` `fitBounds` first).

- [ ] **Step 3: `useBoardThumbnail.js`**

Inputs `{ boardId, enabled, rows, saving }`. Behaviour:
- Ignore the first `rows` value after load (mark `loadedRef`); every later change of `rows` identity sets `dirtyRef = true`.
- Effect on `[rows, saving]`: if `enabled && dirtyRef.current && !saving`, (re)start an 8 000 ms timer; when it fires, and at least 60 000 ms passed since the last upload (`lastRef`), run `generate()`.
- `generate()`: filter out `pending` rows; if none, return. Get signed URLs for image `fileId`s with `runly.files.batchSignedUrls(ids, token)` (unwrap `.data`); `renderThumbnail(rows, { imageUrls })`; if a blob comes back, upload it as `File([blob], 'miniatura.png', { type: 'image/png' })` through the same `FormData` flow as `useUploadFile` (moduleKey `runly.canvas`, entityType `CanvasBoard`, entityId `boardId`), then `runly.canvas.updateBoard(boardId, { thumbnailFileId: asset.id }, token)`; set `dirtyRef.current = false`, `lastRef.current = Date.now()`. Errors are swallowed (thumbnails are best effort) but logged with `console.warn` in non-production.
- On unmount, if dirty, call `generate()` once (fire and forget) using refs for the latest rows/token.

Use `useAuth().session?.access_token` like `useCanvasData.js`. Invalidate `['canvas', 'boards']` (exact) after updating so the home list shows the new thumbnail.

- [ ] **Step 4: Editor** — `useBoardThumbnail({ boardId, enabled: Boolean(board.data) && !readOnly, rows: allRows, saving: actions.saving })`.

- [ ] **Step 5: Home + card** — in `CanvasHome.jsx`, collect `thumbnailFileId`s from `list` and fetch signed URLs with a `useQuery` (`['canvas', 'thumbnail-urls', ids]`, `runly.files.batchSignedUrls`, `staleTime: 30 * 60_000`, enabled when ids exist). Pass `thumbnailUrl={urls[board.thumbnailFileId]}` to `BoardCard`. In `BoardCard`, when `thumbnailUrl` is set, render `<img src={thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(true)} />` inside the 16:9 preview box (keep the template label pill on top with `z-10`); when missing or failed, keep the current icon tile.

- [ ] **Step 6: Tests, eslint touched files, build; commit** — `feat(canvas): automatic board thumbnails in the board list`

---

### Task 7: Help text and verification

- [ ] **Step 1:** In `apps/api/src/manifests/official/help/runly.canvas/overview.md` (no-accent style), add sections:

```md
### Trabajo en equipo en vivo

Cuando otra persona edita el mismo Board ves su **cursor con su nombre** y un contorno de su color alrededor de lo que tiene seleccionado. Sus cambios aparecen al instante sin recargar. Si ustedes dos cambian el mismo elemento casi al mismo tiempo, se guarda el primero y al otro le aparece un aviso con la version mas reciente.

### Versiones

El boton **Versiones** de la barra superior guarda el estado completo del Board con un nombre opcional (por ejemplo "Antes de reacomodar"). El propietario puede **restaurar** cualquier version; antes de restaurar se guarda automaticamente una version del estado actual, asi que nada se pierde. Se conservan las ultimas 100 versiones.

### Miniaturas

La lista de Boards muestra una miniatura de cada Board. Se actualiza sola unos segundos despues de que dejas de editar.
```

- [ ] **Step 2: Full verification**

```bash
node --test apps/api/src/routes/canvas/__tests__/*.test.js apps/api/src/services/__tests__/realtime-access-service.test.js apps/api/src/services/__tests__/realtime-broadcaster.test.js
node --test apps/desktop/src/modules/runly.canvas/engine/*.test.js apps/desktop/src/modules/runly.canvas/lib/*.test.js
npx eslint <all touched files>
pnpm --filter ./apps/desktop build:web
```

- [ ] **Step 3: Commit** — `docs(canvas): help for live collaboration, versions and thumbnails`
