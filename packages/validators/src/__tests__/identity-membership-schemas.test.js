import { test } from "node:test";
import assert from "node:assert/strict";
import { createMembershipSchema, updateMembershipSchema } from "../index.js";

test("createMembershipSchema requires a uuid companyId", () => {
  const fail = createMembershipSchema.safeParse({});
  assert.equal(fail.success, false);
  const ok = createMembershipSchema.safeParse({ companyId: "9c6f6b1e-0000-4000-8000-000000000000" });
  assert.equal(ok.success, true);
});

test("createMembershipSchema accepts an optional nullable roleId", () => {
  const withNull = createMembershipSchema.safeParse({
    companyId: "9c6f6b1e-0000-4000-8000-000000000000",
    roleId: null,
  });
  assert.equal(withNull.success, true);
  const withRole = createMembershipSchema.safeParse({
    companyId: "9c6f6b1e-0000-4000-8000-000000000000",
    roleId: "9c6f6b1e-0000-4000-8000-000000000001",
  });
  assert.equal(withRole.success, true);
});

test("createMembershipSchema rejects a non-uuid companyId", () => {
  const fail = createMembershipSchema.safeParse({ companyId: "not-a-uuid" });
  assert.equal(fail.success, false);
});

test("updateMembershipSchema accepts roleId only", () => {
  const ok = updateMembershipSchema.safeParse({ roleId: "9c6f6b1e-0000-4000-8000-000000000000" });
  assert.equal(ok.success, true);
});

test("updateMembershipSchema accepts enabled only", () => {
  const ok = updateMembershipSchema.safeParse({ enabled: false });
  assert.equal(ok.success, true);
});

test("updateMembershipSchema rejects an empty body (neither field present)", () => {
  const fail = updateMembershipSchema.safeParse({});
  assert.equal(fail.success, false);
});

test("updateMembershipSchema accepts a null roleId to clear the role", () => {
  const ok = updateMembershipSchema.safeParse({ roleId: null });
  assert.equal(ok.success, true);
});
