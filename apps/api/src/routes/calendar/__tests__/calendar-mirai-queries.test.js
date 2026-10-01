import test from "node:test";
import assert from "node:assert/strict";
import { zonedLocalToDate } from "@runly/core";
import { createCalendarMiraiQueries } from "../calendar-mirai-queries.js";
import { createCalendarMiraiCapabilities } from "../mirai-capabilities.js";

process.env.RUNLY_TIME_ZONE = "America/Mexico_City";

const actx = { companyId: "co1", actorProfileId: "me" };

function fakeEventService(events) {
  return {
    listEvents: async () => events,
    getEvent: async () => { throw new Error("not found"); },
  };
}

test("calendar_summary: totals hours across a 1h and a 90-min event, counts the all-day event separately", async () => {
  const events = [
    { id: "e1", title: "Standup", startAt: zonedLocalToDate("2026-10-05T09:00"), endAt: zonedLocalToDate("2026-10-05T10:00"), allDay: false, calendar: { name: "Trabajo" }, attendees: [] },
    { id: "e2", title: "Revision", startAt: zonedLocalToDate("2026-10-06T09:00"), endAt: zonedLocalToDate("2026-10-06T10:30"), allDay: false, calendar: { name: "Trabajo" }, attendees: [] },
    { id: "e3", title: "Feriado", startAt: zonedLocalToDate("2026-10-06T00:00"), endAt: null, allDay: true, calendar: { name: "Personal" }, attendees: [] },
  ];
  const [, calendar_summary] = createCalendarMiraiQueries({ eventService: fakeEventService(events) });
  const out = await calendar_summary.run({ from: "2026-10-05", to: "2026-10-06" }, actx);
  assert.equal(out.totalEventos, 3);
  assert.equal(out.totalHoras, 2.5);
  assert.equal(out.todoElDia, 1);
  assert.deepEqual(out.grupos.map((g) => g.grupo), ["2026-10-05", "2026-10-06"]);
});

test("calendar_free_slots: a 10:00-11:00 event splits the day into two free slots", async () => {
  const events = [
    { id: "e1", title: "Reunion", startAt: zonedLocalToDate("2026-10-05T10:00"), endAt: zonedLocalToDate("2026-10-05T11:00"), allDay: false, calendar: { name: "Trabajo" }, attendees: [] },
  ];
  const [, , calendar_free_slots] = createCalendarMiraiQueries({ eventService: fakeEventService(events) });
  const out = await calendar_free_slots.run({ from: "2026-10-05", to: "2026-10-05" }, actx);
  assert.deepEqual(out.huecos.map((h) => [h.inicio.slice(11), h.fin.slice(11)]), [["09:00", "10:00"], ["11:00", "18:00"]]);
});

test("calendar_free_slots: weekends are skipped unless includeWeekends", async () => {
  // 2026-10-10 is a Saturday.
  const [, , calendar_free_slots] = createCalendarMiraiQueries({ eventService: fakeEventService([]) });
  const skipped = await calendar_free_slots.run({ from: "2026-10-10", to: "2026-10-10" }, actx);
  assert.equal(skipped.huecos.length, 0);
  const included = await calendar_free_slots.run({ from: "2026-10-10", to: "2026-10-10", includeWeekends: true }, actx);
  assert.equal(included.huecos.length, 1);
});

test("describeContext returns null when getEvent throws", async () => {
  const cap = createCalendarMiraiCapabilities({ prisma: {}, eventService: fakeEventService([]), effects: {} });
  const line = await cap.describeContext({ recordType: "event", recordId: "ev1" }, actx);
  assert.equal(line, null);
});
