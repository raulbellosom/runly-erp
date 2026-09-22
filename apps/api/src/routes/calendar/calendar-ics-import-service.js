import ical from "node-ical";
import rrulePkg from "rrule";
import { CalendarServiceError } from "./calendar-service.js";

const { RRule } = rrulePkg;

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_INSTANCES_PER_EVENT = 800; // covers a 2-year daily series with margin
const MAX_INSTANCES_PER_IMPORT = 2000;
const WINDOW_MS = 2 * 365 * 24 * 60 * 60 * 1000; // 2 years

// origOptions keys that mean "this RRULE needs real recurrence-rule semantics,
// not simple day/week/month/year stepping" (BYDAY meaning "every Mon/Wed/Fri",
// BYMONTHDAY meaning "the 15th of every month", etc). Deliberately unsupported
// in v1 — see docs/superpowers/specs/2026-09-22-calendar-ics-import-design.md.
const COMPLEX_RRULE_KEYS = [
  "byweekday",
  "bymonthday",
  "bysetpos",
  "byyearday",
  "byweekno",
  "byhour",
  "byminute",
  "bysecond",
];

function isSimpleRrule(origOptions) {
  return !COMPLEX_RRULE_KEYS.some((key) => origOptions?.[key] !== undefined);
}

// node-ical resolves a DATE-only (all-day) value using the process's local
// timezone, so event.start for an all-day event is NOT UTC midnight — it's
// local-midnight-of-that-day reinterpreted as a UTC instant. Recover the
// intended calendar day the same way (Intl in the local zone) rather than
// trusting the raw UTC clock time, then rebuild a clean UTC-midnight Date —
// same convention already used by projects-calendar-bridge.js's toDateUTC.
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
function allDayDateOnly(date) {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return new Date(`${ymd}T00:00:00.000Z`);
}

// FREQ/INTERVAL-only stepping in UTC — deliberately NOT using rrule's
// `.between()`, which has a confirmed timezone bug for tzid'd RRULEs (see the
// design spec). Only called for "simple" rules (isSimpleRrule() above).
function stepDate(date, freq, interval) {
  const next = new Date(date);
  if (freq === RRule.DAILY) next.setUTCDate(next.getUTCDate() + interval);
  else if (freq === RRule.WEEKLY) next.setUTCDate(next.getUTCDate() + interval * 7);
  else if (freq === RRule.MONTHLY) next.setUTCMonth(next.getUTCMonth() + interval);
  else if (freq === RRule.YEARLY) next.setUTCFullYear(next.getUTCFullYear() + interval);
  else return null; // HOURLY/MINUTELY/SECONDLY — not a realistic calendar-app export, skip
  return next;
}

// Returns [{ start, end, summary, description, location, allDay, occurrenceKey }],
// occurrenceKey being the UID suffix used for de-dup. Never throws — a
// per-event problem (unsupported complex RRULE, HOURLY/MINUTELY freq) just
// falls back to importing the single base occurrence.
function expandOccurrences(event) {
  const isAllDay = event.datetype === "date";
  const baseStart = isAllDay ? allDayDateOnly(event.start) : event.start;
  const baseEnd = isAllDay ? null : (event.end ?? event.start);
  const single = [{
    start: baseStart,
    end: baseEnd,
    summary: event.summary ?? "",
    description: event.description ?? null,
    location: event.location ?? null,
    allDay: isAllDay,
    // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: internal dedup key (calendar-event-import-source.external_uid), not a user-facing date
    occurrenceKey: baseStart.toISOString().slice(0, 10),
  }];

  if (!event.rrule || isAllDay) return single; // all-day recurring series: v1 imports first occurrence only
  const opts = event.rrule.origOptions;
  if (!isSimpleRrule(opts)) return single;

  const freq = opts.freq;
  const interval = Number.isInteger(opts.interval) && opts.interval > 0 ? opts.interval : 1;
  const untilMs = opts.until instanceof Date ? opts.until.getTime() : Infinity;
  const maxByCount = Number.isInteger(opts.count) && opts.count > 0 ? opts.count : MAX_INSTANCES_PER_EVENT;
  const durationMs = baseEnd ? baseEnd.getTime() - baseStart.getTime() : 0;
  const nowMs = Date.now();
  const windowStartMs = nowMs - WINDOW_MS;
  const windowEndMs = nowMs + WINDOW_MS;

  const exdateKeys = new Set(Object.keys(event.exdate ?? {}));
  const overrides = event.recurrences ?? {};

  const instances = [];
  let current = new Date(baseStart);
  let produced = 0;
  while (
    produced < maxByCount &&
    current.getTime() <= untilMs &&
    instances.length < MAX_INSTANCES_PER_EVENT
  ) {
    // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: matches EXDATE/RECURRENCE-ID keys (also UTC date-sliced) and the dedup key above, not a user-facing date
    const dayKey = current.toISOString().slice(0, 10);
    produced += 1;
    if (!exdateKeys.has(dayKey) && current.getTime() >= windowStartMs && current.getTime() <= windowEndMs) {
      const override = overrides[dayKey];
      instances.push({
        start: override?.start ?? new Date(current),
        end: override?.end ?? (durationMs ? new Date(current.getTime() + durationMs) : null),
        summary: override?.summary ?? event.summary ?? "",
        description: override?.description ?? event.description ?? null,
        location: override?.location ?? event.location ?? null,
        allDay: false,
        occurrenceKey: dayKey,
      });
    }
    const next = stepDate(current, freq, interval);
    if (!next) break;
    current = next;
  }
  return instances;
}

export function createCalendarIcsImportService({ prisma }) {
  async function resolveTargetCalendar({ userId, companyId, calendarId, calendarName, fileCalendarName }) {
    if (calendarId) {
      const calendar = await prisma.calendarCalendar.findFirst({ where: { id: calendarId, enabled: true } });
      if (!calendar) throw new CalendarServiceError("Calendario no encontrado.", 404);
      const isOwner = calendar.ownerId === userId;
      const hasEditGrant = isOwner || await prisma.calendarShare.findFirst({
        where: { calendarId, userId, role: { in: ["EDITOR", "MANAGER"] } },
        select: { id: true },
      });
      if (!hasEditGrant) throw new CalendarServiceError("No tienes permiso para importar en ese calendario.", 403);
      return calendar.id;
    }
    const name = (calendarName || fileCalendarName || "Importado").trim().slice(0, 120);
    const created = await prisma.calendarCalendar.create({
      data: { ownerId: userId, companyId: companyId ?? null, name, color: "#6366f1", isDefault: false },
    });
    return created.id;
  }

  async function importIcs({ userId, companyId, calendarId = null, calendarName = null, fileBuffer }) {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new CalendarServiceError("El archivo esta vacio.", 400);
    }
    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      throw new CalendarServiceError("El archivo .ics supera el tamano maximo permitido (5 MB).", 400);
    }

    let parsed;
    try {
      parsed = ical.sync.parseICS(fileBuffer.toString("utf8"));
    } catch {
      throw new CalendarServiceError("No se pudo leer el archivo .ics.", 400);
    }
    const entries = Object.values(parsed ?? {});
    const events = entries.filter((e) => e?.type === "VEVENT");
    if (!events.length) {
      throw new CalendarServiceError("El archivo .ics no contiene eventos.", 400);
    }
    const fileCalendarName = entries.find((e) => e?.type === "VCALENDAR")?.["x-wr-calname"] ?? null;

    const targetCalendarId = await resolveTargetCalendar({ userId, companyId, calendarId, calendarName, fileCalendarName });

    let imported = 0;
    let duplicates = 0;
    let errors = 0;
    let truncated = false;
    let totalInstances = 0;

    for (const event of events) {
      if (totalInstances >= MAX_INSTANCES_PER_IMPORT) { truncated = true; break; }
      let occurrences;
      try {
        occurrences = expandOccurrences(event);
      } catch {
        errors += 1;
        continue;
      }
      for (const occ of occurrences) {
        if (totalInstances >= MAX_INSTANCES_PER_IMPORT) { truncated = true; break; }
        totalInstances += 1;
        const externalUid = `${event.uid}:${occ.occurrenceKey}`;
        try {
          const existing = await prisma.calendarEventImportSource.findFirst({
            where: { calendarId: targetCalendarId, externalUid },
            select: { id: true },
          });
          if (existing) { duplicates += 1; continue; }
          const created = await prisma.calendarEvent.create({
            data: {
              calendarId: targetCalendarId,
              title: (occ.summary || "(Sin titulo)").slice(0, 500),
              description: occ.description,
              startAt: occ.start,
              endAt: occ.end,
              allDay: occ.allDay,
              location: occ.location,
              sourceModule: "ics_import",
              sourceEntityId: null,
            },
          });
          await prisma.calendarEventImportSource.create({
            data: { calendarId: targetCalendarId, externalUid, eventId: created.id },
          });
          imported += 1;
        } catch {
          errors += 1;
        }
      }
    }

    return { calendarId: targetCalendarId, imported, duplicates, errors, truncated };
  }

  return { importIcs };
}
