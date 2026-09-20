import { PosServiceError, requireCompanyId, toMoney, writeAudit } from "./service-helpers.js";
import { createPosScopeService } from './pos-scope-service.js';

function cashPaymentTotal(payments = []) {
  return payments
    .filter((payment) => payment.paymentMethod?.kind === "CASH")
    .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
}

function movementTotal(movements = [], kind) {
  return movements
    .filter((movement) => movement.kind === kind)
    .reduce((sum, movement) => sum + Number(movement.amount ?? 0), 0);
}

export function createPosSessionService({ prisma }) {
  async function listSessions({ companyId, status }) {
    const scopedCompanyId = requireCompanyId(companyId);
    return prisma.posSession.findMany({
      where: {
        companyId: scopedCompanyId,
        ...(status ? { status } : {}),
      },
      orderBy: { openedAt: "desc" },
    });
  }

  async function getCurrentSession({ companyId, terminalId }) {
    const scopedCompanyId = requireCompanyId(companyId);
    return prisma.posSession.findFirst({
      where: {
        companyId: scopedCompanyId,
        terminalId,
        status: "OPEN",
      },
    });
  }

  async function openSession({ companyId, actorId, data }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const scope = createPosScopeService({ prisma });
    await scope.outlet(scopedCompanyId, data.outletId);
    await scope.terminal(scopedCompanyId, data.outletId, data.terminalId);
    const existing = await getCurrentSession({
      companyId: scopedCompanyId,
      terminalId: data.terminalId,
    });
    if (existing) {
      throw new PosServiceError("La terminal ya tiene una sesion abierta.", 409);
    }

    const session = await prisma.posSession.create({
      data: {
        companyId: scopedCompanyId,
        outletId: data.outletId,
        terminalId: data.terminalId,
        openedById: actorId,
        openingCashAmount: toMoney(data.openingCashAmount),
        notes: typeof data.notes === "string" ? data.notes.trim() || null : data.notes ?? null,
      },
    });
    await writeAudit(prisma, {
      actorId,
      entityType: "PosSession",
      entityId: session.id,
      action: "pos.session.open",
      after: session,
    });
    return session;
  }

  async function getSessionById({ companyId, id }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const session = await prisma.posSession.findFirst({
      where: { id, companyId: scopedCompanyId },
    });
    if (!session) throw new PosServiceError("Sesion POS no encontrada.", 404);
    return session;
  }

  async function addCashMovement({ companyId, sessionId, actorId, data }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const session = await getSessionById({ companyId: scopedCompanyId, id: sessionId });
    if (session.status !== "OPEN") {
      throw new PosServiceError("La sesion de caja no esta abierta.", 409);
    }

    const movement = await prisma.posCashMovement.create({
      data: {
        companyId: scopedCompanyId,
        sessionId,
        kind: data.kind,
        amount: toMoney(data.amount),
        reason: data.reason.trim(),
        createdById: actorId,
      },
    });
    await writeAudit(prisma, {
      actorId,
      entityType: "PosCashMovement",
      entityId: movement.id,
      action: "pos.cash_movement.create",
      after: movement,
    });
    return movement;
  }

  // Shared by closeSession (persists the value) and getExpectedCashAmount
  // (live preview for an still-OPEN session, e.g. the Cerrar Caja dialog).
  async function computeExpectedCashAmount({ companyId, session }) {
    const [payments, movements] = await Promise.all([
      prisma.posPayment.findMany({
        where: {
          companyId,
          status: "CAPTURED",
          sessionId: session.id,
        },
        include: { paymentMethod: true, order: true },
      }),
      prisma.posCashMovement.findMany({
        where: { companyId, sessionId: session.id },
      }),
    ]);

    return {
      expectedCashAmount: toMoney(
        Number(session.openingCashAmount ?? 0) +
          cashPaymentTotal(payments) +
          movementTotal(movements, "IN") -
          movementTotal(movements, "OUT") +
          movementTotal(movements, "WAITER_DELIVERY"),
      ),
      paymentsCount: payments.length,
      movementsCount: movements.length,
    };
  }

  async function getExpectedCashAmount({ companyId, sessionId }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const session = await getSessionById({ companyId: scopedCompanyId, id: sessionId });
    const { expectedCashAmount } = await computeExpectedCashAmount({
      companyId: scopedCompanyId,
      session,
    });
    return { expectedCashAmount };
  }

  async function closeSession({ companyId, sessionId, actorId, data }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const before = await getSessionById({ companyId: scopedCompanyId, id: sessionId });
    if (before.status !== "OPEN") {
      throw new PosServiceError("La sesion de caja no esta abierta.", 409);
    }

    const { expectedCashAmount, paymentsCount, movementsCount } = await computeExpectedCashAmount({
      companyId: scopedCompanyId,
      session: before,
    });
    const countedCashAmount = toMoney(data.countedCashAmount);
    const differenceAmount = toMoney(countedCashAmount - expectedCashAmount);

    // Conditional close — a concurrent close makes count === 0.
    const closeResult = await prisma.posSession.updateMany({
      where: { id: sessionId, companyId: scopedCompanyId, status: "OPEN" },
      data: {
        status: "CLOSED",
        closedById: actorId,
        expectedCashAmount,
        countedCashAmount,
        differenceAmount,
        closedAt: new Date(),
        notes: typeof data.notes === "string" ? data.notes.trim() || null : data.notes ?? before.notes,
      },
    });
    if (closeResult.count !== 1) {
      throw new PosServiceError("La sesion de caja ya fue cerrada.", 409);
    }
    const updated = await getSessionById({ companyId: scopedCompanyId, id: sessionId });
    await writeAudit(prisma, {
      actorId,
      entityType: "PosSession",
      entityId: updated.id,
      action: "pos.session.close",
      before,
      after: updated,
      metadata: { paymentsCount, movementsCount },
    });
    return updated;
  }

  return {
    listSessions,
    getCurrentSession,
    openSession,
    getSessionById,
    addCashMovement,
    getExpectedCashAmount,
    closeSession,
  };
}
