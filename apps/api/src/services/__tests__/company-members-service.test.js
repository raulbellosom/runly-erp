import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompanyService, CompanyServiceError } from "../company-service.js";

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_COMPANY_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "33333333-3333-3333-3333-333333333333";
const MEMBERSHIP_ID = "44444444-4444-4444-4444-444444444444";
const ROLE_ID = "55555555-5555-5555-5555-555555555555";

const actorContext = { isSystemAdmin: false, canManageRoles: false, actingUserId: USER_ID };

function makePrisma(overrides = {}) {
  return {
    fileAsset: { findMany: async () => [], findUnique: async () => null },
    userProfile: { findUnique: async () => null, findMany: async () => [] },
    role: { findUnique: async () => null, findMany: async () => [] },
    membership: {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => ({ id: MEMBERSHIP_ID, companyId: COMPANY_ID, userId: USER_ID, roleId: null, enabled: true, role: null }),
      update: async () => ({}),
    },
    ...overrides,
  };
}

test("searchMemberCandidates rejects a query shorter than 2 characters", async () => {
  const service = createCompanyService({ prisma: makePrisma(), supabaseAdmin: {} });
  await assert.rejects(
    () => service.searchMemberCandidates("a", COMPANY_ID),
    (err) => err instanceof CompanyServiceError && err.status === 400,
  );
});

test("searchMemberCandidates excludes users already enabled in the active company", async () => {
  let capturedWhere = null;
  const prisma = makePrisma({
    userProfile: {
      findMany: async ({ where }) => {
        capturedWhere = where;
        return [];
      },
    },
  });
  const service = createCompanyService({ prisma, supabaseAdmin: {} });
  await service.searchMemberCandidates("jane", COMPANY_ID);
  assert.deepEqual(capturedWhere.NOT, { memberships: { some: { companyId: COMPANY_ID, enabled: true } } });
});

test("addMember rejects when the user already has an enabled membership", async () => {
  const prisma = makePrisma({
    userProfile: { findUnique: async () => ({ id: USER_ID, displayName: "Jane", email: "jane@x.com", avatarFileId: null }) },
    membership: {
      findMany: async () => [{ id: MEMBERSHIP_ID, companyId: COMPANY_ID, userId: USER_ID, roleId: null, enabled: true }],
      create: async () => { throw new Error("should not create"); },
      update: async () => { throw new Error("should not update"); },
    },
  });
  const service = createCompanyService({ prisma, supabaseAdmin: {} });
  await assert.rejects(
    () => service.addMember({ userId: USER_ID, roleId: null, actorContext }, COMPANY_ID),
    (err) => err instanceof CompanyServiceError && err.status === 400,
  );
});

test("addMember rejects a protected role without role-management rights", async () => {
  const prisma = makePrisma({
    userProfile: { findUnique: async () => ({ id: USER_ID, displayName: "Jane", email: "jane@x.com", avatarFileId: null }) },
    role: { findUnique: async () => ({ key: "runly.admin", companyId: COMPANY_ID }) },
  });
  const service = createCompanyService({ prisma, supabaseAdmin: {} });
  await assert.rejects(
    () => service.addMember({ userId: USER_ID, roleId: ROLE_ID, actorContext }, COMPANY_ID),
    (err) => err instanceof CompanyServiceError && err.status === 403,
  );
});

test("updateMember 404s when the membership belongs to a different company", async () => {
  const prisma = makePrisma({
    membership: {
      findMany: async () => [],
      findUnique: async () => ({ id: MEMBERSHIP_ID, companyId: OTHER_COMPANY_ID, userId: USER_ID, roleId: null, enabled: true }),
    },
  });
  const service = createCompanyService({ prisma, supabaseAdmin: {} });
  await assert.rejects(
    () => service.updateMember(MEMBERSHIP_ID, { enabled: false }, COMPANY_ID, actorContext),
    (err) => err instanceof CompanyServiceError && err.status === 404,
  );
});

test("updateMember blocks self-lockout when disabling your only enabled membership", async () => {
  const prisma = makePrisma({
    membership: {
      findMany: async () => [{ id: MEMBERSHIP_ID }],
      findUnique: async () => ({ id: MEMBERSHIP_ID, companyId: COMPANY_ID, userId: USER_ID, roleId: null, enabled: true }),
    },
  });
  const service = createCompanyService({ prisma, supabaseAdmin: {} });
  await assert.rejects(
    () => service.updateMember(MEMBERSHIP_ID, { enabled: false }, COMPANY_ID, actorContext),
    (err) => err instanceof CompanyServiceError && err.status === 400,
  );
});
