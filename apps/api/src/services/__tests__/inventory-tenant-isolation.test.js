// inventory-tenant-isolation.test.js
//
// Guards the 2026-08-30 hardening of atlas.inventory:
//   1. Every service method rejects a missing/blank companyId with a 400
//      BEFORE issuing any query (Prisma would drop a `companyId: undefined`
//      filter and leak every tenant otherwise).
//   2. assignItem / createCategory reject foreign-company FK references.
//   3. reorder* never writes a row that belongs to another company.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createInventoryService,
  InventoryServiceError,
} from "../inventory-service.js";

const COMPANY = "01900000-0000-7000-8000-000000000001";

function throwingPrisma(label = "prisma") {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(`${label} should not be touched`);
      },
    },
  );
}

describe("inventory-service — companyId is mandatory", () => {
  const svc = createInventoryService({
    prisma: throwingPrisma(),
    activityBridge: { logAndPublish: async () => {} },
  });

  const CALLS = {
    listItems: () => svc.listItems({ companyId: undefined }),
    getItem: () => svc.getItem("id", undefined),
    createItem: () => svc.createItem({}, undefined, "user"),
    updateItem: () => svc.updateItem("id", {}, undefined),
    deleteItem: () => svc.deleteItem("id", undefined),
    assignItem: () => svc.assignItem("id", "emp", "auth", null, undefined),
    returnItem: () => svc.returnItem("id", "by", null, undefined),
    getAssignmentHistory: () => svc.getAssignmentHistory("id", undefined),
    listAllAssignments: () => svc.listAllAssignments({ companyId: undefined }),
    getItemsByEmployee: () => svc.getItemsByEmployee("emp", undefined),
    listCategories: () => svc.listCategories(undefined),
    createCategory: () => svc.createCategory({ name: "x" }, undefined),
    updateCategory: () => svc.updateCategory("id", {}, undefined),
    deleteCategory: () => svc.deleteCategory("id", undefined),
    listBrands: () => svc.listBrands(undefined),
    createBrand: () => svc.createBrand({ name: "x" }, undefined),
    listLocations: () => svc.listLocations(undefined),
    listCustomFields: () => svc.listCustomFields(undefined),
    createCustomField: () => svc.createCustomField({ label: "x" }, undefined),
    reorderCategories: () => svc.reorderCategories(undefined, []),
    reorderBrands: () => svc.reorderBrands(undefined, []),
    listComments: () => svc.listComments("id", undefined),
    createComment: () => svc.createComment("id", "auth", "hi", undefined),
    updateComment: () => svc.updateComment("cid", "auth", "hi", undefined),
    deleteComment: () => svc.deleteComment("cid", "auth", undefined),
    listItemFiles: () => svc.listItemFiles("id", undefined),
    addItemFile: () => svc.addItemFile("id", "file", undefined, null),
    removeItemFile: () => svc.removeItemFile("id", "doc", undefined),
  };

  for (const [name, run] of Object.entries(CALLS)) {
    it(`${name} throws 400 and never queries when companyId is missing`, async () => {
      await assert.rejects(
        run,
        (err) => err instanceof InventoryServiceError && err.status === 400,
        `${name} must reject a missing companyId with InventoryServiceError(400)`,
      );
    });
  }
});

describe("inventory-service — cross-company FK references are rejected", () => {
  function prismaWithRefLookup({ refFound }) {
    const catalogModel = {
      findFirst: async () => (refFound ? { id: "ref" } : null),
      count: async () => 0,
      updateMany: async () => ({ count: 0 }),
      update: async (a) => ({ id: a.where.id }),
      create: async (a) => ({ id: "new", ...a.data }),
    };
    return {
      userProfile: { findFirst: async () => ({ id: "profile-1" }) },
      invItem: {
        count: async () => 0,
        create: async (a) => ({ id: "item-1", ...a.data }),
        findFirst: async () => ({ id: "item-1", companyId: COMPANY, status: "available", enabled: true }),
        update: async (a) => ({ id: a.where.id }),
      },
      invAssignment: { create: async () => ({ id: "a1" }), findFirst: async () => null, update: async () => ({}) },
      invCategory: catalogModel,
      invBrand: catalogModel,
      invLocation: catalogModel,
      invCustomField: catalogModel,
      hrEmployee: { findFirst: async () => (refFound ? { id: "emp" } : null) },
      $transaction: async (fn) => (typeof fn === "function" ? fn(this) : Promise.all(fn)),
    };
  }

  it("assignItem rejects an employee from another company", async () => {
    const svc = createInventoryService({
      prisma: prismaWithRefLookup({ refFound: false }),
      activityBridge: { logAndPublish: async () => {} },
    });
    await assert.rejects(
      () => svc.assignItem("item-1", "foreign-emp", "auth", null, COMPANY),
      (err) => err instanceof InventoryServiceError && err.status === 400,
    );
  });

  it("createCategory rejects a parentId from another company", async () => {
    const svc = createInventoryService({
      prisma: prismaWithRefLookup({ refFound: false }),
      activityBridge: { logAndPublish: async () => {} },
    });
    await assert.rejects(
      () => svc.createCategory({ name: "Sub", parentId: "foreign-cat" }, COMPANY),
      (err) => err instanceof InventoryServiceError && err.status === 400,
    );
  });
});

describe("inventory-service — reorder is company-scoped", () => {
  it("reorderCategories uses updateMany filtered by companyId", async () => {
    const seen = [];
    const prisma = {
      invCategory: {
        updateMany: async (args) => {
          seen.push(args.where);
          return { count: 1 };
        },
        update: async () => {
          throw new Error("reorder must use updateMany, not update");
        },
      },
      $transaction: async (ops) => Promise.all(ops),
    };
    const svc = createInventoryService({
      prisma,
      activityBridge: { logAndPublish: async () => {} },
    });
    await svc.reorderCategories(COMPANY, [
      { id: "a", sortOrder: 1 },
      { id: "b", sortOrder: 2 },
    ]);
    assert.equal(seen.length, 2);
    for (const where of seen) {
      assert.equal(where.companyId, COMPANY, "each reorder write must be company-scoped");
    }
  });
});
