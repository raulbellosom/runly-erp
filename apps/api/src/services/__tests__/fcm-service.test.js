import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFcmData, createFcmService, isPermanentFcmError } from "../fcm-service.js";
import { createNotificationDeliveryWorker } from "../notification-delivery-worker.js";

describe("fcm-service", () => {
  it("returns not-configured when no messaging client is available", async () => {
    const service = createFcmService({ messaging: null });
    const result = await service.sendToToken({ token: "tok-1", payload: { title: "Hola" } });
    assert.equal(result.ok, false);
    assert.match(result.error, /no configurado/);
  });

  it("sends via the injected messaging client", async () => {
    const sent = [];
    const service = createFcmService({
      messaging: { send: async (message) => { sent.push(message); } },
    });
    const result = await service.sendToToken({ token: "tok-2", payload: { title: "Hola" } });
    assert.equal(result.ok, true);
    assert.equal(sent[0].token, "tok-2");
    assert.deepEqual(sent[0].data, { title: "Hola" });
  });

  it("flags an unregistered token as a permanent failure", async () => {
    const service = createFcmService({
      messaging: { send: async () => { throw { code: "messaging/registration-token-not-registered" }; } },
    });
    const result = await service.sendToToken({ token: "tok-3", payload: { title: "Hola" } });
    assert.equal(result.ok, false);
    assert.equal(result.permanentFailure, true);
  });

  it("does not flag a transient error as permanent", async () => {
    const service = createFcmService({
      messaging: { send: async () => { throw { code: "messaging/internal-error" }; } },
    });
    const result = await service.sendToToken({ token: "tok-4", payload: { title: "Hola" } });
    assert.equal(result.ok, false);
    assert.equal(result.permanentFailure, false);
  });

  it("marks isPermanentFcmError true/false correctly", () => {
    assert.equal(isPermanentFcmError({ code: "messaging/invalid-registration-token" }), true);
    assert.equal(isPermanentFcmError({ code: "messaging/internal-error" }), false);
  });

  it("flags a mismatched-credential token/project error as permanent", () => {
    assert.equal(isPermanentFcmError({ code: "messaging/mismatched-credential" }), true);
  });

  it("builds string-only data payload with the incoming-call tag and callId", () => {
    const payload = buildFcmData({
      notification: {
        id: "n-call",
        title: "Raul",
        eventType: "chat.call.incoming",
        sourceId: "call-1",
        link: "/app/m/runly.chat/chat/inbox/conv-1",
      },
    });
    assert.equal(payload.tag, "call:call-1");
    assert.equal(payload.callId, "call-1");
    for (const value of Object.values(payload)) assert.equal(typeof value, "string");
  });
});

describe("notification-delivery-worker fcm channel", () => {
  function baseDelivery() {
    return {
      id: "d1",
      attempts: 0,
      notification: { id: "n1", userId: "u1", title: "Aviso", body: "Hola", link: "/app" },
    };
  }

  function basePrisma(deliveries, tokens) {
    return {
      userProfile: { findFirst: async ({ where }) => ({ id: where.id }) },
      notificationDelivery: {
        findMany: async () => deliveries,
        updateMany: async () => ({ count: 0 }),
        updateManyAndReturn: async () => {
          for (const d of deliveries) d.attempts = (d.attempts ?? 0) + 1;
          return deliveries.map((d) => ({ id: d.id }));
        },
        update: async ({ where, data }) => Object.assign(deliveries.find((d) => d.id === where.id), data),
      },
      fcmDeviceToken: {
        findMany: async () => tokens,
        update: async ({ where, data }) => {
          const t = tokens.find((tok) => tok.id === where.id);
          Object.assign(t, data);
          return t;
        },
      },
    };
  }

  it("sends to every active token and marks the delivery sent", async () => {
    const deliveries = [baseDelivery()];
    const tokens = [{ id: "t1", token: "tok-a" }, { id: "t2", token: "tok-b" }];
    const sentTokens = [];
    const worker = createNotificationDeliveryWorker({
      prisma: basePrisma(deliveries, tokens),
      smtpService: { sendEmail: async () => {} },
      fcmService: {
        buildFcmData: () => ({ title: "Aviso" }),
        sendToToken: async ({ token }) => { sentTokens.push(token); return { ok: true }; },
      },
      maxAttempts: 3,
    });

    const result = await worker.processPendingNotificationDeliveries({ channel: "fcm", limit: 10 });

    assert.deepEqual(sentTokens, ["tok-a", "tok-b"]);
    assert.equal(result.sent, 1);
    assert.equal(deliveries[0].status, "sent");
  });

  it("disables a token on permanent failure and still succeeds if another token works", async () => {
    const deliveries = [baseDelivery()];
    const tokens = [{ id: "t1", token: "tok-dead", enabled: true }, { id: "t2", token: "tok-ok", enabled: true }];
    const worker = createNotificationDeliveryWorker({
      prisma: basePrisma(deliveries, tokens),
      smtpService: { sendEmail: async () => {} },
      fcmService: {
        buildFcmData: () => ({ title: "Aviso" }),
        sendToToken: async ({ token }) =>
          token === "tok-dead"
            ? { ok: false, permanentFailure: true, error: "not-registered" }
            : { ok: true },
      },
      maxAttempts: 3,
    });

    const result = await worker.processPendingNotificationDeliveries({ channel: "fcm", limit: 10 });

    assert.equal(result.sent, 1);
    assert.equal(tokens[0].enabled, false);
    assert.equal(tokens[1].enabled, true);
  });

  it("fails the delivery when the recipient has no active tokens", async () => {
    const deliveries = [baseDelivery()];
    const worker = createNotificationDeliveryWorker({
      prisma: basePrisma(deliveries, []),
      smtpService: { sendEmail: async () => {} },
      fcmService: { buildFcmData: () => ({}), sendToToken: async () => ({ ok: true }) },
      maxAttempts: 1,
    });

    const result = await worker.processPendingNotificationDeliveries({ channel: "fcm", limit: 10 });

    assert.equal(result.failed, 1);
    assert.equal(deliveries[0].status, "failed");
  });
});
