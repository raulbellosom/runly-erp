import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPosFloorService } from "../pos-floor-service.js";
import { createPosKitchenService } from "../pos-kitchen-service.js";
import { PosServiceError } from "../service-helpers.js";

function makePrisma() {
  const floors = new Map();
  const tables = new Map();
  const stations = new Map();
  const outlets = new Map([['outlet-1', { id: 'outlet-1', companyId: 'company-1' }]]);
  const orders = new Map();
  const lines = new Map();
  const configs = new Map();
  const tickets = new Map();
  const ticketLines = new Map();
  const orderLineModifiers = new Map();
  const audits = [];

  const profiles = new Map([
    ["user-1", { id: "user-1", displayName: "Mesero Principal" }],
  ]);

  const prisma = {
    floors,
    tables,
    stations,
    outlets,
    orders,
    lines,
    configs,
    tickets,
    ticketLines,
    orderLineModifiers,
    audits,
    profiles,
    $transaction: async (fn) => fn(prisma),
    userProfile: {
      findUnique: async ({ where }) => profiles.get(where.id) ?? null,
      findMany: async ({ where }) => {
        const ids = where?.id?.in ?? [];
        return ids.map((id) => profiles.get(id)).filter(Boolean);
      },
    },
    posFloor: {
      findMany: async ({ where }) =>
        [...floors.values()].filter(
          (row) => row.companyId === where.companyId && (!where.outletId || row.outletId === where.outletId),
        ),
      findFirst: async ({ where }) =>
        [...floors.values()].find((row) => {
          if (where.id && row.id !== where.id) return false;
          if (where.companyId && row.companyId !== where.companyId) return false;
          if (where.outletId && row.outletId !== where.outletId) return false;
          if (where.isActive !== undefined && row.isActive !== where.isActive) return false;
          return true;
        }) ?? null,
      create: async ({ data }) => {
        const row = { id: `floor-${floors.size + 1}`, isActive: false, ...data };
        floors.set(row.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = { ...floors.get(where.id), ...data };
        floors.set(where.id, row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of floors.values()) {
          if (row.companyId === where.companyId && row.outletId === where.outletId && row.id !== where.id?.not) {
            floors.set(row.id, { ...row, ...data });
            count++;
          }
        }
        return { count };
      },
    },
    posTable: {
      findMany: async ({ where }) =>
        [...tables.values()].filter((row) => {
          if (where.floorId && row.floorId !== where.floorId) return false;
          if (where.waiterId !== undefined && row.waiterId !== where.waiterId) return false;
          if (where.enabled !== undefined && row.enabled !== where.enabled) return false;
          return true;
        }),
      findFirst: async ({ where }) =>
        [...tables.values()].find((row) => {
          if (where.id && row.id !== where.id) return false;
          if (where.companyId && row.companyId !== where.companyId) return false;
          return true;
        }) ?? null,
      create: async ({ data }) => {
        const row = { id: `table-${tables.size + 1}`, status: "AVAILABLE", enabled: true, ...data };
        tables.set(row.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = { ...tables.get(where.id), ...data };
        tables.set(where.id, row);
        return row;
      },
    },
    posFloorZone: { findMany: async () => [] },
    posFloorElement: { findMany: async () => [] },
    posKitchenStation: {
      findMany: async ({ where }) =>
        [...stations.values()].filter(
          (row) => row.companyId === where.companyId && (!where.outletId || row.outletId === where.outletId),
        ),
      findFirst: async ({ where }) =>
        [...stations.values()].find((row) => row.id === where.id && row.companyId === where.companyId) ?? null,
      count: async ({ where }) =>
        [...stations.values()].filter(
          (row) => !where?.companyId || row.companyId === where.companyId,
        ).length,
      create: async ({ data }) => {
        const row = { id: `station-${stations.size + 1}`, enabled: true, ...data };
        stations.set(row.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = { ...stations.get(where.id), ...data };
        stations.set(where.id, row);
        return row;
      },
    },
    posOutlet: {
      findFirst: async ({ where }) =>
        [...outlets.values()].find((row) => row.id === where.id && row.companyId === where.companyId) ?? null,
    },
    posOrder: {
      findFirst: async ({ where }) =>
        [...orders.values()].find((row) => row.id === where.id && row.companyId === where.companyId) ?? null,
      update: async ({ where, data }) => {
        const row = { ...orders.get(where.id), ...data };
        orders.set(where.id, row);
        return row;
      },
    },
    posOrderLine: {
      findMany: async ({ where }) => {
        if (where?.id?.in) {
          const ids = where.id.in;
          return [...lines.values()].filter((row) => ids.includes(row.id));
        }
        return [...lines.values()].filter((row) => row.orderId === where.orderId);
      },
      update: async ({ where, data }) => {
        const row = { ...lines.get(where.id), ...data };
        lines.set(where.id, row);
        return row;
      },
    },
    posProductConfig: {
      findFirst: async ({ where }) =>
        [...configs.values()].find(
          (row) =>
            row.companyId === where.companyId &&
            row.productId === where.productId &&
            (where.variantId === undefined || row.variantId === where.variantId),
        ) ?? null,
      findMany: async ({ where }) =>
        [...configs.values()].filter((row) => row.companyId === where.companyId),
      create: async ({ data }) => {
        const row = { id: `config-${configs.size + 1}`, ...data };
        configs.set(row.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = { ...configs.get(where.id), ...data };
        configs.set(where.id, row);
        return row;
      },
    },
    posKitchenTicket: {
      findMany: async ({ where, include }) => {
        const rows = [...tickets.values()].filter(
          (row) =>
            row.companyId === where.companyId &&
            (!where.stationId || row.stationId === where.stationId) &&
            (!where.status || row.status === where.status),
        );
        if (!include?.lines) return rows;
        return rows.map((row) => ({
          ...row,
          lines: [...ticketLines.values()].filter((l) => l.ticketId === row.id),
        }));
      },
      findFirst: async ({ where }) =>
        [...tickets.values()].find((row) => row.id === where.id && row.companyId === where.companyId) ??
        null,
      create: async ({ data }) => {
        const row = { id: `ticket-${tickets.size + 1}`, status: "PENDING", ...data };
        tickets.set(row.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = { ...tickets.get(where.id), ...data };
        tickets.set(where.id, row);
        return row;
      },
    },
    posKitchenTicketLine: {
      createMany: async ({ data }) => {
        for (const item of data) {
          const row = { id: `ticket-line-${ticketLines.size + 1}`, status: "PENDING", ...item };
          ticketLines.set(row.id, row);
        }
        return { count: data.length };
      },
      findFirst: async ({ where }) =>
        [...ticketLines.values()].find((row) => row.id === where.id && row.ticketId === where.ticketId) ??
        null,
      update: async ({ where, data }) => {
        const row = { ...ticketLines.get(where.id), ...data };
        ticketLines.set(where.id, row);
        return row;
      },
    },
    posOrderLineModifier: {
      findMany: async ({ where }) => {
        const ids = where?.lineId?.in ?? [];
        return [...orderLineModifiers.values()].filter((row) => ids.includes(row.lineId));
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data);
        return data;
      },
    },
  };

  return prisma;
}

describe("createPosFloorService", () => {
  it("publishes one floor per outlet and updates table status", async () => {
    const prisma = makePrisma();
    const svc = createPosFloorService({ prisma });
    const first = await svc.createFloor({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", name: "Salon" },
    });
    const second = await svc.createFloor({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", name: "Terraza" },
    });

    await svc.publishFloor({ companyId: "company-1", id: first.id, actorId: "user-1" });
    await svc.publishFloor({ companyId: "company-1", id: second.id, actorId: "user-1" });

    assert.equal(prisma.floors.get(first.id).isActive, false);
    assert.equal(prisma.floors.get(second.id).isActive, true);

    const table = await svc.createTable({
      companyId: "company-1",
      actorId: "user-1",
      data: { floorId: second.id, name: "M1", capacity: 4 },
    });
    const updated = await svc.updateTableStatus({
      companyId: "company-1",
      tableId: table.id,
      actorId: "user-1",
      status: "OCCUPIED",
    });
    assert.equal(updated.status, "OCCUPIED");
  });

  it("rejects table creation outside company floor scope", async () => {
    const prisma = makePrisma();
    const svc = createPosFloorService({ prisma });
    const floor = await svc.createFloor({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", name: "Salon" },
    });

    await assert.rejects(
      () =>
        svc.createTable({
          companyId: "company-2",
          actorId: "user-1",
          data: { floorId: floor.id, name: "M1" },
        }),
      (err) => err instanceof PosServiceError && err.status === 404,
    );
  });

  it("updateTableWaiter sets waiterId and updateTableStatus AVAILABLE clears it", async () => {
    const prisma = makePrisma();
    const svc = createPosFloorService({ prisma });
    const floor = await svc.createFloor({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", name: "Salon" },
    });
    const table = await svc.createTable({
      companyId: "company-1",
      actorId: "user-1",
      data: { floorId: floor.id, name: "Mesa 1", capacity: 4 },
    });
    const assigned = await svc.updateTableWaiter({
      companyId: "company-1",
      actorId: "user-1",
      tableId: table.id,
      waiterId: "user-1",
    });
    assert.equal(assigned.waiterId, "user-1");
    const auditEntry = prisma.audits.find((a) => a.action === "pos.table.waiter.assign");
    assert.ok(auditEntry, "audit entry for table waiter.assign must exist");
    const cleared = await svc.updateTableStatus({
      companyId: "company-1",
      actorId: "user-1",
      tableId: table.id,
      status: "AVAILABLE",
    });
    assert.equal(cleared.waiterId, null);
  });

  it("updateTableWaiter rejects an unknown waiterId with 404", async () => {
    const prisma = makePrisma();
    const svc = createPosFloorService({ prisma });
    const floor = await svc.createFloor({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", name: "Salon" },
    });
    const table = await svc.createTable({
      companyId: "company-1",
      actorId: "user-1",
      data: { floorId: floor.id, name: "Mesa 1", capacity: 4 },
    });
    await assert.rejects(
      () =>
        svc.updateTableWaiter({
          companyId: "company-1",
          actorId: "user-1",
          tableId: table.id,
          waiterId: "nonexistent-user",
        }),
      (err) => err instanceof PosServiceError && err.status === 404,
    );
  });

  // Regression: myTablesOnly used to filter non-mine tables out of the query
  // entirely, which left the operational canvas with no status data for them
  // and made it fall back to a false "Disponible" ghost. It must now return
  // every table (real status intact) and only annotate which ones are mine.
  it("getActiveMap with myTablesOnly:true returns every table with an isMine flag, not a filtered subset", async () => {
    const prisma = makePrisma();
    const svc = createPosFloorService({ prisma });
    const floor = await svc.createFloor({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", name: "Salon" },
    });
    await svc.publishFloor({ companyId: "company-1", id: floor.id, actorId: "user-1" });
    const myTable = await svc.createTable({
      companyId: "company-1",
      actorId: "user-1",
      data: { floorId: floor.id, name: "Mesa A", capacity: 2 },
    });
    const otherTable = await svc.createTable({
      companyId: "company-1",
      actorId: "user-1",
      data: { floorId: floor.id, name: "Mesa B", capacity: 2 },
    });
    await svc.updateTableWaiter({
      companyId: "company-1",
      actorId: "user-1",
      tableId: myTable.id,
      waiterId: "user-1",
    });
    const map = await svc.getActiveMap({
      companyId: "company-1",
      outletId: "outlet-1",
      myTablesOnly: true,
      actorId: "user-1",
    });
    assert.ok(map, "active map must exist");
    assert.strictEqual(map.tables.length, 2, "must include every table, not just mine");
    const mine = map.tables.find((t) => t.id === myTable.id);
    const other = map.tables.find((t) => t.id === otherTable.id);
    assert.equal(mine.isMine, true);
    assert.equal(mine.waiterName, "Mesero Principal");
    assert.equal(other.isMine, false);
    assert.equal(other.status, "AVAILABLE", "non-mine table must still carry its real status");
  });

  it("getActiveMap without myTablesOnly never sets isMine on any table", async () => {
    const prisma = makePrisma();
    const svc = createPosFloorService({ prisma });
    const floor = await svc.createFloor({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", name: "Salon" },
    });
    await svc.publishFloor({ companyId: "company-1", id: floor.id, actorId: "user-1" });
    await svc.createTable({
      companyId: "company-1",
      actorId: "user-1",
      data: { floorId: floor.id, name: "Mesa A", capacity: 2 },
    });
    const map = await svc.getActiveMap({ companyId: "company-1", outletId: "outlet-1" });
    assert.ok(map.tables.every((t) => !("isMine" in t)));
  });
});

describe("createPosKitchenService", () => {
  it("creates one kitchen ticket per station and skips non-prep lines", async () => {
    const prisma = makePrisma();
    const svc = createPosKitchenService({ prisma });
    const tacos = await svc.createStation({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", name: "Tacos", code: "TACOS" },
    });
    const bar = await svc.createStation({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", name: "Bar", code: "BAR" },
    });
    prisma.orders.set("order-1", { id: "order-1", companyId: "company-1" });
    prisma.lines.set("line-1", { id: "line-1", orderId: "order-1", productId: "p1", variantId: null, quantity: 2 });
    prisma.lines.set("line-2", { id: "line-2", orderId: "order-1", productId: "p2", variantId: null, quantity: 1 });
    prisma.lines.set("line-3", { id: "line-3", orderId: "order-1", productId: "p3", variantId: null, quantity: 1 });
    prisma.configs.set("p1", { companyId: "company-1", productId: "p1", variantId: null, requiresPreparation: true, stationId: tacos.id });
    prisma.configs.set("p2", { companyId: "company-1", productId: "p2", variantId: null, requiresPreparation: true, stationId: bar.id });
    prisma.configs.set("p3", { companyId: "company-1", productId: "p3", variantId: null, requiresPreparation: false, stationId: null });

    const result = await svc.sendOrderToKitchen({
      companyId: "company-1",
      orderId: "order-1",
      actorId: "user-1",
    });

    assert.equal(result.tickets.length, 2);
    assert.equal(prisma.ticketLines.size, 2);
  });

  it("rejects prep lines without a station", async () => {
    const prisma = makePrisma();
    const svc = createPosKitchenService({ prisma });
    // A station must exist so the router enters the routing path; stationCount === 0 short-circuits to SENT.
    prisma.stations.set("station-1", { id: "station-1", companyId: "company-1", outletId: "outlet-1", enabled: true });
    prisma.orders.set("order-1", { id: "order-1", companyId: "company-1" });
    prisma.lines.set("line-1", { id: "line-1", orderId: "order-1", productId: "p1", variantId: null, quantity: 1 });
    prisma.configs.set("p1", { companyId: "company-1", productId: "p1", variantId: null, requiresPreparation: true, stationId: null });

    await assert.rejects(
      () => svc.sendOrderToKitchen({ companyId: "company-1", orderId: "order-1", actorId: "user-1" }),
      (err) => err instanceof PosServiceError && err.status === 400,
    );
  });

  it("updates ticket line status and linked order line status", async () => {
    const prisma = makePrisma();
    const svc = createPosKitchenService({ prisma });
    prisma.tickets.set("ticket-1", { id: "ticket-1", companyId: "company-1", stationId: "station-1", status: "PENDING" });
    prisma.lines.set("line-1", { id: "line-1", orderId: "order-1", productId: "p1", kitchenStatus: "PENDING" });
    prisma.ticketLines.set("ticket-line-1", {
      id: "ticket-line-1",
      ticketId: "ticket-1",
      orderLineId: "line-1",
      quantity: 1,
      status: "PENDING",
    });

    await svc.updateTicketLineStatus({
      companyId: "company-1",
      ticketId: "ticket-1",
      lineId: "ticket-line-1",
      actorId: "user-1",
      status: "READY",
    });

    assert.equal(prisma.ticketLines.get("ticket-line-1").status, "READY");
    assert.equal(prisma.lines.get("line-1").kitchenStatus, "READY");
  });

  it("listTickets attaches modifiers and note to each board line", async () => {
    const prisma = makePrisma();
    const svc = createPosKitchenService({ prisma });
    prisma.stations.set("station-1", { id: "station-1", companyId: "company-1", outletId: "outlet-1", enabled: true });
    prisma.tickets.set("ticket-1", {
      id: "ticket-1",
      companyId: "company-1",
      stationId: "station-1",
      status: "PENDING",
      sentAt: new Date(),
    });
    prisma.ticketLines.set("ticket-line-1", {
      id: "ticket-line-1",
      ticketId: "ticket-1",
      orderLineId: "line-1",
      quantity: 1,
      status: "PENDING",
      note: "Sin cebolla",
    });
    prisma.orderLineModifiers.set("mod-1", {
      id: "mod-1",
      lineId: "line-1",
      optionId: "option-1",
      groupName: "Salsa",
      optionName: "Extra queso",
      priceDelta: 10,
    });

    const tickets = await svc.listTickets({ companyId: "company-1", stationId: "station-1" });

    assert.equal(tickets.length, 1);
    const [line] = tickets[0].lines;
    assert.equal(line.note, "Sin cebolla");
    assert.equal(line.modifiers.length, 1);
    assert.equal(line.modifiers[0].optionName, "Extra queso");
    assert.equal(line.modifiers[0].groupName, "Salsa");
  });

  it("falls back missing-station lines to the outlet default station", async () => {
    const prisma = makePrisma();
    const svc = createPosKitchenService({ prisma });
    const tacos = await svc.createStation({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", name: "Tacos", code: "TACOS" },
    });
    prisma.outlets.set("outlet-1", { id: "outlet-1", companyId: "company-1", defaultStationId: tacos.id });
    prisma.orders.set("order-1", { id: "order-1", companyId: "company-1", outletId: "outlet-1" });
    prisma.lines.set("line-1", { id: "line-1", orderId: "order-1", productId: "p1", variantId: null, quantity: 1 });
    prisma.configs.set("p1", { companyId: "company-1", productId: "p1", variantId: null, requiresPreparation: true, stationId: null });

    const result = await svc.sendOrderToKitchen({ companyId: "company-1", orderId: "order-1", actorId: "user-1" });

    assert.equal(result.tickets.length, 1);
    assert.equal(result.tickets[0].stationId, tacos.id);
    assert.equal(prisma.ticketLines.size, 1);
    const [ticketLine] = prisma.ticketLines.values();
    assert.equal(ticketLine.orderLineId, "line-1");
  });

  it("still rejects prep lines without a station when the outlet has no default station", async () => {
    const prisma = makePrisma();
    const svc = createPosKitchenService({ prisma });
    prisma.stations.set("station-1", { id: "station-1", companyId: "company-1", outletId: "outlet-1", enabled: true });
    prisma.outlets.set("outlet-1", { id: "outlet-1", companyId: "company-1", defaultStationId: null });
    prisma.orders.set("order-1", { id: "order-1", companyId: "company-1", outletId: "outlet-1" });
    prisma.lines.set("line-1", { id: "line-1", orderId: "order-1", productId: "p1", variantId: null, quantity: 1 });
    prisma.configs.set("p1", { companyId: "company-1", productId: "p1", variantId: null, requiresPreparation: true, stationId: null });

    await assert.rejects(
      () => svc.sendOrderToKitchen({ companyId: "company-1", orderId: "order-1", actorId: "user-1" }),
      (err) =>
        err instanceof PosServiceError &&
        err.status === 400 &&
        err.message ===
          "Los siguientes productos no tienen estación de preparación asignada: Producto desconocido. Configúralos en POS → Configuración → Estaciones.",
    );
  });

  it("routes mixed lines: own station plus outlet-default fallback", async () => {
    const prisma = makePrisma();
    const svc = createPosKitchenService({ prisma });
    const grill = await svc.createStation({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", name: "Parrilla", code: "GRILL" },
    });
    const tacos = await svc.createStation({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", name: "Tacos", code: "TACOS" },
    });
    prisma.outlets.set("outlet-1", { id: "outlet-1", companyId: "company-1", defaultStationId: tacos.id });
    prisma.orders.set("order-1", { id: "order-1", companyId: "company-1", outletId: "outlet-1" });
    prisma.lines.set("line-a", { id: "line-a", orderId: "order-1", productId: "pa", variantId: null, quantity: 1 });
    prisma.lines.set("line-b", { id: "line-b", orderId: "order-1", productId: "pb", variantId: null, quantity: 1 });
    prisma.configs.set("pa", { companyId: "company-1", productId: "pa", variantId: null, requiresPreparation: true, stationId: grill.id });
    prisma.configs.set("pb", { companyId: "company-1", productId: "pb", variantId: null, requiresPreparation: true, stationId: null });

    const result = await svc.sendOrderToKitchen({ companyId: "company-1", orderId: "order-1", actorId: "user-1" });

    assert.equal(result.tickets.length, 2);
    const tacosTicket = result.tickets.find((t) => t.stationId === tacos.id);
    const grillTicket = result.tickets.find((t) => t.stationId === grill.id);
    assert.ok(tacosTicket, "tacos ticket must exist");
    assert.ok(grillTicket, "grill ticket must exist");
    const tacosLines = [...prisma.ticketLines.values()].filter((l) => l.ticketId === tacosTicket.id);
    const grillLines = [...prisma.ticketLines.values()].filter((l) => l.ticketId === grillTicket.id);
    assert.equal(tacosLines.length, 1);
    assert.equal(tacosLines[0].orderLineId, "line-b");
    assert.equal(grillLines.length, 1);
    assert.equal(grillLines[0].orderLineId, "line-a");
  });

  it("listTickets attaches orderLine productName and quantity via batch join, null when missing", async () => {
    const prisma = makePrisma();
    const svc = createPosKitchenService({ prisma });
    prisma.stations.set("station-1", { id: "station-1", companyId: "company-1", outletId: "outlet-1", enabled: true });
    prisma.tickets.set("ticket-1", {
      id: "ticket-1",
      companyId: "company-1",
      stationId: "station-1",
      status: "PENDING",
      sentAt: new Date(),
    });
    prisma.lines.set("line-1", { id: "line-1", orderId: "order-1", productId: "p1", productName: "Taco al pastor", quantity: 3 });
    prisma.ticketLines.set("ticket-line-1", {
      id: "ticket-line-1",
      ticketId: "ticket-1",
      orderLineId: "line-1",
      quantity: 3,
      status: "PENDING",
    });
    prisma.ticketLines.set("ticket-line-2", {
      id: "ticket-line-2",
      ticketId: "ticket-1",
      orderLineId: "missing-line",
      quantity: 1,
      status: "PENDING",
    });

    const tickets = await svc.listTickets({ companyId: "company-1", stationId: "station-1" });

    assert.equal(tickets.length, 1);
    const line1 = tickets[0].lines.find((l) => l.orderLineId === "line-1");
    const line2 = tickets[0].lines.find((l) => l.orderLineId === "missing-line");
    assert.deepEqual(line1.orderLine, { productName: "Taco al pastor", quantity: 3 });
    assert.equal(line2.orderLine, null);
  });

  it("updateProductConfig upserts the (companyId, productId, variantId:null) row, validates station, and audits", async () => {
    const prisma = makePrisma();
    const svc = createPosKitchenService({ prisma });
    const station = await svc.createStation({
      companyId: "company-1",
      actorId: "user-1",
      data: { outletId: "outlet-1", name: "Tacos", code: "TACOS" },
    });

    const created = await svc.updateProductConfig({
      companyId: "company-1",
      actorId: "user-1",
      productId: "p1",
      data: { stationId: station.id, requiresPreparation: true },
    });
    assert.equal(created.productId, "p1");
    assert.equal(created.variantId, null);
    assert.equal(created.stationId, station.id);

    const updated = await svc.updateProductConfig({
      companyId: "company-1",
      actorId: "user-1",
      productId: "p1",
      data: { availableInPos: false },
    });
    assert.equal(updated.id, created.id);
    assert.equal(updated.availableInPos, false);
    assert.equal(prisma.configs.size, 1);

    const auditEntry = prisma.audits.find((a) => a.action === "pos.productConfig.update");
    assert.ok(auditEntry, "audit entry for pos.productConfig.update must exist");

    await assert.rejects(
      () =>
        svc.updateProductConfig({
          companyId: "company-1",
          actorId: "user-1",
          productId: "p1",
          data: { stationId: "foreign-station" },
        }),
      (err) =>
        err instanceof PosServiceError &&
        err.status === 404 &&
        err.message === "Estación de preparación no encontrada.",
    );
  });

  it("listProductConfigs returns only the company's rows", async () => {
    const prisma = makePrisma();
    const svc = createPosKitchenService({ prisma });
    await svc.updateProductConfig({
      companyId: "company-1",
      actorId: "user-1",
      productId: "p1",
      data: { requiresPreparation: true },
    });
    await svc.updateProductConfig({
      companyId: "company-2",
      actorId: "user-1",
      productId: "p2",
      data: { requiresPreparation: true },
    });

    const rows = await svc.listProductConfigs({ companyId: "company-1" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].productId, "p1");
  });
});
