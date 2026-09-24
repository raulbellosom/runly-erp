// apps/api/src/routes/chat/__tests__/mirai-routes.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createMiraiRoutes } from "../mirai-routes.js";
import { ChatServiceError } from "../chat-service-error.js";

function app({ available = true, ensure, member = true, miraiService: msOverride, miraiTtsService } = {}) {
  const a = new Hono();
  a.use("*", async (c, next) => { c.set("authUserId", "auth1"); c.set("companyId", "co1"); await next(); });
  const requirePermission = () => async (c, next) => next();
  a.route("", createMiraiRoutes({
    requirePermission,
    miraiService: msOverride ?? {
      isConfigured: () => available,
      ensureMiraiConversation: ensure ?? (async () => ({ conversationId: "mconv1", created: false })),
      getPanelThread: async () => ({ threadId: "th1", messages: [] }),
      handlePanelMessage: async () => ({ message: { role: "assistant", content: "hola", createdAt: new Date() } }),
      clearPanelThread: async () => ({ cleared: true }),
    },
    miraiTtsService,
    resolveProfileId: async () => "prof1",
    assertConversationMember: async () => member,
  }));
  return a;
}

test("GET /chat/mirai returns a stable conversationId", async () => {
  const a = app();
  const r1 = await a.request("/chat/mirai");
  const r2 = await a.request("/chat/mirai");
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).data.conversationId, "mconv1");
  assert.equal((await r2.json()).data.conversationId, "mconv1");
});

test("GET /chat/mirai/status reflects configuration", async () => {
  const on = await app({ available: true }).request("/chat/mirai/status");
  const off = await app({ available: false }).request("/chat/mirai/status");
  assert.equal((await on.json()).data.available, true);
  assert.equal((await off.json()).data.available, false);
});

test("GET /chat/mirai/status reports tts:false when the tts service is not configured", async () => {
  const r = await app({ miraiTtsService: { isConfigured: () => false } }).request("/chat/mirai/status");
  assert.equal((await r.json()).data.tts, false);
});

test("GET /chat/mirai/status reports tts:false when no tts service was wired at all", async () => {
  const r = await app().request("/chat/mirai/status");
  assert.equal((await r.json()).data.tts, false);
});

test("POST /chat/mirai/tts returns the synthesized audio bytes with its content type", async () => {
  const audio = Buffer.from([1, 2, 3, 4]);
  const a = app({ miraiTtsService: { synthesize: async (text) => {
    assert.equal(text, "hola mundo");
    return { buffer: audio, contentType: "audio/wav" };
  } } });
  const r = await a.request("/chat/mirai/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "hola mundo" }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "audio/wav");
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), new Uint8Array(audio));
});

test("POST /chat/mirai/tts surfaces a ChatServiceError's status and message", async () => {
  const a = app({ miraiTtsService: { synthesize: async () => {
    throw new ChatServiceError("La lectura en voz alta no está configurada.", 503);
  } } });
  const r = await a.request("/chat/mirai/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "hola" }),
  });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "La lectura en voz alta no está configurada.");
});

test("GET /chat/mirai/panel/:id 404s for a non-member", async () => {
  const r = await app({ member: false }).request("/chat/mirai/panel/hc1");
  assert.equal(r.status, 404);
});

test("GET /chat/mirai/panel/:id returns the thread for a member", async () => {
  const r = await app().request("/chat/mirai/panel/hc1");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.threadId, "th1");
});

test("POST /chat/mirai/panel/:id/messages: empty content -> 400", async () => {
  const r = await app().request("/chat/mirai/panel/hc1/messages", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "  " }),
  });
  assert.equal(r.status, 400);
});

test("POST /chat/mirai/panel/:id/messages: happy path returns the assistant message", async () => {
  const r = await app().request("/chat/mirai/panel/hc1/messages", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "resume" }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.message.role, "assistant");
});

test("DELETE /chat/mirai/panel/:id clears", async () => {
  const r = await app().request("/chat/mirai/panel/hc1", { method: "DELETE" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.cleared, true);
});
