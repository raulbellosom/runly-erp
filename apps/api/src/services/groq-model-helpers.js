// apps/api/src/services/groq-model-helpers.js
//
// Shared by every Groq caller (ai-client.js) that needs to know whether the
// configured model is a "thinking"/reasoning model, which requires
// `reasoning_format: "hidden"` alongside JSON mode or tool calls (otherwise
// chain-of-thought tokens can leak into `message.content` ahead of — or
// instead of — the actual answer).
const REASONING_MODEL_RE = /qwen|gpt-oss|reasoning|thinking/i;

export function isReasoningModel(model) {
  return REASONING_MODEL_RE.test(String(model ?? ""));
}
