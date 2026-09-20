// apps/api/src/routes/pfm/__tests__/pfm-calendar-bridge.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPfmCalendarBridge } from "../pfm-calendar-bridge.js";

const OWNER = "01900000-0000-7000-8000-000000000301";
const RULE = "01900000-0000-7000-8000-000000000302";
const CAL = "01900000-0000-7000-8000-000000000303";

function baseRule(over = {}) {
  return {
    id: RULE,
    ownerId: OWNER,
    label: "Netflix",
    direction: "EXPENSE",
    amountMode: "FIXED",
    amount: 219,
    rrule: { freq: "MONTHLY", interval: 1, byMonthDay: 5 },
    nextRunAt: "2026-09-05T00:00:00.000Z",
    calendarEventId: null,
    ...over,
  };
}

describe("pfm-calendar-bridge", () => {
  it("degrades silently when the calendar tables are absent", async () => {
    const bridge = createPfmCalendarBridge({ prisma: {} });
    await assert.doesNotReject(() => bridge.syncRuleEvent(baseRule()));
  });

  it("provisions a dedicated calendar once and creates one recurring event per rule", async () => {
    const state = { calendars: [], events: [], config: {} };
    const prisma = {
      calendarCalendar: {
        create: async ({ data }) => {
          const row = { id: CAL, ...data };
          state.calendars.push(row);
          return row;
        },
        findFirst: async () => state.calendars[0] ?? null,
      },
      instanceConfig: {
        findUnique: async ({ where }) =>
          state.config[where.key] ? { value: state.config[where.key] } : null,
        upsert: async ({ where, create }) => {
          state.config[where.key] = create.value;
          return create;
        },
      },
      calendarEvent: {
        create: async ({ data }) => {
          const row = { id: "evt1", ...data };
          state.events.push(row);
          return row;
        },
        update: async ({ where, data }) => {
          const e = state.events.find((x) => x.id === where.id);
          Object.assign(e, data);
          return e;
        },
      },
      pfmRecurringRule: { update: async () => ({}) },
    };
    const bridge = createPfmCalendarBridge({ prisma });
    await bridge.syncRuleEvent(baseRule());
    assert.equal(state.calendars.length, 1);
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].sourceModule, "runly.pfm");
    assert.equal(state.events[0].sourceEntityId, RULE);
    assert.ok(state.events[0].recurrenceRule);
  });

  it("deleteRuleEvent removes the linked event", async () => {
    let deleted = null;
    const prisma = {
      calendarEvent: { delete: async ({ where }) => (deleted = where.id) },
    };
    const bridge = createPfmCalendarBridge({ prisma });
    await bridge.deleteRuleEvent(baseRule({ calendarEventId: "evt9" }));
    assert.equal(deleted, "evt9");
  });

  it("syncCreditReminder no-ops for a non-credit wallet or a wallet with no paymentDueDay", async () => {
    const bridge = createPfmCalendarBridge({ prisma: {} });
    assert.equal(await bridge.syncCreditReminder({ kind: "CASH", ownerId: OWNER }), null);
    assert.equal(
      await bridge.syncCreditReminder({ kind: "CREDIT", ownerId: OWNER, paymentDueDay: null }),
      null,
    );
  });

  it("syncCreditReminder creates one monthly recurring payment-due event and stores creditReminderEventId", async () => {
    const state = { calendars: [], events: [], config: {}, walletPatch: null };
    const prisma = {
      calendarCalendar: {
        create: async ({ data }) => {
          const row = { id: CAL, ...data };
          state.calendars.push(row);
          return row;
        },
        findFirst: async () => state.calendars[0] ?? null,
      },
      instanceConfig: {
        findUnique: async ({ where }) =>
          state.config[where.key] ? { value: state.config[where.key] } : null,
        upsert: async ({ where, create }) => {
          state.config[where.key] = create.value;
          return create;
        },
      },
      calendarEvent: {
        create: async ({ data }) => {
          const row = { id: "evtC", ...data };
          state.events.push(row);
          return row;
        },
        update: async ({ where, data }) => {
          Object.assign(
            state.events.find((x) => x.id === where.id),
            data,
          );
        },
      },
      pfmWallet: { update: async ({ data }) => ((state.walletPatch = data), {}) },
    };
    const bridge = createPfmCalendarBridge({ prisma });
    await bridge.syncCreditReminder({
      id: "wallet1",
      ownerId: OWNER,
      kind: "CREDIT",
      name: "BBVA Oro",
      paymentDueDay: 25,
      creditReminderEventId: null,
    });
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].sourceModule, "runly.pfm");
    assert.equal(state.events[0].recurrenceRule.byMonthDay, 25);
    assert.match(state.events[0].title, /Fecha limite de pago/);
    assert.equal(state.walletPatch.creditReminderEventId, "evtC");
  });
});
