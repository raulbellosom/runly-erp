import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildPushPayload,
  createWebPushService,
  isPermanentSubscriptionError,
} from "../web-push-service.js";
import { createNotificationDeliveryWorker } from "../notification-delivery-worker.js";

function createPrismaMock() {
  const rows = new Map();

  return {
    _rows: rows,
    instanceConfig: {
      findMany: async ({ where }) => {
        const keys = where?.key?.in ?? [];
        return keys
          .filter((key) => rows.has(key))
          .map((key) => ({ key, value: rows.get(key) }));
      },
      upsert: async ({ where, create, update }) => {
        const key = where.key;
        const value = rows.has(key) ? update.value : create.value;
        rows.set(key, value);
        return { key, value };
      },
      deleteMany: async ({ where }) => {
        const keys = where?.key?.in ?? [];
        let count = 0;
        for (const key of keys) {
          if (!rows.has(key)) continue;
          rows.delete(key);
          count += 1;
        }
        return { count };
      },
    },
  };
}

function createWebPushLibMock() {
  return {
    _vapid: null,
    _sent: [],
    generateVAPIDKeys: () => ({
      publicKey: "PUBLIC_FAKE",
      privateKey: "PRIVATE_FAKE",
    }),
    setVapidDetails(subject, publicKey, privateKey) {
      this._vapid = { subject, publicKey, privateKey };
    },
    async sendNotification(subscription, payload) {
      this._sent.push({ subscription, payload });
      return { statusCode: 201 };
    },
  };
}

describe("web-push-service", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-123456";
  });

  it("persists and reads VAPID config without exposing private key", async () => {
    const prisma = createPrismaMock();
    const webPushLib = createWebPushLibMock();
    const service = createWebPushService({ prisma, webPushLib });

    const saved = await service.saveVapidConfig({
      subject: "mailto:dev@atlas.dev",
      publicKey: "PUBLIC_1",
      privateKey: "PRIVATE_1",
    });
    assert.equal(saved.configured, true);
    assert.equal(saved.publicKey, "PUBLIC_1");

    const masked = await service.getVapidConfig();
    assert.equal(masked.configured, true);
    assert.equal(masked.subject, "mailto:dev@atlas.dev");
    assert.equal(masked.publicKey, "PUBLIC_1");
    assert.ok(!Object.hasOwn(masked, "privateKey"));

    const rawPrivate = prisma._rows.get("notifications.webpush.vapid.private_key");
    assert.notEqual(rawPrivate, "PRIVATE_1");
  });

  it("sends push payload when configured", async () => {
    const prisma = createPrismaMock();
    const webPushLib = createWebPushLibMock();
    const service = createWebPushService({ prisma, webPushLib });
    await service.saveVapidConfig({
      subject: "mailto:dev@atlas.dev",
      publicKey: "PUBLIC_2",
      privateKey: "PRIVATE_2",
    });

    const result = await service.sendToSubscription({
      subscription: {
        endpoint: "https://push.example/sub",
        keys: { p256dh: "abc", auth: "def" },
      },
      payload: { title: "Recordatorio", body: "Evento en 10 minutos" },
    });

    assert.equal(result.ok, true);
    assert.equal(webPushLib._sent.length, 1);
    assert.deepEqual(webPushLib._vapid, {
      subject: "mailto:dev@atlas.dev",
      publicKey: "PUBLIC_2",
      privateKey: "PRIVATE_2",
    });
  });

  it("marks permanent subscription errors for stale endpoints", async () => {
    const err410 = { statusCode: 410 };
    const err404 = { statusCode: 404 };
    const err500 = { statusCode: 500 };
    assert.equal(isPermanentSubscriptionError(err410), true);
    assert.equal(isPermanentSubscriptionError(err404), true);
    assert.equal(isPermanentSubscriptionError(err500), false);
  });

  it("builds fallback payload with deep link", () => {
    const payload = buildPushPayload({
      notification: {
        id: "n1",
        title: "Venta confirmada",
        body: "Pedido #10",
        eventType: "website.sale.confirmed",
        link: "/app/m/atlas.notifications",
      },
    });
    assert.equal(payload.title, "Venta confirmada");
    assert.equal(payload.data.notificationId, "n1");
    assert.equal(payload.data.link, "/app/m/atlas.notifications");
  });

  it("builds a stable incoming-call tag and forwards call metadata", () => {
    const payload = buildPushPayload({
      notification: {
        id: "n-call",
        title: "Raul",
        eventType: "chat.call.incoming",
        sourceId: "call-1",
        metadata: { callId: "call-1", kind: "VIDEO" },
      },
    });

    assert.equal(payload.tag, "call:call-1");
    assert.deepEqual(payload.data.metadata, { callId: "call-1", kind: "VIDEO" });
  });
});

describe("notification-delivery-worker web_push channel", () => {
  it("delivers to distinct endpoints even when their user agents are identical", async () => {
    const deliveries = [
      {
        id: "d1",
        attempts: 0,
        notification: {
          id: "n1",
          userId: "u1",
          title: "Aviso",
          body: "Hola",
          link: "/app",
          user: { email: "user@example.com" },
        },
      },
    ];
    const subscriptions = [
      { id: "s1", endpoint: "https://p1", p256dh: "a", auth: "b", userAgent: 'Same browser' },
      { id: "s2", endpoint: "https://p2", p256dh: "c", auth: "d", userAgent: 'Same browser' },
    ];
    const updates = [];
    const prisma = {
      userProfile: { findFirst: async ({ where }) => ({ id: where.id }) },
      notificationDelivery: {
        findMany: async () => deliveries,
        updateMany: async () => ({ count: 0 }),
        updateManyAndReturn: async () => {
          for (const d of deliveries) d.attempts = (d.attempts ?? 0) + 1;
          return deliveries.map((d) => ({ id: d.id }));
        },
        update: async ({ where, data }) => {
          updates.push({ where, data });
          return { id: where.id, ...data };
        },
      },
      pushSubscription: {
        findMany: async () => subscriptions,
        update: async () => ({}),
      },
    };
    const sentEndpoints = [];
    const worker = createNotificationDeliveryWorker({
      prisma,
      webPushService: {
        buildPushPayload: () => ({ title: "Aviso" }),
        sendToSubscription: async ({ subscription }) => { sentEndpoints.push(subscription.endpoint); return { ok: true }; },
      },
      smtpService: { sendEmail: async () => {} },
      maxAttempts: 3,
    });

    const result = await worker.processPendingNotificationDeliveries({
      channel: "web_push",
      limit: 10,
    });

    assert.equal(result.processed, 1);
    assert.deepEqual(sentEndpoints, ['https://p1', 'https://p2']);
    assert.equal(result.sent, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].data.status, "sent");
  });

  it("disables stale subscription on permanent failure", async () => {
    const deliveries = [
      {
        id: "d2",
        attempts: 0,
        notification: {
          id: "n2",
          userId: "u2",
          title: "Aviso",
          body: "Hola",
          link: "/app",
          user: { email: "user@example.com" },
        },
      },
    ];
    const disabled = [];
    const updates = [];
    const prisma = {
      userProfile: { findFirst: async ({ where }) => ({ id: where.id }) },
      notificationDelivery: {
        findMany: async () => deliveries,
        updateMany: async () => ({ count: 0 }),
        updateManyAndReturn: async () => {
          for (const d of deliveries) d.attempts = (d.attempts ?? 0) + 1;
          return deliveries.map((d) => ({ id: d.id }));
        },
        update: async ({ where, data }) => {
          updates.push({ where, data });
          return { id: where.id, ...data };
        },
      },
      pushSubscription: {
        findMany: async () => [
          { id: "s2", endpoint: "https://p2", p256dh: "a", auth: "b" },
        ],
        update: async ({ where, data }) => {
          disabled.push({ where, data });
          return { id: where.id, ...data };
        },
      },
    };
    const worker = createNotificationDeliveryWorker({
      prisma,
      webPushService: {
        buildPushPayload: () => ({ title: "Aviso" }),
        sendToSubscription: async () => ({
          ok: false,
          permanentFailure: true,
          error: "410 Gone",
        }),
      },
      smtpService: { sendEmail: async () => {} },
      maxAttempts: 1,
    });

    const result = await worker.processPendingNotificationDeliveries({
      channel: "web_push",
      limit: 10,
    });

    assert.equal(result.failed, 1);
    assert.equal(disabled.length, 1);
    assert.equal(disabled[0].where.id, "s2");
    assert.equal(disabled[0].data.enabled, false);
    assert.equal(updates[0].data.status, "failed");
  });
});
