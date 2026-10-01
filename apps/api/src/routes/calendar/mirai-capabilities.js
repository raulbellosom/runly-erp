// apps/api/src/routes/calendar/mirai-capabilities.js
//
// runly.calendar capability for MirAI (spec 2026-09-30-mirai-global-capabilities §10).
import { formatLocalDateTime } from "@runly/core";
import { createCalendarMiraiActions } from "./mirai-actions.js";
import { createCalendarMiraiQueries } from "./calendar-mirai-queries.js";

export function createCalendarMiraiCapabilities({ prisma, eventService, effects }) {
  return {
    moduleKey: "runly.calendar",
    label: "Calendario",
    summary: "Eventos, agenda, horas ocupadas, huecos libres; crear, mover y eliminar eventos.",
    tools: createCalendarMiraiQueries({ eventService }),
    actions: createCalendarMiraiActions({ prisma, eventService, effects }),
    publicLookup: [],
    async describeContext(pageContext, actx) {
      if (pageContext.recordType !== "event" || !pageContext.recordId) return null;
      const id = String(pageContext.recordId).split("_")[0];
      const event = await eventService.getEvent(actx.actorProfileId, id, actx.companyId).catch(() => null);
      if (!event) return null;
      return `El usuario esta viendo el evento "${event.title}" (eventId ${event.id}), ${formatLocalDateTime(event.startAt).slice(0, 16)}${event.calendar?.name ? `, calendario ${event.calendar.name}` : ""}.`;
    },
  };
}
