// apps/api/src/services/__tests__/vision-service.test.js
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createVisionService, VisionServiceError } from "../vision-service.js";

const IMG = Buffer.from("fake-jpeg").toString("base64");

function groqBody(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ model: "test-model", choices: [{ message: { content } }] }),
    text: async () => "",
  };
}

describe("vision-service", () => {
  it("preserves an inventory text response when structured extraction fails, without changing receipt validation", async () => {
    const svc = createVisionService({ env: { GROQ_API_KEY: 'k' }, fetchImpl: async () => groqBody('Equipo DEMO\nS/N O0-I1-B8') });
    const result = await svc.extractInventory({ imageBase64: IMG });
    assert.equal(result.parsed.rawText, 'Equipo DEMO\nS/N O0-I1-B8');
    assert.deepEqual(result.parsed.observations, []); assert.equal(result.parsed.warnings.length, 1);
    await assert.rejects(svc.extractReceipt({ imageBase64: IMG }), /JSON legible/);
  });
  it("throws a 503 VisionServiceError when GROQ_API_KEY is not set", async () => {
    const svc = createVisionService({ env: { PFM_VISION_PROVIDER: "groq" } });
    await assert.rejects(
      () => svc.extractReceipt({ imageBase64: IMG, mimeType: "image/jpeg" }),
      (e) => e instanceof VisionServiceError && e.status === 503,
    );
  });

  it("parses a JSON receipt payload from the model response", async () => {
    const fetchMock = mock.fn(async () =>
      groqBody(
        JSON.stringify({
          merchant: "OXXO",
          total: 89.5,
          currency: "MXN",
          date: "2026-08-15",
          time: "14:32",
          taxAmount: 12.34,
          lines: [{ description: "Sabritas", amount: 20 }],
          confidence: 0.9,
        }),
      ),
    );
    const svc = createVisionService({
      env: { GROQ_API_KEY: "k", PFM_VISION_MODEL: "m" },
      fetchImpl: fetchMock,
    });
    const res = await svc.extractReceipt({ imageBase64: IMG, mimeType: "image/jpeg" });
    assert.equal(res.parsed.merchant, "OXXO");
    assert.equal(res.parsed.total, 89.5);
    assert.equal(res.parsed.currency, "MXN");
    assert.equal(res.parsed.time, "14:32");
    assert.equal(res.model, "test-model");
    assert.equal(fetchMock.mock.callCount(), 1);
    const [url, opts] = fetchMock.mock.calls[0].arguments;
    assert.match(url, /groq\.com/);
    assert.match(opts.headers.Authorization, /^Bearer /);
  });

  it("discards a malformed time value instead of storing garbage", async () => {
    const fetchMock = mock.fn(async () =>
      groqBody(
        JSON.stringify({
          merchant: "OXXO",
          total: 50,
          currency: "MXN",
          date: "2026-08-15",
          time: "2:32pm",
          taxAmount: null,
          lines: [],
          confidence: 0.5,
        }),
      ),
    );
    const svc = createVisionService({ env: { GROQ_API_KEY: "k" }, fetchImpl: fetchMock });
    const res = await svc.extractReceipt({ imageBase64: IMG, mimeType: "image/jpeg" });
    assert.equal(res.parsed.time, null);
  });

  it("tolerates a model that wraps JSON in prose / code fences", async () => {
    const fetchMock = mock.fn(async () =>
      groqBody(
        'Aqui esta:\n```json\n{"merchant":"Rappi","total":150,"currency":"MXN","date":null,"taxAmount":null,"lines":[],"confidence":0.7}\n```',
      ),
    );
    const svc = createVisionService({ env: { GROQ_API_KEY: "k" }, fetchImpl: fetchMock });
    const res = await svc.extractReceipt({ imageBase64: IMG, mimeType: "image/jpeg" });
    assert.equal(res.parsed.merchant, "Rappi");
    assert.equal(res.parsed.total, 150);
  });

  it("retries once on HTTP 429 then succeeds", async () => {
    let n = 0;
    const fetchMock = mock.fn(async () => {
      n += 1;
      if (n === 1)
        return { ok: false, status: 429, text: async () => "rate limited", json: async () => ({}) };
      return groqBody(
        '{"merchant":"CFE","total":540,"currency":"MXN","date":null,"taxAmount":null,"lines":[],"confidence":0.8}',
      );
    });
    const svc = createVisionService({
      env: { GROQ_API_KEY: "k", PFM_VISION_RETRY_DELAY_MS: "1" },
      fetchImpl: fetchMock,
    });
    const res = await svc.extractReceipt({ imageBase64: IMG, mimeType: "image/jpeg" });
    assert.equal(res.parsed.merchant, "CFE");
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  it("throws VisionServiceError when the response is not JSON at all", async () => {
    const fetchMock = mock.fn(async () => groqBody("no pude leer el ticket"));
    const svc = createVisionService({ env: { GROQ_API_KEY: "k" }, fetchImpl: fetchMock });
    await assert.rejects(
      () => svc.extractReceipt({ imageBase64: IMG, mimeType: "image/jpeg" }),
      (e) => e instanceof VisionServiceError,
    );
  });

  it("defaults to the current qwen vision model and sends reasoning_format hidden", async () => {
    const fetchMock = mock.fn(async () =>
      groqBody('{"merchant":null,"total":null,"currency":"MXN","date":null,"taxAmount":null,"lines":[],"confidence":null}'),
    );
    const svc = createVisionService({ env: { GROQ_API_KEY: "k" }, fetchImpl: fetchMock });
    await svc.extractReceipt({ imageBase64: IMG, mimeType: "image/jpeg" });
    const [, opts] = fetchMock.mock.calls[0].arguments;
    const body = JSON.parse(opts.body);
    assert.equal(body.model, "qwen/qwen3.6-27b");
    assert.equal(body.reasoning_format, "hidden");
  });

  it("does not send reasoning_format for a non-reasoning model override", async () => {
    const fetchMock = mock.fn(async () =>
      groqBody('{"merchant":null,"total":null,"currency":"MXN","date":null,"taxAmount":null,"lines":[],"confidence":null}'),
    );
    const svc = createVisionService({
      env: { GROQ_API_KEY: "k", PFM_VISION_MODEL: "meta-llama/llama-4-maverick-17b-128e-instruct" },
      fetchImpl: fetchMock,
    });
    await svc.extractReceipt({ imageBase64: IMG, mimeType: "image/jpeg" });
    const [, opts] = fetchMock.mock.calls[0].arguments;
    const body = JSON.parse(opts.body);
    assert.equal(body.reasoning_format, undefined);
  });

  it("surfaces the full model_not_found body so the UI can show the real cause", async () => {
    const detail = JSON.stringify({
      error: {
        message:
          "The model `meta-llama/llama-4-scout-17b-16e-instruct` does not exist or you do not have access to it.",
        type: "invalid_request_error",
        code: "model_not_found",
      },
    });
    const fetchMock = mock.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => detail,
      json: async () => ({}),
    }));
    const svc = createVisionService({ env: { GROQ_API_KEY: "k" }, fetchImpl: fetchMock });
    await assert.rejects(
      () => svc.extractReceipt({ imageBase64: IMG, mimeType: "image/jpeg" }),
      (e) => e instanceof VisionServiceError && e.status === 502 && e.message.includes("model_not_found"),
    );
  });
});
