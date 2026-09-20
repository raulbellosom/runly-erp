// apps/api/src/routes/pfm/ledger-link-service.js
import { PfmServiceError, isTableNotFoundError, toPlainNumber } from "./service-helpers.js";
import { createWalletsService } from "./wallets-service.js";

const NOT_INSTALLED = "El modulo de finanzas personales no esta instalado.";

// `ledgerService` is an instance of createLedgerService({ prisma }) from
// apps/api/src/routes/ledger/ledger-service.js — passed in by index.js so this
// module never imports ledger internals at load time.
export function createLedgerLinkService({ prisma, ledgerService }) {
  const wallets = createWalletsService({ prisma });

  async function assertLedgerAccess({ companyId, ledgerAccountId, actorId }) {
    if (!actorId) throw new PfmServiceError("Se requiere un usuario autenticado.", 401);
    if (!companyId) throw new PfmServiceError("Selecciona una empresa activa.", 400);
    if (!ledgerAccountId) throw new PfmServiceError("Cuenta bancaria no encontrada.", 404);
    let allowed = false;
    try {
      allowed = await ledgerService.canReadAccount({
        companyId,
        accountId: ledgerAccountId,
        actorId,
      });
    } catch {
      allowed = false;
    }
    if (!allowed) throw new PfmServiceError("No tienes acceso a la cuenta bancaria enlazada.", 403);
  }

  async function assertLinkedWallet({ companyId, actorId, walletId, ledgerAccountId }) {
    await assertLedgerAccess({ companyId, actorId, ledgerAccountId });
    const wallet = await wallets.getWallet({ companyId, actorId, walletId });
    if (wallet.ledgerAccountId !== ledgerAccountId) {
      throw new PfmServiceError("Cuenta bancaria no encontrada.", 404);
    }
  }

  async function getLinkedMovements({ companyId, actorId, walletId, ledgerAccountId, query }) {
    await assertLinkedWallet({ companyId, ledgerAccountId, actorId, walletId });
    const limit = Math.min(200, Math.max(1, Number(query?.limit) || 100));
    const monthStart = query?.month ? `${query.month}-01` : null;
    try {
      const rows = await prisma.$queryRaw`
        SELECT t.id, t.fecha, t.nombre, t.deposito, t.retiro,
               e.category_id AS enr_category_id,
               e.receipt_id  AS enr_receipt_id,
               e.note        AS enr_note
        FROM ledger_transaction t
        LEFT JOIN pfm_ledger_enrichment e ON e.ledger_transaction_id = t.id
          AND e.company_id = ${companyId}::uuid
          AND e.owner_id = ${actorId}::uuid
          AND e.wallet_id = ${walletId}::uuid
        WHERE t.account_id = ${ledgerAccountId}::uuid
          AND t.enabled = true
          AND (${monthStart}::date IS NULL OR (t.fecha >= ${monthStart}::date
               AND t.fecha < (${monthStart}::date + INTERVAL '1 month')))
        ORDER BY t.fecha DESC, t.created_at DESC
        LIMIT ${limit}
      `;
      return { data: rows.map((r) => normalizeLedgerRow(r, walletId)) };
    } catch (err) {
      if (isTableNotFoundError(err)) throw new PfmServiceError(NOT_INSTALLED, 503);
      throw err;
    }
  }

  async function enrichLedgerMovement({
    companyId,
    actorId,
    walletId,
    ledgerAccountId,
    ledgerTransactionId,
    data,
  }) {
    await assertLinkedWallet({ companyId, ledgerAccountId, actorId, walletId });
    const [transaction] = await prisma.$queryRaw`
      SELECT id FROM ledger_transaction
      WHERE id = ${ledgerTransactionId}::uuid
        AND account_id = ${ledgerAccountId}::uuid AND enabled = true
    `;
    if (!transaction) throw new PfmServiceError("Movimiento no encontrado.", 404);
    if (data.categoryId) {
      const category = await prisma.pfmCategory.findFirst({ where: {
        id: data.categoryId, companyId, enabled: true,
        OR: [{ ownerId: actorId }, { ownerId: null }],
      } });
      if (!category) throw new PfmServiceError("Categoria no encontrada.", 404);
    }
    if (data.receiptId) {
      const receipt = await prisma.pfmReceipt.findFirst({ where: {
        id: data.receiptId, companyId, ownerId: actorId,
      } });
      if (!receipt) throw new PfmServiceError("Recibo no encontrado.", 404);
    }
    const base = {
      companyId,
      ownerId: actorId,
      walletId,
      ledgerTransactionId,
      categoryId: data.categoryId ?? null,
      receiptId: data.receiptId ?? null,
      note: data.note ?? null,
    };
    const update = {};
    if ("categoryId" in data) update.categoryId = data.categoryId ?? null;
    if ("receiptId" in data) update.receiptId = data.receiptId ?? null;
    if ("note" in data) update.note = data.note ?? null;
    const row = await prisma.pfmLedgerEnrichment.upsert({
      where: { companyId_ownerId_walletId_ledgerTransactionId: {
        companyId, ownerId: actorId, walletId, ledgerTransactionId,
      } },
      update,
      create: base,
    });
    return row;
  }

  async function removeEnrichmentsForWallet({ companyId, actorId, walletId, ledgerAccountId }) {
    await assertLinkedWallet({ companyId, actorId, walletId, ledgerAccountId });
    await prisma.pfmLedgerEnrichment.deleteMany({ where: { companyId, ownerId: actorId, walletId } });
    return { walletId, cleared: true };
  }

  return { getLinkedMovements, enrichLedgerMovement, removeEnrichmentsForWallet };
}

function normalizeLedgerRow(r, walletId) {
  const deposito = toPlainNumber(r.deposito, 0);
  const retiro = toPlainNumber(r.retiro, 0);
  const isIncome = deposito >= retiro && deposito > 0;
  const fecha = r.fecha;
  return {
    id: r.id,
    source: "ledger",
    walletId,
    direction: isIncome ? "INCOME" : "EXPENSE",
    amount: isIncome ? deposito : retiro,
    occurredOn:
      // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date row value
      fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha).slice(0, 10),
    merchant: r.nombre ?? null,
    note: r.enr_note ?? null,
    categoryId: r.enr_category_id ?? null,
    receiptId: r.enr_receipt_id ?? null,
    status: "POSTED",
    editableInPfm: false,
  };
}
