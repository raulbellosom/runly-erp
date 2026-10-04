// apps/api/src/routes/pfm/movements-service.js
import { toLocalIso } from "@runly/core";
import { PfmServiceError, isTableNotFoundError, toPlainNumber } from "./service-helpers.js";

const NOT_INSTALLED = "El modulo de finanzas personales no esta instalado.";

export function createMovementsService({ prisma, wallets }) {
  async function assertWritable({ companyId, walletId, actorId }) {
    if (!(await wallets.canWriteWallet({ companyId, walletId, actorId }))) {
      throw new PfmServiceError("No tienes permiso de escritura en esta cartera.", 403);
    }
  }

  async function createMovement({ companyId, actorId, walletId, data }) {
    await assertWritable({ companyId, walletId, actorId });
    try {
      const created = await prisma.pfmMovement.create({
        data: {
          companyId,
          ownerId: actorId,
          walletId,
          categoryId: data.categoryId ?? null,
          direction: data.direction,
          amount: data.amount,
          occurredOn: new Date(`${data.occurredOn}T00:00:00.000Z`),
          note: data.note ?? null,
          merchant: data.merchant ?? null,
          receiptId: data.receiptId ?? null,
          status: data.status ?? "POSTED",
        },
      });
      return normalizeMovement(created);
    } catch (err) {
      if (isTableNotFoundError(err)) throw new PfmServiceError(NOT_INSTALLED, 503);
      throw err;
    }
  }

  async function adjustWalletBalance({ companyId, actorId, walletId, data }) {
    await assertWritable({ companyId, walletId, actorId });
    const wallet = await wallets.getWallet({ companyId, walletId, actorId });
    const current = Number(wallet.currentBalance ?? 0);
    const internalTarget =
      wallet.kind === "CREDIT" ? -Number(data.targetBalance) : Number(data.targetBalance);
    const delta = Math.round((internalTarget - current) * 100) / 100;
    if (delta === 0) {
      throw new PfmServiceError("El saldo ya coincide con el registrado.", 400);
    }
    const occurredOn = data.occurredOn
      ? new Date(`${data.occurredOn}T00:00:00.000Z`)
      : new Date(`${toLocalIso()}T00:00:00.000Z`);
    try {
      const created = await prisma.pfmMovement.create({
        data: {
          companyId,
          ownerId: actorId,
          walletId,
          categoryId: null,
          direction: delta > 0 ? "INCOME" : "EXPENSE",
          amount: Math.abs(delta),
          occurredOn,
          note: data.note ?? null,
          merchant: null,
          status: "POSTED",
          isAdjustment: true,
        },
      });
      return normalizeMovement(created);
    } catch (err) {
      if (isTableNotFoundError(err)) throw new PfmServiceError(NOT_INSTALLED, 503);
      throw err;
    }
  }

  async function getOwnedMovement({ companyId, movementId }) {
    const row = await prisma.pfmMovement.findFirst({
      where: { id: movementId, companyId, enabled: true },
    });
    if (!row) throw new PfmServiceError("Movimiento no encontrado.", 404);
    return row;
  }

  async function updateMovement({ companyId, actorId, movementId, data }) {
    const row = await getOwnedMovement({ companyId, movementId });
    await assertWritable({ companyId, walletId: row.walletId, actorId });
    const patch = {};
    if ("direction" in data) patch.direction = data.direction;
    if ("amount" in data) patch.amount = data.amount;
    if ("occurredOn" in data) patch.occurredOn = new Date(`${data.occurredOn}T00:00:00.000Z`);
    if ("categoryId" in data) patch.categoryId = data.categoryId ?? null;
    if ("note" in data) patch.note = data.note ?? null;
    if ("merchant" in data) patch.merchant = data.merchant ?? null;
    if ("receiptId" in data) patch.receiptId = data.receiptId ?? null;
    if ("status" in data && (data.status === "PENDING" || data.status === "POSTED")) {
      patch.status = data.status;
    }
    const updated = await prisma.pfmMovement.update({ where: { id: movementId }, data: patch });
    return normalizeMovement(updated);
  }

  async function setMovementEnabled({ companyId, actorId, movementId, enabled }) {
    const row = await getOwnedMovement({ companyId, movementId });
    await assertWritable({ companyId, walletId: row.walletId, actorId });
    await prisma.pfmMovement.update({ where: { id: movementId }, data: { enabled } });
    return { id: movementId, enabled };
  }

  async function confirmMovement({ companyId, actorId, movementId, amount }) {
    const row = await getOwnedMovement({ companyId, movementId });
    await assertWritable({ companyId, walletId: row.walletId, actorId });
    if (row.status !== "PENDING") {
      throw new PfmServiceError("Solo se pueden confirmar movimientos pendientes.", 409);
    }
    const data = { status: "POSTED" };
    if (amount !== undefined && amount !== null) data.amount = amount;
    const updated = await prisma.pfmMovement.update({ where: { id: movementId }, data });
    return normalizeMovement(updated);
  }

  async function skipMovement({ companyId, actorId, movementId }) {
    const row = await getOwnedMovement({ companyId, movementId });
    await assertWritable({ companyId, walletId: row.walletId, actorId });
    if (row.status !== "PENDING") {
      throw new PfmServiceError("Solo se pueden omitir movimientos pendientes.", 409);
    }
    const updated = await prisma.pfmMovement.update({
      where: { id: movementId },
      data: { status: "SKIPPED" },
    });
    return normalizeMovement(updated);
  }

  async function listMovements({ companyId, actorId, walletId, query }) {
    if (!(await wallets.canReadWallet({ companyId, walletId, actorId }))) {
      throw new PfmServiceError("Cartera no encontrada.", 404);
    }
    const limit = Math.min(200, Math.max(1, Number(query?.limit) || 100));
    const monthStart = query?.month ? `${query.month}-01` : null;
    const status = query?.status ?? null;
    const categoryId = query?.categoryId ?? null;
    const search = query?.search ?? null;
    try {
      const rows = await prisma.$queryRaw`
        WITH filtered AS (
          SELECT m.*,
            SUM(m.amount * CASE WHEN m.direction = 'INCOME' THEN 1 ELSE -1 END)
              FILTER (WHERE m.enabled = true AND m.status = 'POSTED')
              OVER (ORDER BY m.occurred_on, m.created_at
                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_delta
          FROM pfm_movement m
          WHERE m.wallet_id = ${walletId}::uuid
            AND m.company_id = ${companyId}::uuid
            AND m.enabled = true
            AND (${status}::text IS NULL OR m.status::text = ${status}::text)
            AND (${categoryId}::uuid IS NULL OR m.category_id = ${categoryId}::uuid)
            AND (${monthStart}::date IS NULL OR (m.occurred_on >= ${monthStart}::date
                 AND m.occurred_on < (${monthStart}::date + INTERVAL '1 month')))
            AND (${search}::text IS NULL
                 OR m.merchant ILIKE '%' || ${search} || '%'
                 OR m.note ILIKE '%' || ${search} || '%')
        )
        SELECT * FROM filtered
        ORDER BY occurred_on DESC, created_at DESC
        LIMIT ${limit}
      `;
      return { data: rows.map((r) => ({ ...normalizeMovement(r), source: "native" })) };
    } catch (err) {
      if (isTableNotFoundError(err)) throw new PfmServiceError(NOT_INSTALLED, 503);
      throw err;
    }
  }

  return {
    getOwnedMovement,
    createMovement,
    adjustWalletBalance,
    updateMovement,
    setMovementEnabled,
    confirmMovement,
    skipMovement,
    listMovements,
  };
}

function normalizeMovement(row) {
  const occurred = row.occurred_on ?? row.occurredOn;
  return {
    id: row.id,
    walletId: row.wallet_id ?? row.walletId,
    categoryId: row.category_id ?? row.categoryId ?? null,
    direction: row.direction,
    amount: toPlainNumber(row.amount),
    occurredOn:
      occurred instanceof Date
        // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date occurredOn
        ? occurred.toISOString().slice(0, 10)
        : String(occurred).slice(0, 10),
    note: row.note ?? null,
    merchant: row.merchant ?? null,
    status: row.status,
    recurringRuleId: row.recurring_rule_id ?? row.recurringRuleId ?? null,
    receiptId: row.receipt_id ?? row.receiptId ?? null,
    isAdjustment: Boolean(row.is_adjustment ?? row.isAdjustment ?? false),
    isYield: Boolean(row.is_yield ?? row.isYield ?? false),
    editableInPfm: true,
  };
}
