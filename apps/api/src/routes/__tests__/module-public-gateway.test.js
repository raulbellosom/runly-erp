import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createModulePublicGateway, PUBLIC_BODY_LIMIT } from "../module-public-gateway.js";
import { ModulePublicLinkError, linkStatus } from "../../services/module-public-links-service.js";

const TOKEN = "t".repeat(43);
const BASE = `http://x/public/m/custom.encuestas/${TOKEN}`;

function setup({ mode = "submit", status = "activo", moduleStatus = 201 } = {}) {
  const calls = { reserved: 0, released: 0, seen: null };
  const linksService = {
    async resolveByToken(moduleKey, token) {
      if (token !== TOKEN) throw new ModulePublicLinkError("x", 404);
      if (status !== "activo") throw new ModulePublicLinkError("x", 410, status);
      return {
        link: { id: "l1", companyId: "c1", resourceKey: "encuesta.responder", recordId: "r1", mode, expiresAt: null },
        resource: { key: "encuesta.responder", title: "Responder encuesta" },
      };
    },
    async reserveUse() { calls.reserved += 1; return true; },
    async releaseUse() { calls.released += 1; },
    async loadCompanyBranding() { return { name: "Acme", logoFileId: null }; },
  };
  const moduleRouter = new Hono();
  moduleRouter.use("*", async (c, next) => { c.set("publicLink", c.env.publicLink); c.set("publicBody", c.env.publicBody); await next(); });
  moduleRouter.get("/encuesta", (c) => c.json({ link: c.get("publicLink") }));
  moduleRouter.post("/respuestas", (c) => { calls.seen = c.get("publicBody"); return c.json({ ok: true }, moduleStatus); });
  const app = createModulePublicGateway({ linksService, getPublicRouter: () => moduleRouter });
  return { app, calls };
}

const post = (body, headers = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

test("unknown token is 404, exhausted link is 410 with reason", async () => {
  const { app } = setup();
  assert.equal((await app.request(`http://x/public/m/custom.encuestas/${"z".repeat(43)}/encuesta`)).status, 404);
  const res = await setup({ status: "agotado" }).app.request(`${BASE}/encuesta`);
  assert.equal(res.status, 410);
  assert.equal((await res.json()).reason, "agotado");
});

test("_context exposes branding and resource, not company id", async () => {
  const res = await setup().app.request(`${BASE}/_context`);
  const { data } = await res.json();
  assert.equal(data.company.name, "Acme");
  assert.equal(data.resource.mode, "submit");
  assert.equal(JSON.stringify(data).includes("c1"), false);
});

test("GET delegates with publicLink; view links reject writes", async () => {
  const res = await setup().app.request(`${BASE}/encuesta`);
  assert.equal((await res.json()).link.companyId, "c1");
  assert.equal((await setup({ mode: "view" }).app.request(`${BASE}/respuestas`, post({ a: 1 }))).status, 405);
});

test("submit strips honeypot field, reserves a use, and honeypot hits never reach the module", async () => {
  const { app, calls } = setup();
  assert.equal((await app.request(`${BASE}/respuestas`, post({ a: 1, _hp: "" }))).status, 201);
  assert.deepEqual(calls.seen, { a: 1 });
  assert.equal(calls.reserved, 1);
  calls.seen = null;
  assert.equal((await app.request(`${BASE}/respuestas`, post({ a: 1, _hp: "bot" }))).status, 200);
  assert.equal(calls.seen, null);
});

test("module error releases the reserved use; oversize and non-JSON are rejected", async () => {
  const { app, calls } = setup({ moduleStatus: 422 });
  await app.request(`${BASE}/respuestas`, post({ a: 1 }));
  assert.equal(calls.released, 1);
  const big = JSON.stringify({ a: "x".repeat(PUBLIC_BODY_LIMIT) });
  assert.equal((await setup().app.request(`${BASE}/respuestas`, post(big))).status, 413);
  assert.equal((await setup().app.request(`${BASE}/respuestas`, { method: "POST", body: "a=1" })).status, 415);
});

test("linkStatus precedence", () => {
  const past = new Date(Date.now() - 1000);
  assert.equal(linkStatus({ revokedAt: past, expiresAt: past }), "revocado");
  assert.equal(linkStatus({ expiresAt: past }), "vencido");
  assert.equal(linkStatus({ maxUses: 2, useCount: 2 }), "agotado");
  assert.equal(linkStatus({ maxUses: null, useCount: 9 }), "activo");
});
