// apps/api/src/services/ai/ai-client.js
//
// Generic OpenAI-compatible chat-completions transport, shared by every AI
// task in Runly. Groq and local Ollama speak the same wire format, so one
// function handles both — the caller (ai-router.js) supplies baseUrl/apiPath/
// apiKey per provider. It consolidates the retry/transport pattern common to
// all 6 services it unifies; `reasoning_effort` is an explicit per-caller
// opt-in (via the `reasoningEffort` param) that preserves each service's own
// prior behavior, rather than being extracted verbatim from any single one.
// Retries once on 429/5xx or a network error; throws AiClientError
// otherwise. Domain error classes (ChatServiceError, PfmServiceError,
// VisionServiceError, ...) are NOT thrown here — each service's own
// callGroq*-style wrapper translates AiClientError into its own error type,
// exactly as it did with the raw fetch it replaces.
import { isReasoningModel } from "../groq-model-helpers.js";

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_RETRY_DELAY_MS = 1200;
const DEFAULT_MAX_ATTEMPTS = 2;

export class AiClientError extends Error {
  constructor(message, { status = 502, retryAfterMs = null } = {}) {
    super(message);
    this.name = "AiClientError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export async function chatComplete({
  provider,
  baseUrl,
  apiPath,
  apiKey,
  model,
  messages,
  tools,
  toolChoice,
  temperature = 0.2,
  maxTokens = 1000,
  jsonMode = false,
  reasoningEffort,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  respectRateLimit = false,
  fetchImpl,
}) {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  const body = {
    model,
    temperature,
    max_tokens: maxTokens,
    ...(tools ? { tools, tool_choice: toolChoice ?? "auto" } : {}),
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    ...(isReasoningModel(model) ? { reasoning_format: "hidden", ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) } : {}),
    messages,
  };
  let lastErr;
  let delay = retryDelayMs;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, delay));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchFn(`${baseUrl}${apiPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      lastErr = new AiClientError(`No se pudo contactar al proveedor de IA (${provider}): ${err.message}`, { status: 502 });
      clearTimeout(timer);
      continue;
    }
    clearTimeout(timer);
    if (res.status === 429 || res.status >= 500) {
      let retryAfterMs = null;
      if (respectRateLimit && res.status === 429) {
        const retrySeconds = Number(res.headers.get("retry-after"));
        if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
          retryAfterMs = Math.min(30_000, Math.max(15_000, retrySeconds * 1000 + 5000));
          delay = retryAfterMs;
        }
      }
      lastErr = new AiClientError(`${provider} respondio ${res.status}`, { status: res.status === 429 ? 429 : 502, retryAfterMs });
      continue;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AiClientError(`${provider} rechazo la peticion (${res.status}): ${detail.slice(0, 300)}`, { status: 502 });
    }
    const payload = await res.json();
    const message = payload?.choices?.[0]?.message ?? null;
    return { message, model: payload?.model ?? model, provider, usage: payload?.usage ?? null };
  }
  throw lastErr ?? new AiClientError(`${provider} no respondio`, { status: 502 });
}
