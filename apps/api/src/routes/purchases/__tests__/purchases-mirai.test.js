import test from "node:test";
import assert from "node:assert/strict";
import { createPurchasesMiraiQueries } from "../purchases-mirai-queries.js";
import { createPurchasesMiraiActions } from "../mirai-actions.js";
import { createPublicLookup } from "../../../services/ai/public-lookup.js";

const actx = { companyId: "co1", actorProfileId: "me" };

function fakeWorkflow({ throwFor = null } = {}) {
  return {
    async assertCapability(companyId, gate) {
      if (throwFor && JSON.stringify(gate) === JSON.stringify(throwFor)) {
        const err = new Error("Esta función está deshabilitada en el flujo de compras.");
        throw err;
      }
    },
    async getCapabilities() {
      return { capabilities: { invoices: true } };
    },
  };
}

function fakeListing(rows = [{ id: "o1", number: "OC-1", status: "ISSUED", supplierName: "ACME", total: 100, currency: "MXN", date: "2026-10-01", path: "/purchases/orders/o1" }]) {
  return { async list() { return { data: rows, total: rows.length }; } };
}

function fakeAssistantContext() {
  return {
    async pendingActions() {
      return { pendingApprovals: 2, draftOrders: 1, overdueInvoices: [{ number: "FAC-1" }], awaitingReceipt: [{ number: "OC-2" }] };
    },
  };
}

function fakeProcurement() {
  const calls = [];
  return {
    calls,
    async createRequest(companyId, actorId, input) { calls.push(["createRequest", input]); return { id: "req1", number: "SOL-000001", title: input.title }; },
    async decideApproval(companyId, actorId, id, data) { calls.push(["decideApproval", id, data]); return { id, status: data.decision }; },
    async listApprovals() {
      return { total: 1, data: [{ id: "ap1", ownerKind: "orders", ownerNumber: "OC-1", supplierName: "ACME", ownerTotal: 100, currency: "MXN", reason: "monto alto", caseNumber: "EXP-1", ownerPath: "/purchases/orders/o1" }] };
    },
  };
}

function fakeReceipts() {
  const calls = [];
  return { calls, async create(companyId, actorId, input) { calls.push(["create", input]); return { id: "rec1", number: "REC-000001" }; } };
}

function contactPrisma(matches) {
  return { contact: { findMany: async () => matches } };
}

// ── tools ───────────────────────────────────────────────────────────────────

test("purchases_pending maps the assistant context counts and lists", async () => {
  const [pending] = createPurchasesMiraiQueries({ prisma: {}, workflow: fakeWorkflow(), procurement: fakeProcurement(), listing: fakeListing(), assistantContext: fakeAssistantContext() });
  const out = await pending.run({}, actx);
  assert.equal(out.aprobacionesPendientes, 2);
  assert.equal(out.ordenesEnBorrador, 1);
  assert.deepEqual(out.facturasVencidas, [{ number: "FAC-1" }]);
});

test("purchases_search_documents: capability-disabled gate returns an error, not a throw", async () => {
  const [, search] = createPurchasesMiraiQueries({
    prisma: contactPrisma([]), workflow: fakeWorkflow({ throwFor: "requests" }), procurement: fakeProcurement(), listing: fakeListing(), assistantContext: fakeAssistantContext(),
  });
  const out = await search.run({ kind: "requests" }, actx);
  assert.ok(out.error);
});

test("purchases_search_documents: ambiguous supplier name lists the matches", async () => {
  const [, search] = createPurchasesMiraiQueries({
    prisma: contactPrisma([{ id: "s1", name: "Acero del Norte" }, { id: "s2", name: "Acero Industrial" }]),
    workflow: fakeWorkflow(), procurement: fakeProcurement(), listing: fakeListing(), assistantContext: fakeAssistantContext(),
  });
  const out = await search.run({ supplierName: "Acero" }, actx);
  assert.ok(out.error.includes("Acero del Norte"));
});

test("purchases_search_documents: happy path returns total and stable ids", async () => {
  const [, search] = createPurchasesMiraiQueries({
    prisma: contactPrisma([]), workflow: fakeWorkflow(), procurement: fakeProcurement(), listing: fakeListing(), assistantContext: fakeAssistantContext(),
  });
  const out = await search.run({ kind: "orders" }, actx);
  assert.equal(out.total, 1);
  assert.equal(out.documentos[0].documentId, "o1");
});

test("purchases_list_approvals exposes approvalId for follow-up decisions", async () => {
  const [, , listApprovals] = createPurchasesMiraiQueries({ prisma: {}, workflow: fakeWorkflow(), procurement: fakeProcurement(), listing: fakeListing(), assistantContext: fakeAssistantContext() });
  const out = await listApprovals.run({}, actx);
  assert.equal(out.total, 1);
  assert.equal(out.aprobaciones[0].approvalId, "ap1");
});

test("purchases_spend_summary: custom range groups by supplier and computes the comparison", async () => {
  const rows = { current: [{ supplierId: "s1", total: 300, currency: "MXN", status: "PENDING", issueDate: new Date("2026-07-15") }], previous: [{ supplierId: "s1", total: 200, currency: "MXN", status: "PENDING", issueDate: new Date("2026-04-15") }] };
  let call = 0;
  const prisma = {
    purchaseInvoice: { findMany: async () => (call++ === 0 ? rows.current : rows.previous) },
    contact: { findMany: async () => [{ id: "s1", name: "ACME" }] },
  };
  const [, , , spend] = createPurchasesMiraiQueries({ prisma, workflow: fakeWorkflow(), procurement: fakeProcurement(), listing: fakeListing(), assistantContext: fakeAssistantContext() });
  const out = await spend.run({ from: "2026-07-01", to: "2026-09-30", groupBy: "supplier" }, actx);
  assert.equal(out.actual.total, 300);
  assert.equal(out.anterior.total, 200);
  assert.equal(out.variacionPct, 50);
  assert.equal(out.actual.grupos[0].grupo, "ACME");
});

test("purchases_public_supplier_info: errors when lookup is disabled or the supplier is not found", async () => {
  const disabled = createPublicLookup({ search: null, env: {} });
  const [, , , , lookup1] = createPurchasesMiraiQueries({ prisma: {}, workflow: fakeWorkflow(), procurement: fakeProcurement(), listing: fakeListing(), assistantContext: fakeAssistantContext(), publicLookup: disabled });
  assert.ok((await lookup1.run({ supplierId: "s1" }, actx)).error);

  const enabled = createPublicLookup({ search: async () => ({ results: [] }) });
  const prisma = { contact: { findFirst: async () => null } };
  const [, , , , lookup2] = createPurchasesMiraiQueries({ prisma, workflow: fakeWorkflow(), procurement: fakeProcurement(), listing: fakeListing(), assistantContext: fakeAssistantContext(), publicLookup: enabled });
  assert.ok((await lookup2.run({ supplierId: "s1" }, { ...actx, turn: {} })).error);
});

// ── actions ─────────────────────────────────────────────────────────────────

test("purchases.request.create: prepare writes nothing; execute calls the service", async () => {
  const procurement = fakeProcurement();
  const actions = Object.fromEntries(createPurchasesMiraiActions({ prisma: {}, procurement, receipts: fakeReceipts() }).map((a) => [a.key, a]));
  const prepared = await actions["purchases.request.create"].prepare({ title: "Laptops para el equipo" });
  assert.equal(prepared.input.title, "Laptops para el equipo");
  assert.equal(procurement.calls.length, 0);
  const res = await actions["purchases.request.create"].execute(prepared.input, actx);
  assert.equal(res.id, "req1");
  assert.deepEqual(procurement.calls[0], ["createRequest", prepared.input]);
});

test("purchases.approval.decide: prepare rejects an already-resolved approval", async () => {
  const prisma = { purchaseApproval: { findFirst: async () => ({ id: "ap1", status: "APPROVED", reason: "x" }) } };
  const actions = Object.fromEntries(createPurchasesMiraiActions({ prisma, procurement: fakeProcurement(), receipts: fakeReceipts() }).map((a) => [a.key, a]));
  const out = await actions["purchases.approval.decide"].prepare({ approvalId: "ap1", decision: "APPROVED" }, actx);
  assert.ok(out.error);
});

test("purchases.approval.decide: execute calls decideApproval with the decision", async () => {
  const prisma = { purchaseApproval: { findFirst: async () => ({ id: "ap1", status: "PENDING", reason: "monto alto" }) } };
  const procurement = fakeProcurement();
  const actions = Object.fromEntries(createPurchasesMiraiActions({ prisma, procurement, receipts: fakeReceipts() }).map((a) => [a.key, a]));
  const prepared = await actions["purchases.approval.decide"].prepare({ approvalId: "ap1", decision: "REJECTED" }, actx);
  assert.equal(prepared.targetId, "ap1");
  await actions["purchases.approval.decide"].execute(prepared.input, actx);
  assert.deepEqual(procurement.calls[0], ["decideApproval", "ap1", { decision: "REJECTED", comment: null }]);
});

test("purchases.receipt.create: prepare defaults to the full pending quantity of every line", async () => {
  const prisma = {
    purchaseOrder: { findFirst: async () => ({ id: "o1", number: "OC-1", status: "ISSUED" }) },
    purchaseLine: { findMany: async () => [{ id: "l1", description: "Laptop", quantity: 5, receivedQuantity: 2 }] },
  };
  const actions = Object.fromEntries(createPurchasesMiraiActions({ prisma, procurement: fakeProcurement(), receipts: fakeReceipts() }).map((a) => [a.key, a]));
  const prepared = await actions["purchases.receipt.create"].prepare({ orderNumber: "OC-1" }, actx);
  assert.deepEqual(prepared.input.lines, [{ orderLineId: "l1", quantity: 3 }]);
});

test("purchases.receipt.create: errors when the order has nothing pending", async () => {
  const prisma = {
    purchaseOrder: { findFirst: async () => ({ id: "o1", number: "OC-1", status: "ISSUED" }) },
    purchaseLine: { findMany: async () => [{ id: "l1", description: "Laptop", quantity: 5, receivedQuantity: 5 }] },
  };
  const actions = Object.fromEntries(createPurchasesMiraiActions({ prisma, procurement: fakeProcurement(), receipts: fakeReceipts() }).map((a) => [a.key, a]));
  const out = await actions["purchases.receipt.create"].prepare({ orderNumber: "OC-1" }, actx);
  assert.ok(out.error);
});

test("purchases.receipt.create: execute calls receipts.create", async () => {
  const receipts = fakeReceipts();
  const actions = Object.fromEntries(createPurchasesMiraiActions({ prisma: {}, procurement: fakeProcurement(), receipts }).map((a) => [a.key, a]));
  const res = await actions["purchases.receipt.create"].execute({ orderId: "o1", lines: [{ orderLineId: "l1", quantity: 3 }], notes: null }, actx);
  assert.equal(res.id, "rec1");
  assert.equal(receipts.calls[0][0], "create");
});
