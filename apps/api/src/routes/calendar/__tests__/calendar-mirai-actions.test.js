import test from "node:test";
import assert from "node:assert/strict";
import { createCalendarMiraiActions } from "../mirai-actions.js";

process.env.RUNLY_TIME_ZONE = "America/Mexico_City";
const actx = { companyId: "co1", actorProfileId: "me", actorAuthUserId: "auth", actorProfile: { id: "me", displayName: "Yo" } };
const CAL = { id: "cal1", name: "Mi calendario", isDefault: true, ownerId: "me" };

function setup({ users = [], event = null } = {}) {
  const calls = [];
  const prisma = {
    calendarCalendar: { findMany: async () => [CAL] },
    userProfile: { findMany: async () => users },
  };
  const eventService = {
    getEvent: async () => { if (!event) throw new Error("404"); return event; },
    createEvent: async (uid, data) => { calls.push(["create", data]); return { id: "ev1", title: data.title, startAt: new Date(data.startAt) }; },
    updateEvent: async (uid, id, data) => { calls.push(["update", id, data]); return { ...event, ...data, startAt: new Date(data.startAt ?? event.startAt) }; },
    deleteEvent: async (uid, id) => { calls.push(["delete", id]); },
  };
  const effects = { afterCreate: async () => calls.push(["fx:create"]), afterUpdate: async () => calls.push(["fx:update"]), afterDelete: async () => calls.push(["fx:delete"]) };
  const actions = Object.fromEntries(createCalendarMiraiActions({ prisma, eventService, effects }).map((a) => [a.key, a]));
  return { actions, calls };
}

test("create: converts local time, defaults to 1h and the default calendar, writes nothing", async () => {
  const { actions, calls } = setup({ users: [{ id: "u2", displayName: "Ana Lopez", email: "ana@x.com" }] });
  const out = await actions["calendar.event.create"].prepare({ title: "Reunion", start: "2026-10-01T10:00", attendees: ["Ana"] }, actx);
  assert.equal(out.input.startAt, "2026-10-01T16:00:00.000Z");
  assert.equal(out.input.endAt, "2026-10-01T17:00:00.000Z");
  assert.equal(out.input.calendarId, "cal1");
  assert.deepEqual(out.input.attendeeIds, ["u2"]);
  assert.equal(calls.length, 0);
});

test("create: execute calls the service and the shared effects", async () => {
  const { actions, calls } = setup();
  const res = await actions["calendar.event.create"].execute({ calendarId: "cal1", title: "Reunion", startAt: "2026-10-01T16:00:00.000Z", endAt: null, allDay: false, attendeeIds: [], reminderMinutes: [] }, actx);
  assert.equal(res.id, "ev1");
  assert.deepEqual(calls.map((c) => c[0]), ["create", "fx:create"]);
});

test("update: moving the start keeps the duration and previews before/after", async () => {
  const event = { id: "ev1", title: "Reunion", calendarId: "cal1", startAt: new Date("2026-10-01T16:00:00Z"), endAt: new Date("2026-10-01T17:00:00Z") };
  const { actions } = setup({ event });
  const out = await actions["calendar.event.update"].prepare({ eventId: "ev1", start: "2026-10-01T12:00" }, actx);
  assert.equal(out.input.data.startAt, "2026-10-01T18:00:00.000Z");
  assert.equal(out.input.data.endAt, "2026-10-01T19:00:00.000Z");
  assert.ok(out.preview.fields.some((f) => f.label === "Inicio" && f.before));
});

test("delete: unknown event returns an error; recurrence instance ids map to the base event", async () => {
  assert.ok((await setup().actions["calendar.event.delete"].prepare({ eventId: "nope" }, actx)).error);
  const event = { id: "ev1", title: "Daily", calendarId: "cal1", startAt: new Date(), endAt: null, recurrenceRule: { freq: "DAILY" } };
  const out = await setup({ event }).actions["calendar.event.delete"].prepare({ eventId: "ev1_20261001" }, actx);
  assert.equal(out.targetId, "ev1");
});
