import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFcmData, createFcmService, isPermanentFcmError } from "../fcm-service.js";

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
