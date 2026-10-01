// apps/api/src/routes/calendar/mirai-actions.js
//
// runly.calendar actions MirAI can propose (spec 2026-09-30-mirai-actions §8).
// prepare() validates and resolves names -> ids without writing; execute()
// goes through calendar-event-service + calendar-event-effects, exactly like
// the HTTP routes.
import { z } from "zod";
import { zonedLocalToDate, formatLocalDateTime } from "@runly/core";
import { actorContext } from "./calendar-event-effects.js";

const LINK = (id) => `/app/m/runly.calendar?eventId=${id}`;
const fmt = (d) => (d ? formatLocalDateTime(d).slice(0, 16) : null);
const fmtDay = (d) => formatLocalDateTime(d).slice(0, 10);
const optText = (max) => z.string().trim().max(max).nullable().optional();
const WHEN_DESC = "Fecha y hora local YYYY-MM-DDTHH:mm (o YYYY-MM-DD para todo el dia).";

const createArgs = z.object({
  title: z.string().trim().min(1).max(200),
  start: z.string(),
  end: z.string().nullable().optional(),
  allDay: z.boolean().optional(),
  calendar: optText(120),
  location: optText(300),
  description: optText(2000),
  attendees: z.array(z.string().trim().min(2)).max(20).optional(),
  reminderMinutes: z.array(z.number().int().min(0).max(40320)).max(5).optional(),
});
const updateArgs = z.object({
  eventId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  start: z.string().optional(),
  end: z.string().nullable().optional(),
  allDay: z.boolean().optional(),
  calendar: optText(120),
  location: optText(300),
  description: optText(2000),
});
const deleteArgs = z.object({ eventId: z.string().min(1) });

function parseWhen(value, label) {
  if (value === undefined || value === null || value === "") return { value: null };
  const d = zonedLocalToDate(value);
  return d ? { value: d } : { error: `${label} invalida; usa YYYY-MM-DDTHH:mm.` };
}

const isDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").trim());
// Recurrence instances come back from listEvents as `<baseId>_YYYYMMDD`.
const baseEventId = (id) => String(id).split("_")[0];

export function createCalendarMiraiActions({ prisma, eventService, effects }) {
  async function writableCalendars(actx) {
    return prisma.calendarCalendar.findMany({
      where: {
        enabled: true,
        OR: [{ companyId: null }, { companyId: actx.companyId }],
        AND: [{ OR: [
          { ownerId: actx.actorProfileId },
          { shares: { some: { userId: actx.actorProfileId, role: { in: ["EDITOR", "MANAGER"] } } } },
        ] }],
      },
      select: { id: true, name: true, isDefault: true, ownerId: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
  }

  async function pickCalendar(actx, name) {
    const cals = await writableCalendars(actx);
    if (!cals.length) return { error: "No tienes un calendario donde crear eventos. Abre Calendario una vez para crear el tuyo." };
    if (!name) {
      return { calendar: cals.find((c) => c.isDefault && c.ownerId === actx.actorProfileId) ?? cals[0] };
    }
    const q = name.toLowerCase();
    const exact = cals.filter((c) => c.name.toLowerCase() === q);
    const partial = exact.length ? exact : cals.filter((c) => c.name.toLowerCase().includes(q));
    if (partial.length === 1) return { calendar: partial[0] };
    const names = cals.map((c) => c.name).join(", ");
    return { error: partial.length ? `Hay varios calendarios que coinciden: ${partial.map((c) => c.name).join(", ")}.` : `No encontre el calendario "${name}". Tus calendarios: ${names}.` };
  }

  async function resolveAttendees(actx, queries) {
    const users = [];
    const problems = [];
    for (const raw of queries) {
      const q = raw.trim();
      const found = await prisma.userProfile.findMany({
        where: {
          enabled: true,
          isBot: false,
          memberships: { some: { companyId: actx.companyId, enabled: true } },
          OR: [
            { email: { equals: q, mode: "insensitive" } },
            { displayName: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { id: true, displayName: true, email: true },
        take: 3,
      });
      if (found.length === 1) users.push(found[0]);
      else problems.push(found.length ? `"${q}" (puede ser: ${found.map((u) => u.displayName).join(", ")})` : `"${q}" (no esta en la empresa)`);
    }
    return problems.length ? { error: `No pude identificar a: ${problems.join("; ")}.` } : { users };
  }

  async function loadEvent(actx, eventId) {
    const id = baseEventId(eventId);
    const event = await eventService.getEvent(actx.actorProfileId, id, actx.companyId).catch(() => null);
    return event ? { id, event } : { error: "No encontre ese evento o no tienes acceso. Usa list_my_calendar para obtener su eventId." };
  }

  const recurrenceNote = (event) =>
    event.recurrenceRule ? [{ label: "Nota", value: "Es un evento recurrente: aplica a toda la serie." }] : [];

  const create = {
    key: "calendar.event.create",
    moduleKey: "runly.calendar",
    operation: "create",
    label: "Crear evento",
    permission: "calendar.events.create",
    description: "Crea un evento en el calendario del usuario. Si no dice calendario, usa el suyo por defecto; sin hora de fin dura 1 hora.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        start: { type: "string", description: WHEN_DESC },
        end: { type: "string", description: WHEN_DESC },
        allDay: { type: "boolean" },
        calendar: { type: "string", description: "Nombre del calendario (opcional)." },
        location: { type: "string" },
        description: { type: "string" },
        attendees: { type: "array", items: { type: "string" }, description: "Nombres o correos de usuarios de la empresa." },
        reminderMinutes: { type: "array", items: { type: "integer" } },
      },
      required: ["title", "start"],
    },
    async prepare(args, actx) {
      const parsed = createArgs.safeParse(args);
      if (!parsed.success) return { error: "Faltan datos del evento: titulo e inicio (YYYY-MM-DDTHH:mm)." };
      const a = parsed.data;
      const start = parseWhen(a.start, "Fecha de inicio");
      if (start.error || !start.value) return { error: start.error ?? "La fecha de inicio es requerida." };
      const end = parseWhen(a.end, "Fecha de fin");
      if (end.error) return { error: end.error };
      const allDay = a.allDay ?? isDateOnly(a.start);
      const endAt = end.value ?? (allDay ? null : new Date(start.value.getTime() + 60 * 60 * 1000));
      if (endAt && endAt <= start.value) return { error: "La fecha de fin debe ser posterior al inicio." };
      const cal = await pickCalendar(actx, a.calendar);
      if (cal.error) return { error: cal.error };
      const people = a.attendees?.length ? await resolveAttendees(actx, a.attendees) : { users: [] };
      if (people.error) return { error: people.error };

      return {
        input: {
          calendarId: cal.calendar.id,
          title: a.title,
          description: a.description ?? null,
          startAt: start.value.toISOString(),
          endAt: endAt ? endAt.toISOString() : null,
          allDay,
          location: a.location ?? null,
          attendeeIds: people.users.map((u) => u.id),
          reminderMinutes: a.reminderMinutes ?? [],
        },
        preview: {
          title: "Crear evento",
          fields: [
            { label: "Titulo", value: a.title },
            { label: "Inicio", value: allDay ? `${fmtDay(start.value)} (todo el dia)` : fmt(start.value) },
            endAt && !allDay ? { label: "Fin", value: fmt(endAt) } : null,
            { label: "Calendario", value: cal.calendar.name },
            a.location ? { label: "Lugar", value: a.location } : null,
            people.users.length ? { label: "Invitados", value: people.users.map((u) => u.displayName).join(", ") } : null,
            a.description ? { label: "Descripcion", value: a.description } : null,
          ].filter(Boolean),
        },
      };
    },
    async execute(input, actx) {
      const event = await eventService.createEvent(actx.actorProfileId, input, actx.companyId);
      await effects.afterCreate(actorContext({ companyId: actx.companyId, profile: actx.actorProfile }), event, actx.actorProfileId);
      return { id: event.id, summary: `Evento creado: ${event.title}, ${fmt(event.startAt)}`, link: LINK(event.id) };
    },
  };

  const update = {
    key: "calendar.event.update",
    moduleKey: "runly.calendar",
    operation: "update",
    label: "Editar evento",
    permission: "calendar.events.update",
    description: "Cambia un evento existente (titulo, horario, lugar, calendario, descripcion). Requiere el eventId de list_my_calendar; envia solo los campos que cambian.",
    parameters: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        title: { type: "string" },
        start: { type: "string", description: WHEN_DESC },
        end: { type: "string", description: WHEN_DESC },
        allDay: { type: "boolean" },
        calendar: { type: "string" },
        location: { type: "string" },
        description: { type: "string" },
      },
      required: ["eventId"],
    },
    async prepare(args, actx) {
      const parsed = updateArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el eventId (de list_my_calendar) y los campos a cambiar." };
      const a = parsed.data;
      const found = await loadEvent(actx, a.eventId);
      if (found.error) return { error: found.error };
      const { id, event } = found;
      const data = {};
      const fields = [{ label: "Evento", value: event.title }];

      if (a.title !== undefined && a.title !== event.title) {
        data.title = a.title;
        fields.push({ label: "Titulo", before: event.title, value: a.title });
      }
      let newStart = null;
      if (a.start !== undefined) {
        const s = parseWhen(a.start, "Fecha de inicio");
        if (s.error || !s.value) return { error: s.error ?? "Fecha de inicio invalida." };
        newStart = s.value;
        data.startAt = newStart.toISOString();
        fields.push({ label: "Inicio", before: fmt(event.startAt), value: fmt(newStart) });
      }
      if (a.end !== undefined) {
        const e = parseWhen(a.end, "Fecha de fin");
        if (e.error) return { error: e.error };
        data.endAt = e.value ? e.value.toISOString() : null;
        fields.push({ label: "Fin", before: fmt(event.endAt), value: fmt(e.value) ?? "(sin fin)" });
      } else if (newStart && event.endAt) {
        const duration = new Date(event.endAt).getTime() - new Date(event.startAt).getTime();
        const movedEnd = new Date(newStart.getTime() + duration);
        data.endAt = movedEnd.toISOString();
        fields.push({ label: "Fin", before: fmt(event.endAt), value: fmt(movedEnd) });
      }
      const effStart = new Date(data.startAt ?? event.startAt);
      const effEnd = data.endAt !== undefined ? (data.endAt ? new Date(data.endAt) : null) : (event.endAt ? new Date(event.endAt) : null);
      if (effEnd && effEnd <= effStart) return { error: "La fecha de fin debe ser posterior al inicio." };

      if (a.allDay !== undefined && a.allDay !== event.allDay) {
        data.allDay = a.allDay;
        fields.push({ label: "Todo el dia", before: event.allDay ? "Si" : "No", value: a.allDay ? "Si" : "No" });
      }
      if (a.calendar) {
        const cal = await pickCalendar(actx, a.calendar);
        if (cal.error) return { error: cal.error };
        if (cal.calendar.id !== event.calendarId) {
          data.calendarId = cal.calendar.id;
          fields.push({ label: "Calendario", before: event.calendar?.name ?? null, value: cal.calendar.name });
        }
      }
      if (a.location !== undefined && (a.location ?? null) !== (event.location ?? null)) {
        data.location = a.location ?? null;
        fields.push({ label: "Lugar", before: event.location ?? "(vacio)", value: a.location ?? "(vacio)" });
      }
      if (a.description !== undefined && (a.description ?? null) !== (event.description ?? null)) {
        data.description = a.description ?? null;
        fields.push({ label: "Descripcion", before: event.description ?? "(vacio)", value: a.description ?? "(vacio)" });
      }
      if (!Object.keys(data).length) return { error: "No indicaste ningun cambio respecto al evento actual." };
      return { input: { eventId: id, data }, preview: { title: "Editar evento", fields: [...fields, ...recurrenceNote(event)] }, targetId: id };
    },
    async execute(input, actx) {
      const before = await eventService.getEvent(actx.actorProfileId, input.eventId, actx.companyId).catch(() => null);
      const event = await eventService.updateEvent(actx.actorProfileId, input.eventId, input.data, actx.companyId);
      await effects.afterUpdate(actorContext({ companyId: actx.companyId, profile: actx.actorProfile }), before, event, actx.actorProfileId);
      return { id: event.id, summary: `Evento actualizado: ${event.title}, ${fmt(event.startAt)}`, link: LINK(event.id) };
    },
  };

  const remove = {
    key: "calendar.event.delete",
    moduleKey: "runly.calendar",
    operation: "delete",
    label: "Eliminar evento",
    permission: "calendar.events.delete",
    description: "Elimina un evento existente. Requiere el eventId de list_my_calendar.",
    parameters: { type: "object", properties: { eventId: { type: "string" } }, required: ["eventId"] },
    async prepare(args, actx) {
      const parsed = deleteArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el eventId (de list_my_calendar)." };
      const found = await loadEvent(actx, parsed.data.eventId);
      if (found.error) return { error: found.error };
      const { id, event } = found;
      return {
        input: { eventId: id },
        targetId: id,
        preview: {
          title: "Eliminar evento",
          fields: [
            { label: "Evento", value: event.title },
            { label: "Inicio", value: fmt(event.startAt) },
            event.calendar?.name ? { label: "Calendario", value: event.calendar.name } : null,
            ...recurrenceNote(event),
          ].filter(Boolean),
        },
      };
    },
    async execute(input, actx) {
      const before = await eventService.getEvent(actx.actorProfileId, input.eventId, actx.companyId).catch(() => null);
      await eventService.deleteEvent(actx.actorProfileId, input.eventId, actx.companyId);
      await effects.afterDelete(actorContext({ companyId: actx.companyId, profile: actx.actorProfile }), input.eventId, before, actx.actorProfileId);
      return { id: input.eventId, summary: `Evento eliminado: ${before?.title ?? "evento"}` };
    },
  };

  return [create, update, remove];
}
