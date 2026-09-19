// apps/api/src/routes/chat/__tests__/meridian-mention.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createMeridianService, matchMeridianMention, stripMentionTokens } from "../meridian-service.js";

test("matchMeridianMention: hits real mentions, not emails or lookalikes", () => {
  for (const s of ["@meridIAn hola", "@meridian resume", "hola @MeridIAn?", "(@meridian) ayuda", "linea 1\n@meridian y esto"]) {
    assert.equal(matchMeridianMention(s), true, s);
  }
  for (const s of ["escribe a x@meridian.com", "meridian sin arroba", "@meridiano", "correo@meridianbank.mx", ""]) {
    assert.equal(matchMeridianMention(s), false, s);
  }
});

test("matchMeridianMention: detects the composer's @[sentinel:MeridIAn] token", () => {
  assert.equal(matchMeridianMention("@[00000000-0000-0000-0000-00000000b07a:MeridIAn] que hora es"), true);
  // a real user's @[uuid:Name] token must NOT trigger it
  assert.equal(matchMeridianMention("@[019e7008-684d-711c-9b13-872f854651f0:Ana] hola"), false);
});

test("stripMentionTokens: @[uuid:Name] -> @Name (incl. the MeridIAn sentinel)", () => {
  assert.equal(
    stripMentionTokens("@[00000000-0000-0000-0000-00000000b07a:MeridIAn] resume @[019e7008-684d-711c-9b13-872f854651f0:Ana] pls"),
    "@MeridIAn resume @Ana pls",
  );
  assert.equal(stripMentionTokens("sin tokens"), "sin tokens");
});

// Groq stub: classifier -> routeWord; anything else -> next `answers` entry.
function groq({ routeWord = "general", answers = [] } = {}) {
  let i = 0;
  return async (_u, opts) => {
    const body = JSON.parse(opts.body);
    const isClassifier = !body.tools && String(body.messages?.[0]?.content ?? "").startsWith("Eres un clasificador");
    const content = isClassifier ? routeWord : (answers[i++] ?? "(sin mas)");
    return { ok: true, status: 200, json: async () => ({ model: body.model, choices: [{ message: { content } }] }), text: async () => "" };
  };
}

function svc({ fetchImpl, env = { GROQ_API_KEY: "k" }, channelRows } = {}) {
  const inserted = [];
  const runs = [];
  const prisma = {
    membership: { findFirst: async () => ({ companyId: "co1" }) },
    $queryRaw: async (strings) => {
      const sql = strings.join("?");
      if (/FROM chat_messages m[\s\S]*conversation_id/i.test(sql)) return channelRows ?? []; // get_channel_messages + classifier history
      if (/FROM chat_conversations/i.test(sql)) return [{ id: "ch1", type: "channel", company_id: "co1" }];
      return [];
    },
    $executeRaw: async () => 0,
    chatMeridianRun: { create: async ({ data }) => { runs.push(data); return {}; } },
  };
  const service = createMeridianService({
    prisma, env, fetchImpl,
    listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {},
    insertAssistantMessage: async ({ conversationId, body, replyToMessageId }) => {
      inserted.push({ conversationId, body, replyToMessageId }); return { id: "b1", created_at: new Date() };
    },
    broadcaster: { broadcastToChannel: async () => {} },
  });
  return { service, inserted, runs };
}

const mention = (service, over = {}) => service.handleChannelMention({
  companyId: "co1", conversationId: "ch1", actorProfileId: "p1", actorAuthUserId: "a1",
  triggerMessageId: "u9", mentionText: "@meridIAn resume lo de hoy", ...over,
});

test("handleChannelMention: uses get_channel_messages then replies, quoting the mention; surface='mention'", async () => {
  const tc = [{ id: "t1", type: "function", function: { name: "get_channel_messages", arguments: "{}" } }];
  let sawChannelTool = false;
  const fetchImpl = async (_u, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.tools && String(body.messages?.[0]?.content ?? "").startsWith("Eres un clasificador")) {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "chat" } }] }), text: async () => "" };
    }
    const hasToolMsg = body.messages.some((m) => m.role === "tool");
    if (hasToolMsg) sawChannelTool = true;
    const msg = hasToolMsg ? { content: "Resumen del canal." } : { content: "", tool_calls: tc };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: msg }] }), text: async () => "" };
  };
  const { service, inserted, runs } = svc({ fetchImpl,
    channelRows: [{ sender_type: "user", body: "hola equipo", message_type: "text", created_at: new Date(), attachment_count: 0, sender_name: "Ana" }] });
  await mention(service);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].conversationId, "ch1");
  assert.equal(inserted[0].body, "Resumen del canal.");
  assert.equal(inserted[0].replyToMessageId, "u9");
  assert.ok(sawChannelTool, "get_channel_messages result was fed back to the model");
  assert.equal(runs.at(-1).surface, "mention");
  assert.equal(runs.at(-1).route, "chat");
});

test("handleChannelMention: channel cooldown blocks a 2nd reply within the window", async () => {
  const { service, inserted } = svc({ fetchImpl: groq({ routeWord: "general", answers: ["uno", "dos"] }) });
  await mention(service);
  await mention(service);
  assert.equal(inserted.length, 1, "second mention within the cooldown produced no reply");
});

test("handleChannelMention: no GROQ_API_KEY -> silent (no insert)", async () => {
  const { service, inserted } = svc({ fetchImpl: groq(), env: {} });
  await mention(service);
  assert.equal(inserted.length, 0);
});

test("handleChannelMention: route 'live' degrades to a no-internet reply, surface still 'mention'", async () => {
  const { service, inserted, runs } = svc({ fetchImpl: groq({ routeWord: "live" }), env: { GROQ_API_KEY: "k", CHAT_MERIDIAN_WEB: "false" } });
  await mention(service, { mentionText: "@meridIAn cuanto esta el dolar" });
  assert.match(inserted[0].body, /no tengo acceso|datos en vivo|internet/i);
  assert.equal(runs.at(-1).route, "live");
  assert.equal(runs.at(-1).surface, "mention");
  assert.equal(runs.at(-1).error, "web-disabled");
});

test("handleChannelMention: general question answered directly, no channel tool needed", async () => {
  const { service, inserted, runs } = svc({ fetchImpl: groq({ routeWord: "general", answers: ["Idempotente = aplicar una vez o varias da el mismo resultado."] }) });
  await mention(service, { mentionText: "@meridIAn que significa idempotente" });
  assert.match(inserted[0].body, /idempotente/i);
  assert.equal(runs.at(-1).surface, "mention");
});
