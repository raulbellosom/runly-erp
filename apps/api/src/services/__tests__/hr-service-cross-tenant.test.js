import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHrService } from '../hr-service.js'

describe('assertUserLinkEligibility (via createEmployee) — company scoping', () => {
  it('scopes the employee-link conflict check to the active company', async () => {
    // Regression test for the exact bug the schema audit found: the pre-fix
    // query had no companyId filter at all, so a UserProfile already linked
    // as an employee in ANY company blocked linking in every other company —
    // even though HrEmployee.userProfileId is now unique PER COMPANY, not
    // globally (see the 20260911000000_multi_tenant_schema_hardening
    // migration).
    let capturedLinkedWhere = null
    const prisma = {
      userProfile: {
        findUnique: async () => ({ id: 'profile-1' }),
      },
      membership: {
        findFirst: async () => ({ id: 'm1', companyId: 'company-b' }),
      },
      hrEmployee: {
        findFirst: async (args) => {
          capturedLinkedWhere = args.where
          return null // no conflict within Company B
        },
        create: async ({ data }) => ({ id: 'emp-1', ...data }),
      },
      auditLog: { create: async () => ({}) },
    }
    const service = createHrService({
      prisma,
      activityBridge: { logAndPublish: async () => {} },
    })

    await service.createEmployee({
      authUserId: 'auth-1',
      companyId: 'company-b',
      payload: {
        firstName: 'Ana',
        lastName: 'Lopez',
        userProfileId: '11111111-1111-4111-8111-111111111111',
      },
    })

    assert.ok(capturedLinkedWhere, 'expected the conflict check to run')
    assert.equal(capturedLinkedWhere.companyId, 'company-b')
    assert.equal(capturedLinkedWhere.userProfileId, '11111111-1111-4111-8111-111111111111')
  })
})
