// Turns the help sheet's conversation state into the { role, content }[]
// shape POST /help/ask expects as `history`. Truncates each entry's content:
// history exists purely to give the AI conversational continuity ("y en
// tarjetas de credito?" referring to a prior answer) — it doesn't need the
// exact original text — but the server validates each entry at <=1000 chars
// (helpAskBodySchema), and Groq answers (max_tokens: 500) regularly produce
// 1500+ characters of Spanish prose, which broke every follow-up question
// after a long answer ("Cuerpo invalido: history.N.content: Too big").
const MAX_HISTORY_ENTRY_CHARS = 800;

function truncate(text, maxLength) {
  const value = String(text ?? "");
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

export function toChatHistory(conversation, maxTurns) {
  return conversation
    .slice(-maxTurns)
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: truncate(m.content, MAX_HISTORY_ENTRY_CHARS),
    }));
}
