// apps/api/src/routes/chat/mirai-conversation-guard.js
import { ChatServiceError } from "./chat-service-error.js";

// The MirAI direct chat (conversation type 'mirai') cannot be renamed,
// have members changed, be deleted, archived, or hidden. Call at the start of
// each such mutation. No-op for every other conversation type.
export async function assertNotMirai(prisma, conversationId, action = "modificar") {
  const [row] = await prisma.$queryRaw`SELECT type FROM chat_conversations WHERE id = ${conversationId} LIMIT 1`;
  if (row?.type === "mirai") {
    throw new ChatServiceError(`No puedes ${action} el chat con MirAI.`, 400);
  }
}
