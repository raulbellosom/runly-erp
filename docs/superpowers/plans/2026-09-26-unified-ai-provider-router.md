# Unified AI Provider Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Date: 2026-09-26
Spec: docs/superpowers/specs/2026-09-26-unified-ai-provider-router-design.md
Status: Draft

> Declare `Mode: IMPLEMENTATION` before starting. Do not begin coding until the spec is approved and this plan is approved. Mark each task completed only after its validation commands pass.

**Goal:** Replace the 6 duplicated Groq-calling code paths with one shared HTTP client + deterministic router, and let any instance opt into alternating between local Ollama (qwen3:4b/8b) and Groq per task, with vision always forced to Groq and automatic fallback if Ollama is unreachable.

**Architecture:** Four new files under `apps/api/src/services/ai/` — `ai-providers.js` (env → provider connection config), `ai-task-profiles.js` (fixed task → weight/localCapable/model-override table), `ai-client.js` (generic OpenAI-compatible chat-completions transport with retry), `ai-router.js` (resolves provider/model per task, calls the client, falls back to Groq + opens a circuit breaker on repeated local failures). Each of the 6 existing services keeps its own `callGroq*` wrapper function and its own domain error class (`ChatServiceError`, `PfmServiceError`, etc.) — only the body of that wrapper changes, from a raw `fetch` loop to a call to `aiRouter.runTask()`. This is a refactor of code already covered by tests, so migration tasks are not TDD (write-test-first) — they change the implementation and then run the *existing* test suite as the regression safety net, per spec §26.

**Tech Stack:** Plain Node.js (no TypeScript), `node:test` + `node:assert/strict`, Hono (untouched by this plan), the existing `fetchImpl` dependency-injection pattern already used by all 6 services.

---

## File Structure Map

### Create

- `apps/api/src/services/ai/ai-providers.js`
- `apps/api/src/services/ai/ai-task-profiles.js`
- `apps/api/src/services/ai/ai-client.js`
- `apps/api/src/services/ai/ai-router.js`
- `apps/api/src/services/ai/__tests__/ai-providers.test.js`
- `apps/api/src/services/ai/__tests__/ai-client.test.js`
- `apps/api/src/services/ai/__tests__/ai-router.test.js`

### Modify

- `apps/api/src/routes/chat/mirai-service.js` — `callGroqRaw` delegates to the router; `isConfigured()` accounts for local mode.
- `apps/api/src/routes/help/help-assistant-service.js` — `callGroq` delegates to the router; `isConfigured()` accounts for local mode.
- `apps/api/src/routes/pfm/assistant-service.js` — `callGroq` delegates to the router; `isConfigured()` accounts for local mode.
- `apps/api/src/services/vision-service.js` — `call`/`describe` delegate to the router (always resolves to Groq; no `isConfigured()` change — vision stays Groq-only).
- `apps/api/src/routes/calls/call-transcript-analysis-service.js` — `callGroq` delegates to the router; inline `GROQ_API_KEY` gate accounts for local mode.
- `apps/api/src/routes/ledger/ai-import-extraction.js` — `callGroqText` delegates to the router; inline `GROQ_API_KEY` gate accounts for local mode.
- `infra/installer/setup-local.mjs`, `infra/installer/setup-external.mjs` — optional prompts for `AI_LOCAL_ENABLED`/`OLLAMA_*`.
- `infra/installer/.env.local.example`, `infra/installer/.env.external.example` — document the new vars, default disabled.
- `CLAUDE.md` — extend the `GROQ_API_KEY` paragraph in Commands to mention local/Ollama alternation.

---

## Task 1 — `ai-providers.js`: resolve provider connection config from env

**Files:**
- Create: `apps/api/src/services/ai/ai-providers.js`
- Test: `apps/api/src/services/ai/__tests__/ai-providers.test.js`

**Changes:** One function that reads `env` once and returns both providers' connection details (baseUrl, apiKey, wire path) plus whether local routing is turned on. Every other new file gets its env-reading from here — nobody else touches `process.env.GROQ_*`/`OLLAMA_*` directly.

- [ ] **Step 1: Write the failing test**

```js
// apps/api/src/services/ai/__tests__/ai-providers.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveProviders, isLocalEnabled } from '../ai-providers.js'

describe('ai-providers', () => {
  it('defaults: Groq from GROQ_API_KEY/GROQ_BASE_URL, local disabled', () => {
    const p = resolveProviders({ GROQ_API_KEY: 'gk', GROQ_BASE_URL: 'https://api.groq.com/' })
    assert.equal(p.groq.apiKey, 'gk')
    assert.equal(p.groq.baseUrl, 'https://api.groq.com')
    assert.equal(p.groq.apiPath, '/openai/v1/chat/completions')
    assert.equal(p.ollama.enabled, false)
  })

  it('GROQ_BASE_URL missing falls back to https://api.groq.com', () => {
    const p = resolveProviders({ GROQ_API_KEY: 'gk' })
    assert.equal(p.groq.baseUrl, 'https://api.groq.com')
  })

  it('AI_LOCAL_ENABLED=true turns on ollama with defaults', () => {
    const p = resolveProviders({ AI_LOCAL_ENABLED: 'true' })
    assert.equal(p.ollama.enabled, true)
    assert.equal(p.ollama.baseUrl, 'http://localhost:11434')
    assert.equal(p.ollama.apiPath, '/v1/chat/completions')
    assert.equal(p.ollama.modelLight, 'qwen3:4b')
    assert.equal(p.ollama.modelHeavy, 'qwen3:8b')
    assert.equal(p.ollama.apiKey, null)
  })

  it('OLLAMA_* overrides replace the defaults', () => {
    const p = resolveProviders({
      AI_LOCAL_ENABLED: 'true',
      OLLAMA_BASE_URL: 'http://gpu-box:11434/',
      OLLAMA_MODEL_LIGHT: 'qwen3:1.7b',
      OLLAMA_MODEL_HEAVY: 'qwen3:14b',
    })
    assert.equal(p.ollama.baseUrl, 'http://gpu-box:11434')
    assert.equal(p.ollama.modelLight, 'qwen3:1.7b')
    assert.equal(p.ollama.modelHeavy, 'qwen3:14b')
  })

  it('isLocalEnabled reflects AI_LOCAL_ENABLED case-insensitively, default false', () => {
    assert.equal(isLocalEnabled({}), false)
    assert.equal(isLocalEnabled({ AI_LOCAL_ENABLED: 'false' }), false)
    assert.equal(isLocalEnabled({ AI_LOCAL_ENABLED: 'TRUE' }), true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/api/src/services/ai/__tests__/ai-providers.test.js`
Expected: FAIL — `Cannot find module '../ai-providers.js'`

- [ ] **Step 3: Write the implementation**

```js
// apps/api/src/services/ai/ai-providers.js
//
// Single place that reads env for AI provider connection details. Every
// other file under services/ai/ gets its config from here instead of
// reading process.env.GROQ_*/OLLAMA_* itself.
export function isLocalEnabled(env) {
  return String(env.AI_LOCAL_ENABLED ?? "false").toLowerCase() === "true";
}

export function resolveProviders(env) {
  return {
    groq: {
      baseUrl: (env.GROQ_BASE_URL || "https://api.groq.com").replace(/\/$/, ""),
      apiKey: env.GROQ_API_KEY || null,
      apiPath: "/openai/v1/chat/completions",
    },
    ollama: {
      enabled: isLocalEnabled(env),
      baseUrl: (env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, ""),
      apiKey: null,
      apiPath: "/v1/chat/completions",
      modelLight: env.OLLAMA_MODEL_LIGHT || "qwen3:4b",
      modelHeavy: env.OLLAMA_MODEL_HEAVY || "qwen3:8b",
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/src/services/ai/__tests__/ai-providers.test.js`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/ai/ai-providers.js apps/api/src/services/ai/__tests__/ai-providers.test.js
git commit -m "feat(ai): add ai-providers.js — resolve Groq/Ollama connection config from env"
```

---

## Task 2 — `ai-task-profiles.js`: the fixed task registry

**Files:**
- Create: `apps/api/src/services/ai/ai-task-profiles.js`
- Test: covered by `ai-router.test.js` in Task 4 (this file is a pure data table; no standalone test file needed — YAGNI).

**Changes:** The table from spec §5 (task profile table), verbatim. `envOverrideVar` may be a string or an array (checked in order) to preserve `transcript_analysis`'s existing two-level fallback (`CHAT_TRANSCRIPT_ANALYSIS_MODEL` then `CHAT_MIRAI_MODEL`). `envBaseUrlOverrideVar` is only set for `ledger_import_text`, preserving the existing `LEDGER_IMPORT_BASE_URL` override.

- [ ] **Step 1: Write the file**

```js
// apps/api/src/services/ai/ai-task-profiles.js
//
// Fixed task -> routing profile table (spec: docs/superpowers/specs/
// 2026-09-26-unified-ai-provider-router-design.md §5). Not configurable at
// runtime by design (spec non-goal 1) — adding a new AI-backed task means
// adding a new entry here, in code, reviewed like any other change.
//
// weight: "light" -> OLLAMA_MODEL_LIGHT (qwen3:4b) when routed locally.
//         "heavy" -> OLLAMA_MODEL_HEAVY (qwen3:8b) when routed locally.
// localCapable: false always resolves to Groq, regardless of AI_LOCAL_ENABLED
//   (vision tasks, and mirai_web's Tavily/compound live-search turn — see
//   spec non-goal 3).
// envOverrideVar: existing per-task Groq model override env var(s), checked
//   in order. Setting one always forces Groq with that model (explicit
//   operator choice wins over automatic local routing — spec edge case 4).
// envBaseUrlOverrideVar: only ledger_import_text has a pre-existing custom
//   Groq base URL override (LEDGER_IMPORT_BASE_URL); every other task uses
//   the shared GROQ_BASE_URL from ai-providers.js.
export const TASK_PROFILES = {
  mirai_classify: {
    weight: "light",
    localCapable: true,
    envOverrideVar: "CHAT_MIRAI_ROUTER_MODEL",
    groqDefaultModel: "openai/gpt-oss-120b",
  },
  mirai_chat: {
    weight: "heavy",
    localCapable: true,
    envOverrideVar: "CHAT_MIRAI_MODEL",
    groqDefaultModel: "openai/gpt-oss-120b",
  },
  mirai_web: {
    weight: "heavy",
    localCapable: false,
    envOverrideVar: "CHAT_MIRAI_WEB_MODEL",
    groqDefaultModel: "groq/compound-mini",
  },
  help_assistant: {
    weight: "light",
    localCapable: true,
    envOverrideVar: "HELP_ASSISTANT_MODEL",
    groqDefaultModel: "openai/gpt-oss-120b",
  },
  pfm_assistant: {
    weight: "heavy",
    localCapable: true,
    envOverrideVar: "PFM_ASSISTANT_MODEL",
    groqDefaultModel: "openai/gpt-oss-120b",
  },
  pfm_vision: {
    weight: "heavy",
    localCapable: false,
    envOverrideVar: "PFM_VISION_MODEL",
    groqDefaultModel: "qwen/qwen3.8-27b",
  },
  transcript_analysis: {
    weight: "heavy",
    localCapable: true,
    envOverrideVar: ["CHAT_TRANSCRIPT_ANALYSIS_MODEL", "CHAT_MIRAI_MODEL"],
    groqDefaultModel: "openai/gpt-oss-120b",
  },
  ledger_import_text: {
    weight: "heavy",
    localCapable: true,
    envOverrideVar: "LEDGER_IMPORT_MODEL",
    envBaseUrlOverrideVar: "LEDGER_IMPORT_BASE_URL",
    groqDefaultModel: "openai/gpt-oss-120b",
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/services/ai/ai-task-profiles.js
git commit -m "feat(ai): add ai-task-profiles.js — fixed task/routing table"
```

---

## Task 3 — `ai-client.js`: generic chat-completions transport

**Files:**
- Create: `apps/api/src/services/ai/ai-client.js`
- Test: `apps/api/src/services/ai/__tests__/ai-client.test.js`

**Changes:** One `chatComplete()` function, extracted near-verbatim from `mirai-service.js`'s `callGroqRaw` (the most complete existing implementation — it already has `respectRateLimit`). Provider-agnostic: takes `baseUrl`/`apiPath`/`apiKey` instead of assuming Groq. Throws `AiClientError` (generic) instead of any service's domain error class.

- [ ] **Step 1: Write the failing tests**

```js
// apps/api/src/services/ai/__tests__/ai-client.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chatComplete, AiClientError } from '../ai-client.js'

const OK = (body) => async () => ({ ok: true, status: 200, json: async () => body, text: async () => '', headers: new Map() })

function baseArgs(overrides = {}) {
  return {
    provider: 'groq',
    baseUrl: 'https://api.groq.com',
    apiPath: '/openai/v1/chat/completions',
    apiKey: 'gk',
    model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: 'hola' }],
    ...overrides,
  }
}

describe('ai-client chatComplete', () => {
  it('posts to baseUrl+apiPath with Authorization when apiKey is set, returns the message', async () => {
    let seenUrl, seenHeaders, seenBody
    const fetchImpl = async (url, opts) => {
      seenUrl = url; seenHeaders = opts.headers; seenBody = JSON.parse(opts.body)
      return { ok: true, status: 200, json: async () => ({ model: 'openai/gpt-oss-120b', choices: [{ message: { role: 'assistant', content: 'hola de vuelta' } }] }) }
    }
    const result = await chatComplete(baseArgs({ fetchImpl }))
    assert.equal(seenUrl, 'https://api.groq.com/openai/v1/chat/completions')
    assert.equal(seenHeaders.Authorization, 'Bearer gk')
    assert.equal(seenBody.model, 'openai/gpt-oss-120b')
    assert.equal(result.message.content, 'hola de vuelta')
    assert.equal(result.provider, 'groq')
    assert.equal(result.model, 'openai/gpt-oss-120b')
  })

  it('omits Authorization header when apiKey is null (ollama)', async () => {
    let seenHeaders
    const fetchImpl = async (url, opts) => { seenHeaders = opts.headers; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) } }
    await chatComplete(baseArgs({ provider: 'ollama', apiKey: null, apiPath: '/v1/chat/completions', baseUrl: 'http://localhost:11434', fetchImpl }))
    assert.equal('Authorization' in seenHeaders, false)
  })

  it('sets reasoning_format hidden for a reasoning model', async () => {
    let seenBody
    const fetchImpl = async (url, opts) => { seenBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) } }
    await chatComplete(baseArgs({ model: 'qwen/qwen3.8-27b', fetchImpl }))
    assert.equal(seenBody.reasoning_format, 'hidden')
  })

  it('sets response_format json_object when jsonMode is true', async () => {
    let seenBody
    const fetchImpl = async (url, opts) => { seenBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{}' } }] }) } }
    await chatComplete(baseArgs({ jsonMode: true, fetchImpl }))
    assert.deepEqual(seenBody.response_format, { type: 'json_object' })
  })

  it('retries once on a network error, then succeeds', async () => {
    let attempts = 0
    const fetchImpl = async () => {
      attempts += 1
      if (attempts === 1) throw new Error('ECONNREFUSED')
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }
    }
    const result = await chatComplete(baseArgs({ fetchImpl, retryDelayMs: 1 }))
    assert.equal(attempts, 2)
    assert.equal(result.message.content, 'ok')
  })

  it('throws AiClientError after exhausting retries on a persistent 500', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' })
    await assert.rejects(
      () => chatComplete(baseArgs({ fetchImpl, retryDelayMs: 1 })),
      (err) => err instanceof AiClientError && err.status === 502,
    )
  })

  it('throws AiClientError immediately on a non-retryable 4xx (no retry attempted)', async () => {
    let attempts = 0
    const fetchImpl = async () => { attempts += 1; return { ok: false, status: 400, json: async () => ({}), text: async () => 'bad request' } }
    await assert.rejects(() => chatComplete(baseArgs({ fetchImpl })), AiClientError)
    assert.equal(attempts, 1)
  })

  it('respectRateLimit widens the retry delay from Retry-After on a 429, still retries', async () => {
    let attempts = 0
    const fetchImpl = async () => {
      attempts += 1
      if (attempts === 1) return { ok: false, status: 429, json: async () => ({}), text: async () => '', headers: { get: (k) => (k === 'retry-after' ? '20' : null) } }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }
    }
    const result = await chatComplete(baseArgs({ fetchImpl, respectRateLimit: true, retryDelayMs: 1 }))
    assert.equal(result.message.content, 'ok')
    assert.equal(attempts, 2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/api/src/services/ai/__tests__/ai-client.test.js`
Expected: FAIL — `Cannot find module '../ai-client.js'`

- [ ] **Step 3: Write the implementation**

```js
// apps/api/src/services/ai/ai-client.js
//
// Generic OpenAI-compatible chat-completions transport, shared by every AI
// task in Runly. Groq and local Ollama speak the same wire format, so one
// function handles both — the caller (ai-router.js) supplies baseUrl/apiPath/
// apiKey per provider. Retries once on 429/5xx or a network error; throws
// AiClientError otherwise. Domain error classes (ChatServiceError,
// PfmServiceError, VisionServiceError, ...) are NOT thrown here — each
// service's own callGroq*-style wrapper translates AiClientError into its
// own error type, exactly as it did with the raw fetch it replaces.
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
    ...(isReasoningModel(model) ? { reasoning_format: "hidden", reasoning_effort: "low" } : {}),
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/api/src/services/ai/__tests__/ai-client.test.js`
Expected: PASS (7/7)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/ai/ai-client.js apps/api/src/services/ai/__tests__/ai-client.test.js
git commit -m "feat(ai): add ai-client.js — generic OpenAI-compatible chat-completions transport"
```

---

## Task 4 — `ai-router.js`: routing rules, fallback, circuit breaker

**Files:**
- Create: `apps/api/src/services/ai/ai-router.js`
- Test: `apps/api/src/services/ai/__tests__/ai-router.test.js`

**Changes:** `createAiRouter({ env, fetchImpl })` returns `{ runTask }`. `runTask` resolves provider/model per spec §5/§2 rules, calls `chatComplete`, and — only for an Ollama attempt — catches any failure (transport error, or `validateResponse` rejecting the content), records it in a 3-strikes/60s circuit breaker, and retries once against Groq's default model for that task. `runTask` also accepts a `reasoningEffort` param and forwards it straight through to `chatComplete` unchanged — Task 3's code review caught that `chatComplete` had originally hardcoded `reasoning_effort: "low"` for every reasoning model (a regression for the 3 of 6 services that never sent it), so it's now opt-in per caller; `ai-router.js` must not silently drop it.

- [ ] **Step 1: Write the failing tests**

```js
// apps/api/src/services/ai/__tests__/ai-router.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createAiRouter } from '../ai-router.js'

const groqOk = (content) => async (url) => ({
  ok: true, status: 200,
  json: async () => ({ model: 'openai/gpt-oss-120b', choices: [{ message: { content } }] }),
})

describe('ai-router resolution rules', () => {
  it('AI_LOCAL_ENABLED unset -> always Groq, with the task groqDefaultModel', async () => {
    let seenUrl
    const fetchImpl = async (url) => { seenUrl = url; return groqOk('ok')(url) }
    const router = createAiRouter({ env: { GROQ_API_KEY: 'gk' }, fetchImpl })
    const result = await router.runTask({ task: 'mirai_classify', messages: [{ role: 'user', content: 'hola' }] })
    assert.match(seenUrl, /api\.groq\.com/)
    assert.equal(result.provider, 'groq')
  })

  it('AI_LOCAL_ENABLED=true + light task -> Ollama with OLLAMA_MODEL_LIGHT', async () => {
    let seenUrl, seenBody
    const fetchImpl = async (url, opts) => { seenUrl = url; seenBody = JSON.parse(opts.body); return groqOk('ok')(url) }
    const router = createAiRouter({ env: { AI_LOCAL_ENABLED: 'true' }, fetchImpl })
    const result = await router.runTask({ task: 'mirai_classify', messages: [{ role: 'user', content: 'hola' }] })
    assert.match(seenUrl, /localhost:11434/)
    assert.equal(seenBody.model, 'qwen3:4b')
    assert.equal(result.provider, 'ollama')
  })

  it('AI_LOCAL_ENABLED=true + heavy task -> Ollama with OLLAMA_MODEL_HEAVY', async () => {
    let seenBody
    const fetchImpl = async (url, opts) => { seenBody = JSON.parse(opts.body); return groqOk('ok')(url) }
    const router = createAiRouter({ env: { AI_LOCAL_ENABLED: 'true' }, fetchImpl })
    await router.runTask({ task: 'mirai_chat', messages: [{ role: 'user', content: 'hola' }] })
    assert.equal(seenBody.model, 'qwen3:8b')
  })

  it('a vision task (localCapable:false) always resolves to Groq even with AI_LOCAL_ENABLED=true', async () => {
    let seenUrl
    const fetchImpl = async (url) => { seenUrl = url; return groqOk('ok')(url) }
    const router = createAiRouter({ env: { AI_LOCAL_ENABLED: 'true', GROQ_API_KEY: 'gk' }, fetchImpl })
    await router.runTask({ task: 'pfm_vision', messages: [{ role: 'user', content: 'hola' }] })
    assert.match(seenUrl, /api\.groq\.com/)
  })

  it('an explicit per-task env override forces Groq with that model even when local is enabled', async () => {
    let seenUrl, seenBody
    const fetchImpl = async (url, opts) => { seenUrl = url; seenBody = JSON.parse(opts.body); return groqOk('ok')(url) }
    const router = createAiRouter({ env: { AI_LOCAL_ENABLED: 'true', CHAT_MIRAI_MODEL: 'llama-3.3-70b-versatile' }, fetchImpl })
    await router.runTask({ task: 'mirai_chat', messages: [{ role: 'user', content: 'hola' }] })
    assert.match(seenUrl, /api\.groq\.com/)
    assert.equal(seenBody.model, 'llama-3.3-70b-versatile')
  })

  it('ledger_import_text honors LEDGER_IMPORT_BASE_URL when routed to Groq', async () => {
    let seenUrl
    const fetchImpl = async (url) => { seenUrl = url; return groqOk('{}')(url) }
    const router = createAiRouter({ env: { LEDGER_IMPORT_BASE_URL: 'https://proxy.internal/' }, fetchImpl })
    await router.runTask({ task: 'ledger_import_text', messages: [{ role: 'user', content: 'x' }] })
    assert.match(seenUrl, /^https:\/\/proxy\.internal\/openai\/v1\/chat\/completions$/)
  })

  it('forwards reasoningEffort through to chatComplete unchanged', async () => {
    let seenBody
    const fetchImpl = async (url, opts) => { seenBody = JSON.parse(opts.body); return groqOk('ok')(url) }
    const router = createAiRouter({ env: { GROQ_API_KEY: 'gk' }, fetchImpl })
    await router.runTask({ task: 'ledger_import_text', messages: [{ role: 'user', content: 'x' }], reasoningEffort: 'low' })
    assert.equal(seenBody.reasoning_effort, 'low')
  })

  it('unknown task throws synchronously', async () => {
    const router = createAiRouter({ env: {} })
    await assert.rejects(() => router.runTask({ task: 'not_a_real_task', messages: [] }), /Tarea de IA desconocida/)
  })
})

describe('ai-router fallback + circuit breaker', () => {
  it('falls back to Groq for this request when the Ollama call fails at transport level', async () => {
    const calls = []
    const fetchImpl = async (url, opts) => {
      calls.push(url)
      if (url.includes('11434')) throw new Error('ECONNREFUSED')
      return groqOk('respuesta de groq')(url)
    }
    const router = createAiRouter({ env: { AI_LOCAL_ENABLED: 'true', GROQ_API_KEY: 'gk' }, fetchImpl })
    const result = await router.runTask({ task: 'mirai_classify', messages: [{ role: 'user', content: 'hola' }], timeoutMs: 500, retryDelayMs: 1 })
    assert.equal(result.provider, 'groq')
    assert.equal(result.message.content, 'respuesta de groq')
    assert.ok(calls.some((u) => u.includes('11434')))
    assert.ok(calls.some((u) => u.includes('api.groq.com')))
  })

  it('opens the circuit after 3 consecutive Ollama failures and skips straight to Groq afterward', async () => {
    const calls = []
    const fetchImpl = async (url) => {
      calls.push(url)
      if (url.includes('11434')) throw new Error('ECONNREFUSED')
      return groqOk('respuesta de groq')(url)
    }
    const router = createAiRouter({ env: { AI_LOCAL_ENABLED: 'true', GROQ_API_KEY: 'gk' }, fetchImpl })
    for (let i = 0; i < 3; i += 1) {
      await router.runTask({ task: 'mirai_classify', messages: [{ role: 'user', content: 'hola' }], timeoutMs: 500, retryDelayMs: 1, maxAttempts: 1 })
    }
    calls.length = 0
    const result = await router.runTask({ task: 'mirai_classify', messages: [{ role: 'user', content: 'hola' }], timeoutMs: 500, retryDelayMs: 1 })
    assert.equal(result.provider, 'groq')
    assert.equal(calls.some((u) => u.includes('11434')), false)
  })

  it('a validateResponse rejection on a local reply also triggers the Groq fallback', async () => {
    const calls = []
    const fetchImpl = async (url) => {
      calls.push(url)
      if (url.includes('11434')) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) }
      return groqOk('{"rows":[]}')(url)
    }
    const router = createAiRouter({ env: { AI_LOCAL_ENABLED: 'true', GROQ_API_KEY: 'gk' }, fetchImpl })
    const result = await router.runTask({
      task: 'ledger_import_text',
      messages: [{ role: 'user', content: 'x' }],
      validateResponse: (msg) => { try { JSON.parse(msg?.content ?? ''); return true } catch { return false } },
    })
    assert.equal(result.provider, 'groq')
    assert.equal(result.message.content, '{"rows":[]}')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/api/src/services/ai/__tests__/ai-router.test.js`
Expected: FAIL — `Cannot find module '../ai-router.js'`

- [ ] **Step 3: Write the implementation**

```js
// apps/api/src/services/ai/ai-router.js
//
// Deterministic AI task router (spec: docs/superpowers/specs/2026-09-26-
// unified-ai-provider-router-design.md). Resolves { provider, model } for a
// declared task per fixed rules, calls the shared client, and — only for a
// local (Ollama) attempt — falls back to Groq on any failure and opens a
// short circuit breaker after repeated failures so a dead local server
// doesn't add latency to every subsequent request.
import { chatComplete, AiClientError } from "./ai-client.js";
import { resolveProviders } from "./ai-providers.js";
import { TASK_PROFILES } from "./ai-task-profiles.js";

const LOCAL_FAIL_THRESHOLD = 3;
const LOCAL_COOLDOWN_MS = 60_000;

function resolveModelOverride(profile, env) {
  const vars = Array.isArray(profile.envOverrideVar) ? profile.envOverrideVar : [profile.envOverrideVar];
  for (const v of vars) {
    if (v && env[v]) return env[v];
  }
  return null;
}

function resolveGroqBaseUrl(profile, env, providers) {
  if (profile.envBaseUrlOverrideVar && env[profile.envBaseUrlOverrideVar]) {
    return String(env[profile.envBaseUrlOverrideVar]).replace(/\/$/, "");
  }
  return providers.groq.baseUrl;
}

function groqTarget(profile, env, providers, model) {
  return {
    provider: "groq",
    model,
    baseUrl: resolveGroqBaseUrl(profile, env, providers),
    apiPath: providers.groq.apiPath,
    apiKey: providers.groq.apiKey,
  };
}

export function createAiRouter({ env = process.env, fetchImpl } = {}) {
  let localFailStreak = 0;
  let localOpenUntil = 0;

  function resolve({ task, explicitModel }) {
    const profile = TASK_PROFILES[task];
    if (!profile) throw new Error(`Tarea de IA desconocida: ${task}`);
    const providers = resolveProviders(env);
    const modelOverride = explicitModel || resolveModelOverride(profile, env);

    if (modelOverride) return groqTarget(profile, env, providers, modelOverride);

    const circuitOpen = Date.now() < localOpenUntil;
    if (!profile.localCapable || !providers.ollama.enabled || circuitOpen) {
      return groqTarget(profile, env, providers, profile.groqDefaultModel);
    }
    const model = profile.weight === "light" ? providers.ollama.modelLight : providers.ollama.modelHeavy;
    return { provider: "ollama", model, baseUrl: providers.ollama.baseUrl, apiPath: providers.ollama.apiPath, apiKey: null };
  }

  async function runTask({
    task, model, messages, tools, toolChoice, temperature, maxTokens, jsonMode, reasoningEffort,
    timeoutMs, retryDelayMs, maxAttempts, respectRateLimit, validateResponse,
  }) {
    const resolved = resolve({ task, explicitModel: model });
    const shared = { messages, tools, toolChoice, temperature, maxTokens, jsonMode, reasoningEffort, timeoutMs, retryDelayMs, maxAttempts, respectRateLimit, fetchImpl };

    if (resolved.provider !== "ollama") {
      return chatComplete({ ...resolved, ...shared });
    }

    try {
      const result = await chatComplete({ ...resolved, ...shared });
      if (validateResponse && !validateResponse(result.message)) {
        throw new AiClientError("Ollama devolvio una respuesta invalida.", { status: 502 });
      }
      if (localFailStreak > 0) {
        console.warn(`[ai-router] Ollama respondio de nuevo tras ${localFailStreak} falla(s); circuito cerrado.`);
      }
      localFailStreak = 0;
      return result;
    } catch {
      localFailStreak += 1;
      if (localFailStreak === LOCAL_FAIL_THRESHOLD) {
        localOpenUntil = Date.now() + LOCAL_COOLDOWN_MS;
        console.warn(`[ai-router] circuito local abierto tras ${localFailStreak} fallas; usando Groq por ${LOCAL_COOLDOWN_MS}ms.`);
      }
      const profile = TASK_PROFILES[task];
      const providers = resolveProviders(env);
      const fallback = groqTarget(profile, env, providers, profile.groqDefaultModel);
      return chatComplete({ ...fallback, ...shared });
    }
  }

  return { runTask };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/api/src/services/ai/__tests__/ai-router.test.js`
Expected: PASS (11/11) — count may legitimately differ slightly from what's stated here; trust the actual `node --test` output over this number.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/ai/ai-router.js apps/api/src/services/ai/__tests__/ai-router.test.js
git commit -m "feat(ai): add ai-router.js — deterministic routing, Groq fallback, circuit breaker"
```

---

## Task 5 — Migrate `mirai-service.js`

**Files:**
- Modify: `apps/api/src/routes/chat/mirai-service.js`
- Test: `apps/api/src/routes/chat/__tests__/*.test.js` (existing — no new test file; these are the regression safety net)

**Changes:** `callGroqRaw` (lines 360–401) becomes a thin wrapper around `aiRouter.runTask()`. Every one of its 7 call sites gains a `task` argument (`mirai_classify` for the turn classifier, `mirai_chat` for the main/channel/panel loops and `answerWithTools`, `mirai_web` for both branches of `callWeb`). `isConfigured()` becomes true when either Groq or local routing is available, per spec acceptance criterion 7.

- [ ] **Step 1: Add the router import and instance**

In `apps/api/src/routes/chat/mirai-service.js`, replace:

```js
import { isReasoningModel } from "../../services/groq-model-helpers.js";
```

with:

```js
import { createAiRouter } from "../../services/ai/ai-router.js";
import { AiClientError } from "../../services/ai/ai-client.js";
import { isLocalEnabled } from "../../services/ai/ai-providers.js";
```

(`isReasoningModel` is no longer used directly in this file — `ai-client.js` uses it internally.)

- [ ] **Step 2: Wire the router into `createMiraiService` and update `isConfigured`**

Replace:

```js
  const fetchFn = fetchImpl ?? globalThis.fetch;
  const model = env.CHAT_MIRAI_MODEL || DEFAULT_MIRAI_MODEL;
  const webModel = env.CHAT_MIRAI_WEB_MODEL || DEFAULT_WEB_MODEL;
  const routerModel = env.CHAT_MIRAI_ROUTER_MODEL || DEFAULT_ROUTER_MODEL;
  const tavilyKey = env.TAVILY_API_KEY || "";
  const webKillSwitch = String(env.CHAT_MIRAI_WEB ?? "true").toLowerCase() === "false";
  // Prefer Tavily (works on the free tier); fall back to a Groq compound model
  // only if one is explicitly configured. `null` => no web path, `live` turns
  // degrade to "no internet".
  const webProvider = webKillSwitch ? null : (tavilyKey ? "tavily" : (env.CHAT_MIRAI_WEB_MODEL ? "compound" : null));
  const webEnabled = webProvider !== null && Boolean(env.GROQ_API_KEY);
  const baseUrl = (env.GROQ_BASE_URL || "https://api.groq.com").replace(/\/$/, "");
```

with:

```js
  const fetchFn = fetchImpl ?? globalThis.fetch;
  const aiRouter = createAiRouter({ env, fetchImpl: fetchFn });
  // Kept as informational defaults (audit rows, _internals) — the actual
  // provider/model used per call is decided by aiRouter, not by these.
  const model = env.CHAT_MIRAI_MODEL || DEFAULT_MIRAI_MODEL;
  const webModel = env.CHAT_MIRAI_WEB_MODEL || DEFAULT_WEB_MODEL;
  const tavilyKey = env.TAVILY_API_KEY || "";
  const webKillSwitch = String(env.CHAT_MIRAI_WEB ?? "true").toLowerCase() === "false";
  // Prefer Tavily (works on the free tier); fall back to a Groq compound model
  // only if one is explicitly configured. `null` => no web path, `live` turns
  // degrade to "no internet". Unchanged: `live` always needs Groq (compound)
  // or Tavily+Groq-phrasing — mirai_web is not local-capable (spec non-goal 3).
  const webProvider = webKillSwitch ? null : (tavilyKey ? "tavily" : (env.CHAT_MIRAI_WEB_MODEL ? "compound" : null));
  const webEnabled = webProvider !== null && Boolean(env.GROQ_API_KEY);
```

(`routerModel` and `baseUrl` are dropped — the router now resolves each task's model/baseUrl itself via `ai-task-profiles.js`/`ai-providers.js`; leaving either declared would be an unused-variable lint violation once `callGroqRaw`'s fetch loop, their only other use, is replaced in Step 3.)

Replace:

```js
  function isConfigured() {
    return Boolean(env.GROQ_API_KEY);
  }
```

with:

```js
  function isConfigured() {
    return Boolean(env.GROQ_API_KEY) || isLocalEnabled(env);
  }
```

- [ ] **Step 3: Replace `callGroqRaw`'s body**

Replace the whole function (original lines 363–401):

```js
  async function callGroqRaw({ model: m, messages, tools, toolChoice, maxTokens = 1000, timeoutMs = GROQ_TIMEOUT_MS, respectRateLimit = false }) {
    const body = {
      model: m,
      temperature: 0.2,
      max_tokens: maxTokens,
      ...(tools ? { tools, tool_choice: toolChoice ?? "auto" } : {}),
      ...(isReasoningModel(m) ? { reasoning_format: "hidden" } : {}),
      messages,
    };
    let lastErr;
    let retryDelay = 1200;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelay));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetchFn(`${baseUrl}/openai/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.GROQ_API_KEY}` },
          body: JSON.stringify(body), signal: controller.signal,
        });
      } catch (err) { lastErr = err; clearTimeout(timer); continue; }
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`Groq ${res.status}`);
        if (respectRateLimit && res.status === 429) {
          lastErr = new ChatServiceError('La IA alcanzó el límite temporal del proveedor. Espera un momento y vuelve a enviar; no se ha creado ningún registro.', 429);
          const retrySeconds = Number(res.headers.get('retry-after'));
          if (Number.isFinite(retrySeconds) && retrySeconds > 0) retryDelay = Math.min(30000, Math.max(15000, retrySeconds * 1000 + 5000));
        }
        continue;
      }
      if (!res.ok) { const d = await res.text().catch(() => ""); throw new Error(`Groq ${res.status}: ${d.slice(0, 160)}`); }
      const payload = await res.json();
      return payload?.choices?.[0]?.message ?? null;
    }
    throw lastErr ?? new Error("Groq sin respuesta");
  }

  async function callGroq(messages) {
    return callGroqRaw({ model, messages, tools: TOOL_DEFS, toolChoice: "auto", maxTokens: 1000, timeoutMs: GROQ_TIMEOUT_MS });
  }
```

with:

```js
  // Thin wrapper: the actual HTTP transport, retry, local/Groq routing and
  // fallback all live in ai-router.js/ai-client.js. This function only adds
  // the one piece of behavior that's specific to MirAI: translating a
  // rate-limited Groq response into ChatServiceError when the caller asked
  // to respect the provider's rate limit (answerWithTools's respectRateLimit).
  async function callGroqRaw({ task, model: m, messages, tools, toolChoice, maxTokens = 1000, timeoutMs = GROQ_TIMEOUT_MS, respectRateLimit = false }) {
    try {
      const { message } = await aiRouter.runTask({ task, model: m, messages, tools, toolChoice, maxTokens, timeoutMs, respectRateLimit });
      return message;
    } catch (err) {
      if (respectRateLimit && err instanceof AiClientError && err.status === 429) {
        throw new ChatServiceError('La IA alcanzó el límite temporal del proveedor. Espera un momento y vuelve a enviar; no se ha creado ningún registro.', 429);
      }
      throw err;
    }
  }

  async function callGroq(messages) {
    return callGroqRaw({ task: "mirai_chat", messages, tools: TOOL_DEFS, toolChoice: "auto", maxTokens: 1000, timeoutMs: GROQ_TIMEOUT_MS });
  }
```

- [ ] **Step 4: Add `task` to the classifier call**

In `classifyTurn`, replace:

```js
      const msg = await callGroqRaw({
        model: routerModel, messages, maxTokens: ROUTER_MAX_TOKENS, timeoutMs: ROUTER_TIMEOUT_MS,
      });
```

with:

```js
      const msg = await callGroqRaw({
        task: "mirai_classify", messages, maxTokens: ROUTER_MAX_TOKENS, timeoutMs: ROUTER_TIMEOUT_MS,
      });
```

(No `model` is passed — the router resolves `mirai_classify`'s model itself, honoring `CHAT_MIRAI_ROUTER_MODEL` if set.)

- [ ] **Step 5: Add `task` to `callWeb`'s two branches**

Replace:

```js
      const msg = await callGroqRaw({
        model,
        maxTokens: 700,
        timeoutMs: GROQ_TIMEOUT_MS,
        messages: [
```

with:

```js
      const msg = await callGroqRaw({
        task: "mirai_web",
        model,
        maxTokens: 700,
        timeoutMs: GROQ_TIMEOUT_MS,
        messages: [
```

Replace:

```js
    const m = await callGroqRaw({ model: webModel, messages, maxTokens: 1000, timeoutMs: WEB_TIMEOUT_MS });
```

with:

```js
    const m = await callGroqRaw({ task: "mirai_web", model: webModel, messages, maxTokens: 1000, timeoutMs: WEB_TIMEOUT_MS });
```

(`mirai_web` is `localCapable: false`, so the router always sends these to Groq — passing `model`/`webModel` here preserves the exact tavily-vs-compound model choice unchanged, per spec non-goal 3.)

- [ ] **Step 6: Add `task` to the channel-mention loop**

Replace:

```js
      const msg = await callGroqRaw({
        model, messages: llmMessages, tools: CHANNEL_TOOL_DEFS, toolChoice: "auto",
        maxTokens: 800, timeoutMs: GROQ_TIMEOUT_MS,
      });
```

with:

```js
      const msg = await callGroqRaw({
        task: "mirai_chat", model, messages: llmMessages, tools: CHANNEL_TOOL_DEFS, toolChoice: "auto",
        maxTokens: 800, timeoutMs: GROQ_TIMEOUT_MS,
      });
```

- [ ] **Step 7: Add `task` to the panel loop and `answerWithTools`**

Replace:

```js
          const msg = await callGroqRaw({ model, messages: llmMessages, tools: TOOL_DEFS, toolChoice: "auto", maxTokens: 900, timeoutMs: GROQ_TIMEOUT_MS });
```

with:

```js
          const msg = await callGroqRaw({ task: "mirai_chat", model, messages: llmMessages, tools: TOOL_DEFS, toolChoice: "auto", maxTokens: 900, timeoutMs: GROQ_TIMEOUT_MS });
```

Replace:

```js
      const reply = await callGroqRaw({ model, messages: transcript, tools, toolChoice: 'auto', maxTokens: 1200, respectRateLimit: true });
```

with:

```js
      const reply = await callGroqRaw({ task: "mirai_chat", model, messages: transcript, tools, toolChoice: 'auto', maxTokens: 1200, respectRateLimit: true });
```

- [ ] **Step 8: Run the existing MirAI test suite**

Run: `node --test apps/api/src/routes/chat/__tests__/`
Expected: PASS, same count as before this task (no test file changed). If any test fails, compare the failure against the exact original behavior preserved above (message text is allowed to differ from the pre-migration wording — no test asserts on it — but `.status` codes, `isConfigured()`, and successful-path content must match).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/chat/mirai-service.js
git commit -m "refactor(chat): route MirAI's Groq calls through the shared ai-router"
```

---

## Task 6 — Migrate `help-assistant-service.js`

**Files:**
- Modify: `apps/api/src/routes/help/help-assistant-service.js`
- Test: `apps/api/src/routes/help/__tests__/*.test.js` (existing)

**Changes:** `callGroq` delegates to `aiRouter.runTask({ task: "help_assistant" })`. `isConfigured()` accounts for local mode.

- [ ] **Step 1: Update imports and service setup**

Replace:

```js
import { createHelpService } from "../../services/help-service.js";
import { isReasoningModel } from "../../services/groq-model-helpers.js";
```

with:

```js
import { createHelpService } from "../../services/help-service.js";
import { createAiRouter } from "../../services/ai/ai-router.js";
import { isLocalEnabled } from "../../services/ai/ai-providers.js";
```

Replace:

```js
export function createHelpAssistantService({ prisma, helpService, env = process.env, fetchImpl } = {}) {
  const service = helpService ?? createHelpService({ prisma });
  const fetchFn = fetchImpl ?? globalThis.fetch;
  const model = env.HELP_ASSISTANT_MODEL || DEFAULT_MODEL;
  const baseUrl = (env.GROQ_BASE_URL || "https://api.groq.com").replace(/\/$/, "");
  const buckets = new Map();

  function isConfigured() {
    return Boolean(env.GROQ_API_KEY);
  }
```

with:

```js
export function createHelpAssistantService({ prisma, helpService, env = process.env, fetchImpl } = {}) {
  const service = helpService ?? createHelpService({ prisma });
  const aiRouter = createAiRouter({ env, fetchImpl });
  const buckets = new Map();

  function isConfigured() {
    return Boolean(env.GROQ_API_KEY) || isLocalEnabled(env);
  }
```

Also delete the now-unused `const DEFAULT_MODEL = "openai/gpt-oss-120b";` declaration near the top of the file (it was only read by the `model` line just removed). `GROQ_TIMEOUT_MS` stays — Step 2 below still passes it as `timeoutMs`.

- [ ] **Step 2: Replace `callGroq`**

Replace:

```js
  async function callGroq(messages) {
    const body = {
      model,
      temperature: 0.2,
      max_tokens: 500,
      ...(isReasoningModel(model) ? { reasoning_format: "hidden" } : {}),
      messages,
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1200));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
      let res;
      try {
        res = await fetchFn(`${baseUrl}/openai/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.GROQ_API_KEY}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch {
        clearTimeout(timer);
        continue;
      }
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) continue;
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new HelpAssistantServiceError(
          `El asistente rechazo la peticion (${res.status}): ${detail.slice(0, 160)}`,
          502,
        );
      }
      const payload = await res.json();
      return payload?.choices?.[0]?.message?.content ?? "";
    }
    throw new HelpAssistantServiceError("El asistente no respondio, intenta de nuevo.", 502);
  }
```

with:

```js
  async function callGroq(messages) {
    try {
      const { message } = await aiRouter.runTask({ task: "help_assistant", messages, maxTokens: 500, timeoutMs: GROQ_TIMEOUT_MS });
      return message?.content ?? "";
    } catch (err) {
      throw new HelpAssistantServiceError(err.message ?? "El asistente no respondio, intenta de nuevo.", 502);
    }
  }
```

(`GROQ_TIMEOUT_MS` at module scope stays as the timeout constant passed to `runTask`; only its original inline usage inside the fetch loop moves into this call.)

- [ ] **Step 3: Run the existing help-assistant test suite**

Run: `node --test apps/api/src/routes/help/__tests__/`
Expected: PASS, same count as before.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/help/help-assistant-service.js
git commit -m "refactor(help): route the help assistant's Groq calls through the shared ai-router"
```

---

## Task 7 — Migrate `pfm/assistant-service.js`

**Files:**
- Modify: `apps/api/src/routes/pfm/assistant-service.js`
- Test: `apps/api/src/routes/pfm/__tests__/assistant-*.test.js` (existing)

**Changes:** `callGroq` delegates to `aiRouter.runTask({ task: "pfm_assistant" })`. `isConfigured()` accounts for local mode.

- [ ] **Step 1: Update imports and service setup**

Replace:

```js
import { toLocalIso, toLocalMonth } from "@runly/core";
import { PfmServiceError, isTableNotFoundError } from "./service-helpers.js";
import { TOOL_DEFS, buildToolRunners } from "./assistant-tools.js";
import { isReasoningModel } from "../../services/groq-model-helpers.js";
```

with:

```js
import { toLocalIso, toLocalMonth } from "@runly/core";
import { PfmServiceError, isTableNotFoundError } from "./service-helpers.js";
import { TOOL_DEFS, buildToolRunners } from "./assistant-tools.js";
import { createAiRouter } from "../../services/ai/ai-router.js";
import { isLocalEnabled } from "../../services/ai/ai-providers.js";
```

Replace:

```js
  const fetchFn = fetchImpl ?? globalThis.fetch;
  const model = env.PFM_ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL;
  const baseUrl = (env.GROQ_BASE_URL || "https://api.groq.com").replace(/\/$/, "");
  const runners = buildToolRunners({ summary, wallets, movements, budgets, categories });

  const buckets = new Map(); // actorId -> number[]

  function isConfigured() {
    return Boolean(env.GROQ_API_KEY);
  }
```

with:

```js
  const aiRouter = createAiRouter({ env, fetchImpl });
  const runners = buildToolRunners({ summary, wallets, movements, budgets, categories });

  const buckets = new Map(); // actorId -> number[]

  function isConfigured() {
    return Boolean(env.GROQ_API_KEY) || isLocalEnabled(env);
  }
```

(`DEFAULT_ASSISTANT_MODEL` at module scope stays — it now only documents the task's `groqDefaultModel` in `ai-task-profiles.js`, but leaving the unused-looking constant would trigger lint; delete the `const DEFAULT_ASSISTANT_MODEL = "openai/gpt-oss-120b";` declaration too, since `ai-task-profiles.js` is now the single source of truth for it.)

- [ ] **Step 2: Replace `callGroq`**

Replace:

```js
  // ── Groq call ─────────────────────────────────────────────────────────
  async function callGroq(messages) {
    const body = {
      model,
      temperature: 0.2,
      max_tokens: 800,
      tools: TOOL_DEFS,
      tool_choice: "auto",
      ...(isReasoningModel(model) ? { reasoning_format: "hidden" } : {}),
      messages,
    };
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1200));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
      let res;
      try {
        res = await fetchFn(`${baseUrl}/openai/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.GROQ_API_KEY}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        lastErr = err;
        clearTimeout(timer);
        continue;
      }
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`Groq respondio ${res.status}`);
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new PfmServiceError(
          `El asistente rechazo la peticion (${res.status}): ${detail.slice(0, 160)}`,
          502,
        );
      }
      const payload = await res.json();
      return payload?.choices?.[0]?.message ?? null;
    }
    throw new PfmServiceError("El asistente no respondio, intenta de nuevo.", 502);
  }
```

with:

```js
  // ── Groq/local call ──────────────────────────────────────────────────
  async function callGroq(messages) {
    try {
      const { message } = await aiRouter.runTask({ task: "pfm_assistant", messages, tools: TOOL_DEFS, toolChoice: "auto", maxTokens: 800, timeoutMs: GROQ_TIMEOUT_MS });
      return message;
    } catch (err) {
      throw new PfmServiceError(err.message ?? "El asistente no respondio, intenta de nuevo.", 502);
    }
  }
```

- [ ] **Step 3: Run the existing PFM assistant test suite**

Run: `node --test apps/api/src/routes/pfm/__tests__/assistant-service.test.js apps/api/src/routes/pfm/__tests__/assistant-tools.test.js`
Expected: PASS, same count as before.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/pfm/assistant-service.js
git commit -m "refactor(pfm): route the PFM assistant's Groq calls through the shared ai-router"
```

---

## Task 8 — Migrate `vision-service.js`

**Files:**
- Modify: `apps/api/src/services/vision-service.js`
- Test: `apps/api/src/services/__tests__/vision-service.test.js`, `vision-service.describe.test.js` (existing). `inventory-intake-service.test.js` and `receipts-service.test.js` exercise this file indirectly — run them too since they compose `createVisionService`.

**Changes:** `call()` and `describe()` delegate to `aiRouter.runTask({ task: "pfm_vision" })`, which the task profile forces to Groq unconditionally — vision never routes to Ollama. `isConfigured`-equivalent checks (the inline `if (!apiKey) throw`) stay Groq-only, unchanged, per spec (vision is never local-capable). Both calls pass `reasoningEffort: "low"` — this file's original code always sent `reasoning_effort: "low"` alongside `reasoning_format: "hidden"` for its reasoning model, and `ai-client.js`'s `reasoningEffort` param (added during Task 3's review) must be passed explicitly to preserve that, since it's no longer automatic.

- [ ] **Step 1: Update imports and adapter setup**

Replace:

```js
import { isReasoningModel } from "./groq-model-helpers.js";
```

with:

```js
import { createAiRouter } from "./ai/ai-router.js";
```

Replace:

```js
function createGroqAdapter({ env, fetchImpl }) {
  const apiKey = env.GROQ_API_KEY;
  const baseUrl = (env.GROQ_BASE_URL || "https://api.groq.com").replace(/\/$/, "");
  const model = env.PFM_VISION_MODEL || DEFAULT_VISION_MODEL;
  const timeoutMs = Number(env.PFM_VISION_TIMEOUT_MS) || 20000;
  const retryDelayMs = Number(env.PFM_VISION_RETRY_DELAY_MS) || 1500;
  const fetchFn = fetchImpl ?? globalThis.fetch;
```

with:

```js
function createGroqAdapter({ env, fetchImpl }) {
  const apiKey = env.GROQ_API_KEY;
  const model = env.PFM_VISION_MODEL || DEFAULT_VISION_MODEL;
  const timeoutMs = Number(env.PFM_VISION_TIMEOUT_MS) || 20000;
  const retryDelayMs = Number(env.PFM_VISION_RETRY_DELAY_MS) || 1500;
  const aiRouter = createAiRouter({ env, fetchImpl });
```

(`baseUrl`/`fetchFn` are no longer read directly here — the router resolves them, always to Groq for `pfm_vision`.)

- [ ] **Step 2: Replace `call()`'s body-construction + retry loop together**

The pre-migration `body` object exists only to carry `messages`/`max_completion_tokens`/`response_format`/`reasoning_format` into the `fetch` call being deleted — `ai-client.js` now builds its own request body from discrete params (`jsonMode: true` reproduces `response_format`; `isReasoningModel` is applied inside `ai-client.js` itself). So `body` is replaced by a plain `messages` array, and `isReasoningModel` is no longer called from this file at all (confirmed by Step 1's import removal).

Replace the whole function (from `const body = {` through the closing `throw lastErr ?? new VisionServiceError("El servicio de vision no respondio.");` and its `}`, i.e. the entire middle of `call()`):

```js
    const body = {
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      max_completion_tokens: maxTokens || DEFAULT_MAX_TOKENS,
      ...(isReasoningModel(model) ? { reasoning_format: "hidden", reasoning_effort: "low" } : {}),
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: question },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}` },
            },
          ],
        },
      ],
    };

    let lastErr;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetchFn(`${baseUrl}/openai/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        lastErr = new VisionServiceError(
          `No se pudo contactar al servicio de vision: ${err.message}`,
        );
        clearTimeout(t);
        continue;
      }
      clearTimeout(t);

      if (res.status === 429 || res.status >= 500) {
        lastErr = new VisionServiceError(`El servicio de vision respondio ${res.status}.`, 502);
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new VisionServiceError(
          `El servicio de vision rechazo la peticion (${res.status}): ${detail.slice(0, 400)}`,
        );
      }

      const payload = await res.json();
      const content = payload?.choices?.[0]?.message?.content;
      const obj = extractJsonObject(content);
      if (!obj) {
        if (allowTextFallback && typeof content === 'string' && content.trim()) return { parsed: { rawText: content.trim().slice(0, 8000), observations: [], warnings: ['La IA devolvió una respuesta sin campos estructurados. Se muestra el texto recibido para revisión manual.'] }, model: payload.model ?? model };
        throw new VisionServiceError("El servicio de vision no devolvio un JSON legible.");
      }
      return { parsed: normalize(obj), rawResponse: payload, model: payload.model ?? model };
    }
    throw lastErr ?? new VisionServiceError("El servicio de vision no respondio.");
  }
```

with:

```js
    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}` } },
        ],
      },
    ];
    let payload;
    try {
      const result = await aiRouter.runTask({ task: "pfm_vision", model, messages, jsonMode: true, reasoningEffort: "low", useMaxCompletionTokens: true, maxTokens: maxTokens || DEFAULT_MAX_TOKENS, timeoutMs, retryDelayMs });
      payload = { model: result.model, choices: [{ message: result.message }] };
    } catch (err) {
      throw new VisionServiceError(err.message ?? "El servicio de vision no respondio.");
    }
    const content = payload?.choices?.[0]?.message?.content;
    const obj = extractJsonObject(content);
    if (!obj) {
      if (allowTextFallback && typeof content === 'string' && content.trim()) return { parsed: { rawText: content.trim().slice(0, 8000), observations: [], warnings: ['La IA devolvió una respuesta sin campos estructurados. Se muestra el texto recibido para revisión manual.'] }, model: payload.model ?? model };
      throw new VisionServiceError("El servicio de vision no devolvio un JSON legible.");
    }
    return { parsed: normalize(obj), rawResponse: payload, model: payload.model ?? model };
  }
```

- [ ] **Step 3: Replace `describe()`'s body-construction + retry loop the same way**

Replace the whole function (from `const body = {` through the closing `throw lastErr ?? new VisionServiceError("El servicio de vision no respondio.");` and its `}`, i.e. the entire middle of `describe()`):

```js
    const body = {
      model,
      temperature: 0,
      max_completion_tokens: DEFAULT_MAX_TOKENS,
      ...(isReasoningModel(model) ? { reasoning_format: "hidden", reasoning_effort: "low" } : {}),
      messages: [
        { role: "system", content: "Eres un asistente que describe imagenes para otro asistente. Responde solo con la descripcion, sin preambulos." },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}` } },
          ],
        },
      ],
    };
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetchFn(`${baseUrl}/openai/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        lastErr = new VisionServiceError(`No se pudo contactar al servicio de vision: ${err.message}`);
        clearTimeout(t);
        continue;
      }
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new VisionServiceError(`El servicio de vision respondio ${res.status}.`, 502);
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new VisionServiceError(`El servicio de vision rechazo la peticion (${res.status}): ${detail.slice(0, 300)}`);
      }
      const payload = await res.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (!content || !String(content).trim()) {
        throw new VisionServiceError("El servicio de vision no devolvio una descripcion.");
      }
      return { description: String(content).trim().slice(0, 4000), model: payload.model ?? model };
    }
    throw lastErr ?? new VisionServiceError("El servicio de vision no respondio.");
  }
```

with:

```js
    const messages = [
      { role: "system", content: "Eres un asistente que describe imagenes para otro asistente. Responde solo con la descripcion, sin preambulos." },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}` } },
        ],
      },
    ];
    let result;
    try {
      result = await aiRouter.runTask({ task: "pfm_vision", model, messages, reasoningEffort: "low", useMaxCompletionTokens: true, maxTokens: DEFAULT_MAX_TOKENS, timeoutMs, retryDelayMs });
    } catch (err) {
      throw new VisionServiceError(err.message ?? "El servicio de vision no respondio.");
    }
    const content = result.message?.content;
    if (!content || !String(content).trim()) {
      throw new VisionServiceError("El servicio de vision no devolvio una descripcion.");
    }
    return { description: String(content).trim().slice(0, 4000), model: result.model ?? model };
  }
```

- [ ] **Step 4: Run the vision and dependent test suites**

Run: `node --test apps/api/src/services/__tests__/vision-service.test.js apps/api/src/services/__tests__/vision-service.describe.test.js apps/api/src/services/__tests__/inventory-intake-service.test.js apps/api/src/routes/pfm/__tests__/receipts-service.test.js`
Expected: PASS, same count as before. `inventory-intake-service.test.js` and `receipts-service.test.js` must pass unchanged — they compose `createVisionService` without any code changes of their own, confirming spec edge case 8 (those two services inherit the migration for free).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/vision-service.js
git commit -m "refactor(vision): route Groq vision calls through the shared ai-router (Groq-only, unchanged)"
```

---

## Task 9 — Migrate `call-transcript-analysis-service.js`

**Files:**
- Modify: `apps/api/src/routes/calls/call-transcript-analysis-service.js`
- Test: `apps/api/src/routes/calls/__tests__/call-transcript-analysis-service.test.js` (existing)

**Changes:** `callGroq` delegates to `aiRouter.runTask({ task: "transcript_analysis" })`. The inline `if (!apiKey) throw` gate becomes local-aware. Passes `reasoningEffort: "low"` — this file's original code always sent `reasoning_effort: "low"`, which must be requested explicitly now (see Task 3/8's note on `ai-client.js`'s opt-in `reasoningEffort` param).

- [ ] **Step 1: Update imports**

Replace:

```js
import { signAiProof, verifyAiProof, AiProofTokenError } from "../../lib/ai-proof-token.js";
import { isReasoningModel } from "../../services/groq-model-helpers.js";
```

with:

```js
import { signAiProof, verifyAiProof, AiProofTokenError } from "../../lib/ai-proof-token.js";
import { createAiRouter } from "../../services/ai/ai-router.js";
import { isLocalEnabled } from "../../services/ai/ai-providers.js";
```

- [ ] **Step 2: Replace `callGroq`**

Replace:

```js
  async function callGroq(transcriptText, referenceDateIso, moduleAdditions) {
    const apiKey = env.GROQ_API_KEY;
    if (!apiKey) throw new CallTranscriptAnalysisError("Analisis con IA no configurado (falta GROQ_API_KEY).", 503);
    const baseUrl = (env.GROQ_BASE_URL || "https://api.groq.com").replace(/\/$/, "");
    const model = env.CHAT_TRANSCRIPT_ANALYSIS_MODEL || env.CHAT_MIRAI_MODEL || "openai/gpt-oss-120b";
    const fetchFn = fetchImpl ?? globalThis.fetch;
    const body = {
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      max_completion_tokens: 2000,
      ...(isReasoningModel(model) ? { reasoning_format: "hidden", reasoning_effort: "low" } : {}),
      messages: [
        { role: "system", content: buildSystemPrompt(referenceDateIso, moduleAdditions) },
        { role: "user", content: transcriptText.slice(0, 60000) },
      ],
    };
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
      let res;
      try {
        res = await fetchFn(`${baseUrl}/openai/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
      } catch (err) {
        lastErr = new CallTranscriptAnalysisError(`No se pudo contactar al servicio de IA: ${err.message}`, 502);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new CallTranscriptAnalysisError(`El servicio de IA respondio ${res.status}.`, 502);
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new CallTranscriptAnalysisError(`El servicio de IA rechazo la peticion (${res.status}): ${detail.slice(0, 300)}`);
      }
      const payload = await res.json();
      const content = payload?.choices?.[0]?.message?.content;
      const obj = extractJsonObject(content);
      if (!obj) throw new CallTranscriptAnalysisError("El servicio de IA no devolvio un JSON legible.");
      return { obj, model: payload.model ?? model };
    }
    throw lastErr ?? new CallTranscriptAnalysisError("El servicio de IA no respondio.", 502);
  }
```

with:

```js
  async function callGroq(transcriptText, referenceDateIso, moduleAdditions) {
    if (!env.GROQ_API_KEY && !isLocalEnabled(env)) {
      throw new CallTranscriptAnalysisError("Analisis con IA no configurado (falta GROQ_API_KEY).", 503);
    }
    const aiRouter = createAiRouter({ env, fetchImpl });
    const messages = [
      { role: "system", content: buildSystemPrompt(referenceDateIso, moduleAdditions) },
      { role: "user", content: transcriptText.slice(0, 60000) },
    ];
    let result;
    try {
      result = await aiRouter.runTask({
        task: "transcript_analysis", messages, jsonMode: true, reasoningEffort: "low", useMaxCompletionTokens: true, maxTokens: 2000,
        validateResponse: (msg) => Boolean(extractJsonObject(msg?.content)),
      });
    } catch (err) {
      throw new CallTranscriptAnalysisError(err.message ?? "El servicio de IA no respondio.", 502);
    }
    const obj = extractJsonObject(result.message?.content);
    if (!obj) throw new CallTranscriptAnalysisError("El servicio de IA no devolvio un JSON legible.");
    return { obj, model: result.model };
  }
```

(`createAiRouter` is constructed per-call here rather than once at `createCallTranscriptAnalysisService` scope, matching this file's existing pattern of reading `env`/`fetchImpl` lazily inside `callGroq` rather than at factory time — this preserves the existing test setup, which passes `env`/`fetchImpl` per-service-instance already, so either placement works; per-call keeps the diff smallest since this file's factory function doesn't already hold `env` in a closure variable it reused elsewhere.)

- [ ] **Step 3: Run the existing test suite**

Run: `node --test apps/api/src/routes/calls/__tests__/call-transcript-analysis-service.test.js`
Expected: PASS, same count as before.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/calls/call-transcript-analysis-service.js
git commit -m "refactor(calls): route transcript-analysis Groq calls through the shared ai-router"
```

---

## Task 10 — Migrate `ledger/ai-import-extraction.js`

**Files:**
- Modify: `apps/api/src/routes/ledger/ai-import-extraction.js`
- Test: `apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js`, `ai-import-routes.test.js` (existing)

**Changes:** `callGroqText` (shared by `extractRowsFromText` and `suggestColumnMapping`) delegates to `aiRouter.runTask({ task: "ledger_import_text" })`, with `validateResponse` checking the JSON parses (spec edge case 6). Inline `GROQ_API_KEY` gate becomes local-aware. Passes `reasoningEffort: "low"` — this file's original code always sent `reasoning_effort: "low"`, which must be requested explicitly now (see Task 3/8's note on `ai-client.js`'s opt-in `reasoningEffort` param).

- [ ] **Step 1: Update imports**

Replace:

```js
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { isReasoningModel } from '../../services/groq-model-helpers.js'
import { isValidRow } from './ai-import-dedup.js'
```

with:

```js
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { createAiRouter } from '../../services/ai/ai-router.js'
import { isLocalEnabled } from '../../services/ai/ai-providers.js'
import { isValidRow } from './ai-import-dedup.js'
```

- [ ] **Step 2: Replace `callGroqText`**

Replace:

```js
async function callGroqText({ systemPrompt, userContent, env = process.env, fetchImpl }) {
  const apiKey = env.GROQ_API_KEY
  if (!apiKey) {
    throw new ExtractionError('Importacion con IA no configurada (falta GROQ_API_KEY).', 503)
  }
  const baseUrl = (env.LEDGER_IMPORT_BASE_URL || env.GROQ_BASE_URL || 'https://api.groq.com').replace(/\/$/, '')
  const model = env.LEDGER_IMPORT_MODEL || 'openai/gpt-oss-120b'
  const fetchFn = fetchImpl ?? globalThis.fetch
  const body = {
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    max_completion_tokens: 8000,
    ...(isReasoningModel(model) ? { reasoning_format: 'hidden', reasoning_effort: 'low' } : {}),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent.slice(0, 60000) },
    ],
  }

  let lastErr
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500))
    let res
    try {
      res = await fetchFn(`${baseUrl}/openai/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      })
    } catch (err) {
      lastErr = new ExtractionError(`No se pudo contactar al servicio de IA: ${err.message}`, 502)
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new ExtractionError(`El servicio de IA respondio ${res.status}.`, 502)
      continue
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new ExtractionError(`El servicio de IA rechazo la peticion (${res.status}): ${detail.slice(0, 300)}`)
    }
    const payload = await res.json()
    const content = payload?.choices?.[0]?.message?.content
    const obj = extractJsonObject(content)
    if (!obj) throw new ExtractionError('El servicio de IA no devolvio un JSON legible.')
    return { obj, model: payload.model ?? model }
  }
  throw lastErr
}
```

with:

```js
async function callGroqText({ systemPrompt, userContent, env = process.env, fetchImpl }) {
  if (!env.GROQ_API_KEY && !isLocalEnabled(env)) {
    throw new ExtractionError('Importacion con IA no configurada (falta GROQ_API_KEY).', 503)
  }
  const aiRouter = createAiRouter({ env, fetchImpl })
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent.slice(0, 60000) },
  ]
  let result
  try {
    result = await aiRouter.runTask({
      task: 'ledger_import_text', messages, jsonMode: true, reasoningEffort: 'low', useMaxCompletionTokens: true, maxTokens: 8000,
      validateResponse: (msg) => Boolean(extractJsonObject(msg?.content)),
    })
  } catch (err) {
    throw new ExtractionError(err.message ?? 'El servicio de IA no respondio.', 502)
  }
  const obj = extractJsonObject(result.message?.content)
  if (!obj) throw new ExtractionError('El servicio de IA no devolvio un JSON legible.')
  return { obj, model: result.model }
}
```

- [ ] **Step 3: Run the existing test suites**

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js apps/api/src/routes/ledger/__tests__/ai-import-routes.test.js apps/api/src/routes/ledger/__tests__/ai-import-token.test.js`
Expected: PASS, same count as before.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/ledger/ai-import-extraction.js
git commit -m "refactor(ledger): route AI statement-import Groq calls through the shared ai-router"
```

---

## Task 11 — Installer: optional `AI_LOCAL_ENABLED`/`OLLAMA_*` prompts

**Files:**
- Modify: `infra/installer/.env.local.example`
- Modify: `infra/installer/.env.external.example`
- Modify: `infra/installer/setup-local.mjs`
- Modify: `infra/installer/setup-external.mjs`

**Changes:** Document and (optionally) prompt for the 4 new env vars, default disabled — no behavior change for an instance that skips them.

- [ ] **Step 1: `setup-external.mjs` — add a new `OPTIONAL_VAR_GROUPS` entry**

This file backfills missing optional vars into an existing `.env.external` via `appendMissingOptionalVars()`, which iterates the static `OPTIONAL_VAR_GROUPS` array (`infra/installer/setup-external.mjs:198`). Insert a new group right after the existing `atlas.pfm` vision group (which ends at line 276 with the closing `},`):

```js
  {
    header: [
      "# ── Local AI routing (optional) ─────────────────────────────────────────────",
      "# Alternate MirAI/help-assistant/PFM-assistant/transcript-analysis/ledger-import",
      "# between Groq and a local Ollama server (qwen3:4b for light tasks, qwen3:8b for",
      "# heavy ones). Vision tasks (receipt OCR, inventory photos, scanned statements)",
      "# always use Groq — local models have no vision. Default: disabled (Groq only).",
    ],
    vars: [
      { key: "AI_LOCAL_ENABLED",   placeholder: "false", comment: null },
      { key: "OLLAMA_BASE_URL",    placeholder: "http://localhost:11434", comment: null },
      { key: "OLLAMA_MODEL_LIGHT", placeholder: "qwen3:4b", comment: null },
      { key: "OLLAMA_MODEL_HEAVY", placeholder: "qwen3:8b", comment: null },
    ],
  },
```

- [ ] **Step 2: `setup-local.mjs` — add variable resolution + template lines**

This file always regenerates the full `.env.local` from a template literal in `writeLocalEnv()`, reading each value through `fromLocalEnv(key)` (preserves an existing value across re-runs, else falls back to `process.env[key]`, else `""`). Add after the existing `const chatMiraiWebModel = fromLocalEnv("CHAT_MIRAI_WEB_MODEL");` line (`infra/installer/setup-local.mjs:738`):

```js
  // Local AI routing — optional, default disabled (Groq only, unchanged behavior).
  const aiLocalEnabled  = fromLocalEnv("AI_LOCAL_ENABLED") || "false";
  const ollamaBaseUrl   = fromLocalEnv("OLLAMA_BASE_URL") || "http://localhost:11434";
  const ollamaModelLight = fromLocalEnv("OLLAMA_MODEL_LIGHT") || "qwen3:4b";
  const ollamaModelHeavy = fromLocalEnv("OLLAMA_MODEL_HEAVY") || "qwen3:8b";
```

Then add to the template literal itself, right after the existing `CHAT_MIRAI_WEB_MODEL=${chatMiraiWebModel}` line (`infra/installer/setup-local.mjs:919`):

```
CHAT_MIRAI_WEB_MODEL=${chatMiraiWebModel}

# ── Local AI routing (optional) — alternate with Ollama instead of only Groq ─
# AI_LOCAL_ENABLED=false keeps everything on Groq (default, no behavior change).
AI_LOCAL_ENABLED=${aiLocalEnabled}
OLLAMA_BASE_URL=${ollamaBaseUrl}
OLLAMA_MODEL_LIGHT=${ollamaModelLight}
OLLAMA_MODEL_HEAVY=${ollamaModelHeavy}
```

(the blank line before the new header and `CHAT_MIRAI_WEB_MODEL=${chatMiraiWebModel}` above it both already exist in the file — only the 5 new lines from `# ── Local AI routing...` onward are inserted.)

- [ ] **Step 3: Add the same 4 lines to both `.env.*.example` files**

Append, right after the existing `PFM_VISION_MODEL=qwen/qwen3.6-27b` line in both `infra/installer/.env.local.example` and `infra/installer/.env.external.example`:

```
# Local AI (optional) — alternate MirAI/help/PFM/transcript/ledger-import tasks
# between Groq and a local Ollama server. Vision tasks (receipt OCR, inventory
# photo intake, scanned bank statements) always use Groq regardless of this.
AI_LOCAL_ENABLED=false
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL_LIGHT=qwen3:4b
OLLAMA_MODEL_HEAVY=qwen3:8b
```

- [ ] **Step 4: Verify both files still parse as valid JavaScript**

Run: `node --check infra/installer/setup-local.mjs && node --check infra/installer/setup-external.mjs`
Expected: both exit 0 (no syntax errors introduced). Do not run the full interactive/destructive installer against a real environment as part of this verification — that requires a real target host and is outside this repo's automated checks.

- [ ] **Step 5: Commit**

```bash
git add infra/installer/.env.local.example infra/installer/.env.external.example infra/installer/setup-local.mjs infra/installer/setup-external.mjs
git commit -m "feat(installer): add optional AI_LOCAL_ENABLED/OLLAMA_* prompts, default disabled"
```

---

## Task 12 — Update `CLAUDE.md`'s `GROQ_API_KEY` paragraph

**Files:**
- Modify: `CLAUDE.md`

**Changes:** Extend the existing `GROQ_API_KEY` paragraph in the Commands section (the one documenting what degrades without it) to mention `AI_LOCAL_ENABLED`/Ollama, per the project's own convention of keeping that paragraph exhaustive.

- [ ] **Step 1: Append one sentence to the existing paragraph**

In `CLAUDE.md`, the `GROQ_API_KEY` paragraph (in `## Commands`, right after the `cp .env.example .env` line) ends with this exact sentence:

```
MIRAI_TTS_MODE=local ("leer en voz alta", Piper) is a separate, stateless optional feature — installer-provisioned via infra/installer, unrelated to GROQ_API_KEY; without MIRAI_TTS_URL set, GET /chat/mirai/status reports tts:false and the MirAI panel simply doesn't show the speaker button.
```

Replace that sentence with itself plus one appended sentence:

```
MIRAI_TTS_MODE=local ("leer en voz alta", Piper) is a separate, stateless optional feature — installer-provisioned via infra/installer, unrelated to GROQ_API_KEY; without MIRAI_TTS_URL set, GET /chat/mirai/status reports tts:false and the MirAI panel simply doesn't show the speaker button. An instance can also set AI_LOCAL_ENABLED=true plus OLLAMA_BASE_URL/OLLAMA_MODEL_LIGHT/OLLAMA_MODEL_HEAVY to alternate MirAI/help-assistant/PFM-assistant/transcript-analysis/ledger-import between Groq and a local Ollama server (qwen3:4b for light tasks, qwen3:8b for heavy ones); vision tasks (receipt OCR, inventory photo intake, scanned statement pages) always use Groq since local models have no vision, and any of the model-override vars above (CHAT_MIRAI_MODEL, PFM_ASSISTANT_MODEL, etc.) still force Groq with that model when set.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document AI_LOCAL_ENABLED/Ollama alternation in CLAUDE.md"
```

---

## Task 13 — Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full API test suite**

Run: `node --test apps/api/src`
Expected: same pass count as the pre-migration baseline plus the 23 new tests from Tasks 1/3/4 (6 + 7 + 10), zero new failures. (The pre-existing, unrelated `storefront-capture-foundation-contract.test.js` failure noted in `CLAUDE.md`'s file-size section is expected and not caused by this plan.)

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: exits 0, no new violations.

- [ ] **Step 3: Boot the API locally with local routing off (default) and smoke-test one migrated endpoint**

```bash
pnpm dev:api
```

Then, in another terminal, with a valid session cookie/token for a real user:

```bash
curl -s http://localhost:4010/help/assistant/status
```

Expected: same response shape as before this plan (reflects `GROQ_API_KEY` presence only, since `AI_LOCAL_ENABLED` is unset).

- [ ] **Step 4: Update `docs/TASKS.md` with verification evidence**

Add an entry under the current phase noting:

```
Verified: 2026-09-26 (node --test apps/api/src — full suite passes except the pre-existing unrelated storefront-capture-foundation-contract.test.js failure; pnpm lint clean; pnpm dev:api boots and GET /help/assistant/status responds unchanged with AI_LOCAL_ENABLED unset)
```

- [ ] **Step 5: Commit**

```bash
git add docs/TASKS.md
git commit -m "docs: record verification evidence for the unified AI provider router"
```

---

## Rollback Notes

No database migration is involved (spec §11/§27), so rollback at any point is a plain `git revert` of the commits from the aborted task onward. Because `AI_LOCAL_ENABLED` defaults to unset/`false` and every existing env var keeps its current meaning, an instance can also disable local routing instantly (unset `AI_LOCAL_ENABLED`) without reverting any code, at any point after Task 4.

- If aborted before Task 5: only the 4 new files under `apps/api/src/services/ai/` exist; nothing else changed. Delete that directory or leave it — it's inert until a service is migrated to use it.
- If aborted between Tasks 5–10: some services are migrated, some aren't. This is safe to leave partially done (each migrated service is independently correct and fully covered by its existing tests) or to revert task-by-task via `git revert` of the specific commit.
- If aborted during Task 11/12: purely additive documentation/installer changes; revert or leave as-is with no functional impact.

## Verification Gate

Before marking this feature complete in `docs/TASKS.md`:

- [ ] All 13 tasks' validation commands have been run.
- [ ] All commands exited without errors (except the pre-existing unrelated `storefront-capture-foundation-contract.test.js` failure).
- [ ] `docs/TASKS.md` updated with `Verified: 2026-09-26 (...)` per Task 13.
