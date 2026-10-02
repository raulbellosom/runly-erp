import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CanvasServiceError } from '../canvas-service.js'
import { createCanvasBoardDeletion } from '../canvas-board-delete.js'

const COMPANY = '00000000-0000-4000-8000-000000000001'
const USER = '00000000-0000-4000-8000-000000000003'
const BOARD = '00000000-0000-4000-8000-000000000004'
const HOTSPOT = '00000000-0000-4000-8000-000000000005'
const FILE_BOARD = '00000000-0000-4000-8000-000000000006'
const FILE_HOTSPOT = '00000000-0000-4000-8000-000000000007'
const FILE_LIBRARY = '00000000-0000-4000-8000-000000000008'

function boardRow(overrides = {}) {
  return { id: BOARD, companyId: COMPANY, name: 'Planta baja', templateType: 'plan', ...overrides }
}

describe('Canvas board deletion', () => {
  it('rejects a Board outside the company with 404', async () => {
    const canvas = { assertBoardAccess: async () => { throw new CanvasServiceError('Board no encontrado.', 404) } }
    const deletion = createCanvasBoardDeletion({ prisma: {}, canvas, removeFiles: async () => {} })
    await assert.rejects(() => deletion.deleteBoard(COMPANY, USER, BOARD), (error) => {
      assert.ok(error instanceof CanvasServiceError)
      assert.equal(error.status, 404)
      return true
    })
  })

  it('rejects a non-owner collaborator with 403', async () => {
    const canvas = { assertBoardAccess: async () => { throw new CanvasServiceError('No tienes acceso suficiente a este Board.', 403) } }
    const deletion = createCanvasBoardDeletion({ prisma: {}, canvas, removeFiles: async () => {} })
    await assert.rejects(() => deletion.deleteBoard(COMPANY, USER, BOARD), (error) => error.status === 403)
  })

  it('collects hotspot/file ids, excludes library-referenced files, cleans up comments/public-links/board and audits counts', async () => {
    const calls = []
    let fileWhere
    const tx = {
      entityComment: { deleteMany: async ({ where }) => { calls.push(['comment', where]) } },
      modulePublicLink: { deleteMany: async ({ where }) => { calls.push(['public-link', where]) } },
      canvasBoard: { delete: async ({ where }) => { calls.push(['board-delete', where]) } },
      auditLog: { create: async ({ data }) => { calls.push(['audit', data]) } },
      // Tagged template: values = [companyId, '%<fileId>%']. Only the file
      // "referenced by a library" resolves a row.
      $queryRaw: async (_strings, ..._values) => {
        const pattern = _values[1]
        return typeof pattern === 'string' && pattern.includes(FILE_LIBRARY) ? [{ id: 'library-item-1' }] : []
      },
    }
    const canvas = { assertBoardAccess: async () => ({ board: boardRow(), role: 'OWNER' }) }
    const prisma = {
      canvasPage: { count: async () => 3 },
      canvasObject: { count: async () => 12 },
      canvasHotspot: { findMany: async () => [{ id: HOTSPOT }] },
      fileAsset: {
        findMany: async ({ where }) => { fileWhere = where; return [{ id: FILE_BOARD }, { id: FILE_HOTSPOT }, { id: FILE_LIBRARY }] },
        updateMany: async () => { throw new Error('should not disable rows when removeFiles succeeds') },
      },
      $transaction: (fn) => fn(tx),
    }
    let removed
    const deletion = createCanvasBoardDeletion({ prisma, canvas, removeFiles: async (where) => { removed = where } })
    await deletion.deleteBoard(COMPANY, USER, BOARD)

    // The candidate query includes the board id and the hotspot id.
    assert.deepEqual(fileWhere.OR, [
      { metadata: { path: ['sourceEntityId'], equals: BOARD } },
      { metadata: { path: ['sourceEntityId'], equals: HOTSPOT } },
    ])
    assert.deepEqual(fileWhere.entityType, { in: ['CanvasBoard', 'CanvasThumbnail', 'CanvasHotspot'] })

    const commentCalls = calls.filter(([name]) => name === 'comment')
    assert.deepEqual(commentCalls[0][1], { companyId: COMPANY, entityType: 'CanvasBoard', entityId: BOARD })
    assert.deepEqual(commentCalls[1][1], { companyId: COMPANY, entityType: 'CanvasHotspot', entityId: { in: [HOTSPOT] } })
    assert.deepEqual(calls.find(([name]) => name === 'public-link')[1], { companyId: COMPANY, moduleKey: 'runly.canvas', recordId: BOARD })
    assert.deepEqual(calls.find(([name]) => name === 'board-delete')[1], { id: BOARD })

    const audit = calls.find(([name]) => name === 'audit')[1]
    assert.equal(audit.action, 'BOARD_DELETED')
    assert.deepEqual(audit.before, { name: 'Planta baja', templateType: 'plan' })
    // FILE_LIBRARY is excluded from the kept/deleted set.
    assert.deepEqual(audit.metadata, { pages: 3, objects: 12, hotspots: 1, files: 2 })

    assert.deepEqual(removed, { id: { in: [FILE_BOARD, FILE_HOTSPOT] } })
  })

  it('disables file rows instead of blocking the delete when removeFiles throws', async () => {
    const tx = {
      entityComment: { deleteMany: async () => {} },
      modulePublicLink: { deleteMany: async () => {} },
      canvasBoard: { delete: async () => {} },
      auditLog: { create: async () => {} },
      $queryRaw: async () => [],
    }
    const canvas = { assertBoardAccess: async () => ({ board: boardRow(), role: 'OWNER' }) }
    let disabledWhere
    const prisma = {
      canvasPage: { count: async () => 0 },
      canvasObject: { count: async () => 0 },
      canvasHotspot: { findMany: async () => [] },
      fileAsset: {
        findMany: async () => [{ id: FILE_BOARD }],
        updateMany: async ({ where }) => { disabledWhere = where },
      },
      $transaction: (fn) => fn(tx),
    }
    const deletion = createCanvasBoardDeletion({ prisma, canvas, removeFiles: async () => { throw new Error('storage down') } })
    await deletion.deleteBoard(COMPANY, USER, BOARD)
    assert.deepEqual(disabledWhere, { id: { in: [FILE_BOARD] } })
  })

  it('skips file cleanup entirely when the Board had no files', async () => {
    const tx = {
      entityComment: { deleteMany: async () => {} },
      modulePublicLink: { deleteMany: async () => {} },
      canvasBoard: { delete: async () => {} },
      auditLog: { create: async () => {} },
      $queryRaw: async () => [],
    }
    const canvas = { assertBoardAccess: async () => ({ board: boardRow(), role: 'OWNER' }) }
    let removeFilesCalled = false
    const prisma = {
      canvasPage: { count: async () => 1 },
      canvasObject: { count: async () => 0 },
      canvasHotspot: { findMany: async () => [] },
      fileAsset: { findMany: async () => [] },
      $transaction: (fn) => fn(tx),
    }
    const deletion = createCanvasBoardDeletion({ prisma, canvas, removeFiles: async () => { removeFilesCalled = true } })
    await deletion.deleteBoard(COMPANY, USER, BOARD)
    assert.equal(removeFilesCalled, false)
  })
})
