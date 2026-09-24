// apps/api/src/routes/chat/__tests__/mirai-tts-service.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createMiraiTtsService } from "../mirai-tts-service.js";
import { ChatServiceError } from "../chat-service-error.js";

test("isConfigured() is false without MIRAI_TTS_URL", () => {
  const svc = createMiraiTtsService({ env: {} });
  assert.equal(svc.isConfigured(), false);
});

test("synthesize() throws 503 when not configured, without calling fetch", async () => {
  let called = false;
  const svc = createMiraiTtsService({ env: {}, fetchImpl: async () => { called = true; } });
  await assert.rejects(
    svc.synthesize("hola"),
    (e) => e instanceof ChatServiceError && e.status === 503,
  );
  assert.equal(called, false);
});

test("synthesize() rejects empty text (400) without calling fetch", async () => {
  let called = false;
  const svc = createMiraiTtsService({
    env: { MIRAI_TTS_URL: "http://runly-tts:8090" },
    fetchImpl: async () => { called = true; },
  });
  await assert.rejects(
    svc.synthesize("   "),
    (e) => e instanceof ChatServiceError && e.status === 400,
  );
  assert.equal(called, false);
});

test("synthesize() rejects text over the length cap (400) without calling fetch", async () => {
  let called = false;
  const svc = createMiraiTtsService({
    env: { MIRAI_TTS_URL: "http://runly-tts:8090" },
    fetchImpl: async () => { called = true; },
  });
  await assert.rejects(
    svc.synthesize("a".repeat(2001)),
    (e) => e instanceof ChatServiceError && e.status === 400,
  );
  assert.equal(called, false);
});

test("synthesize() posts trimmed text to <MIRAI_TTS_URL>/synthesize and returns the audio buffer", async () => {
  let requestUrl;
  let requestBody;
  const audio = new Uint8Array([9, 9, 9]);
  const svc = createMiraiTtsService({
    env: { MIRAI_TTS_URL: "http://runly-tts:8090/" }, // trailing slash must not double up
    fetchImpl: async (url, opts) => {
      requestUrl = url;
      requestBody = JSON.parse(opts.body);
      return {
        ok: true,
        headers: new Map([["content-type", "audio/wav"]]),
        arrayBuffer: async () => audio.buffer,
      };
    },
  });
  const out = await svc.synthesize("  hola mundo  ");
  assert.equal(requestUrl, "http://runly-tts:8090/synthesize");
  assert.equal(requestBody.text, "hola mundo");
  assert.equal(out.contentType, "audio/wav");
  assert.deepEqual(new Uint8Array(out.buffer), audio);
});

test("synthesize() maps a non-ok response to a 502 ChatServiceError", async () => {
  const svc = createMiraiTtsService({
    env: { MIRAI_TTS_URL: "http://runly-tts:8090" },
    fetchImpl: async () => ({ ok: false, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) }),
  });
  await assert.rejects(
    svc.synthesize("hola"),
    (e) => e instanceof ChatServiceError && e.status === 502,
  );
});

test("synthesize() maps a network failure (e.g. container down) to a 502 ChatServiceError", async () => {
  const svc = createMiraiTtsService({
    env: { MIRAI_TTS_URL: "http://runly-tts:8090" },
    fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
  });
  await assert.rejects(
    svc.synthesize("hola"),
    (e) => e instanceof ChatServiceError && e.status === 502,
  );
});
