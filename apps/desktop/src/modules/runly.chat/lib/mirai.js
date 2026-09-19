// apps/desktop/src/modules/runly.chat/lib/mirai.js
//
// Pure helpers for the MirAI AI assistant surfaces in runly.chat (Spec 1).
// No React, no network — safe to unit-test with node --test.

export const MIRAI_NAME = "MirAI";
export const MIRAI_SUBTITLE = "Asistente de IA · solo tú ves este chat";

// Fixed sentinel id for the "@MirAI" mention candidate in the composer.
// Not a real user id and not a valid UUIDv7 (version/variant nibbles are 0),
// so it can never collide with a member. Rides the same @[id:name] token
// format MentionTextarea uses; the API detects it in matchMiraiMention.
// MUST stay byte-identical to MIRAI_MENTION_ID in
// apps/api/src/routes/chat/mirai-service.js.
export const MIRAI_MENTION_ID = "00000000-0000-0000-0000-00000000b07a";

// Server broadcasts typing as { userId: "mirai", isTyping } on the
// conversation's presence channel — this sentinel is not a real user id.
export const MIRAI_TYPING_SENTINEL = "mirai";

export const MIRAI_EXAMPLE_PROMPTS = [
  "Resume los mensajes que reenvié aquí",
  "¿Qué archivos e imágenes he compartido en el chat esta semana?",
  "Explícame el último mensaje que me reenviaron",
];

export function isMiraiConversation(conversation) {
  return Boolean(conversation && conversation.type === "mirai");
}

export function isAssistantMessage(message) {
  return Boolean(message && message.sender_type === "assistant");
}

// Replace the typing sentinel with the display name; pass everything else
// through unchanged so real users' typing labels are untouched.
export function mapTypingNames(list) {
  return (list ?? []).map((x) => (x === MIRAI_TYPING_SENTINEL ? MIRAI_NAME : x));
}
