// apps/api/src/routes/calendar/calendar-mirai-queries.js
//
// Exact calendar tools for MirAI (spec 2026-09-30-mirai-global-capabilities
// §10): list, aggregate and find free slots over the caller's own events.
// `from`/`to` are local dates (YYYY-MM-DD), inclusive. Totals are computed
// here, never left for the model to add up from a partial list.
import { zonedLocalToDate, formatLocalDateTime } from "@runly/core";

const MAX_RANGE_DAYS = 62;
const LIST_MAX = 30;
const SLOTS_MAX = 40;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function dateParts(value) {
  const m = DATE_RE.exec(String(value ?? "").trim());
  return m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) } : null;
}

function dayKeyOf(y, mo, d) {
  // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: pure calendar-date arithmetic on Date.UTC parts, no instant involved
  return new Date(Date.UTC(y, mo - 1, d)).toISOString().slice(0, 10);
}

function weekdayOf(dayKey) {
  const [y, mo, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

function mondayOf(dayKey) {
  const [y, mo, d] = dayKey.split("-").map(Number);
  const dow = weekdayOf(dayKey);
  const diff = (dow + 6) % 7; // days since Monday
  return dayKeyOf(y, mo, d - diff);
}

// -> { start, end, days } (days: local "YYYY-MM-DD" keys, inclusive) | { error }
function parseRange(from, to) {
  const f = dateParts(from);
  const t = dateParts(to);
  if (!f || !t) return { error: "Fechas invalidas; usa YYYY-MM-DD." };
  const start = zonedLocalToDate(from);
  const toStart = zonedLocalToDate(to);
  if (!start || !toStart) return { error: "Fechas invalidas; usa YYYY-MM-DD." };
  const end = new Date(toStart.getTime() + 24 * 60 * 60 * 1000);
  const dayCount = Math.round((Date.UTC(t.y, t.mo - 1, t.d) - Date.UTC(f.y, f.mo - 1, f.d)) / 86_400_000) + 1;
  if (dayCount < 1) return { error: "'to' debe ser igual o posterior a 'from'." };
  if (dayCount > MAX_RANGE_DAYS) return { error: `El rango maximo es ${MAX_RANGE_DAYS} dias.` };
  const days = Array.from({ length: dayCount }, (_, i) => dayKeyOf(f.y, f.mo, f.d + i));
  return { start, end, days };
}

function normalizeEvent(e) {
  return {
    id: e.id,
    title: e.title ?? null,
    startAt: e.startAt instanceof Date ? e.startAt : new Date(e.startAt),
    endAt: e.endAt ? (e.endAt instanceof Date ? e.endAt : new Date(e.endAt)) : null,
    allDay: Boolean(e.allDay),
    calendarName: e.calendar?.name ?? null,
    location: e.location ?? null,
    description: e.description ?? null,
    attendeeCount: (e.attendees ?? []).length,
  };
}

// All-day events have no meaningful duration for busy-hours accounting (spec:
// "counted 0 busy hours ... reported separately as todoElDia").
function durationHours(e) {
  if (e.allDay) return 0;
  const end = e.endAt ?? new Date(e.startAt.getTime() + 60 * 60 * 1000);
  return (end.getTime() - e.startAt.getTime()) / 3_600_000;
}

function localDayKey(date) {
  return formatLocalDateTime(date).slice(0, 10);
}

export function createCalendarMiraiQueries({ eventService }) {
  async function loadEvents(actx, start, end) {
    const events = await eventService.listEvents({ userId: actx.actorProfileId, companyId: actx.companyId, start, end });
    return (events ?? []).map(normalizeEvent);
  }

  const calendar_list_events = {
    name: "calendar_list_events",
    permission: "calendar.events.read",
    definition: {
      description: "Lista eventos del calendario del usuario en un rango de fechas locales, con un filtro de texto opcional.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Fecha local YYYY-MM-DD, inicio del rango (inclusive)." },
          to: { type: "string", description: "Fecha local YYYY-MM-DD, fin del rango (inclusive)." },
          query: { type: "string", description: "Texto opcional para filtrar por titulo, lugar o descripcion." },
        },
        required: ["from", "to"],
      },
    },
    async run(args, actx) {
      const range = parseRange(args?.from, args?.to);
      if (range.error) return { error: range.error };
      const events = await loadEvents(actx, range.start, range.end);
      const q = String(args?.query ?? "").trim().toLowerCase();
      const filtered = q
        ? events.filter((e) => [e.title, e.location, e.description].some((v) => String(v ?? "").toLowerCase().includes(q)))
        : events;
      filtered.sort((a, b) => a.startAt - b.startAt);
      return {
        total: filtered.length,
        eventos: filtered.slice(0, LIST_MAX).map((e) => ({
          eventId: e.id,
          titulo: e.title,
          inicio: formatLocalDateTime(e.startAt).slice(0, 16),
          fin: e.endAt ? formatLocalDateTime(e.endAt).slice(0, 16) : null,
          todoElDia: e.allDay,
          calendario: e.calendarName,
          invitados: e.attendeeCount,
        })),
      };
    },
  };

  const calendar_summary = {
    name: "calendar_summary",
    permission: "calendar.events.read",
    definition: {
      description: "Totales exactos de eventos y horas ocupadas del usuario en un rango, agrupados por dia, semana o calendario.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Fecha local YYYY-MM-DD, inicio del rango (inclusive)." },
          to: { type: "string", description: "Fecha local YYYY-MM-DD, fin del rango (inclusive)." },
          groupBy: { type: "string", enum: ["day", "week", "calendar"], description: "Como agrupar (por defecto day)." },
        },
        required: ["from", "to"],
      },
    },
    async run(args, actx) {
      const range = parseRange(args?.from, args?.to);
      if (range.error) return { error: range.error };
      const groupBy = ["day", "week", "calendar"].includes(args?.groupBy) ? args.groupBy : "day";
      const events = await loadEvents(actx, range.start, range.end);

      const groupKey = (e) => {
        if (groupBy === "calendar") return e.calendarName ?? "(sin calendario)";
        const day = localDayKey(e.startAt);
        return groupBy === "week" ? mondayOf(day) : day;
      };

      const groups = new Map();
      let totalHoras = 0;
      let todoElDia = 0;
      for (const e of events) {
        const hours = durationHours(e);
        totalHoras += hours;
        if (e.allDay) todoElDia += 1;
        const key = groupKey(e);
        const g = groups.get(key) ?? { eventos: 0, horas: 0 };
        g.eventos += 1;
        g.horas += hours;
        groups.set(key, g);
      }
      return {
        totalEventos: events.length,
        totalHoras: Math.round(totalHoras * 100) / 100,
        todoElDia,
        grupos: [...groups.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([grupo, g]) => ({ grupo, eventos: g.eventos, horas: Math.round(g.horas * 100) / 100 })),
      };
    },
  };

  const calendar_free_slots = {
    name: "calendar_free_slots",
    permission: "calendar.events.read",
    definition: {
      description: "Encuentra huecos libres en el calendario del usuario dentro de un horario de trabajo, en un rango de fechas locales.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Fecha local YYYY-MM-DD, inicio del rango (inclusive)." },
          to: { type: "string", description: "Fecha local YYYY-MM-DD, fin del rango (inclusive)." },
          minMinutes: { type: "integer", description: "Duracion minima del hueco en minutos (por defecto 30)." },
          dayStart: { type: "string", description: "Hora local de inicio de jornada HH:mm (por defecto 09:00)." },
          dayEnd: { type: "string", description: "Hora local de fin de jornada HH:mm (por defecto 18:00)." },
          includeWeekends: { type: "boolean", description: "Incluir sabado y domingo (por defecto false)." },
        },
        required: ["from", "to"],
      },
    },
    async run(args, actx) {
      const range = parseRange(args?.from, args?.to);
      if (range.error) return { error: range.error };
      const minMinutes = Number.isInteger(args?.minMinutes) && args.minMinutes > 0 ? args.minMinutes : 30;
      const dayStart = TIME_RE.test(args?.dayStart ?? "") ? args.dayStart : "09:00";
      const dayEnd = TIME_RE.test(args?.dayEnd ?? "") ? args.dayEnd : "18:00";
      if (dayStart >= dayEnd) return { error: "dayStart debe ser anterior a dayEnd." };
      const includeWeekends = Boolean(args?.includeWeekends);

      const events = await loadEvents(actx, range.start, range.end);
      const allDayKeys = new Set();
      for (const e of events) {
        if (!e.allDay) continue;
        const startKey = localDayKey(e.startAt);
        const endKey = e.endAt ? localDayKey(new Date(e.endAt.getTime() - 1)) : startKey;
        for (const key of range.days) {
          if (key >= startKey && key <= endKey) allDayKeys.add(key);
        }
      }

      const huecos = [];
      for (const dayKey of range.days) {
        if (!includeWeekends && [0, 6].includes(weekdayOf(dayKey))) continue;
        if (allDayKeys.has(dayKey)) continue;
        const windowStart = zonedLocalToDate(`${dayKey}T${dayStart}`);
        const windowEnd = zonedLocalToDate(`${dayKey}T${dayEnd}`);
        const busy = events
          .filter((e) => !e.allDay)
          .map((e) => [e.startAt, e.endAt ?? new Date(e.startAt.getTime() + 60 * 60 * 1000)])
          .map(([s, en]) => [s < windowStart ? windowStart : s, en > windowEnd ? windowEnd : en])
          .filter(([s, en]) => s < en)
          .sort((a, b) => a[0] - b[0]);

        const merged = [];
        for (const [s, en] of busy) {
          const last = merged[merged.length - 1];
          if (last && s <= last[1]) last[1] = en > last[1] ? en : last[1];
          else merged.push([s, en]);
        }

        let cursor = windowStart;
        for (const [s, en] of merged) {
          if (s - cursor >= minMinutes * 60_000) {
            huecos.push({ dia: dayKey, inicio: formatLocalDateTime(cursor).slice(0, 16), fin: formatLocalDateTime(s).slice(0, 16), minutos: Math.round((s - cursor) / 60_000) });
          }
          cursor = en > cursor ? en : cursor;
        }
        if (windowEnd - cursor >= minMinutes * 60_000) {
          huecos.push({ dia: dayKey, inicio: formatLocalDateTime(cursor).slice(0, 16), fin: formatLocalDateTime(windowEnd).slice(0, 16), minutos: Math.round((windowEnd - cursor) / 60_000) });
        }
      }
      return { total: huecos.length, huecos: huecos.slice(0, SLOTS_MAX) };
    },
  };

  return [calendar_list_events, calendar_summary, calendar_free_slots];
}
