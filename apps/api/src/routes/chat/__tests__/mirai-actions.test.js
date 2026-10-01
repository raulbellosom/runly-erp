import test from "node:test";
import assert from "node:assert/strict";
import { createMiraiActionRegistry } from "../mirai-action-registry.js";
import { createMiraiProposalService } from "../mirai-proposal-service.js";
import { buildActionToolRunners } from "../mirai-action-tools.js";

const PID = "11111111-1111-1111-1111-111111111111";
const scopeWith = (perms) => async () => ({ companyId: "co1", userId: "prof1", isAdmin: false, permissionSet: new Set(perms), uctx: { profile: { id: "prof1" } } });
const ctx = { companyId: "co1", actorProfileId: "prof1", actorAuthUserId: "auth1", conversationId: "conv1", surface: "direct" };

function fakeAction(over = {}) {
  const calls = { prepare: 0, execute: 0 };
  return {
    calls,
    key: "calendar.event.create", moduleKey: "runly.calendar", operation: "create", permission: "calendar.events.create",
    label: "Crear evento", description: "d", parameters: {},
    prepare: async () => { calls.prepare++; return { input: { a: 1 }, preview: { title: "Crear evento", fields: [] } }; },
    execute: async () => { calls.execute++; return { id: "ev1", summary: "Evento creado" }; },
    ...over,
  };
}

function fakePrisma({ installed = ["runly.calendar"], row = null } = {}) {
  const state = { sql: [], audit: [], row };
  const text = (s) => s.join("?");
  return {
    state,
    runlyModule: { findMany: async () => installed.map((key) => ({ key })) },
    auditLog: { create: async ({ data }) => { state.audit.push(data); } },
    $executeRaw: async (s) => { state.sql.push(text(s)); return 1; },
    $queryRaw: async (s, ...v) => {
      const q = text(s); state.sql.push(q);
      if (q.startsWith("\n      INSERT INTO mirai_action_proposals")) return [{ id: PID, preview: JSON.parse(v[9]) }];
      if (q.includes("SELECT * FROM mirai_action_proposals")) return state.row ? [state.row] : [];
      if (q.includes("SET status = 'executing'")) return state.row?.status === "pending" ? [{ ...state.row, status: "executing" }] : [];
      if (q.includes("SET status = ?")) { state.row = { ...state.row, status: v[0], error: v[2] }; return [state.row]; }
      return [];
    },
  };
}

const pendingRow = (over = {}) => ({
  id: PID, company_id: "co1", actor_profile_id: "prof1", conversation_id: "conv1", surface: "direct",
  action_key: "calendar.event.create", operation: "create", target_id: null, input: { a: 1 },
  preview: { title: "Crear evento", fields: [] }, destructive: false, status: "pending",
  expires_at: new Date(Date.now() + 60_000), created_at: new Date(), ...over,
});

test("registry hides actions without permission or with the module disabled", async () => {
  const action = fakeAction();
  const prisma = fakePrisma();
  const noPerm = createMiraiActionRegistry({ prisma, resolveScopedErpContext: scopeWith([]), actions: [action] });
  assert.equal((await noPerm.listAvailable(ctx)).actions.length, 0);
  const disabled = createMiraiActionRegistry({ prisma: fakePrisma({ installed: [] }), resolveScopedErpContext: scopeWith(["calendar.events.create"]), actions: [action] });
  assert.equal((await disabled.listAvailable(ctx)).actions.length, 0);
  const ok = createMiraiActionRegistry({ prisma, resolveScopedErpContext: scopeWith(["calendar.events.create"]), actions: [action] });
  assert.equal((await ok.listAvailable(ctx)).actions.length, 1);
});

test("propose runs prepare only, supersedes the previous pending one and stores the proposal", async () => {
  const action = fakeAction();
  const prisma = fakePrisma();
  const registry = createMiraiActionRegistry({ prisma, resolveScopedErpContext: scopeWith(["calendar.events.create"]), actions: [action] });
  const svc = createMiraiProposalService({ prisma, registry });
  const out = await svc.propose(ctx, { actionKey: "calendar.event.create", args: {} });
  assert.equal(out.proposalId, PID);
  assert.deepEqual(action.calls, { prepare: 1, execute: 0 });
  assert.ok(prisma.state.sql.some((q) => q.includes("SET status = 'superseded'")));
});

test("confirm rejects another actor with 404 and a non-pending proposal with 409", async () => {
  const prisma = fakePrisma({ row: pendingRow({ actor_profile_id: "other" }) });
  const registry = createMiraiActionRegistry({ prisma, resolveScopedErpContext: scopeWith(["calendar.events.create"]), actions: [fakeAction()] });
  const svc = createMiraiProposalService({ prisma, registry });
  await assert.rejects(svc.confirm(PID, ctx), (e) => e.status === 404);
  prisma.state.row = pendingRow({ status: "executed" });
  await assert.rejects(svc.confirm(PID, ctx), (e) => e.status === 409);
});

test("confirm re-checks permission: lost permission fails without executing", async () => {
  const action = fakeAction();
  const prisma = fakePrisma({ row: pendingRow() });
  const registry = createMiraiActionRegistry({ prisma, resolveScopedErpContext: scopeWith([]), actions: [action] });
  const notes = [];
  const svc = createMiraiProposalService({ prisma, registry, postNote: async (n) => notes.push(n.text) });
  const out = await svc.confirm(PID, ctx);
  assert.equal(out.status, "failed");
  assert.equal(action.calls.execute, 0);
  assert.match(notes[0], /No se pudo ejecutar/);
});

test("confirm executes, audits and posts the confirmation note", async () => {
  const action = fakeAction();
  const prisma = fakePrisma({ row: pendingRow() });
  const registry = createMiraiActionRegistry({ prisma, resolveScopedErpContext: scopeWith(["calendar.events.create"]), actions: [action] });
  const notes = [];
  const svc = createMiraiProposalService({ prisma, registry, postNote: async (n) => notes.push(n.text) });
  const out = await svc.confirm(PID, ctx);
  assert.equal(out.status, "executed");
  assert.equal(action.calls.execute, 1);
  assert.equal(prisma.state.audit[0].action, "mirai.action.calendar.event.create");
  assert.equal(notes[0], "Confirmado: Evento creado");
});

test("propose_action stores the proposal id on the turn ctx; list_actions filters by module", async () => {
  const registry = { listAvailable: async () => ({ scope: {}, actions: [fakeAction(), fakeAction({ key: "x.y", moduleKey: "runly.x" })] }) };
  const proposalService = { propose: async () => ({ status: "pending_confirmation", proposalId: PID }), cancelPending: async () => ({ cancelled: 1 }) };
  const r = buildActionToolRunners({ registry, proposalService });
  const listed = await r.list_actions({ module: "runly.calendar" }, {});
  assert.deepEqual(listed.acciones.map((a) => a.actionKey), ["calendar.event.create"]);
  const turn = {};
  await r.propose_action({ actionKey: "calendar.event.create", args: {} }, turn);
  assert.equal(turn.proposalId, PID);
  await r.cancel_proposal({}, turn);
  assert.equal(turn.proposalId, null);
});
