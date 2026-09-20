// apps/api/src/routes/inventory/__tests__/router.test.js
//
// Smoke test for the router extracted from index.js on 2026-08-30: the same
// paths resolve, each is gated by the expected permission, and the service
// method is invoked with the company from context (never the body).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInventoryRouter } from "../index.js";

class InventoryServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}
class CommentsServiceError extends Error {}

const COMPANY = "01900000-0000-7000-8000-000000000001";

// requirePermission stub: records the key, injects companyId/userId like the real one.
function makeRequirePermission(calls) {
  return (key) => async (c, next) => {
    calls.push(key);
    c.set("companyId", COMPANY);
    c.set("userId", "user-1");
    c.set("authUserId", "auth-1");
    await next();
  };
}

function buildRouter() {
  const calls = [];
  const serviceCalls = [];
  const handler = (name) => async (...args) => {
    serviceCalls.push({ name, args });
    return { ok: true, name };
  };
  const inventoryService = new Proxy(
    {},
    { get: (_t, name) => handler(String(name)) },
  );
  const router = createInventoryRouter({
    prisma: { membership: { findMany: async () => [] } },
    requirePermission: makeRequirePermission(calls),
    inventoryService,
    InventoryServiceError,
    inventoryNotifSvc: { notifyInvComment() {}, notifyInvReaction() {} },
    commentsService: {
      listComments: handler('listComments'),
      createComment: async () => ({ mentions: [] }),
      updateComment: handler('updateComment'),
      deleteComment: handler('deleteComment'),
      toggleReaction: handler('toggleReaction'),
    },
    CommentsServiceError,
    enrichFilesWithSignedUrls: async (x) => x,
  });
  return { router, calls, serviceCalls };
}

describe("inventory router — path + permission wiring", () => {
  for (const [method, suffix, name, expected] of [
    ['GET', '', 'listComments', ['InvItem', 'item-a', COMPANY, 'user-1']],
    ['PATCH', '/comment-a', 'updateComment', ['comment-a', 'auth-1', 'text', COMPANY, 'item-a']],
    ['DELETE', '/comment-a', 'deleteComment', ['comment-a', 'auth-1', COMPANY, 'item-a']],
    ['POST', '/comment-a/reactions', 'toggleReaction', ['comment-a', 'auth-1', 'ok', COMPANY, 'item-a']],
  ]) {
    it(`${name} receives the authorized company and parent item`, async () => {
      const { router, serviceCalls } = buildRouter();
      const response = await router.request(`/inventory/items/item-a/comments${suffix}`, {
        method, headers: { 'content-type': 'application/json' },
        ...(['POST', 'PATCH'].includes(method) ? { body: JSON.stringify({ body: 'text', emoji: 'ok', companyId: 'foreign' }) } : {}),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(serviceCalls.find((entry) => entry.name === name)?.args, expected);
    });
  }

  const cases = [
    ["GET", "/inventory/items", "inventory.item.read", "listItems"],
    ["POST", "/inventory/items", "inventory.item.create", "createItem"],
    ["GET", "/inventory/items/abc", "inventory.item.read", "getItem"],
    ["PUT", "/inventory/items/abc", "inventory.item.update", "updateItem"],
    ["DELETE", "/inventory/items/abc", "inventory.item.delete", "deleteItem"],
    ["POST", "/inventory/items/abc/assign", "inventory.assignment.manage", "assignItem"],
    ["POST", "/inventory/items/abc/return", "inventory.assignment.manage", "returnItem"],
    ["GET", "/inventory/items/abc/assignments", "inventory.assignment.read", "getAssignmentHistory"],
    ["GET", "/inventory/items/by-employee/e1", "inventory.assignment.read", "getItemsByEmployee"],
    ["GET", "/inventory/items/abc/files", "inventory.item.read", "listItemFiles"],
    ["GET", "/inventory/assignments", "inventory.assignment.read", "listAllAssignments"],
    ["GET", "/inventory/categories", "inventory.catalog.read", "listCategories"],
    ["POST", "/inventory/categories", "inventory.catalog.manage", "createCategory"],
    ["PUT", "/inventory/categories/c1", "inventory.catalog.manage", "updateCategory"],
    ["DELETE", "/inventory/categories/c1", "inventory.catalog.manage", "deleteCategory"],
    ["PATCH", "/inventory/categories/reorder", "inventory.catalog.manage", "reorderCategories"],
    ["GET", "/inventory/brands", "inventory.catalog.read", "listBrands"],
    ["GET", "/inventory/locations", "inventory.catalog.read", "listLocations"],
    ["GET", "/inventory/custom-fields", "inventory.catalog.read", "listCustomFields"],
    ["POST", "/inventory/custom-fields", "inventory.customfield.manage", "createCustomField"],
    ["PATCH", "/inventory/custom-fields/reorder", "inventory.customfield.manage", "reorderCustomFields"],
  ];

  for (const [method, path, expectedPerm, expectedFn] of cases) {
    it(`${method} ${path} → ${expectedPerm} → ${expectedFn}()`, async () => {
      const { router, calls, serviceCalls } = buildRouter();
      const res = await router.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: ["POST", "PUT", "PATCH"].includes(method) ? "{}" : undefined,
      });
      assert.notEqual(res.status, 404, `${method} ${path} should resolve`);
      assert.ok(calls.includes(expectedPerm), `expected permission ${expectedPerm}, saw ${calls.join(",")}`);
      assert.ok(
        serviceCalls.some((s) => s.name === expectedFn),
        `expected inventoryService.${expectedFn} to be called, saw ${serviceCalls.map((s) => s.name).join(",")}`,
      );
    });
  }

  it("createItem receives companyId from context, not the request body", async () => {
    const { router, serviceCalls } = buildRouter();
    await router.request("/inventory/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "X", companyId: "ATTACKER-COMPANY" }),
    });
    const call = serviceCalls.find((s) => s.name === "createItem");
    assert.ok(call);
    // createItem(data, companyId, authUserId)
    assert.equal(call.args[1], COMPANY);
  });
});
