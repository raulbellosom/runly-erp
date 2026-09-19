// apps/api/src/routes/chat/meridian-conversation-guard.js
import { ChatServiceError } from "./chat-service-error.js";

// The MeridIAn direct chat (conversation type 'meridian') cannot be renamed,
// have members changed, be deleted, archived, or hidden. Call at the start of
// each such mutation. No-op for every other conversation type.
export async function assertNotMeridian(prisma, conversationId, action = "modificar") {
  const [row] = await prisma.$queryRaw`SELECT type FROM chat_conversations WHERE id = ${conversationId} LIMIT 1`;
  if (row?.type === "meridian") {
    throw new ChatServiceError(`No puedes ${action} el chat con MeridIAn.`, 400);
  }
}
