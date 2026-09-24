// Opt-in cross-tenant security suite. Proves the isolation guarantees from
// docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md
// end-to-end: real HTTP requests (via Hono's app.request, in-process — no
// port bound) against the real app, real Prisma client, real live database.
//
// NEVER runs as part of a routine `node --test` sweep — it creates and
// destroys real rows in the shared self-hosted Supabase instance, so it only
// runs when explicitly requested:
//
//   RUN_CROSS_TENANT_TESTS=1 node --test apps/api/src/__tests__/cross-tenant/cross-tenant-security.test.js
//
// Without that variable set, every test in this file reports as SKIPPED
// (visible in output, not silently absent) rather than running.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { config as loadEnv } from "dotenv";

const RUN = process.env.RUN_CROSS_TENANT_TESTS === "1";

describe("cross-tenant security", { skip: !RUN && "set RUN_CROSS_TENANT_TESTS=1 to run against the live DB" }, () => {
  let app;
  let prisma;
  let pgPool;
  let fixture;
  let jwtSecret;
  let mintTestJwt;
  let createCrossTenantFixture;
  let destroyCrossTenantFixture;

  before(async () => {
    loadEnv();
    process.env.ATLAS_API_TEST_MODE = "1";

    const fixtures = await import("./fixtures.mjs");
    mintTestJwt = fixtures.mintTestJwt;
    createCrossTenantFixture = fixtures.createCrossTenantFixture;
    destroyCrossTenantFixture = fixtures.destroyCrossTenantFixture;

    jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) throw new Error("SUPABASE_JWT_SECRET not set in .env");

    const pkg = await import("@prisma/client");
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const pg = (await import("pg")).default;
    const { PrismaClient } = pkg;
    pgPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? process.env.DIRECT_URL,
    });
    prisma = new PrismaClient({ adapter: new PrismaPg(pgPool) });

    ({ app } = await import("../../index.js"));

    fixture = await createCrossTenantFixture(prisma);
  });

  after(async () => {
    if (prisma && fixture) await destroyCrossTenantFixture(prisma, fixture);
    if (prisma) await prisma.$disconnect();
    if (pgPool) await pgPool.end();
    // Importing the real app pulls in background workers, Supabase/LiveKit
    // clients, and other long-lived handles that never unref themselves —
    // correct for the real server, but it means this process would otherwise
    // hang indefinitely after the suite finishes instead of exiting. All
    // fixture cleanup above has already completed by this point.
    process.exit(0);
  });

  async function callApi({ authUserId, companyId, method = "GET", path, body }) {
    const headers = {};
    if (authUserId) headers.Authorization = `Bearer ${mintTestJwt(authUserId, jwtSecret)}`;
    if (companyId) headers["X-Runly-Company-Id"] = companyId;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await app.request(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, json };
  }

  it("User B (member only of Company B) cannot GET Company A's HR employee by known id", async () => {
    const { status } = await callApi({
      authUserId: fixture.userB.authUserId,
      path: `/hr/employees/${fixture.employeeA.id}`,
    });
    assert.equal(status, 404);
  });

  it("User B cannot PUT (update) Company A's HR employee by known id", async () => {
    const { status } = await callApi({
      authUserId: fixture.userB.authUserId,
      method: "PUT",
      path: `/hr/employees/${fixture.employeeA.id}`,
      body: { firstName: "Hacked" },
    });
    assert.equal(status, 404);
  });

  it("User B cannot disable Company A's HR employee by known id", async () => {
    const { status } = await callApi({
      authUserId: fixture.userB.authUserId,
      method: "PATCH",
      path: `/hr/employees/${fixture.employeeA.id}/enabled`,
      body: { enabled: false },
    });
    assert.equal(status, 404);
  });

  it("User B (member only of Company B) cannot GET Company A's file by known id", async () => {
    const { status } = await callApi({
      authUserId: fixture.userB.authUserId,
      path: `/files/${fixture.fileA.id}`,
    });
    assert.equal(status, 404);
  });

  it("User B cannot get a signed URL for Company A's file by known id", async () => {
    const { status } = await callApi({
      authUserId: fixture.userB.authUserId,
      path: `/files/${fixture.fileA.id}/signed-url`,
    });
    assert.equal(status, 404);
  });

  it("User AB, who legitimately holds files.assets.read in BOTH companies, still cannot see Company A's file with B active", async () => {
    // Same shape as the HR gap above, for files-service.js's
    // getUserCompanyContext / ensureFileBelongsToCompany.
    const { status } = await callApi({
      authUserId: fixture.userAB.authUserId,
      companyId: fixture.companyB.id,
      path: `/files/${fixture.fileA.id}`,
    });
    assert.equal(status, 404);
  });

  it("User B cannot DELETE Company A's user (User A) by known id", async () => {
    const { status } = await callApi({
      authUserId: fixture.userB.authUserId,
      method: "DELETE",
      path: `/identity/users/${fixture.userA.id}`,
    });
    assert.equal(status, 404);
  });

  it("User B cannot PATCH Company A's user (User A) by known id", async () => {
    const { status } = await callApi({
      authUserId: fixture.userB.authUserId,
      method: "PATCH",
      path: `/identity/users/${fixture.userA.id}`,
      body: { enabled: false },
    });
    assert.equal(status, 404);
  });

  it("rejects X-Runly-Company-Id for a company the caller is not a member of", async () => {
    const { status, json } = await callApi({
      authUserId: fixture.userB.authUserId,
      companyId: fixture.companyA.id,
      path: "/identity/users",
    });
    assert.equal(status, 403);
    assert.equal(json?.error, "company_not_member");
  });

  it("User AB (admin in A, no special permissions in B) IS admin when A is the active company", async () => {
    const { status } = await callApi({
      authUserId: fixture.userAB.authUserId,
      companyId: fixture.companyA.id,
      path: "/identity/users",
    });
    assert.equal(status, 200);
  });

  it("User AB is NOT admin when B is the active company — no permission leak from the A membership", async () => {
    // Regression test for the exact scenario the migration exists to fix:
    // admin in Company A, only a narrow hr.employee.read role in Company B —
    // activating B must never carry A's admin permissions (e.g. identity.users.read).
    const { status } = await callApi({
      authUserId: fixture.userAB.authUserId,
      companyId: fixture.companyB.id,
      path: "/identity/users",
    });
    assert.equal(status, 403);
  });

  it("User AB, who legitimately holds hr.employee.read in BOTH companies, still cannot see Company A's employee with B active", async () => {
    // This is the scenario the permission gate alone can't catch: userAB
    // isn't blocked by requirePermission("hr.employee.read") in either
    // company (they hold that permission in both, just via different
    // roles), so this exercises whatever the HR *service layer* itself does
    // with "the current company." The membership ordering in fixtures.mjs
    // deliberately creates User AB's Company A membership AFTER Company B's
    // — code that derives "the current company" via
    // membership.findFirst({ orderBy: { createdAt: "desc" } }) instead of
    // the validated X-Runly-Company-Id header would silently resolve to A
    // here even though this request explicitly activates B.
    const { status } = await callApi({
      authUserId: fixture.userAB.authUserId,
      companyId: fixture.companyB.id,
      path: `/hr/employees/${fixture.employeeA.id}`,
    });
    assert.equal(status, 404);
  });

  it("User A (admin, Company A active) cannot view permission-grants for User B, who is not a member of Company A", async () => {
    // loadUserGrantContext used to derive the TARGET user's own "most
    // admin-like" membership instead of scoping to the ACTOR's active
    // company — this proves the target is now resolved against the active
    // company, not any company the target happens to belong to.
    const { status } = await callApi({
      authUserId: fixture.userA.authUserId,
      companyId: fixture.companyA.id,
      path: `/identity/users/${fixture.userB.id}/permission-grants`,
    });
    assert.equal(status, 404);
  });

  it("User AB (admin in A, only hr/files reader in B) cannot GET permission-grants with B active", async () => {
    // The permission-grants route used to authorize off the raw
    // union-across-all-companies context (context.isAdmin/permissionSet),
    // so an admin in Company A could manage grants regardless of which
    // company was active. With the fix, admin rights from A must not leak
    // into a request scoped to B.
    const { status } = await callApi({
      authUserId: fixture.userAB.authUserId,
      companyId: fixture.companyB.id,
      path: `/identity/users/${fixture.userAB.id}/permission-grants`,
    });
    assert.equal(status, 403);
  });

  it("User AB (admin in A, only hr/files reader in B) cannot PUT permission-grants with B active", async () => {
    const { status } = await callApi({
      authUserId: fixture.userAB.authUserId,
      companyId: fixture.companyB.id,
      method: "PUT",
      path: `/identity/users/${fixture.userAB.id}/permission-grants`,
      body: { permissionKeys: ["hr.employee.read"] },
    });
    assert.equal(status, 403);
  });

  it("User A (admin, Company A active) CAN view permission-grants for a legitimate Company A peer", async () => {
    // Positive-path control: the hardening above must not have broken the
    // legitimate same-company case.
    const { status, json } = await callApi({
      authUserId: fixture.userA.authUserId,
      companyId: fixture.companyA.id,
      path: `/identity/users/${fixture.userAB.id}/permission-grants`,
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray(json?.data?.grantedKeys));
  });

  it("User A, a company-scoped runly.admin (NOT system.admin), CAN create a new company", async () => {
    // Regression control for a real design gap found 2026-09-11: POST
    // /companies was originally gated to system.admin only, which made it
    // unreachable for the common case of a single-company instance whose
    // owner account is a runly.admin (never system.admin — that role is
    // seeded separately and often held by nobody). fixture.userA is exactly
    // that shape: runly.admin in Company A only.
    let createdCompanyId;
    try {
      const { status, json } = await callApi({
        authUserId: fixture.userA.authUserId,
        companyId: fixture.companyA.id,
        method: "POST",
        path: "/companies",
        body: { name: "__cross_tenant_test__ Second Co" },
      });
      assert.equal(status, 201);
      createdCompanyId = json?.data?.id;
      assert.ok(createdCompanyId);

      const membership = await prisma.membership.findFirst({
        where: { companyId: createdCompanyId, userId: fixture.userA.id },
        select: { role: { select: { key: true } } },
      });
      assert.equal(membership?.role?.key, "runly.admin");
    } finally {
      if (createdCompanyId) {
        await prisma.membership.deleteMany({ where: { companyId: createdCompanyId } });
        await prisma.brandingConfig.deleteMany({ where: { companyId: createdCompanyId } });
        await prisma.company.deleteMany({ where: { id: createdCompanyId } });
      }
    }
  });

});
