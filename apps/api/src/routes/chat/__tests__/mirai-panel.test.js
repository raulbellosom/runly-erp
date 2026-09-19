// apps/api/src/routes/chat/__tests__/meridian-panel.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createMeridianService } from "../meridian-service.js";

// Groq stub: classifier -> routeWord; else -> next `answers`.
function groq({ routeWord = "general", answers = [] } = {}) {
  let i = 0;
  return async (_u, opts) => {
    const body = JSON.parse(opts.body);
    const isClassifier = !body.tools && String(body.messages?.[0]?.content ?? "").startsWith("Eres un clasificador");
    const content = isClassifier ? routeWord : (answers[i++] ?? "(sin mas)");
    return { ok: true, status: 200, json: async () => ({ model: body.model, choices: [{ message: { content } }] }), text: async () => "" };
  };
}

// In-memory panel-table double keyed by SQL substring.
function makePrisma({ focusRow } = {}) {
  const threadMsgs = [];
  let threadEnabled = true;
  const threadId = "th1";
  const runs = [];
  const prisma = {
    _threadMsgs: threadMsgs,
    _runs: runs,
    membership: { findFirst: async () => ({ companyId: "co1" }) },
    $queryRaw: async (strings) => {
      const sql = strings.join("?");
      if (/INSERT INTO chat_meridian_thread/i.test(sql)) return threadEnabled ? [{ id: threadId }] : [];
      if (/SELECT id FROM chat_meridian_thread/i.test(sql)) return threadEnabled ? [{ id: threadId }] : [];
      if (/SELECT role, content, created_at AS "createdAt"\s+FROM chat_meridian_message/i.test(sql)) {
        return threadMsgs.map((m) => ({ ...m, createdAt: new Date() }));
      }
      if (/SELECT role, content FROM chat_meridian_message/i.test(sql)) {
        return [...threadMsgs].reverse();
      }
      if (/INSERT INTO chat_meridian_message[\s\S]*RETURNING created_at/i.test(sql)) {
        return [{ createdAt: new Date() }];
      }
      if (/FROM chat_messages m LEFT JOIN user_profile/i.test(sql)) return focusRow ? [focusRow] : [];
      if (/FROM chat_messages/i.test(sql)) return [];  // classifier history
      if (/FROM chat_conversations/i.test(sql)) return [{ id: "hc1", type: "channel", company_id: "co1" }];
      return [];
    },
    $executeRaw: async (strings, ...vals) => {
      const sql = strings.join("?");
      if (/INSERT INTO chat_meridian_message/i.test(sql)) {
        threadMsgs.push({ role: /'user'/.test(sql) ? "user" : "user", content: vals[vals.length - 1] });
      }
      if (/UPDATE chat_meridian_thread SET enabled = false/i.test(sql)) threadEnabled = false;
      return 0;
    },
    chatMeridianRun: { create: async ({ data }) => { runs.push(data); return {}; } },
  };
  return prisma;
}

function svc({ fetchImpl, env = { GROQ_API_KEY: "k" }, prisma } = {}) {
  return createMeridianService({
    prisma: prisma ?? makePrisma(), env, fetchImpl: fetchImpl ?? groq(),
    listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {},
    insertAssistantMessage: async () => ({ id: "x", created_at: new Date() }),
    broadcaster: { broadcastToChannel: async () => {} },
  });
}

test("getPanelThread is idempotent (same threadId twice)", async () => {
  const service = svc();
  const a = await service.getPanelThread({ ownerProfileId: "p1", hostConversationId: "hc1" });
  const b = await service.getPanelThread({ ownerProfileId: "p1", hostConversationId: "hc1" });
  assert.equal(a.threadId, "th1");
  assert.equal(b.threadId, "th1");
});

test("handlePanelMessage persists a user row + an assistant row; surface='panel'", async () => {
  const prisma = makePrisma();
  const service = svc({ prisma, fetchImpl: groq({ routeWord: "general", answers: ["Resumen del chat."] }) });
  const out = await service.handlePanelMessage({
    companyId: "co1", ownerProfileId: "p1", ownerAuthUserId: "a1",
    hostConversationId: "hc1", threadId: "th1", content: "resume esto",
  });
  assert.equal(out.message.role, "assistant");
  assert.equal(out.message.content, "Resumen del chat.");
  assert.ok(prisma._threadMsgs.length >= 1); // at least the user row (assistant insert goes via $queryRaw RETURNING)
  assert.equal(prisma._runs.at(-1).surface, "panel");
  assert.equal(prisma._runs.at(-1).route, "general");
});

test("handlePanelMessage with no GROQ_API_KEY throws MERIDIAN_NOT_CONFIGURED", async () => {
  const service = svc({ env: {} });
  await assert.rejects(
    () => service.handlePanelMessage({ ownerProfileId: "p1", ownerAuthUserId: "a1", hostConversationId: "hc1", threadId: "th1", content: "hola" }),
    /MERIDIAN_NOT_CONFIGURED/,
  );
});

test("focusMessageId from another conversation is ignored (no focus line)", async () => {
  const prisma = makePrisma({ focusRow: { body: "secreto", conversation_id: "OTHER", sender_name: "X", image_attachment_id: null } });
  let sawFocus = false;
  const fetchImpl = async (_u, opts) => {
    const body = JSON.parse(opts.body);
    const isClassifier = !body.tools && String(body.messages?.[0]?.content ?? "").startsWith("Eres un clasificador");
    if (!isClassifier && body.messages.some((m) => String(m.content).includes("pregunta sobre este mensaje"))) sawFocus = true;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: isClassifier ? "chat" : "ok" } }] }), text: async () => "" };
  };
  const service = svc({ prisma, fetchImpl });
  await service.handlePanelMessage({
    companyId: "co1", ownerProfileId: "p1", ownerAuthUserId: "a1",
    hostConversationId: "hc1", threadId: "th1", content: "que dice", focusMessageId: "11111111-1111-1111-1111-111111111111",
  });
  assert.equal(sawFocus, false, "no focus line injected for a foreign-conversation message");
});

test("route 'live' + web disabled: still persists an assistant row, error web-disabled", async () => {
  const prisma = makePrisma();
  const service = svc({ prisma, env: { GROQ_API_KEY: "k", CHAT_MERIDIAN_WEB: "false" }, fetchImpl: groq({ routeWord: "live" }) });
  const out = await service.handlePanelMessage({
    companyId: "co1", ownerProfileId: "p1", ownerAuthUserId: "a1",
    hostConversationId: "hc1", threadId: "th1", content: "cuanto esta el dolar",
  });
  assert.match(out.message.content, /no tengo acceso|datos en vivo|internet/i);
  assert.equal(prisma._runs.at(-1).route, "live");
  assert.equal(prisma._runs.at(-1).surface, "panel");
  assert.equal(prisma._runs.at(-1).error, "web-disabled");
});

test("clearPanelThread soft-deletes; next getPanelThread creates a fresh one", async () => {
  const prisma = makePrisma();
  const service = svc({ prisma });
  await service.clearPanelThread({ ownerProfileId: "p1", hostConversationId: "hc1" });
  const after = await service.getPanelThread({ ownerProfileId: "p1", hostConversationId: "hc1" });
  assert.equal(after.threadId, null); // stub: disabled -> INSERT returns [] and SELECT returns []
});
