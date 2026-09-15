import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createActivityBridge,
  getTranslator,
  registerTranslator,
} from "../activity-bridge.js";

const COMPANY_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000002";
const ENTITY_ID = "01900000-0000-7000-8000-000000000003";

function buildPrismaMock() {
  const audits = [];
  return {
    _audits: audits,
    auditLog: {
      create: async ({ data }) => {
        const row = {
          id: `audit-${audits.length}`,
          createdAt: new Date(),
          ...data,
        };
        audits.push(row);
        return row;
      },
    },
    userProfile: {
      findUnique: async () => ({
        id: USER_ID,
        displayName: "Ana López",
        firstName: "Ana",
        lastName: "López",
      }),
    },
  };
}

function buildActivityServiceMock() {
  const published = [];
  return {
    _published: published,
    publish: async (input) => {
      published.push(input);
      return { id: `act-${published.length}`, ...input };
    },
  };
}

describe("activity-bridge", () => {
  it("has translators registered for HR employee actions", () => {
    assert.ok(getTranslator("hr.employee.create"));
    assert.ok(getTranslator("hr.employee.update"));
    assert.ok(getTranslator("hr.employee.setEnabled"));
  });

  it("returns null for unknown action without hint", async () => {
    const prisma = buildPrismaMock();
    const activityService = buildActivityServiceMock();
    const bridge = createActivityBridge({ prisma, activityService });
    const result = await bridge.publishFromAudit({
      auditEntry: {
        actorId: USER_ID,
        action: "totally.unknown.action",
        entityType: null,
        entityId: null,
        before: null,
        after: null,
      },
      companyId: COMPANY_ID,
    });
    assert.equal(result, null);
    assert.equal(activityService._published.length, 0);
  });

  it("uses translator output for known action", async () => {
    const prisma = buildPrismaMock();
    const activityService = buildActivityServiceMock();
    const bridge = createActivityBridge({ prisma, activityService });
    await bridge.publishFromAudit({
      auditEntry: {
        actorId: USER_ID,
        action: "hr.employee.create",
        entityType: "HrEmployee",
        entityId: ENTITY_ID,
        before: null,
        after: { firstName: "Juan", lastName: "Pérez" },
      },
      companyId: COMPANY_ID,
    });
    assert.equal(activityService._published.length, 1);
    const a = activityService._published[0];
    assert.equal(a.type, "hr.employee.create");
    assert.equal(a.companyId, COMPANY_ID);
    assert.equal(a.source, "audit_bridge");
    assert.ok(a.summary.includes("Juan"));
    assert.ok(a.summary.includes("Pérez"));
  });

  it("hint overrides translator output", async () => {
    const prisma = buildPrismaMock();
    const activityService = buildActivityServiceMock();
    const bridge = createActivityBridge({ prisma, activityService });
    await bridge.publishFromAudit({
      auditEntry: {
        actorId: USER_ID,
        action: "hr.employee.create",
        entityId: ENTITY_ID,
        after: { firstName: "Juan" },
      },
      hint: { summary: "Override total", severity: "warning" },
      companyId: COMPANY_ID,
    });
    const a = activityService._published[0];
    assert.equal(a.summary, "Override total");
    assert.equal(a.severity, "warning");
  });

  it("logAndPublish writes AuditLog even when activity publish throws", async () => {
    const prisma = buildPrismaMock();
    const activityService = {
      publish: async () => {
        throw new Error("simulated failure");
      },
    };
    const bridge = createActivityBridge({ prisma, activityService });
    const result = await bridge.logAndPublish({
      auditEntry: {
        actorId: USER_ID,
        moduleKey: "atlas.hr",
        entityType: "HrEmployee",
        entityId: ENTITY_ID,
        action: "hr.employee.create",
        before: null,
        after: { firstName: "Juan" },
        metadata: { source: "api" },
      },
      companyId: COMPANY_ID,
    });
    assert.ok(result);
    assert.equal(prisma._audits.length, 1);
    assert.equal(prisma._audits[0].action, "hr.employee.create");
  });

  it("registerTranslator allows dynamic registration", () => {
    registerTranslator("test.custom.action", () => ({
      type: "test.custom.action",
      summary: "custom",
    }));
    assert.ok(getTranslator("test.custom.action"));
  });

  it("has translators registered for inventory item actions", () => {
    assert.ok(getTranslator("inventory.item.created"));
    assert.ok(getTranslator("inventory.item.updated"));
    assert.ok(getTranslator("inventory.item.assigned"));
    assert.ok(getTranslator("inventory.item.returned"));
    assert.ok(getTranslator("inventory.item.deleted"));
  });

  it("translates inventory.item.created into a real Spanish sentence with a link", async () => {
    const prisma = buildPrismaMock();
    const activityService = buildActivityServiceMock();
    const bridge = createActivityBridge({ prisma, activityService });
    await bridge.publishFromAudit({
      auditEntry: {
        actorId: USER_ID,
        action: "inventory.item.created",
        entityType: "InvItem",
        entityId: ENTITY_ID,
        after: { name: "Laptop XPS 15", assetTag: "INV-2026-0001" },
      },
      companyId: COMPANY_ID,
    });
    const a = activityService._published[0];
    assert.equal(a.type, "inventory.item.created");
    assert.ok(a.summary.includes("Laptop XPS 15"));
    assert.equal(a.link, `/app/m/runly.inventory/inventory/${ENTITY_ID}`);
    assert.equal(a.severity, "success");
  });

  it("translates inventory.item.deleted using the item name captured in after", async () => {
    const prisma = buildPrismaMock();
    const activityService = buildActivityServiceMock();
    const bridge = createActivityBridge({ prisma, activityService });
    await bridge.publishFromAudit({
      auditEntry: {
        actorId: USER_ID,
        action: "inventory.item.deleted",
        entityType: "InvItem",
        entityId: ENTITY_ID,
        after: { enabled: false, name: "Laptop XPS 15" },
      },
      companyId: COMPANY_ID,
    });
    const a = activityService._published[0];
    assert.ok(a.summary.includes("Laptop XPS 15"));
    assert.equal(a.severity, "warning");
  });
});
