// inventory-service.test.js — unit tests for atlas.inventory business logic
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createInventoryService, InventoryServiceError } from '../inventory-service.js'

const COMPANY_ID  = '01900000-0000-7000-8000-000000000001'
const USER_ID     = '01900000-0000-7000-8000-000000000002'
const ITEM_ID     = '01900000-0000-7000-8000-000000000003'
const EMPLOYEE_ID = '01900000-0000-7000-8000-000000000004'
const COMMENT_ID  = '01900000-0000-7000-8000-000000000005'

// ---------------------------------------------------------------------------
// Prisma mock builder
// ---------------------------------------------------------------------------

function buildPrismaMock(overrides = {}) {
  // Default tx proxy — mirrors the top-level stubs
  const makeTx = (extra = {}) => ({
    invItem: {
      create: async (args) => ({ id: ITEM_ID, ...args.data }),
      findFirst: async () => ({ id: ITEM_ID }),
      update: async (args) => ({ id: args.where.id, ...args.data }),
    },
    invAssignment: {
      create: async (args) => ({ id: 'assign-1', ...args.data }),
      findFirst: async () => null,
      update: async (args) => ({ id: args.where.id, ...args.data }),
    },
    invCustomFieldValue: {
      create: async (args) => ({ ...args.data }),
    },
    invComment: {
      create: async (args) => ({
        id: COMMENT_ID,
        ...args.data,
        author: { id: USER_ID, firstName: 'Test', lastName: 'User', avatarFileId: null },
      }),
    },
    invMention: {
      create: async (args) => ({ ...args.data }),
    },
    ...extra,
  })

  return {
    userProfile: {
      findFirst: async () => ({ id: USER_ID }),
      ...(overrides.userProfile ?? {}),
    },
    // Catalog / FK-scope stubs used by assertRefInCompany + delete-in-use guards.
    invCategory: {
      findFirst: async () => ({ id: 'cat-1' }),
      updateMany: async () => ({ count: 1 }),
      update: async (args) => ({ id: args.where.id, ...args.data }),
      ...(overrides.invCategory ?? {}),
    },
    invBrand: {
      findFirst: async () => ({ id: 'brand-1' }),
      updateMany: async () => ({ count: 1 }),
      update: async (args) => ({ id: args.where.id, ...args.data }),
      ...(overrides.invBrand ?? {}),
    },
    invLocation: {
      findFirst: async () => ({ id: 'loc-1' }),
      updateMany: async () => ({ count: 1 }),
      update: async (args) => ({ id: args.where.id, ...args.data }),
      ...(overrides.invLocation ?? {}),
    },
    invCustomField: {
      findFirst: async () => ({ id: 'cf-1' }),
      updateMany: async () => ({ count: 1 }),
      update: async (args) => ({ id: args.where.id, ...args.data }),
      ...(overrides.invCustomField ?? {}),
    },
    hrEmployee: {
      findFirst: async () => ({ id: EMPLOYEE_ID }),
      ...(overrides.hrEmployee ?? {}),
    },
    invItem: {
      count: async () => 5,
      create: async (args) => ({ id: ITEM_ID, ...args.data }),
      findFirst: async () => null,
      findMany: async () => [],
      update: async (args) => ({ id: args.where.id, ...args.data }),
      ...(overrides.invItem ?? {}),
    },
    invAssignment: {
      create: async (args) => ({ id: 'assign-1', ...args.data }),
      findFirst: async () => null,
      update: async (args) => ({ id: args.where.id, ...args.data }),
      ...(overrides.invAssignment ?? {}),
    },
    invCommentReaction: {
      findUnique: async () => null,
      create: async (args) => ({ ...args.data }),
      delete: async (args) => ({ ...args.where }),
      ...(overrides.invCommentReaction ?? {}),
    },
    invComment: {
      create: async (args) => ({
        id: COMMENT_ID,
        ...args.data,
        author: { id: USER_ID, firstName: 'Test', lastName: 'User', avatarFileId: null },
      }),
      ...(overrides.invComment ?? {}),
    },
    invMention: {
      create: async (args) => ({ ...args.data }),
      ...(overrides.invMention ?? {}),
    },
    invItemFile: {
      findFirst: async () => null,
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      ...(overrides.invItemFile ?? {}),
    },
    $transaction: async (fnOrArray) =>
      Array.isArray(fnOrArray) ? Promise.all(fnOrArray) : fnOrArray(makeTx(overrides._tx ?? {})),
    ...(overrides._root ?? {}),
  }
}

// ---------------------------------------------------------------------------
// createItem
// ---------------------------------------------------------------------------

describe('createItem', () => {
  it('auto-generates assetTag when none provided', async () => {
    let capturedData = null
    const prisma = buildPrismaMock({
      invItem: {
        count: async () => 7,
        create: async (args) => { capturedData = args.data; return { id: ITEM_ID, ...args.data } },
        findFirst: async () => null,
      },
    })
    const svc = createInventoryService({ prisma })
    await svc.createItem({ name: 'Laptop Test' }, COMPANY_ID, USER_ID)

    const year = new Date().getFullYear()
    assert.ok(capturedData, 'create was called')
    assert.match(capturedData.assetTag, new RegExp(`^INV-${year}-\\d{4}$`))
    assert.equal(capturedData.assetTag, `INV-${year}-0008`)
  })

  it('uses provided assetTag when given', async () => {
    let capturedData = null
    const prisma = buildPrismaMock({
      invItem: {
        count: async () => 0,
        create: async (args) => { capturedData = args.data; return { id: ITEM_ID, ...args.data } },
      },
    })
    const svc = createInventoryService({ prisma })
    await svc.createItem({ name: 'Server', assetTag: 'SRV-001' }, COMPANY_ID, USER_ID)

    assert.equal(capturedData.assetTag, 'SRV-001')
  })

  it('retries on P2002 asset_tag collision then succeeds', async () => {
    let attempts = 0
    // count increments on each call so the retry generates a different tag
    let countVal = 3
    const prisma = buildPrismaMock({
      invItem: {
        count: async () => countVal++,
        create: async (args) => {
          attempts++
          if (attempts === 1) {
            const err = new Error('Unique constraint failed')
            err.code = 'P2002'
            err.meta = { target: ['asset_tag'] }
            throw err
          }
          return { id: ITEM_ID, ...args.data }
        },
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.createItem({ name: 'Switch' }, COMPANY_ID, USER_ID)

    assert.equal(attempts, 2, 'create was retried once')
    assert.ok(result, 'returned an item')
  })

  it('throws 409 (re-throws P2002) after max retries exceeded', async () => {
    let attempts = 0
    const prisma = buildPrismaMock({
      invItem: {
        count: async () => 10,
        create: async () => {
          attempts++
          const err = new Error('Unique constraint')
          err.code = 'P2002'
          err.meta = { target: ['asset_tag'] }
          throw err
        },
      },
    })
    const svc = createInventoryService({ prisma })

    await assert.rejects(
      () => svc.createItem({ name: 'Router' }, COMPANY_ID, USER_ID),
      (err) => {
        assert.equal(err.code, 'P2002')
        return true
      },
    )
    // 1 initial + 5 retries = 6 total attempts
    assert.equal(attempts, 6)
  })
})

// ---------------------------------------------------------------------------
// assignItem
// ---------------------------------------------------------------------------

describe('assignItem', () => {
  it('assigns an available item successfully', async () => {
    let txCalled = false
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, status: 'available', enabled: true }),
      },
      _tx: {
        invItem: {
          update: async (args) => ({ id: args.where.id, status: 'assigned', ...args.data }),
        },
        invAssignment: {
          create: async (args) => { txCalled = true; return { id: 'assign-1', ...args.data } },
        },
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.assignItem(ITEM_ID, EMPLOYEE_ID, USER_ID, 'test note', COMPANY_ID)

    assert.ok(txCalled, '$transaction was called')
    assert.ok(result.item, 'result has item')
    assert.ok(result.assignment, 'result has assignment')
  })

  it('throws 404 if item not found', async () => {
    const prisma = buildPrismaMock({
      invItem: { findFirst: async () => null },
    })
    const svc = createInventoryService({ prisma })

    await assert.rejects(
      () => svc.assignItem(ITEM_ID, EMPLOYEE_ID, USER_ID, null, COMPANY_ID),
      (err) => {
        assert.ok(err instanceof InventoryServiceError)
        assert.equal(err.status, 404)
        return true
      },
    )
  })

  it('throws 409 if item status is already assigned', async () => {
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, status: 'assigned', enabled: true }),
      },
    })
    const svc = createInventoryService({ prisma })

    await assert.rejects(
      () => svc.assignItem(ITEM_ID, EMPLOYEE_ID, USER_ID, null, COMPANY_ID),
      (err) => {
        assert.ok(err instanceof InventoryServiceError)
        assert.equal(err.status, 409)
        return true
      },
    )
  })
})

// ---------------------------------------------------------------------------
// returnItem
// ---------------------------------------------------------------------------

describe('returnItem', () => {
  it('returns an assigned item successfully', async () => {
    let assignmentUpdated = false
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, status: 'assigned', enabled: true }),
      },
      _tx: {
        invAssignment: {
          findFirst: async () => ({ id: 'assign-1', returnedAt: null }),
          update: async (args) => { assignmentUpdated = true; return { id: args.where.id, ...args.data } },
        },
        invItem: {
          update: async (args) => ({ id: args.where.id, status: 'available', ...args.data }),
        },
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.returnItem(ITEM_ID, USER_ID, null, COMPANY_ID)

    assert.ok(result, 'returned updated item')
    assert.ok(assignmentUpdated, 'active assignment was closed')
  })

  it('throws 404 if item not found', async () => {
    const prisma = buildPrismaMock({
      invItem: { findFirst: async () => null },
    })
    const svc = createInventoryService({ prisma })

    await assert.rejects(
      () => svc.returnItem(ITEM_ID, USER_ID, null, COMPANY_ID),
      (err) => {
        assert.ok(err instanceof InventoryServiceError)
        assert.equal(err.status, 404)
        return true
      },
    )
  })

  it('throws 409 if item is not assigned', async () => {
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, status: 'available', enabled: true }),
      },
    })
    const svc = createInventoryService({ prisma })

    await assert.rejects(
      () => svc.returnItem(ITEM_ID, USER_ID, null, COMPANY_ID),
      (err) => {
        assert.ok(err instanceof InventoryServiceError)
        assert.equal(err.status, 409)
        return true
      },
    )
  })
})

// ---------------------------------------------------------------------------
// toggleReaction
// ---------------------------------------------------------------------------

describe('toggleReaction', () => {
  it('adds reaction when it does not exist', async () => {
    const prisma = buildPrismaMock({
      invCommentReaction: {
        findUnique: async () => null,
        create: async () => ({ commentId: COMMENT_ID, userId: USER_ID, emoji: '👍' }),
        delete: async () => {},
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.toggleReaction(COMMENT_ID, USER_ID, '👍')

    assert.equal(result.action, 'added')
  })

  it('removes reaction when it already exists', async () => {
    let deleteCalled = false
    const prisma = buildPrismaMock({
      invCommentReaction: {
        findUnique: async () => ({ commentId: COMMENT_ID, userId: USER_ID, emoji: '👍' }),
        delete: async () => { deleteCalled = true },
        create: async () => { throw new Error('should not create') },
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.toggleReaction(COMMENT_ID, USER_ID, '👍')

    assert.equal(result.action, 'removed')
    assert.ok(deleteCalled, 'delete was called')
  })
})

// ---------------------------------------------------------------------------
// createComment
// ---------------------------------------------------------------------------

describe('createComment', () => {
  it('creates a comment successfully', async () => {
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, enabled: true }),
      },
      _root: {
        userProfile: { findFirst: async () => ({ id: USER_ID }) },
      },
      _tx: {
        invComment: {
          create: async (args) => ({
            id: COMMENT_ID,
            ...args.data,
            author: { id: USER_ID, firstName: 'Test', lastName: 'User', avatarFileId: null },
          }),
        },
        invMention: {
          create: async () => ({}),
        },
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.createComment(ITEM_ID, USER_ID, 'Hello world', COMPANY_ID)

    const { comment } = result
    assert.equal(comment.body, 'Hello world')
    assert.ok(comment.author, 'author is included')
  })

  it('parses @mentions from body and creates InvMention rows', async () => {
    const mentionedId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const mentionedId2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
    const mentionsCaptured = []

    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, enabled: true }),
      },
      _root: {
        userProfile: { findFirst: async () => ({ id: USER_ID }) },
      },
      _tx: {
        invComment: {
          create: async (args) => ({
            id: COMMENT_ID,
            ...args.data,
            author: { id: USER_ID, firstName: 'Test', lastName: 'User', avatarFileId: null },
          }),
        },
        invMention: {
          create: async (args) => { mentionsCaptured.push(args.data.userId); return {} },
        },
      },
    })
    const svc = createInventoryService({ prisma })
    const body = `Hello @[${mentionedId}:Juan Perez] and @[${mentionedId2}:Ana Lopez]`
    await svc.createComment(ITEM_ID, USER_ID, body, COMPANY_ID)

    assert.equal(mentionsCaptured.length, 2)
    assert.ok(mentionsCaptured.includes(mentionedId))
    assert.ok(mentionsCaptured.includes(mentionedId2))
  })

  it('ignores P2002/P2003 errors when creating mentions', async () => {
    const mentionedId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, enabled: true }),
      },
      _root: {
        userProfile: { findFirst: async () => ({ id: USER_ID }) },
      },
      _tx: {
        invComment: {
          create: async (args) => ({
            id: COMMENT_ID,
            ...args.data,
            author: { id: USER_ID, firstName: 'Test', lastName: 'User', avatarFileId: null },
          }),
        },
        invMention: {
          create: async () => {
            const err = new Error('Foreign key constraint')
            err.code = 'P2003'
            throw err
          },
        },
      },
    })
    const svc = createInventoryService({ prisma })
    const body = `@[${mentionedId}:Someone]`
    // Should resolve without throwing despite mention P2003
    const result = await svc.createComment(ITEM_ID, USER_ID, body, COMPANY_ID)
    assert.ok(result, 'comment was created despite mention error')
  })

  it('throws 404 when item does not exist', async () => {
    const prisma = buildPrismaMock({
      invItem: { findFirst: async () => null },
      _root: {
        userProfile: { findFirst: async () => ({ id: USER_ID }) },
      },
    })
    const svc = createInventoryService({ prisma })

    await assert.rejects(
      () => svc.createComment(ITEM_ID, USER_ID, 'Hello', COMPANY_ID),
      (err) => {
        assert.ok(err instanceof InventoryServiceError)
        assert.equal(err.status, 404)
        return true
      },
    )
  })

  it('throws 400 when body is empty', async () => {
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, enabled: true }),
      },
      _root: {
        userProfile: { findFirst: async () => ({ id: USER_ID }) },
      },
    })
    const svc = createInventoryService({ prisma })

    await assert.rejects(
      () => svc.createComment(ITEM_ID, USER_ID, '   ', COMPANY_ID),
      (err) => {
        assert.ok(err instanceof InventoryServiceError)
        assert.equal(err.status, 400)
        return true
      },
    )
  })
})

// ---------------------------------------------------------------------------
// createComment return shape
// ---------------------------------------------------------------------------

describe('createComment return shape', () => {
  const COMMENT_ID = '01900000-0000-7000-8000-000000000005'
  const USER_ID    = '01900000-0000-7000-8000-000000000002'
  const ITEM_ID    = '01900000-0000-7000-8000-000000000003'
  const COMPANY_ID = '01900000-0000-7000-8000-000000000001'

  it('returns { comment, mentionIds } with empty mentionIds when body has no mentions', async () => {
    const prisma = buildPrismaMock({
      invItem: { findFirst: async () => ({ id: ITEM_ID }) },
      _root: { userProfile: { findFirst: async () => ({ id: USER_ID }) } },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.createComment(ITEM_ID, 'auth-user-id', 'plain comment', COMPANY_ID)

    assert.ok(result.comment, 'has comment property')
    assert.deepEqual(result.mentionIds, [], 'mentionIds is empty array')
    assert.equal(result.comment.id, COMMENT_ID)
  })

  it('returns mentionIds extracted from comment body', async () => {
    const MENTION_ID = '01900000-0000-7000-8000-000000000099'
    const prisma = buildPrismaMock({
      invItem: { findFirst: async () => ({ id: ITEM_ID }) },
      _root: { userProfile: { findFirst: async () => ({ id: USER_ID }) } },
    })
    const svc = createInventoryService({ prisma })
    const body = `Hello @[${MENTION_ID}:Someone]`
    const result = await svc.createComment(ITEM_ID, 'auth-user-id', body, COMPANY_ID)

    assert.ok(result.comment, 'has comment property')
    assert.deepEqual(result.mentionIds, [MENTION_ID])
  })
})

// ---------------------------------------------------------------------------
// getItem
// ---------------------------------------------------------------------------

describe('getItem', () => {
  it('computes categoryName/brandName/locationName/assignedToName like listItems does', async () => {
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({
          id: ITEM_ID,
          companyId: COMPANY_ID,
          enabled: true,
          category: { id: 'cat-1', name: 'Laptops' },
          brand: { id: 'brand-1', name: 'Dell' },
          location: { id: 'loc-1', name: 'Oficina Centro' },
          assignedTo: { id: EMPLOYEE_ID, firstName: 'Ana', lastName: 'Lopez' },
        }),
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.getItem(ITEM_ID, COMPANY_ID)
    assert.equal(result.categoryName, 'Laptops')
    assert.equal(result.brandName, 'Dell')
    assert.equal(result.locationName, 'Oficina Centro')
    assert.equal(result.assignedToName, 'Ana Lopez')
  })

  it('flat fields are null when relations are missing', async () => {
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({
          id: ITEM_ID,
          companyId: COMPANY_ID,
          enabled: true,
          category: null,
          brand: null,
          location: null,
          assignedTo: null,
        }),
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.getItem(ITEM_ID, COMPANY_ID)
    assert.equal(result.categoryName, null)
    assert.equal(result.brandName, null)
    assert.equal(result.locationName, null)
    assert.equal(result.assignedToName, null)
  })

  it('throws 404 if item not found', async () => {
    const prisma = buildPrismaMock({ invItem: { findFirst: async () => null } })
    const svc = createInventoryService({ prisma })
    await assert.rejects(
      () => svc.getItem(ITEM_ID, COMPANY_ID),
      (err) => {
        assert.ok(err instanceof InventoryServiceError)
        assert.equal(err.status, 404)
        return true
      },
    )
  })

  it('coverImageFileId resolves to the file marked isCover', async () => {
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({
          id: ITEM_ID,
          companyId: COMPANY_ID,
          enabled: true,
          category: null, brand: null, location: null, assignedTo: null,
        }),
      },
      invItemFile: {
        findMany: async () => [
          { id: 'f1', fileAssetId: 'asset-1', isCover: false, sortOrder: 0, createdAt: new Date('2026-01-01'), fileAsset: { mimeType: 'image/png' } },
          { id: 'f2', fileAssetId: 'asset-2', isCover: true, sortOrder: 1, createdAt: new Date('2026-01-02'), fileAsset: { mimeType: 'image/png' } },
        ],
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.getItem(ITEM_ID, COMPANY_ID)
    assert.equal(result.coverImageFileId, 'asset-2')
  })

  it('coverImageFileId falls back to the earliest image when nothing is marked cover', async () => {
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({
          id: ITEM_ID, companyId: COMPANY_ID, enabled: true,
          category: null, brand: null, location: null, assignedTo: null,
        }),
      },
      invItemFile: {
        findMany: async () => [
          { id: 'f1', fileAssetId: 'pdf-1', isCover: false, sortOrder: 0, createdAt: new Date('2026-01-01'), fileAsset: { mimeType: 'application/pdf' } },
          { id: 'f2', fileAssetId: 'asset-2', isCover: false, sortOrder: 1, createdAt: new Date('2026-01-02'), fileAsset: { mimeType: 'image/png' } },
        ],
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.getItem(ITEM_ID, COMPANY_ID)
    assert.equal(result.coverImageFileId, 'asset-2')
  })

  it('coverImageFileId is null when the item has no image attachments', async () => {
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({
          id: ITEM_ID, companyId: COMPANY_ID, enabled: true,
          category: null, brand: null, location: null, assignedTo: null,
        }),
      },
      invItemFile: { findMany: async () => [] },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.getItem(ITEM_ID, COMPANY_ID)
    assert.equal(result.coverImageFileId, null)
  })
})

// ---------------------------------------------------------------------------
// deleteItem
// ---------------------------------------------------------------------------

describe('deleteItem', () => {
  it('soft-disables the item and logs an inventory.item.deleted audit entry with the item name', async () => {
    let capturedAudit = null
    const prisma = buildPrismaMock({
      invItem: {
        findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, enabled: true, name: 'Laptop XPS' }),
        update: async (args) => ({ id: args.where.id, enabled: false, name: 'Laptop XPS' }),
      },
    })
    const activityBridge = {
      logAndPublish: async (args) => { capturedAudit = args },
    }
    const svc = createInventoryService({ prisma, activityBridge })
    const result = await svc.deleteItem(ITEM_ID, COMPANY_ID)

    assert.equal(result.enabled, false)
    assert.ok(capturedAudit, 'logAndPublish was called')
    assert.equal(capturedAudit.auditEntry.action, 'inventory.item.deleted')
    assert.equal(capturedAudit.auditEntry.entityId, ITEM_ID)
    assert.equal(capturedAudit.auditEntry.entityType, 'InvItem')
    assert.equal(capturedAudit.auditEntry.after.name, 'Laptop XPS')
    assert.equal(capturedAudit.companyId, COMPANY_ID)
  })

  it('throws 404 if item not found', async () => {
    const prisma = buildPrismaMock({ invItem: { findFirst: async () => null } })
    const svc = createInventoryService({ prisma })
    await assert.rejects(
      () => svc.deleteItem(ITEM_ID, COMPANY_ID),
      (err) => {
        assert.ok(err instanceof InventoryServiceError)
        assert.equal(err.status, 404)
        return true
      },
    )
  })
})

// ---------------------------------------------------------------------------
// setItemFileCover / reorderItemFiles
// ---------------------------------------------------------------------------

describe('setItemFileCover', () => {
  it('marks the target file as cover and clears any other cover on the same item', async () => {
    let updateManyArgs = null
    let updateArgs = null
    const prisma = buildPrismaMock({
      invItem: { findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, enabled: true }) },
      _tx: {
        invItemFile: {
          findFirst: async () => ({ id: 'file-1', itemId: ITEM_ID }),
          updateMany: async (args) => { updateManyArgs = args; return { count: 2 } },
          update: async (args) => { updateArgs = args; return { id: args.where.id, isCover: true } },
        },
      },
    })
    const svc = createInventoryService({ prisma })
    const result = await svc.setItemFileCover(ITEM_ID, 'file-1', COMPANY_ID)

    assert.equal(result.isCover, true)
    assert.deepEqual(updateManyArgs.where, { itemId: ITEM_ID })
    assert.deepEqual(updateManyArgs.data, { isCover: false })
    assert.equal(updateArgs.where.id, 'file-1')
    assert.equal(updateArgs.data.isCover, true)
  })

  it('throws 404 if the item does not belong to the company', async () => {
    const prisma = buildPrismaMock({ invItem: { findFirst: async () => null } })
    const svc = createInventoryService({ prisma })
    await assert.rejects(
      () => svc.setItemFileCover(ITEM_ID, 'file-1', COMPANY_ID),
      (err) => { assert.ok(err instanceof InventoryServiceError); assert.equal(err.status, 404); return true },
    )
  })

  it('throws 404 if the file association does not belong to the item', async () => {
    const prisma = buildPrismaMock({
      invItem: { findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, enabled: true }) },
      _tx: { invItemFile: { findFirst: async () => null } },
    })
    const svc = createInventoryService({ prisma })
    await assert.rejects(
      () => svc.setItemFileCover(ITEM_ID, 'file-1', COMPANY_ID),
      (err) => { assert.ok(err instanceof InventoryServiceError); assert.equal(err.status, 404); return true },
    )
  })
})

describe('reorderItemFiles', () => {
  it('scopes each updateMany by itemId, not companyId', async () => {
    const calls = []
    const prisma = buildPrismaMock({
      invItem: { findFirst: async () => ({ id: ITEM_ID, companyId: COMPANY_ID, enabled: true }) },
      invItemFile: {
        updateMany: async (args) => { calls.push(args); return { count: 1 } },
      },
    })
    const svc = createInventoryService({ prisma })
    await svc.reorderItemFiles(ITEM_ID, COMPANY_ID, [
      { id: 'file-1', sortOrder: 0 },
      { id: 'file-2', sortOrder: 1 },
    ])

    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0].where, { id: 'file-1', itemId: ITEM_ID })
    assert.deepEqual(calls[0].data, { sortOrder: 0 })
    assert.deepEqual(calls[1].where, { id: 'file-2', itemId: ITEM_ID })
  })

  it('throws 404 if the item does not belong to the company', async () => {
    const prisma = buildPrismaMock({ invItem: { findFirst: async () => null } })
    const svc = createInventoryService({ prisma })
    await assert.rejects(
      () => svc.reorderItemFiles(ITEM_ID, COMPANY_ID, [{ id: 'file-1', sortOrder: 0 }]),
      (err) => { assert.ok(err instanceof InventoryServiceError); assert.equal(err.status, 404); return true },
    )
  })
})
