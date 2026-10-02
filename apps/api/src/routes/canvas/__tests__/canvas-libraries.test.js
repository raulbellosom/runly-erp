import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CanvasServiceError } from '../canvas-service.js'
import { createCanvasLibrariesService } from '../canvas-libraries.js'
import { createCanvasRouter } from '../canvas-routes.js'

const COMPANY = '00000000-0000-4000-8000-000000000001'
const OTHER_USER = '00000000-0000-4000-8000-000000000002'
const USER = '00000000-0000-4000-8000-000000000003'
const LIBRARY = '00000000-0000-4000-8000-000000000004'

function personalLibrary(overrides = {}) {
  return { id: LIBRARY, companyId: COMPANY, ownerId: USER, name: 'Mía', scope: 'PERSONAL', source: 'custom', ...overrides }
}

function companyLibrary(overrides = {}) {
  return { id: LIBRARY, companyId: COMPANY, ownerId: OTHER_USER, name: 'Equipo', scope: 'COMPANY', source: 'custom', ...overrides }
}

const RECTANGLE = {
  type: 'rectangle',
  transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  geometry: { width: 10, height: 10 },
}

describe('Runly Canvas libraries service', () => {
  it('lists personal-owned and company libraries with canEdit', async () => {
    const rows = [
      { ...personalLibrary(), _count: { items: 2 } },
      { ...companyLibrary(), _count: { items: 5 } },
    ]
    let where
    const prisma = { canvasLibrary: { findMany: async (query) => { where = query.where; return rows } } }
    const service = createCanvasLibrariesService({ prisma })
    const list = await service.list(COMPANY, USER, { canManage: false })
    assert.deepEqual(where, { companyId: COMPANY, OR: [{ scope: 'COMPANY' }, { scope: 'PERSONAL', ownerId: USER }] })
    assert.deepEqual(list.map((l) => [l.itemCount, l.canEdit]), [[2, true], [5, false]])
  })

  it('marks company libraries editable when the caller can manage canvas', async () => {
    const prisma = { canvasLibrary: { findMany: async () => [{ ...companyLibrary(), _count: { items: 0 } }] } }
    const service = createCanvasLibrariesService({ prisma })
    const [library] = await service.list(COMPANY, USER, { canManage: true })
    assert.equal(library.canEdit, true)
  })

  it('rejects a COMPANY library without canvas.manage', async () => {
    const prisma = { canvasLibrary: { create: async () => { throw new Error('should not be called') } } }
    const service = createCanvasLibrariesService({ prisma })
    await assert.rejects(
      () => service.create(COMPANY, USER, { name: 'Equipo', scope: 'COMPANY' }, { canManage: false }),
      (error) => error instanceof CanvasServiceError && error.status === 403,
    )
  })

  it('creates a COMPANY library when the caller can manage canvas', async () => {
    let created
    const prisma = {
      canvasLibrary: { create: async ({ data }) => { created = data; return { id: LIBRARY, ...data } } },
      auditLog: { create: async () => ({}) },
    }
    const service = createCanvasLibrariesService({ prisma })
    const library = await service.create(COMPANY, USER, { name: ' Equipo ', scope: 'COMPANY' }, { canManage: true })
    assert.equal(created.scope, 'COMPANY')
    assert.equal(library.name, 'Equipo')
  })

  it('rejects addItems with an invalid object', async () => {
    const prisma = { canvasLibrary: { findFirst: async () => personalLibrary() }, canvasLibraryItem: { count: async () => 0 } }
    const service = createCanvasLibrariesService({ prisma })
    await assert.rejects(
      () => service.addItems(COMPANY, USER, LIBRARY, [{ name: 'Malo', kind: 'objects', payload: { objects: [{ type: 'not-a-type' }] } }], { canManage: false }),
      (error) => error instanceof CanvasServiceError && error.status === 400,
    )
  })

  it('rejects an image item whose file was not uploaded for this library', async () => {
    const prisma = {
      canvasLibrary: { findFirst: async () => personalLibrary() },
      canvasLibraryItem: { count: async () => 0 },
      fileAsset: { findFirst: async () => null },
    }
    const service = createCanvasLibrariesService({ prisma })
    await assert.rejects(
      () => service.addItems(COMPANY, USER, LIBRARY, [{ name: 'Icono', kind: 'image', fileAssetId: 'foreign-file' }], { canManage: false }),
      (error) => error instanceof CanvasServiceError && error.status === 400,
    )
  })

  it('accepts a valid objects item and a valid image item', async () => {
    const created = []
    const tx = {
      canvasLibraryItem: { create: async ({ data }) => { created.push(data); return { id: `item-${created.length}`, ...data } } },
      auditLog: { create: async () => ({}) },
    }
    const prisma = {
      canvasLibrary: { findFirst: async () => personalLibrary() },
      canvasLibraryItem: { count: async () => 0 },
      fileAsset: { findFirst: async ({ where }) => (where.id === 'ok-file' ? { id: 'ok-file' } : null) },
      $transaction: (fn) => fn(tx),
    }
    const service = createCanvasLibrariesService({ prisma })
    const rows = await service.addItems(COMPANY, USER, LIBRARY, [
      { name: 'Rect', kind: 'objects', payload: { objects: [RECTANGLE], width: 10, height: 10 } },
      { name: 'Icono', kind: 'image', fileAssetId: 'ok-file', width: 32, height: 32 },
    ], { canManage: false })
    assert.equal(rows.length, 2)
    assert.deepEqual(created[0].payload.objects, [RECTANGLE])
    assert.equal(created[1].fileAssetId, 'ok-file')
  })

  it('caps a batch at 500 items', async () => {
    const prisma = { canvasLibrary: { findFirst: async () => personalLibrary() } }
    const service = createCanvasLibrariesService({ prisma })
    const items = Array.from({ length: 501 }, (_, i) => ({ name: `Item ${i}`, kind: 'objects', payload: { objects: [RECTANGLE] } }))
    await assert.rejects(
      () => service.addItems(COMPANY, USER, LIBRARY, items, { canManage: false }),
      (error) => error instanceof CanvasServiceError && error.status === 400,
    )
  })

  it('caps an objects item at 300 objects', async () => {
    const prisma = { canvasLibrary: { findFirst: async () => personalLibrary() }, canvasLibraryItem: { count: async () => 0 } }
    const service = createCanvasLibrariesService({ prisma })
    const objects = Array.from({ length: 301 }, () => RECTANGLE)
    await assert.rejects(
      () => service.addItems(COMPANY, USER, LIBRARY, [{ name: 'Muchos', kind: 'objects', payload: { objects } }], { canManage: false }),
      (error) => error instanceof CanvasServiceError && error.status === 400,
    )
  })

  it('hides a personal library owned by someone else as 404', async () => {
    const prisma = { canvasLibrary: { findFirst: async () => personalLibrary({ ownerId: OTHER_USER }) } }
    const service = createCanvasLibrariesService({ prisma })
    await assert.rejects(
      () => service.items(COMPANY, USER, LIBRARY),
      (error) => error instanceof CanvasServiceError && error.status === 404,
    )
  })

  it('deletes a library, disables its image FileAssets and writes LIBRARY_DELETED', async () => {
    const calls = []
    const tx = {
      canvasLibraryItem: { findMany: async () => [{ fileAssetId: 'file-1' }, { fileAssetId: 'file-2' }] },
      canvasLibrary: { delete: async ({ where }) => calls.push(['delete', where.id]) },
      fileAsset: { updateMany: async ({ where, data }) => calls.push(['disable', where.id.in, data.enabled]) },
      auditLog: { create: async ({ data }) => calls.push(['audit', data.action]) },
    }
    const prisma = { canvasLibrary: { findFirst: async () => personalLibrary() }, $transaction: (fn) => fn(tx) }
    const service = createCanvasLibrariesService({ prisma })
    await service.remove(COMPANY, USER, LIBRARY, { canManage: false })
    assert.deepEqual(calls, [
      ['delete', LIBRARY],
      ['disable', ['file-1', 'file-2'], false],
      ['audit', 'LIBRARY_DELETED'],
    ])
  })
})

describe('Runly Canvas libraries routes', () => {
  function requirePermissionWith(extra = {}) {
    return (key) => {
      return async (c, next) => {
        c.set('companyId', 'company-1')
        c.set('authUserId', 'auth-1')
        c.set('userContext', { profile: { id: 'user-1' }, isAdmin: false, permissionSet: new Set(), ...extra })
        return next()
      }
    }
  }

  it('forwards company/actor and canManage to list()', async () => {
    let received
    const librariesService = { list: async (companyId, actorId, opts) => { received = { companyId, actorId, opts }; return [] } }
    const app = createCanvasRouter({ requirePermission: requirePermissionWith({ permissionSet: new Set(['canvas.manage']) }), service: {}, librariesService })
    const response = await app.request('http://localhost/canvas/libraries')
    assert.equal(response.status, 200)
    assert.deepEqual(received, { companyId: 'company-1', actorId: 'user-1', opts: { canManage: true } })
  })

  it('forwards canManage: false when the caller lacks canvas.manage', async () => {
    let received
    const librariesService = { list: async (companyId, actorId, opts) => { received = opts; return [] } }
    const app = createCanvasRouter({ requirePermission: requirePermissionWith(), service: {}, librariesService })
    await app.request('http://localhost/canvas/libraries')
    assert.deepEqual(received, { canManage: false })
  })

  it('forwards library id and item body to addItems', async () => {
    let received
    const librariesService = { addItems: async (companyId, actorId, libraryId, items, opts) => { received = { companyId, actorId, libraryId, items, opts }; return [] } }
    const app = createCanvasRouter({ requirePermission: requirePermissionWith(), service: {}, librariesService })
    const response = await app.request('http://localhost/canvas/libraries/lib-1/items', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ name: 'x' }] }),
    })
    assert.equal(response.status, 201)
    assert.deepEqual(received, { companyId: 'company-1', actorId: 'user-1', libraryId: 'lib-1', items: [{ name: 'x' }], opts: { canManage: false } })
  })

  it('maps a CanvasServiceError to its own status', async () => {
    const librariesService = { remove: async () => { throw new (await import('../canvas-service.js')).CanvasServiceError('No encontrada.', 404) } }
    const app = createCanvasRouter({ requirePermission: requirePermissionWith(), service: {}, librariesService })
    const response = await app.request('http://localhost/canvas/libraries/lib-1', { method: 'DELETE' })
    assert.equal(response.status, 404)
  })
})
