import { Hono } from "hono";
import {
  createCalendarService,
  CalendarServiceError,
} from "./calendar-service.js";
import { createCalendarEventService } from "./calendar-event-service.js";
import { createCalendarIcsImportService } from "./calendar-ics-import-service.js";
import { createCalendarNotificationService } from "./calendar-notification-service.js";
import { createCalendarGoogleRoutes } from "./calendar-google-routes.js";
import {
  publishActivityFromContext,
  getActivityContext,
} from "../../services/activity-publisher.js";
import { publishNotificationFromContext } from "../../services/notification-publisher.js";

function getUserId(c) {
  return c.get("userContext")?.profile?.id ?? null;
}

function getCompanyId(c) {
  return c.get('companyId') ?? null
}

function handleError(c, err, fallback) {
  if (err instanceof CalendarServiceError)
    return c.json({ error: err.message }, err.status);
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
    return c.json({ error: err.message || fallback }, err.status);
  }
  if (process.env.NODE_ENV !== "production")
    console.error("[runly.calendar]", err);
  return c.json({ error: fallback }, 500);
}

function toAttendeeUserIds(event, excludeUserId = null) {
  const attendees = Array.isArray(event?.attendees) ? event.attendees : [];
  const ids = attendees
    .map((attendee) => attendee?.userId)
    .filter((id) => typeof id === "string" && id.trim().length > 0);
  const unique = [...new Set(ids)];
  if (!excludeUserId) return unique;
  return unique.filter((id) => id !== excludeUserId);
}

export function createCalendarRouter({ prisma, requirePermission, google, broadcaster = null }) {
  const app = new Hono();
  const svc = createCalendarService({ prisma });
  const eventSvc = createCalendarEventService({ prisma });
  const icsImportSvc = createCalendarIcsImportService({ prisma });
  const notifSvc = createCalendarNotificationService({ prisma });

  app.route("", createCalendarGoogleRoutes({ prisma, requirePermission, google }));

  function broadcastCalendarEvent(c, eventId, action) {
    const companyId = getCompanyId(c)
    if (!broadcaster || !companyId) return
    broadcaster.broadcastToCompany(companyId, 'calendar.event.updated', {
      eventId: eventId ?? null,
      action,
    }).catch(() => {})
  }

  // ── Calendars ──────────────────────────────────────────────────────────────

  app.get(
    "/calendar/calendars",
    requirePermission("calendar.calendars.read"),
    async (c) => {
      try {
        const userId = getUserId(c);
        await svc.ensureDefaultCalendar(userId, getCompanyId(c));
        const result = await svc.listCalendars(userId, getCompanyId(c));
        return c.json(result);
      } catch (err) {
        return handleError(c, err, "No se pudieron obtener los calendarios.");
      }
    },
  );

  app.post(
    "/calendar/calendars",
    requirePermission("calendar.calendars.create"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const body = await c.req.json();
        const calendar = await svc.createCalendar(userId, body, getCompanyId(c));
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "calendar.calendar.create",
          severity: "success",
          entityType: "CalendarCalendar",
          entityId: calendar.id,
          summary:
            `${actorName} creó el calendario "${calendar.name ?? ""}"`.trim(),
        });
        return c.json(calendar, 201);
      } catch (err) {
        return handleError(c, err, "No se pudo crear el calendario.");
      }
    },
  );

  app.patch(
    "/calendar/calendars/:id",
    requirePermission("calendar.calendars.update"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const body = await c.req.json();
        const calendar = await svc.updateCalendar(
          userId,
          c.req.param("id"),
          body,
          getCompanyId(c),
        );
        return c.json(calendar);
      } catch (err) {
        return handleError(c, err, "No se pudo actualizar el calendario.");
      }
    },
  );

  app.delete(
    "/calendar/calendars/:id",
    requirePermission("calendar.calendars.delete"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const calendarId = c.req.param("id");
        await svc.deleteCalendar(userId, calendarId, getCompanyId(c));
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "calendar.calendar.delete",
          severity: "warning",
          entityType: "CalendarCalendar",
          entityId: calendarId,
          summary: `${actorName} eliminó un calendario`,
        });
        return c.json({ ok: true });
      } catch (err) {
        return handleError(c, err, "No se pudo eliminar el calendario.");
      }
    },
  );

  app.post(
    "/calendar/calendars/:id/share",
    requirePermission("calendar.share.manage"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const body = await c.req.json();
        const share = await svc.shareCalendar(userId, c.req.param("id"), body, getCompanyId(c));
        return c.json(share, 201);
      } catch (err) {
        return handleError(c, err, "No se pudo compartir el calendario.");
      }
    },
  );

  app.patch(
    "/calendar/calendars/:id/share/:shareId",
    requirePermission("calendar.share.manage"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const body = await c.req.json();
        const share = await svc.updateShare(
          userId,
          c.req.param("id"),
          c.req.param("shareId"),
          body,
          getCompanyId(c),
        );
        return c.json(share);
      } catch (err) {
        return handleError(c, err, "No se pudo actualizar el acceso.");
      }
    },
  );

  app.delete(
    "/calendar/calendars/:id/share/:shareId",
    requirePermission("calendar.share.manage"),
    async (c) => {
      try {
        const userId = getUserId(c);
        await svc.deleteShare(
          userId,
          c.req.param("id"),
          c.req.param("shareId"),
          getCompanyId(c),
        );
        return c.json({ ok: true });
      } catch (err) {
        return handleError(c, err, "No se pudo revocar el acceso.");
      }
    },
  );

  // ── Events ─────────────────────────────────────────────────────────────────

  app.get(
    "/calendar/events",
    requirePermission("calendar.events.read"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const { start, end, source_module, source_entity_id } = c.req.query();
        const calendarIds = c.req.queries("calendar_ids") ?? [];
        const events = await eventSvc.listEvents({ companyId: getCompanyId(c),
          userId,
          start,
          end,
          calendarIds,
          sourceModule: source_module,
          sourceEntityId: source_entity_id,
        });
        return c.json(events);
      } catch (err) {
        return handleError(c, err, "No se pudieron obtener los eventos.");
      }
    },
  );

  app.post(
    "/calendar/events",
    requirePermission("calendar.events.create"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const body = await c.req.json();
        const event = await eventSvc.createEvent(userId, body, getCompanyId(c));
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "calendar.event.create",
          severity: "success",
          entityType: "CalendarEvent",
          entityId: event.id,
          summary: `${actorName} creó el evento "${event.title ?? ""}"`.trim(),
          link: `/app/m/runly.calendar?eventId=${event.id}`,
          payload: {
            title: event.title ?? null,
            calendarId: event.calendarId ?? null,
            startDate: event.startDate ?? null,
            endDate: event.endDate ?? null,
            allDay: event.allDay ?? null,
            location: event.location ?? null,
          },
        });
        const attendeeUserIds = toAttendeeUserIds(event, userId);
        if (attendeeUserIds.length > 0) {
          await publishNotificationFromContext(prisma, c, {
            eventType: "calendar.event.invite",
            title: `Invitacion: ${event.title ?? "Evento"}`,
            body: `${actorName} te invito a un evento del calendario.`,
            link: `/app/m/runly.calendar?eventId=${event.id}`,
            recipients: { userIds: attendeeUserIds },
            channels: ["in_app", "email", "web_push"],
            priority: "high",
            sourceType: "CalendarEvent",
            sourceId: event.id,
            metadata: {
              startDate: event.startDate ?? null,
              endDate: event.endDate ?? null,
              calendarId: event.calendarId ?? null,
            },
          });
        }
        broadcastCalendarEvent(c, event.id, 'created')
        return c.json(event, 201);
      } catch (err) {
        return handleError(c, err, "No se pudo crear el evento.");
      }
    },
  );

  app.post(
    "/calendar/ics-import",
    requirePermission("calendar.events.create"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const body = await c.req.parseBody();
        const file = body.file;
        if (!file || typeof file === "string") {
          return c.json({ error: "Se requiere un archivo .ics." }, 400);
        }
        const fileBuffer = Buffer.from(await file.arrayBuffer());
        const result = await icsImportSvc.importIcs({
          userId,
          companyId: getCompanyId(c),
          calendarId: body.calendarId || null,
          calendarName: body.calendarName || null,
          fileBuffer,
        });
        broadcastCalendarEvent(c, null, "ics_import");
        return c.json(result, 201);
      } catch (err) {
        return handleError(c, err, "No se pudo importar el archivo .ics.");
      }
    },
  );

  app.get(
    "/calendar/events/:id",
    requirePermission("calendar.events.read"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const event = await eventSvc.getEvent(userId, c.req.param("id"), getCompanyId(c));
        return c.json(event);
      } catch (err) {
        return handleError(c, err, "No se pudo obtener el evento.");
      }
    },
  );

  app.patch(
    "/calendar/events/:id",
    requirePermission("calendar.events.update"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const eventId = c.req.param("id");
        const before = await eventSvc
          .getEvent(userId, eventId, getCompanyId(c))
          .catch(() => null);
        const body = await c.req.json();
        const event = await eventSvc.updateEvent(userId, eventId, body, getCompanyId(c));
        const { actorName } = getActivityContext(c);
        const trackedFields = [
          "title",
          "calendarId",
          "startDate",
          "endDate",
          "allDay",
          "location",
          "description",
          "status",
        ];
        const changes = {};
        if (before) {
          for (const f of trackedFields) {
            if (before[f] !== event[f]) {
              changes[f] = {
                before: before[f] ?? null,
                after: event[f] ?? null,
              };
            }
          }
        }
        const payload = {
          title: event.title ?? null,
          startDate: event.startDate ?? null,
          endDate: event.endDate ?? null,
        };
        if (Object.keys(changes).length > 0) {
          payload.changes = changes;
        }
        await publishActivityFromContext(prisma, c, {
          type: "calendar.event.update",
          severity: "info",
          entityType: "CalendarEvent",
          entityId: event.id,
          summary:
            `${actorName} actualizó el evento "${event.title ?? ""}"`.trim(),
          link: `/app/m/runly.calendar?eventId=${event.id}`,
          payload,
        });
        const attendeeUserIds = toAttendeeUserIds(event, userId);
        const scheduleChanged = Boolean(
          changes.startDate ||
          changes.endDate ||
          changes.calendarId ||
          changes.location,
        );
        if (scheduleChanged && attendeeUserIds.length > 0) {
          await publishNotificationFromContext(prisma, c, {
            eventType: "calendar.event.reschedule",
            title: `Evento actualizado: ${event.title ?? "Calendario"}`,
            body: `${actorName} actualizo horario o detalles del evento.`,
            link: `/app/m/runly.calendar?eventId=${event.id}`,
            recipients: { userIds: attendeeUserIds },
            channels: ["in_app", "email", "web_push"],
            priority: "high",
            sourceType: "CalendarEvent",
            sourceId: event.id,
            metadata: {
              changes,
              startDate: event.startDate ?? null,
              endDate: event.endDate ?? null,
            },
          });
        }
        broadcastCalendarEvent(c, eventId, 'updated')
        return c.json(event);
      } catch (err) {
        return handleError(c, err, "No se pudo actualizar el evento.");
      }
    },
  );

  app.delete(
    "/calendar/events/:id",
    requirePermission("calendar.events.delete"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const eventId = c.req.param("id");
        const before = await eventSvc
          .getEvent(userId, eventId, getCompanyId(c))
          .catch(() => null);
        await eventSvc.deleteEvent(userId, eventId, getCompanyId(c));
        const { actorName } = getActivityContext(c);
        const title = before?.title ?? "";
        await publishActivityFromContext(prisma, c, {
          type: "calendar.event.delete",
          severity: "warning",
          entityType: "CalendarEvent",
          entityId: eventId,
          summary: title
            ? `${actorName} eliminó el evento "${title}"`
            : `${actorName} eliminó un evento del calendario`,
          payload: before
            ? {
                title: before.title ?? null,
                calendarId: before.calendarId ?? null,
                startDate: before.startDate ?? null,
                endDate: before.endDate ?? null,
              }
            : undefined,
        });
        const attendeeUserIds = toAttendeeUserIds(before, userId);
        if (attendeeUserIds.length > 0) {
          await publishNotificationFromContext(prisma, c, {
            eventType: "calendar.event.cancel",
            title: `Evento cancelado: ${title || "Calendario"}`,
            body: `${actorName} cancelo un evento programado.`,
            link: "/app/m/runly.calendar",
            recipients: { userIds: attendeeUserIds },
            channels: ["in_app", "email", "web_push"],
            priority: "high",
            sourceType: "CalendarEvent",
            sourceId: eventId,
            metadata: before
              ? {
                  startDate: before.startDate ?? null,
                  endDate: before.endDate ?? null,
                  calendarId: before.calendarId ?? null,
                }
              : undefined,
          });
        }
        broadcastCalendarEvent(c, eventId, 'deleted')
        return c.json({ ok: true });
      } catch (err) {
        return handleError(c, err, "No se pudo eliminar el evento.");
      }
    },
  );

  app.post(
    "/calendar/events/:id/attendees",
    requirePermission("calendar.events.update"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const { user_id } = await c.req.json();
        const attendee = await eventSvc.addAttendee(
          userId,
          c.req.param("id"),
          user_id,
          getCompanyId(c),
        );
        const event = await eventSvc.getEvent(userId, c.req.param("id"), getCompanyId(c));
        const { actorName } = getActivityContext(c);
        await publishNotificationFromContext(prisma, c, {
          eventType: "calendar.event.invite",
          title: `Invitacion: ${event.title ?? "Evento"}`,
          body: `${actorName} te invito a un evento del calendario.`,
          link: `/app/m/runly.calendar?eventId=${event.id}`,
          recipients: { userIds: [user_id] },
          channels: ["in_app", "email", "web_push"],
          priority: "high",
          sourceType: "CalendarEvent",
          sourceId: event.id,
          metadata: {
            startDate: event.startDate ?? null,
            endDate: event.endDate ?? null,
            calendarId: event.calendarId ?? null,
          },
        });
        return c.json(attendee, 201);
      } catch (err) {
        return handleError(c, err, "No se pudo agregar el invitado.");
      }
    },
  );

  app.patch(
    "/calendar/events/:id/attendees/:attendeeId",
    requirePermission("calendar.events.update"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const { status } = await c.req.json();
        const attendee = await eventSvc.updateAttendeeStatus(
          userId,
          c.req.param("id"),
          c.req.param("attendeeId"),
          status,
          getCompanyId(c),
        );
        return c.json(attendee);
      } catch (err) {
        return handleError(c, err, "No se pudo actualizar el estado.");
      }
    },
  );

  app.post(
    "/calendar/events/:id/reminders",
    requirePermission("calendar.events.create"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const { minutes_before } = await c.req.json();
        const reminder = await eventSvc.addReminder(
          userId,
          c.req.param("id"),
          minutes_before,
          getCompanyId(c),
        );
        return c.json(reminder, 201);
      } catch (err) {
        return handleError(c, err, "No se pudo crear el recordatorio.");
      }
    },
  );

  app.delete(
    "/calendar/events/:id/reminders/:reminderId",
    requirePermission("calendar.events.update"),
    async (c) => {
      try {
        const userId = getUserId(c);
        await eventSvc.deleteReminder(
          userId,
          c.req.param("id"),
          c.req.param("reminderId"),
          getCompanyId(c),
        );
        return c.json({ ok: true });
      } catch (err) {
        return handleError(c, err, "No se pudo eliminar el recordatorio.");
      }
    },
  );

  // ── Notifications ──────────────────────────────────────────────────────────

  app.get(
    "/calendar/notifications",
    requirePermission("calendar.access"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const { unread_only } = c.req.query();
        const notifications = await notifSvc.getNotifications(userId, {
          unreadOnly: unread_only !== "false",
        });
        return c.json(notifications);
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudieron obtener las notificaciones.",
        );
      }
    },
  );

  app.patch(
    "/calendar/notifications/read-all",
    requirePermission("calendar.access"),
    async (c) => {
      try {
        const userId = getUserId(c);
        await notifSvc.markAllRead(userId);
        return c.json({ ok: true });
      } catch (err) {
        return handleError(c, err, "No se pudo marcar todo como leido.");
      }
    },
  );

  app.patch(
    "/calendar/notifications/:id/read",
    requirePermission("calendar.access"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const notification = await notifSvc.markRead(userId, c.req.param("id"));
        return c.json(notification);
      } catch (err) {
        return handleError(c, err, "No se pudo marcar como leida.");
      }
    },
  );

  // ── Internal: process reminders ────────────────────────────────────────────

  app.post("/calendar/internal/process-reminders", async (c) => {
    const secret = c.req.header("x-internal-secret");
    if (
      process.env.NODE_ENV === "production" &&
      secret !== process.env.RUNLY_INTERNAL_SECRET
    ) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    try {
      const result = await notifSvc.processReminders();
      return c.json(result);
    } catch (err) {
      return handleError(c, err, "Error procesando recordatorios.");
    }
  });

  return app;
}
