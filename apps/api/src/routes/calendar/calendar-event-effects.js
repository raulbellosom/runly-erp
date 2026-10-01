// apps/api/src/routes/calendar/calendar-event-effects.js
//
// Side effects after a calendar event write (activity entry, attendee
// notifications, realtime broadcast), shared by the HTTP routes and MirAI
// actions (routes/calendar/mirai-actions.js). `c` is a Hono context or
// actorContext() — anything exposing c.get("companyId" | "userId" | "userContext").
import {
  publishActivityFromContext,
  getActivityContext,
} from "../../services/activity-publisher.js";
import { publishNotificationFromContext } from "../../services/notification-publisher.js";

const TRACKED_FIELDS = ["title", "calendarId", "startDate", "endDate", "allDay", "location", "description", "status"];

export function toAttendeeUserIds(event, excludeUserId = null) {
  const attendees = Array.isArray(event?.attendees) ? event.attendees : [];
  const ids = attendees
    .map((attendee) => attendee?.userId)
    .filter((id) => typeof id === "string" && id.trim().length > 0);
  const unique = [...new Set(ids)];
  if (!excludeUserId) return unique;
  return unique.filter((id) => id !== excludeUserId);
}

// Stand-in for a Hono context when acting outside an HTTP request.
export function actorContext({ companyId, profile }) {
  const values = { companyId: companyId ?? null, userId: profile?.id ?? null, userContext: { profile: profile ?? null } };
  return { get: (key) => values[key] ?? null };
}

export function createCalendarEventEffects({ prisma, broadcaster = null }) {
  function broadcast(c, eventId, action) {
    const companyId = c.get("companyId") ?? null;
    if (!broadcaster || !companyId) return;
    broadcaster.broadcastToCompany(companyId, "calendar.event.updated", {
      eventId: eventId ?? null,
      action,
    }).catch(() => {});
  }

  async function afterCreate(c, event, userId) {
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
    broadcast(c, event.id, "created");
  }

  async function afterUpdate(c, before, event, userId) {
    const { actorName } = getActivityContext(c);
    const changes = {};
    if (before) {
      for (const f of TRACKED_FIELDS) {
        if (before[f] !== event[f]) {
          changes[f] = { before: before[f] ?? null, after: event[f] ?? null };
        }
      }
    }
    const payload = {
      title: event.title ?? null,
      startDate: event.startDate ?? null,
      endDate: event.endDate ?? null,
    };
    if (Object.keys(changes).length > 0) payload.changes = changes;
    await publishActivityFromContext(prisma, c, {
      type: "calendar.event.update",
      severity: "info",
      entityType: "CalendarEvent",
      entityId: event.id,
      summary: `${actorName} actualizó el evento "${event.title ?? ""}"`.trim(),
      link: `/app/m/runly.calendar?eventId=${event.id}`,
      payload,
    });
    const attendeeUserIds = toAttendeeUserIds(event, userId);
    const scheduleChanged = Boolean(changes.startDate || changes.endDate || changes.calendarId || changes.location);
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
    broadcast(c, event.id, "updated");
  }

  async function afterDelete(c, eventId, before, userId) {
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
    broadcast(c, eventId, "deleted");
  }

  return { afterCreate, afterUpdate, afterDelete, broadcast };
}
