import assert from "node:assert/strict";
import { test } from "node:test";

import { createGrowthPropertyHealthWorker } from "../growth-property-health-worker.js";

const COMPANY_ID = "11111111-1111-7111-8111-111111111111";
const USER_ID = "22222222-2222-7222-8222-222222222222";
const NOW = new Date("2026-09-22T12:00:00.000Z");

function createPrismaStub({ properties, events = [] }) {
  return {
    growthProperty: {
      findMany: async ({ where }) => properties.filter((p) => p.status === where.status),
      update: async ({ where, data }) => {
        const property = properties.find((p) => p.id === where.id);
        Object.assign(property, data);
        return property;
      },
    },
    growthEvent: {
      findFirst: async ({ where }) => {
        const matches = events
          .filter((e) => e.siteId === where.siteId)
          .sort((a, b) => b.serverReceivedAt - a.serverReceivedAt);
        return matches[0] ?? null;
      },
    },
    membership: {
      findMany: async () => [
        {
          userId: USER_ID,
          role: {
            enabled: true,
            key: "runly.admin",
            permissions: [],
          },
        },
      ],
    },
  };
}

test("flags a stale active property as inactive and notifies managers once", async () => {
  const property = {
    id: "prop-1",
    companyId: COMPANY_ID,
    name: "Runly MX",
    domain: "runly.mx",
    status: "active",
    enabled: true,
    verifiedAt: new Date("2026-09-01T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  };
  const events = [
    { siteId: "prop-1", serverReceivedAt: new Date("2026-09-15T00:00:00.000Z") },
  ];
  const published = [];
  const worker = createGrowthPropertyHealthWorker({
    prisma: createPrismaStub({ properties: [property], events }),
    notificationService: { publish: async (input) => { published.push(input); } },
    now: () => NOW,
    inactivityHours: 48,
  });

  const result = await worker.runOnce();

  assert.equal(result.flaggedInactive, 1);
  assert.equal(property.status, "inactive");
  assert.equal(published.length, 1);
  assert.equal(published[0].input.eventType, "growth.property.inactive");
  assert.deepEqual(published[0].input.recipients.userIds, [USER_ID]);
});

test("does not re-flag a property that's already inactive", async () => {
  const property = {
    id: "prop-2",
    companyId: COMPANY_ID,
    name: "Old Site",
    domain: null,
    status: "inactive",
    enabled: true,
    verifiedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const published = [];
  const worker = createGrowthPropertyHealthWorker({
    prisma: createPrismaStub({ properties: [property], events: [] }),
    notificationService: { publish: async (input) => { published.push(input); } },
    now: () => NOW,
    inactivityHours: 48,
  });

  const result = await worker.runOnce();

  assert.equal(result.flaggedInactive, 0);
  assert.equal(published.length, 0);
});

test("recovers an inactive property back to active once fresh events arrive", async () => {
  const property = {
    id: "prop-3",
    companyId: COMPANY_ID,
    name: "Recovering Site",
    domain: "recovering.test",
    status: "inactive",
    enabled: true,
    verifiedAt: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  };
  const events = [
    { siteId: "prop-3", serverReceivedAt: new Date("2026-09-22T11:00:00.000Z") },
  ];
  const worker = createGrowthPropertyHealthWorker({
    prisma: createPrismaStub({ properties: [property], events }),
    notificationService: null,
    now: () => NOW,
    inactivityHours: 48,
  });

  const result = await worker.runOnce();

  assert.equal(result.recovered, 1);
  assert.equal(property.status, "active");
});
