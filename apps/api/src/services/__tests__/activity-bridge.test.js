import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createActivityBridge,
  getTranslator,
  registerTranslator,
  computeFieldChanges,
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

  it("has translators registered for fleet vehicle actions", () => {
    assert.ok(getTranslator("fleet.vehicle.create"));
    assert.ok(getTranslator("fleet.vehicle.update"));
    assert.ok(getTranslator("fleet.vehicle.disable"));
    assert.ok(getTranslator("fleet.vehicle.document.add"));
    assert.ok(getTranslator("fleet.vehicle.document.remove"));
  });

  it("translates fleet.vehicle.update into a real Spanish sentence with a diff", async () => {
    const prisma = buildPrismaMock();
    const activityService = buildActivityServiceMock();
    const bridge = createActivityBridge({ prisma, activityService });
    await bridge.publishFromAudit({
      auditEntry: {
        actorId: USER_ID,
        action: "fleet.vehicle.update",
        entityType: "Vehicle",
        entityId: ENTITY_ID,
        before: { plate: "PVR-8109", color: "Rojo" },
        after: { plate: "PVR-8109", color: "Azul" },
      },
      companyId: COMPANY_ID,
    });
    const a = activityService._published[0];
    assert.equal(a.type, "fleet.vehicle.update");
    assert.ok(a.summary.includes("PVR-8109"));
    assert.equal(a.link, `/app/m/runly.fleet/vehicles/${ENTITY_ID}`);
    assert.deepEqual(a.payload.changes, [
      { field: "color", oldValue: "Rojo", newValue: "Azul" },
    ]);
  });

  it("translates fleet.vehicle.disable differently for disabling vs re-enabling", async () => {
    const prisma = buildPrismaMock();
    const activityService = buildActivityServiceMock();
    const bridge = createActivityBridge({ prisma, activityService });
    await bridge.publishFromAudit({
      auditEntry: {
        actorId: USER_ID,
        action: "fleet.vehicle.disable",
        entityType: "Vehicle",
        entityId: ENTITY_ID,
        after: { plate: "PVR-8109" },
        metadata: { enabled: false },
      },
      companyId: COMPANY_ID,
    });
    const a = activityService._published[0];
    assert.ok(a.summary.includes("dio de baja"));
    assert.equal(a.severity, "warning");
  });

  it("computeFieldChanges returns [] when nothing differs", () => {
    const changes = computeFieldChanges(
      { name: "Laptop", purchasePrice: 100 },
      { name: "Laptop", purchasePrice: 100 },
    );
    assert.deepEqual(changes, []);
  });

  it("computeFieldChanges reports only fields whose value differs", () => {
    const changes = computeFieldChanges(
      { name: "Laptop", purchasePrice: 100, model: "XPS" },
      { name: "Laptop", purchasePrice: 150, model: "XPS" },
    );
    assert.deepEqual(changes, [
      { field: "purchasePrice", oldValue: 100, newValue: 150 },
    ]);
  });

  it("computeFieldChanges excludes id/companyId/createdAt/updatedAt/enabled", () => {
    const changes = computeFieldChanges(
      { id: "a", companyId: "c1", createdAt: "t1", updatedAt: "t1", enabled: true, name: "X" },
      { id: "a", companyId: "c1", createdAt: "t1", updatedAt: "t2", enabled: false, name: "Y" },
    );
    assert.deepEqual(changes, [{ field: "name", oldValue: "X", newValue: "Y" }]);
  });

  it("computeFieldChanges treats null and undefined as equal to each other", () => {
    const changes = computeFieldChanges({ notes: null }, { notes: undefined });
    assert.deepEqual(changes, []);
  });

  it("computeFieldChanges reports null -> value and value -> null", () => {
    const changes = computeFieldChanges({ brandName: null }, { brandName: "Asus" });
    assert.deepEqual(changes, [{ field: "brandName", oldValue: null, newValue: "Asus" }]);
  });

  it("computeFieldChanges returns [] when before or after is missing", () => {
    assert.deepEqual(computeFieldChanges(null, { name: "X" }), []);
    assert.deepEqual(computeFieldChanges({ name: "X" }, null), []);
    assert.deepEqual(computeFieldChanges(null, null), []);
  });

  it("publishFromAudit attaches payload.changes when before/after are full snapshots", async () => {
    const prisma = buildPrismaMock();
    const activityService = buildActivityServiceMock();
    const bridge = createActivityBridge({ prisma, activityService });
    await bridge.publishFromAudit({
      auditEntry: {
        actorId: USER_ID,
        action: "inventory.item.updated",
        entityType: "InvItem",
        entityId: ENTITY_ID,
        before: { name: "Laptop", purchasePrice: 100 },
        after: { name: "Laptop", purchasePrice: 150 },
      },
      companyId: COMPANY_ID,
    });
    const a = activityService._published[0];
    assert.deepEqual(a.payload.changes, [
      { field: "purchasePrice", oldValue: 100, newValue: 150 },
    ]);
  });

  it("publishFromAudit omits payload when before/after produce no changes", async () => {
    const prisma = buildPrismaMock();
    const activityService = buildActivityServiceMock();
    const bridge = createActivityBridge({ prisma, activityService });
    await bridge.publishFromAudit({
      auditEntry: {
        actorId: USER_ID,
        action: "inventory.item.updated",
        entityType: "InvItem",
        entityId: ENTITY_ID,
        before: { name: "Laptop" },
        after: { name: "Laptop" },
      },
      companyId: COMPANY_ID,
    });
    const a = activityService._published[0];
    assert.equal(a.payload, undefined);
  });
});
