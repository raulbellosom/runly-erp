// apps/api/src/routes/chat/__tests__/meridian-routing.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createMeridianService } from "../meridian-service.js";

// A Groq stub that answers by inspecting the request body:
//  - classifier calls (max_tokens 6, no tools) -> return `routeWord`
//  - everything else -> shift from `answers`
function groqRouter({ routeWord = "general", answers = [], onBody } = {}) {
  let i = 0;
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    onBody?.(body);
    const isClassifier = !body.tools && String(body.messages?.[0]?.content ?? "").startsWith("Eres un clasificador");
    const content = isClassifier ? routeWord : (answers[i++] ?? "(sin mas)");
    return {
      ok: true, status: 200,
      json: async () => ({ model: body.model, choices: [{ message: { content } }] }),
      text: async () => "",
    };
  };
}

function svcForRoute({ fetchImpl, env = { GROQ_API_KEY: "k" }, listMessages, historyRows } = {}) {
  const inserted = [];
  const runs = [];
  const prisma = {
    membership: { findFirst: async () => ({ companyId: "co1" }) },
    $queryRaw: async (strings) => {
      const sql = strings.join("?");
      // the just-sent user message the classifier reads
      if (/SELECT\s+body\s+FROM chat_messages WHERE id/i.test(sql)) return [{ body: "una pregunta" }];
      if (/FROM chat_messages/i.test(sql)) return historyRows ?? [];   // loadHistory / router history / web history
      if (/FROM chat_conversations/i.test(sql)) return [{ id: "mconv1", type: "meridian", company_id: "co1" }];
      return [];
    },
    $executeRaw: async () => 0,
    chatMeridianRun: { create: async ({ data }) => { runs.push(data); return {}; } },
  };
  const svc = createMeridianService({
    prisma, env, fetchImpl,
    listMessages: listMessages ?? (async () => ({ data: [{ id: "m1", sender_type: "user", body: "hola", message_type: "text", created_at: new Date(), attachments: [], attachment_count: 0, sender: { displayName: "Ana" } }] })),
    chatSearchService: {}, visionService: {},
    insertAssistantMessage: async ({ body }) => { inserted.push(body); return { id: "b1", created_at: new Date() }; },
    broadcaster: { broadcastToChannel: async () => {} },
  });
  return { svc, inserted, runs };
}

const call = (svc) => svc.handleUserMessage({ companyId: "co1", conversationId: "mconv1", actorProfileId: "p1", actorAuthUserId: "a1", triggerMessageId: "u1" });

test("route general: uses the chat model, answers, run.route === 'general'", async () => {
  const { svc, inserted, runs } = svcForRoute({ fetchImpl: groqRouter({ routeWord: "general", answers: ["La limerencia es..."] }) });
  await call(svc);
  assert.deepEqual(inserted, ["La limerencia es..."]);
  assert.equal(runs.at(-1).route, "general");
  assert.ok(runs.at(-1).routerMs >= 0);
});

test("route chat: runs the tool loop, run.route === 'chat'", async () => {
  const tc = [{ id: "c1", type: "function", function: { name: "get_recent_messages", arguments: "{}" } }];
  const fetchImpl = async (_u, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.tools && String(body.messages?.[0]?.content ?? "").startsWith("Eres un clasificador")) {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "chat" } }] }), text: async () => "" };
    }
    // first loop call -> tool call; second -> final
    const hasToolMsg = body.messages.some((m) => m.role === "tool");
    const content = hasToolMsg ? "Resumen listo." : "";
    const msg = hasToolMsg ? { content } : { content: "", tool_calls: tc };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: msg }] }), text: async () => "" };
  };
  const { svc, inserted, runs } = svcForRoute({ fetchImpl });
  await call(svc);
  assert.deepEqual(inserted, ["Resumen listo."]);
  assert.equal(runs.at(-1).route, "chat");
});

test("route live + TAVILY_API_KEY: searches Tavily then synthesizes an answer (no chat tools)", async () => {
  let tavilyQuery = null;
  let synthTools = "unset";
  const fetchImpl = async (url, opts) => {
    if (String(url).includes("api.tavily.com")) {
      tavilyQuery = JSON.parse(opts.body).query;
      return { ok: true, status: 200, text: async () => "", json: async () => ({
        answer: "USD/MXN ~18.20",
        results: [{ title: "Banxico", url: "https://www.banxico.org.mx/x", content: "18.20 MXN por dolar" }],
      }) };
    }
    const body = JSON.parse(opts.body);
    const isClassifier = !body.tools && String(body.messages?.[0]?.content ?? "").startsWith("Eres un clasificador");
    if (!isClassifier) synthTools = body.tools;
    return { ok: true, status: 200, text: async () => "", json: async () => ({
      choices: [{ message: { content: isClassifier ? "live" : "El dolar esta ~18.20 MXN (banxico.org.mx)." } }],
    }) };
  };
  const { svc, inserted, runs } = svcForRoute({ fetchImpl, env: { GROQ_API_KEY: "k", TAVILY_API_KEY: "tvly" } });
  await call(svc);
  assert.equal(tavilyQuery, "una pregunta"); // svcForRoute's trigger-body stub
  assert.match(inserted[0], /dolar/i);
  assert.equal(runs.at(-1).route, "live");
  assert.equal(synthTools, undefined, "no chat tools in the synthesis call");
});

test("route live with no web provider configured -> canned 'no internet', error web-disabled", async () => {
  const { svc, inserted, runs } = svcForRoute({ fetchImpl: groqRouter({ routeWord: "live" }) });
  await call(svc);
  assert.match(inserted[0], /no tengo acceso|datos en vivo|internet/i);
  assert.equal(runs.at(-1).error, "web-disabled");
});

test("route live + web disabled: canned reply, compound NOT called", async () => {
  let compoundCalled = false;
  const fetchImpl = groqRouter({ routeWord: "live", onBody: (b) => { if (String(b.model).includes("compound")) compoundCalled = true; } });
  const { svc, inserted, runs } = svcForRoute({ fetchImpl, env: { GROQ_API_KEY: "k", CHAT_MERIDIAN_WEB: "false" } });
  await call(svc);
  assert.equal(compoundCalled, false);
  assert.match(inserted[0], /no tengo acceso|datos en vivo|internet/i);
  assert.equal(runs.at(-1).error, "web-disabled");
});

test("classifier returns junk -> route general", async () => {
  const { svc, runs } = svcForRoute({ fetchImpl: groqRouter({ routeWord: "banana", answers: ["ok"] }) });
  await call(svc);
  assert.equal(runs.at(-1).route, "general");
});

test("classifier fetch fails -> route chat (fallback)", async () => {
  const fetchImpl = async (_u, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.tools && String(body.messages?.[0]?.content ?? "").startsWith("Eres un clasificador")) throw new Error("router down");
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "respondido por chat" } }] }), text: async () => "" };
  };
  const { svc, inserted, runs } = svcForRoute({ fetchImpl });
  await call(svc);
  assert.equal(runs.at(-1).route, "chat");
  assert.ok(runs.at(-1).toolCalls.some((x) => x.routerError), "routerError recorded in the audit toolLog");
  assert.deepEqual(inserted, ["respondido por chat"]);
});

test("classifier circuit breaker: after 3 failed turns the 4th skips the classifier call", async () => {
  let classifierCalls = 0;
  const fetchImpl = async (_u, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.tools && String(body.messages?.[0]?.content ?? "").startsWith("Eres un clasificador")) { classifierCalls++; throw new Error("down"); }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "x" } }] }), text: async () => "" };
  };
  const { svc } = svcForRoute({ fetchImpl });
  await call(svc); await call(svc); await call(svc);
  const afterThree = classifierCalls;
  await call(svc);
  assert.equal(classifierCalls, afterThree, "classifier not invoked on the 4th turn once the breaker is open");
});

test("live sub-limit: 11th live turn is canned; Tavily not hit an 11th time", async () => {
  let tavilyCalls = 0;
  const fetchImpl = async (url, opts) => {
    if (String(url).includes("api.tavily.com")) {
      tavilyCalls++;
      return { ok: true, status: 200, text: async () => "", json: async () => ({ answer: "x", results: [] }) };
    }
    const body = JSON.parse(opts.body);
    const isClassifier = !body.tools && String(body.messages?.[0]?.content ?? "").startsWith("Eres un clasificador");
    return { ok: true, status: 200, text: async () => "", json: async () => ({ choices: [{ message: { content: isClassifier ? "live" : "dato" } }] }) };
  };
  const { svc, inserted, runs } = svcForRoute({ fetchImpl, env: { GROQ_API_KEY: "k", TAVILY_API_KEY: "tvly" } });
  for (let i = 0; i < 11; i++) await call(svc);
  assert.equal(tavilyCalls, 10);
  assert.match(inserted.at(-1), /limitando|unos minutos/i);
  assert.equal(runs.at(-1).error, "live-rate-limited");
});

test("classifier only sees the last 4 history rows", async () => {
  let routerHistoryLen = null;
  const fetchImpl = async (_u, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.tools && String(body.messages?.[0]?.content ?? "").startsWith("Eres un clasificador")) {
      routerHistoryLen = body.messages.length - 2; // minus system + the new user message
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "general" } }] }), text: async () => "" };
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }] }), text: async () => "" };
  };
  // historyRows has 4 entries -> the LIMIT 4 router query "returns" all 4
  const { svc } = svcForRoute({
    fetchImpl,
    historyRows: [
      { sender_type: "user", body: "m1" }, { sender_type: "assistant", body: "m2" },
      { sender_type: "user", body: "m3" }, { sender_type: "user", body: "m4" },
    ],
  });
  await call(svc);
  assert.equal(routerHistoryLen, 4);
});
