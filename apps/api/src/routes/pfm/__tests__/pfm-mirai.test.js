import test from "node:test";
import assert from "node:assert/strict";
import { createPfmMiraiQueries } from "../pfm-mirai-queries.js";
import { createPfmMiraiActions } from "../mirai-actions.js";
import { createPfmMiraiCapabilities } from "../mirai-capabilities.js";

const actx = { companyId: "co1", actorProfileId: "me" };

const WALLET = { id: "w1", name: "Tarjeta BBVA", kind: "CREDIT", currency: "MXN", currentBalance: -500, creditLimit: 10000, ledgerAccountId: null };
const BANK_WALLET = { id: "w2", name: "Cuenta banco", kind: "DEBIT", currency: "MXN", currentBalance: 1000, ledgerAccountId: "acc1" };

function fakeWalletsService({ list = [WALLET], writable = new Set(["w1"]) } = {}) {
  return {
    listWallets: async () => ({ data: list }),
    canWriteWallet: async ({ walletId }) => writable.has(walletId),
    getWallet: async ({ walletId }) => list.find((w) => w.id === walletId) ?? null,
  };
}

function fakeCategoriesService(data = [{ id: "c1", name: "Comida", kind: "EXPENSE" }]) {
  return { listCategories: async () => ({ data }) };
}

// ── queries ──────────────────────────────────────────────────────────────

test("pfm_list_wallets maps wallet fields and flags bank-linked wallets", async () => {
  const wallets = fakeWalletsService({ list: [WALLET, BANK_WALLET] });
  const [, pfm_list_wallets] = createPfmMiraiQueries({ prisma: {}, summary: {}, wallets, budgets: {}, categories: {} });
  const out = await pfm_list_wallets.run({}, actx);
  assert.deepEqual(out.map((w) => w.bankLinked), [false, true]);
  assert.equal(out[0].walletId, "w1");
});

test("pfm_overview defaults to the current month and delegates to summary.getOverview", async () => {
  let seenMonth = null;
  const summary = { getOverview: async ({ month }) => { seenMonth = month; return { month }; } };
  const [pfm_overview] = createPfmMiraiQueries({ prisma: {}, summary, wallets: fakeWalletsService(), budgets: {}, categories: {} });
  await pfm_overview.run({}, actx);
  assert.match(seenMonth, /^\d{4}-\d{2}$/);
});

test("pfm_search_movements scopes to readable wallets only and reports an error for an unreadable wallet", async () => {
  const wallets = fakeWalletsService({ list: [WALLET] });
  const calls = [];
  const prisma = { $queryRaw: async (...args) => { calls.push(args); return []; } };
  const [, , pfm_search_movements] = createPfmMiraiQueries({ prisma, summary: {}, wallets, budgets: {}, categories: {} });
  const out = await pfm_search_movements.run({ walletId: "11111111-1111-1111-8111-111111111111" }, actx);
  assert.equal(out.error, "Cartera no encontrada.");
  assert.equal(calls.length, 0);
});

test("pfm_spending_summary groups by currency and computes a previous-period comparison", async () => {
  const wallets = fakeWalletsService({ list: [WALLET] });
  const rows = {
    "2026-09-01": [{ grupo: "Comida", moneda: "MXN", total: 300 }],
    "2026-08-02": [{ grupo: "Comida", moneda: "MXN", total: 200 }],
  };
  const prisma = {
    $queryRaw: async (strings, ...values) => {
      const start = values.find((v) => /^\d{4}-\d{2}-\d{2}$/.test(v));
      return rows[start] ?? [];
    },
  };
  const [, , , pfm_spending_summary] = createPfmMiraiQueries({ prisma, summary: {}, wallets, budgets: {}, categories: {} });
  const out = await pfm_spending_summary.run({ from: "2026-09-01", to: "2026-09-30", groupBy: "category", compareWithPrevious: true }, actx);
  const g = out.grupos.find((x) => x.grupo === "Comida");
  assert.equal(g.actual, 300);
  assert.equal(g.anterior, 200);
  assert.equal(g.diferencia, 100);
  assert.equal(g.porcentaje, 50);
});

test("pfm_spending_summary: porcentaje is null when the previous period is zero", async () => {
  const wallets = fakeWalletsService({ list: [WALLET] });
  const prisma = {
    $queryRaw: async (strings, ...values) => {
      const start = values.find((v) => /^\d{4}-\d{2}-\d{2}$/.test(v));
      return start === "2026-09-01" ? [{ grupo: "Comida", moneda: "MXN", total: 300 }] : [];
    },
  };
  const [, , , pfm_spending_summary] = createPfmMiraiQueries({ prisma, summary: {}, wallets, budgets: {}, categories: {} });
  const out = await pfm_spending_summary.run({ from: "2026-09-01", to: "2026-09-30", groupBy: "category", compareWithPrevious: true }, actx);
  assert.equal(out.grupos[0].porcentaje, null);
});

// ── actions ──────────────────────────────────────────────────────────────

test("pfm.movement.create: resolves the single writable non-bank wallet and does not write in prepare", async () => {
  const wallets = fakeWalletsService({ list: [WALLET, BANK_WALLET], writable: new Set(["w1", "w2"]) });
  const calls = [];
  const movements = { createMovement: async (args) => { calls.push(args); return { id: "m1", amount: 250, merchant: args.data.merchant }; } };
  const actions = Object.fromEntries(createPfmMiraiActions({ wallets, movements, categories: fakeCategoriesService() }).map((a) => [a.key, a]));
  const out = await actions["pfm.movement.create"].prepare({ direction: "EXPENSE", amount: 250, merchant: "Gasolinera" }, actx);
  assert.equal(out.input.walletId, "w1");
  assert.equal(calls.length, 0);
  assert.ok(out.preview.fields.some((f) => f.label === "Cartera" && f.value === "Tarjeta BBVA"));
});

test("pfm.movement.create: rejects a bank-linked wallet with the standard message", async () => {
  const wallets = fakeWalletsService({ list: [BANK_WALLET], writable: new Set(["w2"]) });
  const actions = Object.fromEntries(createPfmMiraiActions({ wallets, movements: {}, categories: fakeCategoriesService() }).map((a) => [a.key, a]));
  const out = await actions["pfm.movement.create"].prepare({ wallet: "Cuenta banco", direction: "EXPENSE", amount: 100 }, actx);
  assert.match(out.error, /Libro de cuentas/);
});

test("pfm.movement.create: execute calls movements.createMovement", async () => {
  const wallets = fakeWalletsService();
  const calls = [];
  const movements = { createMovement: async (args) => { calls.push(args); return { id: "m1", amount: 250, merchant: "Gasolinera" }; } };
  const actions = Object.fromEntries(createPfmMiraiActions({ wallets, movements, categories: fakeCategoriesService() }).map((a) => [a.key, a]));
  const prepared = await actions["pfm.movement.create"].prepare({ direction: "EXPENSE", amount: 250, merchant: "Gasolinera" }, actx);
  const res = await actions["pfm.movement.create"].execute(prepared.input, actx);
  assert.equal(res.id, "m1");
  assert.equal(calls.length, 1);
  assert.match(res.summary, /Tarjeta BBVA/);
});

test("pfm.movement.update: preview includes before/after for a changed amount", async () => {
  const wallets = fakeWalletsService();
  const movements = {
    getOwnedMovement: async () => ({ id: "m1", walletId: "w1", direction: "EXPENSE", amount: 100, occurredOn: new Date("2026-09-01T00:00:00Z"), merchant: "Gasolinera", note: null, categoryId: null }),
    updateMovement: async () => ({ id: "m1", amount: 150 }),
  };
  const actions = Object.fromEntries(createPfmMiraiActions({ wallets, movements, categories: fakeCategoriesService() }).map((a) => [a.key, a]));
  const out = await actions["pfm.movement.update"].prepare({ movementId: "m1", amount: 150 }, actx);
  assert.ok(out.preview.fields.some((f) => f.label === "Monto" && f.before && f.value));
});

test("pfm.movement.delete: destructive, loads the movement and sets enabled=false on execute", async () => {
  const wallets = fakeWalletsService();
  const calls = [];
  const movements = {
    getOwnedMovement: async () => ({ id: "m1", walletId: "w1", merchant: "Gasolinera", note: null, amount: 100, occurredOn: new Date("2026-09-01T00:00:00Z") }),
    setMovementEnabled: async (args) => { calls.push(args); },
  };
  const actions = Object.fromEntries(createPfmMiraiActions({ wallets, movements, categories: fakeCategoriesService() }).map((a) => [a.key, a]));
  const prepared = await actions["pfm.movement.delete"].prepare({ movementId: "m1" }, actx);
  assert.equal(prepared.targetId, "m1");
  await actions["pfm.movement.delete"].execute(prepared.input, actx);
  assert.equal(calls[0].enabled, false);
});

// ── capability wiring ────────────────────────────────────────────────────

test("createPfmMiraiCapabilities exposes 7 tools and 3 actions under runly.pfm", async () => {
  const cap = createPfmMiraiCapabilities({ prisma: { $queryRaw: async () => [] } });
  assert.equal(cap.moduleKey, "runly.pfm");
  assert.equal(cap.tools.length, 7);
  assert.equal(cap.actions.length, 3);
  assert.deepEqual(cap.publicLookup, []);
});

test("describeContext: generic line outside a wallet record", async () => {
  const cap = createPfmMiraiCapabilities({ prisma: { $queryRaw: async () => [] } });
  const line = await cap.describeContext({}, actx);
  assert.equal(line, "El usuario esta en el modulo Finanzas personales.");
});
