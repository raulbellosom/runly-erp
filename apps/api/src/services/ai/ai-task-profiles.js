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
// groqDefaultModel: the model sent to Groq both when routing normally
//   resolves to Groq for this task, and as the fallback model when a local
//   (Ollama) attempt fails — see ai-router.js's circuit breaker.
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
