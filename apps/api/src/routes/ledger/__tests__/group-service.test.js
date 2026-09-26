// apps/api/src/routes/ledger/__tests__/group-service.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createGroupService, GroupServiceError } from '../group-service.js'

const COMPANY_ID = '01900000-0000-7000-8000-000000000001'
const ACTOR_ID   = '01900000-0000-7000-8000-000000000002'
const GROUP_ID   = '01900000-0000-7000-8000-000000000003'
const TARGET_ID  = '01900000-0000-7000-8000-000000000004'
const OTHER_ID   = '01900000-0000-7000-8000-000000000005'

/**
 * Inspect the raw SQL template-tag call.
 * Prisma's $queryRaw is called as a tagged template literal, so the first
 * argument is the TemplateStringsArray and the rest are the interpolated values.
 * We stringify the first element of the strings array to detect keywords.
 */
function sqlContains(strings, keyword) {
  const sql = Array.isArray(strings) ? strings.join('') : String(strings)
  return sql.toLowerCase().includes(keyword.toLowerCase())
}

/**
 * Build a prisma mock whose $queryRaw handler is replaced per test.
 * Also provide the Prisma-model stubs needed by createNotificationService.
 */
function buildPrismaMock(queryRawHandler) {
  return {
    $queryRaw: queryRawHandler,
    // Prisma model stubs for createNotificationService (non-fatal, .catch(() => {}))
    userProfile: {
      findUnique: async () => null,
    },
    // Default: any invited user is treated as an active company member (assertCandidates,
    // called by inviteMember before the SQL insert) so happy-path tests don't need to
    // separately stub it; tests that specifically exercise non-member rejection can
    // override this per-call.
    membership: {
      findFirst: async () => ({ id: 'membership-1', companyId: COMPANY_ID, enabled: true, role: null }),
      findMany: async () => [],
    },
    notification: {
      findFirst: async () => null,
      findMany: async () => [],
      create: async (args) => ({ id: 'notif-1', ...args?.data }),
      update: async (args) => ({ id: args?.where?.id }),
      updateMany: async () => ({ count: 0 }),
    },
    notificationDelivery: {
      createMany: async () => ({ count: 0 }),
    },
    notificationPreference: {
      findMany: async () => [],
      upsert: async ({ create, update }) => ({ ...create, ...update }),
    },
    pushSubscription: {
      upsert: async ({ create, update }) => ({ ...create, ...update }),
      findFirst: async () => null,
      delete: async () => ({ id: 'deleted' }),
    },
    $transaction: async (fn) => fn({
      notification: {
        findFirst: async () => null,
        create: async (args) => ({ id: 'notif-tx', ...args?.data }),
      },
      notificationDelivery: {
        createMany: async () => ({ count: 0 }),
      },
    }),
  }
}

describe('group-service', () => {
  it('createGroup inserts group and auto-adds creator as admin member', async () => {
    const groupRow = {
      id: GROUP_ID,
      name: 'Grupo Test',
      company_id: COMPANY_ID,
      created_by: ACTOR_ID,
      enabled: true,
    }

    const prisma = buildPrismaMock(async (strings, ...values) => {
      if (sqlContains(strings, 'insert into ledger_group')) {
        return [groupRow]
      }
      return []
    })

    const service = createGroupService({ prisma })
    const result = await service.createGroup({
      companyId: COMPANY_ID,
      actorId: ACTOR_ID,
      data: { name: 'Grupo Test' },
    })

    assert.equal(result.id, GROUP_ID)
    assert.equal(result.name, 'Grupo Test')
    assert.equal(result.created_by, ACTOR_ID)
  })

  it('inviteMember allows admin to invite and publishes notification', async () => {
    // requireGroupAccess: returns group row with actor as active admin member
    const groupRow = {
      id: GROUP_ID,
      name: 'Grupo Test',
      company_id: COMPANY_ID,
      created_by: OTHER_ID,
      role: 'admin',
      status: 'active',
    }

    const prisma = buildPrismaMock(async (strings, ...values) => {
      // requireGroupAccess SELECT
      if (sqlContains(strings, 'from ledger_group g')) {
        return [groupRow]
      }
      // getActorDisplayName
      if (sqlContains(strings, 'display_name')) {
        return [{ display_name: 'Test Actor' }]
      }
      // INSERT INTO ledger_group_member
      if (sqlContains(strings, 'insert into ledger_group_member')) {
        return []
      }
      return []
    })

    const service = createGroupService({ prisma })
    const result = await service.inviteMember({
      companyId: COMPANY_ID,
      groupId: GROUP_ID,
      actorId: ACTOR_ID,
      actorName: 'Test Actor',
      data: { user_id: TARGET_ID, role: 'viewer' },
    })

    assert.deepEqual(result, { ok: true })
  })

  it('inviteMember creates a pending membership, not an immediately active one', async () => {
    const groupRow = {
      id: GROUP_ID,
      name: 'Grupo Test',
      company_id: COMPANY_ID,
      created_by: OTHER_ID,
      role: 'admin',
      status: 'active',
    }
    let insertStrings = null

    const prisma = buildPrismaMock(async (strings, ...values) => {
      if (sqlContains(strings, 'from ledger_group g')) return [groupRow]
      if (sqlContains(strings, 'display_name')) return [{ display_name: 'Test Actor' }]
      if (sqlContains(strings, 'insert into ledger_group_member')) {
        insertStrings = strings
        return []
      }
      return []
    })

    const service = createGroupService({ prisma })
    await service.inviteMember({
      companyId: COMPANY_ID,
      groupId: GROUP_ID,
      actorId: ACTOR_ID,
      actorName: 'Test Actor',
      data: { user_id: TARGET_ID, role: 'viewer' },
    })

    assert.ok(insertStrings, 'expected an INSERT INTO ledger_group_member call')
    assert.ok(sqlContains(insertStrings, "'pending'"), 'a fresh invite must insert status pending')
    assert.ok(sqlContains(insertStrings, 'case when'), 'conflict update must preserve an already-active membership')
  })

  it('requireGroupAccess throws 403 when actor is not a member and not creator', async () => {
    // Group exists but actor is not creator and has no active membership
    const groupRow = {
      id: GROUP_ID,
      name: 'Grupo Test',
      company_id: COMPANY_ID,
      created_by: OTHER_ID,
      role: null,
      status: null,
    }

    const prisma = buildPrismaMock(async (strings, ...values) => {
      if (sqlContains(strings, 'from ledger_group g')) {
        return [groupRow]
      }
      return []
    })

    const service = createGroupService({ prisma })
    await assert.rejects(
      () => service.getGroup({ companyId: COMPANY_ID, groupId: GROUP_ID, actorId: ACTOR_ID }),
      (err) => {
        assert.ok(err instanceof GroupServiceError, 'should be GroupServiceError')
        assert.equal(err.status, 403)
        return true
      },
    )
  })

  it('deleteGroup throws 403 when actor is not the creator', async () => {
    // Actor has admin role and active status, but is not the creator
    const groupRow = {
      id: GROUP_ID,
      name: 'Grupo Test',
      company_id: COMPANY_ID,
      created_by: OTHER_ID,
      role: 'admin',
      status: 'active',
    }

    const prisma = buildPrismaMock(async (strings, ...values) => {
      if (sqlContains(strings, 'from ledger_group g')) {
        return [groupRow]
      }
      return []
    })

    const service = createGroupService({ prisma })
    await assert.rejects(
      () => service.deleteGroup({ companyId: COMPANY_ID, groupId: GROUP_ID, actorId: ACTOR_ID }),
      (err) => {
        assert.ok(err instanceof GroupServiceError, 'should be GroupServiceError')
        assert.equal(err.status, 403)
        return true
      },
    )
  })

  it('updateGroup throws 403 when actor has viewer role', async () => {
    // Actor is a viewer, not the creator — minRole: admin check should fail
    const groupRow = {
      id: GROUP_ID,
      name: 'Grupo Test',
      company_id: COMPANY_ID,
      created_by: OTHER_ID,
      role: 'viewer',
      status: 'active',
    }

    const prisma = buildPrismaMock(async (strings, ...values) => {
      if (sqlContains(strings, 'from ledger_group g')) {
        return [groupRow]
      }
      return []
    })

    const service = createGroupService({ prisma })
    await assert.rejects(
      () => service.updateGroup({
        companyId: COMPANY_ID,
        groupId: GROUP_ID,
        actorId: ACTOR_ID,
        data: { name: 'Nuevo Nombre' },
      }),
      (err) => {
        assert.ok(err instanceof GroupServiceError, 'should be GroupServiceError')
        assert.equal(err.status, 403)
        return true
      },
    )
  })
})
