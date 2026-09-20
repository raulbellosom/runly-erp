import { createUserAccessService } from '../../services/user-access-service.js';
import {
  PosServiceError,
  assertEditableOrder,
  requireCompanyId,
  toMoney,
  writeAudit,
} from "./service-helpers.js";
import { createPosWaiterShiftService } from "./pos-waiter-shift-service.js";
import { createPosModifierService } from "./pos-modifier-service.js";

function normalizeText(value) {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanData(data = {}) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, normalizeText(value)]),
  );
}

function lineAmounts({ quantity, unitPrice, discountAmount = 0, taxRate = 0 }) {
  const subtotal = toMoney(Number(quantity) * Number(unitPrice) - Number(discountAmount ?? 0));
  const taxAmount = toMoney(subtotal * (Number(taxRate ?? 0) / 100));
  return {
    taxAmount,
    totalAmount: toMoney(subtotal + taxAmount),
  };
}

async function hydrateOrder(db, { companyId, id }) {
  const order = await db.posOrder.findFirst({ where: { id, companyId }, include: { table: true } });
  if (!order) throw new PosServiceError("Orden POS no encontrada.", 404);

  let waiterName = null;
  if (order.waiterId) {
    const waiter = await db.userProfile.findUnique({
      where: { id: order.waiterId },
      select: { displayName: true },
    });
    waiterName = waiter?.displayName ?? null;
  }

  const [lines, guests, payments] = await Promise.all([
    db.posOrderLine.findMany({ where: { orderId: id }, orderBy: { createdAt: "asc" } }),
    db.posGuestSeat.findMany({ where: { orderId: id }, orderBy: { position: "asc" } }),
    db.posPayment.findMany({ where: { orderId: id }, orderBy: { paidAt: "asc" } }),
  ]);

  const lineIds = lines.map((line) => line.id);
  const lineModifiers = lineIds.length
    ? await db.posOrderLineModifier.findMany({ where: { lineId: { in: lineIds } } })
    : [];
  const modifiersByLine = new Map();
  for (const modifier of lineModifiers) {
    if (!modifiersByLine.has(modifier.lineId)) modifiersByLine.set(modifier.lineId, []);
    modifiersByLine.get(modifier.lineId).push({
      groupName: modifier.groupName,
      optionName: modifier.optionName,
      priceDelta: modifier.priceDelta,
    });
  }
  const linesWithModifiers = lines.map((line) => ({
    ...line,
    modifiers: modifiersByLine.get(line.id) ?? [],
  }));

  return { ...order, waiterName, lines: linesWithModifiers, guests, payments };
}

async function getDefaultTaxRate(db, companyId) {
  const settings = await db.posSettings.findUnique({ where: { companyId } }).catch(() => null);
  return Number(settings?.defaultTaxRate ?? 0);
}

async function recalculateOrderTotals(db, { companyId, orderId }) {
  const lines = await db.posOrderLine.findMany({ where: { orderId } });
  const subtotalAmount = toMoney(
    lines.reduce(
      (sum, line) =>
        sum + Number(line.quantity ?? 0) * Number(line.unitPrice ?? 0) - Number(line.discountAmount ?? 0),
      0,
    ),
  );
  const taxAmount = toMoney(lines.reduce((sum, line) => sum + Number(line.taxAmount ?? 0), 0));
  const totalAmount = toMoney(taxAmount + subtotalAmount);
  await db.posOrder.update({
    where: { id: orderId },
    data: { subtotalAmount, taxAmount, totalAmount },
  });
  return hydrateOrder(db, { companyId, id: orderId });
}

async function nextOrderNumber(db, companyId) {
  const last = await db.posOrder.findFirst({
    where: { companyId },
    orderBy: { orderNumber: "desc" },
  });
  return Number(last?.orderNumber ?? 0) + 1;
}

async function nextGuestPosition(db, orderId) {
  const guests = await db.posGuestSeat.findMany({ where: { orderId } });
  return guests.reduce((max, guest) => Math.max(max, Number(guest.position ?? 0)), 0) + 1;
}

async function loadCatalogSnapshot(db, { companyId, productId, variantId, unitPrice }) {
  if (variantId) {
    const variant = await db.catalogProductVariant.findFirst({
      where: { id: variantId, companyId },
      include: { product: true },
    });
    if (!variant) throw new PosServiceError("Variante de producto no encontrada.", 404);
    return {
      productId: variant.productId,
      variantId: variant.id,
      productName: variant.product?.name ?? "Producto",
      sku: variant.sku ?? variant.product?.sku ?? null,
      unitPrice: toMoney(unitPrice ?? variant.price),
      catalogPrice: toMoney(variant.price),
    };
  }

  const product = await db.catalogProduct.findFirst({
    where: { id: productId, companyId },
  });
  if (!product) throw new PosServiceError("Producto no encontrado.", 404);
  return {
    productId: product.id,
    variantId: null,
    productName: product.name,
    sku: product.sku ?? null,
    unitPrice: toMoney(unitPrice ?? product.price),
    catalogPrice: toMoney(product.price),
  };
}

export function createPosOrderService({ prisma, waiterShifts, modifiers }) {
  const shiftSvc = waiterShifts ?? createPosWaiterShiftService({ prisma });
  const modifierSvc = modifiers ?? createPosModifierService({ prisma });

  async function listOrders({ companyId, filters = {} }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const openedAtFilter = {};
    if (filters.dateFrom) openedAtFilter.gte = new Date(filters.dateFrom);
    if (filters.dateTo) openedAtFilter.lte = new Date(filters.dateTo + "T23:59:59.999Z");
    return prisma.posOrder.findMany({
      where: {
        companyId: scopedCompanyId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.salesChannel ? { salesChannel: filters.salesChannel } : {}),
        ...(Object.keys(openedAtFilter).length > 0 ? { openedAt: openedAtFilter } : {}),
      },
      orderBy: { openedAt: "desc" },
    });
  }

  async function createOrder({ companyId, actorId, data }) {
    const scopedCompanyId = requireCompanyId(companyId);

    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        return await prisma.$transaction(async (tx) => {
          if (data.externalProvider && data.externalOrderId) {
            const duplicate = await tx.posOrder.findFirst({
              where: {
                companyId: scopedCompanyId,
                externalProvider: data.externalProvider,
                externalOrderId: data.externalOrderId,
              },
            });
            if (duplicate) throw new PosServiceError("La orden externa ya existe.", 409);
          }

          const order = await tx.posOrder.create({
            data: {
              companyId: scopedCompanyId,
              outletId: data.outletId,
              sessionId: data.sessionId ?? null,
              terminalId: data.terminalId ?? null,
              tableId: data.tableId ?? null,
              orderNumber: await nextOrderNumber(tx, scopedCompanyId),
              status: "OPEN",
              fulfillmentType: data.fulfillmentType ?? "DINE_IN",
              salesChannel: data.salesChannel ?? "IN_STORE",
              externalProvider: data.externalProvider ?? null,
              externalOrderId: data.externalOrderId ?? null,
              customerName: normalizeText(data.customerName),
              customerPhone: normalizeText(data.customerPhone),
              guestCount: Number(data.guestCount ?? 1),
              notes: normalizeText(data.notes),
              createdById: actorId,
              waiterId: actorId,
            },
          });

          if ((data.fulfillmentType ?? "DINE_IN") === "DINE_IN") {
            const count = Number(data.guestCount ?? 1);
            await tx.posGuestSeat.createMany({
              data: Array.from({ length: count }, (_, index) => ({
                orderId: order.id,
                label: `Comensal ${index + 1}`,
                position: index + 1,
              })),
            });
          }

          if (data.tableId) {
            await tx.posTable.update({
              where: { id: data.tableId },
              data: { status: "OCCUPIED", waiterId: actorId },
            });
          }

          const hydrated = await hydrateOrder(tx, { companyId: scopedCompanyId, id: order.id });
          await writeAudit(tx, {
            actorId,
            entityType: "PosOrder",
            entityId: order.id,
            action: "pos.order.create",
            after: hydrated,
          });
          return hydrated;
        });
      } catch (err) {
        const isNumberConflict =
          err?.code === "P2002" &&
          String(err?.meta?.target ?? err?.meta?.modelName ?? "").toLowerCase().includes("order");
        if (isNumberConflict && attempt < 3) continue;
        throw err;
      }
    }
  }

  async function getOrderById({ companyId, id }) {
    return hydrateOrder(prisma, { companyId: requireCompanyId(companyId), id });
  }

  async function updateOrder({ companyId, id, actorId, data }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const before = await hydrateOrder(prisma, { companyId: scopedCompanyId, id });
    assertEditableOrder(before);
    const updated = await prisma.posOrder.update({
      where: { id },
      data: cleanData(data),
    });
    await writeAudit(prisma, {
      actorId,
      entityType: "PosOrder",
      entityId: id,
      action: "pos.order.update",
      before,
      after: updated,
    });
    return hydrateOrder(prisma, { companyId: scopedCompanyId, id });
  }

  async function assignOrderWaiter({ companyId, actorId, id, waiterId }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const order = await prisma.posOrder.findFirst({ where: { id, companyId: scopedCompanyId } });
    if (!order) throw new PosServiceError("Orden POS no encontrada.", 404);
    assertEditableOrder(order);

    if (waiterId) await createUserAccessService({ prisma }).assertCandidates({ companyId: scopedCompanyId, userIds: [waiterId] });
    if (waiterId) {
      const profile = await prisma.userProfile.findUnique({
        where: { id: waiterId },
        select: { id: true },
      });
      if (!profile) throw new PosServiceError("Usuario no encontrado.", 404);
    }

    await prisma.posOrder.update({ where: { id }, data: { waiterId: waiterId ?? null } });

    await writeAudit(prisma, {
      actorId,
      entityType: "PosOrder",
      entityId: id,
      action: "pos.order.waiter.assign",
      before: { waiterId: order.waiterId },
      after: { waiterId: waiterId ?? null },
    });

    return hydrateOrder(prisma, { companyId: scopedCompanyId, id });
  }

  // Re-asserts OCCUPIED + waiterId on the order's table when a user resumes an
  // already-open order. createOrder sets this at creation time, but nothing
  // re-applied it on resume — so a table whose status had drifted back to
  // AVAILABLE (stale data, a status reset elsewhere, etc.) stayed AVAILABLE
  // even while its order kept being worked on. Idempotent: safe to call even
  // when the table is already correctly OCCUPIED by the same waiter.
  async function claimOrder({ companyId, actorId, id }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const order = await prisma.posOrder.findFirst({ where: { id, companyId: scopedCompanyId } });
    assertEditableOrder(order);

    await prisma.$transaction(async (tx) => {
      if (order.waiterId !== actorId) {
        await tx.posOrder.update({ where: { id }, data: { waiterId: actorId } });
      }
      if (order.tableId) {
        await tx.posTable.update({
          where: { id: order.tableId },
          data: { status: "OCCUPIED", waiterId: actorId },
        });
      }
    });

    await writeAudit(prisma, {
      actorId,
      entityType: "PosOrder",
      entityId: id,
      action: "pos.order.claim",
      before: { waiterId: order.waiterId, tableId: order.tableId },
      after: { waiterId: actorId, tableId: order.tableId },
    });

    return hydrateOrder(prisma, { companyId: scopedCompanyId, id });
  }

  async function getSeatTotals({ companyId, id }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const order = await prisma.posOrder.findFirst({ where: { id, companyId: scopedCompanyId } });
    if (!order) throw new PosServiceError("Orden POS no encontrada.", 404);

    const [lines, guests, payments] = await Promise.all([
      prisma.posOrderLine.findMany({ where: { orderId: id } }),
      prisma.posGuestSeat.findMany({ where: { orderId: id }, orderBy: { position: "asc" } }),
      prisma.posPayment.findMany({ where: { orderId: id } }),
    ]);

    const seatMap = new Map();
    seatMap.set(null, { id: null, label: "Sin asignar", position: 0, lines: [] });
    for (const guest of guests) {
      seatMap.set(guest.id, { id: guest.id, label: guest.label, position: guest.position, lines: [] });
    }
    for (const line of lines) {
      const key = line.guestSeatId ?? null;
      const bucket = seatMap.has(key) ? seatMap.get(key) : seatMap.get(null);
      bucket.lines.push(line);
    }

    const seats = Array.from(seatMap.values())
      .filter((seat) => seat.lines.length > 0)
      .sort((a, b) => {
        if (a.id === null) return 1;
        if (b.id === null) return -1;
        return a.position - b.position;
      })
      .map((seat) => ({
        id: seat.id,
        label: seat.label,
        position: seat.position,
        subtotal: toMoney(
          seat.lines.reduce(
            (sum, line) =>
              sum + Number(line.quantity) * Number(line.unitPrice) - Number(line.discountAmount ?? 0),
            0,
          ),
        ),
        taxAmount: toMoney(seat.lines.reduce((sum, line) => sum + Number(line.taxAmount ?? 0), 0)),
        total: toMoney(seat.lines.reduce((sum, line) => sum + Number(line.totalAmount), 0)),
        linesCount: seat.lines.length,
      }));

    const paidAmount = toMoney(payments.reduce((sum, payment) => sum + Number(payment.amount), 0));
    const orderTotal = toMoney(Number(order.totalAmount));

    return {
      seats,
      orderTotal,
      paidAmount,
      remaining: toMoney(orderTotal - paidAmount),
    };
  }

  async function addGuest({ companyId, orderId, actorId, data }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const order = await hydrateOrder(prisma, { companyId: scopedCompanyId, id: orderId });
    assertEditableOrder(order);
    const guest = await prisma.posGuestSeat.create({
      data: {
        orderId,
        label: data.label.trim(),
        position: await nextGuestPosition(prisma, orderId),
      },
    });
    await prisma.posOrder.update({
      where: { id: orderId },
      data: { guestCount: order.guests.length + 1 },
    });
    await writeAudit(prisma, {
      actorId,
      entityType: "PosGuestSeat",
      entityId: guest.id,
      action: "pos.guest.create",
      after: guest,
    });
    return guest;
  }

  async function addOrderLine({ companyId, orderId, actorId, data }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const before = await hydrateOrder(prisma, { companyId: scopedCompanyId, id: orderId });
    assertEditableOrder(before);
    const taxRate = await getDefaultTaxRate(prisma, scopedCompanyId);
    const snapshot = await loadCatalogSnapshot(prisma, {
      companyId: scopedCompanyId,
      productId: data.productId,
      variantId: data.variantId,
      unitPrice: data.unitPrice,
    });
    const selection = await modifierSvc.resolveSelection({
      companyId: scopedCompanyId,
      productId: snapshot.productId,
      optionIds: (data.modifiers ?? []).map((m) => m.optionId),
    });
    const unitPrice =
      selection.snapshots.length > 0 || selection.totalDelta !== 0
        ? toMoney(Number(snapshot.catalogPrice) + selection.totalDelta)
        : snapshot.unitPrice;
    const quantity = Number(data.quantity);
    const amounts = lineAmounts({ quantity, unitPrice, taxRate });
    const line = await prisma.$transaction(async (tx) => {
      const created = await tx.posOrderLine.create({
        data: {
          orderId,
          guestSeatId: data.guestSeatId ?? null,
          productId: snapshot.productId,
          variantId: snapshot.variantId,
          productName: snapshot.productName,
          sku: snapshot.sku,
          quantity,
          unitPrice,
          discountAmount: 0,
          taxRate,
          taxAmount: amounts.taxAmount,
          totalAmount: amounts.totalAmount,
          note: normalizeText(data.note),
        },
      });
      if (selection.snapshots.length > 0) {
        await tx.posOrderLineModifier.createMany({
          data: selection.snapshots.map((s) => ({
            companyId: scopedCompanyId,
            lineId: created.id,
            optionId: s.optionId,
            groupName: s.groupName,
            optionName: s.optionName,
            priceDelta: s.priceDelta,
          })),
        });
      }
      return created;
    });
    const after = await recalculateOrderTotals(prisma, { companyId: scopedCompanyId, orderId });
    await writeAudit(prisma, {
      actorId,
      entityType: "PosOrderLine",
      entityId: line.id,
      action: "pos.order_line.create",
      before,
      after,
    });
    return line;
  }

  async function updateOrderLine({ companyId, orderId, lineId, actorId, data }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const order = await hydrateOrder(prisma, { companyId: scopedCompanyId, id: orderId });
    assertEditableOrder(order);
    const before = await prisma.posOrderLine.findFirst({ where: { id: lineId, orderId } });
    if (!before) throw new PosServiceError("Linea de orden no encontrada.", 404);
    const next = {
      quantity: data.quantity === undefined ? Number(before.quantity) : Number(data.quantity),
      unitPrice: data.unitPrice === undefined ? Number(before.unitPrice) : toMoney(data.unitPrice),
      discountAmount: Number(before.discountAmount ?? 0),
      taxRate: Number(before.taxRate ?? 0),
    };
    const amounts = lineAmounts(next);
    const line = await prisma.posOrderLine.update({
      where: { id: lineId },
      data: {
        ...cleanData(data),
        quantity: next.quantity,
        unitPrice: next.unitPrice,
        taxAmount: amounts.taxAmount,
        totalAmount: amounts.totalAmount,
      },
    });
    const after = await recalculateOrderTotals(prisma, { companyId: scopedCompanyId, orderId });
    await writeAudit(prisma, {
      actorId,
      entityType: "PosOrderLine",
      entityId: line.id,
      action: "pos.order_line.update",
      before,
      after,
    });
    return line;
  }

  async function deleteOrderLine({ companyId, orderId, lineId, actorId }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const order = await hydrateOrder(prisma, { companyId: scopedCompanyId, id: orderId });
    assertEditableOrder(order);
    const before = await prisma.posOrderLine.findFirst({ where: { id: lineId, orderId } });
    if (!before) throw new PosServiceError("Linea de orden no encontrada.", 404);
    await prisma.posOrderLine.delete({ where: { id: lineId } });
    const after = await recalculateOrderTotals(prisma, { companyId: scopedCompanyId, orderId });
    await writeAudit(prisma, {
      actorId,
      entityType: "PosOrderLine",
      entityId: lineId,
      action: "pos.order_line.delete",
      before,
      after,
    });
    return after;
  }

  async function addPayment({ companyId, orderId, actorId, data }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const before = await hydrateOrder(prisma, { companyId: scopedCompanyId, id: orderId });
    if (["CANCELLED", "REFUNDED"].includes(before.status)) {
      throw new PosServiceError("La orden no admite pagos.", 409);
    }
    const method = await prisma.posPaymentMethod.findFirst({
      where: { id: data.paymentMethodId, companyId: scopedCompanyId, enabled: true },
    });
    if (!method) throw new PosServiceError("Metodo de pago POS no encontrado.", 404);

    let sessionId = data.sessionId ?? null;
    let waiterShiftId = null;
    if (sessionId) {
      const session = await prisma.posSession.findFirst({
        where: { id: sessionId, companyId: scopedCompanyId, status: "OPEN" },
      });
      if (!session) throw new PosServiceError("Sesion de caja no encontrada o cerrada.", 404);
    } else {
      const shift = await shiftSvc.ensureOpenShift({
        companyId: scopedCompanyId,
        outletId: before.outletId,
        waiterId: actorId,
      });
      waiterShiftId = shift.id;
    }

    const amount = toMoney(data.amount);
    const remaining = toMoney(Number(before.totalAmount ?? 0) - Number(before.paidAmount ?? 0));
    if (amount > remaining) throw new PosServiceError("El pago excede el total pendiente.", 400);

    const paidAmount = toMoney(Number(before.paidAmount ?? 0) + amount);
    const status = paidAmount >= Number(before.totalAmount ?? 0) ? "PAID" : before.status;
    const isCash = method.kind === "CASH";

    // The payment row, the order's paidAmount/status, the waiter-shift cash
    // total and the table status are written atomically. The order update is a
    // conditional updateMany keyed on the paidAmount we read — a concurrent
    // payment that already committed makes count === 0, so we 409 instead of
    // over-charging.
    const payment = await prisma.$transaction(async (tx) => {
      const upd = await tx.posOrder.updateMany({
        where: {
          id: orderId,
          companyId: scopedCompanyId,
          paidAmount: before.paidAmount ?? 0,
          status: { notIn: ["CANCELLED", "REFUNDED", "PAID"] },
        },
        data: {
          paidAmount,
          status,
          ...(status === "PAID" ? { paidAt: new Date() } : {}),
        },
      });
      if (upd.count !== 1) {
        throw new PosServiceError(
          "El pago fallo por una modificacion concurrente de la orden. Reintenta.",
          409,
        );
      }
      const created = await tx.posPayment.create({
        data: {
          companyId: scopedCompanyId,
          orderId,
          paymentMethodId: method.id,
          amount,
          status: "CAPTURED",
          reference: normalizeText(data.reference),
          createdById: actorId,
          sessionId,
          waiterShiftId,
        },
      });
      if (waiterShiftId && isCash) {
        await tx.posWaiterShift.updateMany({
          where: { id: waiterShiftId, companyId: scopedCompanyId, status: "OPEN" },
          data: { expectedCashAmount: { increment: amount } },
        });
      }
      if (status === "PAID" && before.tableId) {
        await tx.posTable.update({ where: { id: before.tableId }, data: { status: "DIRTY" } });
      }
      return created;
    });

    const after = await hydrateOrder(prisma, { companyId: scopedCompanyId, id: orderId });
    await writeAudit(prisma, {
      actorId,
      entityType: "PosPayment",
      entityId: payment.id,
      action: "pos.payment.create",
      before,
      after,
    });
    return payment;
  }

  async function cancelOrder({ companyId, orderId, actorId, reason }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const before = await hydrateOrder(prisma, { companyId: scopedCompanyId, id: orderId });
    assertEditableOrder(before);
    const updated = await prisma.posOrder.update({
      where: { id: orderId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        notes: normalizeText(reason) ?? before.notes,
      },
    });
    if (before.tableId) {
      await prisma.posTable.update({ where: { id: before.tableId }, data: { status: "AVAILABLE" } });
    }
    await writeAudit(prisma, {
      actorId,
      entityType: "PosOrder",
      entityId: orderId,
      action: "pos.order.cancel",
      before,
      after: updated,
    });
    return hydrateOrder(prisma, { companyId: scopedCompanyId, id: orderId });
  }

  async function reprintReceipt({ companyId, orderId, actorId }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const order = await hydrateOrder(prisma, { companyId: scopedCompanyId, id: orderId });
    const lastReceipt =
      typeof prisma.posReceipt.findFirst === "function"
        ? await prisma.posReceipt.findFirst({
            where: { companyId: scopedCompanyId },
            orderBy: { receiptNumber: "desc" },
          })
        : null;
    const receipt = await prisma.posReceipt.create({
      data: {
        companyId: scopedCompanyId,
        orderId,
        receiptNumber: Number(lastReceipt?.receiptNumber ?? 0) + 1,
        kind: "REPRINT",
        payload: order,
        printedCount: 1,
      },
    });
    await writeAudit(prisma, {
      actorId,
      entityType: "PosReceipt",
      entityId: receipt.id,
      action: "pos.receipt.reprint",
      after: receipt,
    });
    return receipt;
  }

  return {
    listOrders,
    createOrder,
    getOrderById,
    updateOrder,
    addGuest,
    addOrderLine,
    updateOrderLine,
    deleteOrderLine,
    addPayment,
    cancelOrder,
    reprintReceipt,
    assignOrderWaiter,
    claimOrder,
    getSeatTotals,
  };
}
