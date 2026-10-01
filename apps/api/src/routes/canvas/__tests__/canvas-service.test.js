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
    assert.deepEqual(calls.find(([name]) => name === 'layers')[1].map((layer) => layer.type), ['vector', 'hotspot', 'data'])
    assert.equal(calls.find(([name]) => name === 'audit')[1].action, 'BOARD_CREATED')
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

  it('rejects stale object batch updates with an optimistic revision conflict', async () => {
    const tx = { canvasObject: { updateMany: async () => ({ count: 0 }) } }
    const prisma = { canvasBoard: { findFirst: async () => accessibleBoard() }, $transaction: (fn) => fn(tx) }
    const service = createCanvasService({ prisma })
    await assert.rejects(
      () => service.batchObjects(COMPANY, USER, BOARD, [{ op: 'update', id: 'object-1', expectedRevision: 2, data: { transform: { x: 2, y: 3 } } }]),
      (error) => error instanceof CanvasServiceError && error.status === 409 && error.code === 'REVISION_CONFLICT',
    )
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
