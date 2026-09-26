// apps/api/src/routes/pos/pos-floor-routes.js
//
// Floor plans/tables, kitchen stations/tickets, and reservations. Extracted
// from pos-routes.js on 2026-09-25 to keep that file under the CLAUDE.md
// 800-line proactive-split threshold, following the calendar module's
// calendar-google-routes.js extraction pattern (services with no
// construction-time side effects are safe to re-instantiate per file).
import { Hono } from "hono";
import { createPosFloorService } from "./pos-floor-service.js";
import { createPosKitchenService } from "./pos-kitchen-service.js";
import { createPosReservationService } from "./pos-reservation-service.js";
import { getActorId, getCompanyId, PosServiceError } from "./service-helpers.js";
import {
  assignWaiterSchema,
  createFloorSchema,
  createReservationSchema,
  createStationSchema,
  createTableSchema,
  kitchenStatusUpdateSchema,
  saveLayoutSchema,
  seatReservationSchema,
  tableStatusUpdateSchema,
  updateFloorSchema,
  updateReservationSchema,
  updateStationSchema,
  updateTableSchema,
} from "./validators.js";

function zodMessage(error) {
  return error?.issues?.[0]?.message ?? error?.errors?.[0]?.message ?? "Datos invalidos.";
}

async function parseBody(c, schema) {
  const body = await c.req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new PosServiceError(zodMessage(parsed.error), 400);
  return parsed.data;
}

function context(c) {
  return {
    companyId: getCompanyId(c),
    actorId: getActorId(c),
  };
}

function handleError(c, err, fallback) {
  if (err instanceof PosServiceError) return c.json({ error: err.message }, err.status);
  if (err?.name === "ZodError") return c.json({ error: zodMessage(err) }, 400);
  if (process.env.NODE_ENV !== "production") console.error("[runly.pos]", err);
  return c.json({ error: fallback }, 500);
}

export function createPosFloorRoutes({ prisma, requirePermission }) {
  const app = new Hono();
  const floorSvc = createPosFloorService({ prisma });
  const kitchenSvc = createPosKitchenService({ prisma });
  const reservationSvc = createPosReservationService({ prisma });

  app.get("/pos/floors", requirePermission("pos.floor.read"), async (c) => {
    try {
      return c.json({ data: await floorSvc.listFloors({ ...context(c), outletId: c.req.query("outletId") }) });
    } catch (err) {
      return handleError(c, err, "No se pudieron consultar los planos POS.");
    }
  });

  app.post("/pos/floors", requirePermission("pos.floor.manage"), async (c) => {
    try {
      const data = await parseBody(c, createFloorSchema);
      return c.json({ data: await floorSvc.createFloor({ ...context(c), data }) }, 201);
    } catch (err) {
      return handleError(c, err, "No se pudo crear el plano POS.");
    }
  });

  app.get("/pos/floors/:id", requirePermission("pos.floor.read"), async (c) => {
    try {
      return c.json({
        data: await floorSvc.getFloorWithLayout({
          ...context(c),
          id: c.req.param("id"),
          myTablesOnly: c.req.query("myTablesOnly") === "true",
        }),
      });
    } catch (err) {
      return handleError(c, err, "No se pudo consultar el plano POS.");
    }
  });

  app.patch("/pos/floors/:id", requirePermission("pos.floor.manage"), async (c) => {
    try {
      const data = await parseBody(c, updateFloorSchema);
      return c.json({ data: await floorSvc.updateFloor({ ...context(c), id: c.req.param("id"), data }) });
    } catch (err) {
      return handleError(c, err, "No se pudo actualizar el plano POS.");
    }
  });

  app.post("/pos/floors/:id/publish", requirePermission("pos.floor.manage"), async (c) => {
    try {
      return c.json({ data: await floorSvc.publishFloor({ ...context(c), id: c.req.param("id") }) });
    } catch (err) {
      return handleError(c, err, "No se pudo publicar el plano POS.");
    }
  });

  app.put("/pos/floors/:id/layout", requirePermission("pos.floor.manage"), async (c) => {
    try {
      const data = await parseBody(c, saveLayoutSchema);
      return c.json({ data: await floorSvc.saveLayout({ ...context(c), id: c.req.param("id"), elements: data.elements }) });
    } catch (err) {
      return handleError(c, err, "No se pudo guardar el layout del plano POS.");
    }
  });

  app.post("/pos/tables", requirePermission("pos.floor.manage"), async (c) => {
    try {
      const data = await parseBody(c, createTableSchema);
      return c.json({ data: await floorSvc.createTable({ ...context(c), data }) }, 201);
    } catch (err) {
      return handleError(c, err, "No se pudo crear la mesa POS.");
    }
  });

  app.patch("/pos/tables/:tableId", requirePermission("pos.floor.manage"), async (c) => {
    try {
      const data = await parseBody(c, updateTableSchema);
      return c.json({ data: await floorSvc.updateTable({ ...context(c), tableId: c.req.param("tableId"), data }) });
    } catch (err) {
      return handleError(c, err, "No se pudo actualizar la mesa POS.");
    }
  });

  app.patch("/pos/tables/:tableId/status", requirePermission("pos.terminal.use"), async (c) => {
    try {
      const data = await parseBody(c, tableStatusUpdateSchema);
      return c.json({
        data: await floorSvc.updateTableStatus({ ...context(c), tableId: c.req.param("tableId"), status: data.status }),
      });
    } catch (err) {
      return handleError(c, err, "No se pudo actualizar el estado de la mesa.");
    }
  });

  app.patch("/pos/tables/:tableId/waiter", requirePermission("pos.terminal.use"), async (c) => {
    try {
      const data = await parseBody(c, assignWaiterSchema);
      const table = await floorSvc.updateTableWaiter({
        ...context(c),
        tableId: c.req.param("tableId"),
        waiterId: data.waiterId ?? null,
      });
      return c.json({ data: table });
    } catch (err) {
      return handleError(c, err, "No se pudo asignar el mesero a la mesa.");
    }
  });

  app.get("/pos/tables/active-map", requirePermission("pos.terminal.use"), async (c) => {
    try {
      return c.json({
        data: await floorSvc.getActiveMap({
          ...context(c),
          outletId: c.req.query("outletId"),
          myTablesOnly: c.req.query("myTablesOnly") === "true",
        }),
      });
    } catch (err) {
      return handleError(c, err, "No se pudo consultar el mapa activo.");
    }
  });

  app.get("/pos/stations", requirePermission("pos.stations.read"), async (c) => {
    try {
      return c.json({ data: await kitchenSvc.listStations({ ...context(c), outletId: c.req.query("outletId") }) });
    } catch (err) {
      return handleError(c, err, "No se pudieron consultar las estaciones POS.");
    }
  });

  app.post("/pos/stations", requirePermission("pos.stations.manage"), async (c) => {
    try {
      const data = await parseBody(c, createStationSchema);
      return c.json({ data: await kitchenSvc.createStation({ ...context(c), data }) }, 201);
    } catch (err) {
      return handleError(c, err, "No se pudo crear la estacion POS.");
    }
  });

  app.patch("/pos/stations/:id", requirePermission("pos.stations.manage"), async (c) => {
    try {
      const data = await parseBody(c, updateStationSchema);
      return c.json({ data: await kitchenSvc.updateStation({ ...context(c), stationId: c.req.param("id"), data }) });
    } catch (err) {
      return handleError(c, err, "No se pudo actualizar la estacion POS.");
    }
  });

  app.get("/pos/stations/:id/tickets", requirePermission("pos.stations.read"), async (c) => {
    try {
      return c.json({
        data: await kitchenSvc.listTickets({ ...context(c), stationId: c.req.param("id"), status: c.req.query("status") }),
      });
    } catch (err) {
      return handleError(c, err, "No se pudieron consultar los tickets.");
    }
  });

  app.patch("/pos/kitchen/tickets/:ticketId/status", requirePermission("pos.stations.manage"), async (c) => {
    try {
      const data = await parseBody(c, kitchenStatusUpdateSchema);
      return c.json({
        data: await kitchenSvc.updateTicketStatus({ ...context(c), ticketId: c.req.param("ticketId"), status: data.status }),
      });
    } catch (err) {
      return handleError(c, err, "No se pudo actualizar el ticket.");
    }
  });

  app.patch("/pos/kitchen/tickets/:ticketId/lines/:lineId/status", requirePermission("pos.stations.manage"), async (c) => {
    try {
      const data = await parseBody(c, kitchenStatusUpdateSchema);
      return c.json({
        data: await kitchenSvc.updateTicketLineStatus({
          ...context(c),
          ticketId: c.req.param("ticketId"),
          lineId: c.req.param("lineId"),
          status: data.status,
        }),
      });
    } catch (err) {
      return handleError(c, err, "No se pudo actualizar la linea de ticket.");
    }
  });

  // ── Reservations ───────────────────────────────────────────────────────────
  app.get("/pos/reservations", requirePermission("pos.orders.read"), async (c) => {
    try {
      const { outletId, date, status } = c.req.query();
      return c.json({
        data: await reservationSvc.listReservations({ ...context(c), outletId, date, status }),
      });
    } catch (err) {
      return handleError(c, err, "No se pudieron consultar las reservaciones.");
    }
  });

  app.post("/pos/reservations", requirePermission("pos.orders.create"), async (c) => {
    try {
      const data = await parseBody(c, createReservationSchema);
      return c.json({ data: await reservationSvc.createReservation({ ...context(c), data }) }, 201);
    } catch (err) {
      return handleError(c, err, "No se pudo crear la reservación.");
    }
  });

  app.get("/pos/reservations/:id", requirePermission("pos.orders.read"), async (c) => {
    try {
      return c.json({
        data: await reservationSvc.getReservation({ ...context(c), id: c.req.param("id") }),
      });
    } catch (err) {
      return handleError(c, err, "No se pudo consultar la reservación.");
    }
  });

  app.patch("/pos/reservations/:id", requirePermission("pos.orders.update"), async (c) => {
    try {
      const data = await parseBody(c, updateReservationSchema);
      return c.json({
        data: await reservationSvc.updateReservation({ ...context(c), id: c.req.param("id"), data }),
      });
    } catch (err) {
      return handleError(c, err, "No se pudo actualizar la reservación.");
    }
  });

  app.post("/pos/reservations/:id/seat", requirePermission("pos.orders.create"), async (c) => {
    try {
      const data = await parseBody(c, seatReservationSchema);
      return c.json({
        data: await reservationSvc.seatReservation({
          ...context(c),
          id: c.req.param("id"),
          sessionId: data.sessionId,
        }),
      });
    } catch (err) {
      return handleError(c, err, "No se pudo sentar la reservación.");
    }
  });

  return app;
}
