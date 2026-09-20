// apps/api/src/routes/pfm/__tests__/ledger-link-service.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLedgerLinkService } from "../ledger-link-service.js";
import { PfmServiceError } from "../service-helpers.js";

const COMPANY = "01900000-0000-7000-8000-0000000000d1";
const ACTOR = "01900000-0000-7000-8000-0000000000d2";
const WALLET = "01900000-0000-7000-8000-0000000000d3";
const LEDGER_ACC = "01900000-0000-7000-8000-0000000000d4";
const LTX = "01900000-0000-7000-8000-0000000000d5";

function ledgerStub({ canRead = true } = {}) {
  return { canReadAccount: async () => canRead };
}

describe("ledger-link-service", () => {
  it("getLinkedMovements refuses (403) when the actor cannot read the ledger account", async () => {
    const prisma = {
      $queryRaw: async () => {
        throw new Error("should not query");
      },
    };
    const service = createLedgerLinkService({ prisma, ledgerService: ledgerStub({ canRead: false }) });
    await assert.rejects(
      () =>
        service.getLinkedMovements({
          companyId: COMPANY,
          actorId: ACTOR,
          walletId: WALLET,
          ledgerAccountId: LEDGER_ACC,
        }),
      (e) => e instanceof PfmServiceError && e.status === 403,
    );
  });

  it("getLinkedMovements normalizes deposito->INCOME / retiro->EXPENSE and marks rows non-editable", async () => {
    const prisma = {
      $queryRaw: async (strings) => strings.join(' ').includes('FROM pfm_wallet')
        ? [{ id: WALLET, ledger_account_id: LEDGER_ACC, kind: 'DEBIT' }] : [
        {
          id: LTX,
          fecha: new Date("2026-08-10"),
          nombre: "OXXO",
          deposito: null,
          retiro: "89.00",
          enr_category_id: "cat1",
          enr_receipt_id: null,
          enr_note: "snacks",
        },
        {
          id: "ltx2",
          fecha: new Date("2026-08-12"),
          nombre: "Nomina",
          deposito: "15000.00",
          retiro: null,
          enr_category_id: null,
          enr_receipt_id: null,
          enr_note: null,
        },
      ],
    };
    const service = createLedgerLinkService({ prisma, ledgerService: ledgerStub() });
    const { data } = await service.getLinkedMovements({
      companyId: COMPANY,
      actorId: ACTOR,
      walletId: WALLET,
      ledgerAccountId: LEDGER_ACC,
    });
    assert.equal(data[0].direction, "EXPENSE");
    assert.equal(data[0].amount, 89);
    assert.equal(data[0].source, "ledger");
    assert.equal(data[0].editableInPfm, false);
    assert.equal(data[0].categoryId, "cat1");
    assert.equal(data[1].direction, "INCOME");
    assert.equal(data[1].amount, 15000);
  });

  it("enrichLedgerMovement scopes annotations by company, author, wallet and transaction", async () => {
    let upsertArgs = null;
    const prisma = {
      $queryRaw: async (strings) => {
        assert.match(strings.join(' '), /SELECT/);
        return strings.join(' ').includes('FROM pfm_wallet')
          ? [{ id: WALLET, ledger_account_id: LEDGER_ACC, kind: 'DEBIT' }] : [{ id: LTX }];
      },
      pfmCategory: { findFirst: async () => ({ id: 'cat9' }) },
      pfmLedgerEnrichment: {
        upsert: async (args) => ((upsertArgs = args), { id: "enr1", ...args.create }),
      },
    };
    const service = createLedgerLinkService({ prisma, ledgerService: ledgerStub() });
    await service.enrichLedgerMovement({
      companyId: COMPANY,
      actorId: ACTOR,
      walletId: WALLET,
      ledgerAccountId: LEDGER_ACC,
      ledgerTransactionId: LTX,
      data: { categoryId: "cat9", note: "x", receiptId: null },
    });
    assert.deepEqual(upsertArgs.where.companyId_ownerId_walletId_ledgerTransactionId,
      { companyId: COMPANY, ownerId: ACTOR, walletId: WALLET, ledgerTransactionId: LTX });
    assert.equal(upsertArgs.create.walletId, WALLET);
    assert.equal(upsertArgs.create.ownerId, ACTOR);
  });

  it("rejects missing company, actor or bank account before accessing the database", async () => {
    const service = createLedgerLinkService({ prisma: {}, ledgerService: ledgerStub() });
    const scope = { companyId: COMPANY, actorId: ACTOR, walletId: WALLET,
      ledgerAccountId: LEDGER_ACC, ledgerTransactionId: LTX, data: { note: 'Example' } };
    for (const [key, status] of [['companyId', 400], ['actorId', 401], ['ledgerAccountId', 404]]) {
      await assert.rejects(service.enrichLedgerMovement({ ...scope, [key]: undefined }),
        e => e instanceof PfmServiceError && e.status === status);
    }
  });
});
