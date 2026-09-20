import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPosSessionService } from "../pos-session-service.js";
import { PosServiceError } from "../service-helpers.js";

function makePrisma() {
  const sessions = new Map();
  const cashMovements = [];
  const payments = [];
  const audits = [];

  return {
    sessions,
    cashMovements,
    payments,
    audits,
    posOutlet: {
      findFirst: async ({ where }) => where.id === 'outlet-1' && where.companyId === 'company-1' ? { id: 'outlet-1', companyId: 'company-1' } : null,
    },
    posTerminal: {
      findFirst: async ({ where }) => where.id === 'terminal-1' && where.companyId === 'company-1' && where.outletId === 'outlet-1'
        ? { id: 'terminal-1', outletId: 'outlet-1', companyId: 'company-1' } : null,
    },
    posSession: {
      findMany: async ({ where }) =>
        [...sessions.values()].filter(
          (row) =>
            row.companyId === where.companyId &&
            (!where.status || row.status === where.status),
        ),
      findFirst: async ({ where }) =>
        [...sessions.values()].find((row) => {
          if (where.id && row.id !== where.id) return false;
          if (where.companyId && row.companyId !== where.companyId) return false;
          if (where.terminalId && row.terminalId !== where.terminalId) return false;
          if (where.status && row.status !== where.status) return false;
          return true;
        }) ?? null,
      create: async ({ data }) => {
        const row = { id: `session-${sessions.size + 1}`, status: "OPEN", ...data };
        sessions.set(row.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = { ...sessions.get(where.id), ...data };
        sessions.set(where.id, row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const [id, row] of sessions) {
          if (where.id && id !== where.id) continue;
          if (where.companyId && row.companyId !== where.companyId) continue;
          if (where.status && row.status !== where.status) continue;
          sessions.set(id, { ...row, ...data });
          count += 1;
        }
        return { count };
      },
    },
    posCashMovement: {
      create: async ({ data }) => {
        const row = { id: `movement-${cashMovements.length + 1}`, ...data };
        cashMovements.push(row);
        return row;
      },
      findMany: async ({ where }) =>
        cashMovements.filter(
          (row) => row.companyId === where.companyId && row.sessionId === where.sessionId,
        ),
    },
    posPayment: {
      findMany: async ({ where }) =>
        payments.filter(
          (row) =>
            row.companyId === where.companyId &&
            row.status === where.status &&
            row.sessionId === where.sessionId,
        ),
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data);
        return data;
      },
    },
  };
}

describe("createPosSessionService", () => {
  it("rejects opening a second open session for the same terminal", async () => {
    const prisma = makePrisma();
    const svc = createPosSessionService({ prisma });
    await svc.openSession({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", terminalId: "terminal-1", openingCashAmount: 100 },
    });

    await assert.rejects(
      () =>
        svc.openSession({
          companyId: "company-1",
          actorId: "user-1",
          data: { outletId: "outlet-1", terminalId: "terminal-1", openingCashAmount: 0 },
        }),
      (err) => err instanceof PosServiceError && err.status === 409,
    );
  });

  it("adds cash movements only to open sessions", async () => {
    const prisma = makePrisma();
    const svc = createPosSessionService({ prisma });
    const session = await svc.openSession({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", terminalId: "terminal-1", openingCashAmount: 100 },
    });

    const movement = await svc.addCashMovement({
      companyId: "company-1",
      sessionId: session.id,
      actorId: "user-1",
      data: { kind: "IN", amount: 20, reason: "Fondo adicional" },
    });
    assert.equal(movement.amount, 20);

    await svc.closeSession({
      companyId: "company-1",
      sessionId: session.id,
      actorId: "user-1",
      data: { countedCashAmount: 120 },
    });
    await assert.rejects(
      () =>
        svc.addCashMovement({
          companyId: "company-1",
          sessionId: session.id,
          actorId: "user-1",
          data: { kind: "OUT", amount: 10, reason: "Retiro" },
        }),
      (err) => err instanceof PosServiceError && err.status === 409,
    );
  });

  it("closes a session summing cash payments and movements", async () => {
    const prisma = makePrisma();
    const svc = createPosSessionService({ prisma });
    const session = await svc.openSession({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", terminalId: "terminal-1", openingCashAmount: 100 },
    });
    prisma.payments.push(
      {
        companyId: "company-1",
        status: "CAPTURED",
        amount: 80,
        sessionId: session.id,
        order: { sessionId: session.id },
        paymentMethod: { kind: "CASH" },
      },
      {
        companyId: "company-1",
        status: "CAPTURED",
        amount: 50,
        sessionId: session.id,
        order: { sessionId: session.id },
        paymentMethod: { kind: "CARD" },
      },
    );
    await svc.addCashMovement({
      companyId: "company-1",
      sessionId: session.id,
      actorId: "user-1",
      data: { kind: "IN", amount: 20, reason: "Ingreso" },
    });
    await svc.addCashMovement({
      companyId: "company-1",
      sessionId: session.id,
      actorId: "user-1",
      data: { kind: "OUT", amount: 10, reason: "Retiro" },
    });

    const closed = await svc.closeSession({
      companyId: "company-1",
      sessionId: session.id,
      actorId: "user-1",
      data: { countedCashAmount: 195 },
    });

    assert.equal(closed.status, "CLOSED");
    assert.equal(closed.expectedCashAmount, 190);
    assert.equal(closed.differenceAmount, 5);
  });

  // Regression: the Cerrar Caja dialog used to read session.expectedCashAmount
  // directly, which is only ever populated by closeSession — so the preview
  // always showed $0.00 for a still-OPEN session even though the real total
  // was computable. getExpectedCashAmount exposes the same computation as a
  // read-only preview, and closeSession's persisted value must match it exactly.
  it("getExpectedCashAmount previews the real total for a still-OPEN session (no $0.00 preview bug)", async () => {
    const prisma = makePrisma();
    const svc = createPosSessionService({ prisma });
    const session = await svc.openSession({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", terminalId: "terminal-1", openingCashAmount: 100 },
    });
    prisma.payments.push({
      companyId: "company-1",
      status: "CAPTURED",
      amount: 80,
      sessionId: session.id,
      order: { sessionId: session.id },
      paymentMethod: { kind: "CASH" },
    });
    await svc.addCashMovement({
      companyId: "company-1",
      sessionId: session.id,
      actorId: "user-1",
      data: { kind: "IN", amount: 20, reason: "Ingreso" },
    });

    const preview = await svc.getExpectedCashAmount({ companyId: "company-1", sessionId: session.id });
    assert.equal(preview.expectedCashAmount, 200);

    // Session is still OPEN — the preview must not have mutated/closed it.
    const stillOpen = await svc.getSessionById({ companyId: "company-1", id: session.id });
    assert.equal(stillOpen.status, "OPEN");

    // The eventual close must land on the exact same number the preview showed.
    const closed = await svc.closeSession({
      companyId: "company-1",
      sessionId: session.id,
      actorId: "user-1",
      data: { countedCashAmount: 200 },
    });
    assert.equal(closed.expectedCashAmount, preview.expectedCashAmount);
  });

  it("rejects sessions outside company scope", async () => {
    const prisma = makePrisma();
    const svc = createPosSessionService({ prisma });
    const session = await svc.openSession({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", terminalId: "terminal-1", openingCashAmount: 0 },
    });

    await assert.rejects(
      () => svc.getSessionById({ companyId: "company-2", id: session.id }),
      (err) => err instanceof PosServiceError && err.status === 404,
    );
  });

  it("attributes cash payments by payment.sessionId, not order.sessionId", async () => {
    const prisma = makePrisma();
    const svc = createPosSessionService({ prisma });
    const session = await svc.openSession({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", terminalId: "terminal-1", openingCashAmount: 0 },
    });

    // Comandero-created order charged at caja: order has no sessionId, but the
    // payment that captured it is attributed directly to the closing session.
    prisma.payments.push(
      {
        companyId: "company-1",
        status: "CAPTURED",
        amount: 45,
        sessionId: session.id,
        order: { sessionId: null },
        paymentMethod: { kind: "CASH" },
      },
      {
        companyId: "company-1",
        status: "CAPTURED",
        amount: 999,
        sessionId: "other-session",
        order: { sessionId: session.id },
        paymentMethod: { kind: "CASH" },
      },
    );

    const closed = await svc.closeSession({
      companyId: "company-1",
      sessionId: session.id,
      actorId: "user-1",
      data: { countedCashAmount: 45 },
    });

    assert.equal(closed.expectedCashAmount, 45);
    assert.equal(closed.differenceAmount, 0);
  });

  it("counts WAITER_DELIVERY movements as cash-in when reconciling the cut", async () => {
    const prisma = makePrisma();
    const svc = createPosSessionService({ prisma });
    const session = await svc.openSession({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", terminalId: "terminal-1", openingCashAmount: 500 },
    });

    prisma.payments.push({
      companyId: "company-1",
      status: "CAPTURED",
      amount: 128,
      sessionId: session.id,
      order: { sessionId: session.id },
      paymentMethod: { kind: "CASH" },
    });
    await svc.addCashMovement({
      companyId: "company-1",
      sessionId: session.id,
      actorId: "user-1",
      data: { kind: "IN", amount: 50, reason: "Ingreso" },
    });
    await svc.addCashMovement({
      companyId: "company-1",
      sessionId: session.id,
      actorId: "user-1",
      data: { kind: "OUT", amount: 20, reason: "Retiro" },
    });
    await svc.addCashMovement({
      companyId: "company-1",
      sessionId: session.id,
      actorId: "user-1",
      data: { kind: "WAITER_DELIVERY", amount: 35, reason: "Entrega de corte de mesero" },
    });

    const closed = await svc.closeSession({
      companyId: "company-1",
      sessionId: session.id,
      actorId: "user-1",
      data: { countedCashAmount: 693 },
    });

    // 500 (opening) + 128 (cash payment) + 50 (IN) - 20 (OUT) + 35 (WAITER_DELIVERY) = 693
    assert.equal(closed.expectedCashAmount, 693);
    assert.equal(closed.differenceAmount, 0);
  });

  it("excludes non-cash payments from expected cash even when attributed to the session", async () => {
    const prisma = makePrisma();
    const svc = createPosSessionService({ prisma });
    const session = await svc.openSession({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", terminalId: "terminal-1", openingCashAmount: 100 },
    });

    prisma.payments.push({
      companyId: "company-1",
      status: "CAPTURED",
      amount: 250,
      sessionId: session.id,
      order: { sessionId: session.id },
      paymentMethod: { kind: "CARD" },
    });

    const closed = await svc.closeSession({
      companyId: "company-1",
      sessionId: session.id,
      actorId: "user-1",
      data: { countedCashAmount: 100 },
    });

    assert.equal(closed.expectedCashAmount, 100);
    assert.equal(closed.differenceAmount, 0);
  });
});
