import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveActiveMembership,
  computeScopedPermissions,
  isSystemAdminMembership,
  TENANT_ERROR,
  COMPANY_ADMIN_ROLE_KEYS,
  SYSTEM_ADMIN_ROLE_KEYS,
} from "../tenant-context.js";

function membership({ companyId, roleKey, permissions = [], companyEnabled = true }) {
  return {
    companyId,
    company: { id: companyId, enabled: companyEnabled },
    role: {
      key: roleKey,
      permissions: permissions.map((key) => ({ permission: { key } })),
    },
  };
}

describe("resolveActiveMembership", () => {
  it("auto-activates the only membership when no header is sent", () => {
    const m = membership({ companyId: "A", roleKey: "viewer" });
    const result = resolveActiveMembership({ memberships: [m], requestedCompanyId: null });
    assert.equal(result.ok, true);
    assert.equal(result.membership.companyId, "A");
  });

  it("returns membership: null (not an error) for a user with zero memberships", () => {
    const result = resolveActiveMembership({ memberships: [], requestedCompanyId: null });
    assert.equal(result.ok, true);
    assert.equal(result.membership, null);
  });

  it("strict mode: 400 company_required when multiple memberships and no header", () => {
    const a = membership({ companyId: "A", roleKey: "viewer" });
    const b = membership({ companyId: "B", roleKey: "viewer" });
    const result = resolveActiveMembership({ memberships: [a, b], requestedCompanyId: null });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.code, TENANT_ERROR.COMPANY_REQUIRED);
  });

  it("non-strict mode: resolves to membership: null instead of erroring when ambiguous", () => {
    const a = membership({ companyId: "A", roleKey: "viewer" });
    const b = membership({ companyId: "B", roleKey: "viewer" });
    const result = resolveActiveMembership({
      memberships: [a, b],
      requestedCompanyId: null,
      strict: false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.membership, null);
  });

  it("activates the requested company when the header matches an enabled membership", () => {
    const a = membership({ companyId: "A", roleKey: "runly.admin" });
    const b = membership({ companyId: "B", roleKey: "viewer" });
    const result = resolveActiveMembership({ memberships: [a, b], requestedCompanyId: "B" });
    assert.equal(result.ok, true);
    assert.equal(result.membership.companyId, "B");
  });

  it("403 company_not_member when the header names a company the user is not in", () => {
    const a = membership({ companyId: "A", roleKey: "viewer" });
    const result = resolveActiveMembership({ memberships: [a], requestedCompanyId: "ghost" });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(result.code, TENANT_ERROR.NOT_MEMBER);
  });

  it("403 when the header matches a companyId but that company is disabled", () => {
    const a = membership({ companyId: "A", roleKey: "viewer", companyEnabled: false });
    const result = resolveActiveMembership({ memberships: [a], requestedCompanyId: "A" });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(result.code, TENANT_ERROR.NOT_MEMBER);
  });
});

describe("computeScopedPermissions", () => {
  it("scopes permissions to ONLY the active membership's role — no cross-company union", () => {
    // Regression test for the exact bug this migration fixes: admin in Company A,
    // viewer in Company B — activating B must not carry A's admin permissions.
    const activeMembership = membership({
      companyId: "B",
      roleKey: "viewer",
      permissions: ["hr.employee.read"],
    });
    const { permissionSet, isCompanyAdmin } = computeScopedPermissions({
      activeMembership,
      grantKeysForCompany: [],
      allPermissionKeys: ["hr.employee.read", "hr.employee.delete", "finance.close.period"],
      basePermissionKeys: ["profile.self.read"],
      isSystemAdmin: false,
    });
    assert.equal(isCompanyAdmin, false);
    assert.deepEqual(
      [...permissionSet].sort(),
      ["hr.employee.read", "profile.self.read"],
    );
  });

  it("company admin gets every provided permission key, scoped to the active company only", () => {
    const activeMembership = membership({ companyId: "A", roleKey: "runly.admin", permissions: [] });
    const { permissionSet, isCompanyAdmin } = computeScopedPermissions({
      activeMembership,
      grantKeysForCompany: [],
      allPermissionKeys: ["hr.employee.read", "hr.employee.delete"],
      basePermissionKeys: ["profile.self.read"],
      isSystemAdmin: false,
    });
    assert.equal(isCompanyAdmin, true);
    assert.deepEqual(
      [...permissionSet].sort(),
      ["hr.employee.delete", "hr.employee.read", "profile.self.read"],
    );
  });

  it("merges per-company UserPermissionGrant keys additively", () => {
    const activeMembership = membership({ companyId: "A", roleKey: "viewer", permissions: [] });
    const { permissionSet } = computeScopedPermissions({
      activeMembership,
      grantKeysForCompany: ["finance.export.run"],
      allPermissionKeys: [],
      basePermissionKeys: [],
      isSystemAdmin: false,
    });
    assert.ok(permissionSet.has("finance.export.run"));
  });

  it("with no active membership, returns only the base permission keys", () => {
    const { permissionSet, isCompanyAdmin } = computeScopedPermissions({
      activeMembership: null,
      grantKeysForCompany: [],
      allPermissionKeys: ["hr.employee.read"],
      basePermissionKeys: ["profile.self.read"],
      isSystemAdmin: false,
    });
    assert.equal(isCompanyAdmin, false);
    assert.deepEqual([...permissionSet], ["profile.self.read"]);
  });
});

describe("isSystemAdminMembership", () => {
  it("is true if ANY membership has the system.admin role, regardless of active company", () => {
    const a = membership({ companyId: "A", roleKey: "viewer" });
    const b = membership({ companyId: "B", roleKey: "system.admin" });
    assert.equal(isSystemAdminMembership([a, b]), true);
  });

  it("is false when no membership has system.admin", () => {
    const a = membership({ companyId: "A", roleKey: "runly.admin" });
    assert.equal(isSystemAdminMembership([a]), false);
  });
});

describe("role key sets", () => {
  it("runly.admin is a company-admin key, not a system-admin key", () => {
    assert.equal(COMPANY_ADMIN_ROLE_KEYS.has("runly.admin"), true);
    assert.equal(SYSTEM_ADMIN_ROLE_KEYS.has("runly.admin"), false);
  });
  it("system.admin is a system-admin key, not a company-admin key", () => {
    assert.equal(SYSTEM_ADMIN_ROLE_KEYS.has("system.admin"), true);
    assert.equal(COMPANY_ADMIN_ROLE_KEYS.has("system.admin"), false);
  });
});
