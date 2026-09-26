// apps/api/src/routes/ledger/__tests__/collaboration-service.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createCollaborationService, CollaborationServiceError } from '../collaboration-service.js'

const COMPANY_ID = '01900000-0000-7000-8000-000000000001'
const ACTOR_ID   = '01900000-0000-7000-8000-000000000002'
const ACCOUNT_ID = '01900000-0000-7000-8000-000000000003'
const GROUP_ID   = '01900000-0000-7000-8000-000000000004'
const TARGET_ID  = '01900000-0000-7000-8000-000000000006'

/**
 * Inspect the raw SQL template-tag call.
 */
function sqlContains(strings, keyword) {
  const sql = Array.isArray(strings) ? strings.join('') : String(strings)
  return sql.toLowerCase().includes(keyword.toLowerCase())
}

/**
 * Build a prisma mock with replaceable $queryRaw.
 * Also provides Prisma-model stubs for createNotificationService.
 */
function buildPrismaMock(queryRawHandler) {
  return {
    $queryRaw: queryRawHandler,
    // Prisma model stubs for createNotificationService (non-fatal)
    userProfile: {
      findUnique: async () => null,
    },
    // Default: any invited user is treated as an active company member (assertCandidates,
    // called by inviteAccountMember before the SQL insert) so happy-path tests don't need
    // to separately stub it; tests that specifically exercise non-member rejection can
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

describe('collaboration-service', () => {
  it('inviteAccountMember throws 400 when account has group_id set', async () => {
    // getAccountOwned returns account with a group_id already set
    const accountRow = {
      id: ACCOUNT_ID,
      name: 'Cuenta Test',
      company_id: COMPANY_ID,
      owner_id: ACTOR_ID,
      group_id: GROUP_ID,
      enabled: true,
    }

    const prisma = buildPrismaMock(async (strings, ...values) => {
      if (sqlContains(strings, 'from ledger_account')) {
        return [accountRow]
      }
      return []
    })

    const service = createCollaborationService({ prisma })
    await assert.rejects(
      () => service.inviteAccountMember({
        companyId: COMPANY_ID,
        accountId: ACCOUNT_ID,
        actorId: ACTOR_ID,
        actorName: 'Test Actor',
        data: { user_id: TARGET_ID, role: 'viewer' },
      }),
      (err) => {
        assert.ok(err instanceof CollaborationServiceError, 'should be CollaborationServiceError')
        assert.equal(err.status, 400)
        return true
      },
    )
  })

  it('inviteAccountMember creates a pending membership, not an immediately active one', async () => {
    const accountRow = {
      id: ACCOUNT_ID,
      name: 'Cuenta Test',
      company_id: COMPANY_ID,
      owner_id: ACTOR_ID,
      group_id: null,
      enabled: true,
    }
    let insertStrings = null

    const prisma = buildPrismaMock(async (strings, ...values) => {
      if (sqlContains(strings, 'from ledger_account')) return [accountRow]
      if (sqlContains(strings, 'insert into ledger_account_member')) {
        insertStrings = strings
        return []
      }
      return []
    })

    const service = createCollaborationService({ prisma })
    await service.inviteAccountMember({
      companyId: COMPANY_ID,
      accountId: ACCOUNT_ID,
      actorId: ACTOR_ID,
      actorName: 'Test Actor',
      data: { user_id: TARGET_ID, role: 'viewer' },
    })

    assert.ok(insertStrings, 'expected an INSERT INTO ledger_account_member call')
    assert.ok(sqlContains(insertStrings, "'pending'"), 'a fresh invite must insert status pending')
    assert.ok(sqlContains(insertStrings, 'case when'), 'conflict update must preserve an already-active membership')
  })

  it('inviteAccountMember throws 400 when actor invites themselves', async () => {
    // Account is owned by actor and has no group_id
    const accountRow = {
      id: ACCOUNT_ID,
      name: 'Cuenta Test',
      company_id: COMPANY_ID,
      owner_id: ACTOR_ID,
      group_id: null,
      enabled: true,
    }

    const prisma = buildPrismaMock(async (strings, ...values) => {
      if (sqlContains(strings, 'from ledger_account')) {
        return [accountRow]
      }
      return []
    })

    const service = createCollaborationService({ prisma })
    await assert.rejects(
      () => service.inviteAccountMember({
        companyId: COMPANY_ID,
        accountId: ACCOUNT_ID,
        actorId: ACTOR_ID,
        actorName: 'Test Actor',
        // Invite yourself — user_id === actorId
        data: { user_id: ACTOR_ID, role: 'viewer' },
      }),
      (err) => {
        assert.ok(err instanceof CollaborationServiceError, 'should be CollaborationServiceError')
        assert.equal(err.status, 400)
        return true
      },
    )
  })

  it('leaveGroup returns { ok: true } when membership exists', async () => {
    const memberRow = {
      group_id: GROUP_ID,
      user_id: ACTOR_ID,
      role: 'viewer',
      status: 'active',
    }

    const prisma = buildPrismaMock(async (strings, ...values) => {
      if (sqlContains(strings, 'delete from ledger_group_member')) {
        return [memberRow]
      }
      return []
    })

    const service = createCollaborationService({ prisma })
    const result = await service.leaveGroup({
      companyId: COMPANY_ID,
      actorId: ACTOR_ID,
      groupId: GROUP_ID,
    })

    assert.deepEqual(result, { ok: true })
  })

  it('rejectGroupInvitation throws 404 when membership not found', async () => {
    const prisma = buildPrismaMock(async (strings, ...values) => {
      // UPDATE returns empty — no matching invitation row
      if (sqlContains(strings, 'update ledger_group_member')) {
        return []
      }
      return []
    })

    const service = createCollaborationService({ prisma })
    await assert.rejects(
      () => service.rejectGroupInvitation({
        companyId: COMPANY_ID,
        actorId: ACTOR_ID,
        groupId: GROUP_ID,
      }),
      (err) => {
        assert.ok(err instanceof CollaborationServiceError, 'should be CollaborationServiceError')
        assert.equal(err.status, 404)
        return true
      },
    )
  })

  it('acceptGroupInvitation activates a pending group membership', async () => {
    const memberRow = { group_id: GROUP_ID, user_id: ACTOR_ID, role: 'viewer', status: 'active' }
    const prisma = buildPrismaMock(async (strings) => {
      if (sqlContains(strings, 'update ledger_group_member')) return [memberRow]
      return []
    })
    const service = createCollaborationService({ prisma })
    const result = await service.acceptGroupInvitation({ companyId: COMPANY_ID, actorId: ACTOR_ID, groupId: GROUP_ID })
    assert.deepEqual(result, { ok: true })
  })

  it('acceptGroupInvitation throws 404 when there is no pending invitation', async () => {
    const prisma = buildPrismaMock(async (strings) => {
      if (sqlContains(strings, 'update ledger_group_member')) return []
      return []
    })
    const service = createCollaborationService({ prisma })
    await assert.rejects(
      () => service.acceptGroupInvitation({ companyId: COMPANY_ID, actorId: ACTOR_ID, groupId: GROUP_ID }),
      (err) => {
        assert.ok(err instanceof CollaborationServiceError)
        assert.equal(err.status, 404)
        return true
      },
    )
  })

  it('acceptAccountInvitation activates a pending account membership', async () => {
    const memberRow = { account_id: ACCOUNT_ID, user_id: ACTOR_ID, role: 'viewer', status: 'active' }
    const prisma = buildPrismaMock(async (strings) => {
      if (sqlContains(strings, 'update ledger_account_member')) return [memberRow]
      return []
    })
    const service = createCollaborationService({ prisma })
    const result = await service.acceptAccountInvitation({ companyId: COMPANY_ID, actorId: ACTOR_ID, accountId: ACCOUNT_ID })
    assert.deepEqual(result, { ok: true })
  })

  it('acceptAccountInvitation throws 404 when there is no pending invitation', async () => {
    const prisma = buildPrismaMock(async (strings) => {
      if (sqlContains(strings, 'update ledger_account_member')) return []
      return []
    })
    const service = createCollaborationService({ prisma })
    await assert.rejects(
      () => service.acceptAccountInvitation({ companyId: COMPANY_ID, actorId: ACTOR_ID, accountId: ACCOUNT_ID }),
      (err) => {
        assert.ok(err instanceof CollaborationServiceError)
        assert.equal(err.status, 404)
        return true
      },
    )
  })

  it('listMemberships includes pending memberships alongside active ones, with inviter name', async () => {
    const groupRow = {
      id: GROUP_ID, name: 'Grupo Test', role: 'viewer',
      invited_at: new Date(), status: 'pending', invited_by_name: 'Admin User', member_count: 3,
    }
    const accountRow = {
      id: ACCOUNT_ID, name: 'Cuenta Test', role: 'viewer',
      invited_at: new Date(), status: 'pending', invited_by_name: 'Admin User', owner_name: 'Owner',
    }
    let groupsSql = null
    let accountsSql = null
    const prisma = buildPrismaMock(async (strings) => {
      if (sqlContains(strings, 'from ledger_group_member gm')) {
        groupsSql = strings
        return [groupRow]
      }
      if (sqlContains(strings, 'from ledger_account_member am')) {
        accountsSql = strings
        return [accountRow]
      }
      return []
    })
    const service = createCollaborationService({ prisma })
    const result = await service.listMemberships({ companyId: COMPANY_ID, actorId: ACTOR_ID })

    assert.ok(groupsSql, 'expected the groups query to run')
    assert.ok(sqlContains(groupsSql, "in ('active', 'pending')"), 'groups query must include pending memberships')
    assert.ok(sqlContains(groupsSql, 'invited_by_name'), 'groups query must select the inviter name')
    assert.ok(accountsSql, 'expected the accounts query to run')
    assert.ok(sqlContains(accountsSql, "in ('active', 'pending')"), 'accounts query must include pending memberships')
    assert.ok(sqlContains(accountsSql, 'invited_by_name'), 'accounts query must select the inviter name')

    assert.equal(result.data.groups.length, 1)
    assert.equal(result.data.groups[0].status, 'pending')
    assert.equal(result.data.groups[0].invited_by_name, 'Admin User')
    assert.equal(result.data.accounts[0].status, 'pending')
  })
})
