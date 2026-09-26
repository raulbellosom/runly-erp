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
