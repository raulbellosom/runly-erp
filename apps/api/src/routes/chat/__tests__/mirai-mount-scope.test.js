// apps/api/src/routes/chat/__tests__/meridian-mount-scope.test.js
//
// Regression: the MeridIAn sub-app must NOT install its auth guard at the app
// root. It used to do `meridian.use("*", authMiddleware)` + `app.route("", meridian)`,
// which — because createChatRouter is mounted early at `app.route("/", ...)` in
// apps/api/src/index.js — made that guard intercept EVERY unmatched request
// (including nginx's `/public/site/*` marketing-site proxy) and return
// `{"error":"No autorizado. Debes iniciar sesion."}` before the public handlers
// or the dist-serve SPA fallback could run. The guard must be scoped to
// `/chat/meridian` only.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createChatRouter } from "../index.js";

// Mirrors apps/api/src/index.js authMiddleware's no-token branch.
async function authMiddleware(c, next) {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return c.json({ error: "No autorizado. Debes iniciar sesion." }, 401);
  c.set("authUserId", "auth-1");
  await next();
}

function buildApp() {
  const prisma = { $queryRaw: async () => [], $executeRaw: async () => 0 };
  const supabaseAdmin = { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: "stub" }) }) } };
  const requirePermission = () => async (c, next) => next();

  const app = new Hono();
  // Same mount point and ordering as apps/api/src/index.js (chat router is
  // registered well before the public-site handler / dist-serve middleware).
  app.route("/", createChatRouter({ prisma, supabaseAdmin, authMiddleware, requirePermission }));
  // Stand-in for the real `/public/site/*` handler that lives further down in index.js.
  app.get("/public/site/*", (c) => c.text("spa-fallback", 404));
  return app;
}

test("unauthenticated /public/site/* is NOT swallowed by the MeridIAn auth guard", async () => {
  const res = await buildApp().request("/public/site/");
  assert.equal(res.status, 404, "should reach the public-site handler, not the 401 guard");
  assert.equal(await res.text(), "spa-fallback");
});

test("MeridIAn routes still require authentication", async () => {
  const res = await buildApp().request("/chat/meridian/status");
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "No autorizado. Debes iniciar sesion.");
});

test("an unrelated unmatched path is not turned into a 401 by the chat router", async () => {
  const res = await buildApp().request("/public/blueprints");
  // No handler registered for it here -> Hono's own 404, never the auth 401.
  assert.equal(res.status, 404);
  const body = await res.text();
  assert.ok(!body.includes("No autorizado"), `unexpected auth 401 body: ${body}`);
});
