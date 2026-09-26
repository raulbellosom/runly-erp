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
    } catch (err) {
      console.warn(`[ai-router] intento local fallido para "${task}": ${err?.message ?? err}`);
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
