import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CanvasServiceError, createCanvasService, validateCanvasObject } from '../canvas-service.js'

const COMPANY = '00000000-0000-4000-8000-000000000001'
const OTHER_COMPANY = '00000000-0000-4000-8000-000000000002'
const USER = '00000000-0000-4000-8000-000000000003'
const BOARD = '00000000-0000-4000-8000-000000000004'

function accessibleBoard(overrides = {}) {
  return { id: BOARD, companyId: COMPANY, ownerId: USER, archivedAt: null, collaborators: [], ...overrides }
}

describe('Runly Canvas service', () => {
  it('scopes direct board access by active company and hides foreign IDs', async () => {
    let where
    const prisma = { canvasBoard: { findFirst: async (query) => { where = query.where; return null } } }
    const service = createCanvasService({ prisma })
    await assert.rejects(() => service.assertBoardAccess(OTHER_COMPANY, USER, BOARD), (error) => {
      assert.equal(error.status, 404)
      return true
    })
    assert.deepEqual(where, { id: BOARD, companyId: OTHER_COMPANY, archivedAt: null })
  })

  it('creates Board, owner ACL, initial page/layers and audit atomically', async () => {
    const calls = []
    const tx = {
      canvasBoard: { create: async ({ data }) => { calls.push(['board', data]); return { id: BOARD, ...data } } },
      canvasCollaborator: { create: async ({ data }) => calls.push(['collaborator', data]) },
      canvasPage: { create: async ({ data }) => { calls.push(['page', data]); return { id: 'page-1', ...data } } },
      canvasLayer: { createMany: async ({ data }) => calls.push(['layers', data]) },
      auditLog: { create: async ({ data }) => calls.push(['audit', data]) },
    }
    const service = createCanvasService({ prisma: { $transaction: (fn) => fn(tx) } })
    const board = await service.createBoard(COMPANY, USER, { name: ' Terminal 1 ', templateType: 'plan' })
    assert.equal(board.name, 'Terminal 1')
    assert.equal(calls.find(([name]) => name === 'collaborator')[1].role, 'OWNER')
    assert.deepEqual(calls.find(([name]) => name === 'layers')[1].map((layer) => layer.name), ['Plano base', 'Mobiliario', 'Hotspots', 'Datos Runly'])
    assert.deepEqual(calls.find(([name]) => name === 'board')[1].settings, { version: 2, grid: { enabled: true, size: 20 }, snapping: true, defaultTool: 'select' })
    assert.equal(calls.find(([name]) => name === 'audit')[1].action, 'BOARD_CREATED')
  })

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

  it('reorders every layer in two passes to avoid unique-position collisions', async () => {
    const updates = []
    const tx = {
      canvasLayer: {
        update: async ({ where, data }) => { updates.push([where.id, data.position]); return {} },
        findMany: async () => [{ id: 'b', position: 0 }, { id: 'a', position: 1 }],
      },
    }
    const prisma = {
      canvasBoard: { findFirst: async () => accessibleBoard() },
      canvasLayer: { findMany: async () => [{ id: 'a' }, { id: 'b' }] },
      $transaction: (fn) => fn(tx),
    }
    const service = createCanvasService({ prisma })
    await service.reorderLayers(COMPANY, USER, BOARD, 'page-1', ['b', 'a'])
    assert.deepEqual(updates, [['b', -100000], ['a', -100001], ['b', 0], ['a', 1]])
  })

  it('reports a stale object batch update as a conflict with the current row', async () => {
    const current = { id: 'object-1', revision: 5 }
    const tx = { canvasObject: { updateMany: async () => ({ count: 0 }), findFirst: async () => current }, canvasBoard: { update: async () => ({}) } }
    const prisma = { canvasBoard: { findFirst: async () => accessibleBoard() }, $transaction: (fn) => fn(tx) }
    const service = createCanvasService({ prisma })
    const [result] = await service.batchObjects(COMPANY, USER, BOARD, [{ op: 'update', id: 'object-1', expectedRevision: 2, data: { transform: { x: 2, y: 3 } } }])
    assert.equal(result.op, 'conflict')
    assert.equal(result.object, current)
  })

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

  it('restores a soft-deleted object only when it is actually deleted', async () => {
    const calls = []
    const tx = {
      canvasObject: {
        updateMany: async (args) => { calls.push(args); return { count: 1 } },
        findFirst: async () => ({ id: 'object-1', deletedAt: null, revision: 3 }),
      },
      canvasBoard: { update: async () => ({}) },
    }
    const prisma = { canvasBoard: { findFirst: async () => accessibleBoard() }, $transaction: (fn) => fn(tx) }
    const [result] = await createCanvasService({ prisma }).batchObjects(COMPANY, USER, BOARD, [{ op: 'restore', id: 'object-1' }])
    assert.deepEqual(calls[0].where.deletedAt, { not: null })
    assert.equal(calls[0].data.deletedAt, null)
    assert.equal(result.object.id, 'object-1')
  })

  it('rejects an entity link when the tenant-aware resolver cannot see the record', async () => {
    const prisma = {
      canvasBoard: { findFirst: async () => accessibleBoard() },
    }
    const service = createCanvasService({ prisma, entityResolver: async ({ companyId }) => {
      assert.equal(companyId, COMPANY)
      return null
    } })
    await assert.rejects(
      () => service.createEntityLink(COMPANY, USER, 'auth-user', BOARD, { targetType: 'BOARD', targetId: BOARD, moduleKey: 'runly.inventory', entityType: 'inventory_item', entityId: 'foreign-item' }),
      (error) => error.status === 400,
    )
  })

  it('requires attachments to be visible FileAssets of the active company', async () => {
    let fileWhere
    const prisma = {
      canvasBoard: { findFirst: async () => accessibleBoard() },
      fileAsset: { findFirst: async ({ where }) => { fileWhere = where; return null } },
    }
    const service = createCanvasService({ prisma })
    await assert.rejects(
      () => service.addAttachment(COMPANY, USER, BOARD, { targetType: 'BOARD', targetId: BOARD, fileAssetId: 'file-foreign' }),
      (error) => error.status === 404,
    )
    assert.equal(fileWhere.entityId, COMPANY)
    assert.equal(fileWhere.enabled, true)
  })

  it('validates object geometry and bounds path payload size', () => {
    assert.equal(validateCanvasObject({ type: 'rectangle', transform: { x: 1, y: 2 }, geometry: { width: 100, height: 50 } }), true)
    assert.throws(() => validateCanvasObject({ type: 'rectangle', transform: { x: 1, y: 2 }, geometry: { width: -1, height: 50 } }), /width/)
    assert.throws(() => validateCanvasObject({ type: 'polygon', transform: {}, geometry: { points: [{ x: 1, y: 2 }] } }), /puntos/)
  })

  it('validates object bindings', () => {
    const base = { type: 'rectangle', geometry: { width: 10, height: 10 } }
    assert.doesNotThrow(() => validateCanvasObject({ ...base, properties: { binding: { source: 'inventory_location', id: '00000000-0000-4000-8000-000000000009' } } }))
    assert.throws(() => validateCanvasObject({ ...base, properties: { binding: { source: 'nope', id: '00000000-0000-4000-8000-000000000009' } } }), (error) => error.status === 400)
    assert.throws(() => validateCanvasObject({ ...base, properties: { binding: { source: 'inventory_item', id: 'x' } } }), (error) => error.status === 400)
    assert.doesNotThrow(() => validateCanvasObject({ ...base, properties: { binding: null } }))
  })

  it('validates line connections', () => {
    const base = { type: 'arrow', geometry: { x2: 10, y2: 0 } }
    assert.doesNotThrow(() => validateCanvasObject({ ...base, properties: { connect: { start: '00000000-0000-4000-8000-000000000009', end: null } } }))
    assert.throws(() => validateCanvasObject({ ...base, properties: { connect: { start: 'x' } } }), (error) => error.status === 400)
  })

  it('finds boards that reference a record through links or bindings', async () => {
    let objectWhere, boardWhere
    const prisma = {
      canvasObject: { findMany: async (query) => { objectWhere = query.where; return [{ boardId: 'bound-board' }] } },
      canvasBoard: { findMany: async (query) => { boardWhere = query.where; return [{ id: BOARD, name: 'Plano', templateType: 'plan' }] } },
    }
    const rows = await createCanvasService({ prisma }).listReferences(COMPANY, USER, { moduleKey: 'runly.inventory', entityType: 'inventory_item', entityId: 'it-1' })
    assert.deepEqual(rows, [{ boardId: BOARD, name: 'Plano', templateType: 'plan' }])
    assert.equal(objectWhere.companyId, COMPANY)
    assert.ok(JSON.stringify(objectWhere).includes('it-1'))
    assert.equal(boardWhere.companyId, COMPANY)
    assert.ok(JSON.stringify(boardWhere).includes('bound-board'))
  })

  it('only accepts thumbnails uploaded for the Board and removes every other one', async () => {
    const removed = []
    const prisma = {
      canvasBoard: { findFirst: async () => accessibleBoard({ thumbnailFileId: 'old' }), update: async ({ data }) => ({ id: BOARD, ...data }) },
      fileAsset: {
        // Files stores entityId = company and the Board in metadata.sourceEntityId.
        findFirst: async ({ where }) => (where.id === 'mine' && where.entityId === COMPANY && where.entityType === 'CanvasThumbnail' && where.metadata?.equals === BOARD ? { id: 'mine' } : null),
      },
      auditLog: { create: async () => ({}) },
    }
    const service = createCanvasService({ prisma, removeFiles: async (where) => { removed.push(where) } })
    await assert.rejects(() => service.updateBoard(COMPANY, USER, BOARD, { thumbnailFileId: 'foreign' }), (error) => error.status === 404)
    await service.updateBoard(COMPANY, USER, BOARD, { thumbnailFileId: 'mine' })
    assert.equal(removed.length, 1)
    assert.deepEqual(removed[0].id, { not: 'mine' })
    assert.equal(removed[0].entityId, COMPANY)
    assert.equal(removed[0].metadata.equals, BOARD)
  })

  it('prevents deleting the final Page in a Board', async () => {
    const prisma = {
      canvasBoard: { findFirst: async () => accessibleBoard() },
      canvasPage: { findMany: async () => [{ id: 'page-1' }] },
    }
    const service = createCanvasService({ prisma })
    await assert.rejects(() => service.deletePage(COMPANY, USER, BOARD, 'page-1'), (error) => error.status === 409)
  })
})

describe('Runly Canvas hotspot attachments', () => {
  it('lists hotspot files with their FileAsset metadata and skips disabled files', async () => {
    const prisma = {
      canvasBoard: { findFirst: async () => accessibleBoard() },
      canvasHotspot: { findFirst: async () => ({ id: 'h1' }) },
      canvasAttachment: { findMany: async () => [{ id: 'a1', fileAssetId: 'f1', label: 'foto.jpg' }, { id: 'a2', fileAssetId: 'f2', label: 'borrado.pdf' }] },
      fileAsset: { findMany: async ({ where }) => { assert.equal(where.entityId, COMPANY); assert.equal(where.enabled, true); return [{ id: 'f1', originalName: 'foto.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }] } },
    }
    const rows = await createCanvasService({ prisma }).listHotspotAttachments(COMPANY, USER, BOARD, 'h1')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].fileAsset.mimeType, 'image/jpeg')
    assert.equal(rows[0].fileAssetId, 'f1')
  })
})

describe('Runly Canvas collaborators', () => {
  it('shares a board with a valid Prisma upsert (create + update) and refuses the owner', async () => {
    let upsertArgs
    const prisma = {
      canvasBoard: { findFirst: async () => accessibleBoard() },
      canvasCollaborator: { upsert: async (args) => { upsertArgs = args; return { id: 'c1', ...args.create } } },
      auditLog: { create: async () => ({}) },
    }
    const service = createCanvasService({ prisma })
    const row = await service.addCollaborator(COMPANY, USER, BOARD, { userId: 'friend', role: 'EDITOR' }, async () => {})
    assert.deepEqual(Object.keys(upsertArgs).sort(), ['create', 'update', 'where'])
    assert.equal(upsertArgs.create.role, 'EDITOR')
    assert.equal(row.userId, 'friend')
    await assert.rejects(() => service.addCollaborator(COMPANY, USER, BOARD, { userId: USER, role: 'VIEWER' }, async () => {}), (error) => error.status === 409)
  })
})
