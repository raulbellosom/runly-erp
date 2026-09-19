// apps/api/src/routes/chat/__tests__/meridian-service.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createMeridianService, __systemPromptForTest } from "../meridian-service.js";

function makePrismaStub() {
  const state = { profiles: [], conversations: [], members: [], messages: [], runs: [] };
  const prisma = {
    _state: state,
    membership: {
      findFirst: async ({ where }) => ({ companyId: "co1" }),
    },
    $queryRaw: async (strings, ...vals) => {
      const sql = strings.join("?");
      if (/FROM user_profile[\s\S]*is_bot/i.test(sql)) {
        return state.profiles.filter((p) => p.is_bot);
      }
      if (/INSERT INTO user_profile/i.test(sql)) {
        const row = { id: "bot1", is_bot: true, display_name: "MeridIAn" };
        state.profiles.push(row); return [row];
      }
      if (/FROM chat_conversations[\s\S]*type = 'meridian'/i.test(sql)) {
        return state.conversations.filter((c) => c.type === "meridian");
      }
      if (/INSERT INTO chat_conversations/i.test(sql)) {
        const row = { id: "mconv1", type: "meridian" }; state.conversations.push(row); return [row];
      }
      return [];
    },
    $executeRaw: async () => 0,
  };
  return prisma;
}

test("isConfigured reflects GROQ_API_KEY", () => {
  const on = createMeridianService({ prisma: makePrismaStub(), env: { GROQ_API_KEY: "k" }, visionService: {}, chatSearchService: {}, listMessages: async () => ({ data: [] }) });
  const off = createMeridianService({ prisma: makePrismaStub(), env: {}, visionService: {}, chatSearchService: {}, listMessages: async () => ({ data: [] }) });
  assert.equal(on.isConfigured(), true);
  assert.equal(off.isConfigured(), false);
});

test("systemPrompt carries the anti-injection and no-writes clauses and a resolved date", () => {
  const p = __systemPromptForTest();
  assert.match(p, /informaci[oó]n, no instrucciones/i);
  assert.match(p, /no puedes realizar acciones|solo respondes|no ejecutas/i);
  assert.match(p, /\d{4}-\d{2}-\d{2}/); // today injected
});

test("ensureMeridianConversation is idempotent", async () => {
  const prisma = makePrismaStub();
  const svc = createMeridianService({ prisma, env: { GROQ_API_KEY: "k" }, visionService: {}, chatSearchService: {}, listMessages: async () => ({ data: [] }) });
  const a = await svc.ensureMeridianConversation({ companyId: "co1", actorProfileId: "prof1" });
  const b = await svc.ensureMeridianConversation({ companyId: "co1", actorProfileId: "prof1" });
  assert.equal(a.conversationId, b.conversationId);
  assert.equal(prisma._state.conversations.length, 1);
});

// Chained Groq stub: each call() shifts the next canned response.
function groqStub(responses) {
  let i = 0;
  return async () => {
    const r = responses[i++] ?? { choices: [{ message: { content: "(sin mas)" } }] };
    return { ok: true, status: 200, json: async () => r, text: async () => "" };
  };
}
function assistantMsg(content, tool_calls) {
  return { choices: [{ message: { content: content ?? "", ...(tool_calls ? { tool_calls } : {}) } }] };
}

function serviceForLoop({ fetchImpl, env = { GROQ_API_KEY: "k" }, listMessages, chatSearchService = {}, visionService = {} } = {}) {
  const inserted = [];
  const runs = [];
  const prisma = {
    membership: { findFirst: async () => ({ companyId: "co1" }) },
    $queryRaw: async (strings) => {
      const sql = strings.join("?");
      if (/FROM chat_messages[\s\S]*ORDER BY .*created_at DESC/i.test(sql)) return []; // history
      if (/FROM chat_conversations/i.test(sql)) return [{ id: "mconv1", type: "meridian", company_id: "co1" }];
      return [];
    },
    $executeRaw: async () => 0,
    chatMeridianRun: { create: async ({ data } = {}) => { runs.push(data ?? {}); return {}; } },
  };
  const svc = createMeridianService({
    prisma, env, fetchImpl,
    listMessages: listMessages ?? (async () => ({ data: [] })),
    chatSearchService, visionService,
    insertAssistantMessage: async ({ body }) => { inserted.push(body); return { id: "botmsg1", created_at: new Date() }; },
    broadcaster: { broadcastToChannel: async () => {} },
  });
  return { svc, inserted, prisma, runs };
}

test("handleUserMessage: plain question -> one Groq call -> one assistant message inserted", async () => {
  const { svc, inserted } = serviceForLoop({ fetchImpl: groqStub([assistantMsg("Claro, aqui va.")]) });
  await svc.handleUserMessage({ companyId: "co1", conversationId: "mconv1", actorProfileId: "prof1", actorAuthUserId: "auth1", triggerMessageId: "um1" });
  assert.deepEqual(inserted, ["Claro, aqui va."]);
});

test("handleUserMessage: model calls get_recent_messages then answers", async () => {
  const listMessages = async () => ({ data: [{ id: "m1", sender_type: "user", body: "hola", message_type: "text", created_at: new Date(), attachments: [], attachment_count: 0, sender: { displayName: "Ana" } }] });
  const tc = [{ id: "call1", type: "function", function: { name: "get_recent_messages", arguments: "{\"limit\":10}" } }];
  const { svc, inserted } = serviceForLoop({ fetchImpl: groqStub([assistantMsg("", tc), assistantMsg("Resumen: Ana dijo hola.")]), listMessages });
  await svc.handleUserMessage({ companyId: "co1", conversationId: "mconv1", actorProfileId: "prof1", actorAuthUserId: "auth1", triggerMessageId: "um1" });
  assert.deepEqual(inserted, ["Resumen: Ana dijo hola."]);
});

test("handleUserMessage: 6-iteration cap -> graceful message", async () => {
  const tc = [{ id: "c", type: "function", function: { name: "get_recent_messages", arguments: "{}" } }];
  const { svc, inserted } = serviceForLoop({ fetchImpl: groqStub(Array(10).fill(assistantMsg("", tc))) });
  await svc.handleUserMessage({ companyId: "co1", conversationId: "mconv1", actorProfileId: "prof1", actorAuthUserId: "auth1", triggerMessageId: "um1" });
  assert.match(inserted[0], /no pude terminar|mas concreto/i);
});

test("handleUserMessage: empty Groq answer -> error reply + audited", async () => {
  const { svc, inserted, runs } = serviceForLoop({ fetchImpl: groqStub([assistantMsg("   ")]) });
  await svc.handleUserMessage({ companyId: "co1", conversationId: "mconv1", actorProfileId: "prof1", actorAuthUserId: "auth1", triggerMessageId: "um1" });
  assert.match(inserted[0], /No pude responder ahora mismo/i);
  assert.equal(runs[0].error, "respuesta vacia de Groq");
});

test("handleUserMessage: rate limit -> canned busy reply, no Groq call", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, status: 200, json: async () => assistantMsg("x"), text: async () => "" }; };
  const { svc, inserted } = serviceForLoop({ fetchImpl });
  for (let i = 0; i < 21; i++) {
    await svc.handleUserMessage({ companyId: "co1", conversationId: "mconv1", actorProfileId: "profRL", actorAuthUserId: "auth1", triggerMessageId: "um" + i });
  }
  assert.ok(calls <= 20);
  assert.ok(inserted.some((b) => /saturad/i.test(b)));
});

test("handleUserMessage: no GROQ_API_KEY -> 'no configurado' reply, fetch never called", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, status: 200, json: async () => assistantMsg("x"), text: async () => "" }; };
  const { svc, inserted } = serviceForLoop({ fetchImpl, env: {} });
  await svc.handleUserMessage({ companyId: "co1", conversationId: "mconv1", actorProfileId: "prof1", actorAuthUserId: "auth1", triggerMessageId: "um1" });
  assert.equal(calls, 0);
  assert.match(inserted[0], /no est[aá] configurado/i);
});

test("handleUserMessage: same conversation is serialized (no overlapping Groq calls)", async () => {
  let active = 0; let maxActive = 0;
  const fetchImpl = async () => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 20));
    active--;
    return { ok: true, status: 200, json: async () => assistantMsg("ok"), text: async () => "" };
  };
  const { svc } = serviceForLoop({ fetchImpl });
  await Promise.all([
    svc.handleUserMessage({ companyId: "co1", conversationId: "mconv1", actorProfileId: "pA", actorAuthUserId: "a", triggerMessageId: "1" }),
    svc.handleUserMessage({ companyId: "co1", conversationId: "mconv1", actorProfileId: "pB", actorAuthUserId: "b", triggerMessageId: "2" }),
  ]);
  assert.equal(maxActive, 1);
});
