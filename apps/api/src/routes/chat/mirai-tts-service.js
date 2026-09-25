// apps/api/src/routes/chat/mirai-tts-service.js
//
// "Leer en voz alta" — converts already-generated MirAI reply text to speech
// via the internal `runly-tts` container (apps/tts/main.py, Piper). No new
// permission: whatever already gates seeing the text (chat.mirai.use) also
// gates hearing it, same as copying a message to the clipboard doesn't need
// its own permission either. No persistence — audio is regenerated on every
// click; Piper's own PoC (scripts/poc-piper/RESULTS.md) measured ~0.5s of
// CPU per short reply on the real production VPS, so caching would be
// solving a cost that doesn't exist.
//
// Optional infra, same shape as Tavily/GROQ: MIRAI_TTS_URL unset => 503, UI
// simply doesn't offer the button (mirrors GET /chat/mirai/status).

import { ChatServiceError } from "./chat-service-error.js";

// Piper synthesizes ~17.8 chars of text per second of audio (see
// scripts/poc-piper/synth_test.py's SAMPLE_TEXT: 143 chars -> 8.03s audio).
// A flat 10s timeout was tuned against the idle-VPS realtime factor
// (0.069x, scripts/poc-piper/RESULTS.md "tercera ronda") but that doc's own
// "Lo que falta" section flags CPU contention (a live LiveKit call and/or
// the transcriber running at the same time) as untested. The dev-machine
// run under an artificial CPU limit — the closest proxy we have for a busy
// production box — saw a 0.282x factor instead, ~4x worse; MS_PER_CHAR
// below bakes that factor in plus headroom, so a near-MAX_TEXT_CHARS
// request under real contention still has time to finish instead of
// aborting into a 502.
const MIN_TIMEOUT_MS = 10_000;
const MS_PER_CHAR = 30;
const MAX_TEXT_CHARS = 2000;

export function createMiraiTtsService({ env = process.env, fetchImpl } = {}) {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  const baseUrl = (env.MIRAI_TTS_URL || "").replace(/\/$/, "");

  function isConfigured() {
    return Boolean(baseUrl);
  }

  async function synthesize(text) {
    if (!isConfigured()) throw new ChatServiceError("La lectura en voz alta no está configurada.", 503);
    const trimmed = String(text ?? "").trim();
    if (!trimmed) throw new ChatServiceError("No hay texto para leer.", 400);
    if (trimmed.length > MAX_TEXT_CHARS) {
      throw new ChatServiceError(`El texto es demasiado largo (máximo ${MAX_TEXT_CHARS} caracteres).`, 400);
    }

    const timeoutMs = Math.max(MIN_TIMEOUT_MS, trimmed.length * MS_PER_CHAR);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchFn(`${baseUrl}/synthesize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ChatServiceError("No se pudo generar el audio, intenta de nuevo.", 502);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new ChatServiceError("No se pudo generar el audio, intenta de nuevo.", 502);
    }
    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType: response.headers.get("content-type") || "audio/wav" };
  }

  return { isConfigured, synthesize };
}
