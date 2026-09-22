# Importación de calendarios .ics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload a `.ics` file exported from a local-only calendar app (aCalendar+, etc.) and import its events into a runly.calendar calendar, with duplicate detection on re-upload.

**Architecture:** New Prisma table `CalendarEventImportSource` tracks `(calendarId, externalUid) → eventId` for dedup. A new `calendar-ics-import-service.js` parses the file with `node-ical` (pinned to `0.22.0`, the last version built on the classic `rrule` package instead of the newer `rrule-temporal`), expands recurring events into individual `CalendarEvent` rows using our own UTC-safe date stepping (NOT `rrule`'s `.between()`, which has a confirmed timezone bug — see Task 2), and inserts new instances while skipping ones already seen for that calendar. A new `POST /calendar/ics-import` multipart route wires it up; a small dialog in the desktop calendar screen drives it.

**Tech Stack:** Hono (multipart `c.req.parseBody()`), Prisma, `node-ical@0.22.0` + `rrule@2.8.1` (apps/api dependencies), `@runly/ui` (`FileUploader`, `Dialog`, `SelectField`), Node's built-in test runner.

**Design spec:** `docs/superpowers/specs/2026-09-22-calendar-ics-import-design.md`

---

### Task 1: Database migration + Prisma schema

**Files:**
- Create: `prisma/migrations/20260922090000_calendar_ics_import/migration.sql`
- Modify: `prisma/schema.prisma` (add `CalendarEventImportSource` model; add back-relations on `CalendarCalendar` and `CalendarEvent`)

- [ ] **Step 1: Write the migration SQL**

```sql
-- Tracks which CalendarEvent rows came from a .ics import, keyed by the
-- source file's per-occurrence UID, so re-importing the same (or an updated)
-- export into the same calendar skips events already brought in.
CREATE TABLE calendar_event_import_source (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  calendar_id  UUID NOT NULL REFERENCES calendar_calendar(id) ON DELETE CASCADE,
  external_uid TEXT NOT NULL,
  event_id     UUID NOT NULL REFERENCES calendar_event(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX calendar_event_import_source_calendar_uid_key
  ON calendar_event_import_source(calendar_id, external_uid);
```

- [ ] **Step 2: Add the Prisma model**

In `prisma/schema.prisma`, add this model right after `model CalendarEventAttendee { ... }` (around line 2191):

```prisma
model CalendarEventImportSource {
  id          String   @id @default(uuid(7)) @db.Uuid
  calendarId  String   @db.Uuid @map("calendar_id")
  externalUid String   @map("external_uid")
  eventId     String   @db.Uuid @map("event_id")
  createdAt   DateTime @default(now()) @map("created_at")

  calendar CalendarCalendar @relation(fields: [calendarId], references: [id], onDelete: Cascade)
  event    CalendarEvent    @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@unique([calendarId, externalUid])
  @@map("calendar_event_import_source")
}
```

Then add the back-relation fields. In `model CalendarCalendar` (around line 1942), add a line next to the other relation arrays:

```prisma
  importSources CalendarEventImportSource[]
```

In `model CalendarEvent` (around line 1987, next to `googleLink`), add:

```prisma
  importSource  CalendarEventImportSource?
```

- [ ] **Step 3: Generate the Prisma client and verify the schema compiles**

Run: `pnpm db:generate`
Expected: completes without error, regenerates `node_modules/.prisma/client` including the new `calendarEventImportSource` model.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260922090000_calendar_ics_import/
git commit -m "feat(calendar): add CalendarEventImportSource table for .ics import dedup"
```

---

### Task 2: `node-ical` dependency + recurrence-expansion spike verification

This task exists because `node-ical`'s RRULE expansion (`rrule.between()`) has a confirmed timezone bug in this environment: for an RRULE with `tzid: 'Etc/UTC'`, `.between()` returns occurrence `Date`s shifted by the server's local UTC offset (verified: a 09:00 UTC weekly event's second occurrence came back as 03:00 UTC on a machine whose local zone is America/Mexico_City, UTC-6). All-day (`DATE`-only) values have a similar artifact — `event.start` for a `DATE`-only `DTSTART` is not UTC midnight, it's local-midnight-reinterpreted-as-UTC. Task 3's service code works around both by never consuming `.between()`'s output and by re-deriving all-day dates via `Intl.DateTimeFormat` in the local zone. This task just pins the dependency; Task 3 has the actual workaround code.

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add the pinned dependencies**

In `apps/api/package.json`, add to `"dependencies"` (alphabetical, next to `"node-cache"`):

```json
    "node-ical": "0.22.0",
```

And next to `"react-dom"` (alphabetical, `r` comes after `qrcode`):

```json
    "rrule": "2.8.1",
```

(`rrule` is already a transitive dependency of `node-ical@0.22.0` at this exact version — pinning it directly is just so Task 3's `import { RRule } from "rrule"` resolves an explicit dependency rather than relying on hoisting.)

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updates, both packages appear under `node_modules/.pnpm/`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add node-ical + rrule for .ics calendar import"
```

---

### Task 3: `calendar-ics-import-service.js`

**Files:**
- Create: `apps/api/src/routes/calendar/calendar-ics-import-service.js`
- Test: `apps/api/src/routes/calendar/__tests__/calendar-ics-import-service.test.js`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/routes/calendar/__tests__/calendar-ics-import-service.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createCalendarIcsImportService } from '../calendar-ics-import-service.js'
import { CalendarServiceError } from '../calendar-service.js'

const SIMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Trabajo
BEGIN:VEVENT
UID:simple-1@acalendar
DTSTAMP:20260901T120000Z
DTSTART:20260925T150000Z
DTEND:20260925T160000Z
SUMMARY:Reunion con cliente
LOCATION:Oficina
DESCRIPTION:Revisar contrato
END:VEVENT
END:VCALENDAR
`

const RECURRING_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:weekly-1@acalendar
DTSTAMP:20260901T120000Z
DTSTART:20260901T090000Z
DTEND:20260901T093000Z
SUMMARY:Standup semanal
RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=4
EXDATE:20260908T090000Z
END:VEVENT
END:VCALENDAR
`

const MALFORMED_ICS = `not an ics file at all`

function makePrisma({ existingCalendar = { id: 'cal-1', ownerId: 'user-1', enabled: true }, existingUids = [] } = {}) {
  const createdEvents = []
  const createdSources = [...existingUids.map((externalUid) => ({ calendarId: 'cal-1', externalUid }))]
  return {
    calendarCalendar: {
      findFirst: async () => existingCalendar,
      create: async ({ data }) => ({ id: 'cal-new', ...data }),
    },
    calendarShare: {
      findFirst: async () => null,
    },
    calendarEvent: {
      create: async ({ data }) => {
        const event = { id: `event-${createdEvents.length + 1}`, ...data }
        createdEvents.push(event)
        return event
      },
    },
    calendarEventImportSource: {
      findFirst: async ({ where }) =>
        createdSources.find((s) => s.calendarId === where.calendarId && s.externalUid === where.externalUid) ?? null,
      create: async ({ data }) => {
        createdSources.push(data)
        return { id: `src-${createdSources.length}`, ...data }
      },
    },
    _createdEvents: createdEvents,
  }
}

describe('calendar-ics-import-service', () => {
  it('imports a single non-recurring event', async () => {
    const prisma = makePrisma()
    const svc = createCalendarIcsImportService({ prisma })
    const result = await svc.importIcs({
      userId: 'user-1',
      companyId: 'company-1',
      calendarId: 'cal-1',
      fileBuffer: Buffer.from(SIMPLE_ICS),
    })
    assert.equal(result.imported, 1)
    assert.equal(result.duplicates, 0)
    assert.equal(prisma._createdEvents[0].title, 'Reunion con cliente')
    assert.equal(prisma._createdEvents[0].location, 'Oficina')
  })

  it('expands a weekly recurrence into individual events, honouring EXDATE', async () => {
    const prisma = makePrisma()
    const svc = createCalendarIcsImportService({ prisma })
    const result = await svc.importIcs({
      userId: 'user-1',
      companyId: 'company-1',
      calendarId: 'cal-1',
      fileBuffer: Buffer.from(RECURRING_ICS),
    })
    // COUNT=4 minus the one EXDATE-excluded occurrence
    assert.equal(result.imported, 3)
    assert.equal(prisma._createdEvents.length, 3)
  })

  it('skips events already imported into the same calendar (dedup)', async () => {
    const prisma = makePrisma({ existingUids: ['simple-1@acalendar:2026-09-25'] })
    const svc = createCalendarIcsImportService({ prisma })
    const result = await svc.importIcs({
      userId: 'user-1',
      companyId: 'company-1',
      calendarId: 'cal-1',
      fileBuffer: Buffer.from(SIMPLE_ICS),
    })
    assert.equal(result.imported, 0)
    assert.equal(result.duplicates, 1)
  })

  it('rejects a calendarId the user cannot write to', async () => {
    const prisma = makePrisma({ existingCalendar: { id: 'cal-1', ownerId: 'someone-else', enabled: true } })
    const svc = createCalendarIcsImportService({ prisma })
    await assert.rejects(
      () => svc.importIcs({ userId: 'user-1', companyId: 'company-1', calendarId: 'cal-1', fileBuffer: Buffer.from(SIMPLE_ICS) }),
      (e) => e instanceof CalendarServiceError && e.status === 403,
    )
  })

  it('rejects a malformed file without throwing an unhandled error', async () => {
    const prisma = makePrisma()
    const svc = createCalendarIcsImportService({ prisma })
    await assert.rejects(
      () => svc.importIcs({ userId: 'user-1', companyId: 'company-1', calendarId: 'cal-1', fileBuffer: Buffer.from(MALFORMED_ICS) }),
      (e) => e instanceof CalendarServiceError && e.status === 400,
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/api/src/routes/calendar/__tests__/calendar-ics-import-service.test.js`
Expected: FAIL — `Cannot find module '../calendar-ics-import-service.js'`

- [ ] **Step 3: Write the service**

Create `apps/api/src/routes/calendar/calendar-ics-import-service.js`:

```js
import ical from "node-ical";
import { RRule } from "rrule";
import { CalendarServiceError } from "./calendar-service.js";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_INSTANCES_PER_EVENT = 800; // covers a 2-year daily series with margin
const MAX_INSTANCES_PER_IMPORT = 2000;
const WINDOW_MS = 2 * 365 * 24 * 60 * 60 * 1000; // 2 years

// origOptions keys that mean "this RRULE needs real recurrence-rule semantics,
// not simple day/week/month/year stepping" (BYDAY meaning "every Mon/Wed/Fri",
// BYMONTHDAY meaning "the 15th of every month", etc). We deliberately don't
// support these in v1 — see docs/superpowers/specs/2026-09-22-calendar-ics-import-design.md.
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

// Returns [{ start, end, summary, description, location, occurrenceKey }],
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/api/src/routes/calendar/__tests__/calendar-ics-import-service.test.js`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/calendar/calendar-ics-import-service.js apps/api/src/routes/calendar/__tests__/calendar-ics-import-service.test.js
git commit -m "feat(calendar): add .ics import service with recurrence expansion and dedup"
```

---

### Task 4: API route

**Files:**
- Modify: `apps/api/src/routes/calendar/calendar-routes.js`

- [ ] **Step 1: Wire the service and route**

In `calendar-routes.js`, add the import near the top (next to the other service imports, around line 6):

```js
import { createCalendarIcsImportService } from "./calendar-ics-import-service.js";
```

Next to where `eventSvc` is constructed (around line 162, inside the router factory):

```js
  const icsImportSvc = createCalendarIcsImportService({ prisma });
```

Add the route right after the `POST /calendar/events` handler (after the closing of that block, before `app.get("/calendar/events/:id", ...)`  around line 684):

```js
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
```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check apps/api/src/routes/calendar/calendar-routes.js`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/calendar/calendar-routes.js
git commit -m "feat(calendar): add POST /calendar/ics-import route"
```

---

### Task 5: SDK method

**Files:**
- Modify: `packages/sdk/src/domains/calendar.js`

- [ ] **Step 1: Read the current file to find where to add the method**

Read `packages/sdk/src/domains/calendar.js` and locate the object returned by `createCalendarDomain` (or equivalent factory name) — add `importIcs` as a sibling of the existing `createEvent`/`listEvents` methods.

- [ ] **Step 2: Add the method**

Add (matching whatever the existing `request`/`withAuthHeaders` helper names are in that file — follow the exact pattern already used for `getLink`/`createEvent` etc., substituting a `FormData` body instead of JSON since this is a file upload, same shape as `packages/sdk/src/domains/files.js`'s upload method):

```js
    importIcs: (formData, token) =>
      request("/calendar/ics-import", {
        method: "POST",
        headers: withAuthHeaders(token),
        body: formData,
      }),
```

(Do not JSON.stringify `formData` and do not set a `Content-Type` header — the browser sets the multipart boundary automatically, same as the existing file-upload method in `domains/files.js`.)

- [ ] **Step 3: Syntax-check**

Run: `node --check packages/sdk/src/domains/calendar.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/src/domains/calendar.js
git commit -m "feat(sdk): add calendar.importIcs for .ics calendar import"
```

---

### Task 6: `ImportIcsDialog.jsx`

**Files:**
- Create: `apps/desktop/src/modules/runly.calendar/components/ImportIcsDialog.jsx`
- Modify: `apps/desktop/src/modules/runly.calendar/screens/CalendarScreen.jsx`

- [ ] **Step 1: Read `CalendarScreen.jsx` and `useCalendarData.js`**

Read `apps/desktop/src/modules/runly.calendar/screens/CalendarScreen.jsx` in full, and `apps/desktop/src/modules/runly.calendar/hooks/useCalendarData.js`, to find: where the "connect Google Calendar" entry point / calendar list lives (to place the new "Importar .ics" button next to it), how `useCalendars()` is invoked, and the exact `useAuth()`/`token` access pattern already used by sibling components (`NewMeetingDialog.jsx` is a good reference: `const { session } = useAuth(); const token = session?.access_token;`).

- [ ] **Step 2: Write `ImportIcsDialog.jsx`**

```jsx
import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, FileUploader, SelectField, ErrorState,
} from "@runly/ui";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { useCalendars } from "../hooks/useCalendarData";
import { useQueryClient } from "@tanstack/react-query";

const NEW_CALENDAR = "__new__";

function unwrap(r) {
  return r?.data ?? r;
}

export default function ImportIcsDialog({ open, onOpenChange }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const { data: calData } = useCalendars();
  const ownedCalendars = calData?.owned ?? [];

  const [file, setFile] = useState(null);
  const [calendarId, setCalendarId] = useState(NEW_CALENDAR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function reset() {
    setFile(null);
    setCalendarId(NEW_CALENDAR);
    setBusy(false);
    setError(null);
  }

  async function handleImport() {
    if (!file) {
      toast.error("Selecciona un archivo .ics");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (calendarId !== NEW_CALENDAR) formData.append("calendarId", calendarId);
      const result = unwrap(await runly.calendar.importIcs(formData, token));
      const parts = [`${result.imported} eventos importados`];
      if (result.duplicates) parts.push(`${result.duplicates} duplicados omitidos`);
      if (result.errors) parts.push(`${result.errors} con error`);
      toast.success(`${parts.join(" · ")}.`);
      if (result.truncated) {
        toast.message("El archivo traia mas eventos de los que se pudieron importar de una vez.");
      }
      await queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      await queryClient.invalidateQueries({ queryKey: ["calendars"] });
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(e?.message || "No se pudo importar el archivo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { reset(); onOpenChange(next); } }}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Importar calendario (.ics)</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Exporta tu calendario desde aCalendar+ (u otra app) como archivo .ics y subelo aqui.
          </p>
          <FileUploader
            label="Archivo .ics"
            accept=".ics,text/calendar"
            value={file}
            onChange={setFile}
            disabled={busy}
          />
          <SelectField
            label="Importar en"
            value={calendarId}
            disabled={busy}
            onValueChange={setCalendarId}
            options={[
              { value: NEW_CALENDAR, label: "➕ Crear calendario nuevo" },
              ...ownedCalendars.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          {error && <ErrorState className="py-3" title="No se pudo importar" description={error} />}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => { reset(); onOpenChange(false); }}>Cancelar</Button>
          <Button onClick={handleImport} disabled={busy || !file}>{busy ? "Importando..." : "Importar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

(If Step 1 finds that `useCalendars`, `runly`, `useAuth`, or `@runly/ui`'s exact export names/paths differ from the above — e.g. the hooks file exports `useCalendars` under a different name, or `FileUploader` takes different prop names — adjust this component to match what actually exists; don't introduce a second convention.)

- [ ] **Step 3: Add the entry point in `CalendarScreen.jsx`**

Based on what Step 1 found, add a button (near the existing calendar-management / Google-connect entry points) that opens this dialog, following the exact same `useState` + conditional-render pattern already used in that file for its other dialogs (e.g. however it currently opens `EventFormModal`). Import the new component:

```jsx
import ImportIcsDialog from "../components/ImportIcsDialog";
```

Add state:

```jsx
const [icsImportOpen, setIcsImportOpen] = useState(false);
```

Add a button labeled "Importar .ics" that calls `setIcsImportOpen(true)`, placed next to the other calendar-management actions. Render the dialog:

```jsx
<ImportIcsDialog open={icsImportOpen} onOpenChange={setIcsImportOpen} />
```

- [ ] **Step 4: Manual verification**

Run: `pnpm dev:frontend` (plus `pnpm dev:api` in another terminal)
- Open the calendar screen, click "Importar .ics".
- Upload the sample file from Task 3's tests (create a throwaway `.ics` with the same content as `SIMPLE_ICS` if none is handy) targeting "Crear calendario nuevo".
- Confirm the toast shows "1 eventos importados", a new calendar appears, and the event shows on the right date/time.
- Re-upload the same file into the same (now-existing) calendar; confirm the toast shows "0 eventos importados · 1 duplicados omitidos".

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.calendar/components/ImportIcsDialog.jsx apps/desktop/src/modules/runly.calendar/screens/CalendarScreen.jsx
git commit -m "feat(calendar): add .ics import dialog to the calendar screen"
```

---

### Task 7: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full calendar test suite**

Run: `node --test apps/api/src/routes/calendar/__tests__/`
Expected: all pass, including the new `calendar-ics-import-service.test.js`.

- [ ] **Step 2: Syntax-check every touched JS file**

Run:
```bash
node --check apps/api/src/routes/calendar/calendar-ics-import-service.js
node --check apps/api/src/routes/calendar/calendar-routes.js
node --check packages/sdk/src/domains/calendar.js
```
Expected: no output from any.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no new errors introduced by this feature's files.

- [ ] **Step 4: Confirm no file crossed the 1000-line soft limit**

Run: `wc -l apps/api/src/routes/calendar/calendar-routes.js apps/api/src/routes/calendar/calendar-ics-import-service.js`
Expected: `calendar-ics-import-service.js` is a new, focused file well under 1000 lines; `calendar-routes.js` grew by ~25 lines from Task 4 — confirm it's still under the documented limit (check current line count against the 1000/1500 thresholds noted in `CLAUDE.md`; if it's now over 1000, note it for a future split, don't attempt one in this plan).

- [ ] **Step 5: Final commit if anything was left uncommitted**

```bash
git status
```
If clean, done. If not, commit remaining changes with an appropriate message.
