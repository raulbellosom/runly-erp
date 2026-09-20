import { Hono } from "hono";
import {
  createCalendarService,
  CalendarServiceError,
} from "./calendar-service.js";
import { createCalendarEventService } from "./calendar-event-service.js";
import { createCalendarNotificationService } from "./calendar-notification-service.js";
import { resolveGoogleCalendarConfig } from "./google/google-config.js";
import { createGoogleTokenCrypto } from "./google/google-token-crypto.js";
import { createGoogleCalendarConnectionService } from "./google/google-connection-service.js";
import { createGoogleOAuthService } from "./google/google-oauth-service.js";
import { createGoogleCalendarDiscoveryService } from "./google/google-calendar-discovery-service.js";
import { createGoogleCalendarSourceService } from "./google/google-source-service.js";
import { createGoogleCalendarEventsService } from "./google/google-calendar-events-service.js";
import { createGoogleCalendarEventLinkService } from "./google/google-calendar-event-link-service.js";
import { createGoogleCalendarInitialImportService } from "./google/google-calendar-initial-import-service.js";
import { createGoogleAccessTokenResolver } from "./google/google-access-token-resolver.js";
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

function createGoogleRouteDependencies({ prisma, google = {} }) {
  function getConfig() {
    const resolveConfig = google.resolveConfig ?? resolveGoogleCalendarConfig;
    return resolveConfig(process.env);
  }

  function requireConfig() {
    const config = getConfig();
    if (!config?.configured) {
      throw new CalendarServiceError(
        "Google Calendar no esta configurado en esta instancia.",
        503,
      );
    }
    return config;
  }

  function getTokenCrypto() {
    return (
      google.tokenCrypto ??
      createGoogleTokenCrypto({ key: requireConfig().encryptionKey })
    );
  }

  function getConnectionService() {
    return (
      google.connectionService ??
      createGoogleCalendarConnectionService({
        prisma,
        tokenCrypto: getTokenCrypto(),
      })
    );
  }

  function getOAuthService() {
    return (
      google.oauthService ??
      createGoogleOAuthService({
        config: requireConfig(),
      })
    );
  }

  function getDiscoveryService() {
    return google.discoveryService ?? createGoogleCalendarDiscoveryService();
  }

  function getSourceService() {
    return (
      google.sourceService ??
      createGoogleCalendarSourceService({
        prisma,
      })
    );
  }

  function getEventsService() {
    return google.eventsService ?? createGoogleCalendarEventsService();
  }

  function getEventLinkService() {
    return (
      google.eventLinkService ??
      createGoogleCalendarEventLinkService({
        prisma,
      })
    );
  }

  function getInitialImportService() {
    return (
      google.initialImportService ??
      createGoogleCalendarInitialImportService({
        prisma,
        eventsService: getEventsService(),
        linkService: getEventLinkService(),
      })
    );
  }

  function getAccessTokenResolver() {
    return (
      google.accessTokenResolver ??
      createGoogleAccessTokenResolver({
        tokenCrypto: getTokenCrypto(),
        oauthService: getOAuthService(),
        connectionService: getConnectionService(),
      })
    );
  }

  return {
    getConfig,
    requireConfig,
    getTokenCrypto,
    getConnectionService,
    getOAuthService,
    getDiscoveryService,
    getSourceService,
    getEventsService,
    getEventLinkService,
    getInitialImportService,
    getAccessTokenResolver,
  };
}

export function createCalendarRouter({ prisma, requirePermission, google, broadcaster = null }) {
  const app = new Hono();
  const svc = createCalendarService({ prisma });
  const eventSvc = createCalendarEventService({ prisma });
  const notifSvc = createCalendarNotificationService({ prisma });
  const googleDeps = createGoogleRouteDependencies({ prisma, google });

  function broadcastCalendarEvent(c, eventId, action) {
    const companyId = getCompanyId(c)
    if (!broadcaster || !companyId) return
    broadcaster.broadcastToCompany(companyId, 'calendar.event.updated', {
      eventId: eventId ?? null,
      action,
    }).catch(() => {})
  }

  async function requireActiveGoogleConnection(userId) {
    const connection = await googleDeps
      .getConnectionService()
      .getConnectionByUserId(userId);

    if (!connection || connection.status !== "ACTIVE") {
      throw new CalendarServiceError(
        "No hay una cuenta Google conectada.",
        409,
      );
    }

    return connection;
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
        await svc.deleteCalendar(userId, calendarId);
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
        const share = await svc.shareCalendar(userId, c.req.param("id"), body);
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
        );
        return c.json({ ok: true });
      } catch (err) {
        return handleError(c, err, "No se pudo revocar el acceso.");
      }
    },
  );

  app.get(
    "/calendar/google/status",
    requirePermission("calendar.calendars.read"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const config = googleDeps.getConfig();
        const connection =
          config?.configured && userId
            ? await googleDeps
                .getConnectionService()
                .getConnectionByUserId(userId)
            : null;

        return c.json({
          configured: Boolean(config?.configured),
          missing: Array.isArray(config?.missing) ? config.missing : [],
          redirectUri: config?.configured ? config.redirectUri : null,
          connection: connection
            ? {
                googleEmail: connection.googleEmail ?? null,
                status: connection.status ?? null,
                connectedAt: connection.connectedAt ?? null,
              }
            : null,
        });
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudo obtener el estado de Google Calendar.",
        );
      }
    },
  );

  app.post(
    "/calendar/google/connect/start",
    requirePermission("calendar.calendars.read"),
    async (c) => {
      try {
        googleDeps.requireConfig();
        const userId = getUserId(c);
        const state = googleDeps
          .getOAuthService()
          .createAuthorizationState({ userId });
        const authUrl = googleDeps
          .getOAuthService()
          .buildAuthorizationUrl({ state });
        return c.json({ authUrl });
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudo iniciar la conexion con Google Calendar.",
        );
      }
    },
  );

  app.get(
    "/calendar/google/connect/callback",
    requirePermission("calendar.calendars.read"),
    async (c) => {
      try {
        googleDeps.requireConfig();
        const userId = getUserId(c);
        const code = c.req.query("code");
        const state = c.req.query("state");

        if (!String(code ?? "").trim()) {
          throw new CalendarServiceError("code es requerido.", 400);
        }
        if (!String(state ?? "").trim()) {
          throw new CalendarServiceError("state es requerido.", 400);
        }

        googleDeps
          .getOAuthService()
          .verifyAuthorizationState({ state, userId });

        const tokenPayload = await googleDeps
          .getOAuthService()
          .exchangeCodeForTokens({ code });
        const connection = await googleDeps
          .getConnectionService()
          .saveConnection({
            userId,
            ...tokenPayload,
          });

        return c.json({
          ok: true,
          connection: {
            googleEmail: connection.googleEmail ?? null,
            status: connection.status ?? null,
          },
        });
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudo completar la conexion con Google Calendar.",
        );
      }
    },
  );

  app.get(
    "/calendar/google/calendars",
    requirePermission("calendar.calendars.read"),
    async (c) => {
      try {
        googleDeps.requireConfig();
        const userId = getUserId(c);
        const connection = await requireActiveGoogleConnection(userId);
        const { accessToken } = await googleDeps
          .getAccessTokenResolver()
          .resolveAccessToken(userId, connection);
        const items = await googleDeps
          .getDiscoveryService()
          .listCalendars({ accessToken });

        return c.json({ items });
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudieron obtener los calendarios de Google.",
        );
      }
    },
  );

  // ── Events ─────────────────────────────────────────────────────────────────

  app.get(
    "/calendar/google/sources",
    requirePermission("calendar.calendars.read"),
    async (c) => {
      try {
        googleDeps.requireConfig();
        const userId = getUserId(c);
        const connection = await requireActiveGoogleConnection(userId);
        const items = await googleDeps
          .getSourceService()
          .listSourcesForConnection(connection.id);

        return c.json({ items });
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudieron obtener los calendarios sincronizados de Google.",
        );
      }
    },
  );

  app.post(
    "/calendar/google/sources",
    requirePermission("calendar.calendars.create"),
    async (c) => {
      try {
        googleDeps.requireConfig();
        const userId = getUserId(c);
        const connection = await requireActiveGoogleConnection(userId);
        const body = await c.req.json();
        const result = await googleDeps.getSourceService().saveSelectedSources({
          connectionId: connection.id,
          ownerId: userId,
          calendars: body?.calendars,
        });

        if (
          Array.isArray(result.importTargets) &&
          result.importTargets.length > 0
        ) {
          const importTargets = result.importTargets;

          queueMicrotask(async () => {
            try {
              const { accessToken } = await googleDeps
                .getAccessTokenResolver()
                .resolveAccessToken(userId, connection);

              await Promise.allSettled(
                importTargets.map((source) =>
                  googleDeps
                    .getInitialImportService()
                    .importSource({ source, accessToken }),
                ),
              );
            } catch (error) {
              // Token could not be resolved/refreshed (e.g. the refresh
              // token was revoked) — mark the pending sources as errored
              // instead of leaving them stuck at SYNCING forever.
              await Promise.allSettled(
                importTargets.map((source) =>
                  googleDeps
                    .getInitialImportService()
                    .markSourceError(source.id, error),
                ),
              ).catch(() => {});

              if (process.env.NODE_ENV !== "production") {
                console.error(
                  "[runly.calendar] google initial import dispatch failed",
                  error,
                );
              }
            }
          });
        }

        return c.json({ items: result.items }, 201);
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudieron guardar los calendarios seleccionados de Google.",
        );
      }
    },
  );

  app.post(
    "/calendar/google/disconnect",
    requirePermission("calendar.calendars.read"),
    async (c) => {
      try {
        googleDeps.requireConfig();
        const userId = getUserId(c);
        const connection = await googleDeps
          .getConnectionService()
          .getConnectionByUserId(userId);

        if (!connection || connection.status !== "ACTIVE") {
          return c.json({ ok: true });
        }

        // Optionally delete all imported Google calendars and their events
        const body = await c.req.json().catch(() => ({}));
        if (body.deleteEvents === true) {
          const sources = await prisma.googleCalendarSource.findMany({
            where: { connectionId: connection.id },
            select: { id: true, atlasCalendarId: true },
          });
          if (sources.length > 0) {
            const sourceIds = sources.map((s) => s.id);
            const atlasCalendarIds = sources.map((s) => s.atlasCalendarId);

            // 1. Delete sources first — they hold a Restrict FK to CalendarCalendar
            //    Cascade removes GoogleCalendarEventLink rows as well
            await prisma.googleCalendarSource.deleteMany({
              where: { id: { in: sourceIds } },
            });

            // 2. Delete the Atlas calendars — cascade removes CalendarEvent rows
            await prisma.calendarCalendar.deleteMany({
              where: { id: { in: atlasCalendarIds } },
            });
          }
        }

        await googleDeps
          .getSourceService()
          .disableSourcesForConnection(connection.id);
        await googleDeps.getConnectionService().disconnect(userId);

        return c.json({ ok: true });
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudo desconectar la cuenta de Google Calendar.",
        );
      }
    },
  );

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
        const event = await eventSvc.createEvent(userId, body);
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

  app.get(
    "/calendar/events/:id",
    requirePermission("calendar.events.read"),
    async (c) => {
      try {
        const userId = getUserId(c);
        const event = await eventSvc.getEvent(userId, c.req.param("id"));
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
          .getEvent(userId, eventId)
          .catch(() => null);
        const body = await c.req.json();
        const event = await eventSvc.updateEvent(userId, eventId, body);
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
          .getEvent(userId, eventId)
          .catch(() => null);
        await eventSvc.deleteEvent(userId, eventId);
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
        );
        const event = await eventSvc.getEvent(userId, c.req.param("id"));
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
