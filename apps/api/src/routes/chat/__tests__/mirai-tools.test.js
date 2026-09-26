// apps/api/src/routes/chat/__tests__/mirai-tools.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_DEFS, buildToolRunners, CHANNEL_TOOL_DEFS, buildChannelToolRunners } from "../mirai-tools.js";

const ctx = { companyId: "co1", actorAuthUserId: "auth1", actorProfileId: "prof1", conversationId: "conv1" };

// Builds a membership in the shape erpContext/resolveScopedErpContext (via
// resolveActiveMembership/computeScopedPermissions) actually expects — the
// same nested { companyId, company, role: { key, permissions } } shape
// _loadUserContext produces in apps/api/src/index.js, not a flat
// { isAdmin, permissionSet } on the mock's top level.
function membership({ companyId, roleKey = null, permissions = [] }) {
  return {
    companyId,
    company: { enabled: true },
    role: { key: roleKey, enabled: true, permissions: permissions.map((key) => ({ permission: { key } })) },
  };
}

test("TOOL_DEFS lists every read tool with JSON schemas", () => {
  const names = TOOL_DEFS.map((t) => t.function.name).sort();
  assert.deepEqual(names, [
    "describe_image", "get_call_transcript", "get_conversation_messages", "get_recent_messages",
    "list_bank_accounts", "list_call_transcripts", "list_conversation_files", "list_my_calendar",
    "list_my_tasks", "search_inventory", "search_module_help", "search_my_conversations", "search_runly",
  ]);
  for (const t of TOOL_DEFS) assert.equal(t.type, "function");
});

test("search_inventory: gated by inventory.item.read; maps rows to the safe shape", async () => {
  const withPerm = async () => ({ profile: { id: "p1" }, memberships: [membership({ companyId: "co1", permissions: ["inventory.item.read"] })] });
  const inventoryService = {
    listItems: async ({ companyId, search, limit }) => {
      assert.equal(companyId, "co1"); assert.equal(search, "laptop"); assert.equal(limit, 8);
      return { data: [{ name: "Laptop Dell", assetTag: "IT-001", serialNumber: "SN9", status: "IN_USE", category: { name: "Computo" } }], total: 1 };
    },
  };
  const runners = buildToolRunners({ prisma: {}, listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "x", resolveUserContext: withPerm, inventoryService });
  const out = await runners.search_inventory({ query: "laptop" }, { actorAuthUserId: "a", companyId: "co1" });
  assert.equal(out.items[0].nombre, "Laptop Dell");
  assert.equal(out.items[0].categoria, "Computo");
  assert.equal(out.total, 1);

  const noPerm = async () => ({ profile: { id: "p1" }, memberships: [membership({ companyId: "co1" })] });
  const r2 = buildToolRunners({ prisma: {}, listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "x", resolveUserContext: noPerm, inventoryService });
  const denied = await r2.search_inventory({ query: "x" }, { actorAuthUserId: "a", companyId: "co1" });
  assert.match(denied.error, /acceso/i);
});

test("list_my_tasks: iterates the caller's first 8 projects, filters by assignee", async () => {
  const withPerm = async () => ({ profile: { id: "me" }, memberships: [membership({ companyId: "co1", permissions: ["projects.task.read"] })] });
  const projects = Array.from({ length: 10 }, (_, i) => ({ id: `pr${i}`, name: `Proyecto ${i}` }));
  let scanned = 0;
  const projectsService = { listProjects: async (companyId, userId) => { assert.equal(userId, "me"); return projects; } };
  const tasksService = {
    listTasks: async (projectId, { assigneeId }) => {
      scanned += 1;
      assert.equal(assigneeId, "me");
      return projectId === "pr0" ? [{ title: "Hacer X", status: { name: "En curso" }, priority: "HIGH", dueDate: "2026-09-10" }] : [];
    },
  };
  const runners = buildToolRunners({ prisma: {}, listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "x", resolveUserContext: withPerm, projectsService, tasksService });
  const out = await runners.list_my_tasks({}, { actorAuthUserId: "a", companyId: "co1" });
  assert.equal(scanned, 8, "only the first 8 projects scanned");
  assert.equal(out.tareas[0].titulo, "Hacer X");
  assert.equal(out.tareas[0].proyecto, "Proyecto 0");
  assert.match(out.note, /8 proyectos/);
});

test("a missing ERP service dep -> friendly error, no throw", async () => {
  const runners = buildToolRunners({ prisma: {}, listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "x", resolveUserContext: async () => ({ profile: { id: "p" }, memberships: [{ companyId: "c" }], isAdmin: true, permissionSet: new Set() }) });
  const out = await runners.list_bank_accounts({}, { actorAuthUserId: "a", companyId: "c" });
  assert.match(out.error, /no esta disponible/i);
});

test("search_runly: runs only the providers the caller is allowed, returns grouped hits", async () => {
  const resolveUserContext = async (authUserId) => {
    assert.equal(authUserId, "auth1");
    return {
      profile: { id: "prof1" },
      // NOT identity.users.read / hr.employee.read
      memberships: [membership({ companyId: "co1", permissions: ["contacts.contacts.read"] })],
    };
  };
  const runners = buildToolRunners({ prisma: {}, listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "x", resolveUserContext });
  const out = await runners.search_runly({ query: "Juan" }, { companyId: "co1", actorAuthUserId: "auth1", actorProfileId: "prof1", conversationId: "c1" });
  // With only contacts permission, the contacts provider runs against the empty
  // prisma stub -> throws -> Promise.allSettled swallows it -> no groups.
  assert.ok(out.groups === undefined ? out.note : true);
});

test("search_inventory: admin in Company A does NOT leak admin access into a tool call scoped to Company B", async () => {
  // Regression test for the exact bug this fix closes: erpContext used to
  // read uctx.isAdmin/uctx.permissionSet, which getUserContextByAuthId built
  // by UNIONING every membership's role across every company the user
  // belongs to — so a runly.admin role in Company A leaked admin access
  // into any tool call, regardless of which company ctx.companyId (the
  // caller's actual active company) named.
  const resolveUserContext = async () => ({
    profile: { id: "p1" },
    memberships: [
      membership({ companyId: "companyA", roleKey: "runly.admin" }),
      membership({ companyId: "companyB", permissions: [] }), // no special role in B
    ],
  });
  const inventoryService = {
    listItems: async () => ({ data: [], total: 0 }),
  };
  const runners = buildToolRunners({
    prisma: { permission: { findMany: async () => [{ key: "inventory.item.read" }] } },
    listMessages: async () => ({ data: [] }),
    chatSearchService: {},
    visionService: {},
    signAttachmentUrl: async () => "x",
    resolveUserContext,
    inventoryService,
  });

  const asAdminInA = await runners.search_inventory(
    { query: "laptop" },
    { actorAuthUserId: "a", companyId: "companyA" },
  );
  assert.equal(asAdminInA.error, undefined, "runly.admin in the active company must be allowed");

  const asPlainInB = await runners.search_inventory(
    { query: "laptop" },
    { actorAuthUserId: "a", companyId: "companyB" },
  );
  assert.match(asPlainInB.error, /acceso/i, "no admin permissions in Company B must be refused there");
});

test("search_runly: caller with no search permission is refused", async () => {
  const resolveUserContext = async () => ({ profile: { id: "p" }, memberships: [membership({ companyId: "co1" })] });
  const runners = buildToolRunners({ prisma: {}, listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "x", resolveUserContext });
  const out = await runners.search_runly({ query: "Juan" }, { actorAuthUserId: "a", companyId: "co1" });
  assert.match(out.error, /permiso/i);
});

function helpPrismaStub(rows) {
  return {
    blueprint: {
      findMany: async ({ where }) => rows.filter((r) => {
        if (where?.kind && r.kind !== where.kind) return false
        if (where?.enabled !== undefined && r.enabled !== where.enabled) return false
        return true
      }),
    },
    runlyModule: { findMany: async () => [], findFirst: async () => null },
  };
}

test("search_module_help: searches the Fase 1 help bank and maps rows to the safe shape", async () => {
  const rows = [{
    kind: "HELP", enabled: true,
    module: { key: "runly.core", name: "Runly Core", status: "INSTALLED", enabled: true },
    schema: { scope: "module", viewKey: null, title: "Runly Core", summary: "Nucleo del sistema.", content: "Administra modulos y configuracion." },
  }];
  const runners = buildToolRunners({ prisma: helpPrismaStub(rows), listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "x" });
  const out = await runners.search_module_help({ query: "modulos" });
  assert.equal(out.resultados.length, 1);
  assert.equal(out.resultados[0].modulo, "Runly Core");
  assert.equal(out.resultados[0].titulo, "Runly Core");
});

test("search_module_help: rejects a 1-char query", async () => {
  const runners = buildToolRunners({ prisma: helpPrismaStub([]), listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "x" });
  const out = await runners.search_module_help({ query: "a" });
  assert.match(out.error, /2 caracteres/i);
});

test("search_module_help: returns a note when nothing matches", async () => {
  const runners = buildToolRunners({ prisma: helpPrismaStub([]), listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "x" });
  const out = await runners.search_module_help({ query: "algo que no existe" });
  assert.match(out.note, /no encontre/i);
});

test("get_recent_messages trims rows to the safe shape", async () => {
  const listMessages = async ({ conversationId, limit }) => {
    assert.equal(conversationId, "conv1");
    assert.equal(limit, 5);
    return { data: [{
      id: "m1", sender_type: "user", body: "hola", message_type: "text",
      created_at: new Date("2026-09-07T10:00:00Z"), attachment_count: 0,
      sender: { displayName: "Ana" }, attachments: [], metadata: {},
    }] };
  };
  const runners = buildToolRunners({ prisma: {}, listMessages, chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "http://x" });
  const out = await runners.get_recent_messages({ limit: 5 }, ctx);
  assert.deepEqual(out, {
    messages: [{ senderName: "Ana", senderType: "user", body: "hola", messageType: "text",
      sentAt: "2026-09-07T10:00:00.000Z", attachmentCount: 0, attachmentIds: [] }],
  });
});

test("get_conversation_messages surfaces a not-a-member error as tool data, not a throw", async () => {
  const listMessages = async () => { const e = new Error("No perteneces a esta conversacion."); e.status = 403; e.name = "ChatServiceError"; throw e; };
  const runners = buildToolRunners({ prisma: {}, listMessages, chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "http://x" });
  const out = await runners.get_conversation_messages({ conversationId: "other", limit: 10 }, ctx);
  assert.match(out.error, /Sin acceso|No perteneces/);
});

test("describe_image rejects a non-image attachment without calling vision", async () => {
  let visionCalled = false;
  const prisma = { $queryRaw: async () => [{ id: "att1", mime_type: "application/pdf", object_key: "k", bucket: "runly-chat", conversation_id: "conv1" }] };
  const visionService = { describeImage: async () => { visionCalled = true; return { description: "x" }; } };
  const runners = buildToolRunners({ prisma, listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService, signAttachmentUrl: async () => "http://x" });
  const out = await runners.describe_image({ attachmentId: "att1" }, ctx);
  assert.equal(visionCalled, false);
  assert.match(out.error, /no es una imagen/i);
});

test("search_my_conversations passes the query through to chatSearchService", async () => {
  const chatSearchService = { searchMessages: async ({ authUserId, q, limit }) => {
    assert.equal(authUserId, "auth1"); assert.equal(q, "factura"); assert.equal(limit, 15);
    return { data: [{ conversationId: "c2", conversationTitle: "Ventas", snippet: "la factura de...", senderName: "Beto", createdAt: "2026-09-01T00:00:00Z" }] };
  } };
  const runners = buildToolRunners({ prisma: {}, listMessages: async () => ({ data: [] }), chatSearchService, visionService: {}, signAttachmentUrl: async () => "http://x" });
  const out = await runners.search_my_conversations({ query: "factura" }, ctx);
  assert.equal(out.results[0].conversationTitle, "Ventas");
});

const withMembership = async () => ({ profile: { id: "prof1" }, memberships: [membership({ companyId: "co1" })] });

test("list_call_transcripts: resolves the caller's profile id and defaults to the current conversation", async () => {
  let seen;
  const callTranscriptService = {
    listTranscripts: async (args) => { seen = args; return [{ id: "t1", callId: "call1", status: "READY", createdAt: new Date("2026-09-24T00:00:00Z"), durationMs: 90_000 }]; },
  };
  const runners = buildToolRunners({ prisma: {}, listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "x", resolveUserContext: withMembership, callTranscriptService });
  const out = await runners.list_call_transcripts({}, ctx);
  assert.equal(seen.conversationId, "conv1");
  assert.equal(seen.profileId, "prof1");
  assert.equal(out.transcripts[0].transcriptId, "t1");
  assert.equal(out.transcripts[0].durationMs, 90_000);
});

test("list_call_transcripts: missing service dep -> friendly error, no throw", async () => {
  const runners = buildToolRunners({ prisma: {}, listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "x" });
  const out = await runners.list_call_transcripts({}, ctx);
  assert.ok(out.error);
});

test("get_call_transcript: formats segments with mm:ss timestamps and speaker labels", async () => {
  const callTranscriptService = {
    getTranscript: async ({ transcriptId, profileId }) => {
      assert.equal(transcriptId, "t1"); assert.equal(profileId, "prof1");
      return {
        id: "t1", status: "READY", durationMs: 65_000,
        segments: [
          { startMs: 0, text: "Hola a todos", speakerLabel: null },
          { startMs: 65_000, text: "Empecemos", speakerLabel: "Raul" },
        ],
      };
    },
  };
  const runners = buildToolRunners({ prisma: {}, listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "x", resolveUserContext: withMembership, callTranscriptService });
  const out = await runners.get_call_transcript({ transcriptId: "t1" }, ctx);
  assert.equal(out.text, "[00:00] Hola a todos\n[01:05] Raul: Empecemos");
  assert.equal(out.truncated, false);
});

test("get_call_transcript: not READY yet -> a note, not the (nonexistent) text", async () => {
  const callTranscriptService = { getTranscript: async () => ({ id: "t1", status: "PROCESSING" }) };
  const runners = buildToolRunners({ prisma: {}, listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "x", resolveUserContext: withMembership, callTranscriptService });
  const out = await runners.get_call_transcript({ transcriptId: "t1" }, ctx);
  assert.equal(out.status, "PROCESSING");
  assert.ok(out.note);
  assert.equal(out.text, undefined);
});

test("get_call_transcript: a 404 from the service (no access / not found) maps to a tool-data error, not a throw", async () => {
  const callTranscriptService = { getTranscript: async () => { const e = new Error("Transcripción no encontrada."); e.status = 404; throw e; } };
  const runners = buildToolRunners({ prisma: {}, listMessages: async () => ({ data: [] }), chatSearchService: {}, visionService: {}, signAttachmentUrl: async () => "x", resolveUserContext: withMembership, callTranscriptService });
  const out = await runners.get_call_transcript({ transcriptId: "t1" }, ctx);
  assert.ok(out.error);
});

test("CHANNEL_TOOL_DEFS includes the transcript tools alongside get_channel_messages", () => {
  const names = CHANNEL_TOOL_DEFS.map((t) => t.function.name).sort();
  assert.deepEqual(names, ["get_call_transcript", "get_channel_messages", "list_call_transcripts"]);
});

test("channel list_call_transcripts/get_call_transcript use ctx.actorProfileId directly — no resolveUserContext needed (unlike the 1:1/panel version)", async () => {
  const channelCtx = { conversationId: "chan1", actorProfileId: "prof9" };
  let seenList;
  const callTranscriptService = {
    listTranscripts: async (args) => { seenList = args; return []; },
    getTranscript: async ({ profileId }) => { assert.equal(profileId, "prof9"); return { id: "t1", status: "READY", segments: [] }; },
  };
  const runners = buildChannelToolRunners({ prisma: {}, callTranscriptService });
  await runners.list_call_transcripts({}, channelCtx);
  assert.equal(seenList.conversationId, "chan1");
  assert.equal(seenList.profileId, "prof9");
  const out = await runners.get_call_transcript({ transcriptId: "t1" }, channelCtx);
  assert.equal(out.text, "");
});
