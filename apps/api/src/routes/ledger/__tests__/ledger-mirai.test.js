// apps/api/src/routes/ledger/__tests__/ledger-mirai.test.js
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createLedgerMiraiQueries } from "../ledger-mirai-queries.js";
import { createLedgerMiraiActions } from "../mirai-actions.js";
import { createLedgerMiraiCapabilities } from "../mirai-capabilities.js";

const actx = {
  companyId: "co1", actorProfileId: "me", actorProfile: { id: "me", displayName: "Yo" },
  turn: { actorAuthUserId: "auth1", companyId: "co1" },
};
const TX1 = "00000000-0000-0000-0000-000000000001";

function fakeLedgerService({ accounts = [], txById = new Map() } = {}) {
  return {
    async listAccounts() { return { data: accounts }; },
    async getAccount({ accountId }) {
      const a = accounts.find((x) => x.id === accountId);
      if (!a) throw new Error("not found");
      return a;
    },
    async canWriteAccount({ accountId }) { return accounts.some((a) => a.id === accountId); },
    async createTransaction({ accountId, data }) { return { id: "tx-new", account_id: accountId, ...data }; },
    async updateTransaction({ transactionId, data }) {
      const tx = txById.get(transactionId);
      return { ...tx, ...data, id: transactionId };
    },
    async setTransactionEnabled({ transactionId, enabled }) {
      const tx = txById.get(transactionId);
      return { ...tx, id: transactionId, enabled };
    },
  };
}

function fakeCategoriesService(rows = []) {
  return { async listCategories() { return { data: rows }; } };
}

function fakeEffects() {
  const calls = [];
  return {
    calls,
    afterCreateTransaction: async () => calls.push("create"),
    afterSetTransactionEnabled: async () => calls.push("setEnabled"),
  };
}

// ── Tools ──────────────────────────────────────────────────────────────────

test("ledger_accounts: lists readable accounts with exact balances, replacing list_bank_accounts", async () => {
  const accounts = [{ id: "a1", name: "Cuenta BBVA", bank: "BBVA", currency: "MXN", current_balance: 1000 }];
  const [accountsTool] = createLedgerMiraiQueries({ prisma: {}, ledgerService: fakeLedgerService({ accounts }), categoriesService: fakeCategoriesService() });
  const out = await accountsTool.run({}, actx);
  assert.equal(out.cuentas[0].accountId, "a1");
  assert.equal(out.cuentas[0].saldo, 1000);
});

test("ledger_search_transactions: unknown account name errors instead of guessing", async () => {
  const accounts = [{ id: "a1", name: "BBVA", bank: "BBVA", currency: "MXN", current_balance: 0 }];
  const [, search] = createLedgerMiraiQueries({ prisma: {}, ledgerService: fakeLedgerService({ accounts }), categoriesService: fakeCategoriesService() });
  const out = await search.run({ accountName: "Santander" }, actx);
  assert.ok(out.error);
});

test("ledger_search_transactions: exact totals per currency, rows capped and mapped with stable ids", async () => {
  const accounts = [{ id: "a1", name: "BBVA", bank: "BBVA", currency: "MXN", current_balance: 0 }];
  const prisma = {
    $queryRaw: async (strings) => {
      const sql = strings.join(" ");
      if (sql.includes("GROUP BY a.currency")) return [{ moneda: "MXN", cantidad: 2, deposito: 500, retiro: 100 }];
      return [{
        id: TX1, fecha: new Date("2026-01-05"), nombre: "Pago", referencia: null, concepto: null,
        deposito: 500, retiro: null, account_name: "BBVA", currency: "MXN", tipo_name: null, category_name: null,
      }];
    },
  };
  const [, search] = createLedgerMiraiQueries({ prisma, ledgerService: fakeLedgerService({ accounts }), categoriesService: fakeCategoriesService() });
  const out = await search.run({}, actx);
  assert.equal(out.total, 2);
  assert.equal(out.sums[0].deposito, 500);
  assert.equal(out.movimientos[0].transactionId, TX1);
  assert.equal(out.movimientos[0].fecha, "2026-01-05");
});

test("ledger_summary: compares against the previous period of equal length", async () => {
  // groupBy "account" keeps a stable group label across both periods ("BBVA"
  // either way), unlike "month" where the previous period necessarily falls
  // under a different month label and so can never match the current one —
  // the same inherent limitation pfm_spending_summary's groupBy "month" +
  // compareWithPrevious combination has (pfm-mirai-queries.js, same pattern).
  const accounts = [{ id: "a1", name: "BBVA", bank: "BBVA", currency: "MXN", current_balance: 0 }];
  let call = 0;
  const prisma = {
    $queryRaw: async () => {
      call += 1;
      return call === 1
        ? [{ grupo: "BBVA", moneda: "MXN", deposito: 1000, retiro: 200 }]
        : [{ grupo: "BBVA", moneda: "MXN", deposito: 500, retiro: 100 }];
    },
  };
  const [, , summary] = createLedgerMiraiQueries({ prisma, ledgerService: fakeLedgerService({ accounts }), categoriesService: fakeCategoriesService() });
  const out = await summary.run({ from: "2026-01-01", to: "2026-01-31", groupBy: "account", compareWithPrevious: true }, actx);
  assert.equal(out.grupos[0].deposito, 1000);
  assert.equal(out.grupos[0].depositoAnterior, 500);
});

test("ledger_summary: rejects an invalid groupBy without touching the database", async () => {
  const [, , summary] = createLedgerMiraiQueries({ prisma: {}, ledgerService: fakeLedgerService(), categoriesService: fakeCategoriesService() });
  const out = await summary.run({ from: "2026-01-01", to: "2026-01-31", groupBy: "bogus" }, actx);
  assert.ok(out.error);
});

test("ledger_categories: maps rows to the safe shape", async () => {
  const [, , , categories] = createLedgerMiraiQueries({
    prisma: {}, ledgerService: fakeLedgerService(),
    categoriesService: fakeCategoriesService([{ id: "c1", name: "Renta", kind: "expense", is_system: false }]),
  });
  const out = await categories.run({}, actx);
  assert.equal(out.categorias[0].categoryId, "c1");
  assert.equal(out.categorias[0].nombre, "Renta");
});

// ── Actions ────────────────────────────────────────────────────────────────

test("create: resolves account by name, prepare writes nothing, execute calls the service and effects", async () => {
  const accounts = [{ id: "a1", name: "BBVA", bank: "BBVA Cuenta", currency: "MXN", current_balance: 0 }];
  const effects = fakeEffects();
  const actions = Object.fromEntries(
    createLedgerMiraiActions({ prisma: {}, ledgerService: fakeLedgerService({ accounts }), effects }).map((a) => [a.key, a]),
  );
  const prepared = await actions["ledger.transaction.create"].prepare(
    { accountName: "BBVA", fecha: "2026-01-05", nombre: "Deposito", deposito: 100 }, actx,
  );
  assert.equal(prepared.input.accountId, "a1");
  assert.equal(effects.calls.length, 0);
  const res = await actions["ledger.transaction.create"].execute(prepared.input, actx);
  assert.equal(res.id, "tx-new");
  assert.deepEqual(effects.calls, ["create"]);
});

test("create: neither deposito nor retiro -> validation error, no account lookup needed", async () => {
  const actions = Object.fromEntries(
    createLedgerMiraiActions({ prisma: {}, ledgerService: fakeLedgerService(), effects: fakeEffects() }).map((a) => [a.key, a]),
  );
  const out = await actions["ledger.transaction.create"].prepare({ accountId: "a1", fecha: "2026-01-05", nombre: "x" }, actx);
  assert.ok(out.error);
});

test("create: account exists but caller cannot write to it -> error, no insert attempted", async () => {
  const accounts = [{ id: "a1", name: "BBVA", bank: "BBVA", currency: "MXN", current_balance: 0 }];
  const ledgerService = fakeLedgerService({ accounts });
  ledgerService.canWriteAccount = async () => false;
  const actions = Object.fromEntries(
    createLedgerMiraiActions({ prisma: {}, ledgerService, effects: fakeEffects() }).map((a) => [a.key, a]),
  );
  const out = await actions["ledger.transaction.create"].prepare({ accountId: "a1", fecha: "2026-01-05", nombre: "x", deposito: 10 }, actx);
  assert.ok(out.error);
});

test("update: diffs only the fields that actually changed", async () => {
  const accounts = [{ id: "a1", name: "BBVA", bank: "BBVA", currency: "MXN", current_balance: 0 }];
  const txRow = {
    id: TX1, account_id: "a1", fecha: new Date("2026-01-05"), nombre: "Viejo",
    referencia: null, concepto: null, numero: null, deposito: 100, retiro: null, category_id: null,
  };
  const txById = new Map([[TX1, txRow]]);
  const prisma = { $queryRaw: async () => [txRow] };
  const actions = Object.fromEntries(
    createLedgerMiraiActions({ prisma, ledgerService: fakeLedgerService({ accounts, txById }), effects: fakeEffects() }).map((a) => [a.key, a]),
  );
  const prepared = await actions["ledger.transaction.update"].prepare({ transactionId: TX1, nombre: "Nuevo" }, actx);
  assert.equal(prepared.input.data.nombre, "Nuevo");
  assert.equal("fecha" in prepared.input.data, false, "unchanged fields must not be sent");
  const res = await actions["ledger.transaction.update"].execute(prepared.input, actx);
  assert.equal(res.id, TX1);
});

test("update: no actual changes -> error instead of a no-op write", async () => {
  const accounts = [{ id: "a1", name: "BBVA", bank: "BBVA", currency: "MXN", current_balance: 0 }];
  const txRow = { id: TX1, account_id: "a1", fecha: new Date("2026-01-05"), nombre: "Igual", referencia: null, concepto: null, numero: null, deposito: 100, retiro: null, category_id: null };
  const prisma = { $queryRaw: async () => [txRow] };
  const actions = Object.fromEntries(
    createLedgerMiraiActions({ prisma, ledgerService: fakeLedgerService({ accounts }), effects: fakeEffects() }).map((a) => [a.key, a]),
  );
  const out = await actions["ledger.transaction.update"].prepare({ transactionId: TX1, nombre: "Igual" }, actx);
  assert.ok(out.error);
});

test("delete: soft-deletes via setTransactionEnabled(false) and fires afterSetTransactionEnabled", async () => {
  const accounts = [{ id: "a1", name: "BBVA", bank: "BBVA", currency: "MXN", current_balance: 0 }];
  const txRow = { id: TX1, account_id: "a1", nombre: "Pago", fecha: new Date("2026-01-05") };
  const prisma = { $queryRaw: async () => [txRow] };
  const effects = fakeEffects();
  const actions = Object.fromEntries(
    createLedgerMiraiActions({ prisma, ledgerService: fakeLedgerService({ accounts }), effects }).map((a) => [a.key, a]),
  );
  const prepared = await actions["ledger.transaction.delete"].prepare({ transactionId: TX1 }, actx);
  assert.equal(prepared.targetId, TX1);
  const res = await actions["ledger.transaction.delete"].execute(prepared.input, actx);
  assert.equal(res.id, TX1);
  assert.deepEqual(effects.calls, ["setEnabled"]);
});

test("ledger.statement.import: prepare runs the shared recognize pipeline and does not commit; execute calls the same commit()", async () => {
  const accounts = [{ id: "a1", name: "BBVA", bank: "BBVA", currency: "MXN", current_balance: 0 }];
  const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).jpeg().toBuffer();
  let seenMaxBytes = null;
  const attachmentAccess = {
    fetchForActor: async (_id, _ctx, opts) => {
      seenMaxBytes = opts?.maxBytes;
      return { buffer: jpeg, name: "estado.jpg", mimeType: "image/jpeg" };
    },
  };
  let committed = false;
  const aiImportService = {
    vision: { extractLedgerStatementPage: async () => ({ parsed: { rows: [{ fecha: "2026-01-05", nombre: "Deposito", deposito: 100, retiro: null }] } }) },
    recognize: async () => ({ detectedAccount: null, candidateAccounts: [], existingTransactions: [] }),
    signImportProof: () => "tok",
    commit: async () => { committed = true; return { inserted: 1, skipped: 0 }; },
  };
  const actions = Object.fromEntries(
    createLedgerMiraiActions({
      prisma: {}, ledgerService: fakeLedgerService({ accounts }), effects: fakeEffects(),
      attachmentAccess, aiImportService, aiRouter: {},
    }).map((a) => [a.key, a]),
  );
  const prepared = await actions["ledger.statement.import"].prepare({ attachmentId: "att1", account: "BBVA" }, actx);
  assert.equal(committed, false, "prepare must never write");
  assert.equal(seenMaxBytes, 15 * 1024 * 1024);
  assert.equal(prepared.input.accountId, "a1");
  assert.equal(prepared.input.rows.length, 1);
  assert.ok(prepared.preview.fields.some((f) => f.label === "Movimientos reconocidos"));

  const res = await actions["ledger.statement.import"].execute(prepared.input, actx);
  assert.equal(committed, true);
  assert.match(res.summary, /1 movimiento/);
});

test("ledger.statement.import: reports unavailable when no attachment access is wired, instead of throwing", async () => {
  const actions = Object.fromEntries(
    createLedgerMiraiActions({ prisma: {}, ledgerService: fakeLedgerService(), effects: fakeEffects() }).map((a) => [a.key, a]),
  );
  const out = await actions["ledger.statement.import"].prepare({ attachmentId: "att1", account: "BBVA" }, actx);
  assert.ok(out.error);
});

// ── Capability ───────────────────────────────────────────────────────────

test("createLedgerMiraiCapabilities: describeContext describes the open account, null when inaccessible", async () => {
  const cap = createLedgerMiraiCapabilities({ prisma: { $queryRaw: async () => [] } });
  assert.equal(cap.moduleKey, "runly.ledger");
  const line = await cap.describeContext({ recordType: "account", recordId: "missing" }, actx);
  assert.equal(line, null);
  const other = await cap.describeContext({ recordType: "contact", recordId: "c1" }, actx);
  assert.equal(other, null);
});
