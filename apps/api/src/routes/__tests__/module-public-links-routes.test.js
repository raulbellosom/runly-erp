import { test } from "node:test";
import assert from "node:assert/strict";
import { createModulePublicLinksRoutes } from "../module-public-links-routes.js";

function setup(granted) {
  const checked = [];
  const requirePermission = (key) => async (c, next) => {
    checked.push(key);
    if (!granted.includes(key)) return c.json({ error: "denied" }, 403);
    c.set("companyId", "c1");
    c.set("userId", "u1");
    return next();
  };
  const linksService = {
    async resolveResource() { return { resource: { key: "encuesta.responder", managePermission: "encuestas.encuesta.update" } }; },
    async create({ input }) { return { id: "l1", resourceKey: input.resource, recordId: input.recordId }; },
    async list() { return []; },
  };
  const prisma = { auditLog: { create: async () => ({}) } };
  const app = createModulePublicLinksRoutes({ prisma, authMiddleware: async (c, next) => next(), requirePermission, linksService });
  return { app, checked };
}

const body = JSON.stringify({ resource: "encuesta.responder", recordId: "0192f3a0-0000-7000-8000-000000000001", maxUses: 10 });
const init = { method: "POST", headers: { "content-type": "application/json" }, body };

test("create is guarded by the resource managePermission", async () => {
  const denied = setup([]);
  assert.equal((await denied.app.request("http://x/custom.encuestas/public-links", init)).status, 403);
  assert.deepEqual(denied.checked, ["encuestas.encuesta.update"]);
  const ok = setup(["encuestas.encuesta.update"]);
  const res = await ok.app.request("http://x/custom.encuestas/public-links", init);
  assert.equal(res.status, 201);
  assert.equal((await res.json()).data.id, "l1");
});

test("invalid body is 422 before any permission lookup", async () => {
  const { app, checked } = setup(["encuestas.encuesta.update"]);
  const res = await app.request("http://x/custom.encuestas/public-links", { ...init, body: JSON.stringify({ resource: "x", maxUses: 0 }) });
  assert.equal(res.status, 422);
  assert.equal(checked.length, 0);
});
