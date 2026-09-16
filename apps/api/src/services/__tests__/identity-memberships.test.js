import test from "node:test";
import assert from "node:assert/strict";
import {
  checkMembershipRoleScope,
  checkProtectedRoleAssignment,
  checkSelfLockout,
  findExistingMembership,
} from "../../lib/identity-memberships.js";

test("checkMembershipRoleScope allows a company-scoped role matching the membership's company", () => {
  const result = checkMembershipRoleScope({ roleCompanyId: "co-1", membershipCompanyId: "co-1" });
  assert.equal(result.ok, true);
});

test("checkMembershipRoleScope allows a system-wide role (companyId null) for any membership", () => {
  const result = checkMembershipRoleScope({ roleCompanyId: null, membershipCompanyId: "co-1" });
  assert.equal(result.ok, true);
});

test("checkMembershipRoleScope rejects a role scoped to a different company", () => {
  const result = checkMembershipRoleScope({ roleCompanyId: "co-2", membershipCompanyId: "co-1" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /no pertenece a esta empresa/);
});

test("checkMembershipRoleScope is a no-op when no role is being set (roleId omitted)", () => {
  const result = checkMembershipRoleScope({ roleCompanyId: undefined, membershipCompanyId: "co-1" });
  assert.equal(result.ok, true);
});

test("checkProtectedRoleAssignment allows a non-protected role regardless of actor permissions", () => {
  const result = checkProtectedRoleAssignment({
    roleKey: "sales.rep",
    protectedKeys: new Set(["runly.admin", "system.admin"]),
    actorCanManageRoles: false,
  });
  assert.equal(result.ok, true);
});

test("checkProtectedRoleAssignment rejects a protected role for an actor without identity.roles.update", () => {
  const result = checkProtectedRoleAssignment({
    roleKey: "runly.admin",
    protectedKeys: new Set(["runly.admin", "system.admin"]),
    actorCanManageRoles: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test("checkProtectedRoleAssignment allows a protected role for an actor with identity.roles.update", () => {
  const result = checkProtectedRoleAssignment({
    roleKey: "system.admin",
    protectedKeys: new Set(["runly.admin", "system.admin"]),
    actorCanManageRoles: true,
  });
  assert.equal(result.ok, true);
});

test("checkProtectedRoleAssignment is case-insensitive and trims the role key", () => {
  const result = checkProtectedRoleAssignment({
    roleKey: "  Runly.Admin  ",
    protectedKeys: new Set(["runly.admin"]),
    actorCanManageRoles: false,
  });
  assert.equal(result.ok, false);
});

test("checkSelfLockout allows disabling someone else's membership", () => {
  const result = checkSelfLockout({
    isActingOnSelf: false,
    enabledMembershipIds: ["m1", "m2"],
    membershipId: "m1",
    disabling: true,
  });
  assert.equal(result.ok, true);
});

test("checkSelfLockout allows disabling your own non-last membership", () => {
  const result = checkSelfLockout({
    isActingOnSelf: true,
    enabledMembershipIds: ["m1", "m2"],
    membershipId: "m1",
    disabling: true,
  });
  assert.equal(result.ok, true);
});

test("checkSelfLockout rejects disabling your own last enabled membership", () => {
  const result = checkSelfLockout({
    isActingOnSelf: true,
    enabledMembershipIds: ["m1"],
    membershipId: "m1",
    disabling: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /única empresa/);
});

test("checkSelfLockout is a no-op when the action does not disable the membership", () => {
  const result = checkSelfLockout({
    isActingOnSelf: true,
    enabledMembershipIds: ["m1"],
    membershipId: "m1",
    disabling: false,
  });
  assert.equal(result.ok, true);
});

test("findExistingMembership finds a membership for the given company, enabled or not", () => {
  const memberships = [
    { id: "m1", companyId: "co-1", enabled: false },
    { id: "m2", companyId: "co-2", enabled: true },
  ];
  assert.equal(findExistingMembership({ memberships, companyId: "co-1" })?.id, "m1");
  assert.equal(findExistingMembership({ memberships, companyId: "co-2" })?.id, "m2");
});

test("findExistingMembership returns null when the user has no membership for that company", () => {
  const memberships = [{ id: "m1", companyId: "co-1", enabled: true }];
  assert.equal(findExistingMembership({ memberships, companyId: "co-9" }), null);
});
