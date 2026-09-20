import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createActivityService,
  ActivityServiceError,
} from "../activity-service.js";

const COMPANY_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000002";
const ENTITY_ID = "01900000-0000-7000-8000-000000000003";

function buildPrismaMock(overrides = {}) {
  const created = [];
  return {
    _created: created,
    activity: {
      findFirst: async () => null,
      create: async ({ data }) => {
        const row = {
          id: `mock-${created.length}`,
          createdAt: new Date(),
          ...data,
        };
        created.push(row);
        return row;
      },
      count: async () => created.length,
      findMany: async () => created,
      ...(overrides.activity ?? {}),
    },
    userProfile: {
      findUnique: async () => ({ id: USER_ID }),
      ...(overrides.userProfile ?? {}),
    },
    membership: {
      findFirst: async () => ({ companyId: COMPANY_ID }),
      ...(overrides.membership ?? {}),
    },
  };
}

describe("activity-service", () => {
  it("publishes a valid activity and assigns explicit source by default", async () => {
    const prisma = buildPrismaMock();
    const svc = createActivityService({ prisma });
    const result = await svc.publish({
      type: "test.event",
      summary: "Prueba",
      companyId: COMPANY_ID,
    });
    assert.ok(result);
    assert.equal(result.source, "explicit");
    assert.equal(result.severity, "info");
    assert.equal(prisma._created.length, 1);
  });

  it("requires companyId to publish", async () => {
    const prisma = buildPrismaMock();
    const svc = createActivityService({ prisma });
    await assert.rejects(
      () => svc.publish({ type: "x", summary: "y" }),
      (err) =>
        err instanceof ActivityServiceError && err.code === "company_required",
    );
  });

  it("rejects payload larger than 4KB", async () => {
    const prisma = buildPrismaMock();
    const svc = createActivityService({ prisma });
    const big = "x".repeat(5000);
    await assert.rejects(
      () =>
        svc.publish({
          type: "test.event",
          summary: "Prueba",
          companyId: COMPANY_ID,
          payload: { big },
        }),
      (err) => err?.name === "ZodError",
    );
  });

  it("dedupes identical publishes within 2s window", async () => {
    const prisma = buildPrismaMock({
      activity: { findFirst: async () => ({ id: "existing" }) },
    });
    const svc = createActivityService({ prisma });
    const result = await svc.publish({
      type: "test.event",
      summary: "Prueba",
      companyId: COMPANY_ID,
    });
    assert.equal(result, null);
  });

  it("marks source=audit_bridge when explicitly set", async () => {
    const prisma = buildPrismaMock();
    const svc = createActivityService({ prisma });
    const result = await svc.publish({
      type: "hr.employee.update",
      summary: "X actualizó Y",
      companyId: COMPANY_ID,
      source: "audit_bridge",
    });
    assert.equal(result.source, "audit_bridge");
  });

  it("listForEntity filters by entityType + entityId", async () => {
    let receivedWhere = null;
    const prisma = buildPrismaMock({
      activity: {
        findMany: async ({ where }) => {
          receivedWhere = where;
          return [];
        },
      },
    });
    const svc = createActivityService({ prisma });
    await svc.listForEntity({
      authUserId: "auth-1",
      companyId: COMPANY_ID,
      entityType: "HrEmployee",
      entityId: ENTITY_ID,
    });
    assert.equal(receivedWhere.companyId, COMPANY_ID);
    assert.equal(receivedWhere.entityType, "HrEmployee");
    assert.equal(receivedWhere.entityId, ENTITY_ID);
  });
});
